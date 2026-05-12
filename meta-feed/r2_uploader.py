"""Upload feed XML to Cloudflare R2 (S3-compatible API)."""
from __future__ import annotations

import datetime as _dt
import os
import boto3

# Minimum local-file size sanity gate. Any feed XML < 50MB is almost certainly
# truncated / half-written and must not be uploaded — would shrink the
# served catalog and (on Pinterest) trigger LARGE_PRODUCT_COUNT_DECREASE.
MIN_FEED_SIZE_BYTES = 50 * 1024 * 1024   # 50 MB


def _client():
    return boto3.client(
        's3',
        endpoint_url=os.environ['R2_ENDPOINT'],
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        region_name='auto',
    )


def get_last_variant_count(key: str) -> int | None:
    """Read variant-count from the current R2 object's metadata.
    Returns None if no prior object exists. Used by sanity check before re-upload."""
    bucket = os.environ['R2_BUCKET']
    client = _client()
    try:
        head = client.head_object(Bucket=bucket, Key=key)
    except Exception:
        return None
    md = head.get('Metadata') or {}
    raw = md.get('variant-count') or md.get('variant_count')
    if not raw:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _verify_local(local_file: str) -> int:
    """Pre-flight check: file exists, size > floor, XML is well-formed at end.
    Returns size on success, raises RuntimeError on any failure."""
    if not os.path.exists(local_file):
        raise RuntimeError(f'verify_local: file missing: {local_file}')
    size = os.path.getsize(local_file)
    if size < MIN_FEED_SIZE_BYTES:
        raise RuntimeError(
            f'verify_local: {local_file} is only {size/1024/1024:.1f} MB '
            f'(< {MIN_FEED_SIZE_BYTES/1024/1024:.0f} MB floor) — likely truncated, refusing upload'
        )
    # Check trailing bytes for proper XML close
    with open(local_file, 'rb') as f:
        f.seek(-512, os.SEEK_END)
        tail = f.read().decode('utf-8', errors='replace')
    if '</rss>' not in tail and '</channel>' not in tail:
        raise RuntimeError(
            f'verify_local: {local_file} does not end with </rss> or </channel> — likely truncated'
        )
    return size


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

    # Pre-flight: refuse to upload obviously-bad local files
    local_size = _verify_local(local_file)

    client = _client()
    with open(local_file, 'rb') as f:
        client.upload_fileobj(
            f, bucket, key,
            ExtraArgs={'ContentType': content_type, 'Metadata': metadata},
        )

    # Post-flight: HEAD the just-uploaded object and confirm size matches.
    # If R2 returns a different (smaller) size, the upload was incomplete and
    # we must raise — caller can then refuse to advance the "last good" marker.
    head = client.head_object(Bucket=bucket, Key=key)
    remote_size = head.get('ContentLength', 0)
    if remote_size != local_size:
        raise RuntimeError(
            f'r2 upload size mismatch: local={local_size} remote={remote_size} '
            f'for r2://{bucket}/{key}'
        )
    print(f'[r2] uploaded & verified {local_size/1024/1024:.1f} MB → r2://{bucket}/{key}', flush=True)
    return {'bucket': bucket, 'key': key, 'size': local_size, 'metadata': metadata}


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
