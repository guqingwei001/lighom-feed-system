"""Meta Catalog XML builder — RSS 2.0 + Google namespace.

Output matches Meta's product catalog spec:
  https://developers.facebook.com/docs/marketing-api/catalog/reference/
"""
from __future__ import annotations

from xml.sax.saxutils import escape


def _cdata(text: str) -> str:
    if not text:
        return ''
    return f'<![CDATA[{text}]]>'


def build_meta_xml(items: list[dict], *, store_url: str = 'https://lighom.com') -> str:
    """Serialise items into Meta-compatible RSS 2.0 XML string."""
    out = []
    out.append('<?xml version="1.0" encoding="UTF-8"?>\n')
    out.append('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n')
    out.append('  <channel>\n')
    out.append('    <title>Lighom — Meta Catalog Feed</title>\n')
    out.append(f'    <link>{escape(store_url)}/</link>\n')
    out.append('    <description>Optimized Lighom catalog feed for Meta DPA / ASC</description>\n')

    for it in items:
        out.append('    <item>\n')
        out.append(f'      <g:id>{escape(it["id"])}</g:id>\n')
        out.append(f'      <g:item_group_id>{escape(it["item_group_id"])}</g:item_group_id>\n')
        out.append(f'      <g:title>{_cdata(it["title"])}</g:title>\n')
        out.append(f'      <g:description>{_cdata(it["description"])}</g:description>\n')
        if it.get('rich_text_description'):
            out.append(f'      <g:rich_text_description>{_cdata(it["rich_text_description"])}</g:rich_text_description>\n')
        out.append(f'      <g:link>{escape(it["link"])}</g:link>\n')
        out.append(f'      <g:image_link>{escape(it["image_link"])}</g:image_link>\n')
        for u in it.get('additional_image_links', []):
            out.append(f'      <g:additional_image_link>{escape(u)}</g:additional_image_link>\n')
        if it.get('lifestyle_image_link'):
            out.append(f'      <g:lifestyle_image_link>{escape(it["lifestyle_image_link"])}</g:lifestyle_image_link>\n')

        out.append(f'      <g:availability>{it["availability"]}</g:availability>\n')
        out.append(f'      <g:quantity_to_sell_on_facebook>{it["quantity_to_sell_on_facebook"]}</g:quantity_to_sell_on_facebook>\n')
        out.append(f'      <g:condition>{it["condition"]}</g:condition>\n')
        out.append(f'      <g:price>{it["price"]}</g:price>\n')
        if it.get('sale_price'):
            out.append(f'      <g:sale_price>{it["sale_price"]}</g:sale_price>\n')
        out.append(f'      <g:brand>{escape(it["brand"])}</g:brand>\n')
        out.append(f'      <g:identifier_exists>{it["identifier_exists"]}</g:identifier_exists>\n')
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

        out.append(f'      <g:age_group>{it["age_group"]}</g:age_group>\n')
        out.append(f'      <g:gender>{it["gender"]}</g:gender>\n')
        if it.get('shipping_weight'):
            out.append(f'      <g:shipping_weight>{it["shipping_weight"]}</g:shipping_weight>\n')

        for cc in it.get('shipping_countries', []):
            out.append('      <g:shipping>\n')
            out.append(f'        <g:country>{cc}</g:country>\n')
            out.append('        <g:service>Standard</g:service>\n')
            out.append('        <g:price>0 USD</g:price>\n')
            out.append('      </g:shipping>\n')

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
