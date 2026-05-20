<script>
/* Lighom Bot Guard v1 — centralized stealth-bot detector + I/O interceptor.
   Position: TOP, all-pages. Runs FIRST. Sets window.__lighomIsBot for any other
   block that wants to check it. For detected bots:
     - Replaces window.fbq with a no-op (blocks /tr/ Pixel POSTs)
     - Replaces window.pintrk with a no-op
     - Short-circuits fetch() to lighom Worker /capi/event and /capi/order
   Real users see nothing; this block is a true no-op for them.
   Detection signals (any one true ⇒ bot):
     - navigator.webdriver===true                       (classic)
     - UA contains automation tool name                  (classic)
     - cdc_ / __driver / __webdriver / __selenium / _phantom globals  (Selenium/Puppeteer leak)
     - document.documentElement getAttribute('webdriver')  (Selenium leak)
     - Chrome UA but chrome.runtime is undefined         (playwright/puppeteer/headed stealth)
     - Chrome UA but navigator.plugins.length === 0      (older headless)
   FP risk: kiosk/enterprise locked Chrome may also lack chrome.runtime.
   Trade: those are rarely Lighom buyers, and their webhook Purchase still works
   server-side; we only lose their browser pixel signal — acceptable. */
(function(){
  if (window.__lighomBotGuard_v1) return;
  window.__lighomBotGuard_v1 = true;
  window.__lighomIsBot = true; /* fail-safe default: assume bot until isBot() verifies */
  /* PHASE D GRADIENT — 20% sample. Change 0.2 → 1 for 100%, 0 for kill. Single control point. */
  if (typeof window.LIGHOM_SELF_PIXEL_LIVE === "undefined") {
    window.LIGHOM_SELF_PIXEL_LIVE = (Math.random() < 1); /* PHASE D 100% — all users get self-pixel */
  }
  function isBot(){
    try {
      if (navigator.webdriver === true) return true;
      var ua = navigator.userAgent || "";
      /* WhatsApp 智能区分: 真用户 in-app browser 有 Mozilla+Chrome,crawler 是纯 "WhatsApp/x.x" 短 UA */
      if (/WhatsApp\/\d/i.test(ua) && !/Mozilla.*Chrome/.test(ua)) return true;
      if (/headless|phantom|puppeteer|playwright|webdriverio|cypress|selenium|chromedriver|nightmare|lighthouse|pagespeed|gtmetrix|pingdom|catchpoint|googlebot|bingbot|yandex|baiduspider|duckduckbot|facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|google-inspectiontool|python-requests|python-urllib|curl\/|wget\/|node-fetch|axios\/|got\/|okhttp|httpclient|java\/|go-http|libwww|bot|crawler|spider|scraper/i.test(ua)) return true;
      if (document.documentElement.getAttribute("webdriver")) return true;
      try {
        var keys = Object.getOwnPropertyNames(window);
        for (var i = 0; i < keys.length; i++) {
          if (/^cdc_|^__driver|^__webdriver|^__selenium|^__nightmare|^_phantom|^callPhantom/.test(keys[i])) return true;
        }
      } catch (e) {}
      var chromeUA = /Chrome\//i.test(ua);
      /* MOBILE FP GUARD: Android Chrome lacks chrome.runtime AND has plugins=0 by
         design (no extension API on mobile). Without this gate the next two checks
         would block all mobile Chrome users — catastrophic FP. */
      var isMobile = /Mobile|Android|iPhone|iPad|iPod|webOS|Opera Mini|IEMobile/i.test(ua) || (navigator.userAgentData && navigator.userAgentData.mobile === true);
      /* chrome.runtime undefined: corroborate with connection anomaly to avoid FP
         on enterprise IT --disable-extensions users (normal home/office connection = pass).
         playwright stealth shows rtt~350/3g; real corporate Chrome shows rtt<200/4g. */
      var __conn = navigator.connection;
      var __anom = !__conn || __conn.effectiveType !== "4g" || (typeof __conn.rtt === "number" && __conn.rtt > 200);
      if (!isMobile && chromeUA && window.chrome && typeof window.chrome.runtime === "undefined" && __anom) return true;
      if (!isMobile && chromeUA && navigator.plugins && navigator.plugins.length === 0) return true;
      return false;
    } catch (e) { return false; }
  }
  var bot = isBot();
  window.__lighomIsBot = bot;
  if (!bot) return;
  /* ===== bot path: intercept tracking I/O =====
     fbq override (Object.defineProperty so later assignments are caught) */
  try {
    var noopFbq = function(){};
    noopFbq.callMethod = function(){};
    noopFbq.queue = [];
    noopFbq.loaded = true;
    noopFbq.version = "2.0";
    Object.defineProperty(window, "fbq", { configurable:true, get:function(){return noopFbq;}, set:function(){} });
    Object.defineProperty(window, "_fbq", { configurable:true, get:function(){return noopFbq;}, set:function(){} });
  } catch (e) {}
  /* pintrk override */
  try {
    var noopPin = function(){};
    noopPin.queue = []; noopPin.version = "3.0";
    Object.defineProperty(window, "pintrk", { configurable:true, get:function(){return noopPin;}, set:function(){} });
  } catch (e) {}
  /* fetch short-circuit for Lighom Worker /capi endpoints */
  try {
    var WORKER_RE = /lighom-feed-server\.dikecarmem750\.workers\.dev\/capi\/(event|order|purchase-check)/;
    var origFetch = window.fetch;
    window.fetch = function(u, init){
      var url = (typeof u === "string") ? u : (u && u.url);
      if (url && WORKER_RE.test(url)) {
        return Promise.resolve(new Response('{"ok":false,"reason":"bot_blocked_client"}', { status: 200, headers: { "Content-Type":"application/json", "X-Lighom-Bot-Blocked":"1" } }));
      }
      return origFetch.apply(this, arguments);
    };
  } catch (e) {}
})();
</script>