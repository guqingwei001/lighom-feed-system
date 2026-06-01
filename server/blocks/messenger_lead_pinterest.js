<script>
// Lead - Pinterest browser tag — fires pintrk('track', 'lead') when user opens
// chat widget / clicks Messenger CTA / submits contact form. Once per session.
// Pinterest CAPI server-side mirror handled separately by Meta+Worker block.
(function(){
  if (window.__lighom_lead_pin_v1) return;
  window.__lighom_lead_pin_v1 = true;

  var BOT_RE = /fbexternalhit|facebookcatalog|FacebookExternalAgent|meta-externalagent|meta-externalfetcher|facebookbot|pinterestbot|googlebot|bingbot|slackbot|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|applebot|duckduckbot|baiduspider|yandexbot|ahrefsbot|semrushbot|mj12bot|dotbot|crawler|spider|HeadlessChrome|headless|phantom|puppeteer|playwright/i;
  if (BOT_RE.test(navigator.userAgent || '') || navigator.webdriver === true) return;

  var SESSION_KEY = '_lighom_lead_pin_fired';

  function firePinLead(source){
    try {
      if (sessionStorage.getItem(SESSION_KEY) === '1') return;
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch(_){}

    if (typeof window.pintrk === 'function') {
      try { window.pintrk('track', 'lead', { lead_type: source }); } catch(_){}
    }
  }

  function bindShoplineChat(){
    var sel = '[class*="sl-im-icon"], [class*="chat-icon"], [class*="messenger-icon"], #shopline-chat-entry, [data-shopline-chat]';
    document.addEventListener('click', function(e){
      try {
        var el = e.target && e.target.closest && e.target.closest(sel);
        if (el) firePinLead('shopline_chat_widget');
      } catch(_){}
    }, { capture: true, passive: true });
  }

  function bindMessengerCTA(){
    document.addEventListener('click', function(e){
      try {
        var t = e.target;
        if (!t || !t.closest) return;
        var a = t.closest('a[href]');
        if (a && /m\.me\/|messenger\.com\/t\//i.test(a.href)) firePinLead('messenger_cta');
      } catch(_){}
    }, { capture: true, passive: true });
  }

  function bindContactForm(){
    document.addEventListener('submit', function(e){
      try {
        var f = e.target;
        if (!f || f.tagName !== 'FORM') return;
        var action = (f.action || '').toLowerCase();
        var id = (f.id || '').toLowerCase();
        if (/contact|message|inquiry|enquiry|consult/.test(action + ' ' + id)) {
          firePinLead('contact_form');
        }
      } catch(_){}
    }, { capture: true, passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      bindShoplineChat(); bindMessengerCTA(); bindContactForm();
    });
  } else {
    bindShoplineChat(); bindMessengerCTA(); bindContactForm();
  }
})();
</script>
