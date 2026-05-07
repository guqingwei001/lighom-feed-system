"""Description / spec-table parser + field normalizers.

Ported verbatim from the local Lighom v3 build pipeline (build_feed_v3.py).
Handles Lighom's standardized body_html spec tables (<h3>Specifications</h3> +
<table>) and Wayfair-derived attribute formats.

NEVER fabricates values: if a regex doesn't match, we return ''.
"""
from __future__ import annotations

import html
import re

# ---------------------------------------------------------------------------
# spec table parser
# ---------------------------------------------------------------------------
_SPEC_ROW_RE = re.compile(
    r'<tr[^>]*>\s*<td[^>]*>\s*(?:<strong>)?\s*([^<:]+?)\s*[:：]?\s*(?:</strong>)?\s*</td>\s*'
    r'<td[^>]*>\s*(.*?)\s*</td>\s*</tr>',
    re.I | re.S,
)


def strip_html(s: str) -> str:
    if not s:
        return ''
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    s = re.sub(r'</p>|</li>|</tr>|</h\d>', '\n', s, flags=re.I)
    s = re.sub(r'<li[^>]*>', ' • ', s, flags=re.I)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = html.unescape(s)
    s = re.sub(r'[ \t]+', ' ', s)
    s = re.sub(r'\n[ \n]+', '\n', s).strip()
    return s


def parse_spec_table(body_html: str) -> dict:
    """Return dict[lower-cased key without trailing colon] = first value text."""
    if not body_html:
        return {}
    out = {}
    for m in _SPEC_ROW_RE.finditer(body_html):
        key = strip_html(m.group(1)).strip(': ').lower()
        val = strip_html(m.group(2)).strip()
        if not key or not val:
            continue
        if key not in out:
            out[key] = val
    return out


def spec_pick(spec: dict, *needles: str) -> str:
    """Find first key containing any needle (case-insensitive substring)."""
    for k, v in spec.items():
        for n in needles:
            if n in k:
                return v
    return ''


def short_description(body_html: str, max_chars: int = 800) -> str:
    """Strip HTML, cut before the Specifications heading, cap length."""
    if not body_html:
        return ''
    cut = re.search(r'<h3[^>]*>\s*Specifications', body_html, flags=re.I)
    head = body_html[:cut.start()] if cut else body_html
    text = strip_html(head)
    if len(text) > max_chars:
        text = text[:max_chars - 3].rsplit(' ', 1)[0] + '...'
    return text


def clean_title(title: str, color: str = '') -> str:
    if not title:
        return ''
    t = title.strip()
    if color and color.lower() not in t.lower():
        t = f'{t} - {color}'
    if len(t) > 200:
        t = t[:197].rsplit(' ', 1)[0] + '...'
    return t


# ---------------------------------------------------------------------------
# normalizers
# ---------------------------------------------------------------------------
def normalize_wattage(s: str) -> str:
    if not s:
        return ''
    s = s.strip()
    src_pairs = re.findall(
        r'(hardwired|solar|battery|usb|plug[\s-]?in|ac\b|dc\b|main\b)\s*[:=\-]?\s*'
        r'(\d+(?:\.\d+)?)\s*W',
        s, re.I)
    if len(src_pairs) >= 2:
        seen, parts = set(), []
        for label, val in src_pairs:
            key = label.lower().replace(' ', '').replace('-', '')
            if key in seen:
                continue
            seen.add(key)
            disp = (label.title()
                    .replace('Usb', 'USB').replace('Ac', 'AC').replace('Dc', 'DC'))
            parts.append(f'{disp} {val}W')
        return ' / '.join(parts)

    nums_raw = re.findall(r'(\d+(?:\.\d+)?)\s*W\b', s, re.I)
    if not nums_raw:
        return ''
    distinct = sorted({float(n) for n in nums_raw})

    m = re.search(r'(\d+)\s*[*xX]\s*(\d+(?:\.\d+)?)\s*W', s)
    if m and len(distinct) <= 2:
        n, per = int(m.group(1)), float(m.group(2))
        total = n * per
        total_s = str(int(total)) if total == int(total) else f'{total:.1f}'
        return f'{total_s}W ({n}x{m.group(2)}W LED)'

    if len(distinct) >= 2:
        lo, hi = distinct[0], distinct[-1]
        fmt = lambda v: str(int(v)) if v == int(v) else f'{v:.1f}'
        return f'{fmt(lo)}W-{fmt(hi)}W (multiple options)'

    n = distinct[0]
    n_s = str(int(n)) if n == int(n) else f'{n:.1f}'
    suf = ''
    if re.search(r'\bLED\b', s, re.I): suf = ' LED'
    elif re.search(r'\bhalogen\b', s, re.I): suf = ' Halogen'
    elif re.search(r'\bincandescent\b', s, re.I): suf = ' Incandescent'
    return f'{n_s}W{suf}'


def normalize_ct(s: str) -> str:
    if not s:
        return ''
    t = s.strip()

    def label_for(k: int) -> str:
        if k <= 3500: return 'Warm White'
        if k <= 4500: return 'Natural White'
        if k <= 5500: return 'Cool White'
        return 'Daylight'

    out, seen = [], set()
    for m in re.finditer(
        r'(warm\s*white|cool\s*white|natural\s*white|neutral\s*white|daylight|white)\s*'
        r'(?:light\s*)?[\(\s]*(\d{4,5})\s*[Kk]\)?', t, re.I):
        k = int(m.group(2))
        if k in seen:
            continue
        seen.add(k)
        lab_raw = m.group(1).strip().lower()
        if lab_raw == 'white':
            lab = label_for(k)
        else:
            lab = ' '.join(w.capitalize() for w in lab_raw.split())
            if lab.lower() == 'neutral white':
                lab = 'Natural White'
        out.append(f'{k}K {lab}')

    for m in re.finditer(
        r'(\d{4,5})\s*[Kk]\)?\s*\(?(warm\s*white|cool\s*white|natural\s*white|neutral\s*white|daylight)',
        t, re.I):
        k = int(m.group(1))
        if k in seen:
            continue
        seen.add(k)
        lab = ' '.join(w.capitalize() for w in m.group(2).split())
        if lab.lower() == 'neutral white':
            lab = 'Natural White'
        out.append(f'{k}K {lab}')

    for m in re.finditer(r'(\d{4,5})\s*[Kk]', t):
        k = int(m.group(1))
        if k in seen:
            continue
        seen.add(k)
        out.append(f'{k}K {label_for(k)}')

    if re.search(r'dimmable|dimming|remote\s*control|step\s*dimming', t, re.I):
        out.append('Dimmable')
    if not out:
        return ''
    return ' / '.join(out[:4])


def normalize_voltage(s: str) -> str:
    if not s:
        return ''
    m = re.search(r'(\d+(?:[-–]\d+)?)\s*V\b', s, re.I)
    return f'{m.group(1).replace("–","-")}V' if m else s.strip()


def normalize_ip(s: str) -> str:
    if not s:
        return ''
    m = re.search(r'IP\s*(\d{2})', s.upper())
    return f'IP{m.group(1)}' if m else ''


def normalize_cri(s: str) -> str:
    if not s:
        return ''
    s = re.sub(r'\?+', '≥', s).strip()
    m = re.search(r'Ra\s*[≥>=]+\s*(\d{2,3})', s)
    if m:
        return f'Ra ≥ {m.group(1)}'
    m = re.search(r'(\d{2,3})', s)
    if m and 70 <= int(m.group(1)) <= 100:
        return f'Ra ≥ {m.group(1)}'
    return ''


def normalize_space(s: str) -> str:
    if not s:
        return ''
    s = s.strip()
    if re.search(r'sq\s*ft|sf\b', s, re.I):
        return s
    m = re.search(r'(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*m', s)
    if m:
        lo = round(float(m.group(1)) * 10.764)
        hi = round(float(m.group(2)) * 10.764)
        return f'{lo}-{hi} sq ft'
    m = re.search(r'(\d+(?:\.\d+)?)\s*m', s)
    if m:
        return f'{round(float(m.group(1)) * 10.764)} sq ft'
    return s


def parse_weight_to_kg(s: str):
    if not s:
        return None
    m = re.search(r'(\d+(?:\.\d+)?)\s*kg', s, re.I)
    if m:
        try: return float(m.group(1))
        except Exception: pass
    m = re.search(r'(\d+(?:\.\d+)?)\s*(lb|lbs|pound)', s, re.I)
    if m:
        try: return float(m.group(1)) * 0.4536
        except Exception: pass
    m = re.search(r'(\d+(?:\.\d+)?)\s*g\b', s, re.I)
    if m:
        try: return float(m.group(1)) / 1000
        except Exception: pass
    return None


def fmt_weight(weight, unit) -> str:
    if weight in (None, '', 0):
        return ''
    try: w = float(weight)
    except Exception: return ''
    u = (unit or 'kg').lower()
    if u in ('kg','kgs','kilogram'):  return f'{w:.2f} kg'
    if u in ('g','gram','grams'):     return f'{w/1000:.3f} kg'
    if u in ('lb','lbs','pound'):     return f'{w*0.4536:.2f} kg'
    if u == 'oz':                     return f'{w*0.02835:.3f} kg'
    return f'{w} {u}'


def norm_color(c: str) -> str:
    if not c:
        return ''
    return re.sub(r'\bgrey\b', 'Gray', c.strip(), flags=re.I)


# ---------------------------------------------------------------------------
# tag parser
# ---------------------------------------------------------------------------
TAG_PREFIXES = ('color_', 'material_', 'room_', 'style_', 'colortemperature_',
                'powersource_', 'wattage_', 'voltage_', 'finish_')


def parse_tags(tags_str: str):
    out = {p.rstrip('_'): [] for p in TAG_PREFIXES}
    plain = []
    if not tags_str:
        return out, plain
    for tok in (s.strip() for s in tags_str.split(',')):
        if not tok:
            continue
        low = tok.lower()
        matched = False
        for p in TAG_PREFIXES:
            if low.startswith(p):
                out[p.rstrip('_')].append(tok[len(p):].strip())
                matched = True; break
        if not matched:
            plain.append(tok)
    return out, plain


# ---------------------------------------------------------------------------
# variant helpers + image picker
# ---------------------------------------------------------------------------
def variant_option(variant, options, name) -> str:
    if not options:
        return ''
    name_lower = name.lower()
    for i, opt in enumerate(options[:5]):
        if (opt.get('name') or '').lower() == name_lower:
            v = variant.get(f'option{i+1}')
            return str(v) if v else ''
    return ''


def attach_resize(url: str) -> str:
    CDN_RESIZE = '?w=2040&h=2040'
    if not url or 'trycloudflare' in url:
        return ''
    if '?' in url:
        return url
    return url + CDN_RESIZE


def pick_lifestyle_image(images) -> str:
    if not images:
        return ''
    KW = ('scene', 'lifestyle', 'context', 'in-use', 'in_use', 'room', 'living', 'bedroom')
    for img in images:
        src = (img.get('src') or '').lower()
        if any(k in src for k in KW):
            return img.get('src') or ''
    if len(images) >= 2:
        return images[1].get('src') or ''
    return images[0].get('src') or ''


# ---------------------------------------------------------------------------
# product_detail builder
# ---------------------------------------------------------------------------
def build_product_detail(spec: dict, custom_cat: str, color: str, material: str):
    """Return list of (section_name, attribute_name, attribute_value) tuples (max 10)."""
    lc = (custom_cat or '').lower()
    is_lighting = lc.startswith('lighting') or any(
        kw in lc for kw in ('light', 'lamp', 'pendant', 'chandelier', 'sconce', 'fan'))
    is_furniture = lc.startswith('furniture')
    details = []

    if is_lighting or not is_furniture:
        SECTION = 'Lighting Specifications'
        v = spec_pick(spec, 'wattage', 'rated power', 'power consumption',
                       'lamp power', 'maximum wattage', 'power')
        if not v or not re.search(r'\d', v):
            for k in ('light source', 'bulb type', 'power supply', 'power source'):
                cand = spec_pick(spec, k)
                if cand and re.search(r'\d+\s*W', cand):
                    v = cand; break
        if v and re.search(r'\d', v):
            nv = normalize_wattage(v)
            if nv: details.append((SECTION, 'Wattage', nv))

        v = spec_pick(spec, 'color temperature', 'cct')
        if v:
            nv = normalize_ct(v)
            if nv: details.append((SECTION, 'Color Temperature', nv))

        v = spec_pick(spec, 'voltage', 'operating voltage', 'rated voltage')
        if v:
            nv = normalize_voltage(v)
            if nv: details.append((SECTION, 'Voltage', nv))

        v = spec_pick(spec, 'waterproof', 'ip rating', 'ip grade',
                       'protection grade', 'ingress protection')
        if v:
            nv = normalize_ip(v)
            if nv:
                details.append((SECTION, 'IP Rating', nv))
            elif v.strip().lower() in ('yes', 'y', 'true', '1', 'waterproof'):
                details.append((SECTION, 'IP Rating', 'Waterproof'))

        ls_raw = spec_pick(spec, 'light source', 'bulb type', 'lamp type')
        integrated = spec_pick(spec, 'integrated led')
        light_label = ''
        if ls_raw:
            for kw, lab in (('led','LED'), ('halogen','Halogen'),
                            ('incandescent','Incandescent'), ('cfl','CFL')):
                if kw in ls_raw.lower():
                    light_label = lab; break
        if not light_label and integrated and integrated.strip().lower() in ('yes','y','true','1'):
            light_label = 'LED'
        if not light_label:
            light_label = 'LED'
        details.append((SECTION, 'Light Source Type', light_label))

        for k in ('lamp shade material', 'shade material', 'lamp material',
                  'primary fixture material', 'fixture material',
                  'frame material', 'body material', 'main material'):
            v = spec_pick(spec, k)
            if v:
                details.append((SECTION, 'Lamp Material', v.strip()[:200])); break

        v = spec_pick(spec, 'applicable space', 'recommended space',
                       'lighting area', 'illumination area')
        if v:
            nv = normalize_space(v)
            if nv: details.append((SECTION, 'Applicable Space', nv))

        v = spec_pick(spec, 'applicable scene', 'application',
                       'usage scene', 'recommended use')
        if v:
            nv = v.strip().rstrip('.,;')
            if nv and len(nv) < 200:
                details.append((SECTION, 'Applicable Scene', nv))

        v = spec_pick(spec, 'color rendering', 'cri ', 'cri:')
        if v:
            nv = normalize_cri(v)
            if nv: details.append((SECTION, 'Color Rendering Index', nv))

    if is_furniture:
        SECTION = 'Furniture Specifications'
        dims = []
        for label, keys in (
            ('L', ('overall length', 'length', 'overall length - side to side', 'overall table length')),
            ('W', ('overall width', 'width', 'overall width - side to side', 'overall table width')),
            ('H', ('overall height', 'height', 'overall height - top to bottom', 'overall table height')),
            ('D', ('overall depth', 'depth', 'overall width - front to back')),
        ):
            for k in keys:
                v = spec_pick(spec, k)
                if v:
                    m = re.match(r'([\d.]+\s*(?:["\']|in|cm|mm|ft)[^,<]*)', v.strip())
                    if m:
                        dims.append(f'{label} {m.group(1).strip()}'); break
        if dims:
            details.append((SECTION, 'Product Dimensions', ' x '.join(dims[:4])))
        else:
            v = spec_pick(spec, 'dimensions', 'overall size', 'product size')
            if v:
                details.append((SECTION, 'Product Dimensions',
                                re.sub(r'\s+', ' ', v.replace('\n',' ')).strip()[:200]))

        v = spec_pick(spec, 'weight', 'product weight', 'net weight')
        if v: details.append((SECTION, 'Weight', v.strip()[:100]))

        v = spec_pick(spec, 'material', 'frame material', 'main material')
        if v:
            details.append((SECTION, 'Material', v.strip()[:200]))
        elif material:
            details.append((SECTION, 'Material', material))

        pre = spec_pick(spec, 'preassembled', 'pre-assembled')
        if pre:
            pl = pre.strip().lower()
            if pl in ('yes','y','true','1'):
                details.append((SECTION, 'Assembly Required', 'No - Pre-assembled'))
            elif 'partial' in pl:
                details.append((SECTION, 'Assembly Required', 'Partial - some assembly required'))
            else:
                details.append((SECTION, 'Assembly Required', 'Yes'))
        else:
            v = spec_pick(spec, 'level of assembly', 'assembly required',
                           'assembly', 'installation')
            if v:
                low = v.strip().lower()
                if low in ('no','n','false','0') or 'pre-assembled' in low or 'preassembled' in low:
                    details.append((SECTION, 'Assembly Required', 'No - Pre-assembled'))
                elif low in ('none','full','full assembly needed','full assembly required'):
                    details.append((SECTION, 'Assembly Required', 'Yes - Full Assembly Needed'))
                elif 'partial' in low:
                    details.append((SECTION, 'Assembly Required',
                                    'Partial - some assembly required'))
                else:
                    details.append((SECTION, 'Assembly Required',
                                    f'Yes - {v.strip()[:60]}'))

        v = spec_pick(spec, 'max load', 'load capacity', 'weight capacity', 'load bearing')
        if v: details.append((SECTION, 'Max Load', v.strip()[:80]))

        v = spec_pick(spec, 'seats:', 'seats ', 'seating capacity', 'capacity (people')
        if not v:
            raw = spec_pick(spec, 'capacity')
            if raw and re.search(r'\d', raw): v = raw
        if v: details.append((SECTION, 'Capacity', v.strip()[:80]))

        v = spec_pick(spec, 'style', 'design style')
        if v: details.append((SECTION, 'Style', v.strip()[:100]))

    return details[:10]


# ---------------------------------------------------------------------------
# product_highlight
# ---------------------------------------------------------------------------
_BULLET_RE = re.compile(r'<li[^>]*>(.*?)</li>', re.I | re.S)


def extract_highlights(body_html: str, spec: dict, color: str, material: str,
                       n: int = 4) -> list[str]:
    MAX_LEN = 100
    out, seen = [], set()

    def add(s):
        s = re.sub(r'\s+', ' ', s).strip().rstrip('.,;:')
        if not s or len(s) > MAX_LEN:
            return
        key = s.lower()
        if key in seen: return
        seen.add(key)
        out.append(s)

    if body_html:
        for m in _BULLET_RE.finditer(body_html):
            text = strip_html(m.group(1)).strip()
            if text: add(text)
            if len(out) >= n:
                return out

    ip_v = spec_pick(spec, 'waterproof grade', 'ip rating', 'ip grade')
    ip = normalize_ip(ip_v) if ip_v else ''
    if ip: add(f'{ip} weatherproof for outdoor use')

    wattage_raw = spec_pick(spec, 'wattage', 'rated power', 'maximum wattage', 'power')
    if wattage_raw:
        wn = normalize_wattage(wattage_raw)
        if wn: add(f'{wn} energy-saving' if 'LED' in wn or 'multiple' in wn else f'{wn} power')

    ct_raw = spec_pick(spec, 'color temperature')
    if ct_raw:
        ct_n = normalize_ct(ct_raw)
        if ct_n and len(ct_n) <= MAX_LEN - 10: add(ct_n)

    light_src = spec_pick(spec, 'light source', 'bulb type')
    if light_src:
        if 'led' in light_src.lower(): add('Integrated LED light source')
        elif 'halogen' in light_src.lower(): add('Halogen bulb')

    powr = spec_pick(spec, 'power source', 'power supply')
    if powr:
        pl = powr.lower()
        if 'solar' in pl: add('Solar-powered, no wiring required')
        elif 'battery' in pl: add('Battery powered, cordless setup')
        elif 'usb' in pl: add('USB rechargeable')

    style = spec_pick(spec, 'style')
    if style and len(style) < 40: add(f'{style.strip()} style design')
    if material and len(material) < 40: add(f'{material} construction')
    if color: add(f'Available in {color}')

    add('Free worldwide shipping')
    add('30-day return policy')
    return out[:n]
