<script>
/* Lighom Self Pin — ViewContent v1 (Pinterest-only, master-flag gated)
   PDP /products/*; pintrk('track','pagevisit',{line_items,...}) for catalog/DPA match.
   Pin PageView's plain pagevisit co-fires on PDP by design (site-visit vs product-view
   are 2 distinct Pinterest signals per their docs).
   event_id: vc_<sku>_<ts> (mirrors Self Pixel VC pattern). fanout=['pinterest']. */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighom_selfpin_vc_v1) return;
  window.__lighom_selfpin_vc_v1 = true;
  if (window.__lighomIsBot) return;
  if (!/\/products\//.test(location.pathname)) return;

  var WORKER = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var P = "_lighom_user_";

  /* shared from Util Lib v1 */ var ck = window.LighomUtil.ck;

  function decodeEnt(s){ if(typeof s!=="string") return s; for(var i=0;i<3;i++){var p=s; s=s.replace(/&amp;/g,"&").replace(/&gt;/g,">").replace(/&lt;/g,"<").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," "); if(s===p) break;} return s; }
  function readVariants(){ var s = document.querySelector('variant-radios script[type="application/json"]'); if(!s) return []; try { return JSON.parse(s.textContent)||[]; } catch(e){ return []; } }
  function pickSelected(){
    var vs = readVariants(); if (!vs.length) return null;
    var qVid = null; try { qVid = new URLSearchParams(location.search).get("variant"); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin VC v1",e);}
    if (qVid) { var byQ = vs.find(function(v){ return String(v.id)===qVid || v.sku===qVid; }); if (byQ) return byQ; }
    return vs.find(function(v){ return v.available !== false; }) || vs[0];
  }
  function getProductCategory(){
    /* 5/31 fix: DOM breadcrumb 优先 → BreadcrumbList 中段 → Product.category → OG meta */
    try {
      var bc = document.querySelector('[class*="breadcrumb" i], nav[aria-label*="breadcrumb" i]');
      if (bc) {
        var txt = (bc.textContent||'').replace(/\s+/g,' ').trim();
        var parts = txt.split(/\s*[\/>›»→]\s*/).map(function(s){return s.trim();}).filter(Boolean);
        var prodH = ((document.querySelector("h1")||{}).textContent||'').trim();
        var cats = parts.filter(function(p){ return p && p!=='Lighom' && p!=='Home' && p!==prodH && p.length<60; });
        if (cats.length) return cats.join(' > ').slice(0,100);
      }
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin VC v1",e);}
    try { var els = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i=0;i<els.length;i++){ var d=JSON.parse(els[i].textContent||"{}");
        if (d['@type']==='BreadcrumbList' && Array.isArray(d.itemListElement) && d.itemListElement.length>=3) {
          var mid = d.itemListElement.slice(1,-1).map(function(b){return b.name;}).filter(Boolean);
          if (mid.length) return mid.join(' > ').slice(0,100);
        }
        var c = d && (d.category || (d["@graph"] && d["@graph"].find && (d["@graph"].find(function(x){return x.category;})||{}).category));
        if (c) return String(c).slice(0,100);
      }
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin VC v1",e);}
    var og = document.querySelector('meta[property="product:category"]');
    if (og && og.content) return og.content.slice(0,100);
    return "";
  }
  function buildVariantParams(variant){
    if (!variant) return null;
    var sku = String(variant.id || variant.sku || ""); if (!sku) return null;
    var price = Number(variant.price || 0) / 100;
    var prodName = ""; try { prodName=((document.querySelector("h1")||{}).textContent||"").trim(); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin VC v1",e);}
    /* 5/31 fix: h1 优先, append 变体限定 */
    var vQual = String(variant.title||"").trim();
    var contentName = (function(){
      var base = prodName || variant.product_title || vQual;
      if (prodName && vQual && !/^default title$/i.test(vQual) && prodName.indexOf(vQual)===-1) return decodeEnt(prodName + ' - ' + vQual).slice(0,100);
      return decodeEnt(base).slice(0,100);
    })();
    var contentCategory = getProductCategory();
    return {
      content_type: "product",
      content_ids: [sku],
      contents: [{ id: sku, quantity: 1, item_price: Math.round(price*100)/100, title: contentName, brand: "Lighom", category: contentCategory, item_group_id: (function(){ var og=document.querySelector('meta[property="product:item_group_id"]'); return og?og.content:""; })() }],
      content_name: contentName,
      content_category: contentCategory,
      currency: "USD",
      value: Math.round(price*100)/100,
      num_items: 1,
      line_items: [{
        product_id: sku, product_name: contentName.slice(0,100), product_category: contentCategory,
        product_brand: "Lighom", product_quantity: 1, product_price: Math.round(price*100)/100,
        item_group_id: (function(){ var og=document.querySelector('meta[property="product:item_group_id"]'); return og?og.content:""; })()
      }]
    };
  }

  function fireVC(reason){
    var sel = pickSelected();
    var params = buildVariantParams(sel);
    if (!params || !params.content_ids.length) return;
    var sku = params.content_ids[0];
    var now = Date.now();
    var event_id = ("vc_" + sku + "_" + now);

    try { if (window.pintrk) window.pintrk("track", "pagevisit", { value: params.value, currency: params.currency, line_items: params.line_items, event_id: event_id }); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin VC v1",e);}

    var ud = window.LighomUtil.buildUserData({prefix:P});
    try {
      fetch(WORKER, {
        method: "POST", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_name: "ViewContent", event_id: event_id,
          event_time: Math.floor(now/1000),
          event_source_url: location.href, page_url: location.href, page_path: location.pathname,
          page_type: "product",
          fanout: ["pinterest"],
          pinterest_event_id: (window.LIGHOM_PAGEVISIT_ID || event_id),
          utm: (window.LighomUtil && window.LighomUtil.utm) ? window.LighomUtil.utm() : { source: '', medium: '', campaign: '' } /* D6 5/31 */,
          user_data: ud,
          custom_data: Object.assign({}, params, { data_quality: "self_pin_v1:vc:" + reason })
        })
      });
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin VC v1",e);}
  }

  var lastFireMs = 0; var lastFireSku = "";
  function maybeFire(reason){
    var sel = pickSelected(); if (!sel) return;
    var sku = String(sel.id || sel.sku || ""); if (!sku) return;
    var now = Date.now();
    if (sku === lastFireSku && (now - lastFireMs) < 3000) return;
    lastFireMs = now; lastFireSku = sku;
    fireVC(reason);
  }
  function start(){
    /* attach variant listener immediately so user can switch variants without delay */
    try {
      document.addEventListener("change", function(e){
        var t = e.target;
        if (t && t.name && /option|variant|color|size/i.test(t.name)) setTimeout(function(){ maybeFire("variant"); }, 80);
      }, { passive: true, capture: true });
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin VC v1",e);}
    /* 5/30 fix: wait for _fbp cookie before firing init, mirror PV v1 pattern (max 6s) */
    var __vcN = 0;
    (function __waitFbp(){
      if (ck("_fbp") || ++__vcN > 40) return maybeFire("init");
      setTimeout(__waitFbp, 150);
    })();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
</script>