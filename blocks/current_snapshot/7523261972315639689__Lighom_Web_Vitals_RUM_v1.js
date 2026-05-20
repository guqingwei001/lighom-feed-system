<script>
/* Lighom Web Vitals RUM v1.2 — value encoded into event_id (Worker drops other fields for non-attribution).
   event_id format: wv_<metric>_<value-int>_<rating>_<ts>_<rand>
   BQ extract: SAFE_CAST(SPLIT(event_id, '_')[OFFSET(2)] AS FLOAT64) AS metric_value */
(function(){
  if (window.__lighom_rum_v1) return;
  window.__lighom_rum_v1 = true;
  var BOT_RE = /fbexternalhit|facebookcatalog|FacebookExternalAgent|meta-externalagent|meta-externalfetcher|facebookbot|pinterestbot|googlebot|bingbot|crawler|spider|HeadlessChrome|headless|phantom|puppeteer|playwright|gptbot|chatgpt|claudebot|anthropic|perplexity|bytespider|amazonbot/i;
  if (BOT_RE.test(navigator.userAgent || "") || navigator.webdriver === true) return;

  function ck(name){ var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : ''; }

  function send(m){
    var roundedVal = m.name === 'CLS' ? Math.round(m.value * 1000) : Math.round(m.value);
    var rating = (m.rating || 'unk').replace(/-/g, '');
    var eventId = 'wv_' + m.name + '_' + roundedVal + '_' + rating + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    var pageType = /\/products\//.test(location.pathname) ? 'product'
                : /\/collections\//.test(location.pathname) ? 'category'
                : /\/blogs\//.test(location.pathname) ? 'blog'
                : location.pathname === '/' ? 'home' : 'other';
    if (typeof window.gtag === 'function') {
      try { window.gtag('event', 'web_vitals', {
        metric_name: m.name,
        metric_value: roundedVal,
        metric_rating: m.rating,
        metric_id: m.id,
        metric_delta: Math.round(m.delta || 0),
        page_path: location.pathname,
        page_type: pageType,
        event_id: eventId
      }); } catch(e){}
    }
    try {
      fetch('https://lighom-feed-server.dikecarmem750.workers.dev/capi/event', {
        method: 'POST', credentials: 'omit', keepalive: true,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          event_name: 'WebVitals_' + m.name,
          event_id: eventId,
          page_url: location.href,
          page_path: location.pathname,
          page_type: pageType,
          fanout: [],
          user_data: {
            fbp: ck('_fbp'), fbc: ck('_fbc'),
            client_ua: navigator.userAgent
          }
        })
      }).catch(function(){});
    } catch(e){}
  }

  var s = document.createElement('script');
  s.src = 'https://unpkg.com/web-vitals@4/dist/web-vitals.iife.js';
  s.defer = true;
  s.onload = function(){
    if (window.webVitals) {
      try { webVitals.onLCP(send); } catch(e){}
      try { webVitals.onCLS(send); } catch(e){}
      try { webVitals.onINP(send); } catch(e){}
      try { webVitals.onFCP(send); } catch(e){}
      try { webVitals.onTTFB(send); } catch(e){}
    }
  };
  document.head.appendChild(s);
})();
</script>