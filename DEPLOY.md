# Deployment Guide

## Phase 1 — Cloudflare prep (~10 min)

1. Sign in to Cloudflare. Add `lighom.com` as a zone if not already.
2. **R2 → Create bucket** → name `lighom-feeds` (no public access; the Worker
   reads it via binding).
3. **R2 → Manage API tokens → Create API token**.
   Permission: *Object Read & Write* on bucket `lighom-feeds`.
   Save 4 values:
   - Access Key ID
   - Secret Access Key
   - Endpoint URL (looks like `https://<accountid>.r2.cloudflarestorage.com`)
   - Bucket = `lighom-feeds`

## Phase 2 — Shopline API token (5 min)

Lighom store admin → **App Marketplace → Develop Apps → Create**.
Permissions: `read_products`, `read_inventory`. Generate access token.
Domain is your store admin host, e.g. `lighom.myshopline.com`.

## Phase 3 — GitHub setup (5 min)

Push this folder to a public GitHub repo (recommended; avoids Actions quota)
or to your existing Pinterest-pin repo as a sibling — `meta-feed/` and the
workflow file are self-contained.

Add **6 repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `SHOPLINE_API_TOKEN` | from Phase 2 |
| `SHOPLINE_DOMAIN` | `lighom.myshopline.com` |
| `R2_ACCESS_KEY_ID` | from Phase 1 |
| `R2_SECRET_ACCESS_KEY` | from Phase 1 |
| `R2_ENDPOINT` | `https://<accountid>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | `lighom-feeds` |

## Phase 4 — Deploy Cloudflare Worker (5 min)

```bash
cd server
npm install
npx wrangler login         # opens browser, sign in
npx wrangler deploy        # creates the Worker + binds R2 + binds lighom-feed-server.dikecarmem750.workers.dev
```

`wrangler deploy` will prompt to add the DNS record for `lighom-feed-server.dikecarmem750.workers.dev`
the first time. Accept it.

Verify:
```bash
curl https://lighom-feed-server.dikecarmem750.workers.dev/health
# Expect:  {"status":"no_feed"}    (no feed in R2 yet — that's fine)
```

## Phase 5 — First Actions run (manual trigger)

GitHub repo → **Actions → Generate Meta Feed → Run workflow**.

Runtime: ~90 min for full Shopline pull. Watch live logs.

When green, verify:
```bash
curl -s https://lighom-feed-server.dikecarmem750.workers.dev/health | jq
# {
#   "status": "ok",
#   "age_hours": 0.05,
#   "size_mb": 950.x,
#   "variant_count": "106128",
#   "generated_at": "2026-...",
#   "healthy": true
# }

curl -I https://lighom-feed-server.dikecarmem750.workers.dev/meta.xml
# 200, Content-Type: application/xml; charset=utf-8

# uniqueness check
curl -s https://lighom-feed-server.dikecarmem750.workers.dev/meta.xml \
  | grep -oE '<g:id>[^<]+</g:id>' | sort | uniq -c | awk '$1>1'
# Expect empty output (no duplicates)
```

If any of the above fails, see **Troubleshooting** below.

## Phase 6 — Add to Meta Commerce Manager

Commerce Manager → Catalog → **Data Sources → Add Items → Use Bulk Upload →
Scheduled feed**.

| Field | Value |
|---|---|
| URL | `https://lighom-feed-server.dikecarmem750.workers.dev/meta.xml` |
| Schedule | Hourly |
| Update behavior | **Update only** (preserves learning data on existing IDs) |
| Currency | USD |

Keep the existing Shopline auto-sync **enabled** as backup for 7–14 days.
Once you confirm ASC ROAS is stable on the new feed, you can disable it.

## Phase 7 — Cron (no action needed)

After the first manual run succeeds, the workflow will fire on its own
every 4 hours (`cron: 0 */4 * * *`). To pause: rename or delete the workflow
file. To run on demand: GitHub → Actions → Run workflow.

## Monitoring

- Daily glance: `curl https://lighom-feed-server.dikecarmem750.workers.dev/health`
- Weekly: open `https://lighom-feed-server.dikecarmem750.workers.dev/status` (last 24 runs table)
- Meta side: Commerce Manager → Catalog → Diagnostics

## Phase 8 — Meta CAPI Relay (optional, for EMQ ≥ 8)

The Worker also relays Shopline order webhooks to Meta CAPI. This adds
`fbc/fbp/em/ph/fn/ln/ct/st/zp/country/external_id/client_ip/client_ua` to
each Purchase event server-side, raising Event Match Quality from 5-6 to 8-9.

### 8.1 Set Worker secrets

```bash
cd server

# Meta Pixel ID (public, but kept as secret for clean separation)
echo "479292381165317" | npx wrangler secret put META_PIXEL_ID

# CAPI access token (NEVER commit; rotate via Meta Events Manager)
npx wrangler secret put META_CAPI_ACCESS_TOKEN
# paste the EAA... token when prompted

# Webhook signature secret (you'll generate this in Phase 8.2)
npx wrangler secret put SHOPLINE_WEBHOOK_SECRET
# paste the secret you choose

# Optional — for Events Manager Test Events tab while debugging
# npx wrangler secret put META_TEST_EVENT_CODE   # paste TESTxxxx

npx wrangler deploy
```

Verify:
```bash
curl "https://lighom-feed-server.dikecarmem750.workers.dev/capi/health?key=$FEED_TOKEN"
# {"ok":true,"pixel_id":"479292381165317","has_access_token":true,
#  "has_webhook_secret":true,"api_version":"v21.0", ...}
```

### 8.2 Subscribe Shopline webhook → Worker

Create private Shopline app first if not done:
- Lighom admin → **Apps → Develop Apps → Create app**
- Permissions: `read_orders`, `read_customers`
- Generate access token (the merchant-side admin token, not Meta CAPI token)

Then subscribe `orders/create`:

```bash
SHOPLINE_TOKEN="<merchant admin api token>"
SECRET="<the SHOPLINE_WEBHOOK_SECRET you set above>"

curl -X POST "https://lighom.myshopline.com/admin/openapi/v20260901/webhooks.json" \
  -H "Authorization: Bearer $SHOPLINE_TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{
    "webhook": {
      "api_version": "v20240601",
      "topic": "orders/create",
      "address": "https://lighom-feed-server.dikecarmem750.workers.dev/capi/order",
      "secret": "'"$SECRET"'"
    }
  }'
```

(Some Shopline versions deliver the secret via header config rather than
inline — adjust `secret` field per current API spec.)

### 8.3 Test

1. In Meta Events Manager → your Pixel → **Test events**, copy the test code
   `TESTxxxx` and run `npx wrangler secret put META_TEST_EVENT_CODE`.
2. Place a real test order on lighom.com.
3. Worker tail for live debug: `npx wrangler tail`
4. Test events tab should show your Purchase with all 13 match params.

Once verified, **delete** `META_TEST_EVENT_CODE`:
```bash
npx wrangler secret delete META_TEST_EVENT_CODE
npx wrangler deploy
```

### 8.4 Browser side prerequisites

The Worker depends on browser-set fields for highest EMQ. Confirm these
custom code blocks are deployed in Shopline admin (Apps → Custom Code):

| Block | Purpose |
|---|---|
| Lighom Capture All Click IDs | sets `_fbc` cookie from `?fbclid=` |
| Lighom User Data Enricher | hashes em/ph/etc + bootstraps `_fbp` |
| Lighom Cart Attributes Injector | mirrors `_fbc/_fbp/_user_agent/UTM` into cart.attributes |

If any are missing, EMQ will plateau at 6-7.

## Phase 9 — BigQuery dual-write (optional, Worker streams every order to BQ)

`/capi/order` writes each order in parallel to (1) Meta CAPI (existing) and
(2) a BigQuery `lighom_capi.orders` table — for permanent record, ad-hoc SQL,
historical analysis, and Looker dashboards.

Failure isolation: BQ insert failures do **not** affect Meta delivery
(Promise.allSettled). If `GCP_SA_JSON` secret is unset, BQ write is skipped
silently and only Meta fires.

### 9.1 Create GCP project + Service Account

1. https://console.cloud.google.com — create project `lighom-analytics`
2. APIs & Services → Library → enable **BigQuery API**
3. IAM → Service Accounts → Create:
   - Name: `lighom-worker-bq`
   - Roles: **BigQuery Data Editor** + **BigQuery Job User**
4. Keys → Add Key → JSON → download (keep this file SECRET, never commit)

### 9.2 Create dataset + table

In BigQuery Console for project `lighom-analytics`:

```sql
CREATE SCHEMA `lighom-analytics.lighom_capi`
  OPTIONS(location='US');

CREATE TABLE `lighom-analytics.lighom_capi.orders` (
  event_id STRING NOT NULL,
  event_time TIMESTAMP NOT NULL,
  event_name STRING NOT NULL,
  order_id STRING,
  user_id STRING,
  email_hashed STRING,
  phone_hashed STRING,
  fbc STRING,
  fbp STRING,
  client_ip STRING,
  client_ua STRING,
  value FLOAT64,
  currency STRING,
  product_ids ARRAY<STRING>,
  utm_source STRING,
  utm_medium STRING,
  utm_campaign STRING,
  country STRING,
  city_hashed STRING,
  meta_capi_status STRING,
  meta_capi_response STRING
)
PARTITION BY DATE(event_time)
CLUSTER BY event_name, country;
```

### 9.3 Set Worker secrets

```bash
cd server
# Paste full SA JSON file content (multi-line — wrangler accepts via stdin)
cat /path/to/lighom-worker-bq-XXXXX.json | npx wrangler secret put GCP_SA_JSON

echo "lighom-analytics" | npx wrangler secret put GCP_PROJECT_ID

# Optional dataset / table override
# echo "lighom_capi" | npx wrangler secret put BQ_DATASET
# echo "orders"      | npx wrangler secret put BQ_TABLE

npx wrangler deploy
```

Verify:
```bash
curl "https://lighom-feed-server.dikecarmem750.workers.dev/capi/health?key=$FEED_TOKEN"
# expect: bigquery_enabled: true, bq_project: "lighom-analytics", ...
```

### 9.4 Test with a real order

```bash
# Worker live tail
cd server && npx wrangler tail
# Then place a test order on lighom.com.
# Tail should show: "ok": true, "bigquery": {"ok": true}
```

```sql
-- BigQuery
SELECT *
FROM `lighom-analytics.lighom_capi.orders`
ORDER BY event_time DESC
LIMIT 10;
```

### 9.5 Trade-offs / known limits

- `meta_capi_status` is always `'pending'` because BQ insert runs in parallel
  with Meta call (we don't yet know Meta result at insert time). To capture
  actual Meta result in BQ, switch to sequential write in `capi.js` — costs
  ~200ms extra latency per order.
- Token cache is module-scoped (per Worker isolate). Workers may run multiple
  isolates; cache hit rate ~90%+ in steady state.
- BQ Streaming Insert quota: 10K rows/sec per table — far above Lighom load.
- Insert deduplication via `insertId = event_id` — Shopline webhook retry
  storms result in idempotent BQ writes within 1 min window.

## Troubleshooting

### `health` returns `no_feed`
- Generator hasn't completed once. Check GitHub Actions logs.
- First run failed at upload. Check `R2_*` secrets.

### `health.healthy = false` (age > 6 h)
- Cron may have failed. Check Actions tab; re-trigger manually.
- Workflow timeout: bump `timeout-minutes` in `meta-feed.yml`.

### Duplicate `g:id` (validator fails)
- Should never happen — `validator.py` enforces uniqueness pre-upload.
- If it does, the feed isn't uploaded; previous R2 file is preserved.
- Inspect Actions log for which IDs collided; usually a Shopline data issue.

### Meta says "feed cannot be fetched"
- Check Worker is reachable: `curl -I https://lighom-feed-server.dikecarmem750.workers.dev/meta.xml`
- If 503: feed not uploaded yet — check Actions.
- If 200 but Meta still complains: check `Content-Type` is `application/xml`.

### Pinterest pin automation seems affected
- It shouldn't be — this stack is fully isolated under `meta-feed/` and the
  `Generate Meta Feed` workflow. Pinterest pin code lives in a separate
  workflow (`pinterest-pin.yml`) and shares only repo space.

### CAPI relay returns 401 invalid_signature
- `SHOPLINE_WEBHOOK_SECRET` Worker has must match what Shopline sends.
- Re-subscribe webhook with new secret OR delete the wrangler secret to skip
  verification (NOT recommended for prod).

### CAPI relay returns 200 but Meta Test Events shows nothing
- `META_TEST_EVENT_CODE` set? Match the code in Test Events tab.
- Check `wrangler tail` for the Meta response body.
- `meta_response.events_received` should be 1 if accepted.

### EMQ still 5-6 after CAPI relay deployed
- Check 24h after first orders flow — match score updates daily, not real-time.
- Inspect Test Events → click order → "Match Quality" tab → confirm `em/ph/fbc/fbp`
  fields shown.
- If `fbc/fbp` missing: Cart Attributes Injector not firing. Check that `_fbc`
  cookie sets when entering with `?fbclid=...`.

### BigQuery insert returns 401 / 403
- Service Account roles missing — need `BigQuery Data Editor` + `BigQuery Job User`
- GCP_SA_JSON corrupted — re-paste JSON, ensure no whitespace stripped

### BigQuery insert returns "no such table"
- Dataset/table not created yet — see Phase 9.2 SQL
- BQ_DATASET or BQ_TABLE secret typo — defaults are `lighom_capi` / `orders`

### `bigquery_enabled: false` in /capi/health
- GCP_SA_JSON secret never set or got deleted: `wrangler secret list`

### Worker latency spike on first order after cache miss
- First call after deploy / 55min idle = JWT signing + token exchange (~300ms)
- Subsequent calls reuse cached token = <50ms BQ overhead
- Acceptable since Shopline webhook tolerates 30s response

### Roll back to old Smart Feed
1. Comment out `cron:` in `.github/workflows/meta-feed.yml` (don't delete).
2. In Meta Commerce Manager, switch the data source back to the Shopline
   Smart Feed URL: `http://public.myshopline.com/prod/file/facebook/feed/lighom_50345.xml`
3. The R2 feed remains; old IDs are still preserved.
