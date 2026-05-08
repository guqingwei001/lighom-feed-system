"""Pinterest Catalog XML builder — RSS 2.0 + Google namespace.

Reference: https://help.pinterest.com/business/article/data-source-specifications

Differences from Meta:
- omits Meta-only tags (fb_product_category, lifestyle_image_link,
  product_detail, product_highlight, identifier_exists,
  age_group, gender, additional_variant_attribute, quantity_to_sell_on_facebook)
- adds g:ad_link (Pinterest CTA URL — same as link by default)
- rewrites tracking link: Meta macros → simple Pinterest UTMs
"""
from __future__ import annotations
import re
from xml.sax.saxutils import escape


def _cdata(s: str) -> str:
    return f'<![CDATA[{s}]]>' if s else ''


def _retarget_link(meta_link: str) -> str:
    """Rewrite a Meta-flavored link (utm + {{campaign.name}} macros) for Pinterest.
    Pinterest doesn't substitute Meta dynamic macros, so emit clean static UTMs.
    """
    # Strip query, keep base
    base = meta_link.split('?', 1)[0]
    # Preserve sku=<variant id>
    m = re.search(r'sku=([^&]+)', meta_link)
    sku = m.group(1) if m else ''
    qs = (
        f'sku={sku}'
        '&utm_source=pinterest_catalog'
        '&utm_medium=paid_social'
        '&utm_campaign=pin_dpa'
    ) if sku else 'utm_source=pinterest_catalog&utm_medium=paid_social&utm_campaign=pin_dpa'
    return f'{base}?{qs}'


def build_pinterest_xml(items: list[dict], *, store_url: str = 'https://lighom.com') -> str:
    out = []
    out.append('<?xml version="1.0" encoding="UTF-8"?>\n')
    out.append('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n')
    out.append('  <channel>\n')
    out.append('    <title>Lighom — Pinterest Catalog Feed</title>\n')
    out.append(f'    <link>{escape(store_url)}/</link>\n')
    out.append('    <description>Lighom product catalog for Pinterest Shopping</description>\n')

    for it in items:
        out.append('    <item>\n')
        out.append(f'      <g:id>{escape(it["id"])}</g:id>\n')
        out.append(f'      <g:item_group_id>{escape(it["item_group_id"])}</g:item_group_id>\n')
        out.append(f'      <g:title>{_cdata(it["title"])}</g:title>\n')
        # Pinterest description: plain text only (no HTML rendering)
        out.append(f'      <g:description>{_cdata(it["description"])}</g:description>\n')
        link = _retarget_link(it["link"])
        out.append(f'      <g:link>{escape(link)}</g:link>\n')
        # Don't emit ad_link — when identical to link Pinterest flags it (warning 192).
        # Pinterest defaults to using <g:link> for ad clicks if ad_link is absent.
        out.append(f'      <g:image_link>{escape(it["image_link"])}</g:image_link>\n')
        for u in it.get('additional_image_links', []):
            out.append(f'      <g:additional_image_link>{escape(u)}</g:additional_image_link>\n')

        # P1: Pinterest mobile link (same value as link, helps mobile UX)
        out.append(f'      <g:mobile_link>{escape(link)}</g:mobile_link>\n')
        # Lifestyle image — non-white-bg / contextual shot, fallback = 2nd product image
        if it.get('lifestyle_image_link'):
            out.append(f'      <g:lifestyle_image_link>{escape(it["lifestyle_image_link"])}</g:lifestyle_image_link>\n')

        out.append(f'      <g:availability>{it["availability"]}</g:availability>\n')
        out.append(f'      <g:condition>{it["condition"]}</g:condition>\n')
        out.append(f'      <g:price>{it["price"]}</g:price>\n')
        if it.get('sale_price'):
            out.append(f'      <g:sale_price>{it["sale_price"]}</g:sale_price>\n')
        out.append(f'      <g:brand>{escape(it["brand"])}</g:brand>\n')
        # P0: identifier_exists=no — Lighom branded products without GTIN
        out.append(f'      <g:identifier_exists>no</g:identifier_exists>\n')
        if it.get('mpn'):
            out.append(f'      <g:mpn>{escape(it["mpn"])}</g:mpn>\n')
        if it.get('gtin'):
            out.append(f'      <g:gtin>{escape(it["gtin"])}</g:gtin>\n')

        out.append(f'      <g:google_product_category>{escape(it["google_product_category"])}</g:google_product_category>\n')
        if it.get('product_type'):
            out.append(f'      <g:product_type>{_cdata(it["product_type"])}</g:product_type>\n')

        for fld in ('color', 'size', 'material', 'pattern'):
            v = it.get(fld)
            if v:
                out.append(f'      <g:{fld}>{_cdata(v)}</g:{fld}>\n')

        # P0: age_group + gender — homewares default
        out.append(f'      <g:age_group>{it.get("age_group","adult")}</g:age_group>\n')
        out.append(f'      <g:gender>{it.get("gender","unisex")}</g:gender>\n')
        # P1: explicit non-adult content flag
        out.append('      <g:adult>false</g:adult>\n')
        # P2: furniture-only size_type / size_system
        product_type = (it.get('product_type') or '').lower()
        if product_type.startswith('furniture'):
            out.append('      <g:size_type>regular</g:size_type>\n')
            out.append('      <g:size_system>US</g:size_system>\n')

        if it.get('shipping_weight'):
            out.append(f'      <g:shipping_weight>{it["shipping_weight"]}</g:shipping_weight>\n')

        # Pinterest accepts shipping (country-level)
        for cc in it.get('shipping_countries', []):
            out.append('      <g:shipping>\n')
            out.append(f'        <g:country>{cc}</g:country>\n')
            out.append('        <g:service>Standard</g:service>\n')
            out.append('        <g:price>0 USD</g:price>\n')
            out.append('      </g:shipping>\n')

        for i, val in enumerate(it.get('custom_labels', [])):
            if val:
                out.append(f'      <g:custom_label_{i}>{_cdata(val)}</g:custom_label_{i}>\n')

        out.append('    </item>\n')

    out.append('  </channel>\n')
    out.append('</rss>\n')
    return ''.join(out)
