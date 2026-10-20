const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {prepareDataset, createLoader, createController} = require('../assets/category-top20.js');
const affiliate = require('../assets/affiliate-links.js');
const feed = require('../data/shopee_feed_rankings.json');
const clone = value => JSON.parse(JSON.stringify(value));

function fakeDOM() {
  const elements = new Map();
  return {getElementById(id) {
    if (!elements.has(id)) elements.set(id, {innerHTML:'', textContent:'', value:'', disabled:false, attrs:{}, listeners:{},
      setAttribute(key, value) {this.attrs[key] = value;}, addEventListener(key, fn) {this.listeners[key] = fn;}});
    return elements.get(id);
  }};
}

test('every main-site category has exactly its feed Top 20, descending sales and owner affiliate links', async () => {
  const data = prepareDataset(feed);
  const html = fs.readFileSync('index.html','utf8');
  const catalog = JSON.parse(html.match(/const CATEGORIES\s*=\s*(\[[\s\S]*?\n    \]);/)[1]);
  assert.deepEqual(data.categories.map(c=>c.id).sort(), catalog.map(c=>c.id).sort());
  const doc = fakeDOM(), controller = createController(doc, async()=>data);
  let total = 0;
  for (const cat of data.categories) {
    await controller.show(cat.id);
    const rendered = doc.getElementById('categoryTop20Results').innerHTML;
    assert.equal(cat.items.length,20);
    assert.deepEqual(cat.items.map(i=>i.listing_id), feed.categories.find(c=>c.id===cat.id).items.map(i=>i.listing_id));
    assert.ok(cat.items.every((item,index)=>!index || cat.items[index-1].sales.value >= item.sales.value));
    assert.equal((rendered.match(/<article /g)||[]).length,20);
    for (const match of rendered.matchAll(/class="pdp-link" href="([^"]+)"/g)) {
      assert.ok(affiliate.isTracked(match[1].replaceAll('&amp;','&')));
      total++;
    }
    assert.match(rendered,/ไม่ระบุช่วงเวลา/);
    assert.match(rendered,/ราคา sale_price ในฟีด/);
    assert.equal(doc.getElementById('categoryTop20Count').textContent,'20 / 20 รายการ');
  }
  assert.equal(total,640);
});

test('selection caps at 20 after sorting, shares ranks for ties and never mutates input', () => {
  const data = clone(feed), cat = data.categories[0], original = clone(cat.items[0]);
  cat.items.push({...original, listing_id:'1/1',shop_id:'1',item_id:'1',product_url:'https://shopee.co.th/product/1/1',sales:{...original.sales,value:999999}});
  cat.items[0].sales.value = cat.items[1].sales.value;
  const before = JSON.stringify(data);
  const result = prepareDataset(data).categories[0];
  assert.equal(result.items.length,20);
  assert.equal(result.items[0].listing_id,'1/1');
  assert.equal(result.items[1].rank,result.items[2].rank);
  assert.equal(JSON.stringify(data),before);
});

test('search retains original ranks, clears to 20, and category switching resets the search', async () => {
  const doc = fakeDOM(), controller = createController(doc, async()=>prepareDataset(feed));
  await controller.show('washer');
  controller.search('LG');
  assert.equal(doc.getElementById('categoryTop20Count').textContent,'3 / 20 รายการ');
  const html = doc.getElementById('categoryTop20Results').innerHTML;
  assert.deepEqual([...html.matchAll(/data-rank="(\d+)"/g)].map(m=>Number(m[1])),[1,7,19]);
  controller.search('missing-product-xyz');
  assert.match(doc.getElementById('categoryTop20Results').innerHTML,/ไม่พบสินค้า/);
  doc.getElementById('categoryTop20Clear').listeners.click();
  assert.equal(doc.getElementById('categoryTop20Count').textContent,'20 / 20 รายการ');
  controller.search('LG');
  await controller.show('headphone');
  assert.equal(doc.getElementById('categoryTop20Search').value,'');
  assert.equal(doc.getElementById('categoryTop20Count').textContent,'20 / 20 รายการ');
});

test('the latest category wins when responses arrive out of order, including stale failures', async () => {
  const doc=fakeDOM(), requests=[];
  const controller=createController(doc,()=>new Promise((resolve,reject)=>requests.push({resolve,reject})));
  const first=controller.show('smartphone');
  const second=controller.show('washer');
  assert.equal(doc.getElementById('categoryTop20Search').disabled,true);
  requests[1].resolve(prepareDataset(feed)); await second;
  const content=doc.getElementById('categoryTop20Results').innerHTML;
  requests[0].reject(new Error('stale failure')); await first;
  assert.equal(doc.getElementById('categoryTop20Results').innerHTML,content);
  assert.match(doc.getElementById('categoryTop20Review').href,/#washer$/);
  assert.equal(doc.getElementById('categoryTop20Results').attrs['aria-busy'],'false');
});

test('load failure shows a retry instead of old products; retry recovers and loads only once', async () => {
  let calls=0;
  const load=createLoader(async(path,options)=>{
    assert.equal(options.cache,'no-store');
    if (path === 'data/official_product_specs.json') return {ok:true,json:async()=>require('../data/official_product_specs.json')};
    if (path === 'data/ranking_manual_offers.json') return {ok:true,json:async()=>({schema_version:1,items:{}})};
    calls++;
    assert.equal(path,'data/shopee_feed_rankings.json');
    return {ok:calls>1,json:async()=>feed};
  });
  const doc=fakeDOM(), controller=createController(doc,load);
  await controller.show('tablet');
  assert.match(doc.getElementById('categoryTop20Results').innerHTML,/ยังโหลดอันดับของหมวดนี้ไม่ได้/);
  assert.equal(doc.getElementById('categoryTop20Search').disabled,true);
  await doc.getElementById('categoryTop20Retry').onclick();
  assert.equal(doc.getElementById('categoryTop20Count').textContent,'20 / 20 รายการ');
  await controller.show('chair');
  assert.equal(calls,2);
});

test('missing category and invalid evidence never substitute a different category or source', async () => {
  const doc=fakeDOM(), controller=createController(doc,async()=>prepareDataset(feed));
  await controller.show('not-a-category');
  assert.match(doc.getElementById('categoryTop20Results').innerHTML,/ยังโหลดอันดับของหมวดนี้ไม่ได้/);
  for(const mutate of [d=>d.source='plugin',d=>d.sales_period='rolling_30d',d=>d.categories[0].items[0].product_url='https://example.com/',d=>d.categories[0].items[0].sales.value=null,d=>d.categories[0].items[0].sales.period='rolling_30d']) {
    const bad=clone(feed); mutate(bad); assert.throws(()=>prepareDataset(bad));
  }
});

test('shared card script exposes its API without starting the standalone ranking page on index', () => {
  const context={window:{document:{getElementById:()=>null},ShopeeAffiliate:affiliate}};
  vm.runInNewContext(fs.readFileSync('assets/shopee-ranking.js','utf8'),context);
  assert.equal(typeof context.window.ShopeeRanking.listingHTML,'function');
  assert.match(fs.readFileSync('index.html','utf8'),/ShopeeCategoryCatalog.show\(cat.id\)/);
});
