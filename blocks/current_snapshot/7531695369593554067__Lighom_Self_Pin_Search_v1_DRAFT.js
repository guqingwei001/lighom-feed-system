<script>
/* Lighom Self Pin — Search v1 (Pinterest-only, master-flag gated, status=2 disabled)
   /search* + URL ?q=...;pintrk('track','search',{search_query, event_id}) + Worker fanout=['pinterest']
   event_id 同 FB Search v2 公式 */
(function _gateRetry(){if(typeof window.LIGHOM_SELF_PIXEL_LIVE==="undefined")return setTimeout(_gateRetry,30);if(typeof window.LighomUtil==="undefined")return setTimeout(_gateRetry,30);
  if (!window.LIGHOM_SELF_PIXEL_LIVE) return;
  if (window.__lighom_selfpin_search_v1) return;
  window.__lighom_selfpin_search_v1 = true;
  if (window.__lighomIsBot) return;
  if (!/\/search/.test(location.pathname)) return;

  var WORKER = "https://lighom-feed-server.dikecarmem750.workers.dev/capi/event";
  var P = "_lighom_user_";

  /* shared from Util Lib v1 */ var ck = window.LighomUtil.ck, hxOnly = window.LighomUtil.hxOnly, lsClick = window.LighomUtil.lsClick;
  
  
  

  

  var fired = false;
  function go(){
    if (fired) return;
    var q = ""; try { q = new URLSearchParams(location.search).get("q") || ""; } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin Search v1",e);}
    if (!q) return;
    fired = true;
    var ts = Date.now();
    var qHash = ""; try { qHash = encodeURIComponent(q).slice(0, 20); } catch(e){ qHash = "q"; }
    var event_id = ("search_" + qHash + "_" + ts);

    /* Pinterest search 事件: search_query 是 Pinterest 标准字段名(注意 search vs search_query) */
    try { if (window.pintrk) window.pintrk("track", "search", { search_query: q, event_id: event_id }); } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin Search v1",e);}

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
          fanout: ["pinterest"],
          utm: (window.LighomUtil && window.LighomUtil.utm) ? window.LighomUtil.utm() : { source: '', medium: '', campaign: '' } /* D6 5/31 */,
          user_data: ud,
          custom_data: { search_string: q, data_quality: "self_pin_v1:search" }
        })
      });
    } catch(e){window.LighomUtil&&window.LighomUtil.logErr&&window.LighomUtil.logErr("Pin Search v1",e);}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go);
  else go();
})();
</script>