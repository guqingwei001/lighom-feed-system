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

### Roll back to old Smart Feed
1. Comment out `cron:` in `.github/workflows/meta-feed.yml` (don't delete).
2. In Meta Commerce Manager, switch the data source back to the Shopline
   Smart Feed URL: `http://public.myshopline.com/prod/file/facebook/feed/lighom_50345.xml`
3. The R2 feed remains; old IDs are still preserved.
