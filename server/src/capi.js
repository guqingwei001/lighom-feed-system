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

  const apiVersion = env.META_API_VERSION || META_API_VERSION_DEFAULT;
  const endpoint = `https://graph.facebook.com/${apiVersion}/${env.META_PIXEL_ID}/events`;
  const payload = { data: [event] };
  if (env.META_TEST_EVENT_CODE) payload.test_event_code = env.META_TEST_EVENT_CODE;

  const epik = noteAttrs._epik || noteAttrs.epik || landingInfo.epik || '';
  const customer = o.customer || {};
  const userIdForGa4 = String(customer.id || customer.user_id || '');

  // Phase 1: ad-network fanout. Meta + Pinterest intentionally skipped from /capi/order
  // because both use event_id-based dedup and Worker webhook can't access browser's
  // serverEventId. Browser → /capi/event with serverEventId is the canonical path.
  // GA4 stays enabled (transaction_id dedup works regardless of which path fires).
  const skipMeta = env.WORKER_ORDER_SKIP_META !== '0';
  const skipPinterest = env.WORKER_ORDER_SKIP_PINTEREST !== '0';
  const [metaSettled, pinterestSettled, ga4Settled] = await Promise.allSettled([
    skipMeta
      ? Promise.resolve({ ok: false, skipped: true, reason: 'order_webhook_skips_meta_to_avoid_dedup_loss' })
      : metaSend(endpoint, env.META_CAPI_ACCESS_TOKEN, payload),
    skipPinterest
      ? Promise.resolve({ ok: false, skipped: true, reason: 'order_webhook_skips_pinterest_to_avoid_dedup_loss' })
      : pinterestSend(env, event, epik),
    ga4mpSend(env, event, userIdForGa4),
  ]);

  const meta = settledOr(metaSettled);
  const pinterest = settledOr(pinterestSettled);
  const google = settledOr(ga4Settled);

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

function settledOr(s) {
  return s.status === 'fulfilled' ? s.value : { ok: false, error: String(s.reason).slice(0, 300) };
}

async function metaSend(endpoint, token, payload) {
  let r;
  try {
    r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, error: 'meta_fetch_failed', detail: String(err).slice(0, 300) };
  }
  const txt = await r.text();
  let body = null;
  try { body = JSON.parse(txt); } catch {}
  return { ok: r.ok, status: r.status, response: body || txt.slice(0, 500) };
}

// Build BigQuery row matching the schema in DEPLOY.md Phase 9.
// Uses already-computed Meta event for hash reuse where possible.
function buildBqRow(order, metaEvent, dispatches, landingInfo) {
  const d = dispatches || {};
  const li = landingInfo || {};
  const noteAttrs = extractCartAttrs(order);
  const customer = order.customer || {};
  const shippingAddr = order.shipping_address || order.shippingAddress || customer.default_address || {};

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
    data_quality: classifyTestRow(order) ? 'test' : null,
    country: arr0(ud.country),
    city_hashed: arr0(ud.ct),
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
  const billingAddr = order.billing_address || order.billingAddress || {};
  const clientDetails = order.client_details || order.clientDetails || {};

  const email = (order.email || customer.email || '').toLowerCase().trim();
  const phone = normPhone(order.phone || customer.phone || shippingAddr.phone || '');
  const firstName = (shippingAddr.first_name || customer.first_name || '').toLowerCase().trim();
  const lastName = (shippingAddr.last_name || customer.last_name || '').toLowerCase().trim();
  const country = (shippingAddr.country_code || shippingAddr.country || '').toLowerCase().slice(0, 2);
  const city = (shippingAddr.city || '').toLowerCase().replace(/\s/g, '');
  // State: prefer province_code (e.g. "CA") over full name ("California") per Meta spec.
  // For GB orders shippingAddr.province may be "Greater London" - lowercased w/ spaces removed.
  const stateCode = (shippingAddr.province_code || shippingAddr.province || '').toLowerCase().replace(/\s/g, '');
  // Country-aware zip normalization. Default 5-char slice was truncating UK postcodes
  // (SW1A 1AA → sw1a1, missing last 2 chars → hash mismatch with Meta records).
  const zip = normZip(shippingAddr.zip || '', country);
  const externalId = String(customer.id || customer.user_id || order.user_id || '');

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
  if (email) userData.em = [await sha256Hex(email)];
  if (phone) userData.ph = [await sha256Hex(phone)];
  if (firstName) userData.fn = [await sha256Hex(firstName)];
  if (lastName) userData.ln = [await sha256Hex(lastName)];
  if (city) userData.ct = [await sha256Hex(city)];
  if (stateCode) userData.st = [await sha256Hex(stateCode)];
  if (zip) userData.zp = [await sha256Hex(zip)];
  if (country) userData.country = [await sha256Hex(country)];
  if (externalId) userData.external_id = [await sha256Hex(externalId.toLowerCase())];
  if (fbc) userData.fbc = fbc;
  if (fbp) userData.fbp = fbp;
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
  })).filter(c => c.id);

  /* Shopline total_price is in cents → divide by 100 for Meta CAPI. */
  const totalValue = Math.round((Number(
    order.current_total_price ?? order.total_price ?? order.totalPrice ?? order.subtotal_price ?? 0
  ) / 100) * 100) / 100;

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

function arrayToMap(arr) {
  const m = {};
  if (!Array.isArray(arr)) return m;
  for (const it of arr) {
    if (it && it.name) m[it.name] = it.value;
  }
  return m;
}

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

async function sha256Hex(s) {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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
