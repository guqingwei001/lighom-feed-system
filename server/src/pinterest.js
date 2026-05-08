/**
 * Pinterest Conversions API relay (Worker → api.pinterest.com).
 *
 * Endpoint: POST https://api.pinterest.com/v5/ad_accounts/{ad_account_id}/events
 *
 * Required env:
 *   PINTEREST_ACCESS_TOKEN     long-lived bearer (Pinterest Business → Conversion Access Token)
 *   PINTEREST_AD_ACCOUNT_ID    e.g. "549755891234"
 *
 * Optional:
 *   PINTEREST_TEST_EVENT_CODE  test_metadata.test_event_code for Events Manager test mode
 *
 * Pinterest standard event names: page_visit / view_category / search /
 * add_to_cart / checkout / lead / signup / watch_video / custom.
 * Purchase → "checkout".
 */

export async function pinterestSend(env, metaEvent, clickIdEpik) {
  if (!env.PINTEREST_ACCESS_TOKEN || !env.PINTEREST_AD_ACCOUNT_ID) {
    return { ok: false, skipped: true, reason: 'pinterest secrets not set' };
  }

  // Translate Meta-style event name → Pinterest standard event
  const eventName = metaEventToPinterest(metaEvent.event_name);

  // Pinterest user_data — same SHA-256 hashed fields as Meta. Reuse hashes from
  // the already-built Meta event (single source of truth).
  const ud = metaEvent.user_data || {};
  const userData = {};
  if (ud.em) userData.em = ud.em;
  if (ud.ph) userData.ph = ud.ph;
  if (ud.fn) userData.fn = ud.fn;
  if (ud.ln) userData.ln = ud.ln;
  if (ud.ct) userData.ct = ud.ct;
  if (ud.st) userData.st = ud.st;
  if (ud.zp) userData.zp = ud.zp;
  if (ud.country) userData.country = ud.country;
  if (ud.external_id) userData.external_id = ud.external_id;
  if (ud.client_ip_address) userData.client_ip_address = ud.client_ip_address;
  if (ud.client_user_agent) userData.client_user_agent = ud.client_user_agent;
  // Pinterest click_id (singular, plain — comes from _epik cookie via cart attrs)
  if (clickIdEpik) userData.click_id = clickIdEpik;

  const cd = metaEvent.custom_data || {};
  const customData = {};
  if (cd.currency) customData.currency = cd.currency;
  if (typeof cd.value === 'number') customData.value = String(cd.value);
  if (Array.isArray(cd.content_ids)) customData.content_ids = cd.content_ids.map(String);
  // Pinterest requires contents[*].item_price as STRING (Meta uses number)
  if (Array.isArray(cd.contents)) customData.contents = cd.contents.map(c => ({
    id: String(c.id || ''),
    quantity: Number(c.quantity) || 1,
    item_price: c.item_price !== undefined ? String(c.item_price) : '0',
  }));
  if (typeof cd.num_items === 'number') customData.num_items = cd.num_items;
  if (cd.order_id) customData.order_id = cd.order_id;

  const event = {
    event_name: eventName,
    action_source: 'web',
    event_time: metaEvent.event_time,
    event_id: metaEvent.event_id,
    event_source_url: metaEvent.event_source_url,
    user_data: userData,
    custom_data: customData,
  };

  const body = { data: [event] };
  if (env.PINTEREST_TEST_EVENT_CODE) {
    body.test_metadata = { test_event_code: env.PINTEREST_TEST_EVENT_CODE };
  }

  const url = `https://api.pinterest.com/v5/ad_accounts/${env.PINTEREST_AD_ACCOUNT_ID}/events`;
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.PINTEREST_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: 'fetch_failed', detail: String(err).slice(0, 300) };
  }
  const txt = await resp.text();
  let parsed = null;
  try { parsed = JSON.parse(txt); } catch {}
  return {
    ok: resp.ok,
    status: resp.status,
    response: parsed || txt.slice(0, 500),
    event_name: eventName,
  };
}

function metaEventToPinterest(metaName) {
  const map = {
    Purchase: 'checkout',
    AddToCart: 'add_to_cart',
    ViewContent: 'page_visit',
    Search: 'search',
    Lead: 'lead',
    CompleteRegistration: 'signup',
    Subscribe: 'signup',
  };
  return map[metaName] || 'custom';
}
