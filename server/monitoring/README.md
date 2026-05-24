# Lighom CAPI Monitoring

## daily_health_check.sql

Daily health snapshot covering today's (2026-05-22) fix surface:
- Bot filter false-positive (FB/Pinterest/IG/TikTok in-app browsers)
- Meta/Pinterest CAPI success rate
- event_time future timestamp errors
- Fake marker leakage (fbc/fbp/epik test sentinels)
- CF geo enrichment coverage (country/st/ct)
- Webhook /capi/order silence detection

## Schedule via BQ Console

1. Open https://console.cloud.google.com/bigquery → Scheduled queries
2. Create new
3. Paste content of `daily_health_check.sql`
4. Schedule: every day 09:00 UTC
5. Destination table: `optimum-task-474509-b3.lighom_capi.daily_health` (auto-append for trend)
6. Email failures to operator address

## Alerts to act on

| Alert | Meaning | Action |
|---|---|---|
| `🔴 BOT_FP_SPIKE` | >10 in-app browser users blocked. New UA pattern leaked into BOT_UA_PATTERNS or ASN | Grep client_ua + asn, update `bot_filter.js` |
| `🔴 META_FAIL_SPIKE` | >5 Meta CAPI errors. Auth / format / API change | Look at meta_capi_response for error type |
| `🟡 TIMESTAMP_ERR` | Some event_time past Meta 7-day cutoff or future | Verify events.js clamp still active |
| `🟡 FAKE_MARKER_LEAK` | >50 events with test/debug strings in fbc/fbp/epik | Search source — admin testing leaked, audit gates |
| `🟡 GEO_DROP` | <85% events have country | CF down? request.cf disabled? |
| `🟡 WEBHOOK_SILENT` | 0 orders 24h but engagement active | Shopline webhook config broken — check admin → notifications |

## Manual one-off

```bash
bq query --use_legacy_sql=false --format=pretty \
  < /Users/asd/lighom-feed-system/server/monitoring/daily_health_check.sql
```

## Reference

- Worker version trail: see git log or `wrangler deployments list`
- BQ tables: `optimum-task-474509-b3.lighom_capi.engagements` + `.orders`
- Bot filter rules: `src/bot_filter.js`
- CF geo enrichment: `src/events.js` (request.cf block, ~line 102-122)
