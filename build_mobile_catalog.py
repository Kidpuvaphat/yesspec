"""Publish the reviewed, distinct-model phone selection; retain source evidence."""
import copy
import json
from pathlib import Path
from ranking_offers import binding

ROOT = Path(__file__).resolve().parent
BANDS = [
    ('under5000', 'ต่ำกว่า 5,000 บาท', 0, 5000),
    ('5000-9999', '5,000–9,999 บาท', 5000, 10000),
    ('10000-14999', '10,000–14,999 บาท', 10000, 15000),
    ('15000-24999', '15,000–24,999 บาท', 15000, 25000),
    ('25000-39999', '25,000–39,999 บาท', 25000, 40000),
    ('40000plus', '40,000 บาทขึ้นไป', 40000, float('inf')),
]


def build(root=ROOT):
    def read(name):
        return json.loads((root / 'data' / name).read_text())
    evidence = read('mobile_candidate_evidence.json')
    selection = read('mobile_selection.json')
    original = read('archive/shopee_feed_rankings-20261019.json')
    research_path = root / 'data/mobile_spec_research.json'
    research = read('mobile_spec_research.json')['items'] if research_path.exists() else {}
    assert evidence['source_sha256'] == original['source_sha256']
    candidates = {i['listing_id']: i for i in evidence['items']}
    chosen = selection['items']
    assert len(chosen) == 30
    assert len({i['listing_id'] for i in chosen}) == 30
    assert len({i['display_name'].casefold() for i in chosen}) == 30
    items = []
    for choice in chosen:
        item = copy.deepcopy(candidates[choice['listing_id']])
        assert item['sales']['value'] > 0 and item['sales']['period'] == 'unknown'
        band = next(b for b in BANDS if b[2] <= item['price']['amount'] < b[3])
        item.update(display_name=choice['display_name'], manual_price_only=True,
                    price_band=band[0], price_band_label=band[1])
        # Keep source title/options unchanged so saved affiliate offers remain bound.
        reviewed = research.get(item['listing_id'])
        if reviewed and reviewed['binding'] == binding(item) and reviewed['model'] == choice['display_name']:
            item['spec_research'] = copy.deepcopy(reviewed)
            item['researched_value_specs'] = copy.deepcopy(reviewed['value_specs'])
        items.append(item)
    items.sort(key=lambda i: (-i['sales']['value'], i['listing_id']))
    for n, item in enumerate(items, 1):
        item['rank'] = items[n-2]['rank'] if n > 1 and item['sales']['value'] == items[n-2]['sales']['value'] else n
    bands = [{'id': b[0], 'label': b[1],
              'count': sum(i['price_band'] == b[0] for i in items)} for b in BANDS]
    assert all(b['count'] for b in bands)
    category = copy.deepcopy(next(c for c in original['categories'] if c['id'] == 'smartphone'))
    category.update(items=items, target_count=30, listing_count=30, shortfall=0,
                    price_bands=bands, selection_method=selection['method'])
    data = {**original, 'catalog_mode': 'smartphone_30',
            'ranking_scope': 'curated_distinct_models_across_price_bands',
            'category_count': 1, 'listing_count': 30, 'review_count': 30,
            'vip_reference_count': sum(bool(i['vip_reference']) for i in items),
            'categories': [category]}
    review = read('archive/shopee_feed_review-20261019.json')
    review['categories'] = [c for c in review['categories'] if c['category_id'] == 'smartphone']
    for name, value in [('shopee_feed_rankings.json', data), ('shopee_feed_review.json', review)]:
        (root/'data'/name).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    return bands


if __name__ == '__main__':
    print(json.dumps(build(), ensure_ascii=False))
