-- Lighom CAPI Daily Health Check
-- Schedule: BQ Scheduled Query, daily 09:00 UTC, query yesterday's data
-- Covers: bot filter / CF geo / isCleanPII / event_time / fake markers / EMQ field coverage
--
-- Run via: bq query --use_legacy_sql=false --format=pretty < monitoring/daily_health_check.sql
-- Or: schedule in BQ Console → Scheduled Queries → save results to table for trend tracking

WITH yesterday AS (
  SELECT *
  FROM `optimum-task-474509-b3.lighom_capi.engagements`
  WHERE DATE(event_time) = CURRENT_DATE() - 1
),

-- 1. Volume + bot filter
v_summary AS (
  SELECT
    COUNT(*) AS total_events,
    COUNTIF(is_bot = TRUE) AS bot_blocked,
    COUNTIF(is_bot = FALSE) AS real_events,
    ROUND(100 * COUNTIF(is_bot = TRUE) / COUNT(*), 1) AS pct_bot
  FROM yesterday
),

-- 2. Bot filter false-positive risk: real users with FBAN/Pinterest in-app UAs being blocked
v_bot_fp AS (
  SELECT
    COUNT(*) AS in_app_events_blocked,
    COUNT(DISTINCT user_id) AS in_app_users_blocked
  FROM yesterday
  WHERE is_bot = TRUE
    AND REGEXP_CONTAINS(client_ua, r"FBAN|FBIOS|FB4A|Pinterest/iOS|PinterestAndroid|Instagram|TikTok|Snapchat|TwitterAndroid")
),

-- 3. CAPI success rates
v_capi AS (
  SELECT
    COUNTIF(meta_capi_status = "ok") AS meta_ok,
    COUNTIF(meta_capi_status = "fail") AS meta_fail,
    COUNTIF(pinterest_status = "ok") AS pin_ok,
    COUNTIF(pinterest_status = "fail") AS pin_fail,
    COUNTIF(meta_capi_response LIKE "%事件时间戳属于将来时间%" OR meta_capi_response LIKE "%timestamp%future%") AS event_time_errors
  FROM yesterday
  WHERE is_bot = FALSE
),

-- 4. Fake markers detection
v_fake AS (
  SELECT
    COUNTIF(REGEXP_CONTAINS(fbc, r"test|debug|dev|sample|enricher|ENRICHER_V10")) AS fake_fbc,
    COUNTIF(REGEXP_CONTAINS(fbp, r"test|debug|dev|sample|enricher")) AS fake_fbp,
    COUNTIF(REGEXP_CONTAINS(epik, r"test|debug|dev|sample|enricher")) AS fake_epik,
    COUNTIF(REGEXP_CONTAINS(LOWER(user_id), r"test|debug|dev|sample|enricher")) AS fake_xid
  FROM yesterday
  WHERE is_bot = FALSE
),

-- 5. CF geo enrichment coverage (post fix should be 90%+ for non-bot events)
v_geo AS (
  SELECT
    COUNTIF(is_bot = FALSE) AS denom,
    COUNTIF(is_bot = FALSE AND country_present) AS has_country,
    COUNTIF(is_bot = FALSE AND st_present) AS has_st,
    COUNTIF(is_bot = FALSE AND ct_present) AS has_ct,
    ROUND(100 * COUNTIF(is_bot = FALSE AND country_present) / NULLIF(COUNTIF(is_bot = FALSE), 0), 1) AS pct_country,
    ROUND(100 * COUNTIF(is_bot = FALSE AND st_present) / NULLIF(COUNTIF(is_bot = FALSE), 0), 1) AS pct_st,
    ROUND(100 * COUNTIF(is_bot = FALSE AND ct_present) / NULLIF(COUNTIF(is_bot = FALSE), 0), 1) AS pct_ct
  FROM yesterday
),

-- 6. Webhook /capi/order health
v_orders AS (
  SELECT
    COUNT(*) AS orders,
    COUNTIF(meta_capi_status = "ok") AS meta_ok,
    COUNTIF(pinterest_status = "ok") AS pin_ok,
    COUNTIF(external_id IS NOT NULL) AS has_xid
  FROM `optimum-task-474509-b3.lighom_capi.orders`
  WHERE DATE(event_time) = CURRENT_DATE() - 1
)

SELECT
  CURRENT_DATE() - 1 AS check_date,
  v_summary.total_events,
  v_summary.bot_blocked,
  v_summary.real_events,
  v_summary.pct_bot AS bot_pct,
  v_bot_fp.in_app_users_blocked AS bot_fp_users,
  v_capi.meta_ok,
  v_capi.meta_fail,
  v_capi.pin_ok,
  v_capi.pin_fail,
  v_capi.event_time_errors,
  v_fake.fake_fbc,
  v_fake.fake_fbp,
  v_fake.fake_epik,
  v_fake.fake_xid,
  v_geo.pct_country AS geo_country_pct,
  v_geo.pct_st AS geo_st_pct,
  v_geo.pct_ct AS geo_ct_pct,
  v_orders.orders AS webhook_orders,
  v_orders.meta_ok AS webhook_meta_ok,
  v_orders.pin_ok AS webhook_pin_ok,
  -- Alert thresholds (manual review if any of these true)
  CASE WHEN v_bot_fp.in_app_users_blocked > 10 THEN '🔴 BOT_FP_SPIKE' ELSE '✓' END AS alert_bot_fp,
  CASE WHEN v_capi.meta_fail > 5 THEN '🔴 META_FAIL_SPIKE' ELSE '✓' END AS alert_meta_fail,
  CASE WHEN v_capi.event_time_errors > 0 THEN '🟡 TIMESTAMP_ERR' ELSE '✓' END AS alert_ts,
  CASE WHEN v_fake.fake_fbc + v_fake.fake_fbp + v_fake.fake_epik > 50 THEN '🟡 FAKE_MARKER_LEAK' ELSE '✓' END AS alert_fake,
  CASE WHEN v_geo.pct_country < 85 THEN '🟡 GEO_DROP' ELSE '✓' END AS alert_geo,
  CASE WHEN v_orders.orders = 0 AND v_summary.real_events > 1000 THEN '🟡 WEBHOOK_SILENT' ELSE '✓' END AS alert_webhook
FROM v_summary, v_bot_fp, v_capi, v_fake, v_geo, v_orders;
