const test = require('node:test');
const assert = require('node:assert/strict');
const {prepareDataset, createController} = require('../assets/category-top20.js');
const offers = require('../assets/ranking-offers.js');
const {listingHTML} = require('../assets/shopee-ranking.js');
const feed = require('../data/shopee_feed_rankings.json');

test('the active phone catalog renders 30 models with empty coupon prices and preserves all source sales', () => {
  const data = offers.attach(prepareDataset(feed), {schema_version:1,items:{}});
  assert.deepEqual(data.categories.map(c=>c.id), ['smartphone']);
  assert.equal(data.categories[0].items.length, 30);
  assert.deepEqual(data.categories[0].items.map(i=>i.sales), feed.categories[0].items.map(i=>i.sales));
  for (const row of data.categories[0].items) {
    const html = listingHTML(row, data.reason_labels);
    assert.match(html, new RegExp(row.display_name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.match(html, /รอกรอกราคาหลังคูปอง/);
    assert.doesNotMatch(html, /฿[0-9]|ราคา sale_price ในฟีด/);
    assert.equal(row.purchase_offers[0].price, null);
  }
});

test('all six budget filters retain model identity and the rank from the complete selection', async () => {
  const elements = new Map();
  const doc = {getElementById(id) {
    if (!elements.has(id)) elements.set(id,{innerHTML:'',value:'',listeners:{},setAttribute(){},addEventListener(k,f){this.listeners[k]=f;}});
    return elements.get(id);
  }};
  const data = offers.attach(prepareDataset(feed),{schema_version:1,items:{}});
  const controller = createController(doc,async()=>data);
  await controller.show('smartphone');
  doc.getElementById('categoryTop20Sort').listeners.change({target:{value:'sales'}});
  for (const band of data.categories[0].price_bands) {
    doc.getElementById('categoryTop20Band').listeners.change({target:{value:band.id}});
    const html=doc.getElementById('categoryTop20Results').innerHTML;
    assert.equal((html.match(/<article /g)||[]).length,band.count);
    assert.deepEqual([...html.matchAll(/data-rank="(\d+)"/g)].map(m=>Number(m[1])),
      data.categories[0].items.filter(i=>i.price_band===band.id).map(i=>i.rank));
  }
  doc.getElementById('categoryTop20Band').listeners.change({target:{value:'all'}});
  controller.search('OPPO A6t Pro');
  assert.equal((doc.getElementById('categoryTop20Results').innerHTML.match(/<article /g)||[]).length,1);
  controller.search('');
  assert.equal(doc.getElementById('categoryTop20Count').textContent,'30 / 30 รายการ');
});
