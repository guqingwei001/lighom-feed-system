<script>
/* Lighom Self Pixel — ViewCategory v2 (FB-only, master-flag gated, status=2 disabled)
   /collections* 页;Meta 标准无独立 ViewCategory → 用 ViewContent + content_type='product_group' (Meta 推荐)
   content_ids 双源: DOM /180689\d{18,20}/ 抓 + dataLayer view_item_list items 兜底
   全字段 user_data + Worker /capi/event fanout=['meta'] */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighom_selfpx_viewcat_v2) return;
  window.__lighom_selfpx_viewcat_v2 = true;
  if (window.__lighomIsBot) return;
  if (!/\/collections/.test(location.pathname) || /\/products\//.test(location.pathname)) return;  /* #1 排除 /collections/x/products/y 嵌套(让 VC 块处理) */

  var WORKER = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var P = "_lighom_user_";

  /* shared from Util Lib v1 */ var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;
  
  
  

  function getIdsFromDOM(){
    var m = document.body.innerHTML.match(/180689\d{18,20}/g);
    if (!m) return [];
    return Array.from(new Set(m)).slice(0, 30);
  }
  function getIdsFromDL(){
    try {
      var dl = window.dataLayer || [];
      /* 优先 1: Shopline view_category — Enricher v10 推,直接含 catalog 变体 ID(180689... 长串) */
      for (var i = 0; i < dl.length; i++) {
        var it = dl[i];
        if (!it || typeof it !== "object") continue;
        if (it.event === "view_category" && Array.isArray(it.content_ids) && it.content_ids.length) {
          return Array.from(new Set(it.content_ids.map(String))).slice(0, 30);
        }
      }
      /* 优先 2: GTM 标准 view_item_list — ecommerce.content_ids / ecommerce.items[].item_id */
      for (var j = 0; j < dl.length; j++) {
        var jt = dl[j];
        if (!jt || typeof jt !== "object") continue;
        if (jt.event === "view_item_list" && jt.ecommerce) {
          var ec = jt.ecommerce;
          if (Array.isArray(ec.content_ids) && ec.content_ids.length) {
            return Array.from(new Set(ec.content_ids.map(String))).slice(0, 30);
          }
          if (Array.isArray(ec.items) && ec.items.length) {
            var z = ec.items.map(function(x){ return String(x.item_id || x.id || ""); }).filter(Boolean);
            if (z.length) return Array.from(new Set(z)).slice(0, 30);
          }
        }
      }
      /* 优先 3: gtag arguments 格式 ['event','view_item_list',{items:[...]}] */
      for (var k = 0; k < dl.length; k++) {
        var kt = dl[k];
        if (!kt || typeof kt !== "object") continue;
        if (kt[0] === "event" && kt[1] === "view_item_list" && kt[2] && Array.isArray(kt[2].items)) {
          var zk = kt[2].items.map(function(x){ return String(x.item_id || x.id || ""); }).filter(Boolean);
          if (zk.length) return Array.from(new Set(zk)).slice(0, 30);
        }
      }
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB VCat v2",e);}
    return [];
  }
  function getCategory(){
    return ((document.querySelector("h1") || {}).textContent || document.title || "").trim().slice(0, 80);
  }

  

  var fired = false;
  function fire(){
    if (fired) return;
    /* #7 DL 优先(结构化数据,权威),DOM 正则只作兜底 */
    var ids = getIdsFromDL();
    if (!ids.length) ids = getIdsFromDOM();
    if (!ids.length) return;
    fired = true;
    var category = getCategory();
    var slug = location.pathname.split("/").filter(Boolean).pop() || "all";
    var event_id = ("viewcat_" + slug + "_" + Date.now());
    /* Meta 推荐: ViewContent + content_type='product_group' 表示 category 浏览 */
    var p = {
      content_type: "product_group",
      content_ids: ids,
      content_category: category,
      content_name: category,
      currency: "USD"
    };
    try { if (window.fbq) window.fbq("track", "ViewContent", p, { eventID: event_id }); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB VCat v2",e);}
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
          fanout: ["meta"],
          utm: { source: ck("last_utm_source")||ck("first_utm_source")||"", medium: ck("last_utm_medium")||ck("first_utm_medium")||"", campaign: ck("last_utm_campaign")||ck("first_utm_campaign")||"" },
          user_data: ud,
          custom_data: Object.assign({}, p, { data_quality: "self_pixel_v2:viewcat" })
        })
      });
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB VCat v2",e);}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fire);
  else fire();
  /* 重试 — collection 列表懒加载 / DL 后插 */
  setTimeout(fire, 500);
  setTimeout(fire, 1500);
  setTimeout(fire, 3000);
})();
</script>