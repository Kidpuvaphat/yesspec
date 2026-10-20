const test = require('node:test');
const assert = require('node:assert/strict');
const offers = require('../assets/ranking-offers.js');
const {createController,createLoader} = require('../assets/category-top20.js');
const feed = require('../data/shopee_feed_rankings.json');
const now = Date.parse('2026-10-20T10:00:00Z');
const specs = {
  geekbench6_single:3000,geekbench6_multi:10000,ram_gb:12,storage_gb:512,battery_mah:6000,refresh_hz:120,
  variant:'12GB / 512GB',spec_url:'https://www.samsung.com/th/smartphones/',
  benchmark_url:'https://browser.geekbench.com/v6/cpu/123456',
  verified:true,checked_at:new Date(now).toISOString()
};
function item(id, price, rank=1) {
  return {listing_id:id,rank,value_specs:{...specs},purchase_offers:[{
    platform:'shopee',url:'https://s.shopee.co.th/test',price,variant:specs.variant,
    source:'manual',recorded_at:new Date(now).toISOString()
  }]};
}
test('saved price changes recalculate spec/price scores, reverse ranks, and keep ties shared',()=>{
  const a=item('1/1',10000), b=item('1/2',20000,2);
  let rows=offers.orderItems([a,b],'value',now);
  assert.equal(rows[0].value_result.spec_score,100);
  assert.equal(rows[0].value_result.score,10);
  assert.deepEqual(rows.map(i=>i.rank),[1,2]);
  b.purchase_offers[0].price=5000;
  rows=offers.orderItems([a,b],'value',now);
  assert.equal(rows[0].listing_id,'1/2');
  assert.equal(rows[0].value_result.score,20);
  assert.equal(a.rank,1);assert.equal(b.rank,2); // Never rewrite source evidence.
  b.purchase_offers[0].price=10000;
  assert.deepEqual(offers.orderItems([a,b],'value',now).map(i=>i.rank),[1,1]);
  assert.deepEqual(offers.orderItems([a,b],'sales',now).map(i=>i.listing_id),['1/1','1/2']);
});
test('incomplete specs, wrong variants, missing carts, old or invalid prices never get value ranks',()=>{
  for(const change of [
    i=>{i.value_specs.verified=false;}, i=>{i.value_specs.ram_gb=null;},
    i=>{i.value_specs.benchmark_url='https://browser.geekbench.com/v5/cpu/123';},
    i=>{i.purchase_offers[0].variant='8GB / 128GB';}, i=>{i.purchase_offers[0].price=null;},
    i=>{i.purchase_offers[0].price=0;}, i=>{i.purchase_offers[0].url='https://evil.test/';},
    i=>{i.purchase_offers[0].recorded_at='2026-10-17T10:00:00Z';},
    i=>{i.purchase_offers[0].recorded_at='2026-10-21T10:00:00Z';},
    i=>{i.purchase_offers[0].source='shopee_affiliate_csv';}
  ]) {
    const row=item('1/1',10000);change(row);
    assert.equal(offers.orderItems([row],'value',now)[0].rank,null);
  }
});
test('the lowest eligible channel wins only for the same variant; reference caps are stable',()=>{
  const row=item('1/1',10000);
  row.purchase_offers.push({...row.purchase_offers[0],platform:'lazada',url:'https://s.lazada.co.th/s.test',price:8000});
  row.purchase_offers.push({...row.purchase_offers[0],platform:'tiktok',url:'https://vt.tiktok.com/test',price:500,variant:'wrong'});
  const score=offers.valueScore(row,now);
  assert.equal(score.price,8000);assert.equal(score.platform,'lazada');assert.equal(score.score,12.5);
  row.value_specs.geekbench6_multi=20000;assert.equal(offers.valueScore(row,now).spec_score,100);
  row.value_specs.geekbench6_multi=5000;assert.equal(offers.valueScore(row,now).spec_score,87.5);
});
test('refresh bypasses the cached registry and updates the active list without clearing search or budget',async()=>{
  let registry={schema_version:1,items:{}};
  const first=feed.categories[0].items[0];
  const freshSpec={...specs,checked_at:new Date().toISOString()};
  const loader=createLoader(async path=>({ok:true,json:async()=>path.includes('ranking_manual') ? JSON.parse(JSON.stringify(registry)) : path.includes('official') ? {} : feed}));
  const elements=new Map(),doc={getElementById(id){
    if(!elements.has(id))elements.set(id,{innerHTML:'',value:'',listeners:{},setAttribute(){},addEventListener(k,f){this.listeners[k]=f;}});
    return elements.get(id);
  }};
  const controller=createController(doc,loader);
  await controller.show('smartphone');
  controller.search('OPPO');
  doc.getElementById('categoryTop20Band').listeners.change({target:{value:'5000-9999'}});
  registry.items[first.listing_id]={binding:{title:first.title,model_count:first.price.model_count,model_examples:first.price.model_examples.map(m=>({id:m.id,name:m.name}))},
    value_specs:freshSpec,offers:{shopee:{source:'manual',url:'https://s.shopee.co.th/test',price:10000,variant:specs.variant,recorded_at:new Date().toISOString()}}};
  await controller.refresh();
  const html=doc.getElementById('categoryTop20Results').innerHTML;
  assert.match(html,/10\.0000 คะแนน/);assert.match(html,/data-rank="1"/);
  assert.equal((html.match(/<article /g)||[]).length,1);
  assert.equal(doc.getElementById('categoryTop20Search').value,'OPPO');
  registry.items[first.listing_id].offers.shopee.price=5000;
  await controller.refresh();
  assert.match(doc.getElementById('categoryTop20Results').innerHTML,/20\.0000 คะแนน/);
});
