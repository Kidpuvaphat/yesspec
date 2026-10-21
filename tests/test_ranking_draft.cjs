const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../assets/ranking-draft.js');
const R = require('../assets/ranking-offers.js');

// Synthetic editor inputs only; no test writes runtime or production data.
const platforms = Object.keys(R.names);
const urls = {
  shopee: 'https://s.shopee.co.th/CartA?share_channel_code=keep&af_siteid=mine',
  lazada: 'https://s.lazada.co.th/s.CartB?cc=affiliate&sub_id=keep',
  tiktok: 'https://vt.tiktok.com/CartC/?affiliate_id=mine&share=keep'
};
const resolved = {
  shopee: 'https://shopee.co.th/product/12/34',
  lazada: 'https://www.lazada.co.th/products/example-i34.html',
  tiktok: 'https://shop.tiktok.com/view/product/34'
};
const confirmation = {matched: true, price_type: 'vip', variant: '8/128GB', note: 'สมาชิก'};
function fixture() {
  const checked_at = new Date(Date.now() - 60000).toISOString();
  const offers = Object.fromEntries(platforms.map((platform, index) => [platform, {
    url: urls[platform], price: 9000 + index, price_type: 'coupon', variant: '8/128GB', note: 'คูปองเดิม',
    source: 'manual', recorded_at: checked_at,
    price_lookup: {requested_url: urls[platform], resolved_url: resolved[platform], amount: 9000 + index,
      checked_at, confirmed: true}
  }]));
  return {
    listing_id: '12/34', title: 'Synthetic phone', revision: 'original-revision', offers,
    reference_price: {price: 6808, variant: '8/128GB', note: 'ราคาที่พบ', source: 'manual_reference', recorded_at: checked_at},
    feed_offer: {url: 'https://shopee.co.th/product/12/34', price: null, price_type: 'coupon', variant: '', note: ''},
    value_specs: {geekbench6_single: null, geekbench6_multi: null, ram_gb: 8, storage_gb: 128,
      battery_mah: 5000, refresh_hz: 120, variant: '8/128GB', spec_url: 'https://www.oppo.com/th/',
      benchmark_url: '', verified: true, checked_at},
    value_specs_source: 'research',
    spec_research: {memory_options: [
      {ram_gb: 8, storage_gb: 128, label: '8/128GB'},
      {ram_gb: 12, storage_gb: 256, label: '12/256GB'}
    ]}
  };
}
function result(context, amount = 7000) {
  return {platform: context.platform, status: 'candidates_found', requested_url: context.offer.url,
    resolved_url: resolved[context.platform], checked_at: new Date(Date.now() - 1000).toISOString(),
    candidates: [{amount, currency: 'THB'}]};
}
function offerEdit(draft, field, value, platform = 'shopee') {
  return draft.change({type: 'offer', platform, field, value});
}
function assertNoOtherChanges(patch, platform) {
  assert.deepEqual(Object.keys(patch.offers || {}), [platform]);
  assert.equal(Object.hasOwn(patch, 'reference_price'), false);
  assert.equal(Object.hasOwn(patch, 'value_specs'), false);
}

test('opening an editor preserves all three affiliate URLs and leaves the saved row and patch untouched', () => {
  const row = fixture(), original = structuredClone(row), draft = D.create(row);
  assert.equal(draft.changes(), null);
  assert.equal(draft.prepare(), null);
  for (const platform of platforms) {
    assert.equal(R.validURL(urls[platform], platform), urls[platform]);
    assert.equal(draft.view().offers[platform].url, urls[platform]);
    assert.equal(draft.view().offers[platform].price, String(row.offers[platform].price));
    assert.deepEqual(draft.view().offers[platform].price_lookup, row.offers[platform].price_lookup);
  }
  assert.equal(draft.view().reference_price.price, '6808');
  assert.deepEqual(row, original);
});

test('views, patches and lookup contexts cannot mutate the draft or its baseline by reference', () => {
  const row = fixture(), draft = D.create(row);
  const view = draft.view();
  view.offers.shopee.url = 'https://s.shopee.co.th/unwanted';
  view.offers.shopee.price_lookup.amount = 1;
  view.reference_price.price = '1'; view.value_specs.verified = false;
  row.offers.lazada.price = 1; row.value_specs.ram_gb = 1;
  assert.equal(draft.changes(), null);
  assert.equal(draft.view().offers.lazada.price, '9001');
  assert.equal(draft.view().value_specs.ram_gb, '8');
  offerEdit(draft, 'price', '7500');
  const patch = draft.changes(); patch.offers.shopee.price = '1'; patch.reset?.push('lazada');
  assert.equal(draft.changes().offers.shopee.price, '7500');
  assert.deepEqual(draft.changes().reset || [], []);
  const context = draft.beginCheck('shopee'); context.offer.price = '1';
  assert.equal(draft.view().offers.shopee.price, '7500');
});

test('a cart price edit submits only that channel with the original revision and clears its old lookup', () => {
  const draft = D.create(fixture()), before = draft.view();
  offerEdit(draft, 'price', '8000', 'lazada');
  const patch = draft.prepare();
  assert.equal(patch.listing_id, '12/34'); assert.equal(patch.revision, 'original-revision');
  assertNoOtherChanges(patch, 'lazada');
  assert.equal(patch.offers.lazada.price, '8000'); assert.equal(patch.offers.lazada.url, urls.lazada);
  assert.equal(patch.offers.lazada.price_lookup, null);
  assert.deepEqual(draft.view().offers.shopee, before.offers.shopee);
  assert.deepEqual(draft.view().offers.tiktok, before.offers.tiktok);
  assert.deepEqual(draft.view().reference_price, before.reference_price);
});

test('changing a cart URL clears only that cart price, conditions and lookup while preserving reference price', () => {
  for (const platform of platforms) {
    const draft = D.create(fixture()), before = draft.view(), url = urls[platform] + '&new=1';
    const changed = offerEdit(draft, 'url', url, platform);
    assert.equal(changed.cartChanged, true);
    const offer = draft.view().offers[platform];
    assert.equal(offer.url, url); assert.equal(offer.price, ''); assert.equal(offer.variant, '');
    assert.equal(offer.note, ''); assert.equal(offer.price_type, 'regular'); assert.equal(offer.price_lookup, null);
    assert.deepEqual(draft.view().reference_price, before.reference_price);
    assert.deepEqual(draft.view().value_specs, before.value_specs);
    for (const other of platforms.filter(p => p !== platform)) assert.deepEqual(draft.view().offers[other], before.offers[other]);
    assertNoOtherChanges(draft.prepare(), platform);
  }
});

test('manual changes to price type, variant or note invalidate the old lookup without altering affiliate URL', () => {
  for (const [field, value] of [['price_type', 'flash_sale'], ['variant', '12/256GB'], ['note', 'เงื่อนไขใหม่']]) {
    const draft = D.create(fixture());
    offerEdit(draft, field, value);
    assert.equal(draft.view().offers.shopee.url, urls.shopee);
    assert.equal(draft.view().offers.shopee.price_lookup, null);
    assert.equal(draft.view().offers.shopee[field], value);
  }
});

test('clearing and restoring a cart remain explicit separate save operations and do not change reference price', () => {
  const draft = D.create(fixture()), reference = draft.view().reference_price;
  draft.change({type: 'clear-offer', platform: 'shopee'});
  const cleared = draft.prepare();
  assertNoOtherChanges(cleared, 'shopee'); assert.equal(cleared.offers.shopee.url, '');
  assert.equal(cleared.offers.shopee.price, ''); assert.deepEqual(cleared.reset || [], []);
  draft.change({type: 'reset-offer', platform: 'shopee'});
  assert.equal(draft.view().offers.shopee.url, 'https://shopee.co.th/product/12/34');
  assert.equal(draft.view().offers.shopee.price, '');
  const reset = draft.prepare();
  assert.deepEqual(reset.reset, ['shopee']); assert.equal(Object.hasOwn(reset.offers || {}, 'shopee'), false);
  assert.deepEqual(draft.view().reference_price, reference);
  offerEdit(draft, 'price', '1000');
  assert.deepEqual(draft.prepare().reset || [], []);
  assert.equal(draft.prepare().offers.shopee.price, '1000');
});

test('reconfirming a price submits the existing value only when requested and drops stale lookup provenance', () => {
  const draft = D.create(fixture());
  draft.change({type: 'reconfirm-offer', platform: 'tiktok'});
  assertNoOtherChanges(draft.prepare(), 'tiktok');
  assert.equal(draft.prepare().offers.tiktok.price, '9002');
  assert.equal(draft.prepare().offers.tiktok.price_lookup, null);
  const reference = D.create(fixture());
  reference.change({type: 'reconfirm-reference'});
  assert.equal(reference.prepare().reference_price.price, '6808');
  assert.deepEqual(reference.prepare().offers || {}, {});
  assert.equal(Object.hasOwn(reference.prepare(), 'value_specs'), false);
});

test('reference-only editing or clearing never copies research into a manual override or changes saved carts', () => {
  const draft = D.create(fixture()), before = draft.view();
  draft.change({type: 'reference', field: 'price', value: '6000'});
  let patch = draft.prepare();
  assert.equal(patch.reference_price.price, '6000'); assert.deepEqual(patch.offers || {}, {});
  assert.equal(Object.hasOwn(patch, 'value_specs'), false);
  draft.change({type: 'clear-reference'});
  patch = draft.prepare(); assert.equal(patch.reference_price.price, '');
  assert.equal(patch.reference_price.note, '');
  assert.deepEqual(draft.view().offers, before.offers);
  assert.deepEqual(draft.view().value_specs, before.value_specs);
});

test('changing official memory options or individual specs requires confirmation again without rewriting an existing price variant', () => {
  const draft = D.create(fixture()), reference = draft.view().reference_price;
  draft.change({type: 'memory', index: 1});
  const specs = draft.view().value_specs;
  assert.equal(specs.ram_gb, '12'); assert.equal(specs.storage_gb, '256');
  assert.equal(specs.variant, '12/256GB'); assert.equal(specs.verified, false);
  assert.deepEqual(draft.view().reference_price, reference);
  assert.equal(Object.hasOwn(draft.prepare(), 'reference_price'), false);
  draft.change({type: 'spec', field: 'verified', value: true});
  assert.equal(draft.view().value_specs.verified, true);
  draft.change({type: 'spec', field: 'battery_mah', value: '6000'});
  assert.equal(draft.view().value_specs.verified, false);
  const row = fixture(); row.reference_price = null;
  const empty = D.create(row); empty.change({type: 'memory', index: 1});
  assert.equal(empty.view().reference_price.price, '');
  assert.equal(empty.view().reference_price.variant, '12/256GB');
});

test('prepare validates changed prices and cart URLs without discarding the draft or touching the original row', () => {
  for (const [type, field, value] of [
    ['reference', 'price', '0'], ['reference', 'price', '-1'], ['reference', 'price', 'NaN'],
    ['reference', 'price', '100000001'], ['offer', 'price', '0'], ['offer', 'price', '-1'],
    ['offer', 'price', 'Infinity'], ['offer', 'price', '100000001'],
    ['offer', 'url', 'https://shopee.co.th.evil.test/product/12/34']
  ]) {
    const row = fixture(), original = structuredClone(row), draft = D.create(row);
    draft.change({type, field, value, ...(type === 'offer' ? {platform: 'shopee'} : {})});
    const before = draft.view();
    assert.throws(() => draft.prepare(), error => error instanceof Error && /[ก-๙]/.test(error.message), `${type}:${value}`);
    assert.deepEqual(draft.view(), before); assert.ok(draft.changes()); assert.deepEqual(row, original);
  }
  for (const type of ['reference', 'offer']) {
    const draft = D.create(fixture());
    draft.change({type, field: 'price', value: '', ...(type === 'offer' ? {platform: 'shopee'} : {})});
    assert.doesNotThrow(() => draft.prepare());
  }
});

test('an explicitly confirmed THB result changes only the draft cart and preserves the exact affiliate URL', () => {
  for (const platform of platforms) {
    const row = fixture(), original = structuredClone(row), draft = D.create(row), reference = draft.view().reference_price;
    const context = draft.beginCheck(platform);
    assert.equal(context.listing_id, row.listing_id); assert.equal(context.revision, row.revision);
    assert.equal(draft.changes(), null);
    const found = result(context);
    assert.equal(draft.confirmCheck(context, found, 0, confirmation), true);
    const patch = draft.prepare(); assertNoOtherChanges(patch, platform);
    assert.equal(patch.offers[platform].price, '7000'); assert.equal(patch.offers[platform].url, urls[platform]);
    assert.equal(patch.offers[platform].price_type, 'vip');
    assert.deepEqual(patch.offers[platform].price_lookup, {
      requested_url: urls[platform], resolved_url: resolved[platform], amount: 7000,
      checked_at: found.checked_at, confirmed: true
    });
    assert.deepEqual(draft.view().reference_price, reference); assert.deepEqual(row, original);
    assert.equal(draft.confirmCheck(context, found, 0, confirmation), false, 'one result cannot be replayed');
  }
});

test('price checks require explicit confirmation, a concrete THB choice, valid timestamp and matching platform URLs', () => {
  const invalid = [
    (found, confirm) => { confirm.matched = false; },
    (found, confirm) => { confirm.price_type = ''; },
    found => { found.status = 'range_only'; },
    found => { found.platform = 'tiktok'; },
    found => { found.requested_url += '&different=1'; },
    found => { found.resolved_url = 'https://evil.test/product/34'; },
    found => { found.resolved_url = resolved.lazada; },
    found => { found.checked_at = 'invalid'; },
    found => { found.candidates = []; },
    found => { found.candidates[0].currency = 'USD'; },
    found => { found.candidates[0].amount = 0; },
    found => { found.candidates[0].amount = NaN; }
  ];
  for (const mutate of invalid) {
    const draft = D.create(fixture()), context = draft.beginCheck('shopee'), found = result(context), confirm = {...confirmation};
    mutate(found, confirm);
    assert.equal(draft.confirmCheck(context, found, 0, confirm), false);
    assert.equal(draft.changes(), null);
  }
  const draft = D.create(fixture()), context = draft.beginCheck('shopee');
  assert.equal(draft.confirmCheck(context, result(context), 99, confirmation), false);
  assert.equal(draft.changes(), null);
});

test('any edit invalidates an earlier check including edit-then-undo, another field and official memory selection', () => {
  for (const edit of [
    draft => { offerEdit(draft, 'url', urls.shopee + '&new=1'); offerEdit(draft, 'url', urls.shopee); },
    draft => { offerEdit(draft, 'price', '1'); offerEdit(draft, 'price', '9000'); },
    draft => { draft.change({type: 'reference', field: 'note', value: 'new note'}); },
    draft => { draft.change({type: 'memory', index: 1}); },
    draft => { draft.change({type: 'spec', field: 'ram_gb', value: '12'}); },
    draft => { draft.change({type: 'clear-offer', platform: 'lazada'}); }
  ]) {
    const draft = D.create(fixture()), context = draft.beginCheck('shopee'), found = result(context);
    edit(draft); const before = draft.view();
    assert.equal(draft.confirmCheck(context, found, 0, confirmation), false);
    assert.deepEqual(draft.view(), before);
  }
});

test('a newer lookup or a new editor instance rejects an old result even when the visible data matches', () => {
  const row = fixture(), draft = D.create(row), first = draft.beginCheck('shopee'), second = draft.beginCheck('shopee');
  assert.equal(draft.confirmCheck(first, result(first), 0, confirmation), false);
  assert.equal(draft.confirmCheck(second, result(second), 0, confirmation), true);
  const newInstance = D.create(row);
  assert.equal(newInstance.confirmCheck(second, result(second), 0, confirmation), false);
  assert.equal(newInstance.changes(), null);
  const changedRevision = D.create({...row, revision: 'new-revision'});
  assert.equal(changedRevision.confirmCheck(first, result(first), 0, confirmation), false);
  assert.equal(changedRevision.changes(), null);
});
