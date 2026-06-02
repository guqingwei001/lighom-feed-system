<script>
/* Lighom Capture All Click IDs v3.1 â v3 + reverse-direction sync (localStorage â cookie restore).
   Why v3.1: v3 only synced cookie â localStorage; if cookie expired (90d / Safari ITP 7d) but
   localStorage still has the value, downstream blocks reading `getCookie()` miss it.
   v3.1 restores cookie from localStorage on every page load â ALL blocks reading cookie
   (IC / ViewContent / AddToCart / ViewCategory / Search / Purchase) auto-benefit, no per-block edits.
   Pinterest EQ: addresses Click ID gap across Checkout/Signup/Lead/Search/ViewCategory.
   Created 2026-05-15. */
(function(){
  if (window.__lighom_capture_clickids_v3_1) return;
  window.__lighom_capture_clickids_v3_1 = true;

  /* Bot guard */
  if (window.LighomUtil && window.LighomUtil.isBot && window.LighomUtil.isBot()) return; /* D4 5/31 */

  var DAYS_90 = 90 * 86400;
  var DAYS_400 = 730 * 86400;

  function getCookie(name){
    var m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
    return m ? decodeURIComponent(m[1]) : "";
  }
  function setCookie(name, val, maxAge){
    try {
      document.cookie = name + "=; path=/; max-age=0";
      document.cookie = name + "=" + encodeURIComponent(val) + ";path=/;max-age=" + maxAge + ";SameSite=Lax;domain=lighom.com";
    } catch(e){}
  }
  function lsSetClickId(name, val){
    try { localStorage.setItem('lighom_clickid_' + name, val + ':' + Date.now()); } catch(e){}
  }
  /* v3.1 NEW: localStorage â cookie restore (catches expired-cookie returning users) */
  function lsGetClickId(name){
    try {
      var v = localStorage.getItem('lighom_clickid_' + name);
      if (!v) return '';
      return v.split(':')[0];
    } catch(e) { return ''; }
  }
  function ssGet(k){ try { return sessionStorage.getItem(k) || ""; } catch(e){ return ""; } }
  function ssSet(k, v){ try { sessionStorage.setItem(k, v); } catch(e){} }

  /* v3.1 NEW: bidirectional sync helper.
     Precedence: URL param > existing cookie > localStorage backup.
     Always re-stamp cookie (extend max-age) and refresh localStorage. */
  function syncClickId(cookieName, urlVal, daysTtl){
    var cookieVal = getCookie(cookieName);
    var lsVal = lsGetClickId(cookieName);
    var winner = urlVal || cookieVal || lsVal;
    if (!winner) return '';
    if (winner !== cookieVal) setCookie(cookieName, winner, daysTtl);   /* restore or extend */
    if (winner !== lsVal) lsSetClickId(cookieName, winner);              /* refresh backup */
    return winner;
  }

  var params = new URLSearchParams(window.location.search);
  var now = Date.now();

  /* === Facebook fbclid â _fbc === */
  var fbclid = params.get("fbclid");
  var fbcUrlVal = fbclid ? ("fb.1." + now + "." + fbclid) : "";
  var fbc = syncClickId("_fbc", fbcUrlVal, DAYS_90);
  if (fbc) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ fbc: fbc });
  }
  /* [2026-05-26] _fbp 合成已删——Meta 官方+多方权威源均指出"do not fabricate".
     合成的 Math.random fbp 无法关联 Meta 用户 graph,属 EMQ pollution. 让 Self Pixel Base v1
     加载 fbevents.js 后由 Meta SDK 自然创建真 _fbp(典型 200-400ms 内就绪). */

  /* === Google gclid â _gcl_aw === */
  var gclid = params.get("gclid");
  var gclUrlVal = gclid ? ("GCL." + now + "." + gclid) : "";
  var gcl = syncClickId("_gcl_aw", gclUrlVal, DAYS_90);
  if (gcl && gclid) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ gclid: gclid });
  }

  var wbraid = params.get("wbraid");
  var wbUrlVal = wbraid ? ("GCL." + now + "." + wbraid) : "";
  var wb = syncClickId("_gcl_wbraid", wbUrlVal, DAYS_90);
  if (wb && wbraid) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ wbraid: wbraid });
  }

  var gbraid = params.get("gbraid");
  var gbUrlVal = gbraid ? ("GCL." + now + "." + gbraid) : "";
  var gb = syncClickId("_gcl_gbraid", gbUrlVal, DAYS_90);
  if (gb && gbraid) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ gbraid: gbraid });
  }

  /* === Pinterest epik === */
  var epikUrl = params.get("epik");
  var epik = syncClickId("_epik", epikUrl || "", DAYS_90);
  if (epik && epikUrl) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ epik: epik });
  }

  /* === TikTok ttclid === */
  var ttclid = params.get("ttclid");
  /* 5/31 ttclid cookie rename (#9): _ttp namespace collides with TikTok Pixel's own anon-id cookie (TikTok Pixel overwrites _ttp on load). Use _lighom_ prefixed namespace to avoid stomping. */
  var tt = syncClickId("_lighom_ttclid", ttclid || "", DAYS_90);
  if (tt && ttclid) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ ttclid: ttclid });
  }

  /* === Microsoft msclkid === */
  var msclkid = params.get("msclkid");
  var ms = syncClickId("_uetmsclkid", msclkid || "", DAYS_90);
  if (ms && msclkid) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ msclkid: msclkid });
  }

  /* === UTM first/last touch (unchanged from v3) === */
  var utmSource = params.get("utm_source");
  var utmMedium = params.get("utm_medium");
  var utmCampaign = params.get("utm_campaign");
  var utmContent = params.get("utm_content");
  var utmTerm = params.get("utm_term");

  if (utmSource) {
    if (!ssGet("first_utm_source") && !getCookie("first_utm_source")) {
      ssSet("first_utm_source", utmSource);
      ssSet("first_utm_medium", utmMedium || "");
      ssSet("first_utm_campaign", utmCampaign || "");
      setCookie("first_utm_source", utmSource, DAYS_400);
      setCookie("first_utm_medium", utmMedium || "", DAYS_400);
      setCookie("first_utm_campaign", utmCampaign || "", DAYS_400);
    }

    ssSet("last_utm_source", utmSource);
    ssSet("last_utm_medium", utmMedium || "");
    ssSet("last_utm_campaign", utmCampaign || "");
    ssSet("last_utm_content", utmContent || "");
    ssSet("last_utm_term", utmTerm || "");
    setCookie("last_utm_source", utmSource, DAYS_90);
    setCookie("last_utm_medium", utmMedium || "", DAYS_90);
    setCookie("last_utm_campaign", utmCampaign || "", DAYS_90);
    setCookie("last_utm_content", utmContent || "", DAYS_90);
    setCookie("last_utm_term", utmTerm || "", DAYS_90);

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      first_utm_source: ssGet("first_utm_source") || getCookie("first_utm_source"),
      first_utm_medium: ssGet("first_utm_medium") || getCookie("first_utm_medium"),
      first_utm_campaign: ssGet("first_utm_campaign") || getCookie("first_utm_campaign"),
      last_utm_source: utmSource,
      last_utm_medium: utmMedium || "",
      last_utm_campaign: utmCampaign || ""
    });
  }
})();
</script>
