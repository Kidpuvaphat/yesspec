"""Evidence rules shared by manual imports, the admin and scheduled feed builds.

A successful rebuild is not a new observation. Legacy values remain candidates;
only an explicit observation of the same listing/variant can make a price eligible.
"""
from __future__ import annotations

import copy
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PRICE_MAX_AGE_HOURS = 48
PLATFORMS = ('shopee', 'lazada')
HOSTS = {
    'shopee': {'shopee.co.th', 'www.shopee.co.th', 's.shopee.co.th', 'shp.ee'},
    'lazada': {'lazada.co.th', 'www.lazada.co.th', 's.lazada.co.th'},
}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def read_json(path, default):
    return json.loads(Path(path).read_text(encoding='utf-8')) if Path(path).exists() else copy.deepcopy(default)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    temp.replace(path)


def valid_url(url, platform):
    url = str(url or '').strip()
    if not url:
        return ''
    p = urlparse(url)
    if (platform not in HOSTS or p.scheme != 'https' or p.hostname not in HOSTS[platform]
            or p.username or p.password or p.port not in (None, 443)
            or any(c in url for c in ['"', "'", '<', '>', '\\', '\n', '\r'])):
        raise ValueError('ใช้ลิงก์ HTTPS ของ Shopee/Lazada ประเทศไทยให้ตรงแพลตฟอร์ม')
    return url


def identity(url, platform):
    url = valid_url(url, platform)
    if not url:
        return {}
    p = urlparse(url)
    origin = parse_qs(p.query).get('origin_link', [None])[0]
    if origin:
        # Only one documented wrapper level; no network access or arbitrary redirects.
        return identity(origin, platform) if 'origin_link=' not in origin else {}
    if p.hostname in {'s.shopee.co.th', 'shp.ee', 's.lazada.co.th'}:
        return {}
    if platform == 'shopee':
        m = re.search(r'(?:/product/|/universal-link/product/)(\d+)/(\d+)(?:/|$)', p.path) or re.search(r'-i\.(\d+)\.(\d+)(?:/|$)', p.path)
        if m:
            return {'shop_id': m[1], 'item_id': m[2], 'sku_id': parse_qs(p.query).get('model_id', [''])[0]}
    else:
        m = re.search(r'-i(\d+)(?:-s(\d+))?\.html$', p.path)
        if m:
            return {'shop_id': '', 'item_id': m[1], 'sku_id': m[2] or ''}
    return {}


def amount(value):
    if value in (None, ''):
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise ValueError('ราคาต้องเป็นตัวเลข')
    if not math.isfinite(n) or n < 0:
        raise ValueError('ราคาต้องเป็นตัวเลขไม่ติดลบ')
    return round(n, 2) if n > 0 else None


def parse_time(value):
    try:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return dt if dt.tzinfo else None
    except (ValueError, TypeError):
        return None


def parse_sales(text, period='unknown', scope='listing'):
    raw = str(text or '').strip()
    # Rounded/abbreviated counts never become exact totals.
    cleaned = re.sub(r'^(?:ขายแล้ว|sold)\s*', '', raw, flags=re.I)
    cleaned = re.sub(r'\s*(?:ชิ้น|sold)$', '', cleaned, flags=re.I).strip()
    m = re.fullmatch(r'([\d,]+(?:\.\d+)?)\s*(พัน|หมื่น|แสน|ล้าน|k|m)?\s*(\+)?', cleaned, re.I)
    value, precision = None, 'unknown'
    if m:
        multiplier = {'พัน': 1000, 'หมื่น': 10000, 'แสน': 100000, 'ล้าน': 1000000, 'k': 1000, 'm': 1000000}.get((m[2] or '').lower(), 1)
        value = int(float(m[1].replace(',', '')) * multiplier)
        precision = 'lower_bound' if m[3] else ('approximate' if m[2] else 'exact')
    return {'raw': raw, 'value': value, 'precision': precision,
            'period': period if period in ('lifetime', '30d') else 'unknown',
            'scope': scope if scope in ('listing', 'sku') else 'listing'}


def normalize_store(store, platform, now=None):
    now_dt = parse_time(now or utc_now())
    s = copy.deepcopy(store or {})
    s['platform'] = platform
    legacy = s.get('evidence_version') != 2
    raw_price = s.get('candidate_price', s.get('net_price'))
    s['candidate_price'] = amount(raw_price)
    s['candidate_original_price'] = amount(s.get('candidate_original_price', s.get('original_price')))
    s['link'] = valid_url(s.get('link', ''), platform)
    s['product_url'] = valid_url(s.get('product_url', ''), platform)
    ids = identity(s['product_url'] or s['link'], platform)
    s.update(ids)
    s['link_type'] = 'exact_pdp' if ids else ('unresolved' if s['link'] else 'missing')
    s['is_direct_product'] = bool(ids)
    s['source'] = 'legacy_unverified' if legacy else s.get('source', 'manual')
    s['observed_at'] = None if legacy else s.get('observed_at')
    s['confirmed_match'] = False if legacy else s.get('confirmed_match') is True
    s['variant'] = s.get('variant', '')
    s['price_basis'] = s.get('price_basis', 'sku')
    s['sales'] = s.get('sales') if not legacy and isinstance(s.get('sales'), dict) else parse_sales('')
    observed = parse_time(s.get('observed_at'))
    age = (now_dt - observed).total_seconds() / 3600 if observed and now_dt else None
    complete = (s['confirmed_match'] and bool(ids) and bool(s['variant'])
                and s['source'] in ('manual', 'official_api') and observed is not None
                and s['candidate_price'] is not None)
    eligible = bool(complete and age is not None and 0 <= age <= PRICE_MAX_AGE_HOURS
                    and s['price_basis'] in ('sku', 'member') and s.get('availability') != 'out_of_stock')
    s['price_verified'] = bool(complete)
    s['ranking_eligible'] = eligible
    s['status'] = ('verified' if eligible else 'stale' if complete and age is not None and age > PRICE_MAX_AGE_HOURS
                   else 'conditional' if complete else 'unverified')
    s['net_price'] = s['candidate_price'] if eligible else None
    original = s['candidate_original_price']
    s['original_price'] = original if eligible and original and original >= s['net_price'] else None
    s['discount_pct'] = round((1 - s['net_price'] / original) * 100, 1) if s['original_price'] else None
    s['store'] = s.get('shop_name') or ('Shopee' if platform == 'shopee' else 'Lazada')
    s['badge'] = ''
    s['shipping'] = ''
    s['affiliate_status'] = s.get('affiliate_status', 'unverified')
    s['evidence_version'] = 2
    return s


def observe_manual(update, platform, previous, now=None):
    now = now or utc_now()
    old = normalize_store(previous, platform, now)
    s = copy.deepcopy(old)
    fields = {'link': 'link', 'product_url': 'product_url', 'price': 'candidate_price',
              'orig_price': 'candidate_original_price', 'variant': 'variant', 'shop': 'shop_name',
              'price_basis': 'price_basis', 'availability': 'availability'}
    changed = False
    for field, target in fields.items():
        key = platform + '_' + field
        if key not in update:
            continue
        value = amount(update[key]) if field in ('price', 'orig_price') else str(update[key] or '').strip()
        if value != s.get(target, '' if isinstance(value, str) else None):
            changed = True
        s[target] = value
    for field in ('link', 'product_url'):
        s[field] = valid_url(s.get(field), platform)
    if not s['product_url'] and identity(s['link'], platform):
        s['product_url'] = s['link']
    link_ids, target_ids = identity(s['link'], platform), identity(s['product_url'], platform)
    if link_ids and target_ids and any(link_ids.get(k) and target_ids.get(k) and link_ids[k] != target_ids[k] for k in ('shop_id', 'item_id', 'sku_id')):
        raise ValueError('ลิงก์ซื้อและหน้าสินค้าต้นทางเป็นคนละสินค้า/ตัวเลือก')
    old_sales = s['sales']
    s['sales'] = parse_sales(update.get(platform + '_sold_text', old_sales.get('raw', '')),
                             update.get(platform + '_sold_period', old_sales.get('period', 'unknown')),
                             update.get(platform + '_sold_scope', old_sales.get('scope', 'listing')))
    changed |= s['sales'] != old_sales
    if changed:
        s['confirmed_match'] = False
        s['observed_at'] = None
    if update.get(platform + '_confirmed') is True:
        host = urlparse(s['link']).hostname
        if s['link'] and not link_ids and (host not in {'s.shopee.co.th', 'shp.ee', 's.lazada.co.th'} or 'origin_link' in parse_qs(urlparse(s['link']).query)):
            raise ValueError('ลิงก์ซื้อเป็นหน้าค้นหาหรือหน้าร้าน กรุณาใช้ลิงก์สินค้าโดยตรง')
        if not s['link']:
            s['link'] = s['product_url']
        if not target_ids or not s.get('variant') or not s.get('candidate_price'):
            raise ValueError('ก่อนยืนยัน กรุณากรอกหน้าสินค้าปลายทาง รุ่น/ตัวเลือก และราคาที่ตรวจพบ')
        supplied_time = update.get(platform + '_observed_at')
        observed = parse_time(supplied_time or now)
        if not observed or observed > parse_time(now):
            raise ValueError('เวลาตรวจข้อมูลต้องมีเขตเวลาและไม่เป็นอนาคต')
        s.update(source='manual', source_url=s['product_url'], confirmed_match=True,
                 observed_at=observed.isoformat(), verified_at=now)
    return normalize_store(s, platform, now)


def rebuild_item(item, now=None):
    item = copy.deepcopy(item)
    stores = item.get('stores_sorted', [])
    stores = [normalize_store(next((s for s in stores if s.get('platform') == pf), {}), pf, now) for pf in PLATFORMS]
    variants = {re.sub(r'\s+', ' ', s['variant']).strip().casefold() for s in stores if s['ranking_eligible']}
    if len(variants) > 1:
        for s in stores:
            if s['ranking_eligible']:
                s.update(ranking_eligible=False, net_price=None, original_price=None, status='variant_mismatch')
    stores.sort(key=lambda s: (not s['ranking_eligible'], s['net_price'] if s['net_price'] is not None else float('inf')))
    best = next((s for s in stores if s['ranking_eligible']), None)
    if item.get('sold_count') is not None:
        item['legacy_sold_count'] = item['sold_count']
    item.update(stores_sorted=stores, cheapest_price=best['net_price'] if best else None,
                cheapest_store=best['store'] if best else None, cheapest_link=best['link'] if best else None,
                sold_count=None, prev_month_price=None)
    return item


def rebuild_feed(feed, now=None):
    now = now or utc_now()
    items = {pid: rebuild_item(item, now) for pid, item in feed.get('items_by_id', {}).items()}
    return {'schema_version': 2, 'generated_at': now, 'price_max_age_hours': PRICE_MAX_AGE_HOURS,
            'sync_mode': 'MANUAL_EVIDENCE', 'total_models_synced': len(items),
            'verified_offers': sum(s['ranking_eligible'] for i in items.values() for s in i['stores_sorted']),
            'items_by_id': items, 'items': list(items.values())}


def record_observations(path, items):
    path = Path(path)
    seen = set()
    if path.exists():
        for line in path.read_text(encoding='utf-8').splitlines():
            row = json.loads(line)
            seen.add(json.dumps(row, sort_keys=True, ensure_ascii=False))
    rows = []
    for item in items:
        for s in item.get('stores_sorted', []):
            if s.get('confirmed_match') and s.get('observed_at'):
                row = {'product_id': item['id'], 'platform': s['platform'], 'product_url': s['product_url'],
                       'variant': s['variant'], 'price': s['candidate_price'], 'price_basis': s['price_basis'],
                       'sales': s['sales'], 'source': s['source'], 'observed_at': s['observed_at']}
                key = json.dumps(row, sort_keys=True, ensure_ascii=False)
                if key not in seen:
                    seen.add(key)
                    rows.append(json.dumps(row, ensure_ascii=False))
    if rows:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('a', encoding='utf-8') as f:
            f.write('\n'.join(rows) + '\n')
