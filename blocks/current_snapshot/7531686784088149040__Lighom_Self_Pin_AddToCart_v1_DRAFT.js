<script>
/* Lighom Self Pin — AddToCart v1 (Pinterest-only, master-flag gated, status=2 disabled)
   /products|/cart;独立触发 click + /cart/add.js fetch hook 双源
   event_id 与 FB ATC v2 同公式 (SEID 前缀+canonical) → 跨平台同 event_id
   pintrk('track','addtocart',{value, currency, line_items, event_id}) + Worker fanout=['pinterest'] */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighom_selfpin_atc_v1) return;
  window.__lighom_selfpin_atc_v1 = true;
  if (window.__lighomIsBot) return;
  if (!/\/(products|cart)/.test(location.pathname)) return;  /* #1 去 ^ 锚 */

  var WORKER = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var P = "_lighom_user_";

  /* shared from Util Lib v1 */ var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;
  
  
  
  function decodeEnt(s){ if(typeof s!=="string") return s; for(var i=0;i<3;i++){var p=s; s=s.replace(/&amp;/g,"&").replace(/&gt;/g,">").replace(/&lt;/g,"<").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," "); if(s===p) break;} return s; }
  function readVariants(){ var s = document.querySelector('variant-radios script[type="application/json"]'); if(!s) return []; try { return JSON.parse(s.textContent)||[]; } catch(e){ return []; } }
  function pickSelected(){
    var vs = readVariants(); if (!vs.length) return null;
    var radios = document.querySelectorAll('variant-radios input[type="radio"]:checked');
    if (radios.length) {
      var sel = Array.from(radios).map(function(r){ return r.value; });
      var m = vs.find(function(v){ var t=String(v.title||""); return sel.every(function(o){ return t.indexOf(o)!==-1; }); });
      if (m) return m;
    }
    var qVid = null; try { qVid = new URLSearchParams(location.search).get("variant"); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin ATC v1",e);}
    if (qVid) { var byQ = vs.find(function(v){ return String(v.id)===qVid || v.sku===qVid; }); if (byQ) return byQ; }
    return vs.find(function(v){ return v.available !== false; }) || vs[0];
  }
  function getProductCategory(){
    try { var els = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i=0;i<els.length;i++){ var d=JSON.parse(els[i].textContent||"{}");
        var c = d && (d.category || (d["@graph"] && d["@graph"].find && (d["@graph"].find(function(x){return x.category;})||{}).category));
        if (c) return String(c).slice(0,100);
      }
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin ATC v1",e);} return "";
  }
  function buildVariantParams(variant){
    if (!variant) return null;
    var sku = String(variant.id || variant.sku || ""); if (!sku) return null;
    var price = Number(variant.price || 0) / 100;
    var prodName = ""; try { prodName=(document.querySelector("h1")||{}).textContent||""; } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin ATC v1",e);}
    var contentName = decodeEnt(variant.product_title || variant.title || prodName).trim().slice(0,100);
    var contentCategory = getProductCategory();
    return {
      content_type: "product",
      content_ids: [sku],
      contents: [{ id: sku, quantity: 1, item_price: Math.round(price*100)/100, title: String(variant.title||contentName).slice(0,100), brand: "Lighom", category: contentCategory }],
      content_name: contentName,
      content_category: contentCategory,
      currency: "USD",
      value: Math.round(price*100)/100,
      num_items: 1,
      line_items: [{
        product_id: sku, product_name: contentName.slice(0,100), product_category: contentCategory,
        product_brand: "Lighom", product_quantity: 1, product_price: Math.round(price*100)/100
      }]
    };
  }
  

  var lastFireMs = 0; var lastFireSku = "";
  function fireATC(reason){
    var sel = pickSelected();
    var params = buildVariantParams(sel);
    if (!params || !params.content_ids.length) return;
    var sku = params.content_ids[0];
    var now = Date.now();
    if (sku === lastFireSku && (now - lastFireMs) < 1500) return;
    lastFireMs = now; lastFireSku = sku;

    var event_id = ("atc_" + sku + "_" + now);

    /* 浏览器: pintrk addtocart (Pinterest 标准 event_name 无下划线) */
    try { if (window.pintrk) window.pintrk("track", "addtocart", { value: params.value, currency: params.currency, line_items: params.line_items, event_id: event_id }); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin ATC v1",e);}

    var ud = window.LighomUtil.buildUserData({prefix:P});
    try {
      fetch(WORKER, {
        method: "POST", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_name: "AddToCart", event_id: event_id,
          event_time: Math.floor(now/1000),
          event_source_url: location.href, page_url: location.href, page_path: location.pathname,
          page_type: /\/cart/.test(location.pathname) ? "cart" : "product",
          fanout: ["pinterest"],
          utm: { source: ck("last_utm_source")||ck("first_utm_source")||"", medium: ck("last_utm_medium")||ck("first_utm_medium")||"", campaign: ck("last_utm_campaign")||ck("first_utm_campaign")||"" },
          user_data: ud,
          custom_data: Object.assign({}, params, { data_quality: "self_pin_v1:atc:" + reason })
        })
      });
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin ATC v1",e);}
  }

  /* 触发源 1: 按钮 click */
  document.addEventListener("click", function(e){
    var t = e.target;
    for (var d=0; d<6 && t && t!==document.body; d++){
      var s = ((t.className||"")+" "+(t.id||"")+" "+(t.getAttribute("data-action")||"")).toString().toLowerCase();
      var inner = (t.innerText||"").trim().slice(0,50).toLowerCase();
      if (/add[-_]to[-_]cart|add2cart|btn[-_]cart|^atc$|atc[-_ ]|buynow|buy[-_ ]now/.test(s) || /^add to cart$|^buy now$|加入购物车|立即购买/.test(inner)) {
        setTimeout(function(){ fireATC("click"); }, 100);
        break;
      }
      t = t.parentElement;
    }
  }, { passive: true, capture: true });

  /* 触发源 2: /cart/add.js fetch hook */
  try {
    /* #11 sentinel: 防同块异常重包裹;FB ATC 用 __lighom_atc_fb_hooked, Pin 用 __lighom_atc_pin_hooked */
    if (!window.fetch || !window.fetch.__lighom_atc_pin_hooked) {
      var origFetch = window.fetch;
      var wrapped = function(input, init){
        try {
          var url = (typeof input === "string") ? input : (input && input.url);
          if (url && /\/cart\/add(?:\.js)?(?:[\/?$]|$)/.test(url)) {
            var ret = origFetch.apply(this, arguments);
            ret.then(function(r){ if (r && r.ok !== false) setTimeout(function(){ fireATC("fetch"); }, 80); }).catch(function(){});
            return ret;
          }
        } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin ATC v1",e);}
        return origFetch.apply(this, arguments);
      };
      wrapped.__lighom_atc_pin_hooked = 1;
      window.fetch = wrapped;
    }
  } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin ATC v1",e);}
})();
</script>