<script>
/* Lighom Self Pixel — AddPaymentInfo v4 (5/31 strict semantic: only fire on real payment-info interaction)
   Settle page;严格按 Meta 定义只在用户"真填支付信息"时 fire(payment field blur / payment method change / place-order click)
   v3 → v4: 砍掉 rich/pagehide/inactivity 兜底(语义污染);单次 fire(singleton);stable event_id
   InitiateCheckout 那种宽语义 + 兜底机制保留在 PixelIC 块,此块专注 AddPaymentInfo 严格触发 */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighom_selfpx_apinfo_v4) return;
  window.__lighom_selfpx_apinfo_v4 = true;
  if (window.__lighomIsBot) return;

  var WORKER = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var P = "_lighom_user_";

  /* shared from Util Lib v1 */ var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;

  function isValidEmail(s){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

  function buildUserData(){
    var ud = window.LighomUtil.buildUserData({prefix:P});
    /* DOM scrape PII (shipping + contact fields user filled by the time payment is reached) */
    try {
      function pi(sels){ for (var i=0;i<sels.length;i++){ var n=document.querySelector(sels[i]); if(n&&n.value) return String(n.value).trim(); } return ""; }
      var em = pi(['input[type="email"]','input[name*="email" i]','input[autocomplete="email"]']);
      if (em && isValidEmail(em) && !ud.em) ud.em = em.toLowerCase();
      var dom = {
        ph: pi(['input[type="tel"]','input[name*="phone" i]','input[autocomplete="tel"]']),
        fn: pi(['input[name*="firstName" i]','input[name*="first_name" i]','input[autocomplete="given-name"]']),
        ln: pi(['input[name*="lastName" i]','input[name*="last_name" i]','input[autocomplete="family-name"]']),
        ct: pi(['input[name*="city" i]','input[autocomplete="address-level2"]']),
        st: pi(['input[name*="province" i]','input[name*="state" i]','select[name*="province" i]','input[autocomplete="address-level1"]']),
        zp: pi(['input[name*="zip" i]','input[name*="postal" i]','input[autocomplete="postal-code"]']),
        country: pi(['select[name*="country" i]','input[autocomplete="country"]'])
      };
      ["ph","fn","ln","ct","st","zp","country"].forEach(function(k){ if (dom[k] && !ud[k]) ud[k] = dom[k]; });
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB APInfo v4",e);}
    ud.client_ua = navigator.userAgent;
    return ud;
  }

  function buildParams(){
    var ps = window.__PRELOAD_STATE__ || {}; var co = ps.checkout || {};
    var items = co.line_items || [];
    var preloadTotal = Number(co.total_price) / 100 || 0;
    var itemsTotal = items.reduce(function(s,li){ return s + Number((li.final_price||li.original_price||0)/100) * (li.quantity||1); }, 0);
    var value = preloadTotal > 0 ? preloadTotal : itemsTotal;
    if (!value || value <= 0 || !items.length) return null;
    var contents = items.map(function(li){
      var prod = li.product || {};
      return { id: String(li.sku||li.variant_id||li.product_id||""), quantity: li.quantity||1, item_price: Number(li.final_price||li.original_price||0)/100, title: String(li.title||prod.title||"").slice(0,100), brand: "Lighom", item_group_id: String(li.product_id||li.productSeq||(prod&&prod.id)||""), category: String(prod.type||prod.product_custom_type||li.product_custom_type||li.customCategoryName||li.category||li.item_category||"").slice(0,100) /* 5/31 APInfo category fallback (#7) */ };
    });
    var content_ids = contents.map(function(c){ return c.id; }).filter(Boolean);
    if (!content_ids.length) return null;
    var num_items = items.reduce(function(s,li){ return s + (li.quantity||1); }, 0);
    var content_name = items.map(function(li){ return String((li.product&&li.product.title)||li.title||""); }).filter(Boolean).join(", ").slice(0,200);
    var topCat = items[0] && (
      (items[0].product && (items[0].product.type || items[0].product.product_custom_type))
      || items[0].product_custom_type || items[0].customCategoryName || items[0].category || items[0].item_category
    ); /* 5/31 APInfo category fallback (#7) — mirror IC v3 canonical chain */
    return { content_type: "product", content_ids: content_ids, contents: contents, currency: String(co.currency||"USD").toUpperCase(), value: Math.round(value*100)/100, num_items: num_items, content_name: content_name, content_category: topCat ? String(topCat).slice(0,100) : "" };
  }

  /* stable event_id per cart_token — single fire, Meta first-wins dedup */
  var stableEventId = (function(){
    try { var c = sessionStorage.getItem("lighom_apinfo_v4_event_id"); if (c) return c; } catch(e){}
    var tok = ck("cart_token") || Date.now();
    var id = "apinfo_" + tok + "_" + Math.random().toString(36).slice(2,9);
    try { sessionStorage.setItem("lighom_apinfo_v4_event_id", id); } catch(e){}
    return id;
  })();

  var fired = false;
  function doFire(reason){
    if (fired) return;
    var p = buildParams(); if (!p) return;
    fired = true;
    var ud = buildUserData();
    var nowSec = Math.floor(Date.now()/1000);  /* fire 即用户即时操作 → 时间准确 */
    try { if (window.fbq) window.fbq("track", "AddPaymentInfo", p, { eventID: stableEventId }); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB APInfo v4",e);}
    try {
      fetch(WORKER, {
        method: "POST", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_name: "AddPaymentInfo", event_id: stableEventId,
          event_time: nowSec,
          event_source_url: location.href, page_url: location.href, page_path: location.pathname,
          page_type: "settle_page",
          fanout: ["meta"],
          utm: (window.LighomUtil && window.LighomUtil.utm) ? window.LighomUtil.utm() : { source: '', medium: '', campaign: '' } /* D6 5/31 */,
          user_data: ud,
          custom_data: Object.assign({}, p, { data_quality: "self_pixel_v4:apinfo:" + reason })
        })
      });
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB APInfo v4",e);}
  }

  /* trigger 1: payment field interaction (cardholder name / card type select / cc-* autocomplete) */
  function isPaymentField(t){
    if (!t || (t.tagName !== "INPUT" && t.tagName !== "SELECT")) return false;
    var hint = (t.name || "") + " " + (t.id || "") + " " + (t.autocomplete || "") + " " + ((t.className && t.className.toString()) || "");
    /* cc-name / cc-number / cc-exp / cc-csc / cc-type / card-holder / cvv / cvc / credit-card 等 */
    return /\bcc-(name|number|exp|csc|type|family-name|given-name)\b|card[-_]?(number|holder|name|expiry|cvv|cvc|exp)|\bcvv\b|\bcvc\b|credit[-_]?card|card[-_]?info/i.test(hint);
  }
  /* trigger 2: payment method selection (radio/select changed to a payment option) */
  function isPaymentMethodSelector(t){
    if (!t || (t.tagName !== "INPUT" && t.tagName !== "SELECT")) return false;
    var hint = (t.name || "") + " " + (t.id || "") + " " + ((t.className && t.className.toString()) || "") + " " + (t.value || "");
    return /payment[-_]?method|paymethod|payment[-_]?type|payment[-_]?option|gateway|paypal|stripe/i.test(hint);
  }
  document.addEventListener("blur", function(e){
    if (isPaymentField(e.target)) doFire("payfield");
  }, true);
  document.addEventListener("change", function(e){
    var t = e.target;
    if (isPaymentField(t)) doFire("payfield");
    else if (isPaymentMethodSelector(t)) doFire("paymethod");
  }, true);

  /* trigger 3: place-order / pay-now button click (strongest signal, definitely has payment info) */
  document.addEventListener("click", function(e){
    var t = e.target; if (!t) return;
    var txt = (t.textContent || t.value || "").toLowerCase();
    var hint = ((t.className||"") + " " + (t.id||"") + " " + ((t.getAttribute && t.getAttribute("data-role"))||"")).toLowerCase();
    if (/place.{0,3}order|pay.{0,3}now|complete.{0,5}order|submit.{0,5}order|提交订单|立即付款|确认支付|pay\s*\$/i.test(txt + " " + hint)) {
      setTimeout(function(){ doFire("submit"); }, 50);
    }
  }, true);
})();
</script>
