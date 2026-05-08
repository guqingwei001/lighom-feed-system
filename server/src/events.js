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

import { pinterestSend } from './pinterest.js';
import { ga4mpSend } from './ga4mp.js';
import { insertRow as bqInsertRow } from './bigquery.js';

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

  // Normalize internal "metaEvent" structure so we can reuse pinterestSend / ga4mpSend.
  const ud = body.user_data || {};
  const cd = body.custom_data || {};
  const utm = body.utm || {};
  const eventTime = body.event_time || Math.floor(Date.now() / 1000);

  const userData = {};
  // Hash em/ph if provided in plaintext; pass through if already hashed (64-char hex).
  if (ud.em) userData.em = await maybeHashArr(ud.em);
  if (ud.ph) userData.ph = await maybeHashArr(ud.ph);
  if (ud.fn) userData.fn = await maybeHashArr(ud.fn);
  if (ud.ln) userData.ln = await maybeHashArr(ud.ln);
  if (ud.external_id) userData.external_id = await maybeHashArr(String(ud.external_id).toLowerCase());
  if (ud.fbc) userData.fbc = ud.fbc;
  if (ud.fbp) userData.fbp = ud.fbp;
  // Prefer explicit client_ua in body; fall back to request's User-Agent header
  const ua = ud.client_ua || request.headers.get('User-Agent') || '';
  if (ua) userData.client_user_agent = ua;
  // Use Cloudflare's built-in client IP detection
  const cfIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || '';
  if (cfIp) userData.client_ip_address = cfIp;

  const customData = {};
  if (cd.product_id) customData.content_ids = [String(cd.product_id)];
  if (Array.isArray(cd.content_ids)) customData.content_ids = cd.content_ids.map(String);
  if (cd.content_type) customData.content_type = cd.content_type;
  if (typeof cd.value === 'number') customData.value = cd.value;
  if (cd.currency) customData.currency = cd.currency;
  if (cd.contents && Array.isArray(cd.contents)) customData.contents = cd.contents;

  const metaEvent = {
    event_name: body.event_name,
    event_time: eventTime,
    event_id: body.event_id,
    action_source: 'website',
    event_source_url: body.page_url || '',
    user_data: userData,
    custom_data: customData,
  };

  // 3-way fanout: Meta CAPI + Pinterest CAPI + GA4 MP
  const [metaSettled, pinterestSettled, ga4Settled] = await Promise.allSettled([
    metaCustomEventSend(env, metaEvent),
    pinterestSend(env, metaEvent, ud.epik || ''),
    ga4mpSend(env, metaEvent, ud.external_id || ''),
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
    user_id: ud.external_id ? String(ud.external_id) : null,
    email_hashed: arr0(userData.em),
    fbc: ud.fbc || null,
    fbp: ud.fbp || null,
    epik: ud.epik || null,
    ttclid: ud.ttclid || null,
    msclkid: ud.msclkid || null,
    client_ip: cfIp || null,
    client_ua: ud.client_ua || null,
    product_id: cd.product_id ? String(cd.product_id) : (Array.isArray(cd.content_ids) && cd.content_ids[0] ? String(cd.content_ids[0]) : null),
    value: typeof cd.value === 'number' ? cd.value : null,
    currency: cd.currency || null,
    utm_source: utm.source || null,
    utm_medium: utm.medium || null,
    utm_campaign: utm.campaign || null,
    meta_capi_status: meta.ok ? 'ok' : (meta.skipped ? 'skipped' : 'fail'),
    meta_capi_response: JSON.stringify(meta).slice(0, 1000),
    pinterest_status: pinterest.ok ? 'ok' : (pinterest.skipped ? 'skipped' : 'fail'),
    pinterest_response: JSON.stringify(pinterest).slice(0, 1000),
    google_status: google.ok ? 'ok' : (google.skipped ? 'skipped' : 'fail'),
    google_response: JSON.stringify(google).slice(0, 1000),
  };

  let bq;
  try {
    bq = env.GCP_SA_JSON
      ? await bqInsertRow(env, env.BQ_DATASET || 'lighom_capi', 'engagements', bqRow, body.event_id)
      : { ok: false, skipped: true, reason: 'GCP_SA_JSON not set' };
  } catch (err) {
    bq = { ok: false, error: String(err).slice(0, 300) };
  }

  return jsonResp(200, {
    ok: meta.ok || pinterest.ok || google.ok,
    meta, pinterest, google, bigquery: bq,
    event_id: body.event_id,
  }, request);
}

async function metaCustomEventSend(env, event) {
  if (!env.META_PIXEL_ID || !env.META_CAPI_ACCESS_TOKEN) {
    return { ok: false, skipped: true, reason: 'meta secrets not set' };
  }
  const apiVersion = env.META_API_VERSION || 'v21.0';
  const endpoint = `https://graph.facebook.com/${apiVersion}/${env.META_PIXEL_ID}/events`;
  const payload = { data: [event] };
  if (env.META_TEST_EVENT_CODE) payload.test_event_code = env.META_TEST_EVENT_CODE;

  let r;
  try {
    r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.META_CAPI_ACCESS_TOKEN}` },
      body: JSON.stringify(payload),
    });
  } catch (err) { return { ok: false, error: 'fetch_failed', detail: String(err).slice(0, 300) }; }
  const txt = await r.text();
  let body = null;
  try { body = JSON.parse(txt); } catch {}
  return { ok: r.ok, status: r.status, response: body || txt.slice(0, 500) };
}

function settledOr(s) {
  return s.status === 'fulfilled' ? s.value : { ok: false, error: String(s.reason).slice(0, 300) };
}

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

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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
