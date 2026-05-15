"""Entry point: pull Shopline → process → build Meta XML → upload to R2.

Designed to run inside GitHub Actions every 4 hours. Total runtime ≈ 90 min
on a `ubuntu-latest` runner (most spent inside Shopline pagination).
"""
from __future__ import annotations

import sys
import time
import urllib.request
from pathlib import Path


from shopline_client import fetch_all_products, discover_spu_ids
from product_processor import (
    process_products, derive_cat_map_from_smart_feed_xml,
)
from r2_uploader import upload_feed, upload_log, get_last_variant_count
from xml_builder import build_meta_xml
from validator import validate

LOCAL_XML = '/tmp/meta-feed.xml'
LOCAL_SMART_FEED = '/tmp/smart-feed.xml'
SMART_FEED_URL = 'http://public.myshopline.com/prod/file/facebook/feed/lighom_50345.xml'
R2_KEY = 'meta-feed.xml'

# Refuse upload if new variant count drops > 10% vs previous publish (read from
# R2 metadata). Defends DPA against catastrophic feed shrinkage from build / API hiccups.
MIN_FRACTION_VS_LAST = 0.90

# Reject feed if Shopline API success rate < this fraction — defends against
# silent SPU drop (5/13 incident: ~2% SPUs lost to transient API errors).
MIN_FETCH_SUCCESS_RATE = 0.99


def _download_smart_feed_for_categories():
    """Smart Feed XML carries authoritative product_type per SPU. We use it
    purely to look up Lighom's customCat for each SPU (since analytics covers
    only ~94% of SKUs)."""
    print(f'[meta] downloading Smart Feed cat map from {SMART_FEED_URL}', flush=True)
    urllib.request.urlretrieve(SMART_FEED_URL, LOCAL_SMART_FEED)
    cat_map = derive_cat_map_from_smart_feed_xml(LOCAL_SMART_FEED)
    print(f'[meta] cat map size: {len(cat_map)}', flush=True)
    return cat_map


def main() -> int:
    t0 = time.time()
    log = {'feed': 'meta', 'success': False}

    try:
        spu_ids = discover_spu_ids()                # Smart Feed → SPU IDs
        cat_map = _download_smart_feed_for_categories()
        products = fetch_all_products(spu_ids)

        # Shortfall guard: fail fast if Shopline API silently dropped too many SPUs.
        fetch_rate = len(products) / max(len(spu_ids), 1)
        if fetch_rate < MIN_FETCH_SUCCESS_RATE:
            msg = (f'FETCH_SHORTFALL: only {len(products)}/{len(spu_ids)} = '
                   f'{fetch_rate:.2%} fetched < {MIN_FETCH_SUCCESS_RATE:.0%}. '
                   f'R2 retains previous good feed.')
            print(f'[meta] {msg}', flush=True)
            log['note'] = msg
            log['fetchRate'] = fetch_rate
            log['fetched'] = len(products)
            log['expected'] = len(spu_ids)
            log['durationMs'] = int((time.time() - t0) * 1000)
            upload_log(log)
            return 3

        print(f'[meta] processing {len(products)} products (fetch_rate={fetch_rate:.2%})...', flush=True)
        items = process_products(products, cat_map=cat_map)
        print(f'[meta] generated {len(items)} catalog items', flush=True)

        print('[meta] writing XML...', flush=True)
        xml = build_meta_xml(items)
        Path(LOCAL_XML).write_text(xml, encoding='utf-8')

        print('[meta] validating...', flush=True)
        v = validate(LOCAL_XML)
        if not v['valid']:
            log['errors'] = v['errors']
            log['stats'] = v['stats']
            print(f'[meta] VALIDATION FAILED: {v["errors"]}', flush=True)
            upload_log(log)
            return 1

        # Sanity guard: refuse upload if variant count drops > 10% vs previous publish
        new_count = v['stats']['item_count']
        last_count = get_last_variant_count(R2_KEY)
        threshold = int(last_count * MIN_FRACTION_VS_LAST) if last_count else 0
        if last_count and new_count < threshold:
            msg = (f'REFUSE_UPLOAD: new variant count {new_count} < last {last_count} × '
                   f'{MIN_FRACTION_VS_LAST} = {threshold}. R2 retains previous good feed.')
            print(f'[meta] {msg}', flush=True)
            log['note'] = msg
            log['variantCount'] = new_count
            log['lastCount'] = last_count
            log['durationMs'] = int((time.time() - t0) * 1000)
            upload_log(log)
            return 2

        print(f'[meta] uploading to R2 ({new_count} variants; last={last_count or "n/a"})...', flush=True)
        upload_feed(LOCAL_XML, R2_KEY, variant_count=new_count)

        log.update({
            'success': True,
            'variantCount': v['stats']['item_count'],
            'feedSize': Path(LOCAL_XML).stat().st_size,
            'durationMs': int((time.time() - t0) * 1000),
            'note': 'github actions',
        })
        upload_log(log)
        print(f'[meta] done in {(time.time()-t0)/60:.1f}min', flush=True)
        return 0

    except Exception as e:
        log['error'] = repr(e)
        log['durationMs'] = int((time.time() - t0) * 1000)
        try: upload_log(log)
        except Exception: pass
        raise


if __name__ == '__main__':
    sys.exit(main())
