/**
 * GA4 Measurement Protocol relay (server-side event → GA4 → Google Ads via link).
 *
 * Endpoint: POST https://www.google-analytics.com/mp/collect?measurement_id={id}&api_secret={s}
 *
 * Required env:
 *   GA4_MEASUREMENT_ID    "G-0K0Q3MV1JE"
 *   GA4_API_SECRET        from GA4 admin → Data Streams → API Secrets
 *
 * Why Measurement Protocol instead of Google Ads API:
 *   - GA4 already linked to Google Ads (existing). Server-side GA4 events
 *     auto-flow into Google Ads conversion imports.
 *   - No developer_token / OAuth refresh / customer_id needed.
 *   - Same dedup mechanism (event_id matches browser-fired Pixel/gtag).
 *
 * Note: GA4 MP doesn't accept hashed PII the way Meta CAPI does. Instead, it
 * uses `client_id` (from _ga cookie or external_id) to stitch with browser
 * sessions. We pass external_id (raw user_id) as client_id when available.
 */

export async function ga4mpSend(env, metaEvent, fallbackClientId) {
  if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET) {
    return { ok: false, skipped: true, reason: 'ga4 secrets not set' };
  }

  const ud = metaEvent.user_data || {};
  const cd = metaEvent.custom_data || {};

  // GA4 needs a stable client_id. Prefer raw user_id (from order.customer.id),
  // else fall back to event_id-derived pseudo-id.
  const clientId = fallbackClientId || `cid_${metaEvent.event_id}`;

  // Convert Meta event name → GA4 standard event name
  const eventName = metaEventToGa4(metaEvent.event_name);

  // GA4 expects items as separate array. Use Meta contents as input.
  const items = (cd.contents || []).map((c, i) => ({
    item_id: String(c.id || ''),
    item_name: String(c.name || c.id || ''),
    quantity: c.quantity || 1,
    price: typeof c.item_price === 'number' ? c.item_price : 0,
    index: i,
  }));

  const params = {
    transaction_id: cd.order_id || metaEvent.event_id,
    value: typeof cd.value === 'number' ? cd.value : 0,
    currency: cd.currency || 'USD',
    items,
    event_id: metaEvent.event_id,  // for dedup with browser gtag
    engagement_time_msec: 100,     // required for GA4 MP to count as engaged
  };

  const body = {
    client_id: clientId,
    events: [{
      name: eventName,
      params,
    }],
  };

  // Optional user_id for cross-device tracking
  if (fallbackClientId) body.user_id = fallbackClientId;

  // GA4 MP also accepts user_data with hashed em/ph for Enhanced Conversions
  // bridging to Google Ads (server-side).
  const ga4UserData = {};
  if (ud.em) ga4UserData.sha256_email_address = ud.em;
  if (ud.ph) ga4UserData.sha256_phone_number = ud.ph;
  const addr = {};
  if (ud.fn) addr.sha256_first_name = Array.isArray(ud.fn) ? ud.fn[0] : ud.fn;
  if (ud.ln) addr.sha256_last_name = Array.isArray(ud.ln) ? ud.ln[0] : ud.ln;
  if (ud.ct) addr.sha256_city = Array.isArray(ud.ct) ? ud.ct[0] : ud.ct;
  if (ud.st) addr.sha256_region = Array.isArray(ud.st) ? ud.st[0] : ud.st;
  if (ud.zp) addr.sha256_postal_code = Array.isArray(ud.zp) ? ud.zp[0] : ud.zp;
  if (ud.country) addr.sha256_country = Array.isArray(ud.country) ? ud.country[0] : ud.country;
  if (Object.keys(addr).length) ga4UserData.address = [addr];
  if (Object.keys(ga4UserData).length) body.user_data = ga4UserData;

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(env.GA4_MEASUREMENT_ID)}&api_secret=${encodeURIComponent(env.GA4_API_SECRET)}`;

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: 'fetch_failed', detail: String(err).slice(0, 300) };
  }
  // GA4 MP returns 204 on success with no body
  const txt = resp.status === 204 ? '' : await resp.text();
  return {
    ok: resp.ok,
    status: resp.status,
    event_name: eventName,
    response: txt.slice(0, 300),
  };
}

function metaEventToGa4(metaName) {
  const map = {
    Purchase: 'purchase',
    AddToCart: 'add_to_cart',
    ViewContent: 'view_item',
    Search: 'search',
    Lead: 'generate_lead',
    Subscribe: 'sign_up',
    CompleteRegistration: 'sign_up',
  };
  return map[metaName] || metaName.toLowerCase();
}
