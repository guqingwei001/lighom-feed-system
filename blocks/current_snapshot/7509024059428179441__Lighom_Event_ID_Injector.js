<script>
/* Lighom Event ID Injector v2 â v1 dataLayer hijack + pintrk hijack for pagevisit dedup + Order Value injection.
   Why v2 (2026-05-15):
   - v1 only hijacked dataLayer.push (Meta/GTM event_id injection)
   - Pinterest fires 2Ã pagevisit per page load (Lighom code + Shopline native) with DIFFERENT event_ids
     â Pinterest cannot dedup â "Event ID needed in Page Visit" warning.
   - Shopline native pintrk pagevisit / addtocart / checkout has NO top-level `value` field
     â Pinterest "Order Value in Checkout/AddToCart" Top 3 EQ warnings.
   v2 hijacks window.pintrk to:
     (1) Unify pagevisit event_id across all calls in the same page load.
     (2) Compute top-level value from line_items[].product_price * product_quantity when missing.
   Risk note: closure scope trap (fbq hijack incident 5/9) â all needed vars declared inside wrapped().
*/
(function(){
  /* ====== v1 dataLayer hijack (unchanged) ====== */
  window.dataLayer = window.dataLayer || [];
  var origPush = window.dataLayer.push;
  function genId(name){
    return (name || 'evt') + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
  window.dataLayer.push = function(){
    for (var i = 0; i < arguments.length; i++) {
      var item = arguments[i];
      if (!item || typeof item !== 'object') continue;
      if (!Array.isArray(item) && item.event && !item.event_id) {
        item.event_id = genId(item.event);
      }
      if (item['0'] === 'event' && typeof item['1'] === 'string') {
        var params = item['2'];
        if (typeof params !== 'object' || params === null) {
          item['2'] = params = {};
        }
        if (!params.event_id) {
          params.event_id = genId(item['1']);
        }
      }
    }
    return origPush.apply(this, arguments);
  };

  /* 5/31 EID Injector cleanup: removed v2 pintrk hijack ~90 LOC (was gated by `return;` after Self Pin blocks (Base/PV/VC/ATC/Purchase v1) took over Pinterest event_id management 2026-05-22). dataLayer.push hijack above still in use for GTM events. */
})();
</script>
