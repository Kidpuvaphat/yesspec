import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import ranking_offers as offers

ROOT = Path(__file__).resolve().parents[1]


class ReferencePriceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'data').mkdir()
        shutil.copy2(ROOT / 'data/shopee_feed_rankings.json', self.root / 'data/shopee_feed_rankings.json')

    def row(self):
        return offers.payload(self.root)['categories'][0]['items'][0]

    def save(self, **changes):
        row = self.row()
        offers.save(self.root, [dict(listing_id=row['listing_id'], revision=row['revision'], **changes)])

    def test_save_without_any_cart_preserves_price_when_carts_or_specs_change(self):
        self.save(reference_price=dict(price='6808', variant='8/128', note='คูปอง'),
                  offers={p: None for p in offers.PLATFORMS})
        before = self.row()['reference_price']
        self.assertEqual(before['price'], 6808)
        self.assertTrue(all(v is None for v in self.row()['offers'].values()))
        self.save(offers={'shopee': dict(url='https://s.shopee.co.th/OtherCart', price=9999)})
        self.assertEqual(self.row()['reference_price'], before)
        self.save(value_specs={'ram_gb': 8})
        self.assertEqual(self.row()['reference_price'], before)
        self.assertEqual(self.row()['offers']['shopee']['price'], 9999)
        self.save(offers={'shopee': None})
        self.assertEqual(self.row()['reference_price'], before)

    def test_clearing_only_reference_leaves_purchase_offer_intact(self):
        self.save(reference_price=dict(price=1000), offers={'shopee': dict(url='https://s.shopee.co.th/cart', price=2000)})
        before = self.row()['offers']
        self.save(reference_price={'price': ''})
        self.assertIsNone(self.row()['reference_price'])
        self.assertEqual(self.row()['offers'], before)

    def test_reference_price_does_not_follow_a_changed_source_model(self):
        self.save(reference_price=dict(price=6808))
        path = self.root / 'data/shopee_feed_rankings.json'
        feed = json.loads(path.read_text())
        feed['categories'][0]['items'][0]['title'] += ' different model'
        path.write_text(json.dumps(feed))
        self.assertIsNone(self.row()['reference_price'])
        self.save(offers={})
        self.assertIsNone(self.row()['reference_price'])

    def test_invalid_prices_do_not_overwrite_saved_data_and_stale_edits_conflict(self):
        self.save(reference_price=dict(price=6808))
        old = self.row()
        path = self.root / 'data/ranking_manual_offers.json'
        before = path.read_bytes()
        for value in [True, 0, -1, 'NaN', 'Infinity', 100000001, 0.001, {}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.save(reference_price=dict(price=value))
            self.assertEqual(path.read_bytes(), before)
        self.save(reference_price=dict(price=7000))
        with self.assertRaises(offers.ConflictError):
            offers.save(self.root, [dict(listing_id=old['listing_id'], revision=old['revision'],
                                        reference_price=dict(price=1))])

    def test_timestamp_is_server_owned_and_changes_only_when_price_is_submitted(self):
        with patch.object(offers, 'utc_now', return_value='2026-10-20T10:00:00Z'):
            self.save(reference_price=dict(price=6808, recorded_at='2099-01-01'))
        self.assertEqual(self.row()['reference_price']['recorded_at'], '2026-10-20T10:00:00Z')
        with patch.object(offers, 'utc_now', return_value='2026-10-20T11:00:00Z'):
            self.save(offers={})
            self.assertEqual(self.row()['reference_price']['recorded_at'], '2026-10-20T10:00:00Z')
            self.save(reference_price=dict(price=6808))
        self.assertEqual(self.row()['reference_price']['recorded_at'], '2026-10-20T11:00:00Z')
