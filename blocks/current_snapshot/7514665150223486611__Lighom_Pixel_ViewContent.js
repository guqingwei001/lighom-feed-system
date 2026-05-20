<script>
/* Lighom GTM ViewContent v5.6 (external_id race-fix: read _lighom_user_external_id_h or raw cookie when hashedCache not yet populated — UUID first-visit race). v5.5 fail-loud guard for missing content_ids (Meta error_subcode 2804008 + catalog match warnings).
   v4 hijacked Shopline native fbq but kept all-30-variants content_ids → Catalog match risk
   if any variant is missing in feed; value reflected only first variant's price (lying).
   v5:
   #1 Path guard: only operate on /products/* (SPA-survival proof — re-checked on every fbq call)
   #2 Default selected = variants.find(v => v.available) || variants[0], or URL ?variant=
   #3 content_ids / contents / value all use that ONE variant's real data (mutated in-place
      before orig.apply so Pixel /tr also emits single-variant)
   #4 Listen variant-radios change with 3s debounce → fire new VC with new variant data
   Created 2026-05-08. */
(function(){
  if (window.__lighom_vc_v5_7) return;
  var DQ_VER = 'v5.6';
  window.__lighom_vc_v5_7 = true;
  var BOT_RE = /fbexternalhit|facebookcatalog|FacebookExternalAgent|meta-externalagent|meta-externalfetcher|facebookbot|facebookcrawler|fb_iab|fbav|fbavbot|metabot|fb\-extagent|pinterestbot|pinterest_fetcher|googlebot|googleother|googleadsbot|adsbot\-google|google\-extended|bingbot|adidxbot|bingpreview|slackbot|twitterbot|tweetmemebot|linkedinbot|whatsapp|telegrambot|discordbot|applebot|applenewsbot|duckduckbot|baiduspider|yandexbot|yandeximages|ahrefsbot|semrushbot|mj12bot|dotbot|petalbot|seekport|cluebot|amazonbot|amazon\-route53|gptbot|chatgpt|claudebot|claude\-web|anthropic|perplexity|perplexitybot|bytespider|tiktokspider|crawler|spider|HeadlessChrome|headless|phantom|puppeteer|playwright|webdriverio|cypress/i;
  if (BOT_RE.test(navigator.userAgent || "") || navigator.webdriver === true) return;

  function onPDP(){ return /^\/products\//.test(location.pathname); }
  function ck(n){ var m=document.cookie.match(new RegExp("(?:^|;\\s*)"+n+"=([^;]+)")); return m?decodeURIComponent(m[1]):""; }

  function decodeEnt(s){
    if (typeof s !== 'string') return s;
    for (var i=0;i<3;i++){
      var prev = s;
      s = s.replace(/&amp;/g,'&').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ');
      if (s === prev) break;
    }
    return s;
  }

  function readVariants(){
    var s = document.querySelector('variant-radios script[type="application/json"]');
    if (!s) return [];
    try { return JSON.parse(s.textContent) || []; } catch(e){ return []; }
  }

  function pickSelected(){
    var vs = readVariants();
    if (!vs.length) return null;
    /* URL ?variant= takes priority (deep links + variant nav) */
    var qVid = null;
    try { qVid = new URLSearchParams(location.search).get('variant'); } catch(e){}
    if (qVid){
      var byQ = vs.find(function(v){ return String(v.id) === qVid || v.sku === qVid; });
      if (byQ) return byQ;
    }
    /* Default: first available; otherwise variants[0] */
    return vs.find(function(v){ return v.available !== false; }) || vs[0];
  }

  function buildParams(variant, base){
    if (!variant) return null;
    base = base || {};
    /* Catalog content_id is variant.id (long 18068... key); variant.sku is merchant SKU. */
    var sku = String(variant.id || variant.sku || '');
    var price = Number(variant.price || 0) / 100;
    var contentName = decodeEnt(base.content_name || variant.product_title || variant.title || '');
    var contentCategory = decodeEnt(base.content_category || '');
    return {
      content_type: 'product',
      content_ids: [sku],
      contents: [{
        id: sku, quantity: 1,
        item_price: Math.round(price * 100) / 100,
        title: String(variant.title || contentName).slice(0, 100),
        brand: 'Lighom',
        category: String(contentCategory).slice(0, 100)
      }],
      content_name: contentName,
      content_category: contentCategory,
      currency: String(base.currency || 'USD').toUpperCase(),
      value: Math.round(price * 100) / 100
    };
  }

  var sent = {};
  function forwardToWorker(eventId, params){
    if (!eventId || sent[eventId]) return;
    sent[eventId] = 1;
    var ud = window.__lighom_user_data_hashed || {};
    /* v5.6: race-fix — if hashedCache.external_id not yet populated by Enricher,
       fall back to _h cookie (sync seed) or raw UUID cookie (Worker maybeHashArr hashes). */
    if (!ud.external_id) {
      var hEid = ck('_lighom_user_external_id_h');
      if (hEid && /^[a-f0-9]{64}$/i.test(hEid)) {
        ud = Object.assign({}, ud, { external_id: hEid });
      } else {
        var rawEid = ck('_lighom_user_external_id');
        if (rawEid) ud = Object.assign({}, ud, { external_id: rawEid });
      }
    }
    /* 2-fetch split: POST 1 immediate (Meta + GA4), POST 2 deferred 200ms (Pinterest only)
       so pintrk hijack has time to populate __lighom_pintrk_shared. Keeps Meta CAPI latency identical. */
    function _baseBody(extra){
      /* v5.7: normalize custom_data to satisfy Meta strict schema (avoid 2804008/2804023 fails). */
      var _p = params || {};
      if (!_p.currency) _p.currency = "USD";
      if (Array.isArray(_p.contents)) {
        _p.contents = _p.contents.map(function(c){
          if (typeof c === "string") return { id: c, quantity: 1, item_price: typeof _p.value === "number" ? _p.value : 0 };
          if (c && typeof c === "object") {
            if (!c.id && Array.isArray(_p.content_ids) && _p.content_ids[0]) c.id = String(_p.content_ids[0]);
            if (typeof c.quantity !== "number") c.quantity = 1;
            if (typeof c.item_price !== "number") c.item_price = typeof _p.value === "number" ? _p.value : 0;
          }
          return c;
        });
      } else if (Array.isArray(_p.content_ids) && !_p.contents) {
        _p.contents = _p.content_ids.map(function(id){ return { id: String(id), quantity: 1, item_price: typeof _p.value === "number" ? _p.value : 0 }; });
      }
      params = _p;
      return Object.assign({
        event_name: "ViewContent",
        event_id: eventId,
        event_time: Math.floor(Date.now()/1000),
        page_url: location.href, page_path: location.pathname,
        page_type: "product_detail",
        utm: {
          source: ck("last_utm_source") || ck("first_utm_source") || "",
          medium: ck("last_utm_medium") || ck("first_utm_medium") || "",
          campaign: ck("last_utm_campaign") || ck("first_utm_campaign") || ""
        },
        user_data: Object.assign({}, ud, {
          fbc: ck("_fbc"), fbp: ck("_fbp"), epik: ck("_epik"),
          ga_cookie: ck("_ga"), client_ua: navigator.userAgent
        }),
        custom_data: params
      }, extra);
    }
    /* POST 1: immediate Meta + GA4 (writes BQ row) */
    try {
      fetch("https://lighom-feed-server.dikecarmem750.workers.dev/capi/event", {
        method: "POST", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(_baseBody({ fanout: ['meta'] }))  /* GA4 skipped: Shopline native gtag fires view_item already (no event_id dedup possible). */
      }).catch(function(){});
    } catch(e){}
    /* POST 2: 200ms later → Pinterest only with captured sharedId, skip_bq to avoid double-write */
    setTimeout(function(){
      try {
        var pinId = (window.__lighom_pintrk_shared && window.__lighom_pintrk_shared['pagevisit']) || (window.__lighom_pintrk_ids && window.__lighom_pintrk_ids['pagevisit']) || '';
        fetch("https://lighom-feed-server.dikecarmem750.workers.dev/capi/event", {
          method: "POST", credentials: "omit", keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(_baseBody({ fanout: ['pinterest'], skip_bq: true, pinterest_event_id: pinId }))
        }).catch(function(){});
      } catch(_){}
    }, 200);
  }

  /* fbq hijack: pre-mutate VC params to single-variant; post-forward to Worker. */
  var patched = false;
  function tryPatch(){
    if (patched) return true;
    if (typeof window.fbq !== 'function') return false;
    var orig = window.fbq;
    var wrapped = function(){
      var args = arguments;
      var method = args[0], name, paramsIdx, optsIdx;
      if (method === 'trackSingle' || method === 'trackSingleCustom'){ name = args[2]; paramsIdx = 3; optsIdx = 4; }
      else if (method === 'track' || method === 'trackCustom'){ name = args[1]; paramsIdx = 2; optsIdx = 3; }

      var dataQuality = null;

      /* Pre: replace VC params with single-variant on PDP. Skip our own re-entry. */
      if (name === 'ViewContent' && onPDP() && !window.__lighom_vc_v5_passthrough) {
        try {
          var origParams = args[paramsIdx];
          var sel = pickSelected();
          if (sel && origParams) {
            var clean = buildParams(sel, origParams);
            if (clean) {
              origParams.content_type     = clean.content_type;
              origParams.content_ids      = clean.content_ids;
              origParams.contents         = clean.contents;
              origParams.content_name     = clean.content_name;
              origParams.content_category = clean.content_category;
              origParams.currency         = clean.currency;
              origParams.value            = clean.value;
              try { delete origParams.delivery_category; } catch(e){}
              dataQuality = DQ_VER + ':hijack';
            } else { dataQuality = DQ_VER + ':empty'; }
          } else { dataQuality = DQ_VER + ':empty'; }
        } catch(e){}
      } else if (name === 'ViewContent' && onPDP() && window.__lighom_vc_v5_passthrough) {
        dataQuality = DQ_VER + ':scan';
      }

      /* Fail-loud v5.5: drop VC if final content_ids empty (Meta 2804008 / catalog warnings). */
      if (name === 'ViewContent' && onPDP()) {
        var __pp = args[paramsIdx];
        var __hasIds = __pp && Array.isArray(__pp.content_ids) && __pp.content_ids.length > 0;
        if (!__hasIds) return;
      }
      var ret = orig.apply(this, args);

      /* Post: forward to Worker with same eventID — only on PDP, only ViewContent. */
      try {
        if (name === 'ViewContent' && onPDP()) {
          var opts = args[optsIdx];
          var eventId = (opts && (opts.eventID || opts.event_id)) || null;
          if (eventId) {
            var pp = args[paramsIdx];
            var workerPayload = pp ? JSON.parse(JSON.stringify(pp)) : {};
            if (dataQuality) workerPayload.data_quality = dataQuality;
            forwardToWorker(eventId, workerPayload);
          }
        }
      } catch(e){}
      return ret;
    };
    for (var k in orig) { try { wrapped[k] = orig[k]; } catch(e){} }
    window.fbq = wrapped;
    if (window._fbq) window._fbq = wrapped;
    patched = true;
    return true;
  }

  if (!tryPatch()) {
    var n = 0;
    var iv = setInterval(function(){
      if (tryPatch() || ++n > 50) clearInterval(iv);
    }, 100);
  }

  /* Variant change listener — 3s debounce, then fire new VC for new variant. */
  var changeTimer = null;
  var lastFiredVariantId = null;
  function debouncedFire(){
    clearTimeout(changeTimer);
    changeTimer = setTimeout(function(){
      if (!onPDP()) return;
      var sel = pickSelected();
      if (!sel) return;
      if (sel.id === lastFiredVariantId) return;
      lastFiredVariantId = sel.id;

      var prodName = '';
      try { prodName = (document.querySelector('h1') || {}).textContent || ''; } catch(e){}
      var prodCat = '';
      try {
        var ldEls = document.querySelectorAll('script[type="application/ld+json"]');
        for (var i=0; i<ldEls.length; i++){
          var d = JSON.parse(ldEls[i].textContent || '{}');
          var c = d && (d.category || (d['@graph'] && d['@graph'].find && (d['@graph'].find(function(x){return x.category;}) || {}).category));
          if (c) { prodCat = c; break; }
        }
      } catch(e){}

      var clean = buildParams(sel, { content_name: prodName.trim(), content_category: prodCat });
      if (!clean) return;

      var eventId = 'vc_change_' + Date.now() + '_' + Math.random().toString(36).slice(2,9);
      window.__lighom_vc_v5_passthrough = true;
      try {
        if (typeof window.fbq === 'function') {
          window.fbq('track', 'ViewContent', clean, { eventID: eventId });
        }
      } finally { window.__lighom_vc_v5_passthrough = false; }
      /* Worker forwarded by hijack's post-step (it sees this fbq call too). */
    }, 3000);
  }

  document.addEventListener('change', function(e){
    var t = e.target;
    if (!t) return;
    /* variant-radios contains radio inputs; some themes use selects. */
    if (t.tagName !== 'INPUT' && t.tagName !== 'SELECT') return;
    if (!t.closest || !t.closest('variant-radios')) return;
    debouncedFire();
  }, true);
})();
</script>
