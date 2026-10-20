import json
import shutil
import tempfile
import unittest
from pathlib import Path
import ranking_offers as offers

ROOT = Path(__file__).resolve().parents[1]


class MobileCatalogTests(unittest.TestCase):
    def test_thirty_distinct_models_with_listing_evidence_and_all_budget_bands(self):
        data = json.loads((ROOT/'data/shopee_feed_rankings.json').read_text())
        candidates = {i['listing_id']: i for i in json.loads((ROOT/'data/mobile_candidate_evidence.json').read_text())['items']}
        self.assertEqual([c['id'] for c in data['categories']], ['smartphone'])
        rows = data['categories'][0]['items']
        self.assertEqual(len(rows), 30)
        self.assertEqual(len({i['display_name'].casefold() for i in rows}), 30)
        self.assertEqual(len({i['listing_id'] for i in rows}), 30)
        self.assertEqual(len({i['price_band'] for i in rows}), 6)
        self.assertEqual([i['sales']['value'] for i in rows], sorted([i['sales']['value'] for i in rows], reverse=True))
        for item in rows:
            source = candidates[item['listing_id']]
            self.assertEqual(item['sales'], source['sales'])
            self.assertEqual(item['sales']['period'], 'unknown')
            self.assertEqual(offers.binding(item), offers.binding(source))
            self.assertTrue(item['manual_price_only'])
            self.assertIsNone(offers.default_shopee(item)['price'])

    def test_saved_coupon_offer_survives_switch_from_all_categories_to_phones(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'data').mkdir()
            shutil.copy2(ROOT/'data/archive/shopee_feed_rankings-20261019.json', root/'data/shopee_feed_rankings.json')
            old = offers.payload(root)['categories'][0]['items'][0]
            offers.save(root, [{'listing_id':old['listing_id'], 'revision':old['revision'],
                'offers':{'shopee':{'url':'https://s.shopee.co.th/Lo9720VLk','price':6808,'price_type':'flash_sale'}}}])
            stored = (root/'data/ranking_manual_offers.json').read_bytes()
            shutil.copy2(ROOT/'data/shopee_feed_rankings.json', root/'data/shopee_feed_rankings.json')
            active = offers.payload(root)
            self.assertEqual(active['total'], 30)
            self.assertEqual(len(active['categories']), 1)
            row = next(i for i in active['categories'][0]['items'] if i['listing_id'] == old['listing_id'])
            self.assertEqual(row['title'], 'OPPO A6t Pro')
            self.assertEqual(row['offers']['shopee']['price'], 6808)
            self.assertEqual(row['offers']['shopee']['url'], 'https://s.shopee.co.th/Lo9720VLk')
            self.assertEqual(row['needs_review'], [])
            self.assertEqual((root/'data/ranking_manual_offers.json').read_bytes(), stored)
            archived = json.loads((ROOT/'data/archive/shopee_feed_rankings-20261019.json').read_text())['categories'][1]['items'][0]
            with self.assertRaises(ValueError):
                offers.save(root, [{'listing_id':archived['listing_id'],'offers':{}}])
