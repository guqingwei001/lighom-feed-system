<script>
/* Lighom Self Pin — Purchase v1 (Pinterest-only, master-flag gated, status=2 disabled)
   Thank-you page;paid status;pintrk('track','checkout') + Worker /capi/event fanout=['pinterest']
   event_id 与 FB Purchase v2 同公式 (SEID+canonical),webhook/native rollback 锚保留
   localStorage 防同单重发 */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  /* 5/31 Pin Purchase diag REMOVED — was 4 _d() calls leaking ClientDiag noise to BQ per memory project_lighom_pin_v1_diag_5_28 (cleanup not done in original fix) */
  
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighom_selfpin_purchase_v1) return;
  window.__lighom_selfpin_purchase_v1 = true;
  if (window.__lighomIsBot) return;
  

  var WORKER = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var P = "_lighom_user_";

  /* shared from Util Lib v1 */ var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;
  
  
  

  /* 2026-05-20: order-age gate — prevent revisit-triggers on old orders.
     Pin v1 just went Live, every old paid order user opens triggers假 Purchase to
     Pinterest (no localStorage lock from prior visits). Gate: skip if paid > 48h ago.
     Reads basic.{payTime,paidAt,createdAt,transTime} as ms or sec. If no timestamp
     field → fire (defensive default). */
  function _staleOrderMs(basic){
    var ts = (basic && (basic.createTime || basic.orderTime || basic.createAt || basic.orderAt)) || 0 /* 6/2 real field names — Shopline 用 createTime/orderTime 不用 payTime/paidAt */;
    var ms = typeof ts === "number" ? ts : (ts ? new Date(ts).getTime() : 0);
    if (!ms || isNaN(ms)) return 0;
    if (ms < 1e12) ms = ms * 1000;
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
      product_category: String(it.customCategoryName||it.product_custom_type||(it.product&&(it.product.type||it.product.category))||it.product_type||it.category||"").slice(0, 100) /* 5/31 Purchase category fallback */,
      product_brand: "Lighom", item_group_id: String(it.product_id||it.productSeq||it.productGroupId||""),
      product_quantity: it.productNum || 1,
      product_price: (it.finalPrice || it.productPrice || 0) / 100
    }; });
    var contents = items.map(function(it){ return {
      id: pickId(it), quantity: it.productNum || 1,
      item_price: (it.finalPrice || it.productPrice || 0) / 100,
      title: String(it.productName || it.title || "").slice(0, 100),
      brand: "Lighom", item_group_id: String(it.product_id||it.productSeq||it.productGroupId||""),
      category: String(it.customCategoryName||it.product_custom_type||(it.product&&(it.product.type||it.product.category))||it.product_type||it.category||"").slice(0, 100) /* 5/31 Purchase category fallback contents */
    }; });
    var content_ids = items.map(pickId).filter(Boolean);
    var num_items = items.reduce(function(s, it){ return s + (it.productNum || 1); }, 0);

    /* event_id: 与 FB Purchase v2 同(SEID prefix or canonical) — Q5 锁:Phase F 才切纯 canonical */
    var event_id = ("purchase_" + orderId);

    /* 2026-05-20 V2: PII from cookies + buyer.email/phone async SHA256 backfill from
       PRELOAD_STATE.orders.buyerInfo/receiverInfo. 修 em=0% on thank-you (cookie 缺). */
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
      window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin Purchase v1",e);
    });

    function actuallyFire(){
      udReady.then(function(){
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
              utm: (window.LighomUtil && window.LighomUtil.utm) ? window.LighomUtil.utm() : { source: '', medium: '', campaign: '' } /* D6 5/31 */,
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
        
      });
    }
    /* 2026-05-29: decouple server CAPI from pintrk readiness. The old waitPin gate
       (up to 3s wait for pintrk) dropped the WHOLE fire (server fetch included) when
       pintrk lagged or the user left the thank-you page fast, so browser Pin Purchase
       landed on only ~7/17 orders vs Meta 15/17. Server fetch now goes immediately
       after udReady; pintrk fires on its own retry and never blocks the server path. */
    function firePintrk(){
      if (typeof window.pintrk === "function") {
        try { window.pintrk("track", "checkout", { value: Math.round(value * 100) / 100, currency: currency, order_id: orderId, line_items: line_items, event_id: event_id }); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin Purchase v1",e);}
        return;
      }
      if (++pinChecks > 30) return;
      setTimeout(firePintrk, 100);
    }
    
    var pinChecks = 0;
    actuallyFire();
    firePintrk();
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