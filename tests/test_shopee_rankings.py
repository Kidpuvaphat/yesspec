import copy
import unittest
from datetime import datetime, timezone
from pathlib import Path

from build_shopee_rankings import baht, build_rankings, category_rejection, load_inputs

NOW = datetime(2026, 10, 20, tzinfo=timezone.utc)
CATEGORIES = [{'id': 'smartphone', 'name': 'มือถือ', 'icon': '📱'}]


def product(item='456', shop='123', sold=120, **kwargs):
    return {'title': 'Samsung Galaxy A07', 'shop_id': shop, 'item_id': item,
            'shop_name': 'Example', 'is_sold_out': False, 'display_price': 449900000,
            'price': {'model_id': '999', 'promotion_type': 502},
            'sales': {'historical_sold_count': sold, 'historical_sold_count_text': f'ขายแล้ว {sold} ชิ้น',
                      'monthly_sold_count': 5}, **kwargs}


def snapshot(items, at='2026-10-19T14:46:00Z', query='Samsung smartphone'):
    return {'category_id': 'smartphone', 'query': query, 'items': items, 'success': True,
            'country': 'TH', 'source': 'shopee_plugin', 'observed_at': at}


class ShopeeRankingTests(unittest.TestCase):
    def build(self, *snapshots, **kwargs):
        return build_rankings(CATEGORIES, snapshots, now=NOW, **kwargs)

    def test_price_unit_and_invalid_values(self):
        self.assertEqual(baht(449900000), 4499)
        self.assertEqual(baht(1234500), 12.35)
        for raw in [None, False, 'not a number', -1, 'NaN', 'Infinity', 0]:
            self.assertIsNone(baht(raw))

    def test_dedup_uses_latest_same_shop_and_item_never_sums_counts(self):
        data, _ = self.build(snapshot([product(sold=200)]),
                             snapshot([product(sold=190), product(shop='987', sold=50)],
                                      '2026-10-19T15:00:00Z', 'Samsung A07'))
        items = data['categories'][0]['items']
        self.assertEqual([i['sales']['value'] for i in items], [190, 50])
        self.assertEqual(items[0]['queries'], ['Samsung A07', 'Samsung smartphone'])
        self.assertEqual(items[0]['observed_at'], '2026-10-19T15:00:00Z')
        self.assertEqual(items[0]['product_url'], 'https://shopee.co.th/product/123/456')

    def test_unknown_and_negative_sales_are_not_zero(self):
        data, audit = self.build(snapshot([product('1', sold=None), product('2', sold=-1), product('3', sold=0)]))
        self.assertEqual([i['item_id'] for i in data['categories'][0]['items']], ['3'])
        self.assertEqual(len(audit['categories'][0]['excluded']), 2)

    def test_monthly_field_never_becomes_thirty_day_rank(self):
        data, _ = self.build(snapshot([product()]))
        sale = data['categories'][0]['items'][0]['sales']
        self.assertEqual(sale, {'value': 120, 'raw': 'ขายแล้ว 120 ชิ้น',
                               'precision': 'provider_reported', 'period': 'unknown', 'scope': 'listing'})

    def test_raw_display_contradiction_is_reviewed(self):
        p = product(sold=12)
        p['sales']['historical_sold_count_text'] = 'ขายแล้ว 1พัน+ ชิ้น'
        data, audit = self.build(snapshot([p]))
        self.assertEqual(data['listing_count'], 0)
        self.assertEqual(audit['categories'][0]['excluded'][0]['reason'], 'sales_inconsistent')

    def test_invalid_identity_future_time_missing_price_and_soldout_are_rejected(self):
        data, _ = self.build(snapshot([product(shop='123/../../evil'), product('2', display_price=None),
                                      product('3', is_sold_out=True)]),
                             snapshot([product('4')], '2027-01-01T00:00:00Z'))
        self.assertEqual(data['listing_count'], 0)

    def test_top_twenty_and_ties(self):
        products = [product(str(i + 1), sold=100 - i) for i in range(25)]
        products[1]['sales'] = copy.deepcopy(products[0]['sales'])
        data, audit = self.build(snapshot(products))
        items = data['categories'][0]['items']
        self.assertEqual(len(items), 20)
        self.assertEqual([i['rank'] for i in items[:3]], [1, 1, 3])
        self.assertEqual(len(audit['categories'][0]['below_cutoff']), 5)

    def test_vip_requires_same_shop_item_verified_evidence_never_promotion_code(self):
        reference = {'platform': 'shopee', 'shop_id': '123', 'item_id': '456',
                     'product_url': 'https://shopee.co.th/product/123/456',
                     'price_basis': 'member', 'confirmed_match': True, 'price_verified': True,
                     'candidate_price': 4299, 'variant': 'Black 128GB', 'observed_at': '2026-10-19T12:00:00Z'}
        data, _ = self.build(snapshot([product(), product(shop='987')]),
                             manual={'p': {'stores_sorted': [reference]}})
        items = data['categories'][0]['items']
        self.assertEqual(items[0]['vip_reference']['amount'], 4299)
        self.assertIsNone(items[1]['vip_reference'])
        self.assertEqual(items[0]['price']['amount'], 4499)
        self.assertEqual(items[0]['price']['basis'], 'displayed')
        self.assertFalse(items[0]['price']['variant_verified'])
        self.assertEqual(items[0]['vip_reference']['observed_at'], '2026-10-19T12:00:00Z')

    def test_category_filters_do_not_confuse_bundles_or_thai_unicode(self):
        for category, title in [('waterpurifier', 'STIEBEL ไส้กรอง สำหรับเครื่องกรองน้ำ'),
                                ('aircon', 'บานสวิงแอร์ LG'), ('headphone', 'เคส Bose QuietComfort'),
                                ('robot', 'หุ่นยนต์ทำความสะอาดกระจก WINBOT'),
                                ('tv', 'Toshiba TV Full HD'), ('chair', 'เก้าอี้พักผ่อน Cloudy')]:
            self.assertIsNotNone(category_rejection(category, title))
        for category, title in [('waterpurifier', 'Mazuma เครื่องกรองน้ำ แถมไส้กรอง'),
                                ('purifier', 'เครื่องฟอกอากาศ กรองควันบุหรี่มือสอง'),
                                ('speaker', 'JBL ลําโพง'), ('bodywash', 'ครีมอาบน้ํา'),
                                ('notebook', 'ASUS ExpertBook P3'), ('catfood', 'Kaniva อาหารเม็ดสำหรับเเมว')]:
            self.assertIsNone(category_rejection(category, title), title)

    @unittest.skipUnless(any((Path(__file__).parents[1]/'data/research').glob('*/shopee-category-searches*.json')),
                         'Local raw research snapshots are not published; exported datasets are tested separately')
    def test_current_dataset_has_32_complete_categories_and_evidence_for_every_row(self):
        cats, snapshots, manual, exclusions, _ = load_inputs()
        data, _ = build_rankings(cats, snapshots, manual, exclusions, now=NOW)
        self.assertEqual(data['category_count'], 32)
        self.assertEqual(data['listing_count'], 640)
        for cat in data['categories']:
            self.assertEqual(len(cat['items']), 20, cat['id'])
            self.assertEqual(len(set(i['listing_id'] for i in cat['items'])), 20)
            sales = [i['sales']['value'] for i in cat['items']]
            self.assertEqual(sales, sorted(sales, reverse=True))
            for item in cat['items']:
                self.assertEqual(item['product_url'], f"https://shopee.co.th/product/{item['shop_id']}/{item['item_id']}")
                self.assertTrue(item['observed_at'])
                self.assertGreater(item['price']['amount'], 0)
                self.assertIn('variant_unconfirmed', item['review_flags'])
                self.assertEqual(item['sales']['period'], 'unknown')


if __name__ == '__main__':
    unittest.main()
