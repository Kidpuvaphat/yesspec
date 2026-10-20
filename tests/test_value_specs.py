import json
import shutil
import tempfile
import unittest
from pathlib import Path
import ranking_offers as offers

ROOT = Path(__file__).resolve().parents[1]


class ValueSpecsTests(unittest.TestCase):
    def test_saved_specs_survive_price_edits_but_not_changed_source_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'data').mkdir()
            shutil.copy2(ROOT/'data/shopee_feed_rankings.json',root/'data/shopee_feed_rankings.json')
            def row():
                return offers.payload(root)['categories'][0]['items'][0]
            current = row()
            specs = dict(geekbench6_single=3000, geekbench6_multi=10000, ram_gb=12,
                         storage_gb=512,battery_mah=6000,refresh_hz=120,variant='12/512',
                         spec_url='https://www.samsung.com/th/smartphones/',
                         benchmark_url='https://browser.geekbench.com/v6/cpu/123456',verified=True)
            offers.save(root,[dict(listing_id=current['listing_id'],revision=current['revision'],value_specs=specs)])
            current=row()
            self.assertTrue(current['value_specs']['verified'])
            self.assertIsNotNone(current['value_specs']['checked_at'])
            before=current['value_specs']
            offers.save(root,[dict(listing_id=current['listing_id'],revision=current['revision'],
                offers={'shopee':dict(url='https://s.shopee.co.th/test',price=5000,variant='12/512')})])
            self.assertEqual(row()['value_specs'],before)
            self.assertEqual(row()['offers']['shopee']['price'],5000)
            data=json.loads((root/'data/shopee_feed_rankings.json').read_text())
            data['categories'][0]['items'][0]['title']+=' different model'
            (root/'data/shopee_feed_rankings.json').write_text(json.dumps(data))
            self.assertIsNone(row()['value_specs'])

    def test_incomplete_specs_can_be_saved_as_drafts_but_not_confirmed(self):
        self.assertFalse(offers.clean_value_specs({'ram_gb':'8'},'now')['verified'])
        for spec in [{'verified':True},{'ram_gb':'NaN'},{'ram_gb':True},
                     {'spec_url':'javascript:alert(1)'},
                     {'benchmark_url':'https://browser.geekbench.com.evil.test/v6/cpu/123'}]:
            with self.subTest(spec=spec),self.assertRaises(ValueError):
                offers.clean_value_specs(spec,'now')
