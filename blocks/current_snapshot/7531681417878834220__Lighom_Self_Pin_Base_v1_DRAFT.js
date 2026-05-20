<script>
/* Lighom Self Pin — Base v1 (Pinterest-only loader + Enhanced Match, master-flag gated, status=2 disabled)
   职责: 加载 s.pinimg.com/ct/core.js + pintrk('load', TAG_ID, EM)
   故意不做: 不 pintrk('page'),不发任何 pintrk('track')(各事件块自行发,自带 event_id 与 FB+Worker 共享 dedup)
   Pinterest Enhanced Match 接受字段: em/ph/fn/ln/ct/st/zp/country/external_id/ge(无 db) */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighomSelfPinBase_v1) return;
  window.__lighomSelfPinBase_v1 = true;
  if (window.__lighomIsBot) return;

  var PIN_TAG_ID = '2614211257021';
  /* shared from Util Lib v1 (id 7531852299762928771) */
  var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;

  /* === Pinterest tag base loader (官方 verbatim) === */
  !function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};
    var n=window.pintrk;n.queue=[],n.version='3.0';
    var t=document.createElement('script');t.async=!0,t.src=e;
    var r=document.getElementsByTagName('script')[0];r.parentNode.insertBefore(t,r)}}
    ('https://s.pinimg.com/ct/core.js');

  /* === pintrk load + Enhanced Match === */
  var em = {}; window.LighomUtil.collectHashedPII(em, undefined, ["db"]);
  try { if (window.pintrk) window.pintrk('load', PIN_TAG_ID, em); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin Base v1",e);}

  /* INTENTIONAL: 不发 pintrk('page'),pagevisit 由 Self Pin PageView v1 块发(自带 event_id dedup) */
})();
</script>