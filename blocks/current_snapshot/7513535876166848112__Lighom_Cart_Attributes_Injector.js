<script>
/* Lighom Cart Attributes Injector v1 */
(function(){
  if (window.__lighom_cart_attrs_v1) return;
  window.__lighom_cart_attrs_v1 = true;
  if (window.LighomUtil && window.LighomUtil.isBot && window.LighomUtil.isBot()) return; /* D4 5/31 */
  function ck(n){ var m = document.cookie.match(new RegExp("(?:^|;\\s*)" + n + "=([^;]+)")); return m ? decodeURIComponent(m[1]) : ""; }
  function buildAttrs(){
    var a = {};
    var fbc = ck("_fbc"); if (fbc) a._fbc = fbc;
    var fbp = ck("_fbp"); if (fbp) a._fbp = fbp;
    if (navigator.userAgent) a._user_agent = navigator.userAgent.slice(0, 500);
    var fus = ck("first_utm_source"); if (fus) a._first_utm_source = fus;
    var fum = ck("first_utm_medium"); if (fum) a._first_utm_medium = fum;
    var fuc = ck("first_utm_campaign"); if (fuc) a._first_utm_campaign = fuc;
    var lus = ck("last_utm_source"); if (lus) a._last_utm_source = lus;
    var lum = ck("last_utm_medium"); if (lum) a._last_utm_medium = lum;
    var luc = ck("last_utm_campaign"); if (luc) a._last_utm_campaign = luc;
    var gcl = ck("_gcl_aw"); if (gcl) a._gcl_aw = gcl;
    var epik = ck("_epik"); if (epik) a._epik = epik;
    var ttp = ck("_ttp"); if (ttp) a._ttp = ttp;
    var msclk = ck("_uetmsclkid"); if (msclk) a._msclkid = msclk;
    return a;
  }
  function pushAttrs(){
    var a = buildAttrs();
    if (!Object.keys(a).length) return;
    try {
      fetch("/cart/update.js", { method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ attributes: a })
      }).catch(function(){});
    } catch(e){}
  }
  function whenReady(){ var n=0; var iv=setInterval(function(){ if (ck("_fbp") || ++n>40){ clearInterval(iv); pushAttrs(); } }, 150); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", whenReady);
  } else { whenReady(); }
  var lastPush = 0;
  document.addEventListener("click", function(e){
    var t = e.target;
    for (var d = 0; d < 6 && t && t !== document.body; d++) {
      var s = ((t.className || "") + " " + (t.id || "") + " " + (t.getAttribute("data-action") || "")).toString().toLowerCase();
      var inner = (t.innerText || "").trim().slice(0, 50).toLowerCase();
      if (/add[-_]to[-_]cart|add2cart|btn[-_]cart|atc|buynow|buy[-_]now/.test(s) || /^add to cart$|^buy now$|加入购物车|立即购买/.test(inner)) {
        if (Date.now() - lastPush > 1500) { lastPush = Date.now(); setTimeout(pushAttrs, 1000); }
        break;
      }
      t = t.parentElement;
    }
  }, { passive: true, capture: true });
  document.addEventListener("click", function(e){
    var t = e.target;
    for (var d = 0; d < 6 && t && t !== document.body; d++) {
      var s = ((t.className || "") + " " + (t.id || "") + " " + (t.getAttribute("data-action") || "")).toString().toLowerCase();
      var href = (t.getAttribute("href") || "").toLowerCase();
      var inner = (t.innerText || "").trim().slice(0, 50).toLowerCase();
      if (/checkout/.test(s) || /\/checkout/.test(href) || /^check ?out$|^checkout$|去结算|去付款/.test(inner)) {
        pushAttrs(); break;
      }
      t = t.parentElement;
    }
  }, { passive: true, capture: true });
})();
</script>