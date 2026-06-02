<script>
/* Lighom Self Pixel — ViewContent v2 (Phase B 草稿, master-flag gated)
   仅 /products/* 路径,生效条件: window.LIGHOM_SELF_PIXEL_LIVE === true + !__lighomIsBot
   职责:
     1. 浏览器 fbq('track','ViewContent', single_variant_params, {eventID})
     2. Worker /capi/event fanout=['meta'] 同 event_id (Pinterest pagevisit 由 PageView 块发不重复)
     3. 变体切换 3s debounce 重发 (新 event_id, 同步浏览器+Worker)
   全字段:
     custom_data: content_ids/content_type/contents(title+brand+category+item_price)/value/currency/content_name/content_category/num_items
     user_data: em/ph/fn/ln/ct/st/zp/country/db/ge/external_id + fbp/fbc/epik/ttclid/msclkid/ga_cookie/client_ua + utm */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighom_selfpx_vc_v2) return;
  window.__lighom_selfpx_vc_v2 = true;
  if (window.__lighomIsBot) return;
  function onPDP(){ return /\/products\//.test(location.pathname); }  /* 去 ^ 锚: Shopline 嵌套 URL /collections/x/products/y 也属 PDP */
  if (!onPDP()) return;

  var WORKER = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var P = "_lighom_user_";

  /* shared from Util Lib v1 */ var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;
  
  
  
  function decodeEnt(s){
    if (typeof s !== "string") return s;
    for (var i=0;i<3;i++){ var prev=s; s=s.replace(/&amp;/g,"&").replace(/&gt;/g,">").replace(/&lt;/g,"<").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g," "); if(s===prev) break; }
    return s;
  }

  /* 变体侦测 (mirror VC v5.6 经验证逻辑) */
  function readVariants(){
    var s = document.querySelector('variant-radios script[type="application/json"]');
    if (!s) return [];
    try { return JSON.parse(s.textContent) || []; } catch(e){ return []; }
  }
  function pickSelected(){
    var vs = readVariants();
    if (!vs.length) return null;
    var qVid = null; try { qVid = new URLSearchParams(location.search).get("variant"); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB VC v2",e);}
    if (qVid) { var byQ = vs.find(function(v){ return String(v.id) === qVid || v.sku === qVid; }); if (byQ) return byQ; }
    return vs.find(function(v){ return v.available !== false; }) || vs[0];
  }
  function getProductCategory(){
    /* 5/31 fix: DOM breadcrumb 优先(真分类) → BreadcrumbList 中段 → Product.category → OG meta */
    try {
      var bc = document.querySelector('[class*="breadcrumb" i], nav[aria-label*="breadcrumb" i]');
      if (bc) {
        var txt = (bc.textContent||'').replace(/\s+/g,' ').trim();
        var parts = txt.split(/\s*[\/>›»→]\s*/).map(function(s){return s.trim();}).filter(Boolean);
        var prodH = ((document.querySelector("h1")||{}).textContent||'').trim();
        var cats = parts.filter(function(p){ return p && p!=='Lighom' && p!=='Home' && p!==prodH && p.length<60; });
        if (cats.length) return cats.join(' > ').slice(0,100);
      }
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB VC v2",e);}
    try {
      var els = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i=0;i<els.length;i++){
        var d = JSON.parse(els[i].textContent || "{}");
        if (d['@type']==='BreadcrumbList' && Array.isArray(d.itemListElement) && d.itemListElement.length>=3) {
          var mid = d.itemListElement.slice(1,-1).map(function(b){return b.name;}).filter(Boolean);
          if (mid.length) return mid.join(' > ').slice(0,100);
        }
        var c = d && (d.category || (d["@graph"] && d["@graph"].find && (d["@graph"].find(function(x){return x.category;}) || {}).category));
        if (c) return String(c).slice(0,100);
      }
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB VC v2",e);}
    var og = document.querySelector('meta[property="product:category"]');
    if (og && og.content) return og.content.slice(0,100);
    return "";
  }
  function buildVariantParams(variant){
    if (!variant) return null;
    var sku = String(variant.id || variant.sku || "");
    var price = Number(variant.price || 0) / 100;
    var prodName = "";
    try { prodName = ((document.querySelector("h1")||{}).textContent||"").trim(); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB VC v2",e);}
    /* 5/31 fix: h1(产品名) 优先, append 变体限定(如 "Orange / 60") */
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
      contents: [{
        id: sku, quantity: 1,
        item_price: Math.round(price * 100) / 100,
        title: contentName,
        brand: "Lighom",
        category: contentCategory,
        item_group_id: (function(){ var og=document.querySelector('meta[property="product:item_group_id"]'); return og?og.content:""; })()
      }],
      content_name: contentName,
      content_category: contentCategory,
      currency: "USD",
      value: Math.round(price * 100) / 100,
      num_items: 1
    };
  }

  /* 全字段 user_data */
  

  var firedForVariant = {};
  var pageloadSeed = Date.now().toString(36) + Math.random().toString(36).slice(2,6);

  function fireForVariant(variant){
    if (!variant) return;
    var sku = String(variant.id || variant.sku || "");
    if (!sku || firedForVariant[sku]) return;
    firedForVariant[sku] = 1;

    var params = buildVariantParams(variant);
    if (!params || !params.content_ids.length) return;

    var event_id = ("vc_" + sku + "_" + pageloadSeed);

    /* 浏览器腿: fbq track */
    try { if (window.fbq) window.fbq("track", "ViewContent", params, { eventID: event_id }); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB VC v2",e);}

    /* Worker 腿: fanout=['meta'] only (Pinterest pagevisit 由 PageView 块管, 此处不重复发 Pin pagevisit) */
    var ud = window.LighomUtil.buildUserData({prefix:P});
    try {
      fetch(WORKER, {
        method: "POST", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_name: "ViewContent",
          event_id: event_id,
          event_time: Math.floor(Date.now()/1000),
          event_source_url: location.href,
          page_url: location.href, page_path: location.pathname,
          page_type: "product",
          fanout: ["meta"],
          utm: (window.LighomUtil && window.LighomUtil.utm) ? window.LighomUtil.utm() : { source: '', medium: '', campaign: '' } /* D6 5/31 */,
          user_data: ud,
          custom_data: Object.assign({}, params, { data_quality: "self_pixel_v2:vc" })
        })
      });
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB VC v2",e);}
  }

  function go(){
    var sel = pickSelected();
    if (sel) fireForVariant(sel);
    else { /* 重试至变体 JSON 可读 */
      var n=0; var iv=setInterval(function(){
        var s = pickSelected();
        if (s || ++n>40) { clearInterval(iv); if (s) fireForVariant(s); }
      }, 150);
    }
  }
  /* 5/30 fix: wait for _fbp cookie before firing init, mirror PV v1 pattern (max 6s) */
  function _waitFbpThen(fn){ var n = 0; (function c(){ if (ck("_fbp") || ++n > 40) return fn(); setTimeout(c, 150); })(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function(){ _waitFbpThen(go); });
  else _waitFbpThen(go);

  /* 变体切换 3s debounce 重发 (新 sku 触发新 event_id) */
  var changeTimer = null;
  document.addEventListener("change", function(e){
    var t = e.target;
    if (!t) return;
    if (t.tagName !== "INPUT" && t.tagName !== "SELECT") return;
    if (!t.closest || !t.closest("variant-radios")) return;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(function(){
      if (!onPDP()) return;
      var sel = pickSelected();
      if (sel) fireForVariant(sel);
    }, 3000);
  }, true);
})();
</script>