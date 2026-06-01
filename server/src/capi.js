/**
 * Meta Conversion API relay
 *
 * Receives Shopline order/created webhook → builds Meta CAPI Purchase event
 * → POSTs to graph.facebook.com using server-side access token (wrangler secret).
 *
 * Why a Worker:
 *   - Shopline native Pixel + CAPI integration covers basic events but
 *     EMQ caps ~5-6 due to limited match params. This relay adds:
 *       * fbc / fbp from cart.note_attributes (browser-set Cart Attrs Injector)
 *       * full hashed PII (em / ph / fn / ln / ct / st / zp / country)
 *       * external_id, client_ip_address, client_user_agent
 *     → EMQ 8-9
 *   - access_token never exposed to browser
 *
 * Endpoints:
 *   POST /capi/order                   ← Shopline webhook receiver (dual-writes: Meta + BigQuery)
 *   GET  /capi/health?key=<feed_token> ← debug
 *
 * Required wrangler secrets (set via `wrangler secret put`):
 *   META_PIXEL_ID                      (e.g. "479292381165317")
 *   META_CAPI_ACCESS_TOKEN             (graph.facebook.com bearer)
 *   SHOPLINE_WEBHOOK_SECRET            (HMAC verification of incoming webhook)
 *
 * Optional:
 *   META_API_VERSION                   default "v21.0"
 *   META_TEST_EVENT_CODE               TESTxxxxx — for Events Manager test mode
 *   GCP_SA_JSON                        Service Account JSON (enables BigQuery dual-write)
 *   GCP_PROJECT_ID                     e.g. "lighom-analytics"
 *   BQ_DATASET                         default "lighom_capi"
 *   BQ_TABLE                           default "orders"
 *
 * BigQuery dual-write is fail-safe: if GCP_SA_JSON missing OR insert fails,
 * the Meta CAPI call is unaffected (Promise.allSettled).
 */

import { insertRow as bqInsertRow } from './bigquery.js';
import { pinterestSend } from './pinterest.js';
import { ga4mpSend } from './ga4mp.js';
import { handleEvent } from './events.js';
import { sha256Hex } from './crypto.js';
import { settledOr } from './utils.js';
import { metaSend } from './meta.js';

const META_API_VERSION_DEFAULT = 'v21.0';
const BQ_DATASET_DEFAULT = 'lighom_capi';
const BQ_TABLE_DEFAULT = 'orders';

// Entry — invoked from src/index.js routing
export async function handleCapi(request, env, url) {
  if (url.pathname === '/capi/order' && request.method === 'POST') {
    return handleOrderWebhook(request, env);
  }
  if (url.pathname === '/capi/event') {
    return handleEvent(request, env);
  }
  if (url.pathname === '/capi/health') {
    return capiHealth(request, env, url);
  }
  /* E1 5/31: CF geo cross-check endpoint for Enricher country freshness.
     Returns {country, city, region} from CF edge headers. Read-only, no body, no KV.
     CORS open for storefront fetch. Enricher cross-checks vs persisted cookie. */
  if (url.pathname === '/capi/geo') {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const cf = request.cf || {};
    const country = String(cf.country || request.headers.get('cf-ipcountry') || '').toLowerCase();
    const city = String(cf.city || request.headers.get('cf-ipcity') || '');
    const region = String(cf.region || cf.regionCode || request.headers.get('cf-region') || '');
    return new Response(JSON.stringify({
      country: /^[a-z]{2}$/.test(country) ? country : null,
      city: city || null,
      region: region || null,
    }), { status: 200, headers: cors });
  }
  // Read-only dedup check for browser Purchase block (B): "has this order's
  // Purchase already been sent to <platform>?" Pure KV.get — never writes/deletes.
  // fail-open: any error / missing oid / missing KV → {sent:false} so the browser
  // fbq fires normally (never blocks/loses a real Purchase).
  // [2026-05-26] Per-platform: default platform=meta keeps backward compat with
  // existing browser blocks that called this endpoint for fbq dedup.
  if (url.pathname === '/capi/purchase-check') {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Content-Type': 'application/json',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    const oid = url.searchParams.get('oid') || '';
    const platform = (url.searchParams.get('platform') || 'meta').toLowerCase();
    let sent = false;
    try {
      if (oid && env.PURCHASE_DEDUP) {
        const v = await env.PURCHASE_DEDUP.get(`purchase_order_${oid}_${platform}`);
        sent = !!v;
      }
    } catch (_) { /* fail-open: leave sent=false → browser fires normally */ }
    return new Response(JSON.stringify({ sent }), { headers: cors });
  }
  return new Response('Not Found', { status: 404 });
}

async function handleOrderWebhook(request, env) {
  const rawBody = await request.text();

  // Verify Shopline HMAC signature (header name per Shopline webhook docs)
  const sigHeader = request.headers.get('x-sl-hmac-sha256')
    || request.headers.get('X-Sl-Hmac-Sha256')
    || request.headers.get('shopline-hmac-sha256')
    || request.headers.get('x-shopline-hmac-sha256');
  if (env.SHOPLINE_WEBHOOK_SECRET) {
    if (!sigHeader) return jsonResp(401, { ok: false, error: 'missing_signature' });
    const ok = await verifyHmacSha256(rawBody, sigHeader, env.SHOPLINE_WEBHOOK_SECRET);
    if (!ok) return jsonResp(401, { ok: false, error: 'invalid_signature' });
  }

  let order;
  try { order = JSON.parse(rawBody); } catch (e) {
    return jsonResp(400, { ok: false, error: 'invalid_json' });
  }

  // Shopline may wrap payload in {order:{...}} or send order directly
  const o = order.order || order;

  if (!env.META_PIXEL_ID || !env.META_CAPI_ACCESS_TOKEN) {
    return jsonResp(500, { ok: false, error: 'missing_secrets' });
  }

  const noteAttrs = extractCartAttrs(o);
  // Shopline order webhook records the buyer's last landing URL (Traffic details
  // UI proves it). Field name not 100% confirmed — try several common variants.
  // The parsed result is logged so the next live order reveals the actual field.
  const landingInfo = parseLandingAttribution(o);

  const event = await buildMetaEvent(o, request, landingInfo);

  // EMQ backfill: buy-now / express orders frequently miss browser context in the
  // webhook (cart-attr injector bypassed → no _fbp/_fbc/_ua note attrs, no clientDetails).
  // Restore fbp/fbc/client_ip/client_ua from the buyer's funnel-event KV, keyed by
  // hashed email (events.js writes emqctx_<emHash> on IC/AddPaymentInfo/ATC/VC, which
  // carry these reliably). Only fills MISSING fields; fully fail-open — any error
  // leaves the original event untouched. Measured gap: fbc 66.7% / fbp 75% / ip-ua 69%.
  try {
    const ud = event.user_data || {};
    const emH = Array.isArray(ud.em) ? ud.em[0] : ud.em;
    if (emH && env.PURCHASE_DEDUP) {
      const raw = await env.PURCHASE_DEDUP.get(`emqctx_${emH}`);
      if (raw) {
        const c = JSON.parse(raw);
        if (!ud.fbp && c.fbp) ud.fbp = c.fbp;
        if (!ud.fbc && c.fbc) ud.fbc = c.fbc;
        if (!ud.client_ip_address && c.ip) ud.client_ip_address = c.ip;
        if (!ud.client_user_agent && c.ua) ud.client_user_agent = c.ua;
        // Identity unification: append the browser funnel's hashed external_id
        // (Enricher device UUID used by logged-out VC/ATC/IC) so the Purchase
        // connects to that funnel. Multi-value external_id — the Shopline
        // customer.id element is kept, never removed. Strictly additive.
        if (c.xid) {
          const cur = Array.isArray(ud.external_id)
            ? ud.external_id.slice()
            : (ud.external_id ? [ud.external_id] : []);
          if (cur.indexOf(c.xid) === -1) cur.push(c.xid);
          ud.external_id = cur;
        }
        event.user_data = ud;
      }
    }
  } catch (_) { /* fail-open: keep original event exactly as built */ }

  // [2026-05-21] Webhook Purchase writes the emqctx_xid_<extid> index too.
  // Shopline-side order has the canonical em/ph/fn/ln/geo (most authoritative).
  // Storing these by extid lets future PV/VC/ATC from the same logged-in customer
  // (or same device UUID if Worker received it via cart_attrs earlier) backfill em.
  // Customer-PII only — no order_id / value / product_id in the index value.
  try {
    const ud = event.user_data || {};
    const xid = Array.isArray(ud.external_id) ? ud.external_id[0] : ud.external_id;
    const emH = Array.isArray(ud.em) ? ud.em[0] : ud.em;
    if (xid && emH && env.PURCHASE_DEDUP) {
      await env.PURCHASE_DEDUP.put(`emqctx_xid_${xid}`, JSON.stringify({
        em: emH,
        ph: Array.isArray(ud.ph) ? ud.ph[0] : (ud.ph || ''),
        fn: Array.isArray(ud.fn) ? ud.fn[0] : (ud.fn || ''),
        ln: Array.isArray(ud.ln) ? ud.ln[0] : (ud.ln || ''),
        ct: Array.isArray(ud.ct) ? ud.ct[0] : (ud.ct || ''),
        st: Array.isArray(ud.st) ? ud.st[0] : (ud.st || ''),
        zp: Array.isArray(ud.zp) ? ud.zp[0] : (ud.zp || ''),
        country: Array.isArray(ud.country) ? ud.country[0] : (ud.country || ''),
        t: Date.now(),
      }), { expirationTtl: 2592000 });
    }
  } catch (_) { /* fail-open: index write failure is non-critical, event still fires */ }

  // serverEventId bridge: when event_id is the `purchase_<seq>` fallback (no
  // serverEventId in the webhook payload), substitute the serverEventId captured
  // by the thank-you SEID Bridge block (KV seid_<appOrderSeq>). This makes the
  // CAPI Purchase event_id == native fbq Purchase eid → Meta dedups native↔CAPI.
  // Only touches the fallback id (never an explicit order.server_event_id);
  // fail-open — any miss/error keeps the current `purchase_<seq>` id (no regression).
  try {
    if (env.PURCHASE_DEDUP && /^purchase_/.test(event.event_id)) {
      const seq = event.event_id.replace(/^purchase_/, '');
      if (seq) {
        const seid = await env.PURCHASE_DEDUP.get(`seid_${seq}`);
        if (seid) event.event_id = seid;
      }
    }
  } catch (_) { /* fail-open: keep fallback event_id */ }

  /* D3 5/31: endpoint/payload/test_event_code build moved inside meta.js metaSend(env, event) */

  const epik = noteAttrs._epik || noteAttrs.epik || landingInfo.epik || '';
  const customer = o.customer || {};
  const userIdForGa4 = String(customer.id || customer.user_id || '');

  // Phase 1: ad-network fanout. Default SENDS Meta+Pinterest from /capi/order as the
  // server-side backstop (browser self-pixel/self-pin can miss on fast thank-you exits).
  // event_id == browser's purchase_<appOrderSeq> (SEID bridge above aligns to native fbq)
  // so Meta/Pinterest dedup the webhook send against the browser send. To turn a platform
  // OFF, set WORKER_ORDER_SKIP_META / WORKER_ORDER_SKIP_PINTEREST = '1' (safe default: send).
  const skipMeta = env.WORKER_ORDER_SKIP_META === '1';
  const skipPinterest = env.WORKER_ORDER_SKIP_PINTEREST === '1';
  const [metaSettled, pinterestSettled, ga4Settled] = await Promise.allSettled([
    skipMeta
      ? Promise.resolve({ ok: false, skipped: true, reason: 'order_webhook_skips_meta_to_avoid_dedup_loss' })
      : metaSend(env, event),
    skipPinterest
      ? Promise.resolve({ ok: false, skipped: true, reason: 'order_webhook_skips_pinterest_to_avoid_dedup_loss' })
      : pinterestSend(env, event, epik),
    ga4mpSend(env, event, userIdForGa4),
  ]);

  const meta = settledOr(metaSettled);
  const pinterest = settledOr(pinterestSettled);
  const google = settledOr(ga4Settled);

  // [2026-05-26] Per-platform KV writes: only mark dedup for platforms this webhook
  // actually delivered to (meta.ok / pinterest.ok / google.ok). With the default send,
  // a successful webhook send writes that platform's key — but browser blocks use the
  // SAME event_id so Meta/Pin dedup the pair anyway (key just prevents 3rd+ fire).
  // Old shared-key version [2026-05-22] blocked all platforms on GA4-only webhook
  // success, killing Pin Purchase v1 5/22-5/26 (BQ pin_ok=0). 90d TTL matches events.js.
  try {
    const dedupSeq = String(o.name || o.app_order_seq || o.appOrderSeq || '').replace(/^#/, '');
    if (dedupSeq && env.PURCHASE_DEDUP) {
      const nowIso = new Date().toISOString();
      const writes = [];
      if (meta && meta.ok) writes.push(env.PURCHASE_DEDUP.put(`purchase_order_${dedupSeq}_meta`, nowIso));
      if (pinterest && pinterest.ok) writes.push(env.PURCHASE_DEDUP.put(`purchase_order_${dedupSeq}_pinterest`, nowIso));
      if (google && google.ok) writes.push(env.PURCHASE_DEDUP.put(`purchase_order_${dedupSeq}_ga4`, nowIso));
      if (writes.length) await Promise.allSettled(writes);
    }
  } catch (_) { /* KV outage non-fatal — fanout already delivered */ }

  // Phase 2: write single BQ row containing actual statuses from all 3 platforms.
  // (Sequential after fanout adds ~150-200ms but gives full audit trail.)
  const bqRow = buildBqRow(o, event, { meta, pinterest, google }, landingInfo);
  let bq;
  try {
    bq = env.GCP_SA_JSON
      ? await bqInsertRow(env, env.BQ_DATASET || BQ_DATASET_DEFAULT, env.BQ_TABLE || BQ_TABLE_DEFAULT, bqRow, event.event_id)
      : { ok: false, skipped: true, reason: 'GCP_SA_JSON not set' };
  } catch (err) {
    bq = { ok: false, error: String(err).slice(0, 300) };
  }

  // Always 200 to Shopline so it doesn't retry storms.
  return jsonResp(200, {
    ok: meta.ok,                    // Shopline-visible status = Meta (primary)
    meta,
    pinterest,
    google,
    bigquery: bq,
    event_id: event.event_id,
    matched_keys: Object.keys(event.user_data || {}).filter(k => event.user_data[k]),
    landing: landingInfo,           // surfaces which field hit + parsed params for debugging
  });
}

// Classify whether an order is a synthetic/test row (filter from analytics)
function classifyTestRow(order) {
  const oid = String(order.id || order.order_id || '');
  if (/^(SMOKE_|SYNTH_|TEST_|smoke_|p1_|p2_)/.test(oid)) return true;
  const email = (order.email || (order.customer && order.customer.email) || '').toLowerCase();
  if (email === 'probe@lighom.com' || email.endsWith('@lighom.com.test')) return true;
  return false;
}

// Extract attribution params (epik, utm_*, click_ids) from the Shopline order's
// landing URL. Tries several field name variants because we haven't pinned down
// Shopline v20260901's exact key — landingFieldHit in response surfaces the winner.
function parseLandingAttribution(o) {
  const clientDetails = o.client_details || o.clientDetails || {};
  const candidates = [
    ['landing_site', o.landing_site],
    ['landingSite', o.landingSite],
    ['landing_url', o.landing_url],
    ['landingUrl', o.landingUrl],
    ['lastLandingUrl', o.lastLandingUrl],
    ['last_landing_url', o.last_landing_url],
    ['landing_page', o.landing_page],
    ['landingPageUrl', o.landingPageUrl],
    ['client_details.landing_site', clientDetails.landing_site],
    ['client_details.landingSite', clientDetails.landingSite],
    ['client_details.landing_url', clientDetails.landing_url],
    ['client_details.referrer', clientDetails.referrer],
    ['referring_site', o.referring_site],
    ['referrer', o.referrer],
  ];
  let url = '', hit = null;
  for (const [k, v] of candidates) {
    if (typeof v === 'string' && v.startsWith('http')) { url = v; hit = k; break; }
  }
  const out = {
    landingFieldHit: hit,
    landingUrl: url ? url.slice(0, 500) : null,
    epik: null, utm_source: null, utm_medium: null, utm_campaign: null,
    utm_content: null, utm_term: null,
    pins_campaign_id: null, fbclid: null, gclid: null, ttclid: null, msclkid: null,
  };
  if (!url) return out;
  try {
    const u = new URL(url);
    const q = u.searchParams;
    out.epik = q.get('epik') || null;
    out.utm_source = q.get('utm_source');
    out.utm_medium = q.get('utm_medium');
    out.utm_campaign = q.get('utm_campaign');
    out.utm_content = q.get('utm_content');
    out.utm_term = q.get('utm_term');
    out.pins_campaign_id = q.get('pins_campaign_id');
    out.fbclid = q.get('fbclid');
    out.gclid = q.get('gclid');
    out.ttclid = q.get('ttclid');
    out.msclkid = q.get('msclkid');
  } catch (_) {}
  return out;
}

/* settledOr moved to utils.js (D2 consolidation, 5/31) */

/* metaSend moved to meta.js (D3 consolidation, 5/31) */

// Build BigQuery row matching the schema in DEPLOY.md Phase 9.
// Uses already-computed Meta event for hash reuse where possible.
function buildBqRow(order, metaEvent, dispatches, landingInfo) {
  const d = dispatches || {};
  const li = landingInfo || {};
  const noteAttrs = extractCartAttrs(order);
  const customer = order.customer || {};

  const ud = metaEvent.user_data || {};
  const cd = metaEvent.custom_data || {};

  // Hashed pulls from Meta event (single source of truth, already SHA-256'd).
  const arr0 = (v) => Array.isArray(v) && v.length ? v[0] : null;

  return {
    event_id: metaEvent.event_id,
    event_time: new Date(metaEvent.event_time * 1000).toISOString(),
    event_name: metaEvent.event_name,
    order_id: String(order.id || order.order_id || ''),
    user_id: String(customer.id || customer.user_id || order.user_id || ''),
    email_hashed: arr0(ud.em),
    external_id: arr0(ud.external_id),
    phone_hashed: arr0(ud.ph),
    fbc: ud.fbc || null,
    fbp: ud.fbp || null,
    client_ip: ud.client_ip_address || null,
    client_ua: ud.client_user_agent || null,
    value: typeof cd.value === 'number' ? cd.value : null,
    currency: cd.currency || null,
    product_ids: Array.isArray(cd.content_ids) ? cd.content_ids : [],
    utm_source: noteAttrs._last_utm_source || noteAttrs.utm_source || noteAttrs._first_utm_source || li.utm_source || null,
    utm_medium: noteAttrs._last_utm_medium || noteAttrs.utm_medium || noteAttrs._first_utm_medium || li.utm_medium || null,
    utm_campaign: noteAttrs._last_utm_campaign || noteAttrs.utm_campaign || noteAttrs._first_utm_campaign || li.utm_campaign || null,
    utm_content: li.utm_content || null,
    epik: noteAttrs._epik || noteAttrs.epik || li.epik || null,
    fbclid: li.fbclid || null,
    pins_campaign_id: li.pins_campaign_id || null,
    landing_url: li.landingUrl || null,
    data_quality: classifyTestRow(order) ? 'test' : ('webhook:' + (metaEvent.event_name || 'unknown').toLowerCase()),
    country: arr0(ud.country),
    city_hashed: arr0(ud.ct),
    // [2026-05-21] PII field presence monitoring — mirror of events.js engagements;
    // tracks which user_data fields the webhook successfully assembled for EMQ analysis.
    ph_present: !!arr0(ud.ph),
    fn_present: !!arr0(ud.fn),
    ln_present: !!arr0(ud.ln),
    ct_present: !!arr0(ud.ct),
    st_present: !!arr0(ud.st),
    zp_present: !!arr0(ud.zp),
    country_present: !!arr0(ud.country),
    // Actual statuses from all 3 ad-network dispatches (sequential write).
    meta_capi_status: d.meta ? (d.meta.ok ? 'ok' : (d.meta.skipped ? 'skipped' : 'fail')) : null,
    meta_capi_response: d.meta ? JSON.stringify(d.meta).slice(0, 1000) : null,
    pinterest_status: d.pinterest ? (d.pinterest.ok ? 'ok' : (d.pinterest.skipped ? 'skipped' : 'fail')) : null,
    pinterest_response: d.pinterest ? JSON.stringify(d.pinterest).slice(0, 1000) : null,
    google_status: d.google ? (d.google.ok ? 'ok' : (d.google.skipped ? 'skipped' : 'fail')) : null,
    google_response: d.google ? JSON.stringify(d.google).slice(0, 1000) : null,
  };
}

async function capiHealth(request, env, url) {
  const tok = url.searchParams.get('key');
  if (!tok || !env.FEED_ACCESS_TOKEN || tok !== env.FEED_ACCESS_TOKEN) {
    return jsonResp(403, { ok: false, error: 'forbidden' });
  }
  return jsonResp(200, {
    ok: true,
    pixel_id: env.META_PIXEL_ID || null,
    has_access_token: !!env.META_CAPI_ACCESS_TOKEN,
    has_webhook_secret: !!env.SHOPLINE_WEBHOOK_SECRET,
    api_version: env.META_API_VERSION || META_API_VERSION_DEFAULT,
    test_event_code_set: !!env.META_TEST_EVENT_CODE,
    bigquery_enabled: !!env.GCP_SA_JSON,
    bq_project: env.GCP_PROJECT_ID || null,
    bq_dataset: env.BQ_DATASET || BQ_DATASET_DEFAULT,
    bq_table: env.BQ_TABLE || BQ_TABLE_DEFAULT,
    pinterest_enabled: !!env.PINTEREST_ACCESS_TOKEN && !!env.PINTEREST_AD_ACCOUNT_ID,
    pinterest_test_code_set: !!env.PINTEREST_TEST_EVENT_CODE,
    ga4_enabled: !!env.GA4_MEASUREMENT_ID && !!env.GA4_API_SECRET,
    ga4_measurement_id: env.GA4_MEASUREMENT_ID || null,
  });
}

// ===== Meta event builder =====

async function buildMetaEvent(order, request, landingInfo) {
  const li = landingInfo || {};
  const noteAttrs = extractCartAttrs(order);

  // Customer fields (Shopline order/created)
  const customer = order.customer || {};
  const shippingAddr = order.shipping_address || order.shippingAddress || customer.default_address || {};
  const clientDetails = order.client_details || order.clientDetails || {};
  // Shopline's order payload carries the recipient as `receiverInfo` (camelCase,
  // confirmed 2026-05-22 against the admin order API): receiverFirstName /
  // receiverLastName / receiverCountryCode / receiverCity / receiverProvince(Code)
  // / receiverPostcode / receiverMobile. The Shopify-style shipping_address.* keys
  // above are never populated by this webhook → fn/ln/ct/st/zp/country were 0% on
  // every webhook Purchase. recv is consulted as a fallback only — purely additive.
  const recv = order.receiverInfo || order.receiver_info || order.receiver || {};

  const email = (order.email || customer.email || order.buyerEmail || recv.receiverEmail || '').toLowerCase().trim();
  const phone = normPhone(order.phone || customer.phone || shippingAddr.phone || recv.receiverMobile || order.buyerPhone || '');
  const firstName = (shippingAddr.first_name || recv.receiverFirstName || customer.first_name || '').toLowerCase().trim();
  const lastName = (shippingAddr.last_name || recv.receiverLastName || customer.last_name || '').toLowerCase().trim();
  const country = (shippingAddr.country_code || shippingAddr.country || recv.receiverCountryCode || '').toLowerCase().slice(0, 2);
  const city = (shippingAddr.city || recv.receiverCity || '').toLowerCase().replace(/\s/g, '');
  // State: prefer province_code (e.g. "CA") over full name ("California") per Meta spec.
  // For GB orders shippingAddr.province may be "Greater London" - lowercased w/ spaces removed.
  const stateCode = (shippingAddr.province_code || shippingAddr.province || recv.receiverProvinceCode || recv.receiverProvince || '').toLowerCase().replace(/\s/g, '');
  // Country-aware zip normalization. Default 5-char slice was truncating UK postcodes
  // (SW1A 1AA → sw1a1, missing last 2 chars → hash mismatch with Meta records).
  const zip = normZip(shippingAddr.zip || recv.receiverPostcode || '', country);
  const externalId = String(customer.id || customer.user_id || order.user_id || order.buyerId || customer.buyerId || '');

  // Browser-set fields from cart attributes; if _fbc missing but landing URL has
  // fbclid, construct fbc = fb.<ver>.<click_ts_ms>.<fbclid> per Meta CAPI spec.
  // Subdomain index = 1 (lighom.com is eTLD+1). click_ts uses order created_at
  // when known (closest proxy to actual click time available in webhook payload).
  let fbc = noteAttrs._fbc || '';
  if (!fbc && li.fbclid) {
    const clickTsMs = parseEventTime(order.created_at || order.createdAt) * 1000 || Date.now();
    fbc = `fb.1.${clickTsMs}.${li.fbclid}`;
  }
  const fbp = noteAttrs._fbp || '';
  const userAgentFromCart = noteAttrs._user_agent || '';
  const clientIp = clientDetails.browser_ip || clientDetails.ip || clientDetails.client_ip || '';
  const clientUa = clientDetails.user_agent || userAgentFromCart || '';

  const userData = {};
  if (isCleanPII('em', email)) userData.em = [await sha256Hex(email)];
  if (isCleanPII('ph', phone)) userData.ph = [await sha256Hex(phone)];
  if (isCleanPII('fn', firstName)) userData.fn = [await sha256Hex(firstName)];
  if (isCleanPII('ln', lastName)) userData.ln = [await sha256Hex(lastName)];
  if (isCleanPII('ct', city)) userData.ct = [await sha256Hex(city)];
  if (isCleanPII('st', stateCode)) userData.st = [await sha256Hex(stateCode)];
  if (isCleanPII('zp', zip)) userData.zp = [await sha256Hex(zip)];
  if (isCleanPII('country', country)) userData.country = [await sha256Hex(country)];
  // [2026-05-26] external_id: PLAIN per Meta official spec ("Not hashed - no hash required").
  // Pinterest CAPI hashes at pinterest.js (Pinterest spec differs from Meta).
  if (isCleanPII('external_id', externalId) && /^\d{6,}$/.test(externalId.toLowerCase())) {
    userData.external_id = [externalId.toLowerCase()];
  }
  // fbc/fbp gate: reject test sentinels and malformed values that pollute Meta EMQ
  if (fbc && /^fb\.1\.\d+\.[^.]{20,}$/.test(fbc) && !/test|debug|dev|sample|enricher/i.test(fbc)) {
    userData.fbc = fbc;
  }
  // Real Meta fbp can have extension segments (Open Bridge, etc.): fb.1.<ts>.<rand>(.<ext>)*
  if (fbp && /^fb\.1\.\d+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(fbp)) userData.fbp = fbp;
  if (clientIp) userData.client_ip_address = clientIp;
  if (clientUa) userData.client_user_agent = clientUa;

  // Custom data — enriched contents include title/brand/category for Catalog Ads (DPA) match.
  const lineItems = order.line_items || order.lineItems || [];
  // Shopline webhook line items use productSku (18xxx variant = Catalog Content ID) — prefer that
  // before falling back to productSeq (16xxx SPU group), which Meta only matches via item_group_id.
  const contents = lineItems.map(li => ({
    id: String(
      li.productSku || li.variant_id || li.variantId || li.sku ||
      li.productSeq || li.product_id || li.productId || ''
    ),
    quantity: Number(li.quantity || li.productNum) || 1,
    /* Shopline order webhook prices are in CENTS — divide by 100 for Meta (which expects dollars). */
    item_price: Math.round((Number(li.finalPrice || li.price || li.unit_price || 0) / 100) * 100) / 100,
    title: String(li.title || li.name || li.productName || '').slice(0, 100),
    brand: String(li.vendor || li.brand || 'Lighom'),
    category: String(li.product_category || li.customCategoryName || '').slice(0, 100),
    item_group_id: String(li.productSeq || li.product_id || li.productGroupId || ''),
  })).map(c => { if (!c.item_group_id) delete c.item_group_id; return c; }).filter(c => c.id);

  /* Shopline order.current_total_price is a DOLLARS string, NOT cents.
     Verified 2026-05-18 via PRICE_DIAG on 8 live orders: raw "99.57" = real
     $99.57 (the old /100 wrote $0.9957 to BQ + Meta). Do NOT divide by 100.
     Note: orderItemList[].finalPrice IS cents (line ~372) — different field. */
  const totalValue = Math.round(Number(
    order.current_total_price ?? order.total_price ?? order.totalPrice ?? order.subtotal_price ?? 0
  ) * 100) / 100 || 0;

  const customData = {
    currency: (order.currency || order.presentment_currency || 'USD').toUpperCase(),
    value: totalValue,
    content_ids: contents.map(c => c.id),
    content_type: 'product',
    num_items: contents.reduce((s, c) => s + c.quantity, 0),
    contents,
    order_id: String(order.id || order.order_id || ''),
    // predicted_ltv removed: was placeholder (value*2), Meta flags as invalid LTV.
    // Re-add only when real LTV model exists.
    // delivery_category removed: Lighom doesn't fit Meta enum (in_store/curbside/home_delivery).
  };

  const eventTime = parseEventTime(order.created_at || order.createdAt) || Math.floor(Date.now() / 1000);

  // event_id MUST match browser Pixel's eventID for dedup.
  // GTM v2 block (id 7508872161467303461) uses:
  //   1. __PRELOAD_STATE__.serverEventId  (Shopline server-generated)
  //   2. fallback: `purchase_${appOrderSeq}` where appOrderSeq = LIGxxxxxxxxx
  // Webhook payload typically exposes order.name (LIGxxx) and possibly
  // server_event_id. Match the v2 fallback first since serverEventId
  // is rarely in webhook payload.
  const orderSeq = String(order.name || order.app_order_seq || order.appOrderSeq || '').replace(/^#/, '');
  const eventId = String(
    order.server_event_id ||
    order.serverEventId ||
    (orderSeq ? `purchase_${orderSeq}` : '') ||
    order.id ||
    order.order_id ||
    `purchase_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );

  return {
    event_name: 'Purchase',
    event_time: eventTime,
    event_id: eventId,
    action_source: 'website',
    event_source_url: order.order_status_url || order.checkout_url || `https://lighom.com/checkout?order=${eventId}`,
    user_data: userData,
    custom_data: customData,
  };
}

// ===== Helpers =====

// Defensive cart-attributes extraction. Lighom storefront Cart Attrs Injector
// POSTs to /cart/update.js with `{attributes: {...}}` (Shopify convention,
// confirmed 5/13 to work on Shopline). Shopline order/created webhook payload
// field name is not 100% confirmed — try array form first (note_attributes),
// then dict form (attributes), accumulate into single flat map. Last-wins.
function extractCartAttrs(order) {
  const o = order || {};
  const out = {};
  // Array form: [{name,value}, ...]
  for (const arr of [o.note_attributes, o.noteAttributes, o.cart_note_attributes]) {
    if (Array.isArray(arr)) {
      for (const it of arr) if (it && it.name) out[it.name] = it.value;
    }
  }
  // Dict form: {key: value}
  for (const dict of [o.attributes, o.cart_attributes, o.cartAttributes]) {
    if (dict && typeof dict === 'object' && !Array.isArray(dict)) {
      for (const k of Object.keys(dict)) out[k] = dict[k];
    }
  }
  return out;
}

function isCleanPII(field, value) {
  if (!value || typeof value !== 'string') return false;
  const s = String(value).trim();
  if (s.length < 2) return false;
  if (/^[\*#\-_]+$/.test(s)) return false;
  if (/^(test|--no-value--|none|null|undefined|n\/a|placeholder|sample|dummy|fake)$/i.test(s)) return false;
  if (/@example\.(com|org|net|test)$/i.test(s)) return false;
  if (/[\*#]{3,}/.test(s)) return false;
  if (field === 'country' && s.length > 4) return false;
  return true;
}

function normZip(zip, countryCode) {
  if (!zip) return '';
  const z = String(zip).toLowerCase().replace(/\s/g, '');
  const cc = (countryCode || '').toLowerCase();
  if (cc === 'us' || cc === 'ca') return z.slice(0, 5);   // US ZIP5 / CA postal prefix
  if (cc === 'gb') return z;                              // UK postcode: variable 5-8 chars alphanumeric, preserve full
  if (['de','fr','es','it','nl','be','at','pl','dk','se','no','fi','pt','ie','ch'].includes(cc)) {
    return z.slice(0, 5);                                 // EU 5-digit common
  }
  return z;                                               // Unknown country: preserve as-is
}

function normPhone(p) {
  if (!p) return '';
  return String(p).replace(/[\s\-()]/g, '').replace(/^\+/, '').toLowerCase();
}

function parseEventTime(s) {
  if (!s) return 0;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return 0;
  return Math.floor(t / 1000);
}

/* sha256Hex moved to crypto.js (D1 consolidation, 5/31) */

async function verifyHmacSha256(rawBody, signatureHeader, secret) {
  // Shopline signs the raw body with HMAC-SHA256 + secret.
  // Header may be base64 or hex — try both.
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const sigArr = new Uint8Array(sig);
  const sigB64 = btoa(String.fromCharCode(...sigArr));
  const sigHex = Array.from(sigArr).map(b => b.toString(16).padStart(2, '0')).join('');
  return timingEq(signatureHeader, sigB64) || timingEq(signatureHeader, sigHex);
}

function timingEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function jsonResp(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
