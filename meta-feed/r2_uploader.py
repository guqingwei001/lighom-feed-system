"""Upload feed XML to Cloudflare R2 (S3-compatible API)."""
from __future__ import annotations

import datetime as _dt
import os
import boto3


def _client():
    return boto3.client(
        's3',
        endpoint_url=os.environ['R2_ENDPOINT'],
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        region_name='auto',
    )


def upload_feed(local_file: str, key: str, *,
                product_count: int | None = None,
                variant_count: int | None = None,
                content_type: str = 'application/xml; charset=utf-8') -> dict:
    bucket = os.environ['R2_BUCKET']
    metadata = {'generated-at': _dt.datetime.now(_dt.UTC).isoformat()}
    if product_count is not None:
        metadata['product-count'] = str(product_count)
    if variant_count is not None:
        metadata['variant-count'] = str(variant_count)

    client = _client()
    with open(local_file, 'rb') as f:
        client.upload_fileobj(
            f, bucket, key,
            ExtraArgs={'ContentType': content_type, 'Metadata': metadata},
        )
    size = os.path.getsize(local_file)
    print(f'[r2] uploaded {size/1024/1024:.1f} MB → r2://{bucket}/{key}', flush=True)
    return {'bucket': bucket, 'key': key, 'size': size, 'metadata': metadata}


def upload_log(payload: dict, key_prefix: str = 'logs') -> str:
    """Write a JSON log entry beside the feed (for /status dashboard)."""
    import json, io
    bucket = os.environ['R2_BUCKET']
    ts = _dt.datetime.now(_dt.UTC)
    key = f"{key_prefix}/{ts.strftime('%Y/%m/%dT%H%M%S')}.json"
    client = _client()
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    client.put_object(
        Bucket=bucket, Key=key, Body=body,
        ContentType='application/json',
        Metadata={'logged-at': ts.isoformat()},
    )
    print(f'[r2] log → r2://{bucket}/{key}', flush=True)
    return key
