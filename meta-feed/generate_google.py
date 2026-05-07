"""Google Shopping feed generator — runs in GitHub Actions.

Uploads to r2://lighom-feeds/google-feed.xml.
"""
from __future__ import annotations

import sys
import time
import urllib.request
from pathlib import Path

from shopline_client import fetch_all_products, discover_spu_ids
from product_processor import process_products, derive_cat_map_from_smart_feed_xml
from r2_uploader import upload_feed, upload_log
from google_xml_builder import build_google_xml
from validator import validate

LOCAL_XML = '/tmp/google-feed.xml'
LOCAL_SMART_FEED = '/tmp/smart-feed.xml'
SMART_FEED_URL = 'http://public.myshopline.com/prod/file/facebook/feed/lighom_50345.xml'


def _download_smart_feed_for_categories():
    print(f'[google] downloading Smart Feed cat map from {SMART_FEED_URL}', flush=True)
    urllib.request.urlretrieve(SMART_FEED_URL, LOCAL_SMART_FEED)
    cat_map = derive_cat_map_from_smart_feed_xml(LOCAL_SMART_FEED)
    print(f'[google] cat map size: {len(cat_map)}', flush=True)
    return cat_map


def main() -> int:
    t0 = time.time()
    log = {'feed': 'google', 'success': False}
    try:
        spu_ids = discover_spu_ids()
        cat_map = _download_smart_feed_for_categories()
        products = fetch_all_products(spu_ids)

        print(f'[google] processing {len(products)} products...', flush=True)
        items = process_products(products, cat_map=cat_map)
        print(f'[google] generated {len(items)} catalog items', flush=True)

        print('[google] writing XML...', flush=True)
        xml = build_google_xml(items)
        Path(LOCAL_XML).write_text(xml, encoding='utf-8')

        print('[google] validating...', flush=True)
        v = validate(LOCAL_XML)
        if not v['valid']:
            log['errors'] = v['errors']
            log['stats'] = v['stats']
            print(f'[google] VALIDATION FAILED: {v["errors"]}', flush=True)
            upload_log(log)
            return 1

        print('[google] uploading to R2...', flush=True)
        upload_feed(LOCAL_XML, 'google-feed.xml',
                    variant_count=v['stats']['item_count'])

        log.update({
            'success': True,
            'variantCount': v['stats']['item_count'],
            'feedSize': Path(LOCAL_XML).stat().st_size,
            'durationMs': int((time.time() - t0) * 1000),
            'note': 'github actions (google)',
        })
        upload_log(log)
        print(f'[google] done in {(time.time()-t0)/60:.1f}min', flush=True)
        return 0
    except Exception as e:
        log['error'] = repr(e)
        log['durationMs'] = int((time.time() - t0) * 1000)
        try: upload_log(log)
        except Exception: pass
        raise


if __name__ == '__main__':
    sys.exit(main())
