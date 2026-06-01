/* Shared Meta CAPI sender — used by capi.js (/capi/order webhook path) and
   events.js (/capi/event browser-beacon path). Consolidates 2 prior copies:
   capi.js metaSend(endpoint, token, payload) and events.js
   metaCustomEventSend(env, event). Both produced identical Meta requests
   for the same event; consolidation moves URL/payload construction inside
   so call sites just pass (env, event).

   D3 consolidation, 2026-05-31. Pre-consolidation diff confirmed:
   - Same endpoint pattern: graph.facebook.com/{apiVersion}/{pixelId}/events
   - Same payload shape: {data: [event], test_event_code?: env.META_TEST_EVENT_CODE}
   - Same headers: Content-Type + Authorization: Bearer
   - Same response parsing + return shape
   - Diff only in error label ('meta_fetch_failed' vs 'fetch_failed') → using
     'fetch_failed' (events.js prior version) for consistency. Consumers
     check result.ok boolean; error label is BQ-log content only. */

export const META_API_VERSION_DEFAULT = 'v21.0';

export async function metaSend(env, event) {
  if (!env.META_PIXEL_ID || !env.META_CAPI_ACCESS_TOKEN) {
    return { ok: false, skipped: true, reason: 'meta secrets not set' };
  }
  const apiVersion = env.META_API_VERSION || META_API_VERSION_DEFAULT;
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
  } catch (err) {
    return { ok: false, error: 'fetch_failed', detail: String(err).slice(0, 300) };
  }
  const txt = await r.text();
  let body = null;
  try { body = JSON.parse(txt); } catch {}
  return { ok: r.ok, status: r.status, response: body || txt.slice(0, 500) };
}
