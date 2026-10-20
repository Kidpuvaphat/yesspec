#!/usr/bin/env python3
"""Build a separate unknown-period ranking from a completed, audited Shopee CSV.

Never merges item_sold with plugin counts or claims a 30-day/full-market ranking.
Category mappings use observed feed IDs plus conservative title checks.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

from build_shopee_rankings import (ROOT, REASONS, NEUTRAL_NAMES, category_rejection,
                                   identity, vip_references)
from market_data import identity as url_identity


EXTRA_ACCESSORIES = r'ท่อน้ำ|ท่อน้ํา|ท่อระบาย|สายยาง|สายท่อ|ถุงเก็บฝุ่น|ถุงกรอง|หัวแปรง|แปรงลูกกลิ้ง|ถาดรอง|ถาดอบ|ขารอง|ขาตั้ง|ถุงซัก|ถุงคลุม|ผ้าคลุม|ฝาครอบ|แท่นวาง|ที่แขวน|หัวเป่า|กระบะ|กล่อง.*(?:เครื่อง|หูฟัง)|ด้ามชง|ก้านชง|พอร์ตาฟิลเตอร์|portafilter|capsule|แคปซูล'
REASON_LABELS = {**REASONS,
    'source_link_mismatch': 'ลิงก์ในฟีดไม่ตรงรหัสร้านและสินค้า',
    'stock_unconfirmed': 'จำนวนคงเหลือในฟีดยังยืนยันไม่ได้',
    'shop_on_holiday': 'ฟีดระบุว่าร้านพักการขาย',
    'feed_price_time_unknown': 'ฟีดไม่ระบุเวลาอัปเดตราคารายสินค้า ต้องตรวจราคาปัจจุบัน',
    'feed_category_mapping': 'จับคู่จากหมวดในฟีดและชื่อสินค้า อาจยังมีสินค้าจัดหมวดผิด',
    'model_fields_unaligned': 'จำนวนรหัส ชื่อ หรือราคาตัวเลือกในฟีดไม่ตรงกัน',
    'price_option_unclear': 'ราคาต่ำกว่าขอบตรวจของหมวด ต้องตรวจว่าเป็นตัวสินค้า อะไหล่ หรือเงินดาวน์',
    'missing_price': 'ยังไม่มีราคาที่ใช้ได้จากฟีด จึงเว้นราคาไว้',
}


def price_value(raw):
    try:
        value = Decimal(str(raw).strip())
        return float(value) if value.is_finite() and value > 0 and math.isfinite(float(value)) else None
    except (InvalidOperation, ValueError):
        return None


def title_rejection(cid, title):
    reason = category_rejection(cid, title)
    if reason:
        return reason
    lowered = title.lower()
    appliance = cid in {'aircon','washer','dryer','purifier','robot','cordlessvac','waterheater',
                         'waterpurifier','coffee','hairdryer','airfryer','fridge'}
    if appliance and re.search(r'อะไหล่|อุปกรณ์เสริม|accessories|replacement|กระดาษรอง|ฐานรอง|ฐานตู้|วงเล็บ|สายน้ำ|สายน้ํา|วาล์ว|น้ำยา|น้ํายา|\bfilter\b', lowered):
        return 'accessory'
    if cid == 'headphone' and re.search(r'^(?:\[[^\]]*\]\s*)?(?:สายคล้อง|สายกันหาย)|(?:anti.?lost|silicone)\s+(?:strap|lanyard)|strap for airpods?', lowered):
        return 'accessory'
    if cid == 'headphone' and not re.search(r'\banc\b|active noise|noise cancel|airpods\s*pro|quietcomfort|wh-?1000xm|ult900n', lowered):
        return 'category_unclear'
    if cid == 'camera' and (re.search(r'กล้องมองหลัง|parking camera', lowered) or not re.search(r'action|แอคชัน|แอ็คชัน|หน้ารถ|ติดรถ|dash.?cam|insta360|gopro', lowered)):
        return 'category_mismatch'
    if cid == 'vitamin' and not re.search(r'วิตามิน\s*ซี|วิตามินรวม|vitamin\s*c\b|multivit|multi vit|bio c|c acerola|centrum', lowered):
        return 'category_mismatch'
    # Broad feed categories also contain spare parts. Conservative exclusions
    # are explicit; excluded high-selling rows remain available for review.
    if cid in {'aircon','washer','dryer','purifier','robot','cordlessvac','waterheater',
               'waterpurifier','coffee','hairdryer','catlitter'}:
        if re.search(EXTRA_ACCESSORIES, lowered):
            # Complete capsule machines and cat treats are allowed by their categories.
            if not (cid == 'coffee' and re.search(r'เครื่องชง.*(?:แคปซูล|capsule)', lowered)):
                return 'accessory'
    if cid == 'smartphone' and re.search(r'ปุ่มกด|feature phone', lowered):
        return 'category_mismatch'
    if cid == 'aircon' and re.search(r'พัดลม|แอร์เคลื่อนที่|portable|รถยนต์|แคมป', lowered):
        return 'category_mismatch'
    if cid == 'cordlessvac' and not re.search(r'ไร้สาย|cordless|wireless', lowered):
        return 'category_unclear'
    if cid == 'chair' and not re.search(r'ทำงาน|ทํางาน|สำนักงาน|สํานักงาน|สุขภาพ|ergonomic|office', lowered):
        return 'category_unclear'
    return None


def normalize_row(row, cid, observed_at, vip, manual_exclusions):
    key = identity(row.get('shopid'), row.get('itemid'))
    title = row.get('title', '')
    reason = 'invalid_identity' if not key else title_rejection(cid, title)
    if key in manual_exclusions.get(cid, {}):
        reason = 'manual_exclusion'
    try:
        link_ids = url_identity(row.get('product_link', ''), 'shopee')
    except ValueError:
        link_ids = {}
    if not reason and (not link_ids or str(link_ids.get('shop_id')) != row['shopid']
                       or str(link_ids.get('item_id')) != row['itemid']):
        reason = 'source_link_mismatch'
    sold = row.get('item_sold', '').strip()
    if not reason and not (sold.isascii() and sold.isdigit()):
        reason = 'missing_sales'
    if not reason and row.get('condition', '').lower() != 'new':
        reason = 'used_or_subscription'
    stock = row.get('stock', '').strip()
    if not reason and not (stock.isascii() and stock.isdigit()):
        reason = 'stock_unconfirmed'
    if not reason and int(stock) <= 0:
        reason = 'sold_out'
    if not reason and row.get('holiday_mode_on', '').lower() != 'off':
        reason = 'shop_on_holiday'
    amount = price_value(row.get('sale_price'))
    # Exclude ambiguous very-low-price options from the public candidate ranking.
    # These are review thresholds, not claims about a product's true minimum price.
    review_floors = {'notebook':1500, 'aircon':1500, 'washer':500, 'robot':500, 'tv':1000}
    if not reason and amount is not None and amount < review_floors.get(cid, 0):
        reason = 'price_option_unclear'
    if reason:
        return None, reason
    ids, names, prices = [row.get(field, '').split('|') if row.get(field) else []
                           for field in ('model_ids','model_names','model_prices')]
    aligned = len(ids) == len(names) == len(prices)
    flags = ['variant_unconfirmed', 'price_conditions_unconfirmed', 'listing_sales_scope',
             'feed_price_time_unknown', 'feed_category_mapping']
    if amount is None:
        flags.append('missing_price')
    if not aligned:
        flags.append('model_fields_unaligned')
    if key in vip:
        flags.append('vip_reference')
    if re.search(r'pre.?sale|pre.?order|พรีออเดอร์|ของเข้า', title, re.I):
        flags.append('preorder')
    if 'แบ่งขาย' in title:
        flags.append('repacked')
    path = [{'id': row.get(f'global_catid{i}', ''), 'name': row.get(f'global_category{i}', '')}
            for i in (1,2,3) if row.get(f'global_catid{i}')]
    return {
        'listing_id': key, 'shop_id': row['shopid'], 'item_id': row['itemid'],
        'title': title, 'shop_name': row.get('shop_name', ''),
        'product_url': f'https://shopee.co.th/product/{key}',
        'source': 'shopee_affiliate_csv', 'observed_at': observed_at,
        'price_observed_at': None,
        'price': {'amount': amount, 'currency': 'THB', 'basis': 'feed_sale_price',
                  'raw': row.get('sale_price', ''), 'scale': 1, 'variant_verified': False,
                  'regular_price': price_value(row.get('price')), 'model_count': len(ids),
                  'model_fields_aligned': aligned,
                  'model_examples': [{'id': i, 'name': n, 'feed_price': price_value(p)}
                                     for i,n,p in list(zip(ids,names,prices))[:5]] if aligned else []},
        'sales': {'value': int(sold), 'raw': f'item_sold: {sold}', 'precision': 'provider_reported',
                  'period': 'unknown', 'scope': 'listing'},
        'stock': int(stock), 'category_path': path, 'vip_reference': vip.get(key),
        'review_flags': flags, 'queries': [],
    }, None


def build_feed(csv_path, feed_audit, categories, mapping, manual, exclusions):
    if csv_path.suffix.lower() != '.csv':
        raise ValueError('Use a completed CSV file.')
    before = csv_path.stat()
    if not feed_audit.get('source_file_read_to_end') or before.st_size != feed_audit['source_bytes']:
        raise ValueError('Input must match its completed-file audit.')
    reverse = defaultdict(set)
    for cid, ids in mapping.items():
        for source_id in ids:
            reverse[source_id].add(cid)
    eligible = defaultdict(list)
    rejected = defaultdict(list)
    counts = Counter()
    observed = feed_audit['generated_at']
    vip = vip_references(manual)
    rows = 0
    seen = set()
    csv.field_size_limit(10_000_000)
    with csv_path.open(encoding='utf-8-sig', newline='') as stream:
        for row in csv.DictReader(stream, strict=True):
            rows += 1
            if None in row or any(v is None for v in row.values()):
                raise ValueError(f'Malformed source row {rows}')
            key = identity(row['shopid'], row['itemid'])
            if not key or key in seen:
                raise ValueError(f'Invalid or duplicate identity at row {rows}')
            seen.add(key)
            cids = set().union(*(reverse[row.get(f'global_catid{i}', '')] for i in (1,2,3)))
            for cid in cids:
                counts[cid] += 1
                product, reason = normalize_row(row, cid, observed, vip, exclusions)
                if product:
                    eligible[cid].append(product)
                else:
                    raw_sold = row.get('item_sold', '')
                    rejected[cid].append({'listing_id': key, 'title': row['title'],
                        'product_url': f'https://shopee.co.th/product/{key}', 'reason': reason,
                        'sales': int(raw_sold) if raw_sold.isascii() and raw_sold.isdigit() else None,
                        'note': exclusions.get(cid, {}).get(key, ''), 'observed_at': observed})
    digest = hashlib.sha256()
    with csv_path.open('rb') as stream:
        while chunk := stream.read(1024*1024):
            digest.update(chunk)
    after = csv_path.stat()
    if digest.hexdigest() != feed_audit['source_sha256'] or rows != feed_audit['counts']['rows']:
        raise ValueError('Source differs from its audit.')
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError('CSV changed while reading.')
    output, review = [], []
    for category in categories:
        cid = category['id']
        products = sorted(eligible[cid], key=lambda i: (-i['sales']['value'], i['listing_id']))
        selected = products[:20]
        for n, product in enumerate(selected, 1):
            product['rank'] = selected[n-2]['rank'] if n > 1 and product['sales']['value'] == selected[n-2]['sales']['value'] else n
        source_paths = [c for c in feed_audit['category_paths'] if any(l['id'] in mapping[cid] for l in c['levels'])]
        output.append({**category, 'name': NEUTRAL_NAMES.get(cid, category['name']),
            'target_count':20, 'listing_count':len(selected), 'sample_count':counts[cid],
            'eligible_count':len(products), 'excluded_count':len(rejected[cid]),
            'shortfall':max(0,20-len(selected)), 'queries':[], 'failed_queries':[],
            'observed_from':observed, 'observed_to':observed, 'source_category_paths':source_paths,
            'items':selected})
        excluded = sorted(rejected[cid], key=lambda i: (-(i['sales'] or 0),i['listing_id']))
        review.append({'category_id':cid, 'excluded_count':len(excluded),
                       'exclusion_reason_counts':dict(Counter(i['reason'] for i in excluded)),
                       'excluded_preview_limit':100, 'excluded':excluded[:100],
                       'below_cutoff_count':max(0,len(products)-20)})
    all_items = [i for c in output for i in c['items']]
    data = {'schema_version':1, 'source':'shopee_affiliate_csv', 'country':'TH',
            'ranking_scope':'eligible_listings_in_provided_feed', 'ranking_unit':'listing',
            'sales_period':'unknown', 'requested_sales_period':'rolling_30d', 'price_ttl_hours':48,
            'observed_from':observed, 'observed_to':observed, 'price_observed_at':None,
            'source_filename':csv_path.name, 'source_sha256':feed_audit['source_sha256'],
            'source_total_rows':rows, 'source_category_path_count':len(feed_audit['category_paths']),
            'marketplace_coverage_percent':None, 'category_count':len(output),
            'listing_count':len(all_items), 'review_count':len(all_items),
            'vip_reference_count':sum(bool(i['vip_reference']) for i in all_items),
            'reason_labels':REASON_LABELS, 'categories':output}
    return data, {'schema_version':1,'source':'shopee_affiliate_csv','categories':review}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv_file', type=Path)
    parser.add_argument('--audit', type=Path, required=True)
    args = parser.parse_args()
    def read(path):
        return json.loads((ROOT / path).read_text())
    data, review = build_feed(args.csv_file, json.loads(args.audit.read_text()),
        read('data/shopee-ranking-categories.json'), read('data/shopee-feed-category-map.json'),
        read('data/manual_overrides.json'), read('data/shopee-ranking-exclusions.json'))
    for name,value in [('shopee_feed_rankings.json',data),('shopee_feed_review.json',review)]:
        path = ROOT / 'data' / name
        temporary = path.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
        temporary.replace(path)
    print(json.dumps({'source_rows':data['source_total_rows'],'ranked':data['listing_count'],
        'shortfalls':{c['id']:c['shortfall'] for c in data['categories'] if c['shortfall']},
        'eligible':sum(c['eligible_count'] for c in data['categories'])},ensure_ascii=False))


if __name__ == '__main__':
    main()
