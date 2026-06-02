<script>
/* Lighom Self Pixel — Search v2 (FB-only, master-flag gated, status=2 disabled)
   /search* + URL ?q=...;fbq('track','Search',{search_string}) + Worker /capi/event fanout=['meta'] */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighom_selfpx_search_v2) return;
  window.__lighom_selfpx_search_v2 = true;
  if (window.__lighomIsBot) return;
  if (!/\/search/.test(location.pathname)) return;

  var WORKER = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var P = "_lighom_user_";

  /* shared from Util Lib v1 */ var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;
  
  
  

  

  var fired = false;
  function go(){
    if (fired) return;
    var q = ""; try { q = new URLSearchParams(location.search).get("q") || ""; } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB Search v2",e);}
    if (!q) return;
    fired = true;
    var ts = Date.now();
    var qHash = ""; try { qHash = encodeURIComponent(q).slice(0, 20); } catch(e){ qHash = "q"; }
    var event_id = ("search_" + qHash + "_" + ts);
    var p = { search_string: q, content_category: "" };
    try { if (window.fbq) window.fbq("track", "Search", p, { eventID: event_id }); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB Search v2",e);}
    var ud = window.LighomUtil.buildUserData({prefix:P});
    try {
      fetch(WORKER, {
        method: "POST", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_name: "Search", event_id: event_id,
          event_time: Math.floor(ts/1000),
          event_source_url: location.href, page_url: location.href, page_path: location.pathname,
          page_type: "search",
          fanout: ["meta"],
          utm: (window.LighomUtil && window.LighomUtil.utm) ? window.LighomUtil.utm() : { source: '', medium: '', campaign: '' } /* D6 5/31 */,
          user_data: ud,
          custom_data: Object.assign({}, p, { data_quality: "self_pixel_v2:search" })
        })
      });
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("FB Search v2",e);}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go);
  else go();
})();
</script>