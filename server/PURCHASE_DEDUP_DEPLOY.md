# Purchase Dedup — 3-Layer Deployment Guide

**问题**：5/9 production observation 显示 `LIG100131863 $463.80` 一单 fire 5 次（GA4 + Worker engagement 都重复），48% GA4 purchase events 是重复事件。BQ Worker /capi/order webhook 只捕获 11% 真实订单（Shopline webhook 漏）。

**3 层修法**（互相独立，可单独 deploy，叠加效果最佳）：

| 层 | 作用 | 文件 | 覆盖场景 |
|---|---|---|---|
| **L1 Worker KV dedup** | 同 order_id Purchase event 在 24h 内只 fanout 一次 | `src/events.js` + `wrangler.toml` + BQ migration | 跨设备 / 跨 session / 跨 source（最强） |
| **L2 Shopline 主题锁** | 用户刷新确认页 / 多 tab / 邮件链接重访不重 fire | `shopline_purchase_dedup.html` (本仓库根目录) | 同一浏览器 / 同设备 |
| **L3 Bot filter** | 爬虫打开 confirmation page 不算 fire（5/9 Singapore desktop case） | `src/bot_filter.js`（已部署 PR） | Meta IPv6 / AWS / 数据中心爬虫 |

---

## 部署顺序与命令

### Layer 1 — Worker KV dedup

#### Step 1: 创建 KV namespace

```bash
cd /Users/asd/lighom-feed-system/server
npx wrangler kv namespace create PURCHASE_DEDUP
```

返回类似：
```
🌀 Creating namespace with title "lighom-feed-server-PURCHASE_DEDUP"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "PURCHASE_DEDUP", id = "abc123def456..." }
```

#### Step 2: 把 `id` 粘进 `wrangler.toml`

打开 `wrangler.toml`，把 `id = "REPLACE_WITH_ID_FROM_wrangler_kv_namespace_create"` 改成上一步返回的真实 id：

```toml
[[kv_namespaces]]
binding = "PURCHASE_DEDUP"
id = "abc123def456..."   # ← 真实 id
```

#### Step 3: BQ schema migration

```sql
-- 在 BQ console 跑
ALTER TABLE `optimum-task-474509-b3.lighom_capi.engagements`
ADD COLUMN is_duplicate BOOLEAN,
ADD COLUMN duplicate_first_seen STRING;
```

⚠ 必须**先 ALTER 再 deploy Worker**，否则 BQ insertAll 会报 unknown fields。

#### Step 4: Deploy

```bash
cd /Users/asd/lighom-feed-system/server
npx wrangler deploy
```

#### Step 5: 验证

部署后 5-15 分钟拉数据验证：

```sql
-- 检查 dedup 命中
SELECT
  is_duplicate,
  COUNT(*) n,
  COUNT(DISTINCT page_url) urls,
  ROUND(SUM(value),2) total_value
FROM `optimum-task-474509-b3.lighom_capi.engagements`
WHERE event_name='Purchase'
  AND event_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 6 HOUR)
GROUP BY 1;

-- 看哪些 order 触发了 dedup
SELECT
  duplicate_first_seen,
  event_time,
  CONCAT(SUBSTR(page_url, 1, 80), '...') page_url,
  value
FROM `optimum-task-474509-b3.lighom_capi.engagements`
WHERE is_duplicate = TRUE
  AND event_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
ORDER BY event_time DESC LIMIT 20;
```

预期：`is_duplicate=TRUE` 应占 Purchase events 的 **30-50%**（基于历史比例）。

---

### Layer 2 — Shopline thank-you 主题锁

#### Step 1: 找到 Shopline 后台 custom code 入口

Shopline admin → **Settings** → **Custom code**
或 OpenAPI: `POST /admin/api/website/plugin/admin/custom-code`（见 `project_lighom_5_7_session_handoff.md`）

#### Step 2: 加新 block

- **Block name**: `purchase-dedup-thankyou-lock`
- **Trigger / Page scope**: **Order confirmation / Thank-you page only**（不要全站，否则会拦截 cart page 上的 fbq Purchase 测试）
- **Position**: `<head>` 顶部，**必须早于** Shopline native pixel block

#### Step 3: 把 `shopline_purchase_dedup.html` 内容复制粘贴进去

文件路径：`/Users/asd/lighom-feed-system/shopline_purchase_dedup.html`

#### Step 4: 测试

1. 在 production 下一个**测试单**（用 `99999...` 格式 order_id）
2. 在 thank-you 页面打开 Chrome DevTools → Console
3. 看 `[lighom-dedup] purchase suppressed for 99999...` 字样
4. 刷新页面 5 次 → 第 2-5 次应该看到 suppressed log
5. 跑这条 BQ 验证：

```sql
SELECT COUNT(*)
FROM `optimum-task-474509-b3.lighom_capi.engagements`
WHERE event_name='Purchase' AND product_id LIKE '%test%'
```

应该只有 1 行（第一次 fire 那次）。

---

### Layer 3 — Bot filter

已经 deliver 在 PR 里：`/Users/asd/lighom-feed-system/server/src/bot_filter.js`
部署指南：`/Users/asd/lighom-feed-system/server/BOT_FILTER_DEPLOY.md`

跟 L1 一起 deploy 即可（L1 改动同一文件 events.js，已经 import detectBot）。

---

## Rollback

### L1 KV dedup 误杀

如果发现 dedup 误杀了正当的 Purchase event：

```javascript
// 在 src/events.js 把这行
const wantMeta = fanoutSet.has('meta') && !bot.is_bot && !isDuplicate;
// 改回
const wantMeta = fanoutSet.has('meta') && !bot.is_bot;
```

（pin / ga4 同样），`npx wrangler deploy`。BQ 还会继续记 `is_duplicate` 字段供分析。

### L2 Shopline 锁误杀

Shopline custom code → 把 `purchase-dedup-thankyou-lock` block **disable** 即可。
或紧急用 console 跑：
```javascript
localStorage.clear(); sessionStorage.clear()
```

### L3 Bot filter 误杀

见 `BOT_FILTER_DEPLOY.md`。

---

## 预期效果（基于 5/8-5/10 真实数据）

| 指标 | 当前 | L1 部署后 | L1+L2 部署后 | L1+L2+L3 部署后 |
|---|---:|---:|---:|---:|
| Purchase event 重复率 | 48% | ~10% | ~3% | **< 2%** |
| Meta CAPI EMQ Purchase | 受脏数据拖累 | 提升 | 进一步提升 | 最高 |
| 单一 order 多重 fire | 平均 2-5 次 | 1 次（KV 拦） | 1 次 | 1 次 |
| GA4 / BQ GMV 对账 | 差 5-10x | 差 ~1.5x | 差 ~1.1x | ≈ 1:1 |

## Layered defense logic

```
Browser fires Purchase → 
  (Shopline native fbq/pintrk/gtag)
        │
        ▼
  Layer 2 wrapper checks sessionStorage/localStorage
        │
        ├─ Already fired? → noop, return
        └─ First fire → allow native fire + write storage
                │
                ▼
  Browser also sends to Worker /capi/event
        │
        ▼
  Layer 3: Worker bot_filter checks UA/ASN/threatScore
        │
        ├─ Bot? → BQ row + is_bot=true, skip fanout
        └─ Real → continue
                │
                ▼
  Layer 1: Worker KV checks `purchase_order_<id>` key
        │
        ├─ Seen in last 24h? → BQ row + is_duplicate=true, skip fanout
        └─ First seen → KV.put + fanout to Meta/Pinterest/Google CAPI
```

3 层都过完才真正 fire 一次。
