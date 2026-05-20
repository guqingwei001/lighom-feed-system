<script>
/* Lighom Self Pixel — Purchase v2 (FB-only, master-flag gated, status=2 disabled)
   Thank-you page;paid status 才发;fbq('track','Purchase') + Worker /capi/event fanout=['meta']
   event_id: SEID 优先 (Phase A-D rollback 锚),兜底 purchase_<appOrderSeq>
   localStorage 防同单重发 */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighom_selfpx_purchase_v2) return;
  window.__lighom_selfpx_purchase_v2 = true;
  if (window.__lighomIsBot) return;

  var WORKER = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var P = "_lighom_user_";

  /* shared from Util Lib v1 */ var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;
  
  
  

  /* 2026-05-20: order-age gate — prevent revisit-triggers on old orders.
     Customer accessing /orders/<id> URL from Account → My Orders re-renders thank-you;
     block previously fired假 Purchase events to Meta when localStorage lock not yet set
     (e.g., when block first goes Live, every old paid order user opens triggers once).
     Gate: skip if order paid > 48h ago. Reads basic.{payTime,paidAt,createdAt,transTime}
     as ms or sec. If no timestamp field → fire (defensive default for unknown schema). */
  function _staleOrderMs(basic){
    var ts = (basic && (basic.payTime || basic.paidAt || basic.createdAt || basic.transTime)) || 0;
    var ms = typeof ts === "number" ? ts : (ts ? new Date(ts).getTime() : 0);
    if (!ms || isNaN(ms)) return 0;
    if (ms < 1e12) ms = ms * 1000; /* sec → ms */
    return Date.now() - ms;
  }
  function tryFire(){
    var ps = window.__PRELOAD_STATE__;
    var orders = ps && ps.orders;
    var basic = orders && orders.basicInfo;
    if (!basic || !basic.orderSeq) return false;
    if (basic.financialStatus !== "paid") return true;
    var ageMs = _staleOrderMs(basic);
    if (ageMs > 48 * 3600 * 1000) return true; /* > 48h = revisit, not fresh purchase */
    var orderSeq = basic.orderSeq;
    var orderId = basic.appOrderSeq || orderSeq;
    var KEY = "__lighom_selfpx_purchase_v2_" + orderSeq;
    try { if (localStorage.getItem(KEY)) return true; } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB Purchase v2",e);}

    var price = orders.priceInfo || {};
    var buyer = orders.buyerInfo || {};
    var recv  = orders.receiverInfo || {};
    var items = orders.orderItemList || [];
    var value = (price.totalAmount || 0) / 100;
    var currency = basic.transCurrency || "USD";
    function pickId(it){ return String(it.productSku || it.skuId || it.variantId || it.productSeq || it.itemNo || ""); }
    var content_ids = items.map(pickId).filter(Boolean);
    var contents = items.map(function(it){ return {
      id: pickId(it), quantity: it.productNum || 1,
      item_price: (it.finalPrice || it.productPrice || 0) / 100,
      title: String(it.productName || it.title || "").slice(0, 100),
      brand: "Lighom",
      category: String(it.customCategoryName || "").slice(0, 100)
    }; });
    var num_items = items.reduce(function(s, it){ return s + (it.productNum || 1); }, 0);
    var content_name = items.map(function(it){ return String(it.productName || it.title || ""); }).filter(Boolean).join(", ").slice(0, 200);
    var topCat = items[0] && items[0].customCategoryName ? String(items[0].customCategoryName).slice(0, 100) : "";

    var event_id = ("purchase_" + orderId);

    var p = {
      content_type: "product",
      content_ids: content_ids,
      contents: contents,
      currency: currency,
      value: Math.round(value * 100) / 100,
      num_items: num_items,
      content_name: content_name,
      content_category: topCat,
      order_id: orderId
    };

    /* 2026-05-20: removed rawEm/rawPh/etc dead-code declarations — never used in payload below.
       PII comes only from window.LighomUtil.buildUserData() which reads _lighom_user_*_h cookies. */
    var ud = window.LighomUtil.buildUserData({prefix:P});

    function actuallyFire(){
      try { if (window.fbq) window.fbq("track", "Purchase", p, { eventID: event_id }); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB Purchase v2",e);}
      try {
        fetch(WORKER, {
          method: "POST", credentials: "omit", keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_name: "Purchase", event_id: event_id,
            event_time: Math.floor(Date.now()/1000),
            event_source_url: location.href, page_url: location.href, page_path: location.pathname,
            page_type: "thank_you",
            fanout: ["meta"],
            utm: { source: ck("last_utm_source")||ck("first_utm_source")||"", medium: ck("last_utm_medium")||ck("first_utm_medium")||"", campaign: ck("last_utm_campaign")||ck("first_utm_campaign")||"" },
            user_data: ud,
            custom_data: Object.assign({}, p, { data_quality: "self_pixel_v2:purchase" })
          })
        });
      } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB Purchase v2",e);}
      try { localStorage.setItem(KEY, String(Date.now())); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB Purchase v2",e);}
    }
    var checks = 0;
    function waitFb(){
      if (typeof window.fbq === "function") { actuallyFire(); return; }
      if (++checks > 30) { actuallyFire(); return; }
      setTimeout(waitFb, 100);
    }
    waitFb();
    return true;
  }

  function start(){
    if (tryFire()) return;
    var n = 0;
    var iv = setInterval(function(){
      if (++n > 50 || tryFire()) clearInterval(iv);
    }, 200);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
</script>