<script>
/* Lighom PageView v1 — server-side PageView via Worker CAPI.
   Purpose: when Shopline native FB pixel is disabled (3rd-path dedup fix),
   PageView signal must not vanish. This block sends a PageView to the Worker
   /capi/event, which fans out to Meta. STAGE 1: fanout:[] = BQ-only, ZERO Meta
   send (verify volume/identifier coverage first). STAGE 2: flip to ["meta"].
   No new data collected — only reads cookies already minted by Capture v3.1 /
   User Data Enricher v10 (fbp/fbc/external_id/persisted hashed PII). */
(function(){
  if (window.__lighom_pageview_v1) return;
  window.__lighom_pageview_v1 = true;
  var BOT_RE = /fbexternalhit|facebookcatalog|FacebookExternalAgent|meta-externalagent|meta-externalfetcher|facebookbot|facebookcrawler|fb_iab|fbav|fbavbot|metabot|fb\-extagent|pinterestbot|pinterest_fetcher|googlebot|googleother|googleadsbot|adsbot\-google|google\-extended|bingbot|adidxbot|bingpreview|slackbot|twitterbot|tweetmemebot|linkedinbot|whatsapp|telegrambot|discordbot|applebot|applenewsbot|duckduckbot|baiduspider|yandexbot|yandeximages|ahrefsbot|semrushbot|mj12bot|dotbot|petalbot|seekport|cluebot|amazonbot|amazon\-route53|gptbot|chatgpt|claudebot|claude\-web|anthropic|perplexity|perplexitybot|bytespider|tiktokspider|crawler|spider|HeadlessChrome|headless|phantom|puppeteer|playwright|webdriverio|cypress/i;
  if (BOT_RE.test(navigator.userAgent || "") || navigator.webdriver === true) return;
  /* Phase B coexistence: when Self Pixel master flag is live, the new PageView v2
     block takes over (browser fbq+pintrk + /capi/event with full fanout). v1 bails
     to avoid duplicate /capi/event POST per pageload. Behavior unchanged when LIVE=false. */
  if (window.LIGHOM_SELF_PIXEL_LIVE) return;

  var WORKER_EVENT = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";

  function ck(name){
    var m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
    return m ? decodeURIComponent(m[1]) : "";
  }
  function lsClick(name){
    try { var v = localStorage.getItem('lighom_clickid_' + name); return v ? v.split(':')[0] : ''; }
    catch(e){ return ''; }
  }
  function hx(v){ return (v && /^[a-f0-9]{64}$/.test(v)) ? v : ''; }

  function pageType(){
    var p = (location.pathname || '').toLowerCase();
    if (p === '/' || p === '') return 'home';
    if (p.indexOf('/products/') === 0 || p.indexOf('/products/') > -1) return 'product';
    if (p.indexOf('/collections') > -1) return 'collection';
    if (p.indexOf('/cart') > -1) return 'cart';
    if (p.indexOf('/orders/') > -1 || p.indexOf('/order') > -1) return 'thank_you';
    if (p.indexOf('/search') > -1) return 'search';
    if (p.indexOf('/account') > -1 || p.indexOf('/user') > -1) return 'account';
    if (p.indexOf('/blogs') > -1) return 'blog';
    return 'other';
  }

  var sent = false;
  function fire(force){
    if (sent) return true;
    var fbp = ck("_fbp");
    if (!fbp) return false; /* wait: Capture/Enricher mints _fbp; retry until present */
    /* v1.1: also wait for external_id readiness (Enricher global OR _lighom_user_external_id cookie); start() passes force=true at retry cap so PageView still emits, just possibly without extid. */
    var __extReady = (function(){ var G = window.__lighom_user_data_hashed; if (G && G.external_id) return true; if (document.cookie.indexOf("_lighom_user_external_id") !== -1) return true; return false; })();
    if (!__extReady && !force) return false;
    sent = true;

    var ud = {};
    var fbc = ck("_fbc") || lsClick("_fbc");
    if (fbc) ud.fbc = fbc;
    ud.fbp = fbp;
    /* persisted hashed PII from Enricher (_lighom_user_<f>_h) — send only if real 64-hex */
    var P = "_lighom_user_";
    [["em","em"],["ph","ph"],["fn","fn"],["ln","ln"],["ct","ct"],["st","st"],
     ["zp","zp"],["country","country"],["db","db"],["ge","ge"],["external_id","external_id"]]
    .forEach(function(f){
      var h = hx(ck(P + f[0] + "_h"));
      if (h) ud[f[1]] = h;
    });
    /* external_id: hashed _h cookie (loop above) -> Enricher in-memory
       global (set even if _h cookie write lagged this pageload) -> raw cookie. */
    if (!ud.external_id) {
      var G = window.__lighom_user_data_hashed;
      if (G && G.external_id) ud.external_id = G.external_id;
      else { var ex = ck(P + "external_id"); if (ex) ud.external_id = ex; }
    }
    ud.client_ua = navigator.userAgent;

    var eid = "pv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
    try {
      fetch(WORKER_EVENT, {
        method: "POST", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_name: "PageView",
          event_id: eid,
          event_time: Math.floor(Date.now()/1000),
          page_url: location.href,
          page_path: location.pathname,
          page_type: pageType(),
          fanout: [],            /* STAGE 1: BQ-only, NO Meta send */
          utm: {
            source: ck("last_utm_source") || ck("first_utm_source") || "",
            medium: ck("last_utm_medium") || ck("first_utm_medium") || "",
            campaign: ck("last_utm_campaign") || ck("first_utm_campaign") || ""
          },
          user_data: ud
        })
      });
    } catch(e){}
    return true;
  }

  function start(){
    if (fire(false)) return;
    var n = 0;
    var iv = setInterval(function(){ if (fire(false)) { clearInterval(iv); return; } if (++n > 40) { clearInterval(iv); fire(true); } }, 150);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
</script>