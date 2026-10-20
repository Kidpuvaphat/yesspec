"""Manual purchase channels for the feed's Top 20. Never rewrites sales or ranks."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from pathlib import Path
from urllib.parse import urlparse

from market_data import identity, utc_now, write_json, parse_time

PLATFORMS = ('shopee', 'lazada', 'tiktok')
HOSTS = {
    'shopee': {'shopee.co.th', 'www.shopee.co.th', 's.shopee.co.th', 'shp.ee'},
    'lazada': {'lazada.co.th', 'www.lazada.co.th', 's.lazada.co.th'},
    'tiktok': {'tiktok.com', 'www.tiktok.com', 'shop.tiktok.com', 'vt.tiktok.com', 'vm.tiktok.com'},
}


class ConflictError(ValueError):
    pass


def valid_cart_url(value, platform):
    url = str(value or '').strip()
    if not url:
        return ''
    try:
        p = urlparse(url)
        safe = (len(url) <= 4096 and p.scheme == 'https' and p.hostname in HOSTS[platform]
                and not p.username and not p.password and p.port in (None, 443)
                and not re.search(r'[\s<>"\x27\\\x00-\x1f]', url))
        if not safe:
            raise ValueError()
        if platform in ('shopee', 'lazada'):
            short = p.hostname in {'s.shopee.co.th', 'shp.ee', 's.lazada.co.th'}
            pattern = r'/[A-Za-z0-9_.-]+/?' if platform == 'lazada' else r'/[A-Za-z0-9_-]+/?'
            cart = bool(re.fullmatch(pattern, p.path)) if short else bool(identity(url, platform))
            if p.hostname == 's.shopee.co.th' and p.path == '/an_redir':
                cart = bool(identity(url, platform))
        else:
            cart = (bool(re.fullmatch(r'/[A-Za-z0-9_-]+/?', p.path)) if p.hostname in {'vt.tiktok.com', 'vm.tiktok.com'}
                    else bool(re.fullmatch(r'/(?:view/product/\d+|(?:shop/|[a-z]{2}/)?pdp/(?:[^/]+/)?\d+|t/[A-Za-z0-9_-]+)/?', p.path)))
        if not cart:
            raise ValueError()
    except (ValueError, KeyError):
        raise ValueError('ใช้ลิงก์ตะกร้าสินค้า HTTPS ของ ' + platform + ' ให้ตรงช่อง (ไม่ใช้หน้าค้นหาหรือโปรไฟล์)') from None
    return url  # Keep affiliate query parameters and short URLs exactly as supplied.


def binding(item):
    return {'title': item['title'], 'model_count': item.get('price', {}).get('model_count'),
            'model_examples': [{'id': m.get('id'), 'name': m.get('name')}
                               for m in item.get('price', {}).get('model_examples', [])]}


def read_store(root):
    path = Path(root) / 'data/ranking_manual_offers.json'
    # An unreadable file must not silently discard existing edits on the next save.
    data = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'schema_version': 1, 'items': {}}
    if data.get('schema_version') != 1 or not isinstance(data.get('items'), dict):
        raise ValueError('รูปแบบไฟล์ช่องทางซื้อไม่ถูกต้อง')
    return data


def feed_categories(root):
    data = json.loads((Path(root) / 'data/shopee_feed_rankings.json').read_text(encoding='utf-8'))
    if data.get('source') != 'shopee_affiliate_csv':
        raise ValueError('ไม่พบชุดข้อมูล Shopee Product Feed')
    return [{**c, 'items': sorted(c['items'], key=lambda i: -i['sales']['value'])[:c.get('target_count', 20)]} for c in data['categories']]


def revision(item, entry):
    raw = json.dumps([binding(item), entry], ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()


def default_shopee(item):
    return {'url': item['product_url'], 'price': None if item.get('manual_price_only') else item.get('price', {}).get('amount'),
            'price_type': 'coupon' if item.get('manual_price_only') else 'regular', 'variant': '', 'note': '',
            'source': 'awaiting_manual' if item.get('manual_price_only') else 'shopee_affiliate_csv', 'recorded_at': None}


def payload(root):
    store = read_store(root)
    categories = []
    for category in feed_categories(root):
        rows = []
        for item in category['items']:
            entry = store['items'].get(item['listing_id'], {})
            matched = entry.get('binding') == binding(item)
            offers = {}
            pending = []
            for pf in PLATFORMS:
                if pf in entry.get('offers', {}) and (matched or entry['offers'][pf] is None):
                    offers[pf] = entry['offers'][pf]
                else:
                    offers[pf] = default_shopee(item) if pf == 'shopee' else None
                    if entry.get('offers', {}).get(pf):
                        pending.append(pf)
            rows.append({'listing_id': item['listing_id'], 'title': item.get('display_name', item['title']), 'rank': item['rank'],
                         'source_title': item['title'], 'price_band': item.get('price_band', ''),
                         'price_band_label': item.get('price_band_label', ''),
                         'shop_name': item.get('shop_name', ''), 'offers': offers,
                         'value_specs': entry.get('value_specs') if matched else None,
                         'feed_offer': default_shopee(item),
                         'revision': revision(item, entry), 'needs_review': pending})
        categories.append({'id': category['id'], 'name': category['name'], 'icon': category.get('icon', ''),
                           'price_bands': category.get('price_bands', []), 'items': rows})
    return {'ok': True, 'categories': categories, 'total': sum(len(c['items']) for c in categories)}


def clean_offer(raw, platform, now):
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError('ข้อมูลช่องทางซื้อไม่ถูกต้อง')
    url = valid_cart_url(raw.get('url'), platform)
    if not url:
        return None  # Clearing a cart also removes its price, including a previously saved price.
    price = raw.get('price')
    if price in ('', None):
        price = None
    else:
        try:
            if isinstance(price, bool):
                raise ValueError()
            price = float(price)
            if not math.isfinite(price) or price <= 0 or price > 100_000_000:
                raise ValueError()
            price = round(price, 2)
            if price <= 0:
                raise ValueError()
        except (ValueError, TypeError):
            raise ValueError('ราคาต้องมากกว่า 0 หรือเว้นว่างไว้') from None
    price_type = raw.get('price_type', 'regular')
    if price_type not in ('regular', 'vip', 'coupon', 'flash_sale'):
        raise ValueError('ประเภทราคาไม่ถูกต้อง')
    result = {'url': url, 'price': price, 'price_type': price_type, 'source': 'manual', 'recorded_at': now}
    for field in ('variant', 'note'):
        value = str(raw.get(field) or '').strip()
        if len(value) > 500:
            raise ValueError('รายละเอียดต้องไม่เกิน 500 ตัวอักษร')
        result[field] = value
    lookup = raw.get('price_lookup')
    if price is not None and isinstance(lookup, dict) and lookup.get('requested_url') == url and lookup.get('amount') == price:
        checked = parse_time(lookup.get('checked_at'))
        if checked and checked <= parse_time(now) and lookup.get('confirmed') is True:
            resolved = valid_cart_url(lookup.get('resolved_url'), platform)
            if resolved:
                result['price_lookup'] = {'checked_at':lookup['checked_at'], 'resolved_url':resolved,
                                         'requested_url':url, 'amount':price, 'confirmed':True}
    return result


def clean_value_specs(raw, now):
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError('ข้อมูลสเปกไม่ถูกต้อง')
    result = {}
    for key in ('geekbench6_single', 'geekbench6_multi', 'ram_gb', 'storage_gb', 'battery_mah', 'refresh_hz'):
        value = raw.get(key)
        if value in ('', None):
            result[key] = None
            continue
        try:
            if isinstance(value, bool):
                raise ValueError()
            value = float(value)
            if not math.isfinite(value) or not 0 < value <= 100_000:
                raise ValueError()
        except (TypeError, ValueError):
            raise ValueError('ค่าสเปกต้องเป็นตัวเลขมากกว่า 0 หรือเว้นว่างไว้') from None
        result[key] = value
    for key in ('variant', 'spec_url', 'benchmark_url'):
        value = str(raw.get(key) or '').strip()
        if len(value) > (500 if key == 'variant' else 4096):
            raise ValueError('รายละเอียดสเปกยาวเกินกำหนด')
        if key.endswith('_url') and value:
            try:
                url = urlparse(value)
                valid = (url.scheme == 'https' and bool(url.hostname) and not url.username and not url.password
                         and url.port in (None, 443) and not re.search(r'[\s<>"\x27\\\x00-\x1f]', value))
                if key == 'benchmark_url':
                    valid = valid and url.hostname == 'browser.geekbench.com' and bool(re.fullmatch(r'/v6/cpu/\d+/?', url.path))
                if not valid:
                    raise ValueError()
            except ValueError:
                raise ValueError('ใช้แหล่งสเปก HTTPS และลิงก์ผลทดสอบ Geekbench 6 CPU ให้ตรงรุ่น') from None
        result[key] = value
    result['verified'] = raw.get('verified') is True
    if result['verified'] and not all(result[key] for key in result if key != 'verified'):
        raise ValueError('กรอกสเปก ตัวเลือก และแหล่งอ้างอิงให้ครบก่อนยืนยัน')
    result['checked_at'] = now if result['verified'] else None
    return result


def save(root, updates):
    if not isinstance(updates, list) or not 1 <= len(updates) <= 640:
        raise ValueError('เลือกสินค้าที่ต้องการบันทึก')
    store = copy.deepcopy(read_store(root))
    items = {i['listing_id']: i for c in feed_categories(root) for i in c['items']}
    now, seen = utc_now(), set()
    for update in updates:
        if not isinstance(update, dict):
            raise ValueError('ข้อมูลสินค้าไม่ถูกต้อง')
        lid = update.get('listing_id')
        if not isinstance(lid, str) or lid not in items or lid in seen:
            raise ValueError('ไม่พบสินค้าในรายการที่เปิดใช้งาน หรือส่งสินค้าซ้ำ')
        seen.add(lid)
        item, old = items[lid], store['items'].get(lid, {})
        if update.get('revision') != revision(item, old):
            raise ConflictError('ข้อมูลถูกแก้ไขหรือฟีดเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนบันทึก')
        changes, reset = update.get('offers', {}), update.get('reset', [])
        if (not isinstance(changes, dict) or not isinstance(reset, list)
                or any(not isinstance(p, str) for p in reset)
                or set(changes).union(reset) - set(PLATFORMS)):
            raise ValueError('ช่องทางซื้อไม่ถูกต้อง')
        if set(changes).intersection(reset):
            raise ValueError('ไม่สามารถแก้ไขและคืนค่าเดียวกันพร้อมกัน')
        # Retain manual matches only while the exact source listing/options still match.
        offers = old.get('offers', {}) if old.get('binding') == binding(item) else {
            p: None for p, v in old.get('offers', {}).items() if v is None}
        offers = copy.deepcopy(offers)
        for pf in reset:
            offers.pop(pf, None)
        for pf, raw in changes.items():
            offers[pf] = clean_offer(raw, pf, now)
        specs = old.get('value_specs') if old.get('binding') == binding(item) else None
        if 'value_specs' in update:
            specs = clean_value_specs(update['value_specs'], now)
        store['items'][lid] = {'binding': binding(item), 'offers': offers, 'updated_at': now}
        if specs is not None:
            store['items'][lid]['value_specs'] = specs
    store['updated_at'] = now
    write_json(Path(root) / 'data/ranking_manual_offers.json', store)
    return {'ok': True, 'updated_count': len(seen)}
