<script>
/* Lighom Self Pixel — PII Persistence v1 (5/31)
   返客 hashed em/ph 持久化到 localStorage，VC/ATC EMQ 7.5 → 8+
   - SEED: 页面加载时把 LS 里的 hashed PII 注入 __lighom_user_data_hashed 池
   - WATCH: 监听池中新增，回写 LS（merge 不覆盖）
   - HASH 校验: SHA256 64-char hex 才存；country/ge/db 长度限制 */
(function(){
  if (window.__lighom_pii_persist_v1) return;
  window.__lighom_pii_persist_v1 = true;

  var LS_KEY = 'lh_pii_v1';
  var TTL_MS = 365 * 24 * 3600 * 1000;
  var HASH_RE = /^[a-f0-9]{64}$/;
  var SHORT_OK = { country: 1, ge: 1, db: 1 };
  var FIELDS = ['em','ph','fn','ln','ct','st','zp','country','ge','db','external_id'];

  function readLS(){
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.t || (Date.now() - o.t > TTL_MS)) {
        try { localStorage.removeItem(LS_KEY); } catch(e){}
        return null;
      }
      return o.d || null;
    } catch(e) { return null; }
  }

  /* 5/31 G2: bridge pool ↔ cookies — if cookie absent + pool has hashed value, write hashed to cookie 90d. Worker maybeHashArr() detects 64-char hex and passes through (no double-hash). Self Pixel Base v1 fbq init also accepts hashed (SDK auto-detects). NEVER overwrites existing cookie (preserves raw from Subscribe/Lead). */
  function _readCk(name){ try { var m=document.cookie.match(new RegExp('(?:^|;\\s*)'+name+'=([^;]+)')); return m?decodeURIComponent(m[1]):''; } catch(e){ return ''; } }
  function _setCk(name, val){ if (!val) return; try { document.cookie = name+'='+encodeURIComponent(val)+';path=/;max-age='+(90*86400)+';SameSite=Lax;domain=lighom.com'; } catch(_){} }
  function _delCk(name){ try { document.cookie = name+'=;path=/;max-age=0;domain=lighom.com'; document.cookie = name+'=;path=/;max-age=0'; } catch(_){} }
  /* 5/31 bridge self-heal: prior bridge wrote hashed values to no-suffix cookies. Detect 64-hex in raw-target cookies (raw values are NEVER 64-hex SHA — em has @, ext_id digits, country alpha-2, etc.) and wipe so next Subscribe/Lead can write raw cleanly. */
  function selfHealRawCookies(){
    var RAW_TARGETS = ['_lighom_user_em','_lighom_user_ph','_lighom_user_fn','_lighom_user_ln','_lighom_user_ct','_lighom_user_st','_lighom_user_zp','_lighom_user_country','_lighom_user_external_id'];
    for (var i=0; i<RAW_TARGETS.length; i++) {
      var v = _readCk(RAW_TARGETS[i]);
      if (v && /^[a-f0-9]{64}$/i.test(v)) _delCk(RAW_TARGETS[i]);
    }
  }
  function bridgeToCookies(){
    var pool = window.__lighom_user_data_hashed; if (!pool) return;
    /* 5/31 root fix bridge to _h suffix: original COOKIE_MAP wrote hashed pool to NO-suffix cookies (reserved for raw values from Subscribe/Lead). Returning customer with empty _h cookies got hashed values stomped into raw-target slots, breaking Enricher re-hash (saved by sha256 hex passthrough Fix #2c), ccyFromCountry (saved by alpha-2 guard #2b), and Worker external_id (saved by HEX64 passthrough #2a). All 3 cascade defenses stay as belt-and-suspenders; this is the suspenders. */
    var COOKIE_MAP = { em:'_lighom_user_em_h', ph:'_lighom_user_ph_h', fn:'_lighom_user_fn_h', ln:'_lighom_user_ln_h', ct:'_lighom_user_ct_h', st:'_lighom_user_st_h', zp:'_lighom_user_zp_h', country:'_lighom_user_country_h', external_id:'_lighom_user_external_id_h' };
    for (var k in COOKIE_MAP) {
      if (pool[k] && !_readCk(COOKIE_MAP[k])) _setCk(COOKIE_MAP[k], pool[k]);
    }
  }

  function writeLS(data){
    try {
      var clean = {};
      var has = false;
      for (var i = 0; i < FIELDS.length; i++) {
        var k = FIELDS[i];
        var v = data[k];
        if (typeof v !== 'string' || !v) continue;
        if (SHORT_OK[k]) {
          if (v.length > 100) continue;
          clean[k] = v; has = true;
        } else if (HASH_RE.test(v)) {
          clean[k] = v; has = true;
        }
      }
      if (!has) return;
      var prev = readLS() || {};
      for (var pk in prev) if (!clean[pk]) clean[pk] = prev[pk];
      localStorage.setItem(LS_KEY, JSON.stringify({ t: Date.now(), d: clean }));
    } catch(e){}
  }

  var SEED = readLS() || {};
  var seededKeys = Object.keys(SEED);

  function ensure(){
    if (!window.__lighom_user_data_hashed) window.__lighom_user_data_hashed = {};
    var pool = window.__lighom_user_data_hashed;
    for (var k in SEED) {
      if (!pool[k]) pool[k] = SEED[k];
    }
  }

  // 多次 seed 兜底 (其它块若重置池, 这里能补回来)
  ensure();
  selfHealRawCookies(); /* 5/31 bridge self-heal — once per page load before bridge writes */
  bridgeToCookies();
  var seedTicks = 0;
  var seedIv = setInterval(function(){
    ensure();
    bridgeToCookies();
    if (++seedTicks > 30) clearInterval(seedIv);
  }, 100);

  // WATCH: 2 min 内监听池, 新 PII 回写 LS
  var lastJson = '';
  function watch(){
    var pool = window.__lighom_user_data_hashed;
    if (!pool) return;
    var snap = {};
    for (var i = 0; i < FIELDS.length; i++) {
      var k = FIELDS[i];
      if (pool[k]) snap[k] = pool[k];
    }
    var s = JSON.stringify(snap);
    if (s === lastJson || s === '{}') return;
    lastJson = s;
    writeLS(snap);
  }

  var watchTicks = 0;
  var watchIv = setInterval(function(){
    watch();
    bridgeToCookies();
    if (++watchTicks > 120) clearInterval(watchIv);
  }, 1000);

  window.addEventListener('pagehide', watch, true);
  window.addEventListener('beforeunload', watch, true);

  // diag
  window.__lighom_pii_persist_v1_diag = function(){
    return {
      seeded_count: seededKeys.length,
      seeded_keys: seededKeys,
      pool_now: window.__lighom_user_data_hashed,
      ls_now: readLS()
    };
  };
})();
</script>