/**
 * Engagement events relay (browser → Worker → Meta CAPI + Pinterest CAPI + GA4 MP + BQ).
 *
 * Endpoint: POST /capi/event
 * Origin must be lighom.com (or a whitelisted subdomain). No HMAC because
 * payload doesn't contain order data; abuse risk is low (only inflates
 * engagement metrics, not financial events). CF Workers free tier rate-limits
 * per IP at the edge.
 *
 * Required body (browser → Worker):
 *   {
 *     event_name: "ScrollDepth75" | "TimeOnPage30s" | "TimeOnPage60s" | "DeepEngagement" | "ViewItemList" | ...,
 *     event_id:   "<unique>",       // for dedup with browser Pixel
 *     event_time: <unix sec>,       // optional, defaults to now
 *     page_url:   "https://...",
 *     page_path:  "/products/...",
 *     page_type:  "product" | "category" | "home" | ...,
 *     user_data:  { em?, ph?, fn?, ln?, fbc?, fbp?, epik?, ttclid?, msclkid?, client_ua?, external_id? },
 *     custom_data:{ product_id?, value?, currency?, content_ids?[] },
 *     utm: { source?, medium?, campaign? }
 *   }
 *
 * Worker fans out to:
 *   - Meta CAPI    (action_source: website, custom event)
 *   - Pinterest CAPI (custom event via metaEventToPinterest map)
 *   - GA4 MP       (translates to GA4 event)
 *   - BigQuery     (engagements table)
 */

import { pinterestSend, buildPinterestBody } from './pinterest.js';
import { ga4mpSend } from './ga4mp.js';
import { insertRow as bqInsertRow } from './bigquery.js';
import { detectBot } from './bot_filter.js';
import { sha256Hex } from './crypto.js';
import { settledOr } from './utils.js';
import { metaSend } from './meta.js';

const ALLOWED_ORIGINS = /^https:\/\/(www\.)?lighom\.com$/;

export async function handleEvent(request, env) {
  // Quick CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }
  if (request.method !== 'POST') return jsonResp(405, { ok: false, error: 'method_not_allowed' }, request);

  const origin = request.headers.get('Origin') || '';
  if (!ALLOWED_ORIGINS.test(origin)) {
    return jsonResp(403, { ok: false, error: 'origin_blocked', got: origin }, request);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResp(400, { ok: false, error: 'invalid_json' }, request); }

  if (!body.event_name || !body.event_id) {
    return jsonResp(400, { ok: false, error: 'missing event_name or event_id' }, request);
  }
  // [5/31] Cap event_id at 64 chars. Meta recommends event_id <=40 chars (longer accepted but truncation rules unspecified — risks browser/server dedup mismatch). 64 chars covers all current id formats (purchase_<orderSeq>, ic_<token>_<rand>, search_<qhash>_<ts>) with headroom.
  body.event_id = String(body.event_id).slice(0, 64);

  // Normalize internal "metaEvent" structure so we can reuse pinterestSend / ga4mpSend.
  const ud = body.user_data || {};
  const cd = body.custom_data || {};
  // UTM: prefer body.utm (client-provided from cookies), fall back to URL params on page_url.
  // Without this fallback, ROAS attribution silently drops on every event without explicit utm.
  const utm = { ...(body.utm || {}) };
  if (body.page_url && (!utm.source || !utm.medium || !utm.campaign)) {
    try {
      const u = new URL(body.page_url);
      if (!utm.source && u.searchParams.get('utm_source')) utm.source = u.searchParams.get('utm_source');
      if (!utm.medium && u.searchParams.get('utm_medium')) utm.medium = u.searchParams.get('utm_medium');
      if (!utm.campaign && u.searchParams.get('utm_campaign')) utm.campaign = u.searchParams.get('utm_campaign');
    } catch (_) { /* invalid URL — ignore */ }
  }
  // Clamp client timestamp: clients with clock skew (future or > 7d old) get
  // rejected by Meta CAPI (error_subcode 2804004). Force into valid window.
  const nowSec = Math.floor(Date.now() / 1000);
  let eventTime = Number(body.event_time) || nowSec;
  if (eventTime > nowSec || eventTime < nowSec - 7 * 86400) eventTime = nowSec;

  const userData = {};
  // Hash em/ph if provided in plaintext; pass through if already hashed (64-char hex).
  if (ud.em) userData.em = await maybeHashArr(ud.em);
  if (ud.ph) userData.ph = await maybeHashArr(ud.ph);
  if (ud.fn) userData.fn = await maybeHashArr(ud.fn);
  if (ud.ln) userData.ln = await maybeHashArr(ud.ln);
  if (ud.ct) userData.ct = await maybeHashArr(ud.ct);
  if (ud.st) userData.st = await maybeHashArr(ud.st);
  if (ud.zp) userData.zp = await maybeHashArr(ud.zp);
  if (ud.country) userData.country = await maybeHashArr(ud.country);
  if (ud.db) userData.db = await maybeHashArr(ud.db);
  if (ud.ge) userData.ge = await maybeHashArr(ud.ge);
  // [2026-05-26] external_id: PLAIN per Meta official spec ("Not hashed - no hash required").
  // Meta SDK source confirms: external_id bypasses normalize_array hashing pipeline.
  // Pinterest CAPI hashes external_id at pinterest.js layer (Pinterest spec requires SHA256).
  // Accept input as Array or single string. Validate each entry:
  //   - Purchase events: digit-only customer.id (preserves cust_id-only attribution purity)
  //   - Other events: digit-only customer.id OR UUID v4 (cookie-based persistent visitor ID)
  // External cookie IDs are official Meta-supported external_id per docs:
  // "External IDs can be any unique ID from the advertiser, such as loyalty membership IDs,
  //  user IDs, and external cookie IDs."
  if (ud.external_id) {
    const isPurchaseEvent = body.event_name === 'Purchase';
    const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const DIGIT = /^\d{6,}$/;
    /* 5/31 fix: accept 64-char hex hash passthrough — PII Persist v1 bridge writes
       hashed external_id to no-suffix cookie; downstream blocks read it raw and
       send here; without this gate they fall through to "no valid format" and
       external_id gets dropped on every Lead/Contact/PV from returning customers. */
    const HEX64 = /^[a-f0-9]{64}$/i;
    const isValid = (s) => DIGIT.test(s) || HEX64.test(s) || (!isPurchaseEvent && UUID_V4.test(s));
    const raw = Array.isArray(ud.external_id) ? ud.external_id : [ud.external_id];
    const cleaned = raw
      .map(v => String(v).toLowerCase().trim())
      .filter(isValid);
    if (cleaned.length) userData.external_id = cleaned;
  }
  // fbc gate: reject test/debug fbclid sentinels (e.g. ENRICHER_V10_TEST) that
  // never existed on facebook.com — Meta can't reverse-match them so they pollute EMQ.
  if (ud.fbc && /^fb\.1\.\d+\.[^.]{20,}$/.test(ud.fbc) && !/test|debug|dev|sample|enricher/i.test(ud.fbc)) {
    userData.fbc = ud.fbc;
  }
  if (ud.fbp) userData.fbp = ud.fbp;
  // Prefer explicit client_ua in body; fall back to request's User-Agent header
  const ua = ud.client_ua || request.headers.get('User-Agent') || '';
  if (ua) userData.client_user_agent = ua;
  // Use Cloudflare's built-in client IP detection
  const cfIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || '';
  if (cfIp) userData.client_ip_address = cfIp;

  // Geo enrichment from Cloudflare Worker request.cf — zero-latency, free plan.
  // request.cf populates regionCode/city even when headers don't (Pro+ only).
  // Only fills when user-supplied PII missing; never overrides.
  // ZIP/FN/LN intentionally not inferred — IP can't.
  const cf = request.cf || {};
  // Anomalies: XX (unknown), T1 (Tor exit), regional aggregates AP/EU.
  // Accept only real ISO 3166-1 alpha-2 letters.
  const cfCountry = cf.country || request.headers.get('cf-ipcountry') || '';
  if (!userData.country && /^[a-z]{2}$/i.test(cfCountry) && !/^(XX|T1|AP|EU)$/i.test(cfCountry)) {
    userData.country = [await sha256Hex(cfCountry.toLowerCase())];
  }
  const cfRegion = cf.regionCode || cf.region || request.headers.get('cf-region-code') || request.headers.get('cf-region') || '';
  if (!userData.st && cfRegion) {
    const v = String(cfRegion).toLowerCase().replace(/\s/g, '');
    if (/^[a-z0-9-]{1,8}$/.test(v) && v !== 'unknown') userData.st = [await sha256Hex(v)];
  }
  const cfCity = cf.city || request.headers.get('cf-ipcity') || '';
  if (!userData.ct && cfCity) {
    const v = String(cfCity).toLowerCase().replace(/\s/g, '');
    if (v && v.length <= 32 && !/^(unknown|none|null)$/.test(v)) userData.ct = [await sha256Hex(v)];
  }

  // [2026-05-21] EMQ enrichment by external_id — upper-funnel events (PV/VC/VCat/ATC)
  // usually lack em/ph/fn/ln/geo because the customer hasn't entered them yet at that
  // point. If we've previously stored these for the same external_id (from a later
  // IC/APInfo/Purchase in this OR a prior session), backfill them here so all events
  // can score full EMQ. Keyed by external_id (logged-in: Shopline customer.id stable
  // across devices; logged-out: Enricher device UUID stable per browser).
  // Strictly additive — only fills MISSING fields, never overwrites priority sources.
  // ⚠️ Customer-identity only: em/ph/fn/ln/ct/st/zp/country. Product/value/order_id
  // NEVER cross-pollinated between events (different conversion context).
  try {
    const xidLookup = Array.isArray(userData.external_id) && userData.external_id.length
      ? userData.external_id[0]
      : (typeof userData.external_id === 'string' ? userData.external_id : '');
    const needsEnrich = xidLookup && (!userData.em || !userData.ph || !userData.fn || !userData.ln || !userData.ct);
    if (needsEnrich && env.PURCHASE_DEDUP) {
      const raw = await env.PURCHASE_DEDUP.get(`emqctx_xid_${xidLookup}`);
      if (raw) {
        const c = JSON.parse(raw);
        // Recency gate: even though KV TTL = 30d, the user-id identity drift risk
        // (shared accounts, family member buys for parent etc.) compounds over time.
        // 90d ceiling on the *value* timestamp is a second-layer guard; KV TTL alone
        // could be reset to 180d later by mistake and this still holds.
        const ageMs = c.t ? Date.now() - Number(c.t) : 0;
        if (ageMs >= 0 && ageMs <= 90 * 24 * 3600 * 1000) {
          if (!userData.em && c.em) userData.em = [c.em];
          if (!userData.ph && c.ph) userData.ph = [c.ph];
          if (!userData.fn && c.fn) userData.fn = [c.fn];
          if (!userData.ln && c.ln) userData.ln = [c.ln];
          if (!userData.ct && c.ct) userData.ct = [c.ct];
          if (!userData.st && c.st) userData.st = [c.st];
          if (!userData.zp && c.zp) userData.zp = [c.zp];
          if (!userData.country && c.country) userData.country = c.country;
        }
      }
    }
  } catch (_) { /* fail-open: any KV error keeps event as-is */ }

  const customData = {};
  if (cd.product_id) customData.content_ids = [String(cd.product_id)];
  if (Array.isArray(cd.content_ids)) {
    // [5/31] Cap at 100 IDs — Meta CAPI accepts arrays but charges weight on dedup; cart size >100 is almost certainly a bug or scraper. Also cap each ID at 40 chars.
    customData.content_ids = cd.content_ids.slice(0, 100).map(v => String(v).slice(0, 40));
  }
  if (cd.content_type) customData.content_type = cd.content_type;
  // Strict numeric: Number + finite + > 0, round to 2 dp (Meta rejects NaN/Infinity/0/string).
  // Sanity cap at 50K — Lighom max cart is ~$20K (luxury chandelier × multi-qty); anything
  // higher is almost certainly a unit-conversion bug (cents-as-dollars / variant-sum / fbq race)
  // and would pollute ROAS calculation if delivered to Meta.
  if (typeof cd.value === 'number' && isFinite(cd.value) && cd.value > 0 && cd.value <= 50000) {
    customData.value = Math.round(cd.value * 100) / 100;
  }
  // Strict ISO 4217: 3 uppercase letters only
  if (typeof cd.currency === 'string' && /^[A-Z]{3}$/.test(cd.currency.toUpperCase())) {
    customData.currency = cd.currency.toUpperCase();
  }
  // Meta rejects (error_subcode 2804023) if value is present without currency. Drop value
  // to keep the event acceptable rather than failing the whole send.
  if (customData.value != null && !customData.currency) {
    delete customData.value;
  }
  // Validate contents items: each MUST have id (Meta rejects with error_subcode 2804008).
  // Drop invalid items; if all dropped, omit the field entirely (catalog match falls back to content_ids).
  if (cd.contents && Array.isArray(cd.contents)) {
    const validContents = cd.contents
      .filter((it) => it && typeof it === 'object' && it.id != null && String(it.id).length > 0)
      .map((it) => {
        const out = { id: String(it.id) };
        if (typeof it.quantity === 'number' && it.quantity > 0) out.quantity = it.quantity;
        if (typeof it.item_price === 'number' && isFinite(it.item_price)) out.item_price = it.item_price;
        if (it.title) out.title = String(it.title).slice(0, 100);
        if (it.brand) out.brand = String(it.brand).slice(0, 100);
        if (it.category) out.category = String(it.category).slice(0, 100);
        if (it.delivery_category) out.delivery_category = String(it.delivery_category);
        if (it.item_group_id) out.item_group_id = String(it.item_group_id);
        return out;
      });
    if (validContents.length > 0) customData.contents = validContents;
  }
  if (typeof cd.num_items === 'number' && isFinite(cd.num_items) && cd.num_items > 0) {
    customData.num_items = cd.num_items;
  }
  if (cd.order_id) customData.order_id = String(cd.order_id);
  // predicted_ltv removed — placeholder values cause Meta to flag as invalid.
  // delivery_category removed — Lighom doesn't fit Meta enum (in_store/curbside/home_delivery).
  // Search/category metadata — cap length to defend against pathological queries / DOM-scrape leaks
  if (cd.search_string) customData.search_string = String(cd.search_string).slice(0, 200);
  if (cd.content_name) customData.content_name = String(cd.content_name).slice(0, 200);
  if (cd.content_category) customData.content_category = String(cd.content_category).slice(0, 100);

  // PII whitelist by event_name. Meta penalizes "duplicate phone/email" when 1 returning
  // user fires same hash across many low-funnel events (e.g. 1 user → 250 ViewCategory →
  // 50%+ dup warning). Strip personal identifiers from low-intent events; keep CF geo +
  // ip/ua + fbc/fbp + external_id (those don't cause duplicate noise).
  // 2026-05-25 — added after Meta "duplicate Phone numbers" warning on ViewCategory.
  const HIGH_INTENT_EVENTS = new Set([
    'AddToCart','InitiateCheckout','AddPaymentInfo','Purchase',
    'Subscribe','Lead','CompleteRegistration','Contact'
  ]);
  if (!HIGH_INTENT_EVENTS.has(body.event_name)) {
    delete userData.em;
    delete userData.ph;
    delete userData.fn;
    delete userData.ln;
    delete userData.db;
    delete userData.ge;
  }

  const metaEvent = {
    event_name: body.event_name,
    event_time: eventTime,
    event_id: body.event_id,
    action_source: 'website',
    event_source_url: body.page_url || '',
    user_data: userData,
    custom_data: customData,
  };

  // [2026-05-26] ?debug=1 dry-run: return what Worker WOULD send to Meta + Pinterest
  // without actually firing CAPI/KV/BQ. Inspect field hashing per-platform spec.
  // Only enabled when WORKER_DEBUG_ENABLE=1 (staging env), no-op in prod.
  if (env.WORKER_DEBUG_ENABLE === '1' && new URL(request.url).searchParams.get('debug') === '1') {
    const epikDbg = (ud.epik && ud.epik.length >= 20 && !/test|debug|dev|sample|enricher/i.test(ud.epik)) ? ud.epik : '';
    const pinBody = await buildPinterestBody(metaEvent, epikDbg);
    return jsonResp(200, {
      ok: true,
      debug: true,
      note: 'dry-run: no Meta/Pin/GA4/BQ/KV writes',
      meta_event: metaEvent,
      pinterest_event: pinBody.event
    }, request);
  }

  // GA4 client_id: prefer browser-passed _ga cookie value (so Worker MP shares
  // session with browser gtag), then external_id, then event_id-derived fallback.
  // _ga cookie format: "GA1.1.<random>.<timestamp>" — GA4 wants "<random>.<timestamp>".
  // [2026-05-26] Array-aware: if ud.external_id is Array (future Meta-SDK-style multi-ID),
  // take first element only — GA4 user_id expects single string.
  const gaClientIdRaw = ud.ga_cookie || body.ga_cookie || '';
  const extIdSingle = Array.isArray(ud.external_id) ? ud.external_id[0] : ud.external_id;
  const gaClientId = gaClientIdRaw
    ? gaClientIdRaw.replace(/^GA\d+\.\d+\./, '')
    : (extIdSingle || `cid_${body.event_id}`);

  // Purchase events MUST have valid value+currency or Meta flags as wrong format.
  // Skip Meta send for invalid Purchase rather than sending bad data that hurts ROAS / ad performance.
  const isPurchase = body.event_name === 'Purchase';
  const purchaseValid = !isPurchase || (typeof customData.value === 'number' && customData.currency);
  // Catalog-matched events MUST have content_ids; otherwise Meta diagnostics flags
  // "missing content IDs" (warning #1) and EMQ counts the event as unmatched.
  // Skip CAPI send entirely — better no event than a broken event.
  const catalogEvents = new Set(['ViewContent','AddToCart','InitiateCheckout','AddPaymentInfo','Purchase']);
  const needsContentIds = catalogEvents.has(body.event_name);
  const hasContentIds = Array.isArray(customData.content_ids) && customData.content_ids.length > 0;
  const contentIdsValid = !needsContentIds || hasContentIds;
  // Bot detection — UA / ASN / CF threat score. When detected, BQ row is still
  // written (with is_bot=true) for analysis, but CAPI fanout to Meta/Pinterest/Google
  // is skipped to keep EMQ scoring clean.
  const bot = detectBot(request);

  // Layer-1 Purchase dedup (per-platform — see [2026-05-26] block below):
  // same order_id Purchase fired multiple times (refresh / multi-tab / bot crawl /
  // owner re-opening real customers' thank-you pages across DAYS to test). Keep first,
  // drop rest. 5/19: TTL 24h→90d — owner test-retests span many days (5/8–5/18 seen),
  // 24h let cross-day retests through and re-inflate all 3 platforms. A given order_id
  // only ever has ONE legitimate Purchase; any same order_id within 90d = duplicate,
  // so longer TTL never blocks a real sale. 5/9 obs: LIG100131863 fired 5x/35min/3
  // devices/2 countries; same-order repeats are the rule, not the exception.
  // [2026-05-26] Per-platform dedup keys: `purchase_order_<id>_<meta|pinterest|ga4>`
  // Old shared key `purchase_order_<id>` blocked all platforms when ANY first writer
  // claimed it (5/22 webhook started writing it on GA4-only success → blocked all
  // browser Meta+Pin fires). Per-platform isolates: webhook writes _ga4, browser
  // Meta block writes _meta, browser Pin block writes _pinterest — each only blocks
  // its own platform's revisit/race. Old key still readable in KV but no longer
  // checked; expires naturally at 90d TTL.
  const fanoutSetDefault = new Set(['meta', 'pinterest', 'ga4']);
  const fanoutSet = Array.isArray(body.fanout)
    ? new Set(body.fanout.map((s) => String(s).toLowerCase()))
    : fanoutSetDefault;
  const orderIdForDedup = isPurchase && cd.order_id ? String(cd.order_id) : null;
  const dup = { meta: false, pinterest: false, ga4: false };
  const dupSeen = { meta: null, pinterest: null, ga4: null };
  if (orderIdForDedup && env.PURCHASE_DEDUP) {
    const nowIso = new Date().toISOString();
    await Promise.all(['meta', 'pinterest', 'ga4'].map(async (p) => {
      if (!fanoutSet.has(p)) return;
      const kvKey = `purchase_order_${orderIdForDedup}_${p}`;
      try {
        const prev = await env.PURCHASE_DEDUP.get(kvKey);
        if (prev) { dup[p] = true; dupSeen[p] = prev; }
        else { await env.PURCHASE_DEDUP.put(kvKey, nowIso); }
      } catch (e) {
        console.error('PURCHASE_DEDUP error:', String(e).slice(0, 200));
      }
    }));
  }

  // Selective fanout: clients can request a subset of platforms via body.fanout.
  // Allows splitting Meta+GA4 (immediate) from Pinterest (deferred 200ms for pintrk
  // hijack capture) without affecting Meta CAPI delivery latency.
  // Empty array `body.fanout: []` is honored as "no platform sends" — used by the
  // PinterestHijackTelemetry events that only need a BQ row, not platform delivery.

  // [2026-05-27] Meta attribution gate — only fanout to Meta when the event could
  // plausibly be attributed to a Meta ad. Drops SEO/direct/Pinterest-only visitors'
  // PV/VC/ATC from Meta CAPI, raising dataset fbc coverage 52% → ~95%+.
  // EM's "low fbc coverage" warning is dataset-level — sending un-attributable
  // events pollutes the score. Purchase always fanout (highest-value, always need
  // it for ROAS calc) — gate is for top-of-funnel only.
  // NEVER fabricates fbc/fbp — only filters.
  // Reuses existing `ud` (line 61), `utm` (line 65). Prior external_id block declares
  // `isPurchaseEvent` but in a tighter scope — re-declare here for fanout gate scope.
  const _isPurchaseEvent = body.event_name === 'Purchase';
  const _hasFbc = typeof ud.fbc === 'string' && /^fb\.[12]\.\d+\.\w+/.test(ud.fbc);
  const _hasFbp = typeof ud.fbp === 'string' && /^fb\.\d+\.\d+\.\d+/.test(ud.fbp);
  const _hasEm  = Array.isArray(userData.em) ? userData.em.length > 0 : (typeof userData.em === 'string' && /^[a-f0-9]{64}$/i.test(userData.em));
  const _hasPh  = Array.isArray(userData.ph) ? userData.ph.length > 0 : (typeof userData.ph === 'string' && /^[a-f0-9]{64}$/i.test(userData.ph));
  const _utmMeta = /^(meta|facebook|fb|ig|instagram)/i.test(String(utm.source || ''));
  const _hasMetaAttribution = _hasFbc || _hasFbp || _hasEm || _hasPh || _utmMeta;

  const wantMeta = fanoutSet.has('meta') && !bot.is_bot && !dup.meta && (_hasMetaAttribution || _isPurchaseEvent);
  const wantPinterest = fanoutSet.has('pinterest') && !bot.is_bot && !dup.pinterest;
  const wantGa4 = fanoutSet.has('ga4') && !bot.is_bot && !dup.ga4;

  const metaPromise = wantMeta
    ? ((purchaseValid && contentIdsValid)
        ? metaSend(env, metaEvent)
        : Promise.resolve({ ok: false, skipped: true, reason: !purchaseValid ? 'purchase_missing_value_or_currency' : 'missing_content_ids' }))
    : Promise.resolve({ ok: false, skipped: true, reason: dup.meta ? `dedup_first_seen:${dupSeen.meta}` : (bot.is_bot ? `bot_filtered:${bot.reason}` : (!_hasMetaAttribution && !_isPurchaseEvent ? 'no_meta_attribution' : 'fanout_excluded')) });

  // For Pinterest, allow client to override event_id with the value Shopline native
  // pintrk used (e.g. "PageView_xxx" / "ViewItem_xxx"). Without this, Worker CAPI events
  // and Pinterest tag events have different event_ids → Pinterest can't dedup → reports
  // duplicate counts as "大量错误请求" warning. Body is allowed to include
  // `pinterest_event_id` (string) which we substitute into a copy of metaEvent for the
  // Pinterest fanout only — Meta + GA4 still use the canonical body.event_id.
  const pinterestEventId = body.pinterest_event_id ? String(body.pinterest_event_id) : null;
  const pinterestEvent = pinterestEventId
    ? { ...metaEvent, event_id: pinterestEventId }
    : metaEvent;

  // epik gate: reject test-marked Pinterest click IDs (real epik is 20+ char opaque)
  const epikClean = (ud.epik && ud.epik.length >= 20 && !/test|debug|dev|sample|enricher/i.test(ud.epik)) ? ud.epik : '';
  const pinterestPromise = wantPinterest
    ? pinterestSend(env, pinterestEvent, epikClean)
    : Promise.resolve({ ok: false, skipped: true, reason: dup.pinterest ? `dedup_first_seen:${dupSeen.pinterest}` : (bot.is_bot ? `bot_filtered:${bot.reason}` : 'fanout_excluded') });

  const ga4Promise = wantGa4
    ? ga4mpSend(env, metaEvent, gaClientId)
    : Promise.resolve({ ok: false, skipped: true, reason: dup.ga4 ? `dedup_first_seen:${dupSeen.ga4}` : (bot.is_bot ? `bot_filtered:${bot.reason}` : 'fanout_excluded') });

  const [metaSettled, pinterestSettled, ga4Settled] = await Promise.allSettled([
    metaPromise,
    pinterestPromise,
    ga4Promise,
  ]);

  const meta = settledOr(metaSettled);
  const pinterest = settledOr(pinterestSettled);
  const google = settledOr(ga4Settled);

  // Build BQ row for engagements table
  const bqRow = {
    event_id: body.event_id,
    event_time: new Date(eventTime * 1000).toISOString(),
    event_name: body.event_name,
    page_type: body.page_type || null,
    page_url: body.page_url || null,
    page_path: body.page_path || null,
    user_id: extIdSingle ? String(extIdSingle) : null,
    email_hashed: arr0(userData.em),
    // [2026-05-21] PII field presence monitoring (BQ doesn't store the hashes
    // themselves to keep PII surface small + storage cheap; just bool flags so
    // we can measure EMQ field coverage from BQ without rounding-trip to Meta).
    ph_present: !!arr0(userData.ph),
    fn_present: !!arr0(userData.fn),
    ln_present: !!arr0(userData.ln),
    ct_present: !!arr0(userData.ct),
    st_present: !!arr0(userData.st),
    zp_present: !!arr0(userData.zp),
    country_present: !!(userData.country && (Array.isArray(userData.country) ? userData.country[0] : userData.country)),
    fbc: ud.fbc || null,
    fbp: ud.fbp || null,
    epik: ud.epik || null,
    ttclid: ud.ttclid || null,
    msclkid: ud.msclkid || null,
    client_ip: cfIp || null,
    /* 5/31 fix: BQ analytics bug — was `ud.client_ua || null` which only read body field; Meta CAPI got correct UA via line 122 fallback but BQ showed NULL for Lead/ATC/TimeOn180s that don't send body.client_ua. Now reads post-fallback userData.client_user_agent. */
    client_ua: userData.client_user_agent || null,
    product_id: cd.product_id ? String(cd.product_id) : (Array.isArray(cd.content_ids) && cd.content_ids[0] ? String(cd.content_ids[0]) : null),
    value: typeof cd.value === 'number' ? cd.value : null,
    currency: cd.currency || null,
    utm_source: utm.source || null,
    utm_medium: utm.medium || null,
    utm_campaign: utm.campaign || null,
    data_quality: cd.data_quality || null,
    meta_capi_status: meta.ok ? 'ok' : (meta.skipped ? 'skipped' : 'fail'),
    meta_capi_response: JSON.stringify(meta).slice(0, 1000),
    pinterest_status: pinterest.ok ? 'ok' : (pinterest.skipped ? 'skipped' : 'fail'),
    pinterest_response: JSON.stringify(pinterest).slice(0, 1000),
    google_status: google.ok ? 'ok' : (google.skipped ? 'skipped' : 'fail'),
    google_response: JSON.stringify(google).slice(0, 1000),
    is_bot: bot.is_bot,
    bot_reason: bot.reason || null,
    bot_asn: bot.asn || null,
    is_duplicate: dup.meta || dup.pinterest || dup.ga4,
    duplicate_first_seen: dupSeen.meta || dupSeen.pinterest || dupSeen.ga4 || null,
  };

  // Skip BQ when client requests it (e.g., the deferred Pinterest-only POST in the
  // 2-fetch dedup pattern would otherwise double-write the event row).
  const skipBq = body.skip_bq === true || body.skip_bq === 'true';
  let bq;
  try {
    bq = (env.GCP_SA_JSON && !skipBq)
      ? await bqInsertRow(env, env.BQ_DATASET || 'lighom_capi', 'engagements', bqRow, body.event_id)
      : { ok: false, skipped: true, reason: skipBq ? 'skip_bq_requested' : 'GCP_SA_JSON not set' };
  } catch (err) {
    bq = { ok: false, error: String(err).slice(0, 300) };
  }

  // serverEventId bridge: thank-you SEID Bridge block POSTs the Shopline
  // __PRELOAD_STATE__.serverEventId + appOrderSeq here. Persist by appOrderSeq so
  // the order webhook can set Meta event_id = serverEventId → dedups against native
  // fbq Purchase (which uses serverEventId). Fail-open, additive.
  try {
    if (body.event_name === 'SEIDCapture' && cd.order_id && cd.seid && env.PURCHASE_DEDUP) {
      await env.PURCHASE_DEDUP.put(`seid_${cd.order_id}`, String(cd.seid), { expirationTtl: 2592000 });
    }
  } catch (e) {
    console.error('seid put error:', String(e).slice(0, 140));
  }

  // EMQ context source for the order webhook. Funnel events read fbp/fbc/ip/ua
  // late in the funnel (after Capture/Enricher mint) so they carry these reliably,
  // unlike buy-now/express orders whose webhook lacks browser context. Persist by
  // hashed email (same sha256(lowercase+trim) the webhook computes → keys align)
  // so capi.js /capi/order can backfill missing identifiers. Additive + fail-open:
  // never alters this event's own send; KV error is swallowed.
  try {
    const emH = arr0(userData.em);
    const FUNNEL_EMQ = new Set(['InitiateCheckout', 'AddPaymentInfo', 'AddToCart', 'ViewContent']);
    if (emH && userData.fbp && FUNNEL_EMQ.has(body.event_name) && env.PURCHASE_DEDUP && !bot.is_bot) {
      await env.PURCHASE_DEDUP.put(`emqctx_${emH}`, JSON.stringify({
        fbp: userData.fbp || '',
        fbc: userData.fbc || '',
        ip: userData.client_ip_address || '',
        ua: userData.client_user_agent || '',
        xid: arr0(userData.external_id) || '',
        t: Date.now(),
      }), { expirationTtl: 2592000 });
    }
  } catch (e) {
    console.error('emqctx put error:', String(e).slice(0, 160));
  }

  // [2026-05-21] Browser-side xid WRITE intentionally NOT done here.
  // events.js cannot distinguish (post-hash) whether the incoming extid is a
  // Shopline customer.id (server-verified person) or an Enricher device UUID
  // (browser-scoped, vulnerable to shared-device identity drift). Writing from
  // here would store Person A's em under a device UUID — next anonymous browser
  // session from Person B on same device would inherit A's em on PV (identity
  // mis-attribution). Index writes are restricted to capi.js webhook path which
  // uses order.customer.id (Shopline-side, always real). Result: only logged-in
  // returning customers (extid == customer.id) hit the index; anonymous device
  // UUIDs never match → no false enrichment.

  return jsonResp(200, {
    ok: meta.ok || pinterest.ok || google.ok,
    meta, pinterest, google, bigquery: bq,
    event_id: body.event_id,
  }, request);
}

/* metaCustomEventSend merged into meta.js metaSend(env, event) — D3 consolidation, 5/31 */

/* settledOr moved to utils.js (D2 consolidation, 5/31) */

function arr0(v) {
  return Array.isArray(v) && v.length ? v[0] : null;
}

async function maybeHashArr(input) {
  // If input is already hashed array of 64-char hex, return as-is.
  // If string and looks plain, hash it. Returns array form expected by Meta CAPI.
  if (Array.isArray(input)) return input.every(s => /^[a-f0-9]{64}$/.test(String(s))) ? input : await Promise.all(input.map(s => sha256Hex(String(s).toLowerCase().trim())));
  const s = String(input).toLowerCase().trim();
  if (/^[a-f0-9]{64}$/.test(s)) return [s];
  return [await sha256Hex(s)];
}

/* sha256Hex moved to crypto.js (D1 consolidation, 5/31) */

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.test(origin) ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResp(status, body, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(request ? corsHeaders(request) : {}),
    },
  });
}
