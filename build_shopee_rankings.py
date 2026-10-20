#!/usr/bin/env python3
"""Build reproducible Shopee listing rankings from saved connector observations.

No network calls: rebuilding never changes observation dates or claims live API access.
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from market_data import parse_sales

ROOT = Path(__file__).resolve().parent
PRICE_SCALE = 100000
POSITIVE = {
    'smartphone': r'สมาร์ทโฟน|โทรศัพท์|smartphone|galaxy|iphone|redmi|poco|oppo|vivo|realme',
    'tablet': r'แท็บเล็ต|tablet|ipad|\bpad\b',
    'aircon': r'แอร์|เครื่องปรับอากาศ|air condition',
    'notebook': r'โน้ตบุ๊ก|โน๊ตบุ๊ค|โน๊ตบุ๊ก|notebook|laptop|macbook|thinkpad|ideapad|vivobook|expertbook|aspire|omnibook',
    'tv': r'ทีวี|โทรทัศน์|\btv\b|television',
    'fridge': r'ตู้เย็น|refrigerator',
    'washer': r'เครื่องซักผ้า|washing machine',
    'dryer': r'เครื่องอบผ้า|tumble dryer|เครื่องซักอบผ้า',
    'purifier': r'เครื่องฟอก\s*อากาศ|air purifier',
    'robot': r'หุ่นยนต์|robot.*vacuum|robotic',
    'cordlessvac': r'เครื่องดูดฝุ่น|vacuum|pencilvac',
    'waterheater': r'เครื่องทำน้ำอุ่น|เครื่องทําน้ําอุ่น|water heater',
    'waterpurifier': r'เครื่องกรองน[้ํ]ำ|เครื่องกรองน้ํา|ตู้กรองน้ำ|water purifier|fountain 7s',
    'airfryer': r'หม้อทอด|ไมโครเวฟ|air fryer|airfryer|microwave',
    'coffee': r'เครื่องชงกาแฟ|coffee machine|coffee maker|nespresso',
    'smartwatch': r'สมาร์ทวอท|สมาร์ทวอต|นาฬิกา|watch|smartband|smart band',
    'headphone': r'\banc\b|ตัดเสียงรบกวน|noise cancel|airpods\s*pro|quietcomfort|ult900n',
    'monitor': r'จอคอม|มอนิเตอร์|monitor|จอมอนิเตอร์',
    'chair': r'เก้าอี้|ergonomic chair',
    'speaker': r'ลำโพง|speaker|soundbar|ซาวด์บาร์|jbl partybox|jbl charge|xiaomi sound outdoor',
    'camera': r'กล้อง|dash.?cam|action camera|insta360',
    'hairdryer': r'ไดร์|ไดร[์่]?เป่า|เครื่องเป่าผม|hair dryer|hairdryer',
    'sunscreen': r'กันแดด|sunscreen|sun screen|uv.*spf|anessa',
    'shampoo': r'แชมพู|ยาสระผม|shampoo',
    'toothpaste': r'ยาสีฟัน|toothpaste|น้ำยาบ้วนปาก|mouthwash',
    'bodywash': r'สบู่|ครีมอาบน้ำ|อาบน้ำ|body wash|shower|cleansing',
    'vitamin': r'วิตามิน|vitamin|multivit|multi vit|bio c|c acerola',
    'whey': r'เวย์|เวย|โปรตีน|protein|whey|plantae',
    'collagen': r'คอลลาเจน|collagen|โพรไบโอติก|โปรไบโอติก|probiotic',
    'catfood': r'อาหาร.{0,35}แมว|cat food|catfood|feline|kaniva|royal canin.*แมว|me-o.*แมว',
    'dogfood': r'อาหาร.{0,35}(?:สุนัข|หมา)|dog food|dogfood|canine|royal canin.*(?:mini|puppy|สุนัข)',
    'catlitter': r'ทราย|cat litter|แมวเลีย|churu|ขนมแมว',
}
ACCESSORIES = r'ไส้กรอง|แผ่นกรอง|ฟิลเตอร์|อะไหล่|บานสวิง|แบตเตอรี่ทดแทน|รีโมท|สายชาร์จ|ฟิล์ม|เคส\s|ซิลิโคน|ฟองน้ำหูฟัง|eartips|replacement|pre-filter|^for\s|^สำหรับ|ขาตั้ง|สายรัด|สายซิลิโคน'
NEUTRAL_NAMES = {
    'hairdryer': 'ไดร์เป่าผม', 'shampoo': 'แชมพู', 'catfood': 'อาหารแมว',
    'dogfood': 'อาหารสุนัข', 'chair': 'เก้าอี้ทำงาน',
}


def instant(value):
    try:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return dt if dt.tzinfo else None
    except (ValueError, TypeError):
        return None


def baht(raw):
    if isinstance(raw, bool) or raw is None:
        return None
    try:
        value = Decimal(str(raw)) / PRICE_SCALE
        return float(value.quantize(Decimal('.01'), rounding=ROUND_HALF_UP)) if value.is_finite() and value > 0 else None
    except (InvalidOperation, ValueError):
        return None


def identity(shop, item):
    shop, item = str(shop or ''), str(item or '')
    return f'{shop}/{item}' if re.fullmatch(r'[1-9][0-9]*', shop) and re.fullmatch(r'[1-9][0-9]*', item) else None


def category_rejection(category, title):
    title = unicodedata.normalize('NFKC', title).replace('\u0e4d\u0e32', '\u0e33').replace('เเ', 'แ').lower()
    product = re.search(POSITIVE[category], title)
    if not product:
        return 'category_unclear'
    accessory = re.search(ACCESSORIES, title)
    # A filter included AFTER a complete purifier is a bundle, not a spare part.
    if accessory and accessory.start() < product.start():
        return 'accessory'
    if re.search(r'(?<!บุหรี่)มือสอง|second.?hand|สินค้าตัวโชว์|ราคารายเดือน|รายเดือน\)|ค่าเช่า|เงินดาวน์|คัดเกรด.*สภาพดี', title):
        return 'used_or_subscription'
    if category == 'chair' and 'เก้าอี้พักผ่อน' in title:
        return 'category_mismatch'
    if category == 'cordlessvac' and re.search(r'หุ่นยนต์|robot', title):
        return 'category_mismatch'
    if category == 'robot' and re.search(r'winbot|ทำความสะอาดกระจก|เช็ดกระจก', title):
        return 'category_mismatch'
    if category == 'tv' and not re.search(r'4k|8k|ultra\s*hd|uhd', title):
        return 'category_unclear'
    if category == 'dryer' and re.search(r'เครื่องซักอบ|wash.*dry', title):
        return 'category_mismatch'
    if category == 'waterpurifier' and re.search(r'awp1830|เครื่องกรองน้ำใช้|ตัวกรองน้ำก่อนเข้าบ้าน', title):
        return 'category_mismatch'
    if category == 'headphone' and re.search(r'eartips|ซิลิโคนหูฟัง|ฟองน้ำหูฟัง|^เคส', title):
        return 'accessory'
    return None


def vip_references(manual):
    result = {}
    for product in manual.values():
        for offer in product.get('stores_sorted', []):
            key = identity(offer.get('shop_id'), offer.get('item_id'))
            url = f'https://shopee.co.th/product/{key}'
            if (key and offer.get('platform') == 'shopee' and offer.get('price_basis') == 'member'
                    and offer.get('confirmed_match') and offer.get('price_verified')
                    and offer.get('product_url') == url and instant(offer.get('observed_at'))):
                value = offer.get('candidate_price')
                if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
                    result[key] = {'amount': value, 'variant': offer.get('variant', ''),
                                   'observed_at': offer['observed_at'], 'source': 'manual',
                                   'basis': 'member', 'product_url': url}
    return result


REASONS = {
    'category_unclear': 'ชื่อสินค้ายังยืนยันหมวดไม่ได้',
    'category_mismatch': 'ประเภทสินค้าไม่ตรงหมวด', 'accessory': 'อะไหล่หรืออุปกรณ์เสริม',
    'used_or_subscription': 'มือสอง ตัวโชว์ หรือราคาสมัครบริการ',
    'missing_sales': 'ไม่พบยอดขายที่ใช้จัดอันดับได้', 'missing_price': 'ไม่พบราคา',
    'invalid_identity': 'รหัสร้านหรือรหัสสินค้าไม่ครบ', 'invalid_observation': 'เวลาเก็บข้อมูลไม่ถูกต้อง',
    'sold_out': 'แหล่งข้อมูลระบุว่าสินค้าหมด', 'manual_exclusion': 'ตรวจเพิ่มแล้วไม่ตรงขอบเขต',
    'sales_inconsistent': 'ยอดขายตัวเลขไม่สอดคล้องกับข้อความที่แสดง',
    'variant_unconfirmed': 'ต้องยืนยันตัวเลือก สี ความจุ หรือขนาดแพ็กของราคา',
    'price_conditions_unconfirmed': 'ต้องตรวจเงื่อนไขคูปอง สมาชิก และราคาชำระจริง',
    'voucher_present': 'ปลั๊กอินมีข้อมูลคูปอง ต้องตรวจสิทธิ์ก่อนซื้อ',
    'listing_sales_scope': 'ยอดทั้งหน้าสินค้า อาจรวมหลายรุ่นหรือตัวเลือก',
    'vip_reference': 'มีราคา VIP ที่เคยตรวจไว้ ต้องตรวจสิทธิ์และราคาปัจจุบันอีกครั้ง',
    'preorder': 'ชื่อสินค้าระบุพรีออเดอร์ ต้องตรวจวันจัดส่ง',
    'repacked': 'ชื่อสินค้าระบุแบ่งขาย ต้องตรวจบรรจุภัณฑ์และปริมาณ',
}


def build_rankings(categories, snapshots, manual=None, exclusions=None, now=None):
    now = now or datetime.now(timezone.utc)
    manual, exclusions = manual or {}, exclusions or {}
    vip = vip_references(manual)
    output, audit = [], []
    for category in categories:
        cid = category['id']
        searches = [s for s in snapshots if s.get('category_id') == cid]
        candidates = {}
        rejected = []
        for search in searches:
            if not search.get('success') or search.get('source') != 'shopee_plugin' or search.get('country') != 'TH':
                continue
            for item in search.get('items', []):
                key = identity(item.get('shop_id'), item.get('item_id'))
                observed = instant(search.get('observed_at'))
                error = 'invalid_identity' if not key else 'invalid_observation' if not observed or observed > now else None
                if error:
                    rejected.append({'title': item.get('title', ''), 'reason': error})
                    continue
                previous = candidates.get(key)
                queries = set(previous.get('queries', []) if previous else []) | {search['query']}
                if not previous or observed >= instant(previous['observed_at']):
                    candidates[key] = {**item, 'observed_at': search['observed_at'], 'queries': sorted(queries)}
                else:
                    previous['queries'] = sorted(queries)
        eligible = []
        for key, item in candidates.items():
            sales = item.get('sales', {})
            sold = sales.get('historical_sold_count')
            price = baht(item.get('display_price'))
            reason = category_rejection(cid, item['title'])
            if exclusions.get(cid, {}).get(key):
                reason = 'manual_exclusion'
            if not reason and item.get('is_sold_out'):
                reason = 'sold_out'
            if not reason and (type(sold) is not int or sold < 0 or not sales.get('historical_sold_count_text')):
                reason = 'missing_sales'
            displayed = parse_sales(sales.get('historical_sold_count_text'))
            if not reason and displayed['value'] is not None:
                if ((displayed['precision'] == 'exact' and sold != displayed['value'])
                        or (displayed['precision'] == 'lower_bound' and sold < displayed['value'])):
                    reason = 'sales_inconsistent'
            if not reason and price is None:
                reason = 'missing_price'
            url = f'https://shopee.co.th/product/{key}'
            if reason:
                rejected.append({'listing_id': key, 'title': item['title'], 'product_url': url,
                                 'reason': reason, 'note': exclusions.get(cid, {}).get(key, ''),
                                 'observed_at': item['observed_at']})
                continue
            flags = ['variant_unconfirmed', 'price_conditions_unconfirmed', 'listing_sales_scope']
            if item.get('price', {}).get('has_recommended_voucher'):
                flags.append('voucher_present')
            if key in vip:
                flags.append('vip_reference')
            if re.search(r'pre.?sale|pre.?order|พรีออเดอร์|ของเข้า', item['title'], re.I):
                flags.append('preorder')
            if 'แบ่งขาย' in item['title']:
                flags.append('repacked')
            eligible.append({
                'listing_id': key, 'shop_id': item['shop_id'], 'item_id': item['item_id'],
                'title': item['title'], 'shop_name': item.get('shop_name', ''),
                'product_url': url, 'source': 'shopee_plugin', 'observed_at': item['observed_at'],
                'price': {'amount': price, 'currency': 'THB', 'basis': 'displayed',
                          'raw': item['display_price'], 'scale': PRICE_SCALE,
                          'model_id': item.get('price', {}).get('model_id'), 'variant_verified': False},
                'vip_reference': vip.get(key),
                'sales': {'value': sold, 'raw': sales['historical_sold_count_text'],
                          'precision': 'provider_reported', 'period': 'unknown', 'scope': 'listing'},
                'review_flags': flags, 'queries': item['queries'],
            })
        eligible.sort(key=lambda i: (-i['sales']['value'], i['listing_id']))
        selected = eligible[:20]
        rank = 0
        for position, item in enumerate(selected, 1):
            if position == 1 or item['sales']['value'] != selected[position - 2]['sales']['value']:
                rank = position
            item['rank'] = rank
        observed = sorted(s['observed_at'] for s in searches if instant(s.get('observed_at')))
        output.append({**category, 'name': NEUTRAL_NAMES.get(cid, category['name']),
                       'target_count': 20, 'listing_count': len(selected),
                       'sample_count': len(candidates), 'eligible_count': len(eligible),
                       'excluded_count': len(rejected), 'shortfall': max(0, 20 - len(selected)),
                       'queries': list(dict.fromkeys(s['query'] for s in searches)),
                       'failed_queries': [s['query'] for s in searches if not s.get('success')],
                       'observed_from': observed[0] if observed else None,
                       'observed_to': observed[-1] if observed else None, 'items': selected})
        audit.append({'category_id': cid, 'excluded': rejected,
                      'below_cutoff': [{'listing_id': i['listing_id'], 'title': i['title'],
                                        'sales': i['sales']['value']} for i in eligible[20:]]})
    all_items = [i for cat in output for i in cat['items']]
    dates = sorted(i['observed_at'] for i in all_items)
    data = {'schema_version': 1, 'source': 'shopee_plugin', 'country': 'TH',
            'ranking_scope': 'collected_search_sample', 'ranking_unit': 'listing',
            'sales_period': 'unknown', 'price_ttl_hours': 48,
            'observed_from': dates[0] if dates else None, 'observed_to': dates[-1] if dates else None,
            'category_count': len(output), 'listing_count': len(all_items),
            'review_count': sum(bool(i['review_flags']) for i in all_items),
            'vip_reference_count': sum(bool(i['vip_reference']) for i in all_items),
            'reason_labels': REASONS, 'categories': output}
    return data, {'schema_version': 1, 'categories': audit}


def load_inputs(root=ROOT):
    categories = json.loads((root / 'data/shopee-ranking-categories.json').read_text())
    sources = sorted((root / 'data/research').glob('*/shopee-category-searches*.json'))
    snapshots = [s for path in sources for s in json.loads(path.read_text())]
    # Model searches collected earlier contribute candidates only to their catalog category.
    html = (root / 'index.html').read_text()
    catalog = json.loads(re.search(r'const CATEGORIES = (\[[\s\S]*?\n\s*\]);', html)[1])
    model_categories = {p['id']: c['id'] for c in catalog for p in c['products']}
    for path in sorted((root / 'data/research').glob('*/shopee-plugin-refresh.json')):
        sources.append(path)
        for s in json.loads(path.read_text()):
            if s.get('id') in model_categories:
                snapshots.append({**s, 'category_id': model_categories[s['id']]})
    manual_path = root / 'data/manual_overrides.json'
    review_path = root / 'data/shopee-ranking-exclusions.json'
    manual = json.loads(manual_path.read_text()) if manual_path.exists() else {}
    exclusions = json.loads(review_path.read_text()) if review_path.exists() else {}
    return categories, snapshots, manual, exclusions, sources


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify saved outputs match inputs without writing')
    args = parser.parse_args()
    categories, snapshots, manual, exclusions, sources = load_inputs()
    data, audit = build_rankings(categories, snapshots, manual, exclusions)
    data['source_files'] = [str(path.relative_to(ROOT)) for path in sources]
    audit['source_files'] = data['source_files']
    for name, value in [('shopee_rankings.json', data), ('shopee_ranking_review.json', audit)]:
        path = ROOT / 'data' / name
        text = json.dumps(value, ensure_ascii=False, indent=2) + '\n'
        if args.check:
            if not path.exists() or path.read_text() != text:
                raise SystemExit(f'Output out of date: {path}')
        else:
            path.write_text(text)
    print(json.dumps({'categories': data['category_count'], 'listings': data['listing_count'],
                      'vip_references': data['vip_reference_count'],
                      'shortfalls': {c['id']: c['shortfall'] for c in data['categories'] if c['shortfall']},
                      'excluded': sum(c['excluded_count'] for c in data['categories'])}))


if __name__ == '__main__':
    main()
