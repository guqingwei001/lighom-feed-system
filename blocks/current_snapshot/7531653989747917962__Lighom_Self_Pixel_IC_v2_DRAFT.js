<script>
/* Lighom Self Pixel — InitiateCheckout v2 (Phase B 草稿, master-flag gated)
   Settle/checkout 页;独立触发 fbq('track','InitiateCheckout') + Worker /capi/event fanout=['meta','pinterest']
   Pinterest 没 IC 标准事件 → Worker pinterest.js 映射为 custom CAPI (浏览器 pintrk 不发,避免 invalid event name) */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighom_selfpx_ic_v2) return;
  window.__lighom_selfpx_ic_v2 = true;
  if (window.__lighomIsBot) return;

  var WORKER = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var P = "_lighom_user_";

  /* shared from Util Lib v1 */ var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;
  
  
  
  function pickId(it){ var v=it.variant_id||it.variantId||it.sku||it.productSku||it.skuId||it.productSeq; if(v&&v!=="0"&&v!==0) return String(v); v=it.product_id||it.productId||it.id||it.item_id; return (v&&v!==0&&v!=="0")?String(v):""; }

  var __icCart = null;
  try { fetch('/cart.js',{credentials:'include',headers:{'Accept':'application/json'}}).then(function(r){return r.json();}).then(function(j){ if(j&&Array.isArray(j.items)&&j.items.length) __icCart=j; }).catch(function(){}); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB IC v2",e);}

  function readCart(){
    try { var ps=window.__PRELOAD_STATE__; var c=ps&&(ps.cart||ps.checkout||ps.settlement);
      var items=c&&(c.items||c.line_items||c.lineItemList||c.orderItemList);
      if (items&&items.length) return { items:items, source:'preload', currency:c.currency||c.transCurrency||'USD', total:Number(c.total_price||c.totalAmount||c.total||c.subtotal||c.orderAmount||0)/100 };
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB IC v2",e);}
    if (__icCart && __icCart.items && __icCart.items.length) return { items:__icCart.items, source:'cartjs', currency:__icCart.currency||'USD', total:Number(__icCart.total_price||0)/100 };
    return null;
  }
  function buildParams(){
    var cart = readCart(); if (!cart) return null;
    var items = cart.items;
    var totalFromItems = items.reduce(function(s,it){
      var price=Number(it.final_price||it.final_line_price||it.original_price||it.finalPrice||it.price||it.unit_price||it.item_price||it.productPrice||0);
      if ((cart.source==='preload'||cart.source==='cartjs') && price>=100) price=price/100;
      var qty=(it.quantity||it.productNum||1);
      return s + price*qty;
    }, 0);
    var value = (cart.total&&cart.total>0) ? cart.total : totalFromItems;
    if (!value || value<=0) return null;
    var contents = items.map(function(it){
      var price=Number(it.final_price||it.final_line_price||it.original_price||it.finalPrice||it.price||it.unit_price||it.item_price||it.productPrice||0);
      if ((cart.source==='preload'||cart.source==='cartjs') && price>=100) price=price/100;
      return { id: pickId(it), quantity:(it.quantity||it.productNum||1), item_price:Math.round(price*100)/100,
               title:String(it.title||it.productName||it.name||it.item_name||"").slice(0,100), brand:"Lighom",
               category:String((it.product&&it.product.type)||it.customCategoryName||it.category||it.item_category||"").slice(0,100) };
    });
    var content_ids = contents.map(function(c){return c.id;}).filter(Boolean);
    if (!content_ids.length) return null;
    var num_items = items.reduce(function(s,it){ return s+(it.quantity||it.productNum||1); }, 0);
    var content_name = items.map(function(it){return String(it.title||it.productName||it.item_name||"");}).filter(Boolean).join(", ").slice(0,200);
    var firstCat = items[0]&&((items[0].product&&items[0].product.type)||items[0].customCategoryName||items[0].category||items[0].item_category);
    return { content_type:"product", content_ids:content_ids, contents:contents, currency:cart.currency, value:Math.round(value*100)/100, num_items:num_items, content_name:content_name, content_category:firstCat?String(firstCat).slice(0,100):"" };
  }
  

  /* stable per-session event_id */
  var stableEventId = (function(){ var ps=window.__PRELOAD_STATE__||{}; try{var c=sessionStorage.getItem("lighom_ic_v2_event_id"); if(c) return c;}catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB IC v2",e);}
        var tok=(ps.cart&&(ps.cart.token||ps.cart.id))||Date.now(); var id="ic_"+tok+"_"+Math.random().toString(36).slice(2,9);
        try{sessionStorage.setItem("lighom_ic_v2_event_id",id);}catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB IC v2",e);} return id; })();

  var lastFp = "";
  function fire(){
    var p = buildParams(); if (!p) return;
    var ud = window.LighomUtil.buildUserData({prefix:P});
    var fp = ["em","ph","fn","ln","ct","st","zp","country"].map(function(k){return ud[k]||"";}).join("|");
    if (fp === lastFp) return; lastFp = fp;
    try { if (window.fbq) window.fbq("track","InitiateCheckout", p, { eventID: stableEventId }); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB IC v2",e);}
    /* Pinterest 没 IC 标准事件,浏览器 pintrk 不发(Worker pinterest.js 会映射为 custom CAPI 留存档) */
    try {
      fetch(WORKER, { method:"POST", credentials:"omit", keepalive:true, headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ event_name:"InitiateCheckout", event_id:stableEventId, event_time:Math.floor(Date.now()/1000),
          event_source_url:location.href, page_url:location.href, page_path:location.pathname, page_type:"settle_page",
          fanout:["meta"],
          utm:{ source:ck("last_utm_source")||ck("first_utm_source")||"", medium:ck("last_utm_medium")||ck("first_utm_medium")||"", campaign:ck("last_utm_campaign")||ck("first_utm_campaign")||""},
          user_data:ud, custom_data:Object.assign({},p,{data_quality:"self_pixel_v2:ic"}) }) });
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB IC v2",e);}
  }

  /* 触发: 进页轮询(等 cart+fbq)+ change debounce + pagehide + form submit */
  var n=0; var iv=setInterval(function(){
    var fbqOk=typeof window.fbq==="function"; var dataOk=!!readCart();
    if (fbqOk && (dataOk || n>30)) { clearInterval(iv); fire(); }
    else if (++n>50) { clearInterval(iv); fire(); }
  }, 100);
  var t; document.body && document.body.addEventListener("change", function(){ clearTimeout(t); t=setTimeout(fire,400); }, true);
  window.addEventListener("pagehide", function(){ clearTimeout(t); fire(); }, true);
  document.body && document.body.addEventListener("submit", function(){ clearTimeout(t); setTimeout(fire,100); }, true);
})();
</script>