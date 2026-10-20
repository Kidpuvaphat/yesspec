import unittest

from build_shopee_feed_rankings import normalize_row, title_rejection, price_value


def row(**changes):
    return {'shopid':'1','itemid':'2','title':'Samsung Galaxy A07 Smartphone',
            'product_link':'https://shopee.co.th/product/1/2','item_sold':'321',
            'condition':'New','stock':'7','holiday_mode_on':'Off','sale_price':'3499',
            'price':'3999','model_ids':'5|6','model_names':'Black|Blue','model_prices':'3999|4199',
            **changes}


class FeedRankingTests(unittest.TestCase):
    def normalize(self, value):
        return normalize_row(value, 'smartphone', '2026-10-19T16:00:00Z', {}, {})

    def test_feed_money_uses_baht_and_sales_period_remains_unknown(self):
        p,reason = self.normalize(row())
        self.assertIsNone(reason)
        self.assertEqual(p['price']['amount'],3499)
        self.assertEqual(p['sales']['value'],321)
        self.assertEqual(p['sales']['period'],'unknown')
        self.assertIsNone(p['price_observed_at'])
        self.assertFalse(p['price']['variant_verified'])
        self.assertIsNone(p['vip_reference'])

    def test_missing_count_is_not_zero_and_stock_holiday_condition_are_checked(self):
        for change,reason in [({'item_sold':''},'missing_sales'),({'stock':'0'},'sold_out'),
                              ({'holiday_mode_on':'On'},'shop_on_holiday'),({'condition':'Used'},'used_or_subscription')]:
            self.assertEqual(self.normalize(row(**change))[1],reason)
        self.assertEqual(self.normalize(row(item_sold='0'))[0]['sales']['value'],0)

    def test_cross_shop_or_unsafe_source_link_is_rejected(self):
        for url in ['https://shopee.co.th/product/99/2','https://example.com/product/1/2','javascript:alert(1)']:
            self.assertEqual(self.normalize(row(product_link=url))[1],'source_link_mismatch')

    def test_unaligned_models_do_not_get_paired_or_assigned_sale_price(self):
        p,_=self.normalize(row(model_names='Black'))
        self.assertIn('model_fields_unaligned',p['review_flags'])
        self.assertEqual(p['price']['model_examples'],[])

    def test_category_specific_false_positives_are_excluded(self):
        for cid,title in [('washer','GEESO ฐานรองเครื่องซักผ้า'),('robot','น้ำยาสำหรับหุ่นยนต์ดูดฝุ่น'),
                          ('airfryer','กระดาษรองหม้อทอดไร้น้ำมัน'),('purifier','Xiaomi Air Purifier Filter'),
                          ('headphone','หูฟังมีสาย ตัดเสียงรบกวน ENC'),('camera','กล้องมองหลังรถยนต์'),
                          ('vitamin','น้ำมันปลา vitamin E'),('smartphone','โทรศัพท์มือถือปุ่มกด')]:
            self.assertIsNotNone(title_rejection(cid,title),(cid,title))
        self.assertIsNone(title_rejection('headphone','Soundcore R50i NC หูฟัง ANC'))

    def test_nonfinite_price_is_rejected(self):
        for value in ['NaN','Infinity','1e999','-10','0','']:
            self.assertIsNone(price_value(value))

    def test_headphone_straps_are_accessories_not_airpods_pro_headphones(self):
        title = 'สายคล้องหูฟัง แบบ แม่เหล็ก Airpods 1 2 3, Airpods Pro, Huawei สาย สายคล้อง กันหาย - Strap for Airpod Silicone Anti-Lost'
        self.assertEqual(title_rejection('headphone', title), 'accessory')
        self.assertIsNone(title_rejection('headphone', 'หูฟัง ANC แถมสายคล้องหูฟัง'))

    def test_missing_price_stays_blank_without_removing_known_sales(self):
        for value in ['', 'NaN', '0']:
            item, reason = self.normalize(row(sale_price=value))
            self.assertIsNone(reason)
            self.assertIsNone(item['price']['amount'])
            self.assertEqual(item['sales']['value'], 321)
            self.assertIn('missing_price', item['review_flags'])


if __name__ == '__main__':
    unittest.main()
