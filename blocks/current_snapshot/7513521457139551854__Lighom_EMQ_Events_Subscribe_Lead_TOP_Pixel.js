<script>
/* Lighom EMQ Custom Events v1 - Subscribe + Lead + TimeOnPage Pixel bridge */
(function(){
  if (window.__lighom_emq_events_v1) return;
  window.__lighom_emq_events_v1 = true;
  if (window.LighomUtil && window.LighomUtil.isBot && window.LighomUtil.isBot()) return; /* D4 5/31 */
  function eid(p){ return p+"_"+Date.now()+"_"+Math.random().toString(36).slice(2,8); }
  function ccyFromCountry(c){
    /* 5/31 ccyFromCountry guard: only do lookup if input matches /^[a-z]{2}$/ — defends against PII Persist bridge writing 64-hex hashed country to cookie (then ck('_lighom_user_country') returns hash) → lookup fails → falls to USD. EU/UK returning users would mismatch real intent. */
    if (!/^[a-z]{2}$/i.test(String(c||''))) return 'USD';
    c = (c || '').toLowerCase();
    var m = { us:'USD', ca:'CAD', gb:'GBP', au:'AUD', nz:'NZD',
              de:'EUR', fr:'EUR', es:'EUR', it:'EUR', nl:'EUR', be:'EUR', at:'EUR', ie:'EUR',
              pt:'EUR', fi:'EUR', gr:'EUR', lu:'EUR', cy:'EUR', mt:'EUR', sk:'EUR', si:'EUR', ee:'EUR', lv:'EUR', lt:'EUR',
              se:'SEK', dk:'DKK', no:'NOK', is:'ISK', ch:'CHF', pl:'PLN', cz:'CZK', hu:'HUF', ro:'RON', bg:'BGN', hr:'EUR',
              jp:'JPY', kr:'KRW', sg:'SGD', hk:'HKD', tw:'TWD', cn:'CNY', my:'MYR', th:'THB', id:'IDR', ph:'PHP', vn:'VND',
              in:'INR', mx:'MXN', br:'BRL', ar:'ARS', cl:'CLP', co:'COP', za:'ZAR', ae:'AED', sa:'SAR', il:'ILS', tr:'TRY' };
    return m[c] || 'USD';
  }
  function ck(name){ try { var m = document.cookie.match('(?:^|;\\s*)'+name+'=([^;]+)'); return m ? decodeURIComponent(m[1]) : ''; } catch(e){ return ''; } }
  function pt(){ var p=location.pathname; if(/\/products\//.test(p))return"product"; if(/\/collections\/|\/categories\//.test(p))return"category"; if(/\/cart/.test(p))return"cart"; if(/\/checkout/.test(p))return"checkout"; if(p==="/"||p==="")return"home"; return"other"; }
  /* 5/31 ck dedup: removed redeclare of ck() — safe try/catch ck() at line ~20 is hoisted authoritative */
  function fire(method, name, params, evtId){
    if (typeof window.fbq === "function") { try { window.fbq(method, name, params || {}, { eventID: evtId }); } catch(e){} }
    window.dataLayer = window.dataLayer || [];
    try { window.dataLayer.push({ event: name.toLowerCase().replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase(), event_id: evtId, meta_event_name: name, page_type: pt(), ecommerce: params || {} }); } catch(e){}
    /* Worker fanout — only for Subscribe/Lead/CompleteRegistration (TimeOnPage* handled by TimeOnPage block). */
    if (name === 'Subscribe' || name === 'Lead' || name === 'CompleteRegistration') {
      try {
        /* 5/31 fix: merge raw PII (fresh form submit) into user_data so this event carries it.
           Worker hashes raw server-side; previously only hashed pool was sent so Subscribe/Lead
           events fired moments after form submit had empty em/ph (Enricher hadn't hashed yet). */
        /* D5: LighomUtil.mergeUd consolidated 5/31 (was 6 inline lines). Defensive fallback if LighomUtil missing. */
        var udOut = (window.LighomUtil && window.LighomUtil.mergeUd) ? window.LighomUtil.mergeUd() : {};
        fetch('https://lighom-feed-server.dikecarmem750.workers.dev/capi/event', {
          method: 'POST', credentials: 'omit', keepalive: true,
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            event_name: name, event_id: evtId,
            event_time: Math.floor(Date.now()/1000),
            page_url: location.href, page_path: location.pathname,
            page_type: pt(),
            fanout: name === 'Subscribe' ? ['meta','pinterest'] : ['meta'],
            user_data: Object.assign({}, udOut, {
              fbc: ck('_fbc'), fbp: ck('_fbp'), epik: ck('_epik'),
              ga_cookie: ck('_ga'), client_ua: navigator.userAgent
            }),
            custom_data: params || {},
            utm: (window.LighomUtil && window.LighomUtil.utm) ? window.LighomUtil.utm() : { source: '', medium: '', campaign: '' } /* D6 5/31 */
          })
        }).catch(function(){});
      } catch(e){}
    }
  }
  function bindSubscribe(){
    var sels = ['form[action*="subscribe" i]','form[action*="newsletter" i]','form.footer-newsletter','form.subscribe-form','form[id*="subscribe" i]','form[name*="subscribe" i]','form[class*="newsletter" i]','form[class*="email-signup" i]','form[class*="email_subscribe" i]'];
    var forms = []; sels.forEach(function(s){ try { Array.prototype.push.apply(forms, document.querySelectorAll(s)); } catch(e){} });
    forms.forEach(function(f){
      if (f.__lighom_sub_bound) return; f.__lighom_sub_bound = true;
      f.addEventListener("submit", function(){
        /* 5/31 fix: per-form fire singleton — prevent double-click / re-submit firing twice */
        if (f.__lighom_sub_fired) return;
        var em = f.querySelector('input[type="email"], input[name*="email" i]');
        var email = em ? (em.value || "").trim().toLowerCase() : "";
        if (email) { try { window.__lighom_user_data_raw = window.__lighom_user_data_raw || {}; window.__lighom_user_data_raw.em = email; window.__lighom_user_data_pinned = true; /* 5/31 Subscribe raw cookie+LS REMOVED — privacy: 225ms raw exposure window, redundant with User Data Enricher _h cookies + PII Persist bridge */ } catch(e){} }
        f.__lighom_sub_fired = true;
        /* 6/2: newsletter signup NOT sent to Meta — Subscribe is paid-subscription event per Meta spec (value>0 required);
           newsletter is free signup. Lead pool already crowded (contact form + GTM + messenger). Switching to CR would add
           noise. Best path: capture PII into __lighom_user_data_raw (already done above) → PII Persist v1 stores to LS+cookies
           → future ATC/IC/Purchase events from this user get higher EMQ match. No Meta event fired here. */
      }, { passive: true, capture: true });
    });
  }
  function bindLead(){
    var sels = ['form[action*="contact" i]','form.contact-form','form[id*="contact" i]','form[class*="contact-form" i]','form[class*="contact_form" i]','form[class*="getintouch" i]'];
    var forms = []; sels.forEach(function(s){ try { Array.prototype.push.apply(forms, document.querySelectorAll(s)); } catch(e){} });
    forms.forEach(function(f){
      if (f.__lighom_lead_bound) return; f.__lighom_lead_bound = true;
      f.addEventListener("submit", function(){
        /* 5/31 fix: per-form fire singleton */
        if (f.__lighom_lead_fired) return;
        var em = f.querySelector('input[type="email"], input[name*="email" i]');
        var ne = f.querySelector('input[name*="name" i]');
        var pe = f.querySelector('input[type="tel"], input[name*="phone" i]');
        var email = em ? (em.value || "").trim().toLowerCase() : "";
        var name = ne ? (ne.value || "").trim() : "";
        var phone = pe ? (pe.value || "").trim() : "";
        var p = { content_name: "contact_form", page_type: pt(), value: 0, currency: ccyFromCountry(ck('_lighom_user_country')) };
        try {
          window.__lighom_user_data_raw = window.__lighom_user_data_raw || {};
          if (email) window.__lighom_user_data_raw.em = email;
          if (phone) window.__lighom_user_data_raw.ph = phone;
          if (name) { var parts = name.split(/\s+/); if (parts[0]) window.__lighom_user_data_raw.fn = parts[0]; if (parts.length >= 2) window.__lighom_user_data_raw.ln = parts.slice(1).join(' '); }
          window.__lighom_user_data_pinned = true;
          /* 5/31 G1 REMOVED — raw PII cookies exposed for 225ms before Enricher cleared (privacy issue, audit confirmed). User Data Enricher writes _h-suffix hashed cookies at t=240ms + PII Persist bridgeToCookies writes no-suffix hashed at t~1s; sufficient for AAM on subsequent pages without raw PII exposure surface. */
        } catch(e){}
        f.__lighom_lead_fired = true;
        /* 5/31 PhaseB: cross-block singleton shared with GTM Lead-Meta block (same sessionStorage key). PII propagation above ran regardless. */
        try { if (sessionStorage.getItem('_lighom_lead_fired') === '1') return; sessionStorage.setItem('_lighom_lead_fired', '1'); } catch(_){}
        /* 5/31 fix: stable event_id from email seed */
        var seed = email ? email.replace(/[^a-z0-9]/g,'').slice(0,16) : 'noem';
        /* 5/31 fix: ms + random suffix 防跨 form/页撞 */
        var evtId = 'lead_' + seed + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
        fire("track", "Lead", p, evtId);
      }, { passive: true, capture: true });
    });
  }
  bindSubscribe(); bindLead();
  try { var mo = new MutationObserver(function(){ bindSubscribe(); bindLead(); }); mo.observe(document.body || document.documentElement, { childList: true, subtree: true }); } catch(e){}
  var pixelFiredFor = {};
  function maybeBridgeTime(item){
    if (!item || typeof item !== 'object' || !item.event) return;
    /* Skip dataLayer events explicitly tagged GA4-only — keeps 60s out of Meta Pixel. */
    if (item._lighom_ga4_only) return;
    var match = /^time_on_page_(\d+)s$/i.exec(item.event);
    if (!match) return;
    var sec = match[1]; if (pixelFiredFor[sec]) return; pixelFiredFor[sec] = 1;
    var evtId = item.event_id || eid("top" + sec);
    fire("trackCustom", "TimeOnPage" + sec + "s", { page_type: pt(), page_path: location.pathname, seconds: parseInt(sec, 10), fbp: ck("_fbp"), fbc: ck("_fbc") }, evtId);
  }
  (function(){ var dl = window.dataLayer || []; for (var i = 0; i < dl.length; i++) maybeBridgeTime(dl[i]); })();
  (function(){ window.dataLayer = window.dataLayer || []; var origPush = window.dataLayer.push.bind(window.dataLayer); window.dataLayer.push = function(){ for (var i = 0; i < arguments.length; i++) { try { maybeBridgeTime(arguments[i]); } catch(e){} } return origPush.apply(this, arguments); }; })();
})();
</script>