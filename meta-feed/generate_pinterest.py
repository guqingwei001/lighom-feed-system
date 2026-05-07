"""Pinterest catalog feed generator — runs in GitHub Actions.

Same data pipeline as Meta (Shopline pull → process), but emits Pinterest XML
and uploads to r2://lighom-feeds/pinterest-feed.xml.
"""
from __future__ import annotations

import sys
import time
import urllib.request
from pathlib import Path

from shopline_client import fetch_all_products, discover_spu_ids
from product_processor import process_products, derive_cat_map_from_smart_feed_xml
from r2_uploader import upload_feed, upload_log
from pinterest_xml_builder import build_pinterest_xml
from validator import validate

LOCAL_XML = '/tmp/pinterest-feed.xml'
LOCAL_SMART_FEED = '/tmp/smart-feed.xml'
SMART_FEED_URL = 'http://public.myshopline.com/prod/file/facebook/feed/lighom_50345.xml'


def _download_smart_feed_for_categories():
    print(f'[pinterest] downloading Smart Feed cat map from {SMART_FEED_URL}', flush=True)
    urllib.request.urlretrieve(SMART_FEED_URL, LOCAL_SMART_FEED)
    cat_map = derive_cat_map_from_smart_feed_xml(LOCAL_SMART_FEED)
    print(f'[pinterest] cat map size: {len(cat_map)}', flush=True)
    return cat_map


def main() -> int:
    t0 = time.time()
    log = {'feed': 'pinterest', 'success': False}
    try:
        spu_ids = discover_spu_ids()
        cat_map = _download_smart_feed_for_categories()
        products = fetch_all_products(spu_ids)

        print(f'[pinterest] processing {len(products)} products...', flush=True)
        items = process_products(products, cat_map=cat_map)
        print(f'[pinterest] generated {len(items)} catalog items', flush=True)

        print('[pinterest] writing XML...', flush=True)
        xml = build_pinterest_xml(items)
        Path(LOCAL_XML).write_text(xml, encoding='utf-8')

        print('[pinterest] validating...', flush=True)
        v = validate(LOCAL_XML)
        if not v['valid']:
            log['errors'] = v['errors']
            log['stats'] = v['stats']
            print(f'[pinterest] VALIDATION FAILED: {v["errors"]}', flush=True)
            upload_log(log)
            return 1

        print('[pinterest] uploading to R2...', flush=True)
        upload_feed(LOCAL_XML, 'pinterest-feed.xml',
                    variant_count=v['stats']['item_count'])

        log.update({
            'success': True,
            'variantCount': v['stats']['item_count'],
            'feedSize': Path(LOCAL_XML).stat().st_size,
            'durationMs': int((time.time() - t0) * 1000),
            'note': 'github actions (pinterest)',
        })
        upload_log(log)
        print(f'[pinterest] done in {(time.time()-t0)/60:.1f}min', flush=True)
        return 0
    except Exception as e:
        log['error'] = repr(e)
        log['durationMs'] = int((time.time() - t0) * 1000)
        try: upload_log(log)
        except Exception: pass
        raise


if __name__ == '__main__':
    sys.exit(main())
