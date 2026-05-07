"""Lighom customCat → Google Shopping numeric ID.

Hand-mapped against Google Product Taxonomy 2021-09-21.
Source: https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt

Each entry: customCat → (numeric_id, google_path, confidence)
Confidence: high  = leaf match
            med   = closest available leaf, semantic match
            low   = no perfect match, used coarser parent
"""
from __future__ import annotations

# (id, path, confidence)
GMC_MAP: dict[str, tuple[int, str, str]] = {
    # ---- Lighting > Ceiling lights ----
    'Lighting > Ceiling lights > Pendant lighting':
        (2524, 'Home & Garden > Lighting > Lighting Fixtures > Ceiling Light Fixtures', 'high'),
    'Lighting > Ceiling lights > Chandeliers':
        (2249, 'Home & Garden > Lighting > Lighting Fixtures > Chandeliers', 'high'),
    'Lighting > Ceiling lights > Flush mount lighting':
        (2524, 'Home & Garden > Lighting > Lighting Fixtures > Ceiling Light Fixtures', 'high'),
    'Lighting > Ceiling lights > Semi-flush mount light':
        (2524, 'Home & Garden > Lighting > Lighting Fixtures > Ceiling Light Fixtures', 'high'),
    'Lighting > Ceiling lights > Ceiling Fans':
        (1700, 'Home & Garden > Household Appliances > Climate Control Appliances > Fans > Ceiling Fans', 'high'),
    'Lighting > Ceiling lights > Directional & Spot Lights':
        (1546, 'Home & Garden > Lighting > Flood & Spot Lights', 'high'),
    'Lighting > Ceiling lights > Staircase Chandeliers':
        (2249, 'Home & Garden > Lighting > Lighting Fixtures > Chandeliers', 'high'),
    'Lighting > Ceiling lights':
        (2524, 'Home & Garden > Lighting > Lighting Fixtures > Ceiling Light Fixtures', 'med'),

    # ---- Lighting > Wall Lights ----
    'Lighting > Wall Lights > Wall sconces':
        (6073, 'Home & Garden > Lighting > Lighting Fixtures > Wall Light Fixtures', 'high'),
    'Lighting > Wall Lights > Wall Lights':
        (6073, 'Home & Garden > Lighting > Lighting Fixtures > Wall Light Fixtures', 'high'),
    'Lighting > Wall Lights > LED Wall Lights':
        (6073, 'Home & Garden > Lighting > Lighting Fixtures > Wall Light Fixtures', 'high'),
    'Lighting > Wall Lights > Bathroom Vanity Lighting':
        (6073, 'Home & Garden > Lighting > Lighting Fixtures > Wall Light Fixtures', 'high'),
    'Lighting > Wall Lights > Swing Arm Wall Sconces':
        (6073, 'Home & Garden > Lighting > Lighting Fixtures > Wall Light Fixtures', 'high'),
    'Lighting > Wall Lights > Picture Lights':
        (2370, 'Home & Garden > Lighting > Picture Lights', 'high'),
    'Lighting > Wall Lights > Electric Fireplace Lights':
        (6073, 'Home & Garden > Lighting > Lighting Fixtures > Wall Light Fixtures', 'med'),

    # ---- Lighting > Table & Floor Lamps ----
    'Lighting > Table & Floor Lamps > Table lamps':
        (4636, 'Home & Garden > Lighting > Lamps', 'high'),
    'Lighting > Table & Floor Lamps > Floor lamps':
        (4636, 'Home & Garden > Lighting > Lamps', 'high'),
    'Lighting > Table & Floor Lamps > Desk lamps':
        (4636, 'Home & Garden > Lighting > Lamps', 'high'),
    'Lighting > Table & Floor Lamps > Baby & Kids Lamp':
        (4636, 'Home & Garden > Lighting > Lamps', 'high'),

    # ---- Lighting > Outdoor Lighting ----
    # Google has no specific "outdoor" leaf — outdoor lighting maps to general fixtures
    'Lighting > Outdoor Lighting > Outdoor Wall Lighting':
        (6073, 'Home & Garden > Lighting > Lighting Fixtures > Wall Light Fixtures', 'high'),
    'Lighting > Outdoor Lighting > Landscape Lighting':
        (7400, 'Home & Garden > Lighting > Landscape Pathway Lighting', 'high'),
    'Lighting > Outdoor Lighting > Outdoor Hanging Lights':
        (2524, 'Home & Garden > Lighting > Lighting Fixtures > Ceiling Light Fixtures', 'med'),
    'Lighting > Outdoor Lighting > Post lighting':
        (594,  'Home & Garden > Lighting', 'med'),
    'Lighting > Outdoor Lighting > Outdoor Post Lights':
        (594,  'Home & Garden > Lighting', 'med'),
    'Lighting > Outdoor Lighting > Outdoor Lanterns & Lamps':
        (4636, 'Home & Garden > Lighting > Lamps', 'high'),
    'Lighting > Outdoor Lighting > Outdoor Column Light':
        (594,  'Home & Garden > Lighting', 'med'),
    'Lighting > Outdoor Lighting > Outdoor Ceiling Lights':
        (2524, 'Home & Garden > Lighting > Lighting Fixtures > Ceiling Light Fixtures', 'high'),
    'Lighting > Outdoor Lighting > Outdoor Floor lamps':
        (4636, 'Home & Garden > Lighting > Lamps', 'high'),
    'Lighting > Outdoor Lighting > Street Lighting':
        (594,  'Home & Garden > Lighting', 'low'),
    'Lighting > Outdoor Lighting > Step & Deck Lights':
        (7400, 'Home & Garden > Lighting > Landscape Pathway Lighting', 'high'),
    'Lighting > Outdoor Lighting > Spot Lights':
        (1546, 'Home & Garden > Lighting > Flood & Spot Lights', 'high'),
    'Lighting > Outdoor Lighting > Solar Outdoor Lighting':
        (7400, 'Home & Garden > Lighting > Landscape Pathway Lighting', 'med'),
    'Lighting > Outdoor Lighting > Tree Lighting':
        (2608, 'Home & Garden > Lighting > Light Ropes & Strings', 'med'),
    'Lighting > Outdoor Lighting > String Lights':
        (2608, 'Home & Garden > Lighting > Light Ropes & Strings', 'high'),
    'Lighting > Outdoor Lighting > Bollard Lights':
        (7400, 'Home & Garden > Lighting > Landscape Pathway Lighting', 'high'),

    # ---- Lighting > Ceiling Fans (sub) ----
    'Lighting > Ceiling Fans > Kids Ceiling Fans':
        (1700, 'Home & Garden > Household Appliances > Climate Control Appliances > Fans > Ceiling Fans', 'high'),

    # ---- Lighting > String Lights ----
    'Lighting > String Lights > Outdoor String Lights':
        (2608, 'Home & Garden > Lighting > Light Ropes & Strings', 'high'),
    'Lighting > String Lights > Solar String Lights':
        (2608, 'Home & Garden > Lighting > Light Ropes & Strings', 'high'),

    # ---- Furniture > Living Room ----
    'Furniture > Living Room Furniture > End & Side Tables':
        (1549, 'Furniture > Tables > Accent Tables > End Tables', 'high'),
    'Furniture > Living Room Furniture > Coffee Tables':
        (1395, 'Furniture > Tables > Accent Tables > Coffee Tables', 'high'),
    'Furniture > Living Room Furniture > Coffee Table':
        (1395, 'Furniture > Tables > Accent Tables > Coffee Tables', 'high'),
    'Furniture > Living Room Furniture > Accent Chairs':
        (6499, 'Furniture > Chairs > Arm Chairs, Recliners & Sleeper Chairs', 'high'),
    'Furniture > Living Room Furniture > TV Stands':
        (457,  'Furniture > Entertainment Centers & TV Stands', 'high'),
    'Furniture > Living Room Furniture > Sofas':
        (460,  'Furniture > Sofas', 'high'),
    'Furniture > Living Room Furniture > Sectionals':
        (500064, 'Furniture > Sofa Accessories > Sectional Sofa Units', 'med'),
    'Furniture > Living Room Furniture > Low Stools':
        (458,  'Furniture > Ottomans', 'med'),
    'Furniture > Living Room Furniture > Footstools':
        (458,  'Furniture > Ottomans', 'high'),
    'Furniture > Living Room Furniture > Recliner':
        (6499, 'Furniture > Chairs > Arm Chairs, Recliners & Sleeper Chairs', 'high'),
    'Furniture > Living Room Furniture > Rocking Chairs':
        (2002, 'Furniture > Chairs > Rocking Chairs', 'high'),
    'Furniture > Living Room Furniture > Cabinets':
        (6356, 'Furniture > Cabinets & Storage', 'med'),

    # ---- Furniture > Bedroom ----
    'Furniture > Bedroom Furniture > Nightstands':
        (462,  'Furniture > Tables > Nightstands', 'high'),
    'Furniture > Bedroom Furniture > Vanity Stools':
        (4241, 'Furniture > Benches > Vanity Benches', 'high'),
    'Furniture > Bedroom Furniture > Beds':
        (505764, 'Furniture > Beds & Accessories > Beds & Bed Frames', 'high'),
    'Furniture > Bedroom Furniture > Dressers':
        (4195, 'Furniture > Cabinets & Storage > Dressers', 'high'),
    'Furniture > Bedroom Furniture > Makeup Vanities':
        (6360, 'Furniture > Cabinets & Storage > Vanities > Bedroom Vanities', 'high'),
    'Furniture > Bedroom Furniture > Side Tables':
        (1549, 'Furniture > Tables > Accent Tables > End Tables', 'med'),
    'Furniture > Bedroom Furniture > Sofas':
        (460,  'Furniture > Sofas', 'med'),

    # ---- Furniture > Office ----
    'Furniture > Office Furniture > Office Chairs':
        (2045, 'Furniture > Office Furniture > Office Chairs', 'high'),
    'Furniture > Office Furniture > Desks':
        (4191, 'Furniture > Office Furniture > Desks', 'high'),
    'Furniture > Office Furniture > Bookcases':
        (465,  'Furniture > Shelving > Bookcases & Standing Shelves', 'high'),
    'Furniture > Office Furniture > Gaming Desks':
        (4191, 'Furniture > Office Furniture > Desks', 'med'),
    'Furniture > Office Furniture > Conference Tables':
        (4317, 'Furniture > Office Furniture > Workspace Tables > Conference Room Tables', 'high'),

    # ---- Furniture > Kitchen & Dining ----
    'Furniture > Kitchen & Dining Furniture > Dining Chairs & Benches':
        (5886, 'Furniture > Chairs > Kitchen & Dining Room Chairs', 'high'),
    'Furniture > Kitchen & Dining Furniture > Bar & Counter Stools':
        (1463, 'Furniture > Chairs > Table & Bar Stools', 'high'),
    'Furniture > Kitchen & Dining Furniture > Bar & Counter Stool':
        (1463, 'Furniture > Chairs > Table & Bar Stools', 'high'),
    'Furniture > Kitchen & Dining Furniture > Dining Tables':
        (4355, 'Furniture > Tables > Kitchen & Dining Room Tables', 'high'),
    'Furniture > Kitchen & Dining Furniture > Dining Table':
        (4355, 'Furniture > Tables > Kitchen & Dining Room Tables', 'high'),
    'Furniture > Kitchen & Dining Furniture > Display Cabinets':
        (448,  'Furniture > Cabinets & Storage > China Cabinets & Hutches', 'high'),
    'Furniture > Kitchen & Dining Furniture > Bar Tables':
        (4355, 'Furniture > Tables > Kitchen & Dining Room Tables', 'med'),
    'Furniture > Kitchen & Dining Furniture > Wine Cabinets':
        (6357, 'Furniture > Cabinets & Storage > Wine & Liquor Cabinets', 'high'),
    'Furniture > Kitchen & Dining Furniture > Buffets & Sideboards':
        (447,  'Furniture > Cabinets & Storage > Buffets & Sideboards', 'high'),
    'Furniture > Kitchen & Dining Furniture > Dining Carts':
        (453,  'Furniture > Carts & Islands > Kitchen & Dining Carts', 'high'),

    # ---- Furniture > Entryway ----
    'Furniture > Entryway Furniture > Shoe  Storage':  # double-space typo in source
        (5938, 'Furniture > Cabinets & Storage > Storage Cabinets & Lockers', 'med'),
    'Furniture > Entryway Furniture > Shoe Benches':
        (6851, 'Furniture > Benches > Storage & Entryway Benches', 'high'),
    'Furniture > Entryway Furniture > Hall Trees & Coat Racks':
        (6851, 'Furniture > Benches > Storage & Entryway Benches', 'med'),
    'Furniture > Entryway Furniture > Console Tables':
        (1602, 'Furniture > Tables > Accent Tables > Sofa Tables', 'high'),

    # ---- Furniture > Outdoor ----
    'Furniture > Outdoor Furniture > Tables':
        (2684, 'Furniture > Outdoor Furniture > Outdoor Tables', 'high'),
    'Furniture > Outdoor Furniture > Chairs':
        (6828, 'Furniture > Outdoor Furniture > Outdoor Seating > Outdoor Chairs', 'high'),

    # ---- Furniture > Dining Room (rare typo path) ----
    'Furniture > Dining Room Furniture > Sofas':
        (460,  'Furniture > Sofas', 'low'),

    # ---- Lone tokens ----
    'Pendant Light':
        (2524, 'Home & Garden > Lighting > Lighting Fixtures > Ceiling Light Fixtures', 'med'),
    'Wall Lights':
        (6073, 'Home & Garden > Lighting > Lighting Fixtures > Wall Light Fixtures', 'high'),
    'Chandelier':
        (2249, 'Home & Garden > Lighting > Lighting Fixtures > Chandeliers', 'high'),
    'Night Light':
        (505826, 'Home & Garden > Lighting > Night Lights & Ambient Lighting', 'high'),
    'Ceiling Fan Light':
        (1700, 'Home & Garden > Household Appliances > Climate Control Appliances > Fans > Ceiling Fans', 'med'),
    'post light':
        (594,  'Home & Garden > Lighting', 'med'),
    'String Light':
        (2608, 'Home & Garden > Lighting > Light Ropes & Strings', 'high'),
    'Candlestick':
        (2784, 'Home & Garden > Decor > Home Fragrance Accessories > Candle Holders', 'high'),
    'Chair':
        (443,  'Furniture > Chairs', 'low'),

    # ---- Lighom F1/Out internal codes ----
    '-F1 plant stand h':
        (6428, 'Home & Garden > Lawn & Garden > Gardening > Plant Stands', 'high'),
    '-F1 plant stand l':
        (6428, 'Home & Garden > Lawn & Garden > Gardening > Plant Stands', 'high'),
    'F1 plant stand select':
        (6428, 'Home & Garden > Lawn & Garden > Gardening > Plant Stands', 'high'),
    '-F1 plant stand select':
        (6428, 'Home & Garden > Lawn & Garden > Gardening > Plant Stands', 'high'),
    'F1 chaise lounge pool':
        (4105, 'Furniture > Outdoor Furniture > Outdoor Seating > Sunloungers', 'high'),
    'F1 bookcase select':
        (465,  'Furniture > Shelving > Bookcases & Standing Shelves', 'high'),
    'F tv stands select':
        (457,  'Furniture > Entertainment Centers & TV Stands', 'high'),
    'F1 dining table 251126':
        (4355, 'Furniture > Tables > Kitchen & Dining Room Tables', 'med'),
    'Out F':
        (4299, 'Furniture > Outdoor Furniture', 'low'),
    'Out No Profit F':
        (4299, 'Furniture > Outdoor Furniture', 'low'),
    'N/A':
        (536,  'Home & Garden', 'low'),
}


def google_category(custom_cat: str) -> tuple[int, str, str]:
    """Return (numeric_id, path, confidence)."""
    if custom_cat in GMC_MAP:
        return GMC_MAP[custom_cat]
    cc = (custom_cat or '').lower()
    if cc.startswith('lighting > outdoor'): return (594, 'Home & Garden > Lighting', 'low')
    if cc.startswith('lighting'):           return (594, 'Home & Garden > Lighting', 'low')
    if cc.startswith('furniture'):          return (436, 'Furniture', 'low')
    return (536, 'Home & Garden', 'low')
