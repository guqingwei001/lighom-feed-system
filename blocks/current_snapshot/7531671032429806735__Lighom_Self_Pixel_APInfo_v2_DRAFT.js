<script>
/* Lighom Self Pixel — AddPaymentInfo v2 (FB-only, master-flag gated, status=2 disabled)
   Settle page;email blur 触发;fbq('track','AddPaymentInfo') + Worker /capi/event fanout=['meta']
   全字段: 11 PII + fbp/fbc/epik/ttclid/msclkid/ga_cookie/client_ua + utm + content_ids/contents/value/currency/num_items */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighom_selfpx_apinfo_v2) return;
  window.__lighom_selfpx_apinfo_v2 = true;
  if (window.__lighomIsBot) return;

  var WORKER = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var P = "_lighom_user_";

  /* shared from Util Lib v1 */ var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;
  
  
  
  function isValidEmail(s){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

  function buildUserData(emailRaw){
    var ud = window.LighomUtil.buildUserData({prefix:P});
    if (emailRaw) ud.em = emailRaw;
    /* DOM scrape PII (Worker hashes plain) */
    try {
      function pi(sels){ for (var i=0;i<sels.length;i++){ var n=document.querySelector(sels[i]); if(n&&n.value) return String(n.value).trim(); } return ""; }
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
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB APInfo v2",e);}
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
      return { id: String(li.sku||li.variant_id||li.product_id||""), quantity: li.quantity||1, item_price: Number(li.final_price||li.original_price||0)/100, title: String(li.title||prod.title||"").slice(0,100), brand: "Lighom", category: String(prod.type||"").slice(0,100) };
    });
    var content_ids = contents.map(function(c){ return c.id; }).filter(Boolean);
    if (!content_ids.length) return null;
    var num_items = items.reduce(function(s,li){ return s + (li.quantity||1); }, 0);
    var content_name = items.map(function(li){ return String((li.product&&li.product.title)||li.title||""); }).filter(Boolean).join(", ").slice(0,200);
    var topCat = items[0] && items[0].product && items[0].product.type;
    return { content_type: "product", content_ids: content_ids, contents: contents, currency: String(co.currency||"USD").toUpperCase(), value: Math.round(value*100)/100, num_items: num_items, content_name: content_name, content_category: topCat ? String(topCat).slice(0,100) : "" };
  }

  var fired = false;
  function fire(email){
    if (fired) return;
    var p = buildParams(); if (!p) return;
    fired = true;
    var ts = Date.now();
    var event_id = ("apinfo_" + (ck("cart_token") || ts) + "_" + Math.random().toString(36).slice(2, 9));
    try { if (window.fbq) window.fbq("track", "AddPaymentInfo", p, { eventID: event_id }); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB APInfo v2",e);}
    var ud = buildUserData(email);
    try {
      fetch(WORKER, {
        method: "POST", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_name: "AddPaymentInfo", event_id: event_id,
          event_time: Math.floor(ts/1000),
          event_source_url: location.href, page_url: location.href, page_path: location.pathname,
          page_type: "settle_page",
          fanout: ["meta"],
          utm: { source: ck("last_utm_source")||ck("first_utm_source")||"", medium: ck("last_utm_medium")||ck("first_utm_medium")||"", campaign: ck("last_utm_campaign")||ck("first_utm_campaign")||"" },
          user_data: ud,
          custom_data: Object.assign({}, p, { data_quality: "self_pixel_v2:apinfo" })
        })
      });
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB APInfo v2",e);}
  }

  function emailMatch(t){
    if (!t || t.tagName !== "INPUT") return false;
    return t.type === "email" || /email/i.test(t.name||"") || /email/i.test(t.id||"") || /email/i.test(t.autocomplete||"");
  }
  document.addEventListener("blur", function(e){
    if (!emailMatch(e.target)) return;
    var v = (e.target.value || "").trim();
    if (isValidEmail(v)) fire(v);
  }, true);
  document.addEventListener("change", function(e){
    if (!emailMatch(e.target)) return;
    var v = (e.target.value || "").trim();
    if (isValidEmail(v)) fire(v);
  }, true);
})();
</script>