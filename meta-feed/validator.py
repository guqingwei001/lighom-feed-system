"""Meta catalog feed validator — fail closed on hard errors."""
from __future__ import annotations

import xml.etree.ElementTree as ET
from collections import Counter

NS = '{http://base.google.com/ns/1.0}'
REQUIRED = ('id', 'item_group_id', 'title', 'link', 'image_link', 'price')


def validate(xml_path: str) -> dict:
    """Streams the XML, returns {'valid': bool, 'errors': [...], 'stats': {...}}."""
    errors = []
    seen_ids = Counter()
    field_counts = Counter()
    n_items = 0
    try:
        for ev, el in ET.iterparse(xml_path, events=('end',)):
            if el.tag == 'item':
                n_items += 1
                for f in REQUIRED:
                    sub = el.find(NS + f)
                    if sub is not None and sub.text and sub.text.strip():
                        field_counts[f] += 1
                gid = el.find(NS + 'id')
                if gid is not None and gid.text:
                    seen_ids[gid.text.strip()] += 1
                el.clear()
    except ET.ParseError as e:
        errors.append(f'XML parse error: {e}')
        return {'valid': False, 'errors': errors, 'stats': {'item_count': n_items}}

    dups = [(i, n) for i, n in seen_ids.items() if n > 1]
    if dups:
        errors.append(f'duplicate g:id count={len(dups)}; first={dups[:5]}')
    for f in REQUIRED:
        if field_counts[f] != n_items:
            errors.append(f'{f} present in {field_counts[f]}/{n_items}')
    if n_items < 1000:
        errors.append(f'item count too low: {n_items} (expected ~95k–110k)')

    return {
        'valid': not errors,
        'errors': errors,
        'stats': {
            'item_count': n_items,
            'unique_ids': len(seen_ids),
            'duplicate_count': len(dups),
            'field_present': dict(field_counts),
        },
    }
