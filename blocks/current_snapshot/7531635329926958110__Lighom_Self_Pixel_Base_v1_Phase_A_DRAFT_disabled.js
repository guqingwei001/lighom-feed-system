<script>
/* Lighom Self Pixel — Base v1 FB-only (Phase B 草稿, master-flag gated, status=2 disabled)
   职责: 加载 Meta fbevents.js + fbq('init', PIXEL_ID, advancedMatching).
   Pinterest tag loader / pintrk init 待 Pinterest 阶段单独建块加,本块**纯 FB**.
   Phase D 翻 LIGHOM_SELF_PIXEL_LIVE=true 后此块才会执行(同步原子关原生 FB pixel). */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighomSelfPixelBase_v1) return;
  window.__lighomSelfPixelBase_v1 = true;
  if (window.__lighomIsBot) return;

  var META_PIXEL_ID = '479292381165317';
  /* shared from Util Lib v1 (id 7531852299762928771) */
  var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;

  /* === Meta Pixel base loader (官方 verbatim) === */
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
    (window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

  /* === fbq init + Advanced Matching === */
  /* Manual Advanced Matching — literal object keys for Meta static detection.
     Raw values; Meta SDK auto-normalizes + hashes. Empty keys are dropped before init. */
  var ud = {
    em: ck('_lighom_user_em'),
    ph: ck('_lighom_user_ph'),
    fn: ck('_lighom_user_fn'),
    ln: ck('_lighom_user_ln'),
    ct: ck('_lighom_user_ct'),
    st: ck('_lighom_user_st'),
    zp: ck('_lighom_user_zp'),
    country: ck('_lighom_user_country'),
    external_id: ck('_lighom_user_external_id')
  };
  /* 5/31 Base/Persist race fix (#8): Base v1 inserts before PII Persist v1 in DOM (id order),
     so when Base reads cookies the Persist→cookie bridge hasn't run yet — returning customer
     Manual AAM empty for first page. Inline LS read here, fully synchronous, no race.
     LS values are hashed; SDK auto-detects 64-hex and skips re-hashing. */
  try {
    var _lh = localStorage.getItem('lh_pii_v1');
    if (_lh) {
      var _o = JSON.parse(_lh);
      if (_o && _o.t && (Date.now() - _o.t) < 365*24*3600*1000 && _o.d) {
        ['em','ph','fn','ln','ct','st','zp','country','external_id'].forEach(function(k){
          if (!ud[k] && _o.d[k] && /^[a-f0-9]{64}$/.test(String(_o.d[k]))) ud[k] = _o.d[k];
        });
      }
    }
  } catch(e){}
  Object.keys(ud).forEach(function(k){ if (!ud[k]) delete ud[k]; });
  /* 5/31 fix: empty ud → call fbq init WITHOUT 3rd arg (still initializes Pixel; only Automatic AAM, no fake-empty Manual AAM signal).
     Non-empty ud → call with ud (Manual AAM active). Both branches initialize Pixel — fbq track events fire either way. */
  try {
    if (window.fbq) {
      if (Object.keys(ud).length > 0) window.fbq('init', META_PIXEL_ID, ud);
      else window.fbq('init', META_PIXEL_ID);
    }
  } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB Base v1",e);}

  /* INTENTIONAL: no fbq('track','PageView') here — Phase B PageView v2 block 自带 fbq track + Worker /capi/event */
})();
</script>