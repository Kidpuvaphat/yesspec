#!/usr/bin/env python3
"""Import reviewed marketplace observations. Defaults to validation without writes."""
from __future__ import annotations
import argparse
import csv
import shutil
import tempfile
from pathlib import Path
import admin_server


def read_updates(path):
    grouped, seen = {}, set()
    with Path(path).open(encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            pid, pf = (row.get('product_id') or '').strip(), (row.get('platform') or '').strip()
            if not pid or pf not in ('shopee', 'lazada'):
                raise ValueError('แต่ละแถวต้องมี product_id และ platform = shopee/lazada')
            if (pid, pf) in seen:
                raise ValueError('พบสินค้ากับแพลตฟอร์มซ้ำ: ' + pid + '/' + pf)
            seen.add((pid, pf))
            confirmed = (row.get('confirmed') or '').strip().lower() == 'true'
            if confirmed and not row.get('observed_at'):
                raise ValueError('ข้อมูลยืนยันใน CSV ต้องระบุ observed_at พร้อมเขตเวลา')
            upd = grouped.setdefault(pid, {'id':pid})
            fields = {'product_url':'product_url', 'affiliate_url':'link', 'variant':'variant', 'price':'price',
                      'original_price':'orig_price', 'shop_name':'shop', 'sold_text':'sold_text',
                      'sold_period':'sold_period', 'sold_scope':'sold_scope', 'observed_at':'observed_at',
                      'price_basis':'price_basis', 'availability':'availability'}
            for column, field in fields.items():
                if column in row:
                    upd[pf + '_' + field] = row[column] or ''
            if not upd.get(pf + '_link'):
                upd[pf + '_link'] = row.get('product_url', '')
            upd[pf + '_confirmed'] = confirmed
    return list(grouped.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv_file', type=Path)
    parser.add_argument('--apply', action='store_true', help='บันทึกจริง; ค่าเริ่มต้นตรวจสอบอย่างเดียว')
    args = parser.parse_args()
    updates = read_updates(args.csv_file)
    if args.apply:
        result = admin_server.save_product_updates(updates)
    else:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'data').mkdir()
            shutil.copy2(admin_server.INDEX_PATH, root / 'index.html')
            for path in (admin_server.FEED_PATH, admin_server.OVERRIDES_PATH):
                if path.exists(): shutil.copy2(path, root / 'data' / path.name)
            admin_server.BASE_DIR = root
            admin_server.INDEX_PATH = root / 'index.html'
            admin_server.FEED_PATH = root / 'data/daily_prices_feed.json'
            admin_server.OVERRIDES_PATH = root / 'data/manual_overrides.json'
            result = admin_server.save_product_updates(updates)
    print(('Imported' if args.apply else 'Validated without saving') + f": {result['updated_count']} products")


if __name__ == '__main__': main()
