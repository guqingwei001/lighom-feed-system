<script>
/* Lighom Self Pixel — PageView v2 (Phase B 草稿,master-flag gated)
   生效: window.LIGHOM_SELF_PIXEL_LIVE === true + !__lighomIsBot
   职责: 浏览器 fbq('track','PageView',{},{eventID}) + pintrk('track','pagevisit',{event_id})
   + Worker /capi/event fanout=['meta','pinterest'] 同 event_id
   全字段 (用户要求): em/ph/fn/ln/ct/st/zp/country/db/ge/external_id + fbp/fbc/epik/ttclid/msclkid/ga_cookie/client_ua + utm(first+last) */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighom_selfpx_pv_v2) return;
  window.__lighom_selfpx_pv_v2 = true;
  if (window.__lighomIsBot) return;
  var WORKER = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var P = "_lighom_user_";
  /* shared helpers from Util Lib v1 (id 7531852299762928771) */
  var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;



  function pageType(){
    var p = (location.pathname || "").toLowerCase();
    if (p === "/" || p === "") return "home";
    if (p.indexOf("/products/") > -1) return "product";
    if (p.indexOf("/collections") > -1) return "collection";
    if (p.indexOf("/cart") > -1) return "cart";
    if (p.indexOf("/checkouts/") > -1 || p.indexOf("/checkout") > -1) return "checkout";
    if (p.indexOf("/orders/") > -1) return "thank_you";
    if (p.indexOf("/search") > -1) return "search";
    if (p.indexOf("/account") > -1 || p.indexOf("/user") > -1) return "account";
    if (p.indexOf("/blogs") > -1) return "blog";
    return "other";
  }
  var sent = false;
  function fire(force){
    if (sent) return true;
    var fbp = ck("_fbp");
    if (!fbp) return false;
    var __extReady = (function(){
      var G = window.__lighom_user_data_hashed;
      if (G && G.external_id) return true;
      if (document.cookie.indexOf("_lighom_user_external_id") !== -1) return true;
      return false;
    })();
    if (!__extReady && !force) return false;
    sent = true;
    var event_id = ("pv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 11));
    var ud = window.LighomUtil.buildUserData({prefix:P});
    try { if (window.fbq)    window.fbq("track", "PageView", {}, { eventID: event_id }); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB PV v2",e);}
    try {
      fetch(WORKER, {
        method: "POST", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_name: "PageView",
          event_id: event_id,
          event_time: Math.floor(Date.now()/1000),
          event_source_url: location.href,
          page_url: location.href, page_path: location.pathname,
          page_type: pageType(),
          fanout: ["meta"],  /* Pinterest 阶段后加 */
          utm: {
            source: ck("last_utm_source") || ck("first_utm_source") || "",
            medium: ck("last_utm_medium") || ck("first_utm_medium") || "",
            campaign: ck("last_utm_campaign") || ck("first_utm_campaign") || ""
          },
          user_data: ud,
          custom_data: { data_quality: "self_pixel_v2:pv" }
        })
      });
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB PV v2",e);}
    return true;
  }
  function start(){
    if (fire(false)) return;
    var n = 0;
    var iv = setInterval(function(){
      if (fire(false)) { clearInterval(iv); return; }
      if (++n > 40) { clearInterval(iv); fire(true); }
    }, 150);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
</script>