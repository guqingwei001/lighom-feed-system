"""Map Lighom customCat → Meta product taxonomy ID (fb_product_category).

Meta's taxonomy is much coarser than Google's (~3000 leaf categories total,
only ~10 relevant for Lighom's lighting + furniture catalog). Mapping rules
are derived directly from the customCat path prefix — no LLM needed.

Source: https://www.facebook.com/products/categories/en_US.txt (downloaded 2026-05-07)
"""
from __future__ import annotations

# Relevant Meta category IDs we map to:
META = {
    'OUTDOOR_LIGHTING':  110,  # patio & garden > outdoor lighting
    'OUTDOOR_FURNITURE': 113,  # patio & garden > outdoor furniture
    'GARDEN_DECOR':      116,  # patio & garden > garden decor (plant stands)
    'LIVING':            350,  # home > furniture > living room furniture
    'OFFICE':            351,  # home > furniture > office furniture
    'DINING':            352,  # home > furniture > dining room furniture
    'BEDROOM':           353,  # home > furniture > bedroom furniture
    'FURNITURE':         354,  # home > furniture (generic fallback)
    'LIGHTING':          356,  # home > home goods > lamps & lighting
    'DECOR':             374,  # home > home goods > home decor > decorative accents
    'HOME_GOODS':        376,  # home > home goods (generic fallback)
}


def fb_product_category(custom_cat: str) -> int | None:
    """Return Meta numeric category ID for a Lighom customCat path. None if unknown."""
    if not custom_cat:
        return META['HOME_GOODS']
    cc = custom_cat.lower().strip()

    # ---- Lighting ----
    if cc.startswith('lighting > outdoor'):
        return META['OUTDOOR_LIGHTING']
    if cc.startswith('lighting'):
        return META['LIGHTING']
    # Lone tokens that are clearly lighting
    if any(kw in cc for kw in ('chandelier', 'pendant light', 'wall light',
                               'night light', 'ceiling fan light', 'string light',
                               'post light', 'lamp')):
        if 'outdoor' in cc or 'post' in cc:
            return META['OUTDOOR_LIGHTING']
        return META['LIGHTING']

    # ---- Furniture ----
    if cc.startswith('furniture > outdoor'):
        return META['OUTDOOR_FURNITURE']
    if cc.startswith('furniture > living'):
        return META['LIVING']
    if cc.startswith('furniture > office'):
        return META['OFFICE']
    if cc.startswith('furniture > kitchen') or cc.startswith('furniture > dining'):
        return META['DINING']
    if cc.startswith('furniture > bedroom'):
        return META['BEDROOM']
    if cc.startswith('furniture > entryway'):
        return META['LIVING']  # entryway closest to living-room category
    if cc.startswith('furniture'):
        return META['FURNITURE']
    if cc == 'chair':
        return META['LIVING']

    # ---- Plant stands (Lighom internal codes) ----
    if 'plant stand' in cc:
        return META['GARDEN_DECOR']
    if cc.startswith('f1 chaise lounge'):
        return META['OUTDOOR_FURNITURE']
    if cc.startswith('f1 bookcase'):
        return META['OFFICE']
    if cc.startswith('f tv stands'):
        return META['LIVING']
    if cc.startswith('f1 dining table'):
        return META['DINING']
    if cc.startswith('out f') or cc.startswith('out no profit'):
        return META['OUTDOOR_FURNITURE']

    # ---- Decor ----
    if 'candlestick' in cc:
        return META['DECOR']

    # ---- Catch-all ----
    return META['HOME_GOODS']
