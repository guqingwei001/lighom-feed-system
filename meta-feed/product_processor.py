"""Transform raw Shopline product → list of standardized item dicts.

Output schema is platform-agnostic. Meta and Pinterest XML builders consume
the same dicts.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET

from description_parser import (
    parse_spec_table, spec_pick, parse_tags, variant_option,
    attach_resize, pick_lifestyle_image, extract_highlights,
    build_product_detail, short_description, clean_title,
    norm_color, fmt_weight, parse_weight_to_kg,
)
from gpc_map import gpc as _legacy_gpc  # kept for back-compat, not used now
from fb_category_map import fb_product_category
from google_category_map import google_category

STORE = 'https://lighom.com'
SHIPPING_COUNTRIES = ('US', 'CA', 'GB', 'AU', 'DE', 'FR')
Q_RE = re.compile(r'-Q\d+(?:[-_].*)?$', re.I)


def _link(handle: str, vid: str) -> str:
    return (
        f'{STORE}/products/{handle}?sku={vid}'
        '&utm_source=meta_catalog&utm_medium=paid_social'
        '&utm_campaign={{campaign.name}}&utm_content={{ad.name}}'
        '&utm_term={{adset.name}}&placement={{placement}}'
    )


def process_product(product: dict, custom_cat: str = '') -> list[dict]:
    """Return list of standardized variant items (zero or more)."""
    if not product:
        return []
    if (product.get('status') or '').lower() != 'active':
        return []
    handle = product.get('handle') or ''
    if not handle:
        return []
    variants = product.get('variants') or []
    if not variants:
        return []
    images = [i for i in (product.get('images') or [])
              if i.get('src') and 'trycloudflare' not in i.get('src', '')]
    if not images:
        return []
    img_by_id = {i.get('id'): i for i in images}

    # -Q exclusion
    non_q = [v for v in variants if not Q_RE.search(v.get('sku') or '')]
    q_vars = [v for v in variants if Q_RE.search(v.get('sku') or '')]
    if not non_q and q_vars:
        kept = [min(q_vars, key=lambda v: float(v.get('price') or 9e9))]
    else:
        kept = non_q
    if not kept:
        return []

    options = product.get('options') or []
    tags = product.get('tags') or ''
    tag_attrs, _ = parse_tags(tags)
    # Authoritative source: google_category_map (built from Google taxonomy 2021-09-21,
    # paths verified against actual leaf names; deeper than legacy gpc_map).
    gpc_id, gpc_path, _conf = google_category(custom_cat)
    fb_cat_id = fb_product_category(custom_cat)

    # Option names already covered by g:color/g:size/g:material/g:pattern.
    # Anything else becomes additional_variant_attribute (per Meta spec).
    STANDARD_OPTS = {'color', 'finish', 'lamp color', 'size', 'dimensions',
                     'diameter', 'length', 'material', 'pattern', 'shape'}
    extra_option_names = [(i, o.get('name')) for i, o in enumerate(options[:5])
                          if o.get('name') and o['name'].strip().lower() not in STANDARD_OPTS]

    title_p = (product.get('title') or '').strip()
    body = product.get('body_html') or ''
    description = short_description(body, 800)
    rich_desc = body
    brand = (product.get('vendor') or 'Lighom').strip() or 'Lighom'

    spec = parse_spec_table(body)
    spec_material = spec_pick(spec, 'material', 'frame material', 'lamp material',
                               'shade material', 'cover material', 'base material')
    spec_color = spec_pick(spec, 'lamp color', 'fixture color', 'frame color',
                            'shade color', 'finish', 'color')
    spec_pattern = spec_pick(spec, 'pattern', 'shape')
    spec_weight_kg = parse_weight_to_kg(spec_pick(spec, 'weight'))

    dim_parts = []
    for label, key in (('Dia','diameter'),('L','length'),('W','width'),('H','height')):
        v = spec_pick(spec, key)
        if not v: continue
        m = re.match(r'([\d.]+\s*(?:["\']|in|cm|mm|ft)[^,<]*?)(?=\s|$|<|,)', v)
        if m: dim_parts.append(f'{label} {m.group(1).strip()}')
    spec_size = ' x '.join(dim_parts[:3])[:200] if dim_parts else ''

    cl0 = custom_cat.split(' > ')[0] if custom_cat else 'Home'
    cl1 = custom_cat.split(' > ')[-1] if custom_cat else ''

    lifestyle_img = pick_lifestyle_image(images)
    lifestyle_link = attach_resize(lifestyle_img) if lifestyle_img else ''
    highlights = extract_highlights(body, spec, spec_color, spec_material, n=4)

    items = []
    for v in kept:
        vid = str(v.get('id') or '')
        if not vid: continue
        try: price = float(v.get('price') or 0)
        except Exception: price = 0.0
        if price <= 0: continue
        try: compare = float(v.get('compare_at_price') or 0)
        except Exception: compare = 0.0
        if compare > price:
            price_field = f'{compare:.2f} USD'
            sale_field = f'{price:.2f} USD'
        else:
            price_field = f'{price:.2f} USD'
            sale_field = ''
        inv = int(v.get('inventory_quantity') or 0)
        availability = 'in stock' if (inv > 0 or v.get('inventory_policy') == 'continue') else 'out of stock'
        qty = max(0, min(9999, inv)) if inv else 0

        color = norm_color(
            variant_option(v, options, 'Color') or
            variant_option(v, options, 'Finish') or
            variant_option(v, options, 'Lamp Color') or
            (tag_attrs.get('color') or [''])[0] or
            (tag_attrs.get('finish') or [''])[0] or spec_color
        )
        size = (variant_option(v, options, 'Size') or
                variant_option(v, options, 'Dimensions') or
                variant_option(v, options, 'Diameter') or
                variant_option(v, options, 'Length') or spec_size)
        material = (variant_option(v, options, 'Material') or
                    (tag_attrs.get('material') or [''])[0] or spec_material)
        pattern = spec_pattern

        # per-variant image
        vimg = v.get('image')
        v_image_src = ''
        if isinstance(vimg, dict):
            s = vimg.get('src') or ''
            if s and 'trycloudflare' not in s:
                v_image_src = s
            elif vimg.get('id'):
                im = img_by_id.get(vimg['id'])
                if im and im.get('src') and 'trycloudflare' not in im.get('src',''):
                    v_image_src = im['src']
        if not v_image_src and images:
            v_image_src = images[0].get('src') or ''
        image_link = attach_resize(v_image_src)

        addl = []
        for im in images:
            if im.get('src') == v_image_src: continue
            rs = attach_resize(im.get('src') or '')
            if rs: addl.append(rs)
            if len(addl) >= 10: break

        link = _link(handle, vid)
        title = clean_title(title_p, color)
        mpn = (v.get('sku') or '').strip()
        bc = (v.get('barcode') or '').strip()
        gtin = bc if bc.isdigit() and len(bc) in (8,12,13,14) else ''

        vw = v.get('weight')
        if vw not in (None, '', 0):
            ship_w = fmt_weight(vw, v.get('weight_unit'))
        elif spec_weight_kg:
            ship_w = f'{spec_weight_kg:.2f} kg'
        else:
            ship_w = ''

        custom_labels = [
            cl0, cl1,
            'sale' if sale_field else 'regular',
            'high' if price >= 500 else 'mid' if price >= 200 else 'low',
            ','.join(t for t in tag_attrs.get('room', [])[:3]),
        ]

        items.append({
            'id': vid,
            'item_group_id': str(product.get('id', '')),
            'title': title,
            'description': description or title,
            'rich_text_description': rich_desc,
            'availability': availability,
            'condition': 'new',
            'price': price_field,
            'sale_price': sale_field,
            'price_value': price,
            'compare_at_value': compare,
            'link': link,
            'image_link': image_link,
            'additional_image_links': addl,
            'lifestyle_image_link': lifestyle_link,
            'brand': brand,
            'identifier_exists': 'no',
            'mpn': mpn,
            'gtin': gtin,
            'google_product_category': gpc_path,
            'google_product_category_id': str(gpc_id),
            'fb_product_category': str(fb_cat_id) if fb_cat_id else '',
            'language': 'en',
            'product_type': custom_cat or '',
            'color': color,
            'size': size,
            'material': material,
            'pattern': pattern,
            'age_group': 'adult',
            'gender': 'unisex',
            'shipping_weight': ship_w,
            'quantity_to_sell_on_facebook': str(qty),
            'shipping_countries': list(SHIPPING_COUNTRIES),
            'product_details': build_product_detail(spec, custom_cat, color, material),
            'product_highlights': highlights,
            'custom_labels': custom_labels,
            'additional_variant_attributes': [
                (name, str(v.get(f'option{idx+1}')).strip())
                for (idx, name) in extra_option_names
                if v.get(f'option{idx+1}')
            ],
        })
    return items


def process_products(products: list[dict], cat_map: dict | None = None) -> list[dict]:
    cat_map = cat_map or {}
    out = []
    for p in products:
        sid = str(p.get('id', ''))
        out.extend(process_product(p, cat_map.get(sid, '')))
    return out


def derive_cat_map_from_smart_feed_xml(xml_path: str) -> dict:
    """Build SPU-id → product_type lookup from the existing Smart Feed export."""
    NS = '{http://base.google.com/ns/1.0}'
    out = {}
    for ev, el in ET.iterparse(xml_path, events=('end',)):
        if el.tag == 'item':
            igid = el.find(NS + 'item_group_id')
            pt = el.find(NS + 'product_type')
            if igid is not None and igid.text and pt is not None and pt.text:
                sid = igid.text.strip()
                if sid not in out:
                    out[sid] = pt.text.strip()
            el.clear()
    return out
