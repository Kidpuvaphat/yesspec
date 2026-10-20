import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlparse
import ranking_offers as offers

ROOT = Path(__file__).resolve().parents[1]
METRICS = ('geekbench6_single', 'geekbench6_multi', 'ram_gb', 'storage_gb', 'battery_mah', 'refresh_hz')


class MobileSpecResearchTests(unittest.TestCase):
    def test_thirty_bound_models_with_cited_facts_and_same_run_scores(self):
        rows = [i for c in offers.feed_categories(ROOT) for i in c['items']]
        research = json.loads((ROOT/'data/mobile_spec_research.json').read_text())['items']
        self.assertEqual(set(research), {r['listing_id'] for r in rows})
        self.assertEqual(len(rows), 30)
        self.assertEqual(sum(bool(r['benchmark']) for r in research.values()), 24)
        for row in rows:
            r = research[row['listing_id']]
            self.assertEqual(r['binding'], offers.binding(row))
            self.assertEqual(r['model'], row['display_name'])
            self.assertEqual(r, row['spec_research'])
            s = offers.researched_specs(row)
            for f in r['facts']:
                if f['value'] is not None:
                    self.assertEqual(urlparse(f['url']).scheme, 'https')
            b = r['benchmark']
            if b:
                self.assertTrue(b['version'].startswith('6.'))
                self.assertEqual(s['benchmark_url'], b['url'])
                self.assertEqual((s['geekbench6_single'], s['geekbench6_multi']), (b['single'], b['multi']))
            else:
                self.assertIsNone(s['geekbench6_single'])
                self.assertIsNone(s['geekbench6_multi'])
                self.assertEqual(s['benchmark_url'], '')
            if s['verified']:
                self.assertTrue(all(s[k] for k in METRICS))
            changed = copy.deepcopy(row)
            changed['title'] += ' changed model'
            self.assertIsNone(offers.researched_specs(changed))

    def test_manual_prices_and_specs_override_research_without_mutating_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'data').mkdir()
            shutil.copy2(ROOT/'data/shopee_feed_rankings.json', root/'data/shopee_feed_rankings.json')
            def current():
                return next(r for r in offers.payload(root)['categories'][0]['items'] if r['listing_id'] == '83276818/54207103990')
            row = current()
            original = copy.deepcopy(row['value_specs'])
            self.assertTrue(original['verified'])
            offers.save(root,[{'listing_id':row['listing_id'],'revision':row['revision'],'offers':{
                'shopee':{'url':'https://s.shopee.co.th/keepAffiliate','price':7000,'price_type':'coupon','variant':original['variant']}}}])
            self.assertEqual(current()['value_specs'], original)
            row = current()
            saved_offer = copy.deepcopy(row['offers']['shopee'])
            edited = {**original,'storage_gb':512,'verified':False}
            offers.save(root,[{'listing_id':row['listing_id'],'revision':row['revision'],'value_specs':edited}])
            self.assertEqual(current()['value_specs']['storage_gb'],512)
            self.assertEqual(current()['offers']['shopee'],saved_offer)
            self.assertEqual(current()['spec_research']['value_specs'],original)

    def test_unconfirmed_and_ambiguous_fields_stay_blank(self):
        rows = {i['display_name']:i for c in offers.feed_categories(ROOT) for i in c['items']}
        for name in ('Redmi A7','Redmi A7 Pro','realme P4x','realme C100x','vivo V80 Lite','OPPO A6t Pro'):
            self.assertIsNone(offers.researched_specs(rows[name])['geekbench6_single'])
        for name in ('Apple iPhone 16','Apple iPhone 17 Pro','MEIZU Mblu 21'):
            self.assertIsNone(offers.researched_specs(rows[name])['ram_gb'])
        self.assertFalse(offers.researched_specs(rows['Samsung Galaxy Z Fold8 Ultra'])['verified'])
        self.assertIsNone(offers.researched_specs(rows['POCO F9 Ultra'])['storage_gb'])
