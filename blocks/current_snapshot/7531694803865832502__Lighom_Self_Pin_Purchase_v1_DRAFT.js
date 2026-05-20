<script>
/* Lighom Self Pin — Purchase v1 (Pinterest-only, master-flag gated, status=2 disabled)
   Thank-you page;paid status;pintrk('track','checkout') + Worker /capi/event fanout=['pinterest']
   event_id 与 FB Purchase v2 同公式 (SEID+canonical),webhook/native rollback 锚保留
   localStorage 防同单重发 */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighom_selfpin_purchase_v1) return;
  window.__lighom_selfpin_purchase_v1 = true;
  if (window.__lighomIsBot) return;

  var WORKER = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var P = "_lighom_user_";

  /* shared from Util Lib v1 */ var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;
  
  
  

  function tryFire(){
    var ps = window.__PRELOAD_STATE__;
    var orders = ps && ps.orders;
    var basic = orders && orders.basicInfo;
    if (!basic || !basic.orderSeq) return false;
    if (basic.financialStatus !== "paid") return true;
    var orderSeq = basic.orderSeq;
    var orderId = basic.appOrderSeq || orderSeq;
    var KEY = "__lighom_selfpin_purchase_v1_" + orderSeq;
    try { if (localStorage.getItem(KEY)) return true; } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin Purchase v1",e);}

    var price = orders.priceInfo || {};
    var buyer = orders.buyerInfo || {};
    var recv = orders.receiverInfo || {};
    var items = orders.orderItemList || [];
    var value = (price.totalAmount || 0) / 100;
    var currency = basic.transCurrency || "USD";
    function pickId(it){ return String(it.productSku || it.skuId || it.variantId || it.productSeq || it.itemNo || ""); }

    /* Pinterest browser tag uses line_items[], FB-style contents 一并保留(Worker pinterest.js 转 Pinterest CAPI 用) */
    var line_items = items.map(function(it){ return {
      product_id: pickId(it),
      product_name: String(it.productName || it.title || "").slice(0, 100),
      product_category: String(it.customCategoryName || "").slice(0, 100),
      product_brand: "Lighom",
      product_quantity: it.productNum || 1,
      product_price: (it.finalPrice || it.productPrice || 0) / 100
    }; });
    var contents = items.map(function(it){ return {
      id: pickId(it), quantity: it.productNum || 1,
      item_price: (it.finalPrice || it.productPrice || 0) / 100,
      title: String(it.productName || it.title || "").slice(0, 100),
      brand: "Lighom",
      category: String(it.customCategoryName || "").slice(0, 100)
    }; });
    var content_ids = items.map(pickId).filter(Boolean);
    var num_items = items.reduce(function(s, it){ return s + (it.productNum || 1); }, 0);

    /* event_id: 与 FB Purchase v2 同(SEID prefix or canonical) — Q5 锁:Phase F 才切纯 canonical */
    var event_id = ("purchase_" + orderId);

    /* raw PII from Shopline order (Worker hashes plain) + Enricher hashed _h cookie 兜底 */
    var rawEm = (buyer.buyerEmail || "").trim().toLowerCase();
    var rawPh = (recv.receiverMobile || "").replace(/[^0-9]/g, "");
    var rawFn = (buyer.buyerFirstName || recv.receiverFirstName || "").trim().toLowerCase();
    var rawLn = (buyer.buyerLastName || recv.receiverLastName || "").trim().toLowerCase();
    var rawCt = (recv.receiverCity || "").trim().toLowerCase().replace(/\s+/g, "");
    var rawSt = (recv.receiverProvince || "").trim().toLowerCase().replace(/\s+/g, "");
    var rawZp = (recv.receiverPostcode || "").trim().toLowerCase().split("-")[0];
    var rawCountry = (recv.receiverCountryCode || "").trim().toLowerCase();
    var rawExtId = String(buyer.buyerId || "") || ck(P + "external_id") || "";

    var ud = window.LighomUtil.buildUserData({prefix:P});

    function actuallyFire(){
      /* Pinterest checkout: line_items + value + currency + order_id + event_id */
      try {
        if (window.pintrk) window.pintrk("track", "checkout", {
          value: Math.round(value * 100) / 100,
          currency: currency,
          order_id: orderId,
          line_items: line_items,
          event_id: event_id
        });
      } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin Purchase v1",e);}
      try {
        fetch(WORKER, {
          method: "POST", credentials: "omit", keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_name: "Purchase", event_id: event_id,
            event_time: Math.floor(Date.now()/1000),
            event_source_url: location.href, page_url: location.href, page_path: location.pathname,
            page_type: "thank_you",
            fanout: ["pinterest"],
            utm: { source: ck("last_utm_source")||ck("first_utm_source")||"", medium: ck("last_utm_medium")||ck("first_utm_medium")||"", campaign: ck("last_utm_campaign")||ck("first_utm_campaign")||"" },
            user_data: ud,
            custom_data: {
              content_type: "product",
              content_ids: content_ids,
              contents: contents,
              currency: currency,
              value: Math.round(value * 100) / 100,
              num_items: num_items,
              order_id: orderId,
              data_quality: "self_pin_v1:purchase"
            }
          })
        });
      } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin Purchase v1",e);}
      try { localStorage.setItem(KEY, String(Date.now())); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin Purchase v1",e);}
    }
    var checks = 0;
    function waitPin(){
      if (typeof window.pintrk === "function") { actuallyFire(); return; }
      if (++checks > 30) { actuallyFire(); return; }
      setTimeout(waitPin, 100);
    }
    waitPin();
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