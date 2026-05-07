# Lighom Meta Catalog Feed — Automation

Generates Lighom's Meta product catalog every 4 hours and serves it on
`https://feed.lighom.com/meta.xml`.

```
GitHub Actions (cron 0 */4 * * *)
   │
   ▼  python meta-feed/generate.py
   ├─ pull all SPUs from Shopline OpenAPI (~90 min, 5 workers)
   ├─ parse spec table, transform to variant-level items (~106k)
   ├─ build v3 RSS-2.0 XML (~900 MB)
   └─ validate (uniqueness / required fields / well-formed)
        │
        ▼  S3-compatible PUT
   Cloudflare R2 bucket  lighom-feeds
        │
        ▼  fetch
   Cloudflare Worker  feed.lighom.com
        │
        ▼  GET /meta.xml
   Meta Commerce Manager  scheduled feed source
```

Cost: $0/month (Cloudflare R2 free tier 10 GB / 1 M ops; GH Actions public-repo
unlimited; Worker free 100k req/day).

---

## Layout

```
lighom-feed-system/
├── meta-feed/                     ← Python generator (runs in Actions)
│   ├── shopline_client.py
│   ├── description_parser.py     spec-table parsing + normalizers
│   ├── gpc_map.py                94 customCat → Google Product Category
│   ├── product_processor.py      Shopline product → variant items
│   ├── xml_builder.py            v3 Meta XML
│   ├── validator.py              uniqueness / required-field / well-formed checks
│   ├── r2_uploader.py            boto3 → R2
│   └── generate.py               entry point
├── server/                        ← Cloudflare Worker
│   ├── src/index.js              /meta.xml /health /status
│   ├── wrangler.toml
│   └── package.json
├── .github/workflows/
│   └── meta-feed.yml             cron trigger
├── requirements.txt
├── DEPLOY.md                     ← step-by-step deploy guide
└── README.md
```

## Critical guarantees enforced at build time

The `validator.py` blocks upload to R2 if any of these fail:
- duplicate `g:id`
- missing required field on any item (`id` / `item_group_id` / `title` / `link` / `image_html` / `price`)
- XML not well-formed
- `item_count < 1000` (sanity floor)

If validation fails the previous R2 feed is preserved and the workflow exits
non-zero, surfacing as a red ✗ on the GitHub Actions page.

## URLs

- Feed: `https://feed.lighom.com/meta.xml`
- Health: `https://feed.lighom.com/health` (JSON)
- Status: `https://feed.lighom.com/status` (HTML, last 24 cron runs)
- Logs: each run uploads `r2://lighom-feeds/logs/YYYY/MM/DDTHHMMSS.json`

See [DEPLOY.md](DEPLOY.md) for setup steps.
