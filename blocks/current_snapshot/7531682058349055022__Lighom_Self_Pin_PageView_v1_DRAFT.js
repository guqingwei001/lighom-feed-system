<script>
/* Lighom Self Pin — PageView v1 (Pinterest-only, master-flag gated, status=2 disabled)
   pintrk('track','pagevisit',{event_id}) + Worker /capi/event fanout=['pinterest']
   event_id 与 FB PageView v2 同公式 (SEID 前缀+canonical) → 跨平台同 event_id 可被 Worker 各路 fanout 不冲突
   全字段同 FB PageView */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighom_selfpin_pv_v1) return;
  window.__lighom_selfpin_pv_v1 = true;
  if (window.__lighomIsBot) return;

  var WORKER = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var P = "_lighom_user_";

  /* shared from Util Lib v1 */ var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;
  
  
  

  function pageType(){
    var p = (location.pathname || "").toLowerCase();
    if (p === "/" || p === "") return "home";
    if (p.indexOf("/products/") > -1) return "product";
    if (p.indexOf("/collections") > -1) return "collection";
    if (p.indexOf("/cart") > -1) return "cart";
    if (p.indexOf("/checkouts/") > -1 || p.indexOf("/checkout") > -1) return "checkout";
    if (p.indexOf("/orders/") > -1) return "thank_you";
    if (p.indexOf("/search") > -1) return "search";
    if (p.indexOf("/account") > -1) return "account";
    if (p.indexOf("/blogs") > -1) return "blog";
    return "other";
  }

  var sent = false;
  function fire(force){
    if (sent) return true;
    var fbp = ck("_fbp"); if (!fbp) return false;
    var extReady = (function(){
      var G = window.__lighom_user_data_hashed;
      if (G && G.external_id) return true;
      if (document.cookie.indexOf("_lighom_user_external_id") !== -1) return true;
      return false;
    })();
    if (!extReady && !force) return false;
    sent = true;

    var event_id = ("pv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 11));

    /* === user_data 同 FB 全字段 (Pinterest 不接受 db, 但 Worker 转发时会按 pinterest.js mapping 过滤) === */
    var ud = window.LighomUtil.buildUserData({prefix:P});

    /* === 浏览器: pintrk pagevisit, event_id 在 params 内 (Pinterest 标准) === */
    try { if (window.pintrk) window.pintrk("track", "pagevisit", { event_id: event_id }); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin PV v1",e);}

    /* === Worker: fanout pinterest only (FB 那条由 FB PageView v2 块独立发) === */
    try {
      fetch(WORKER, {
        method: "POST", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_name: "PageView", event_id: event_id, pinterest_event_id: (window.LIGHOM_PAGEVISIT_ID || event_id),
          event_time: Math.floor(Date.now()/1000),
          event_source_url: location.href, page_url: location.href, page_path: location.pathname,
          page_type: pageType(),
          fanout: ["pinterest"],
          utm: (window.LighomUtil && window.LighomUtil.utm) ? window.LighomUtil.utm() : { source: '', medium: '', campaign: '' } /* D6 5/31 */,
          user_data: ud,
          custom_data: { data_quality: "self_pin_v1:pv" }
        })
      });
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin PV v1",e);}
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