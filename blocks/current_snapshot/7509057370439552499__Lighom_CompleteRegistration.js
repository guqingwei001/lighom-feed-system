<script>
/* Lighom GTM CompleteRegistration v2 — actually fires the event.
   v1 was dead code (only dataLayer.push, no fbq/Worker, GTM container empty).
   v2 captures register-form fields → sessionStorage → on next pageload fires
   fbq('track', 'CompleteRegistration', ...) + Worker /capi/event with shared eventID.
   Created 2026-05-09. */
(function(){
  if (window.__lighom_cr_v2) return;
  window.__lighom_cr_v2 = true;
  if (window.LighomUtil && window.LighomUtil.isBot && window.LighomUtil.isBot()) return; /* D4 5/31 */

  function ck(n){ var m=document.cookie.match(new RegExp("(?:^|;\\s*)"+n+"=([^;]+)")); return m?decodeURIComponent(m[1]):""; }

  /* Phase 1: capture register form submissions */
  document.addEventListener('submit', function(e){
    var form = e.target;
    if (!form || !form.action) return;
    var sig = ((form.action||'')+' '+(form.className||'')+' '+(form.id||'')).toLowerCase();
    if (!/register|signup|sign-up|customer.*create|account.*create/.test(sig)) return;
    try {
      var em = form.querySelector('input[type="email"], input[name*="email" i]');
      var ph = form.querySelector('input[type="tel"], input[name*="phone" i]');
      var fn = form.querySelector('input[name*="first" i], input[name*="fname" i]');
      var ln = form.querySelector('input[name*="last" i], input[name*="lname" i]');
      sessionStorage.setItem('lighom_just_registered', '1');
      if (em && em.value) sessionStorage.setItem('lighom_reg_em', em.value);
      if (ph && ph.value) sessionStorage.setItem('lighom_reg_ph', ph.value);
      if (fn && fn.value) sessionStorage.setItem('lighom_reg_fn', fn.value);
      if (ln && ln.value) sessionStorage.setItem('lighom_reg_ln', ln.value);
    } catch(err){}
  }, true);

  /* Phase 2: on next pageload after register, fire the event */
  if (sessionStorage.getItem('lighom_just_registered') !== '1') return;
  sessionStorage.removeItem('lighom_just_registered');
  var em = sessionStorage.getItem('lighom_reg_em') || '';
  var ph = sessionStorage.getItem('lighom_reg_ph') || '';
  var fn = sessionStorage.getItem('lighom_reg_fn') || '';
  var ln = sessionStorage.getItem('lighom_reg_ln') || '';
  sessionStorage.removeItem('lighom_reg_em');
  sessionStorage.removeItem('lighom_reg_ph');
  sessionStorage.removeItem('lighom_reg_fn');
  sessionStorage.removeItem('lighom_reg_ln');

  /* Cache raw user_data into Enricher's globals so subsequent events also benefit. */
  try {
    window.__lighom_user_data_raw = window.__lighom_user_data_raw || {};
    if (em) window.__lighom_user_data_raw.em = em;
    if (ph) window.__lighom_user_data_raw.ph = ph;
    if (fn) window.__lighom_user_data_raw.fn = fn;
    if (ln) window.__lighom_user_data_raw.ln = ln;
    window.__lighom_user_data_pinned = true;
  } catch(e){}

  var eventId = 'cr_' + Date.now() + '_' + Math.random().toString(36).slice(2,9);
  var params = { content_name: 'account_register', status: 'completed' };

  /* Browser Pixel */
  if (typeof window.fbq === 'function') {
    try { window.fbq('track', 'CompleteRegistration', params, { eventID: eventId }); } catch(e){}
  }

  /* Worker fanout (Meta CAPI + Pinterest signup + GA4 MP sign_up) */
  try {
    fetch('https://lighom-feed-server.dikecarmem750.workers.dev/capi/event', {
      method: 'POST', credentials: 'omit', keepalive: true,
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        event_name: 'CompleteRegistration', event_id: eventId,
        event_time: Math.floor(Date.now()/1000),
        page_url: location.href, page_path: location.pathname,
        page_type: 'register',
        user_data: {
          em: em, ph: ph, fn: fn, ln: ln,
          fbc: ck('_fbc'), fbp: ck('_fbp'),
          epik: ck('_epik'), ttclid: ck('_lighom_ttclid') || ck('_ttp'), /* 5/31 ttclid cookie rename (#9) — primary _lighom_ttclid, fallback _ttp for sessions captured pre-rename */
          ga_cookie: ck('_ga'), client_ua: navigator.userAgent
        },
        custom_data: params,
        utm: (window.LighomUtil && window.LighomUtil.utm) ? window.LighomUtil.utm() : { source: '', medium: '', campaign: '' } /* D6 5/31 */
      })
    }).catch(function(){});
  } catch(e){}
})();
</script>