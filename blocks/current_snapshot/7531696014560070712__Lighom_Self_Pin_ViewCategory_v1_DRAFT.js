<script>
/* Lighom Self Pin — ViewCategory v1 (Pinterest-only, master-flag gated, status=2 disabled)
   /collections* 且非嵌套 /products/(#1 path 修正);DL 优先 + DOM 兜底(#7)
   pintrk('track','viewcategory',{event_id, content_ids?}) + Worker fanout=['pinterest']
   event_id 同 FB ViewCategory v2 公式 */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighom_selfpin_viewcat_v1) return;
  window.__lighom_selfpin_viewcat_v1 = true;
  if (window.__lighomIsBot) return;
  /* #1 path: 必须含 /collections/ 且不含 /products/(否则交给 VC) */
  if (!/\/collections/.test(location.pathname) || /\/products\//.test(location.pathname)) return;

  var WORKER = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var P = "_lighom_user_";

  /* shared from Util Lib v1 */ var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;
  
  
  

  function getIdsFromDL(){
    try {
      var dl = window.dataLayer || [];
      /* 优先 1: Shopline view_category — Enricher v10 推,直接含 catalog 变体 ID(180689... 长串) */
      for (var i = 0; i < dl.length; i++) {
        var it = dl[i];
        if (!it || typeof it !== "object") continue;
        if (it.event === "view_category" && Array.isArray(it.content_ids) && it.content_ids.length) {
          /* 5/31 VCat ID filter */ return Array.from(new Set(it.content_ids.map(String).filter(function(s){ return /^1[68]\d{22,28}$/.test(s); }))).slice(0, 30);
        }
      }
      /* 优先 2: GTM 标准 view_item_list — ecommerce.content_ids / ecommerce.items[].item_id */
      for (var j = 0; j < dl.length; j++) {
        var jt = dl[j];
        if (!jt || typeof jt !== "object") continue;
        if (jt.event === "view_item_list" && jt.ecommerce) {
          var ec = jt.ecommerce;
          if (Array.isArray(ec.content_ids) && ec.content_ids.length) {
            return Array.from(new Set(ec.content_ids.map(String).filter(function(s){ return /^1[68]\d{22,28}$/.test(s); }))).slice(0, 30);
          }
          if (Array.isArray(ec.items) && ec.items.length) {
            var z = ec.items.map(function(x){ return String(x.item_id || x.id || ""); }).filter(function(s){ return /^1[68]\d{22,28}$/.test(s); });
            if (z.length) return Array.from(new Set(z)).slice(0, 30);
          }
        }
      }
      /* 优先 3: gtag arguments 格式 ['event','view_item_list',{items:[...]}] */
      for (var k = 0; k < dl.length; k++) {
        var kt = dl[k];
        if (!kt || typeof kt !== "object") continue;
        if (kt[0] === "event" && kt[1] === "view_item_list" && kt[2] && Array.isArray(kt[2].items)) {
          var zk = kt[2].items.map(function(x){ return String(x.item_id || x.id || ""); }).filter(function(s){ return /^1[68]\d{22,28}$/.test(s); });
          if (zk.length) return Array.from(new Set(zk)).slice(0, 30);
        }
      }
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin VCat v1",e);}
    return [];
  }
  function getCategory(){
    return ((document.querySelector("h1") || {}).textContent || document.title || "").trim().slice(0, 80);
  }

  /* P0 fix 2026-05-20: getIdsFromDOM was called by fire() line 71 but never defined →
     ReferenceError when DL empty, killing the rest of fire(). Mirror FB VCat v2 implementation. */
  function getIdsFromDOM(){
    var m = document.body.innerHTML.match(/\b1[68]\d{22,28}\b/g /* 6/2 fix: was /180689\d{18,20}/ — only matched 1 of 7 Shopline 18xxx prefixes (180689/180705/180690/180726/180725/180745/180748), causing 79% bias in BQ. Now matches all 18xxx + 16xxx 24-30 digit IDs (same pattern as DL filter). */);
    if (!m) return [];
    return Array.from(new Set(m)).slice(0, 30);
  }

  var fired = false;
  function fire(){
    if (fired) return;
    /* #7 DL 优先, DOM 兜底 */
    var ids = getIdsFromDL();
    if (!ids.length) ids = getIdsFromDOM();
    if (!ids.length) return;
    fired = true;
    var category = getCategory();
    var slug = location.pathname.split("/").filter(Boolean).pop() || "all";
    var event_id = ("viewcat_" + slug + "_" + Date.now());

    /* Pinterest viewcategory: 接受 event_id + 可选 content_ids (用于 Pinterest 受众扩展) */
    try {
      if (window.pintrk) window.pintrk("track", "viewcategory", {
        event_id: event_id,
        line_items: ids.slice(0, 10).map(function(id){ return { product_id: id, product_quantity: 1 }; })
      });
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin VCat v1",e);}

    var ud = window.LighomUtil.buildUserData({prefix:P});
    try {
      fetch(WORKER, {
        method: "POST", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_name: "ViewCategory", event_id: event_id,
          event_time: Math.floor(Date.now()/1000),
          event_source_url: location.href, page_url: location.href, page_path: location.pathname,
          page_type: "category",
          fanout: ["pinterest"],
          utm: (window.LighomUtil && window.LighomUtil.utm) ? window.LighomUtil.utm() : { source: '', medium: '', campaign: '' } /* D6 5/31 */,
          user_data: ud,
          custom_data: {
            content_type: "product" /* 5/31 VCat content_type fix: was 'product_group' but content_ids are 18xxx variant IDs, must match — Meta product_group requires 16xxx item_group_id */,
            content_ids: ids,
            content_category: category,
            content_name: category,
            currency: "USD",
            data_quality: "self_pin_v1:viewcat"
          }
        })
      });
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin VCat v1",e);}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fire);
  else fire();
  setTimeout(fire, 500); setTimeout(fire, 1500); setTimeout(fire, 3000);
})();
</script>