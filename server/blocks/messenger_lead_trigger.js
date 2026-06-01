<script>
// Messenger Lead Trigger — fires Meta CAPI Lead event when user opens chat
// widget / clicks Messenger CTA / submits contact form. Worker /capi/event
// hashes em/ph internally + accepts Lead via HIGH_INTENT_EVENTS whitelist.
// Once per session via sessionStorage dedup.
(function(){
  if (window.__lighom_lead_trigger_v1) return;
  window.__lighom_lead_trigger_v1 = true;

  var BOT_RE = /fbexternalhit|facebookcatalog|FacebookExternalAgent|meta-externalagent|meta-externalfetcher|facebookbot|pinterestbot|googlebot|bingbot|slackbot|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|applebot|duckduckbot|baiduspider|yandexbot|ahrefsbot|semrushbot|mj12bot|dotbot|crawler|spider|HeadlessChrome|headless|phantom|puppeteer|playwright/i;
  if (BOT_RE.test(navigator.userAgent || '') || navigator.webdriver === true) return;

  var SESSION_KEY = '_lighom_lead_fired';
  var WORKER = 'https://lighom-feed-server.dikecarmem750.workers.dev/capi/event';

  function uid(){ return 'lead_' + Date.now() + '_' + Math.random().toString(36).slice(2,9); }

  function ck(name){
    try {
      var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : '';
    } catch(_) { return ''; }
  }

  function pdpProductIds(){
    try {
      if (!/^\/products\//.test(location.pathname)) return null;
      var p = (window.Shopline && window.Shopline.product) ||
              (window.SPZ && window.SPZ.product) ||
              (window.product) || null;
      if (p && (p.id || p.product_id)) return [String(p.id || p.product_id)];
      var m = document.querySelector('meta[property="product:retailer_item_id"], meta[property="og:product:id"]');
      if (m && m.content) return [String(m.content).trim()];
    } catch(_){}
    return null;
  }

  function fireLead(source){
    try {
      if (sessionStorage.getItem(SESSION_KEY) === '1') return;
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch(_){}

    var eventId = uid();
    var contentIds = pdpProductIds();

    var customData = {
      content_name: 'Chat widget opened',
      content_category: source
    };
    if (contentIds) {
      customData.content_ids = contentIds;
      customData.content_type = 'product';
    }

    if (typeof window.fbq === 'function') {
      try { window.fbq('track', 'Lead', customData, { eventID: eventId }); } catch(_){}
    }

    try {
      var enricher = (window.__lighom_user_data_raw || {});
      var ud = {
        em: enricher.em || ck('_lighom_user_em'),
        ph: enricher.ph || ck('_lighom_user_ph'),
        fn: enricher.fn || ck('_lighom_user_fn'),
        ln: enricher.ln || ck('_lighom_user_ln'),
        external_id: ck('_lighom_user_external_id'),
        ct: ck('_lighom_user_ct'),
        st: ck('_lighom_user_st'),
        zp: ck('_lighom_user_zp'),
        country: ck('_lighom_user_country'),
        fbc: ck('_fbc'),
        fbp: ck('_fbp'),
        epik: ck('_epik'),
        ttclid: ck('_ttclid'),
        msclkid: ck('_msclkid')
      };
      Object.keys(ud).forEach(function(k){ if (!ud[k]) delete ud[k]; });

      var body = {
        event_name: 'Lead',
        event_id: eventId,
        event_time: Math.floor(Date.now() / 1000),
        page_url: location.href,
        page_path: location.pathname,
        page_type: source,
        user_data: ud,
        custom_data: customData
      };

      fetch(WORKER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
        credentials: 'omit'
      }).catch(function(){});
    } catch(_){}
  }

  function bindShoplineChat(){
    var sel = '[class*="sl-im-icon"], [class*="chat-icon"], [class*="messenger-icon"], #shopline-chat-entry, [data-shopline-chat]';
    document.addEventListener('click', function(e){
      try {
        var el = e.target && e.target.closest && e.target.closest(sel);
        if (el) fireLead('shopline_chat_widget');
      } catch(_){}
    }, { capture: true, passive: true });
  }

  function bindMessengerCTA(){
    document.addEventListener('click', function(e){
      try {
        var t = e.target;
        if (!t || !t.closest) return;
        var a = t.closest('a[href]');
        if (a && /m\.me\/|messenger\.com\/t\//i.test(a.href)) fireLead('messenger_cta');
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
          fireLead('contact_form');
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
