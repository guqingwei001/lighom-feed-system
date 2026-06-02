<script>
/* Lighom User Data Enricher v10 — Device UUID fallback for external_id (anonymous device ID when no real customer ID; SHA-256 hashed by updateData). v8: hashed cookie persist (_*_h suffix) + sync seed of __lighom_user_data_hashed (eliminates VC race). v7: URL params + multi-cookie + sessionStorage + MutationObserver + extended fields + Pinterest Enhanced Match */
(function(){
  if (window.__lighom_userdata_enricher_v10) return;
  window.__lighom_userdata_enricher_v10 = true;

  /* Bot guard — skip Meta/Pinterest/Google crawlers + headless browsers (saves 30-50% sGTM cost) */
  if (window.LighomUtil && window.LighomUtil.isBot && window.LighomUtil.isBot()) return; /* D4 5/31 */

  var PIXEL_ID = "479292381165317";
  var PINTEREST_TAG_ID = "2614211257021";
  var lastPintrkSet = "";
  var lastGtagSet = "";
  var COOKIE_PREFIX = "_lighom_user_";
  var SESSION_KEY = "__lighom_session_userdata";
  var rawCache = {};
  var hashedCache = {};
  var pending = false;
  var lastFbqInit = "";
  var EVENT_NAMES = /^(purchase|add_payment_info|begin_checkout|add_to_cart|complete_registration|search|view_item|view_item_list|view_category|view_content|initiate_checkout|search_submitted)$/i;
  var GTAG_ECOM = /^(view_item|view_item_list|add_to_cart|begin_checkout|add_payment_info|add_shipping_info|search|select_item|select_promotion|view_promotion|remove_from_cart|view_cart)$/i;
  /* All AAM-supported fields (Meta hashes these auto). Includes #6 extended: ge/db/subscription_id/lead_id */
  var FIELDS = ["em","ph","fn","ln","ct","st","zp","country","external_id","ge","db","subscription_id","lead_id","fb_login_id"];
  var COOKIE_DAYS = 365;

  function ck(name){ var m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)")); return m ? decodeURIComponent(m[1]) : ""; }
  function setCk(name, val, days){ try { document.cookie = name + "=; path=/; max-age=0"; document.cookie = name + "=" + encodeURIComponent(val) + ";path=/;max-age=" + (days*86400) + ";SameSite=Lax;domain=lighom.com"; } catch(e){} }
  function lsGet(k){ try { return localStorage.getItem(k) || ""; } catch(e){ return ""; } }
  function lsSet(k, v){ try { localStorage.setItem(k, v); } catch(e){} }
  function ssGet(k){ try { return sessionStorage.getItem(k) || ""; } catch(e){ return ""; } }
  function ssSet(k, v){ try { sessionStorage.setItem(k, v); } catch(e){} }

  /* === fbp/fbc bootstrap === */
  function bootstrapFbpFbc(){
    var now = Date.now();
    var urlParams = new URLSearchParams(window.location.search);
    var fbclid = urlParams.get("fbclid");
    /* Validate fbclid: real values are 20+ chars opaque base64-like; reject test strings */
    if (fbclid && fbclid.length >= 20 && !/^[a-z0-9_-]*(test|debug|dev|sample|enricher)/i.test(fbclid) && !ck("_fbc")) {
      setCk("_fbc", "fb.1." + now + "." + fbclid, 90);
    }
    /* _fbp NOT synthesized — Math.random produces values that never existed on facebook.com
       so Meta cannot reverse-match to any FB user. Same class of EMQ pollution as test PII.
       Let fbevents.js (Self Pixel Base) set _fbp naturally; otherwise send nothing. */
  }
  bootstrapFbpFbc();

  /* === Pinterest pintrk hijack v3 — Facebook-style dedup with safety net.
     v3 adds:
       (a) Queue intercept: catches calls already pushed to pintrk.queue before our wrap installs
           (Pinterest SDK pattern: stub queue → real SDK drains queue on load).
       (b) Re-install loop: re-wraps every 500ms for 10s in case SDK or theme code replaces window.pintrk.
       (c) Telemetry session-dedup: 1 telemetry per (event_name, status) per session — caps BQ row count.
       (d) Telemetry POSTs use fanout=[] so they only write BQ, never reach Pinterest/Meta/GA4 fanout.
     L1 active rewrite + L2 listen + L3 omit (downstream blocks fall back to canonical event_id). */
  window.__lighom_pintrk_ids = window.__lighom_pintrk_ids || {};
  window.__lighom_pintrk_shared = window.__lighom_pintrk_shared || {};
  var PIN_HIJACK_PCT = 100;
  function shouldHijackPintrk(){
    try {
      var fbp = document.cookie.match(/(?:^|;\s*)_fbp=([^;]+)/);
      var seed = fbp ? fbp[1] : (Date.now() + Math.random());
      var hash = 0; var s = String(seed);
      for (var i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
      return Math.abs(hash) % 100 < PIN_HIJACK_PCT;
    } catch(e){ return PIN_HIJACK_PCT >= 100; }
  }
  function genSharedId(name){
    return 'lighom_' + String(name).toLowerCase() + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }
  /* 2026-05-15: stable shared id for dedup. pagevisit → per-page-load fixed; others → session keyed by (name+path). */
  var __pinPageVisitId = null;
  function getStableSharedId(name){
    var lname = String(name).toLowerCase();
    if (lname === 'pagevisit') {
      if (!__pinPageVisitId) __pinPageVisitId = genSharedId(lname); try { window.LIGHOM_PAGEVISIT_ID = __pinPageVisitId; } catch(e){}
      return __pinPageVisitId;
    }
    var key = 'lighom_pin_sid_' + lname + '_' + (window.location && location.pathname || '');
    try {
      var existing = sessionStorage.getItem(key);
      if (existing) return existing;
    } catch(e){}
    var sid = genSharedId(lname);
    try { sessionStorage.setItem(key, sid); } catch(e){}
    return sid;
  }
  /* 2026-05-15: top-level value injection from line_items when missing (Pinterest EQ Order Value). */
  function injectTopLevelValue(data){
    try {
      if (typeof data.value === 'number' && data.value > 0) return;
      if (!Array.isArray(data.line_items) || !data.line_items.length) return;
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
    } catch(e){}
  }
  /* Mutate one pintrk track call's args[2].event_id in place. Returns 'ok' / 'rewrite_failed' / 'noop'. */
  function rewritePintrkArgs(args){
    if (!args || args[0] !== 'track' || !args[1]) return 'noop';
    var lname = String(args[1]).toLowerCase();
    if (lname === 'checkout') return 'noop'; /* 5/28 keep purchase_LIGxxx canonical for browser-CAPI dedup */
    try {
      if (args[2] && args[2].event_id) {
        window.__lighom_pintrk_ids[lname] = String(args[2].event_id);  /* L2 listen */
      }
      if (!__pinHijackEnabled) return 'noop';
      var sid = getStableSharedId(lname);
      if (!args[2] || typeof args[2] !== 'object') args[2] = {};
      args[2].event_id = sid;
      window.__lighom_pintrk_shared[lname] = sid;
      injectTopLevelValue(args[2]);
      return 'ok';
    } catch(e){ return 'rewrite_failed'; }
  }
  /* [2026-05-21] Telemetry DISABLED — hijack 已稳定 (5/13 起 100% rewrite_status=ok),
     940/d BQ 行只是噪音 + Worker 调用浪费 ($/quota)。保留函数签名 + 调用位置(makeWrapper
     里),需要恢复调试时删掉下面 return 行即可。其它子系统不动。
     回滚:删除下一行 return,函数自动恢复发 BQ。 */
  function reportPinterestHijackTelemetry(eventName, status, sharedid){
    return; /* DISABLED 2026-05-21 — restore by removing this line */
  }
  var __pinHijackEnabled = shouldHijackPintrk();

  /* Wrapper marker: window.__lighom_pintrk_wrapper holds our wrapped function ref so we can
     detect if SDK / theme code replaced window.pintrk with something else and re-install. */
  function makeWrapper(orig){
    var wrapped = function(){
      var args = arguments;
      try {
        var status = rewritePintrkArgs(args);
        if (status !== 'noop') reportPinterestHijackTelemetry(args[1], status, args[2] && args[2].event_id);
      } catch(e){
        try { reportPinterestHijackTelemetry(args && args[1], 'hijack_throw', ''); } catch(_){}
      }
      return orig.apply(this, args);
    };
    for (var k in orig) { try { wrapped[k] = orig[k]; } catch(e){} }
    return wrapped;
  }

  function installPintrkHijack(){
    if (typeof window.pintrk !== 'function') return false;
    if (window.pintrk === window.__lighom_pintrk_wrapper) return true;  /* already our wrap, intact */
    var orig = window.pintrk;
    /* (a) Drain any queued calls already buffered by Pinterest SDK stub. */
    try {
      if (Array.isArray(orig.queue)) {
        for (var i = 0; i < orig.queue.length; i++) {
          try { rewritePintrkArgs(orig.queue[i]); } catch(_){}
        }
        var origQPush = orig.queue.push.bind(orig.queue);
        orig.queue.push = function(args){
          try { rewritePintrkArgs(args); } catch(_){}
          return origQPush.apply(this, arguments);
        };
      }
    } catch(e){}
    var wrapped = makeWrapper(orig);
    window.__lighom_pintrk_wrapper = wrapped;
    window.pintrk = wrapped;
    return true;
  }

  /* (b) Re-install loop: every 500ms for 10s, ensures SDK replacement doesn't unwrap us. */
  installPintrkHijack();
  var __pinHijN = 0;
  var __pinHijIv = setInterval(function(){
    installPintrkHijack();
    if (++__pinHijN > 20) clearInterval(__pinHijIv);  /* 20 × 500ms = 10s coverage */
  }, 500);

  /* C-fix v8: hashed cookie persistence — eliminates raw cookie exposure to VC/ATC/IC/AP. */
  function seedHashedFromCookies(){
    var pre = {};
    FIELDS.forEach(function(f){
      var h = ck(COOKIE_PREFIX + f + "_h") || lsGet(COOKIE_PREFIX + f + "_h");
      if (h && /^[a-f0-9]{64}$/.test(h)) {
        var plain = ck(COOKIE_PREFIX + f) || lsGet(COOKIE_PREFIX + f);
        if (plain && isCleanPII(f, plain)) pre[f] = h;
        else {
          try { document.cookie = COOKIE_PREFIX + f + "_h=; path=/; max-age=0; domain=lighom.com"; lsSet(COOKIE_PREFIX + f + "_h", ""); } catch(e){}
        }
      }
    });
    if (Object.keys(pre).length) {
      hashedCache = Object.assign({}, hashedCache, pre);
      window.__lighom_user_data_hashed = Object.assign({}, window.__lighom_user_data_hashed || {}, pre);
    }
  }
  seedHashedFromCookies();

  function norm(field, value){
    if (!value) return "";
    value = String(value).trim().toLowerCase();
    if (field === "em") return value;
    if (field === "ph") return value.replace(/[\s\-()]/g, "").replace(/^\+/, "");
    if (field === "zp") return value.replace(/\s/g, "").substring(0, 5);
    if (field === "country") return value.replace(/\s/g, "").substring(0, 2);
    if (field === "ct" || field === "st") return value.replace(/\s/g, "");
    if (field === "ge") return (value === "f" || value === "female") ? "f" : (value === "m" || value === "male") ? "m" : "";
    if (field === "db") return value.replace(/[^0-9]/g, "").substring(0, 8);  /* YYYYMMDD */
    return value;
  }

  function sha256(s){
    if (!s || !window.crypto || !crypto.subtle) return Promise.resolve("");
    /* 5/31 sha256 hex passthrough: if input is already 64-char SHA-256 hex
       (PII Persist v1 bridge writes hashed values to no-suffix cookies which
       Enricher then reads back through loadPersisted+norm pipeline), pass
       through unchanged instead of double-hashing into garbage. */
    if (/^[a-f0-9]{64}$/i.test(String(s))) return Promise.resolve(String(s).toLowerCase());
    try {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function(buf){
        return Array.from(new Uint8Array(buf)).map(function(b){ return b.toString(16).padStart(2,"0"); }).join("");
      });
    } catch(e){ return Promise.resolve(""); }
  }

  function isCleanPII(field, value){
    if (!value || typeof value !== "string") return false;
    var s = String(value).trim();
    if (s.length < 2) return false;
    if (/^[\*#\-_]+$/.test(s)) return false;
    if (/^(test|--no-value--|none|null|undefined|n\/a|placeholder|sample|dummy|fake)$/i.test(s)) return false;
    if (/@example\.(com|org|net|test)$/i.test(s)) return false;
    if (/[\*#]{3,}/.test(s)) return false;
    if (field === "country") { if (!/^[a-z]{2}$/i.test(s)) { /* E2 5/31 country reject diag: log non-alpha country sources for "^^"-type pollution hunt; rate-limit 1/session/value */ try { if (!window.__lighom_country_rejected_diag) window.__lighom_country_rejected_diag = {}; var diagKey = String(value||'').slice(0,20); if (!window.__lighom_country_rejected_diag[diagKey]) { window.__lighom_country_rejected_diag[diagKey] = 1; if (window.LighomUtil && window.LighomUtil.sendCapi) window.LighomUtil.sendCapi({ event_name: 'ClientDiag', event_id: 'diag_country_'+Date.now()+'_'+Math.random().toString(36).slice(2,8), event_time: Math.floor(Date.now()/1000), page_url: location.href, page_path: location.pathname, page_type: 'diag', fanout: [], custom_data: { data_quality: 'lighom_country_reject', country_raw: String(value||'').slice(0,40), normalized: s.slice(0,8), source_hint: 'enricher_persist' } }); } } catch(e){} return false; } }  /* 5/31 country alpha-only check */
    return true;
  }

  function getInputValue(selector){
    var els = document.querySelectorAll(selector);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.type === "password") continue;
      var v = el.value || (el.options && el.selectedIndex >= 0 ? (el.options[el.selectedIndex].dataset.code || el.options[el.selectedIndex].text) : "");
      if (v && v.trim()) return v.trim();
    }
    return "";
  }

  /* === #1 + #5: URL params === */
  function fromUrlParams(){
    /* Plain params: ?_em=, ?em=, ?utm_email=, ?_ph=, ?ph= etc */
    /* Hashed params: ?_em_h=<sha256> directly accepted */
    var u = new URLSearchParams(window.location.search);
    var raw = {}, hashed = {};
    var plainMap = { _em: "em", em: "em", utm_email: "em", _ph: "ph", ph: "ph", _fn: "fn", fn: "fn", _ln: "ln", ln: "ln", _ct: "ct", ct: "ct", _st: "st", st: "st", _zp: "zp", zp: "zp", _country: "country", country: "country", _ge: "ge", ge: "ge", _db: "db", db: "db" };
    Object.keys(plainMap).forEach(function(k){
      var v = u.get(k);
      if (v) raw[plainMap[k]] = decodeURIComponent(v);
    });
    /* Hashed params */
    FIELDS.forEach(function(f){
      var h = u.get("_" + f + "_h") || u.get(f + "_h");
      if (h && /^[a-f0-9]{64}$/.test(h)) hashed[f] = h;
    });
    return { raw: raw, hashed: hashed };
  }

  /* === #3: sessionStorage cross-page === */
  function loadSession(){
    try {
      var s = ssGet(SESSION_KEY);
      if (s) {
        var parsed = JSON.parse(s); var clean = {};
        Object.keys(parsed).forEach(function(k){
          if (k === "__loaded") clean[k] = parsed[k];
          else if (isCleanPII(k, parsed[k])) clean[k] = parsed[k];
        });
        return clean;
      }
    } catch(e){}
    return {};
  }
  function saveSession(){
    try { ssSet(SESSION_KEY, JSON.stringify(rawCache)); } catch(e){}
  }

  /* === #2: Multi-field cookie/localStorage persistence === */
  function loadPersisted(){
    var loaded = {};
    FIELDS.forEach(function(f){
      var v = ck(COOKIE_PREFIX + f) || lsGet(COOKIE_PREFIX + f);
      if (v && isCleanPII(f, v)) loaded[f] = v;
      else {
        try { document.cookie = COOKIE_PREFIX + f + "=; path=/; max-age=0; domain=lighom.com"; document.cookie = COOKIE_PREFIX + f + "_h=; path=/; max-age=0; domain=lighom.com"; lsSet(COOKIE_PREFIX + f, ""); lsSet(COOKIE_PREFIX + f + "_h", ""); } catch(e){}
      }
    });
    return loaded;
  }
  function persist(field, value){
    if (!value || !isCleanPII(field, value)) {
      try { setCk(COOKIE_PREFIX + field, "", -1); lsSet(COOKIE_PREFIX + field, ""); } catch(e){}
      try { setCk(COOKIE_PREFIX + field + "_h", "", -1); lsSet(COOKIE_PREFIX + field + "_h", ""); } catch(e){}
      return;
    }
    /* 5/31 country freshness: 30d TTL for country (vs 365d for other fields) — bounds maximum staleness window. Auto-refresh next time Enricher reads a fresh form value. */
    var _ttl = (field === "country") ? 30 : COOKIE_DAYS;
    setCk(COOKIE_PREFIX + field, value, _ttl);
    lsSet(COOKIE_PREFIX + field, value);
  }

  function scanDOM(){
    var found = false;

    /* === Apply persisted (cookie/ls) first time only === */
    if (!rawCache.__loaded) {
      var session = loadSession();
      var persisted = loadPersisted();
      var urlData = fromUrlParams();
      /* Priority: URL > sessionStorage > cookie/ls. URL is freshest, session is current-flow, cookie is long-term */
      var seed = Object.assign({}, persisted, session, urlData.raw);
      Object.keys(seed).forEach(function(k){
        if (seed[k] && rawCache[k] !== seed[k]) {
          rawCache[k] = seed[k]; found = true;
          /* Persist URL-supplied values (URL is the freshest source) */
          if (urlData.raw[k]) persist(k, seed[k]);
        }
      });
      /* URL pre-hashed values */
      Object.keys(urlData.hashed).forEach(function(k){ hashedCache[k] = urlData.hashed[k]; });
      rawCache.__loaded = true;
    }

    var pairs = [
      ["em", "input[type=\"email\"], input[name*=\"email\" i], input[id*=\"email\" i], input[autocomplete=\"email\"]"],
      ["ph", "input[type=\"tel\"], input[name*=\"phone\" i], input[id*=\"phone\" i], input[name*=\"mobile\" i], input[autocomplete=\"tel\"]"],
      ["fn", "input[name*=\"first_name\" i], input[name*=\"firstName\" i], input[id*=\"first_name\" i], input[autocomplete=\"given-name\"]"],
      ["ln", "input[name*=\"last_name\" i], input[name*=\"lastName\" i], input[id*=\"last_name\" i], input[autocomplete=\"family-name\"]"],
      ["ct", "input[name*=\"city\" i], input[id*=\"city\" i], input[autocomplete=\"address-level2\"]"],
      ["st", "input[name*=\"province\" i], input[name*=\"state\" i], input[id*=\"province\" i], select[name*=\"province\" i], select[name*=\"state\" i], input[autocomplete=\"address-level1\"], select[autocomplete=\"address-level1\"]"],
      ["zp", "input[name*=\"postal\" i], input[name*=\"zip\" i], input[name*=\"postcode\" i], input[autocomplete=\"postal-code\"]"],
      ["country", "select[name*=\"country\" i], input[name*=\"country\" i], input[autocomplete=\"country\"]"],
      ["ge", "select[name*=\"gender\" i], input[name*=\"gender\" i], input[autocomplete=\"sex\"]"],
      ["db", "input[type=\"date\"][name*=\"birth\" i], input[name*=\"dob\" i], input[name*=\"birthday\" i], input[autocomplete=\"bday\"]"]
    ];
    pairs.forEach(function(p){
      var v = getInputValue(p[1]);
      if (v && rawCache[p[0]] !== v) {
        rawCache[p[0]] = v; found = true;
        persist(p[0], v);  /* === #2: cookie persist === */
      }
    });

    /* External ID multi-source */
    var uid = "";
    if (window.__lighom_customer && window.__lighom_customer.id) uid = String(window.__lighom_customer.id);
    if (!uid && window.Shopline) {
      uid = (window.Shopline.customer && (window.Shopline.customer.id || window.Shopline.customer.userId))
        || window.Shopline.customerId || window.Shopline.userId || "";
      uid = uid ? String(uid) : "";
    }
    if (!uid) {
      var ps = window.__PRELOAD_STATE__;
      uid = (ps && ps.user && (ps.user.id || ps.user.userId)) || (ps && ps.userInfo && ps.userInfo.userId) || (ps && ps.orders && ps.orders.buyerInfo && ps.orders.buyerInfo.buyerId) || (ps && ps.checkout && ps.checkout.buyerInfo && ps.checkout.buyerInfo.buyerId) /* 6/2: /checkouts/ logged-in buyer */;
      uid = uid ? String(uid) : "";
    }
    if (!uid) uid = ck("customer_id") || ck("sl_customer_id") || ck("buyer_id") || "";
    if (!uid) {
      try {
        var lsKeys = Object.keys(localStorage);
        for (var li = 0; li < lsKeys.length; li++) {
          if (/customer|user.?id|buyer.?id/i.test(lsKeys[li])) {
            var lv = localStorage.getItem(lsKeys[li]);
            if (lv && /^\d{5,}$/.test(lv)) { uid = lv; break; }
            try {
              var parsed = JSON.parse(lv);
              if (parsed && (parsed.id || parsed.customerId || parsed.userId)) {
                uid = String(parsed.id || parsed.customerId || parsed.userId);
                break;
              }
            } catch(e){}
          }
        }
      } catch(e){}
    }
    /* DISABLED 2026-05-23: UUID fallback removed. UUIDs never match a FB user → 100% coverage but 0% match.
       Only real Shopline customer.id (digit-only) goes to Meta/Pin CAPI. Dedup browser↔CAPI uses event_id. */
    if (!uid && !rawCache.external_id) {
      if (window.crypto && typeof crypto.randomUUID === 'function') {
        uid = crypto.randomUUID();
      } else if (window.crypto && typeof crypto.getRandomValues === 'function') {
        var __rd = crypto.getRandomValues(new Uint8Array(16));
        __rd[6] = (__rd[6] & 0x0f) | 0x40;
        __rd[8] = (__rd[8] & 0x3f) | 0x80;
        var __hex = Array.from(__rd, function(b){ return b.toString(16).padStart(2, "0"); }).join("");
        uid = __hex.slice(0,8) + "-" + __hex.slice(8,12) + "-" + __hex.slice(12,16) + "-" + __hex.slice(16,20) + "-" + __hex.slice(20,32);
      } else {
        uid = "u-" + Date.now() + "-" + Math.random().toString(36).slice(2, 15);
      }
    }
    if (uid && rawCache.external_id !== uid) {
      rawCache.external_id = uid; found = true;
      persist("external_id", uid);
    }

    if (found && !pending) updateData();
    saveSession();  /* === #3: sessionStorage === */
    return found;
  }

  function updateData(){
    pending = true;
    var keys = Object.keys(rawCache).filter(function(k){ return k !== "__loaded"; });
    var normRaw = {};
    keys.forEach(function(k){ var v = norm(k, rawCache[k]); if (v) normRaw[k] = v; });
    Promise.all(keys.map(function(k){ return sha256(norm(k, rawCache[k])); })).then(function(hashes){
      var newHashed = {};
      keys.forEach(function(k, i){ if (hashes[i]) newHashed[k] = hashes[i]; });
      /* Merge URL-supplied pre-hashed values (they win over computed) */
      /* 6/2 stale _h fix: computed (newHashed from rawCache) wins over stored (hashedCache from _h cookies). Stored only fills gaps when computed empty (URL-supplied _h without raw equivalent). Reason: stale device-UUID-era _h cookies were overriding fresh real-customer-ID computed hashes; Meta CAPI received stale hashed_external_id never matching real customer. */
      Object.keys(hashedCache).forEach(function(k){ if (hashedCache[k] && !newHashed[k]) newHashed[k] = hashedCache[k]; });
      hashedCache = newHashed;
      /* C-fix v8: persist hashed cookies (_h suffix) for sync seeding next page load */
      Object.keys(newHashed).forEach(function(f){
        setCk(COOKIE_PREFIX + f + "_h", newHashed[f], COOKIE_DAYS);
        lsSet(COOKIE_PREFIX + f + "_h", newHashed[f]);
      });

      if (window.__lighom_user_data_pinned) {
        window.__lighom_user_data_hashed = Object.assign({}, window.__lighom_user_data_hashed || {}, newHashed);
        window.__lighom_user_data_raw = Object.assign({}, window.__lighom_user_data_raw || {}, rawCache);
      } else {
        window.__lighom_user_data_hashed = newHashed;
        window.__lighom_user_data_raw = rawCache;
      }
      window.__lighom_user_data_normraw = normRaw;
      pending = false;
      if (typeof window.fbq === "function" && Object.keys(normRaw).length) {
        var sig = JSON.stringify(normRaw);
        if (sig !== lastFbqInit) {
          lastFbqInit = sig;
          try { window.fbq("init", PIXEL_ID, normRaw); } catch(e){}
        }
      }
      /* Pinterest Enhanced Match — pintrk('set', user_data) — Pinterest auto-hashes its supported fields */
      if (typeof window.pintrk === "function" && Object.keys(normRaw).length) {
        var pinSig = JSON.stringify(normRaw);
        if (pinSig !== lastPintrkSet) {
          lastPintrkSet = pinSig;
          var pinUserData = {};
          /* Pinterest Enhanced Match accepts these (Pinterest hashes server-side): em, ph, fn, ln, ct, st, zp, country, external_id, ge */
          ["em","ph","fn","ln","ct","st","zp","country","external_id","ge"].forEach(function(k){
            if (normRaw[k]) pinUserData[k] = normRaw[k];
          });
          /* [2026-05-26 v2] external_id 回 plain — Pinterest "Automatic Enhanced Match"
             官方: "All values are hashed in the browser using SHA-256 prior to being sent."
             JS tag 自动 hash external_id (同 em), 发 hashed 会双重 hash → CAPI mismatch.
             Worker pinterest.js 端单独 hash 满足 CAPI spec; 两端最终都到 Pinterest 后台
             相同 hash 值. */
          if (Object.keys(pinUserData).length) {
            try { window.pintrk("set", pinUserData); } catch(e){}
          }
        }
      }

      // Google Ads Enhanced Conversions — gtag('set', 'user_data', ...) lets Google Ads
      // hash + attach customer info to subsequent conversion events. Mirror of fbq/pintrk.
      // Field names follow gtag convention (email / phone_number / address.{first_name,...}),
      // not Meta's em/ph/etc. Google Ads SDK auto-hashes and dedups against EC matches.
      if (typeof window.gtag === "function" && Object.keys(normRaw).length) {
        var gaSig = JSON.stringify(normRaw);
        if (gaSig !== lastGtagSet) {
          lastGtagSet = gaSig;
          var gaUserData = {};
          if (normRaw.em) gaUserData.email = normRaw.em;
          if (normRaw.ph) gaUserData.phone_number = normRaw.ph;
          var addr = {};
          if (normRaw.fn) addr.first_name = normRaw.fn;
          if (normRaw.ln) addr.last_name = normRaw.ln;
          if (normRaw.ct) addr.city = normRaw.ct;
          if (normRaw.st) addr.region = normRaw.st;
          if (normRaw.zp) addr.postal_code = normRaw.zp;
          if (normRaw.country) addr.country = normRaw.country;
          if (Object.keys(addr).length) gaUserData.address = addr;
          if (Object.keys(gaUserData).length) {
            try { window.gtag("set", "user_data", gaUserData); } catch(e){}
          }
        }
      }
    });
  }

  function buildUserData(existing){
    var ud = Object.assign({}, existing || {});
    var rawMap = { em: "email_address", ph: "phone_number", fn: "first_name", ln: "last_name", ct: "city", st: "region", zp: "postal_code", country: "country", external_id: "user_id", ge: "gender", db: "date_of_birth" };
    Object.keys(rawMap).forEach(function(k){
      if (rawCache[k] && !ud[rawMap[k]]) ud[rawMap[k]] = rawCache[k];
    });
    FIELDS.forEach(function(k){
      if (hashedCache[k] && !ud[k]) ud[k] = hashedCache[k];
    });
    return ud;
  }

  function enrich(arg){
    if (!arg || !arg.event || !EVENT_NAMES.test(arg.event)) return arg;
    arg.user_data = buildUserData(arg.user_data);
    if (!arg.fbp) arg.fbp = ck("_fbp");
    if (!arg.fbc) arg.fbc = ck("_fbc");
    if (!arg.epik) arg.epik = ck("_epik");
    return arg;
  }

  function bridgeGtag(arg){
    if (!arg || arg["0"] !== "event" || !GTAG_ECOM.test(arg["1"])) return null;
    var eventName = arg["1"];
    var data = arg["2"] || {};
    if (data.send_to) return null;
    var bridged = {
      event: eventName,
      event_id: data.event_id,
      ecommerce: {
        value: data.value,
        currency: data.currency,
        items: data.items,
        transaction_id: data.transaction_id,
        content_ids: data.content_ids || (data.items ? data.items.map(function(it){ return it.item_id || it.id; }).filter(Boolean) : undefined),
        content_type: data.content_type || (data.items && data.items.length ? "product" : undefined),
        num_items: data.items ? data.items.length : undefined
      }
    };
    return bridged;
  }

  function start(){
    /* E1 5/31: CF geo cross-check — Worker /capi/geo returns CF-IPCountry edge value; if differs from stored country (or stored empty), refresh via persist() so AAM tracks current location not stale residual. Defensive: any failure silent. */
    try {
      fetch('https://lighom-feed-server.dikecarmem750.workers.dev/capi/geo', { credentials: 'omit', method: 'GET' })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(g){
          if (!g || !g.country) return;
          var stored = ck(COOKIE_PREFIX + 'country');
          if (stored !== g.country) { try { persist('country', g.country); } catch(e){} }
        })
        .catch(function(){});
    } catch(e){}
    scanDOM();
    /* Initial fbq init (only with data; empty init pollutes Meta diagnostic) */
    if (typeof window.fbq === "function" && Object.keys(rawCache).filter(function(k){ return k !== "__loaded"; }).length) {
      /* updateData already triggered if scanDOM found something */
    }
    if (!window.dataLayer) window.dataLayer = [];
    var origPush = window.dataLayer.push.bind(window.dataLayer);
    window.dataLayer.push = function(arg){
      if (arg && arg.event && EVENT_NAMES.test(arg.event)) {
        scanDOM();
        enrich(arg);
        return origPush(arg);
      }
      var bridged = bridgeGtag(arg);
      if (bridged) {
        scanDOM();
        enrich(bridged);
        var orig = origPush(arg);
        try { setTimeout(function(){ origPush(bridged); }, 0); } catch(e){}
        return orig;
      }
      return origPush(arg);
    };
    document.addEventListener("blur", scanDOM, true);
    document.addEventListener("change", scanDOM, true);
    var inputTimer ;
    document.addEventListener("input", function(){ clearTimeout(inputTimer); inputTimer = setTimeout(scanDOM, 300); }, true);
    setInterval(scanDOM, 2000);

    /* === #4: MutationObserver — catch SPA-rendered forms === */
    if (window.MutationObserver) {
      var moTimer;
      var mo = new MutationObserver(function(mutations){
        var hasFormChange = false;
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.addedNodes.length) {
            for (var j = 0; j < m.addedNodes.length; j++) {
              var n = m.addedNodes[j];
              if (n.nodeType === 1 && (n.matches?.("input,select,form") || n.querySelector?.("input,select,form"))) {
                hasFormChange = true; break;
              }
            }
          }
          if (hasFormChange) break;
        }
        if (hasFormChange) {
          clearTimeout(moTimer);
          moTimer = setTimeout(scanDOM, 200);
        }
      });
      mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    var existing = window.dataLayer.slice();
    setTimeout(function(){
      existing.forEach(function(item){
        var b = bridgeGtag(item);
        if (b) { enrich(b); origPush(b); }
      });
    }, 100);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
</script>
