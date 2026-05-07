"""Google Shopping (Google Merchant Center) feed XML builder.

Reference: https://support.google.com/merchants/answer/7052112

Differences from Meta:
- google_product_category emitted as numeric ID (Google strict requirement)
- adds g:tax (US, rate=0, tax_ship=n) — Lighom price-includes-tax
- adds g:min_handling_time / g:max_handling_time (3-7 days dropship default)
- adds g:shipping_label = "free_shipping_global"
- adds g:mobile_link, g:adult=false
- size_type / size_system on furniture
- omits Meta-only fb_product_category / quantity_to_sell_on_facebook
"""
from __future__ import annotations
import re
from xml.sax.saxutils import escape

from google_category_map import google_category


def _cdata(s: str) -> str:
    return f'<![CDATA[{s}]]>' if s else ''


def _retarget_link(meta_link: str) -> str:
    """Rewrite Meta-flavored link → Google Shopping with `{ifmobile}` macro support
    and Google-specific UTMs.
    Google supports {keyword}, {creative}, {adgroupid} etc., but for simple DPA
    we just stamp source=google_shopping.
    """
    base = meta_link.split('?', 1)[0]
    m = re.search(r'sku=([^&]+)', meta_link)
    sku = m.group(1) if m else ''
    qs = (
        f'sku={sku}'
        '&utm_source=google_shopping'
        '&utm_medium=cpc'
        '&utm_campaign={_campaign}'
        '&utm_content={creative}'
    ).replace('{_campaign}', '{campaignid}') if sku else (
        'utm_source=google_shopping&utm_medium=cpc&utm_campaign={campaignid}'
    )
    return f'{base}?{qs}'


def build_google_xml(items: list[dict], *, store_url: str = 'https://lighom.com') -> str:
    out = []
    out.append('<?xml version="1.0" encoding="UTF-8"?>\n')
    out.append('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n')
    out.append('  <channel>\n')
    out.append('    <title>Lighom — Google Shopping Feed</title>\n')
    out.append(f'    <link>{escape(store_url)}/</link>\n')
    out.append('    <description>Lighom product feed for Google Merchant Center</description>\n')

    for it in items:
        out.append('    <item>\n')
        out.append(f'      <g:id>{escape(it["id"])}</g:id>\n')
        out.append(f'      <g:item_group_id>{escape(it["item_group_id"])}</g:item_group_id>\n')
        out.append(f'      <g:title>{_cdata(it["title"])}</g:title>\n')
        out.append(f'      <g:description>{_cdata(it["description"])}</g:description>\n')

        link = _retarget_link(it["link"])
        out.append(f'      <g:link>{escape(link)}</g:link>\n')
        out.append(f'      <g:mobile_link>{escape(link)}</g:mobile_link>\n')

        out.append(f'      <g:image_link>{escape(it["image_link"])}</g:image_link>\n')
        for u in it.get('additional_image_links', []):
            out.append(f'      <g:additional_image_link>{escape(u)}</g:additional_image_link>\n')
        if it.get('lifestyle_image_link'):
            out.append(f'      <g:lifestyle_image_link>{escape(it["lifestyle_image_link"])}</g:lifestyle_image_link>\n')

        out.append(f'      <g:availability>{it["availability"]}</g:availability>\n')
        out.append(f'      <g:condition>{it["condition"]}</g:condition>\n')
        out.append(f'      <g:price>{it["price"]}</g:price>\n')
        if it.get('sale_price'):
            out.append(f'      <g:sale_price>{it["sale_price"]}</g:sale_price>\n')

        out.append(f'      <g:brand>{escape(it["brand"])}</g:brand>\n')
        out.append(f'      <g:identifier_exists>{it.get("identifier_exists","no")}</g:identifier_exists>\n')
        if it.get('mpn'):
            out.append(f'      <g:mpn>{escape(it["mpn"])}</g:mpn>\n')
        if it.get('gtin'):
            out.append(f'      <g:gtin>{escape(it["gtin"])}</g:gtin>\n')

        # Google strict: emit numeric ID derived from Lighom customCat (= product_type)
        gid, gpath, _conf = google_category(it.get('product_type', ''))
        out.append(f'      <g:google_product_category>{gid}</g:google_product_category>\n')
        if it.get('product_type'):
            out.append(f'      <g:product_type>{_cdata(it["product_type"])}</g:product_type>\n')

        for fld in ('color', 'size', 'material', 'pattern'):
            v = it.get(fld)
            if v:
                out.append(f'      <g:{fld}>{_cdata(v)}</g:{fld}>\n')

        out.append(f'      <g:age_group>{it.get("age_group","adult")}</g:age_group>\n')
        out.append(f'      <g:gender>{it.get("gender","unisex")}</g:gender>\n')
        out.append('      <g:adult>false</g:adult>\n')

        product_type = (it.get('product_type') or '').lower()
        if product_type.startswith('furniture'):
            out.append('      <g:size_type>regular</g:size_type>\n')
            out.append('      <g:size_system>US</g:size_system>\n')

        if it.get('shipping_weight'):
            out.append(f'      <g:shipping_weight>{it["shipping_weight"]}</g:shipping_weight>\n')

        # Handling time (Lighom dropship — 3-7 day fulfillment, conservative)
        out.append('      <g:min_handling_time>3</g:min_handling_time>\n')
        out.append('      <g:max_handling_time>7</g:max_handling_time>\n')
        # Shipping label (groups SKUs in GMC shipping rules)
        out.append('      <g:shipping_label>free_shipping_global</g:shipping_label>\n')

        for cc in it.get('shipping_countries', []):
            out.append('      <g:shipping>\n')
            out.append(f'        <g:country>{cc}</g:country>\n')
            out.append('        <g:service>Standard</g:service>\n')
            out.append('        <g:price>0 USD</g:price>\n')
            out.append('      </g:shipping>\n')

        # US tax: Lighom price already includes tax → rate=0, tax_ship=n
        # Other countries: omit (let Google merchant settings handle)
        out.append('      <g:tax>\n')
        out.append('        <g:country>US</g:country>\n')
        out.append('        <g:rate>0</g:rate>\n')
        out.append('        <g:tax_ship>n</g:tax_ship>\n')
        out.append('      </g:tax>\n')

        # Google supports product_detail / product_highlight
        for sec, attr, val in it.get('product_details', []):
            out.append('      <g:product_detail>\n')
            out.append(f'        <g:section_name>{escape(sec)}</g:section_name>\n')
            out.append(f'        <g:attribute_name>{escape(attr)}</g:attribute_name>\n')
            out.append(f'        <g:attribute_value>{_cdata(val)}</g:attribute_value>\n')
            out.append('      </g:product_detail>\n')
        for h in it.get('product_highlights', []):
            out.append(f'      <g:product_highlight>{_cdata(h)}</g:product_highlight>\n')

        for i, val in enumerate(it.get('custom_labels', [])):
            if val:
                out.append(f'      <g:custom_label_{i}>{_cdata(val)}</g:custom_label_{i}>\n')

        out.append('    </item>\n')

    out.append('  </channel>\n')
    out.append('</rss>\n')
    return ''.join(out)
