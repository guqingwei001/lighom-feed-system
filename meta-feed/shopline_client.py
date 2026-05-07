"""Shopline OpenAPI client — fetch all products with pagination + retry.

The Lighom store has ~15K products. Shopline OpenAPI exposes products by ID
(GET /products/{id}.json). There is no list endpoint with our token's scope,
so we paginate via a known SPU-id catalog (proxied from the existing Smart
Feed XML or analytics export).

For GitHub Actions:
- 5 concurrent workers, ~3 req/sec ≈ 90 min for 15K products
- Rate-limit safe; OK on `ubuntu-latest` runner with 6 hr job timeout

Env vars (from GitHub Secrets):
    SHOPLINE_API_TOKEN   — Bearer token
    SHOPLINE_DOMAIN      — e.g. lighom.myshopline.com
    SHOPLINE_SPU_LIST_URL — optional public URL of newline-delimited SPU IDs
                            (defaults to Smart Feed XML on public.myshopline.com)
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Iterable

DEFAULT_SMART_FEED_URL = (
    'http://public.myshopline.com/prod/file/facebook/feed/lighom_50345.xml'
)


def _api_base() -> str:
    domain = os.environ['SHOPLINE_DOMAIN'].rstrip('/')
    return f'https://{domain}/admin/openapi/v20260901'


def _auth_headers() -> dict:
    return {'Authorization': f'Bearer {os.environ["SHOPLINE_API_TOKEN"]}'}


def discover_spu_ids() -> list[str]:
    """Pull the universe of SPU IDs by parsing the Smart Feed XML on the CDN.
    This is the cheapest reliable enumeration method for our token scope.
    """
    url = os.environ.get('SHOPLINE_SPU_LIST_URL', DEFAULT_SMART_FEED_URL)
    print(f'[shopline] discovering SPU ids from {url}', flush=True)
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=180) as r:
        data = r.read().decode('utf-8', errors='replace')
    seen, out = set(), []
    for m in re.finditer(r'<g:item_group_id>(\d+)</g:item_group_id>', data):
        sid = m.group(1)
        if sid not in seen:
            seen.add(sid); out.append(sid)
    print(f'[shopline] discovered {len(out)} unique SPU ids', flush=True)
    return out


def _fetch_one(spu: str, retries: int = 4) -> tuple[str, dict | None, str | None]:
    base = _api_base()
    url = f'{base}/products/{spu}.json'
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=_auth_headers())
            with urllib.request.urlopen(req, timeout=15) as r:
                body = json.loads(r.read())
            return spu, body.get('product', body), None
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503):
                time.sleep((1.5 ** attempt) * 0.5); continue
            return spu, None, f'HTTP {e.code}'
        except Exception as e:
            time.sleep(0.5)
            if attempt == retries - 1:
                return spu, None, str(e)[:160]
    return spu, None, 'retries exhausted'


def fetch_all_products(spu_ids: Iterable[str] | None = None,
                      max_workers: int = 5) -> list[dict]:
    """Fetch every product. Returns a list of Shopline product dicts."""
    if spu_ids is None:
        spu_ids = discover_spu_ids()
    spu_ids = list(spu_ids)
    print(f'[shopline] fetching {len(spu_ids)} products with {max_workers} workers', flush=True)

    out, errors = [], []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {ex.submit(_fetch_one, s): s for s in spu_ids}
        n_done = 0
        for fut in as_completed(futures):
            spu, prod, err = fut.result()
            n_done += 1
            if err:
                errors.append((spu, err))
            else:
                out.append(prod)
            if n_done % 500 == 0:
                rate = n_done / (time.time() - t0 + 1e-9)
                eta = (len(spu_ids) - n_done) / max(rate, 0.1)
                print(f'[shopline]   {n_done}/{len(spu_ids)} ok={len(out)} '
                      f'err={len(errors)} rate={rate:.1f}/s eta={eta/60:.1f}min',
                      flush=True)
    elapsed = (time.time() - t0) / 60
    print(f'[shopline] done in {elapsed:.1f}min: ok={len(out)} err={len(errors)}', flush=True)
    if errors:
        for spu, err in errors[:10]:
            print(f'[shopline]   error {spu}: {err}', flush=True)
    return out
