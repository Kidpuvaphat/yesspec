const test = require('node:test');
const assert = require('node:assert/strict');
const {resolve,attach} = require('../assets/official-specs.js');
const {listingHTML} = require('../assets/shopee-ranking.js');
const {prepareDataset} = require('../assets/category-top20.js');
const RankingData = require('../assets/ranking-data.js');
const feed = require('../data/archive/shopee_feed_rankings-20261019.json');
const registry = require('../data/official_product_specs.json');
const clone = value=>JSON.parse(JSON.stringify(value));
const iphone = feed.categories[0].items.find(item=>item.listing_id==='301786571/40268308729');

test('eight manually matched models have official sources; all remaining listings keep blank specs', () => {
  const data = attach(feed,registry);
  assert.deepEqual(data.official_spec_coverage,{verified:8,pending:632,total:640,registry_available:true});
  const rows=data.categories.flatMap(c=>c.items);
  for (const item of rows) {
    const before=feed.categories.flatMap(c=>c.items).find(row=>row.listing_id===item.listing_id);
    assert.deepEqual(item.price,before.price);
    assert.deepEqual(item.sales,before.sales);
    assert.equal(item.rank,before.rank);
    const rendered=listingHTML(item,feed.reason_labels);
    assert.match(rendered,item.official_specs ? /data-official-status="verified"/ : /data-official-status="pending"/);
  }
  assert.equal(feed.categories[0].items[0].official_specs,undefined);
});

test('changed listing title/options and a different data source cannot inherit a similar model', () => {
  assert.ok(resolve(iphone,registry));
  assert.equal(resolve({...iphone,title:iphone.title.replace('17 Pro','17 Pro Max')},registry),null);
  assert.equal(resolve({...iphone,source:'shopee_plugin'},registry),null);
  assert.equal(resolve({...iphone,listing_id:'999/999'},registry),null);
  assert.equal(resolve({...iphone,shop_id:'999'},registry),null);
  assert.equal(resolve({...iphone,product_url:'https://shopee.co.th/product/999/999'},registry),null);
  const changed=clone(iphone);
  changed.price.model_examples[0].name='Other model';
  assert.equal(resolve(changed,registry),null);
  const moreOptions=clone(iphone);
  moreOptions.price.model_count++;
  assert.equal(resolve(moreOptions,registry),null);
});

test('official specification fields do not select a storage option or confirm seller warranty', () => {
  const specs=resolve(iphone,registry);
  assert.equal(specs.selected_variant,null);
  assert.equal(specs.seller_warranty,null);
  const html=listingHTML({...iphone,official_specs:specs},feed.reason_labels);
  assert.match(html,/A19 Pro/);
  assert.match(html,/https:\/\/support.apple.com\/th-th\/125090/);
  assert.match(html,/ตัวเลือกที่ตรงกับราคา<\/dt><dd aria-label="ยังไม่มีข้อมูลยืนยัน">—/);
  assert.doesNotMatch(html,/256GB|512GB|1TB/);
});

test('nonofficial, wrong-brand and undated sources cannot supply verified specs', () => {
  for (const mutate of [s=>s.url='https://example.com/official',s=>s.url='https://support.apple.com.evil.test/specs',s=>s.url='https://www.lg.com/specs',s=>s.url='javascript:alert(1)',s=>s.checked_at=null]) {
    const bad=clone(registry); mutate(bad.models['apple-iphone-17-pro'].source);
    assert.equal(resolve(iphone,bad),null);
  }
});

test('missing fields and seller prices are never backfilled from other official fields', () => {
  const partial=clone(registry);
  partial.models['apple-iphone-17-pro'].fields=[
    {key:'chip',label:'ชิป',value:'A19 Pro',status:'verified'},
    {key:'weight',label:'น้ำหนัก',value:null,status:'verified'},
    {key:'power',label:'กำลังไฟ',value:'500W',status:'pending'},
    {key:'price',label:'ราคา',value:'999',status:'verified'}];
  const specs=resolve(iphone,partial);
  assert.equal(specs.fields.length,1);
  const html=listingHTML({...iphone,price:{amount:null},official_specs:specs},{});
  assert.match(html,/class="metric-value price-pending">ยังไม่บันทึกราคา<\/div>/);
  assert.doesNotMatch(html,/฿0|฿999|500W/);
});

test('missing prices, sales, model counts and timestamps render a dash rather than zero or NaN', () => {
  for (const amount of [null,undefined,NaN,0,-1,'']) {
    const html=listingHTML({...iphone,price:{amount},sales:{value:null},observed_at:null,vip_reference:{amount:0}},{});
    assert.match(html,/ยังไม่มีข้อมูลราคายืนยัน/);
    assert.match(html,/ตัวเลือกในฟีด — ตัวเลือก/);
    assert.doesNotMatch(html,/฿0|NaN|Invalid Date|เคยตรวจราคา VIP|class="metric-value">0<\/div>/);
  }
  assert.match(listingHTML({...iphone,sales:{value:0,raw:'item_sold: 0'}},{}),/class="metric-value">0<\/div>/);
});

test('a missing price preserves the item and its sales rank in the main Top 20', () => {
  const data=clone(feed);
  data.categories[0].items[0].price=null;
  const prepared=prepareDataset(data);
  assert.equal(prepared.categories[0].items.length,20);
  assert.equal(prepared.categories[0].items[0].rank,1);
  assert.equal(prepared.categories[0].items[0].price.amount,null);
});

test('a failed optional official registry leaves all 640 sales rankings usable', async () => {
  const {load}=RankingData.create({fetcher:async path=>{
    if (path==='/data/official_product_specs.json') throw new Error('offline');
    return {ok:true,json:async()=>feed};
  }});
  const {dataset:data}=await load();
  assert.equal(data.categories.length,32);
  assert.equal(data.official_spec_coverage.verified,0);
  assert.equal(data.official_spec_coverage.pending,640);
  assert.equal(data.official_spec_coverage.registry_available,false);
});

test('untrusted specification text is escaped in both labels and values', () => {
  const specs=resolve(iphone,registry);
  specs.fields[0]={label:'<script>bad</script>',value:'<img src=x onerror=bad()>'};
  const html=listingHTML({...iphone,official_specs:specs},{});
  assert.doesNotMatch(html,/<script>|<img/);
  assert.match(html,/&lt;script&gt;/);
});
