<script>
/* Lighom EMQ Custom Events v1 - Subscribe + Lead + TimeOnPage Pixel bridge */
(function(){
  if (window.__lighom_emq_events_v1) return;
  window.__lighom_emq_events_v1 = true;
  var BOT_RE = /fbexternalhit|facebookcatalog|FacebookExternalAgent|meta-externalagent|meta-externalfetcher|facebookbot|pinterestbot|googlebot|bingbot|slackbot|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|applebot|duckduckbot|baiduspider|yandexbot|ahrefsbot|semrushbot|mj12bot|dotbot|crawler|spider|HeadlessChrome|headless|phantom|puppeteer|playwright/i;
  if (BOT_RE.test(navigator.userAgent || "") || navigator.webdriver === true) return;
  function eid(p){ return p+"_"+Date.now()+"_"+Math.random().toString(36).slice(2,8); }
  function pt(){ var p=location.pathname; if(/\/products\//.test(p))return"product"; if(/\/collections\/|\/categories\//.test(p))return"category"; if(/\/cart/.test(p))return"cart"; if(/\/checkout/.test(p))return"checkout"; if(p==="/"||p==="")return"home"; return"other"; }
  function ck(name){ var m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)")); return m ? decodeURIComponent(m[1]) : ""; }
  function fire(method, name, params, evtId){
    if (typeof window.fbq === "function") { try { window.fbq(method, name, params || {}, { eventID: evtId }); } catch(e){} }
    window.dataLayer = window.dataLayer || [];
    try { window.dataLayer.push({ event: name.toLowerCase().replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase(), event_id: evtId, meta_event_name: name, page_type: pt(), ecommerce: params || {} }); } catch(e){}
    /* Worker fanout — only for Subscribe/Lead/CompleteRegistration (TimeOnPage* handled by TimeOnPage block). */
    if (name === 'Subscribe' || name === 'Lead' || name === 'CompleteRegistration') {
      try {
        var ud = window.__lighom_user_data_hashed || {};
        fetch('https://lighom-feed-server.dikecarmem750.workers.dev/capi/event', {
          method: 'POST', credentials: 'omit', keepalive: true,
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            event_name: name, event_id: evtId,
            event_time: Math.floor(Date.now()/1000),
            page_url: location.href, page_path: location.pathname,
            page_type: pt(),
            user_data: Object.assign({}, ud, {
              fbc: ck('_fbc'), fbp: ck('_fbp'), epik: ck('_epik'),
              ga_cookie: ck('_ga'), client_ua: navigator.userAgent
            }),
            custom_data: params || {},
            utm: {
              source: ck('last_utm_source') || ck('first_utm_source') || '',
              medium: ck('last_utm_medium') || ck('first_utm_medium') || '',
              campaign: ck('last_utm_campaign') || ck('first_utm_campaign') || ''
            }
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
        var em = f.querySelector('input[type="email"], input[name*="email" i]');
        var email = em ? (em.value || "").trim().toLowerCase() : "";
        var p = { content_name: "newsletter_subscribe", page_type: pt() };
        if (email) { try { window.__lighom_user_data_raw = window.__lighom_user_data_raw || {}; window.__lighom_user_data_raw.em = email; window.__lighom_user_data_pinned = true; } catch(e){} }
        fire("track", "Subscribe", p, eid("sub"));
      }, { passive: true, capture: true });
    });
  }
  function bindLead(){
    var sels = ['form[action*="contact" i]','form.contact-form','form[id*="contact" i]','form[class*="contact-form" i]','form[class*="contact_form" i]','form[class*="getintouch" i]'];
    var forms = []; sels.forEach(function(s){ try { Array.prototype.push.apply(forms, document.querySelectorAll(s)); } catch(e){} });
    forms.forEach(function(f){
      if (f.__lighom_lead_bound) return; f.__lighom_lead_bound = true;
      f.addEventListener("submit", function(){
        var em = f.querySelector('input[type="email"], input[name*="email" i]');
        var ne = f.querySelector('input[name*="name" i]');
        var pe = f.querySelector('input[type="tel"], input[name*="phone" i]');
        var email = em ? (em.value || "").trim().toLowerCase() : "";
        var name = ne ? (ne.value || "").trim() : "";
        var phone = pe ? (pe.value || "").trim() : "";
        var p = { content_name: "contact_form", page_type: pt() };
        try {
          window.__lighom_user_data_raw = window.__lighom_user_data_raw || {};
          if (email) window.__lighom_user_data_raw.em = email;
          if (phone) window.__lighom_user_data_raw.ph = phone;
          if (name) { var parts = name.split(/\s+/); if (parts[0]) window.__lighom_user_data_raw.fn = parts[0]; if (parts.length >= 2) window.__lighom_user_data_raw.ln = parts.slice(1).join(' '); }
          window.__lighom_user_data_pinned = true;
        } catch(e){}
        fire("track", "Lead", p, eid("lead"));
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