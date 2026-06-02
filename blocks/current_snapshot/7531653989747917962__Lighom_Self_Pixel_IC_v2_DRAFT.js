<script>
/* Lighom Self Pixel — InitiateCheckout v3 (5/31 fix: single fire + defer triggers, no first-arrived dedup trap)
   Settle/checkout 页;严格"宽语义 + 单次 fire";第一发就是最 rich 版本,不靠 re-fire enrich(Meta first-wins)
   v2→v3: 砍 lastFp re-fire 模式 (Meta 不 merge user_data, 后到的同 event_id 被丢);砍 em-watch re-fire
   新模式: defer 首发到任一条件: rich(em+≥3字段) | em+15s无补 | submit | pagehide | 60s timeout 兜底
   Worker pinterest.js 映射 IC → custom CAPI;浏览器 pintrk 不发(没标准事件) */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighom_selfpx_ic_v3) return;
  window.__lighom_selfpx_ic_v3 = true;
  if (window.__lighomIsBot) return;

  var WORKER = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var P = "_lighom_user_";

  /* shared from Util Lib v1 */ var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;

  /* 6/2: read ps.checkout.buyerInfo PII (Shopline-prefixed); cookies 优先, 只填空 */
  var _buyerHashed = {};
  (function _icLoadBuyerPII(){
    try {
      var ps = window.__PRELOAD_STATE__;
      var buyer = (ps && ps.checkout && ps.checkout.buyerInfo) || {};
      var rawEm = String(buyer.buyerEmail || '').trim().toLowerCase();
      var rawPh = String(buyer.buyerPhone || '').replace(/\D/g, '');
      var rawFn = String(buyer.buyerFirstName || '').trim().toLowerCase();
      var rawLn = String(buyer.buyerLastName || '').trim().toLowerCase();
      function _h(s){ if(!s) return Promise.resolve(''); var enc=new TextEncoder().encode(String(s));
        return crypto.subtle.digest('SHA-256',enc).then(function(buf){
          return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
        });
      }
      Promise.all([_h(rawEm),_h(rawPh),_h(rawFn),_h(rawLn)]).then(function(hs){
        if (hs[0]) _buyerHashed.em = hs[0];
        if (hs[1]) _buyerHashed.ph = hs[1];
        if (hs[2]) _buyerHashed.fn = hs[2];
        if (hs[3]) _buyerHashed.ln = hs[3];
      }).catch(function(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB IC v3",e);});
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB IC v3",e);}
  })();

  function pickId(it){ var v=it.variant_id||it.variantId||it.sku||it.productSku||it.skuId||it.productSeq; if(v&&v!=="0"&&v!==0) return String(v); v=it.product_id||it.productId||it.id||it.item_id; return (v&&v!==0&&v!=="0")?String(v):""; }

  var __icCart = null;
  try { fetch('/cart.js',{credentials:'include',headers:{'Accept':'application/json'}}).then(function(r){return r.json();}).then(function(j){ if(j&&Array.isArray(j.items)&&j.items.length) __icCart=j; }).catch(function(){}); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB IC v3",e);}

  function readCart(){
    try { var ps=window.__PRELOAD_STATE__; var c=ps&&(ps.cart||ps.checkout||ps.settlement);
      var items=c&&(c.items||c.line_items||c.lineItemList||c.orderItemList);
      if (items&&items.length) return { items:items, source:'preload', currency:c.currency||c.transCurrency||'USD', total:Number(c.total_price||c.totalAmount||c.total||c.subtotal||c.orderAmount||0)/100 };
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB IC v3",e);}
    if (__icCart && __icCart.items && __icCart.items.length) return { items:__icCart.items, source:'cartjs', currency:__icCart.currency||'USD', total:Number(__icCart.total_price||0) /* 5/31 IC cartjs dollar fix */ };
    return null;
  }
  function buildParams(){
    var cart = readCart(); if (!cart) return null;
    var items = cart.items;
    var totalFromItems = items.reduce(function(s,it){
      var price=Number(it.final_price||it.final_line_price||it.original_price||it.finalPrice||it.price||it.unit_price||it.item_price||it.productPrice||0);
      if (cart.source==='preload' && price>=100) price=price/100; /* 5/31 IC cartjs dollar fix: Shopline /cart.js returns DOLLARS not cents; only PRELOAD is cents */
      var qty=(it.quantity||it.productNum||1);
      return s + price*qty;
    }, 0);
    var value = (cart.total&&cart.total>0) ? cart.total : totalFromItems;
    if (!value || value<=0) return null;
    var contents = items.map(function(it){
      var price=Number(it.final_price||it.final_line_price||it.original_price||it.finalPrice||it.price||it.unit_price||it.item_price||it.productPrice||0);
      if (cart.source==='preload' && price>=100) price=price/100; /* 5/31 IC cartjs dollar fix: Shopline /cart.js returns DOLLARS not cents; only PRELOAD is cents */
      return { id: pickId(it), quantity:(it.quantity||it.productNum||1), item_price:Math.round(price*100)/100,
               title:String(it.title||it.productName||it.name||it.item_name||"").slice(0,100), brand:"Lighom", item_group_id: String(it.product_id||it.productSeq||it.productGroupId||""),
               category:String(it.product_custom_type||(it.product&&it.product.type)||it.customCategoryName||it.category||it.item_category||"").slice(0,100) /* 5/31 IC product_custom_type fix */ };
    });
    var content_ids = contents.map(function(c){return c.id;}).filter(Boolean);
    if (!content_ids.length) return null;
    var num_items = items.reduce(function(s,it){ return s+(it.quantity||it.productNum||1); }, 0);
    var content_name = items.map(function(it){return String(it.title||it.productName||it.item_name||"");}).filter(Boolean).join(", ").slice(0,200);
    /* 5/31 IC product_custom_type fix: Shopline cart.js exposes category at it.product_custom_type (top-level breadcrumb-style "Furniture > Kitchen > Bar Stools") */ var firstCat = items[0]&&(items[0].product_custom_type||(items[0].product&&items[0].product.type)||items[0].customCategoryName||items[0].category||items[0].item_category);
    return { content_type:"product", content_ids:content_ids, contents:contents, currency:cart.currency, value:Math.round(value*100)/100, num_items:num_items, content_name:content_name, content_category:firstCat?String(firstCat).slice(0,100):"" };
  }

  /* stable per-session event_id */
  var stableEventId = (function(){
    try{var c=sessionStorage.getItem("lighom_ic_v3_event_id"); if(c) return c;}catch(e){}
    var ps=window.__PRELOAD_STATE__||{}; var tok=(ps.cart&&(ps.cart.token||ps.cart.id))||Date.now();
    var id="ic_"+tok+"_"+Math.random().toString(36).slice(2,9);
    try{sessionStorage.setItem("lighom_ic_v3_event_id",id);}catch(e){}
    return id;
  })();

  /* single fire — first-arrived wins Meta dedup; richer enrichment via deferred trigger, not re-fire */
  var fired = false;
  function doFire(reason){
    if (fired) return;
    var p = buildParams(); if (!p) return;  /* if cart/fbq not ready, don't fire yet, don't lock singleton */
    fired = true;
    var ud = window.LighomUtil.buildUserData({prefix:P});
    if (!ud.em && _buyerHashed.em) ud.em = _buyerHashed.em;
    if (!ud.ph && _buyerHashed.ph) ud.ph = _buyerHashed.ph;
    if (!ud.fn && _buyerHashed.fn) ud.fn = _buyerHashed.fn;
    if (!ud.ln && _buyerHashed.ln) ud.ln = _buyerHashed.ln;
    try { if (window.fbq) window.fbq("track","InitiateCheckout", p, { eventID: stableEventId }); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB IC v3",e);}
    /* Pinterest 没 IC 标准事件,浏览器 pintrk 不发(Worker pinterest.js 映射为 custom CAPI) */
    try {
      fetch(WORKER, { method:"POST", credentials:"omit", keepalive:true, headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ event_name:"InitiateCheckout", event_id:stableEventId, event_time:Math.floor(Date.now()/1000),
          event_source_url:location.href, page_url:location.href, page_path:location.pathname, page_type:"settle_page",
          fanout:["meta"],
          utm: (window.LighomUtil && window.LighomUtil.utm) ? window.LighomUtil.utm() : { source: '', medium: '', campaign: '' } /* D6 5/31 */,
          user_data:ud, custom_data:Object.assign({},p,{data_quality:"self_pixel_v3:ic:" + reason}) }) });
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB IC v3",e);}
  }

  function countFilled(){
    var ud = window.LighomUtil.buildUserData({prefix:P});
    if (!ud.em && _buyerHashed.em) ud.em = _buyerHashed.em;
    if (!ud.ph && _buyerHashed.ph) ud.ph = _buyerHashed.ph;
    if (!ud.fn && _buyerHashed.fn) ud.fn = _buyerHashed.fn;
    if (!ud.ln && _buyerHashed.ln) ud.ln = _buyerHashed.ln;
    var n=0; ["em","ph","fn","ln","ct","st","zp"].forEach(function(k){ if (ud[k]) n++; });
    return { count: n, has_em: !!ud.em };
  }

  /* trigger 1: 任何 PII 字段 blur/change → check rich (em + ≥3 total) */
  function piFieldMatch(t){
    if (!t || (t.tagName !== "INPUT" && t.tagName !== "SELECT")) return false;
    var hint = (t.name||"") + " " + (t.id||"") + " " + (t.autocomplete||"") + " " + (t.type||"");
    return /email|phone|tel|first[-_]?name|last[-_]?name|given|family|address|street|city|province|state|zip|postal|country/i.test(hint);
  }
  function tryFireRich(){
    if (fired) return;
    var s = countFilled();
    /* 富版条件: em + ≥3 字段 (em 是 Meta 最强 matching 信号, +2 字段算"准备好下单"水平) */
    if (s.has_em && s.count >= 3) doFire("rich");
  }
  document.addEventListener("blur", function(e){ if (piFieldMatch(e.target)) tryFireRich(); }, true);
  document.addEventListener("change", function(e){ if (piFieldMatch(e.target)) tryFireRich(); }, true);

  /* trigger 2: em 单独到了 15s 后还没补其它字段 → fire (em alone 也是有用的信号) */
  var emArrivedAt = null;
  var emCheckN = 0;
  var emCheckIv = setInterval(function(){
    if (fired) { clearInterval(emCheckIv); return; }
    var s = countFilled();
    if (s.has_em && !emArrivedAt) emArrivedAt = Date.now();
    if (s.has_em && emArrivedAt && (Date.now() - emArrivedAt > 15000)) {
      clearInterval(emCheckIv);
      doFire("em_only");
    } else if (++emCheckN > 120) { /* 60s 总最大,em 还没到也别再 poll */
      clearInterval(emCheckIv);
    }
  }, 500);

  /* trigger 3: submit / next-step / continue click → fire (用户继续走说明 checkout 流程在进行) */
  document.addEventListener("click", function(e){
    var t = e.target; if (!t) return;
    var txt = (t.textContent || t.value || "").toLowerCase();
    var hint = ((t.className||"") + " " + (t.id||"") + " " + ((t.getAttribute && t.getAttribute("data-role"))||"")).toLowerCase();
    if (/continue.{0,5}(to|→).{0,15}(payment|shipping|review|delivery)|place.{0,3}order|pay.{0,3}now|complete.{0,5}order|submit.{0,5}order|next.{0,5}step|继续|下一步|提交订单|立即付款|确认支付/i.test(txt + " " + hint)) {
      setTimeout(function(){ doFire("submit"); }, 50);
    }
  }, true);

  /* trigger 4: pagehide / beforeunload → 用户离开 checkout 兜底 (IC 宽语义"进入结算"成立) */
  window.addEventListener("pagehide", function(){ doFire("pagehide"); }, true);
  window.addEventListener("beforeunload", function(){ doFire("beforeunload"); }, true);

  /* trigger 5: 60s 超时 → 用户停在 checkout 60s 还没动 = 多半已弃单, fire 有啥发啥 */
  setTimeout(function(){ doFire("timeout"); }, 60000);

  /* trigger 6: initial poll for cart+fbq — 不 auto-fire, 只确保 prereqs 到位让其它 trigger 能成功 */
  var bootN=0; var bootIv=setInterval(function(){
    if (fired) { clearInterval(bootIv); return; }
    var fbqOk = typeof window.fbq === "function"; var cartOk = !!readCart();
    if (fbqOk && cartOk) { clearInterval(bootIv); /* prereqs OK; rely on triggers to fire */ }
    else if (++bootN > 50) { clearInterval(bootIv); /* 5s 超时 prereqs 没到 */ }
  }, 100);

  /* trigger 7: form submit (Shopline 原生 next-step 按钮多挂 form) */
  document.body && document.body.addEventListener("submit", function(){ setTimeout(function(){ doFire("formsubmit"); }, 100); }, true);
})();
</script>
