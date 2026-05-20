<script>
/* Lighom Variant Link Injector v2 (broader regex: any 22-30 digit id not starting with 16) — site-wide product card link → variant URL.
   On click of <a href="/products/<handle>"> (no existing ?sku= or ?variant=):
     1. If cached: append ?sku=<vid> sync, navigate normally.
     2. If not cached: prevent default, fetch product HTML, extract first 18068... id
        (= default-selected variant), cache, navigate to enriched URL.
   sessionStorage cache prevents repeat HTML fetches (882KB each) within session.
   Skips: bots, cross-origin, modifier-clicks (new tab), already-enriched links.
   Created 2026-05-08. */
(function(){
  if (window.__lighom_variant_link_injector) return;
  window.__lighom_variant_link_injector = true;
  var BOT_RE = /fbexternalhit|facebookcatalog|FacebookExternalAgent|meta-externalagent|meta-externalfetcher|facebookbot|pinterestbot|googlebot|bingbot|crawler|spider|HeadlessChrome|headless|phantom|puppeteer|playwright|gptbot|chatgpt|claudebot|anthropic|perplexity|bytespider|amazonbot/i;
  if (BOT_RE.test(navigator.userAgent || "") || navigator.webdriver === true) return;

  var cache = {};
  try { cache = JSON.parse(sessionStorage.getItem('__lighom_variant_cache') || '{}') || {}; } catch(e){ cache = {}; }
  function saveCache(){ try { sessionStorage.setItem('__lighom_variant_cache', JSON.stringify(cache)); } catch(e){} }

  /* Inflight: dedup concurrent fetches for same handle */
  var inflight = {};

  function extractHandle(href){
    if (!href) return null;
    var m = String(href).match(/\/products\/([a-zA-Z0-9_-]+)(?:[?#]|$)/);
    return m ? m[1] : null;
  }

  function fetchFirstVariantId(handle){
    if (cache[handle]) return Promise.resolve(cache[handle]);
    if (inflight[handle]) return inflight[handle];
    inflight[handle] = fetch('/products/' + handle, { credentials: 'omit' })
      .then(function(r){ return r.ok ? r.text() : null; })
      .then(function(html){
        if (!html) return null;
        /* Find first variant ID: any "id":"<22-30 digits>" NOT starting with 16 (= product_group). */
        var ids = [];
        var re = /"id"\s*:\s*"(\d{22,30})"/g;
        var mm;
        while ((mm = re.exec(html)) !== null) ids.push(mm[1]);
        var vid = null;
        for (var i = 0; i < ids.length; i++) {
          if (!/^16/.test(ids[i])) { vid = ids[i]; break; }
        }
        if (!vid) return null;
        cache[handle] = vid;
        saveCache();
        return vid;
      })
      .catch(function(){ return null; })
      .then(function(vid){ delete inflight[handle]; return vid; });
    return inflight[handle];
  }

  function appendSkuParam(href, vid){
    try {
      var u = new URL(href, location.origin);
      u.searchParams.set('sku', vid);
      return u.toString();
    } catch(e){ return href; }
  }

  /* Click interceptor: only path that triggers any work. */
  document.addEventListener('click', function(e){
    /* Skip modifier-clicks (open in new tab/window etc.). Browser handles those normally. */
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;

    var a = e.target && e.target.closest && e.target.closest('a[href*="/products/"]');
    if (!a) return;

    /* Already has variant query — leave alone */
    if (/[?&](sku|variant)=/.test(a.href)) return;

    /* Cross-origin links: skip */
    try {
      var u = new URL(a.href, location.origin);
      if (u.hostname !== location.hostname) return;
    } catch(err){ return; }

    var handle = extractHandle(a.href);
    if (!handle) return;

    /* Cache hit: rewrite href synchronously, let browser navigate normally */
    if (cache[handle]) {
      a.href = appendSkuParam(a.href, cache[handle]);
      return;
    }

   /* Cache miss: navigate normally — 2026-05-20 B fix: removed fetch-block click delay.
         Pinterest catalog deeplink unaffected (ad clicks arrive with ?sku= from Pinterest feed).
         Internal nav loses variant-level ?sku= but VC/ATC content_ids fall back to product JSON first variant. */
      return;
  }, true);
})();
</script>
