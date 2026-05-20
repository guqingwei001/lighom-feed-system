<script>
/* Lighom Self Pixel — Util Lib v1
   - ck / hxOnly / lsClick
   - collectHashedPII(ud, prefix, exclude)
   - buildUserData(opts) — 全套 user_data
   - logErr(blockName, err) — 上报 self-pixel 块 runtime 异常到 BQ (BQ-only, fanout=[]) */
(function(){
  if (window.LighomUtil && window.LighomUtil.logErr) return;
  function ck(n){ var m = document.cookie.match(new RegExp("(?:^|;\\s*)" + n + "=([^;]+)")); return m ? decodeURIComponent(m[1]) : ""; }
  function hxOnly(v){ return (v && /^[a-f0-9]{64}$/i.test(v)) ? v : ""; }
  function lsClick(name){ try { var v = localStorage.getItem("lighom_clickid_" + name); return v ? v.split(":")[0] : ""; } catch(e){ return ""; } }
  function collectHashedPII(ud, prefix, exclude){
    var P = prefix || "_lighom_user_";
    var skip = (exclude && exclude.length) ? exclude : [];
    ["em","ph","fn","ln","ct","st","zp","country","db","ge","external_id"].forEach(function(f){
      if (skip.indexOf(f) !== -1) return;
      var h = hxOnly(ck(P + f + "_h"));
      if (h) ud[f] = h;
    });
    if (!ud.external_id && skip.indexOf("external_id") === -1) {
      var G = window.__lighom_user_data_hashed;
      if (G && G.external_id) ud.external_id = G.external_id;
      else { var ex = ck(P + "external_id"); if (ex) ud.external_id = ex; }
    }
    if (skip.indexOf("fb_login_id") === -1) {
      var fblid = ck(P + "fb_login_id");
      if (fblid) ud.fb_login_id = fblid;
    }
    return ud;
  }
  function buildUserData(opts){
    opts = opts || {};
    var ud = {};
    var fbc = ck("_fbc") || lsClick("_fbc"); if (fbc) ud.fbc = fbc;
    var fbp = ck("_fbp"); if (fbp) ud.fbp = fbp;
    var epik = ck("_epik") || lsClick("_epik"); if (epik) ud.epik = epik;
    var ttp = ck("_ttp"); if (ttp) ud.ttclid = ttp;
    var msclk = ck("_uetmsclkid"); if (msclk) ud.msclkid = msclk;
    var gaC = ck("_ga"); if (gaC) ud.ga_cookie = gaC;
    collectHashedPII(ud, opts.prefix, opts.exclude);
    ud.client_ua = navigator.userAgent;
    return ud;
  }
  /* logErr — fail-open,自身异常吞掉(免无限循环) */
  var _errBudget = 5; /* 每页面最多 5 条 err 上报,防止刷屏 */
  function logErr(blockName, err){
    try {
      if (_errBudget-- <= 0) return;
      var msg = String((err && err.message) || err).slice(0, 200);
      var stack = String((err && err.stack) || "").slice(0, 500);
      fetch("https://lighom-feed-server.dikecarmem750.workers.dev/capi/event", {
        method: "POST", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_name: "ClientError",
          event_id: "err_" + Date.now() + "_" + Math.random().toString(36).slice(2, 11),
          event_time: Math.floor(Date.now()/1000),
          page_url: location.href, page_path: location.pathname, page_type: "error",
          fanout: [],  /* BQ-only,不发 Meta/Pin/GA4 */
          custom_data: {
            data_quality: "lighom_client_err:" + String(blockName).slice(0, 40),
            err_msg: msg,
            err_stack: stack
          }
        })
      });
    } catch(e){ /* fail-open */ }
  }
  window.LighomUtil = { ck: ck, hxOnly: hxOnly, lsClick: lsClick, collectHashedPII: collectHashedPII, buildUserData: buildUserData, logErr: logErr };
})();
</script>