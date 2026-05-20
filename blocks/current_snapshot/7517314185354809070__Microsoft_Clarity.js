<script type="text/javascript">
/* Microsoft Clarity for Lighom — heatmaps + session recording.
   Project ID: woskuen8hr  (https://clarity.microsoft.com/projects/view/woskuen8hr)
   Installed 2026-05-10. */
(function(){
  try {
    var ua = navigator.userAgent || '';
    /* Bot guard: same regex pattern used in GTM AddToCart v5.4 */
    if (/fbexternalhit|facebookcatalog|FacebookExternalAgent|meta-externalagent|meta-externalfetcher|facebookbot|pinterestbot|googlebot|bingbot|crawler|spider|HeadlessChrome|headless|phantom|puppeteer|playwright|gptbot|chatgpt|claudebot|anthropic|perplexity|bytespider|amazonbot/i.test(ua)) return;
    if (navigator.webdriver === true) return;
  } catch(e) { return; }

  (function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
  })(window, document, "clarity", "script", "woskuen8hr");

  /* Pipe lighom user_data into Clarity sessions for buyer attribution */
  function attachUD(n){
    if (!window.clarity) { if (n < 50) return setTimeout(function(){ attachUD(n+1); }, 300); return; }
    var ud = window.__lighom_user_data_hashed || {};
    try {
      if (ud.external_id) clarity("identify", ud.external_id);
      var pageType = (function(){
        var p = location.pathname;
        if (p === '/' || p === '') return 'home';
        if (/^\/products\//.test(p)) return 'pdp';
        if (/^\/collections\//.test(p)) return 'plp';
        if (/^\/cart/.test(p)) return 'cart';
        if (/^\/checkout/.test(p)) return 'checkout';
        if (/thank.*you|order.*status/i.test(p)) return 'thankyou';
        return 'other';
      })();
      clarity("set", "page_type", pageType);
      if (ud.country) clarity("set", "country_hash", String(ud.country).slice(0,16));
    } catch(e){}
  }
  attachUD(0);
})();
</script>