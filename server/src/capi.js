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
 *   POST /capi/order                   ← Shopline webhook receiver
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
 */

const META_API_VERSION_DEFAULT = 'v21.0';

// Entry — invoked from src/index.js routing
export async function handleCapi(request, env, url) {
  if (url.pathname === '/capi/order' && request.method === 'POST') {
    return handleOrderWebhook(request, env);
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

  const event = await buildMetaEvent(o, request);
  const apiVersion = env.META_API_VERSION || META_API_VERSION_DEFAULT;
  const endpoint = `https://graph.facebook.com/${apiVersion}/${env.META_PIXEL_ID}/events`;

  const payload = { data: [event] };
  if (env.META_TEST_EVENT_CODE) payload.test_event_code = env.META_TEST_EVENT_CODE;

  let metaResp;
  try {
    metaResp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.META_CAPI_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return jsonResp(502, { ok: false, error: 'meta_fetch_failed', detail: String(err) });
  }

  const respText = await metaResp.text();
  let respJson = null;
  try { respJson = JSON.parse(respText); } catch {}

  // Always 200 to Shopline so it doesn't retry storms
  // (Meta-side errors logged to response body for debugging — not visible to Shopline)
  return jsonResp(200, {
    ok: metaResp.ok,
    meta_status: metaResp.status,
    meta_response: respJson || respText.slice(0, 500),
    event_id: event.event_id,
    matched_keys: Object.keys(event.user_data || {}).filter(k => event.user_data[k]),
  });
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
  });
}

// ===== Meta event builder =====

async function buildMetaEvent(order, request) {
  const noteAttrs = arrayToMap(order.note_attributes || order.noteAttributes || []);

  // Customer fields (Shopline order/created)
  const customer = order.customer || {};
  const shippingAddr = order.shipping_address || order.shippingAddress || customer.default_address || {};
  const billingAddr = order.billing_address || order.billingAddress || {};
  const clientDetails = order.client_details || order.clientDetails || {};

  const email = (order.email || customer.email || '').toLowerCase().trim();
  const phone = normPhone(order.phone || customer.phone || shippingAddr.phone || '');
  const firstName = (shippingAddr.first_name || customer.first_name || '').toLowerCase().trim();
  const lastName = (shippingAddr.last_name || customer.last_name || '').toLowerCase().trim();
  const city = (shippingAddr.city || '').toLowerCase().replace(/\s/g, '');
  const stateCode = (shippingAddr.province_code || shippingAddr.province || '').toLowerCase().replace(/\s/g, '');
  const zip = (shippingAddr.zip || '').toLowerCase().replace(/\s/g, '').slice(0, 5);
  const country = (shippingAddr.country_code || shippingAddr.country || '').toLowerCase().slice(0, 2);
  const externalId = String(customer.id || customer.user_id || order.user_id || '');

  // Browser-set fields from cart attributes
  const fbc = noteAttrs._fbc || '';
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

  // Custom data
  const lineItems = order.line_items || order.lineItems || [];
  const contents = lineItems.map(li => ({
    id: String(li.variant_id || li.variantId || li.product_id || li.productId || li.sku || ''),
    quantity: Number(li.quantity) || 1,
    item_price: Number(li.price || li.unit_price || 0),
  })).filter(c => c.id);

  const totalValue = Number(
    order.current_total_price ?? order.total_price ?? order.totalPrice ?? order.subtotal_price ?? 0
  );

  const customData = {
    currency: (order.currency || order.presentment_currency || 'USD').toUpperCase(),
    value: totalValue,
    content_ids: contents.map(c => c.id),
    content_type: 'product',
    num_items: contents.reduce((s, c) => s + c.quantity, 0),
    contents,
    order_id: String(order.id || order.order_id || ''),
  };

  const eventTime = parseEventTime(order.created_at || order.createdAt) || Math.floor(Date.now() / 1000);

  // event_id MUST match browser Pixel's eventID for dedup.
  // Browser side currently uses pixel's auto eventID. Best deterministic dedup
  // anchor: order id. We use order id as event_id; browser Pixel Purchase event
  // (Shopline native fires) should also use order id as event_id.
  // If browser uses a different scheme, dedup may fail — but this is far
  // better than nothing.
  const eventId = String(order.id || order.order_id || `purchase_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

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
