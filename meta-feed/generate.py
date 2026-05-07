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
from r2_uploader import upload_feed, upload_log
from xml_builder import build_meta_xml
from validator import validate

LOCAL_XML = '/tmp/meta-feed.xml'
LOCAL_SMART_FEED = '/tmp/smart-feed.xml'
SMART_FEED_URL = 'http://public.myshopline.com/prod/file/facebook/feed/lighom_50345.xml'


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

        print(f'[meta] processing {len(products)} products...', flush=True)
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

        print('[meta] uploading to R2...', flush=True)
        upload_feed(LOCAL_XML, 'meta-feed.xml',
                    variant_count=v['stats']['item_count'])

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
