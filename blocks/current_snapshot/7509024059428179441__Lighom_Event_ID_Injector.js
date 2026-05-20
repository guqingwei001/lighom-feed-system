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

  /* 2026-05-20: v2 pintrk hijack disabled for 24h verify cycle.
     Hypothesis: User Data Enricher v10's pintrk hijack v3 (inner-wrapper, overwrites
     event_id last) makes this hijack dead code. After 24h, if Pinterest event_id dedup
     metrics unchanged → truly delete this block below. If Pinterest dedup BREAKS (would
     mean Enricher load order shifted or Enricher disabled), revert by removing return. */
  return;

  /* ====== v2 NEW: pintrk hijack ====== */
  if (window.__lighom_pintrk_hijacked_v2) return;

  /* Stable IDs per page load (pagevisit) and per event-type+path (others) */
  var PAGEVISIT_ID = 'lighom_pagevisit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  function genStableId(name){
    return 'lighom_' + name + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
  /* Session-scoped IDs for non-pagevisit events (search/addtocart/checkout â multiple fires share id) */
  var sessionIds = {};
  try {
    var raw = sessionStorage.getItem('lighom_pintrk_session_ids');
    if (raw) sessionIds = JSON.parse(raw) || {};
  } catch(e){}
  function saveSessionIds(){
    try { sessionStorage.setItem('lighom_pintrk_session_ids', JSON.stringify(sessionIds)); } catch(e){}
  }

  /* Mutate a single pintrk track call's params in place â unify event_id + inject value */
  function mutateTrackArgs(args){
    try {
      if (args[0] !== 'track' || typeof args[1] !== 'string') return;
      var name = args[1].toLowerCase();
      if (!args[2] || typeof args[2] !== 'object') args[2] = {};
      var data = args[2];

      /* (1) Unify event_id */
      if (name === 'pagevisit') {
        data.event_id = PAGEVISIT_ID;
      } else {
        var key = name + '|' + (window.location && location.pathname || '');
        if (!sessionIds[key]) {
          sessionIds[key] = genStableId(name);
          saveSessionIds();
        }
        if (!data.event_id) data.event_id = sessionIds[key];
      }

      /* (2) Top-level value injection from line_items if missing */
      var needsValue = !(typeof data.value === 'number' && data.value > 0);
      if (needsValue && Array.isArray(data.line_items) && data.line_items.length) {
        var total = 0;
        for (var i = 0; i < data.line_items.length; i++) {
          var li = data.line_items[i] || {};
          var p = Number(li.product_price || li.price || li.item_price || 0);
          var q = Number(li.product_quantity || li.quantity || 1);
          if (p > 0) total += p * q;
        }
        if (total > 0) {
          data.value = Math.round(total * 100) / 100;
          if (!data.currency) data.currency = 'USD';
        }
      }
    } catch(e){}
  }

  function hijackPintrk(){
    if (typeof window.pintrk !== 'function') return false;
    if (window.pintrk.__lighom_v2) return true;

    /* Mutate any items already queued before our hijack ran */
    try {
      if (Array.isArray(window.pintrk.queue)) {
        for (var i = 0; i < window.pintrk.queue.length; i++) {
          mutateTrackArgs(window.pintrk.queue[i]);
        }
      }
    } catch(e){}

    var orig = window.pintrk;
    var wrapped = function(){
      mutateTrackArgs(arguments);
      return orig.apply(this, arguments);
    };
    /* Copy static props (loaded, queue, etc.) */
    for (var k in orig) { try { wrapped[k] = orig[k]; } catch(e){} }
    wrapped.__lighom_v2 = true;
    window.pintrk = wrapped;
    window.__lighom_pintrk_hijacked_v2 = true;
    return true;
  }

  if (!hijackPintrk()) {
    var attempts = 0;
    var iv = setInterval(function(){
      if (hijackPintrk() || ++attempts > 60) clearInterval(iv);
    }, 100);
  }
})();
</script>
