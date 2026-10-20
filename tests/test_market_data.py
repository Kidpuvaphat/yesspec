"""Regressions for fabricated prices, stale evidence and mismatched listings."""
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import admin_server as admin
import price_sync_mcp as sync


class MarketDataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'data').mkdir()
        self.index = self.root / 'index.html'
        self.index.write_text('const CATEGORIES = [\n {"id":"phone","name":"Phones","products":[{"id":"phone-a","name":"Phone A 128GB","price":9999}]}\n ];')
        self.feed = self.root / 'data/daily_prices_feed.json'
        self.feed.write_text(json.dumps({'items_by_id': {}, 'items': []}))
        self.overrides = self.root / 'data/manual_overrides.json'
        self.patches = [patch.object(admin, 'BASE_DIR', self.root), patch.object(admin, 'INDEX_PATH', self.index), patch.object(admin, 'FEED_PATH', self.feed), patch.object(admin, 'OVERRIDES_PATH', self.overrides)]
        for p in self.patches: p.start()
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(lambda: [p.stop() for p in self.patches])

    def save(self, **kwargs):
        admin.save_product_updates([{'id': 'phone-a', **kwargs}])
        return json.loads(self.feed.read_text())['items_by_id']['phone-a']

    def verified(self, **kwargs):
        return self.save(shopee_link='https://s.shopee.co.th/example',
                         shopee_product_url='https://shopee.co.th/product/123/456',
                         shopee_variant='128GB / เครื่องเปล่า', shopee_price=1234.50,
                         shopee_confirmed=True, **kwargs)

    def test_blank_lazada_price_is_not_copied_from_shopee(self):
        item = self.verified()
        lz = next(s for s in item['stores_sorted'] if s['platform'] == 'lazada')
        self.assertIsNone(lz['net_price'])
        self.assertEqual(item['cheapest_price'], 1234.50)

    def test_search_link_cannot_win_price_ranking(self):
        item = self.save(shopee_link='https://shopee.co.th/search?keyword=Phone', shopee_price=1)
        self.assertIsNone(item['cheapest_price'])

    def test_short_link_without_resolved_listing_is_unverified(self):
        item = self.save(shopee_link='https://s.shopee.co.th/example', shopee_price=100)
        self.assertIsNone(item['cheapest_price'])

    def test_raw_url_is_not_converted_to_made_up_affiliate_link(self):
        url = 'https://www.lazada.co.th/products/pdp-i123-s456.html?sku=456'
        self.assertEqual(admin.format_lazada_affiliate_link(url, 'phone-a'), url)
        sp = 'https://shopee.co.th/product/12/34?model_id=56'
        self.assertEqual(admin.format_shopee_affiliate_link(sp, 'phone-a'), sp)

    def test_reapply_does_not_refresh_observation_or_duplicate_history(self):
        item = self.verified()
        observed = item['stores_sorted'][0]['observed_at']
        history = self.root / 'data/market_observations.jsonl'
        before = history.read_text()
        admin.reapply_all_overrides()
        after = json.loads(self.feed.read_text())['items_by_id']['phone-a']
        self.assertEqual(after['stores_sorted'][0]['observed_at'], observed)
        self.assertEqual(history.read_text(), before)

    def test_edit_price_without_confirmation_invalidates_it(self):
        self.verified()
        item = self.save(shopee_price=5)
        self.assertIsNone(item['cheapest_price'])

    def test_sales_keep_lower_bound_and_platform_and_do_not_become_global_total(self):
        item = self.verified(shopee_sold_text='1.2 พัน+', shopee_sold_period='lifetime')
        sp = next(s for s in item['stores_sorted'] if s['platform'] == 'shopee')
        self.assertEqual(sp['sales']['value'], 1200)
        self.assertEqual(sp['sales']['precision'], 'lower_bound')
        self.assertEqual(sp['sales']['period'], 'lifetime')
        self.assertIsNone(item.get('sold_count'))

    def test_member_price_is_eligible_and_survives_sync_without_refreshing_evidence(self):
        item = self.verified(shopee_price_basis='member')
        sp = next(s for s in item['stores_sorted'] if s['platform'] == 'shopee')
        self.assertTrue(sp['ranking_eligible'])
        self.assertEqual(item['cheapest_price'], 1234.50)
        rebuilt = sync.run_daily_price_sync(silent=True, base_dir=self.root)['items_by_id']['phone-a']
        stored = next(s for s in rebuilt['stores_sorted'] if s['platform'] == 'shopee')
        self.assertEqual(stored['price_basis'], 'member')
        self.assertEqual(stored['observed_at'], sp['observed_at'])
        self.assertEqual(rebuilt['cheapest_price'], 1234.50)

    def test_invalid_host_rejected_before_writing(self):
        with self.assertRaises(ValueError):
            self.save(shopee_link='https://shopee.co.th.evil.example/product/1/2')
        self.assertFalse(self.overrides.exists())

    def test_conflicting_direct_listing_ids_rejected(self):
        with self.assertRaises(ValueError):
            self.save(shopee_link='https://shopee.co.th/product/123/999',
                      shopee_product_url='https://shopee.co.th/product/123/456',
                      shopee_variant='128GB', shopee_price=100, shopee_confirmed=True)

    def test_admin_does_not_prefill_unverified_price_as_current_price(self):
        products = admin.load_all_products_payload()['products']
        self.assertIsNone(products[0]['lazada']['price'])

    def test_renaming_model_invalidates_existing_observations(self):
        self.verified()
        item = self.save(name='Different Phone 512GB')
        self.assertIsNone(item['cheapest_price'])

    def test_admin_preserves_variant_mismatch_status(self):
        self.verified()
        self.save(lazada_link='https://www.lazada.co.th/products/pdp-i1-s2.html',
                  lazada_price=100, lazada_variant='256GB', lazada_confirmed=True)
        product = admin.load_all_products_payload()['products'][0]
        self.assertEqual(product['shopee']['status'], 'variant_mismatch')
        self.assertFalse(product['shopee']['ranking_eligible'])

    def test_mcp_sync_returns_result_without_stopping_stdio(self):
        import io
        original_sync = sync.run_daily_price_sync
        result = original_sync(silent=True, base_dir=self.root)
        request = json.dumps({'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'sync_all_prices'}}) + '\n'
        stdout = io.StringIO()
        with patch.object(sync, 'run_daily_price_sync', return_value=result), patch('sys.stdin', io.StringIO(request)), patch('sys.stdout', stdout):
            sync.run_mcp_stdio_server()
        self.assertEqual(json.loads(stdout.getvalue())['id'], 1)
        self.assertIn('result', json.loads(stdout.getvalue()))

    def test_mcp_read_drops_stale_price_without_rewriting_observation(self):
        import io
        item = self.verified()
        feed = json.loads(self.feed.read_text())
        feed['items_by_id']['phone-a']['stores_sorted'][0]['observed_at'] = '2020-01-01T00:00:00+00:00'
        feed['items'] = list(feed['items_by_id'].values())
        self.feed.write_text(json.dumps(feed))
        before = self.feed.read_text()
        request = json.dumps({'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'get_product_price','arguments':{'query':'phone-a'}}}) + '\n'
        stdout = io.StringIO()
        with patch.object(sync, '__file__', str(self.root / 'price_sync_mcp.py')), patch('sys.stdin', io.StringIO(request)), patch('sys.stdout', stdout):
            sync.run_mcp_stdio_server()
        result = json.loads(json.loads(stdout.getvalue())['result']['content'][0]['text'])
        self.assertIsNone(result[0]['cheapest_price'])
        self.assertEqual(self.feed.read_text(), before)


if __name__ == '__main__': unittest.main()

class FeedRulesTests(unittest.TestCase):
    def test_old_observation_expires_without_refreshing_timestamp(self):
        from market_data import rebuild_feed
        store = {'platform':'shopee', 'evidence_version':2, 'source':'manual', 'confirmed_match':True,
                 'link':'https://shopee.co.th/product/1/2', 'product_url':'https://shopee.co.th/product/1/2',
                 'variant':'128GB', 'candidate_price':999, 'observed_at':'2026-10-01T00:00:00+00:00', 'price_basis':'sku'}
        result = rebuild_feed({'items_by_id':{'p':{'id':'p','stores_sorted':[store]}}}, '2026-10-04T00:00:00+00:00')
        item = result['items_by_id']['p']
        self.assertIsNone(item['cheapest_price'])
        self.assertEqual(item['stores_sorted'][0]['observed_at'], '2026-10-01T00:00:00+00:00')

    def test_coupon_or_starting_price_cannot_win(self):
        from market_data import observe_manual
        for basis in ['coupon','starting']:
            s = observe_manual({'shopee_link':'https://shopee.co.th/product/1/2','shopee_price':1,
                                'shopee_variant':'128GB','shopee_confirmed':True,'shopee_price_basis':basis}, 'shopee', {})
            self.assertFalse(s['ranking_eligible'])
            self.assertIsNone(s['net_price'])

    def test_seo_does_not_publish_legacy_offer_prices(self):
        import generator
        product = {'id':'p','name':'Phone', 'offers':[{'price':12345,'url':'https://shopee.co.th/product/1/2','platform':'shopee','store':'S','seller':'S','coupon_text':'','perks':'','delivery':''}]}
        self.assertIsNone(generator.get_min_price(product))
        self.assertNotIn('12,345', generator.render_flights_offers_html(product, {}, 'x'))

class IdentityRulesTests(unittest.TestCase):
    def test_short_domains_cannot_claim_direct_product_paths(self):
        from market_data import identity
        self.assertEqual(identity('https://s.shopee.co.th/product/1/2', 'shopee'), {})

    def test_search_purchase_link_cannot_be_confirmed_using_unrelated_product_url(self):
        from market_data import observe_manual
        with self.assertRaises(ValueError):
            observe_manual({'shopee_link':'https://shopee.co.th/search?keyword=phone',
                            'shopee_product_url':'https://shopee.co.th/product/1/2','shopee_price':5,
                            'shopee_variant':'128GB','shopee_confirmed':True}, 'shopee', {})

    def test_different_variant_observations_are_not_compared(self):
        from market_data import observe_manual, rebuild_item
        sp = observe_manual({'shopee_link':'https://shopee.co.th/product/1/2','shopee_price':100,
                             'shopee_variant':'128GB','shopee_confirmed':True}, 'shopee', {})
        lz = observe_manual({'lazada_link':'https://www.lazada.co.th/products/pdp-i1-s2.html','lazada_price':50,
                             'lazada_variant':'256GB','lazada_confirmed':True}, 'lazada', {})
        item = rebuild_item({'id':'p','stores_sorted':[sp,lz]})
        self.assertIsNone(item['cheapest_price'])

class WrapperRulesTests(unittest.TestCase):
    def test_wrapped_search_url_cannot_win_as_direct_product(self):
        from market_data import observe_manual
        with self.assertRaises(ValueError):
            observe_manual({'shopee_link':'https://s.shopee.co.th/an_redir?origin_link=https%3A%2F%2Fshopee.co.th%2Fsearch%3Fkeyword%3Dx',
                            'shopee_product_url':'https://shopee.co.th/product/1/2','shopee_price':5,
                            'shopee_variant':'128GB','shopee_confirmed':True}, 'shopee', {})
