<script>
/* Lighom SEID Bridge v1 — capture Shopline __PRELOAD_STATE__.serverEventId on the
   thank-you page so the reliable order webhook can set Meta event_id = serverEventId,
   matching native fbq Purchase → Meta dedups native<->CAPI. Minimal gates (only waits
   for __PRELOAD_STATE__, no fbq/paid wait) = far higher coverage than the heavy
   Purchase block. fanout:[] = no platform send, pure KV bridge. */
(function(){
  if (window.__lighom_seid_bridge_v1) return;
  window.__lighom_seid_bridge_v1 = true;
  var BOT_RE=/fbexternalhit|facebookcatalog|FacebookExternalAgent|meta-externalagent|facebookbot|pinterestbot|googlebot|bingbot|slackbot|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|applebot|duckduckbot|baiduspider|yandexbot|ahrefsbot|semrushbot|mj12bot|dotbot|crawler|spider|HeadlessChrome|headless|phantom|puppeteer|playwright|gptbot|claudebot|bytespider|amazonbot/i;
  if (BOT_RE.test(navigator.userAgent||"") || navigator.webdriver===true) return;
  var WORKER="https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var n=0;
  function go(){
    var ps=window.__PRELOAD_STATE__;
    var seid=ps && ps.serverEventId;
    var b=ps && ps.orders && ps.orders.basicInfo;
    var oseq=b && (b.appOrderSeq || b.orderSeq);
    if(!seid || !oseq){ if(++n>60) return; setTimeout(go,250); return; }
    var oid=String(oseq).replace(/^#/,"");
    try{
      fetch(WORKER,{method:"POST",credentials:"omit",keepalive:true,
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          event_name:"SEIDCapture",
          event_id:"seidcap_"+oid+"_"+Date.now(),
          event_time:Math.floor(Date.now()/1000),
          page_url:location.href, page_path:location.pathname, page_type:"thank_you",
          fanout:[],
          custom_data:{ order_id:oid, seid:String(seid) }
        })});
    }catch(e){}
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",go); else go();
})();
</script>