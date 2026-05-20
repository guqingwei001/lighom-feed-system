<script>
/* Lighom GTM TimeOnPage v6 — GA4-only 60s via gtag direct + full-fanout 180s.
   60s: gtag('event','time_on_page_60',...) — Lighom's GTM container is empty,
        so plain dataLayer.push of custom events does NOT reach GA4
        (verified 2026-05-09: GA4 collect calls only saw page_view/view_item/etc.).
        Direct gtag() bypasses GTM and routes via the gtag.js loader (G-0K0Q3MV1JE).
   180s: Worker /capi/event (Meta + Pinterest + GA4 MP) + gtag client mirror.
   Created 2026-05-09. */
(function(){
  if (window.__lighom_top_v6) return;
  window.__lighom_top_v6 = true;
  var BOT_RE = /fbexternalhit|facebookcatalog|FacebookExternalAgent|meta-externalagent|meta-externalfetcher|facebookbot|pinterestbot|googlebot|bingbot|crawler|spider|HeadlessChrome|headless|phantom|puppeteer|playwright|gptbot|chatgpt|claudebot|anthropic|perplexity|bytespider|amazonbot/i;
  if (BOT_RE.test(navigator.userAgent || "") || navigator.webdriver === true) return;

  function ck(name){ var m=document.cookie.match(new RegExp('(?:^|;\\s*)'+name+'=([^;]+)')); return m?decodeURIComponent(m[1]):''; }
  function isProductPath(){ return /^\/products\//.test(location.pathname); }
  function isCollectionPath(){ return /^\/collections\//.test(location.pathname); }
  function getPageType(){
    if (isProductPath()) return 'product';
    if (isCollectionPath()) return 'collection';
    if (location.pathname === '/' || location.pathname === '') return 'home';
    return 'other';
  }
  function getProductIdFromUrl(){
    try {
      var sku = new URLSearchParams(location.search).get('sku');
      if (sku && /^\d{20,30}$/.test(sku)) return sku;
    } catch(e){}
    try {
      var s = document.querySelector('variant-radios script[type="application/json"]');
      if (s) {
        var arr = JSON.parse(s.textContent);
        if (Array.isArray(arr) && arr[0] && arr[0].id) return String(arr[0].id);
      }
    } catch(e){}
    return '';
  }
  function getContentCategory(){
    try {
      var els = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < els.length; i++){
        var d = JSON.parse(els[i].textContent || '{}');
        if (d && d.category) return String(d.category);
      }
    } catch(e){}
    return '';
  }
  function fireGa4(name, params){
    if (typeof window.gtag === 'function') {
      try { window.gtag('event', name, params); } catch(e){}
    }
  }

  /* === 60s: GA4-only === */
  var t60_ok = isProductPath() || isCollectionPath();
  var t60Key = '__lighom_top60_' + location.pathname;
  function t60Fired(){ try { return !!sessionStorage.getItem(t60Key); } catch(e){ return false; } }
  if (t60_ok && !t60Fired()) {
    setTimeout(function(){
      if (document.hidden || t60Fired()) return;
      var pid = getProductIdFromUrl();
      var cat = getContentCategory();
      var p = {
        page_path: location.pathname,
        page_title: document.title,
        page_type: getPageType(),
        engagement_time_msec: 60000
      };
      if (pid) p.product_id = pid;
      if (cat) p.content_category = cat;
      fireGa4('time_on_page_60', p);
      try { sessionStorage.setItem(t60Key, String(Date.now())); } catch(e){}
    }, 60000);
  }

  /* === 180s: full fanout === */
  if (!isProductPath()) return;
  var KEY = '__lighom_fired_TimeOnPage180s';
  try { if (localStorage.getItem(KEY)) return; } catch(e){}

  setTimeout(function(){
    if (document.hidden) return;
    try { if (localStorage.getItem(KEY)) return; } catch(e){}
    var evtId = 'top180_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
    var fbc = ck('_fbc'), fbp = ck('_fbp');
    var pid = getProductIdFromUrl();
    var cat = getContentCategory();

    try {
      fetch('https://lighom-feed-server.dikecarmem750.workers.dev/capi/event', {
        method: 'POST', credentials: 'omit', keepalive: true,
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          event_name: 'TimeOnPage180s', event_id: evtId,
          page_url: location.href, page_path: location.pathname,
          page_type: 'product',
          /* Skip GA4 MP: browser gtag('event','time_on_page_180') mirror already fires GA4 with snake_case name. */
          fanout: ['meta', 'pinterest'],
          user_data: {
            fbc: fbc, fbp: fbp,
            epik: ck('_epik'), ttclid: ck('_ttp'), msclkid: ck('_uetmsclkid'),
            external_id: (window.__lighom_user_data_raw && window.__lighom_user_data_raw.external_id) || ''
          },
          custom_data: { content_type: 'engagement', time_seconds: 180, content_ids: pid ? [pid] : undefined },
          utm: {
            source: ck('last_utm_source') || ck('first_utm_source'),
            medium: ck('last_utm_medium') || ck('first_utm_medium'),
            campaign: ck('last_utm_campaign') || ck('first_utm_campaign')
          }
        })
      }).catch(function(){});
    } catch(e){}

    var p180 = {
      page_path: location.pathname,
      page_title: document.title,
      page_type: 'product',
      engagement_time_msec: 180000,
      event_id: evtId
    };
    if (pid) p180.product_id = pid;
    if (cat) p180.content_category = cat;
    fireGa4('time_on_page_180', p180);

    try { localStorage.setItem(KEY, String(Date.now())); } catch(e){}
  }, 180000);
})();
</script>