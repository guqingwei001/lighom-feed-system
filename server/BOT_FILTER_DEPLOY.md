# Bot Filter — Deployment Guide

## What changed

| File | Change |
|---|---|
| `src/bot_filter.js` | **NEW** — UA / ASN / CF threatScore 三层 bot detection |
| `src/events.js` | Added `import { detectBot }`; bot detected → CAPI fanout 跳过；BQ row 加 `is_bot` / `bot_reason` / `bot_asn` |
| `src/capi.js` | **未改** (order webhook 已有 HMAC，bot 过不了) |

## BigQuery schema 改动

`engagements` 表加 3 列。**先加列再 deploy Worker** — 否则 BQ insertAll 会因 unknown fields 报错（`ignoreUnknownValues: false` 在 bigquery.js 是写死的）。

```sql
-- 在 BQ console 跑
ALTER TABLE `optimum-task-474509-b3.lighom_capi.engagements`
ADD COLUMN is_bot BOOLEAN,
ADD COLUMN bot_reason STRING,
ADD COLUMN bot_asn INT64;
```

或者用 bq CLI:

```bash
bq update --schema \
  ./schema_engagements_with_bot.json \
  optimum-task-474509-b3:lighom_capi.engagements
```

(导一份当前 schema 加这 3 列再 update)

## Deploy

```bash
cd /Users/asd/lighom-feed-system/server
# 用 wrangler dev 先本地起来跑 smoke test (可选)
npx wrangler dev
# 跑 deploy
npx wrangler deploy
```

## 验证（部署后 5-10 分钟拉一次）

### 1. 看 bot 检测命中率

```sql
SELECT
  is_bot,
  bot_reason,
  COUNT(*) n,
  COUNT(DISTINCT page_path) pages,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) pct
FROM `optimum-task-474509-b3.lighom_capi.engagements`
WHERE event_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
GROUP BY 1, 2
ORDER BY n DESC;
```

预期：
- `is_bot=true` 占比 **30-50%**（按 GA4 5/7-5/8 数据 sl_smartads ~47% 推算）
- `bot_reason` 分布: 大部分应是 `asn:32934` (Meta) 或 `asn:16509` (AWS) 或 `ua:facebookexternalhit`

### 2. 看 fanout 是否真跳过 bot

```sql
SELECT
  is_bot,
  meta_capi_status,
  pinterest_status,
  google_status,
  COUNT(*) n
FROM `optimum-task-474509-b3.lighom_capi.engagements`
WHERE event_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
GROUP BY 1, 2, 3, 4
ORDER BY n DESC;
```

预期：`is_bot=true` 那行 meta/pin/google 应**全是 `skipped`，response 含 `bot_filtered:xxx`**。

### 3. 看真实 EMQ / fanout health 是否改善

部署后 24-48h 等数据累积，跟部署前对比：
- Meta Events Manager → ATP / EMQ 分应升
- Worker BQ orders 表里 `meta_capi_status='ok'` 比例应升（少了 bot 拖底）

## Rollback

如果发现误杀真实用户（看 BQ 里 `is_bot=true` 但有 `email_hashed` 或 `user_id`）：

**快速回滚**：在 events.js 把
```javascript
const wantMeta = fanoutSet.has('meta') && !bot.is_bot;
```
改回
```javascript
const wantMeta = fanoutSet.has('meta');
```
（pin / ga4 同样），然后 `npx wrangler deploy`。
BQ 还能继续记 `is_bot` 字段供分析，但不影响实际 fanout。

**调整阈值**：如果 ASN 列表太狠，删 `bot_filter.js` 里 `BOT_ASNS` Set 中的项即可。

## ASN 列表来源

`bot_filter.js` 里 `BOT_ASNS` 是基于公开 ASN 注册表手动选的常见数据中心 ASN：
- AWS (16509, 14618, 39111, 17493)
- Google (15169, 19527, 36492, 396982)
- Meta (32934)
- Microsoft/Azure (8075, 8068, 8074)
- Hetzner (24940), OVH (16276), Linode/Akamai (63949, 20940), Vultr (20473)
- Hydro66 Sweden DC (47366) ← **专门加的**，因为 GA4 数据显示 9.5K 假流量从那来
- Tencent / Alibaba 加上是为了应付国内数据中心爬虫

如果你自己有内部 IT 部门用 AWS lambda 测站点，他们的 ASN 也会被屏。看 bot_reason 字段能查到 ASN 编号，按需加白名单。
