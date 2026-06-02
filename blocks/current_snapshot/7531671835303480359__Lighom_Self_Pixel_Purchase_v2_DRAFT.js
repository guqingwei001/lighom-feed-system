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
    var ts = (basic && (basic.createTime || basic.orderTime || basic.createAt || basic.orderAt)) || 0 /* 6/2 real field names — Shopline 用 createTime/orderTime 不用 payTime/paidAt */;
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
      brand: "Lighom", item_group_id: String(it.product_id||it.productSeq||it.productGroupId||""),
      category: String(it.customCategoryName||it.product_custom_type||(it.product&&(it.product.type||it.product.category))||it.product_type||it.category||"").slice(0, 100) /* 5/31 Purchase category fallback */
    }; });
    var num_items = items.reduce(function(s, it){ return s + (it.productNum || 1); }, 0);
    var content_name = items.map(function(it){ return String(it.productName || it.title || ""); }).filter(Boolean).join(", ").slice(0, 200);
    var topCat = items[0] && String(items[0].customCategoryName||items[0].product_custom_type||(items[0].product&&(items[0].product.type||items[0].product.category))||items[0].product_type||items[0].category||"").slice(0, 100); /* 5/31 Purchase category fallback */

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

    /* 2026-05-20 V2: PII from cookies via buildUserData() + buyer.email/phone async SHA256
       backfill from PRELOAD_STATE.orders.buyerInfo/receiverInfo (thank-you 页面 scanDOM 找不到
       email form → cookie 缺 → ud.em 空 → Meta AAM 0%). 直接读 PRELOAD 兜底,异步 hash 后塞 ud. */
    var ud = window.LighomUtil.buildUserData({prefix:P});
    function _sha256Hex(s){
      if (!s) return Promise.resolve('');
      var enc = new TextEncoder().encode(String(s));
      return crypto.subtle.digest('SHA-256', enc).then(function(buf){
        return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
      });
    }
    var rawEm = String(buyer.buyerEmail || buyer.email || '').trim().toLowerCase();
    var rawPh = String(buyer.buyerPhone || recv.receiverMobile || buyer.phone || recv.phone || '').replace(/\D/g, '');
    var rawFn = String(buyer.buyerFirstName || recv.receiverFirstName || recv.firstName || buyer.firstName || '').trim().toLowerCase();
    var rawLn = String(buyer.buyerLastName || recv.receiverLastName || recv.lastName || buyer.lastName || '').trim().toLowerCase();
    var udReady = Promise.all([
      (rawEm && !ud.em) ? _sha256Hex(rawEm) : Promise.resolve(''),
      (rawPh && !ud.ph) ? _sha256Hex(rawPh) : Promise.resolve(''),
      (rawFn && !ud.fn) ? _sha256Hex(rawFn) : Promise.resolve(''),
      (rawLn && !ud.ln) ? _sha256Hex(rawLn) : Promise.resolve('')
    ]).then(function(hs){
      if (hs[0]) ud.em = hs[0];
      if (hs[1]) ud.ph = hs[1];
      if (hs[2]) ud.fn = hs[2];
      if (hs[3]) ud.ln = hs[3];
    }).catch(function(e){
      window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB Purchase v2",e);
    });

    function actuallyFire(){
      udReady.then(function(){
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
              utm: (window.LighomUtil && window.LighomUtil.utm) ? window.LighomUtil.utm() : { source: '', medium: '', campaign: '' } /* D6 5/31 */,
              user_data: ud,
              custom_data: Object.assign({}, p, { data_quality: "self_pixel_v2:purchase" })
            })
          });
        } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB Purchase v2",e);}
        try { localStorage.setItem(KEY, String(Date.now())); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB Purchase v2",e);}
      });
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