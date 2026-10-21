const test = require('node:test');
const assert = require('node:assert/strict');
const offers = require('../assets/ranking-offers.js');
const V = require('../assets/phone-value.js');
const {createController} = require('../assets/category-top20.js');
const feed = require('../data/shopee_feed_rankings.json');
const RankingData = require('../assets/ranking-data.js');
const now = Date.parse('2026-10-21T20:00:00Z');
const specs = {
  geekbench6_single:3000,geekbench6_multi:10000,ram_gb:12,storage_gb:512,battery_mah:6000,refresh_hz:120,
  variant:'12GB / 512GB',spec_url:'https://www.samsung.com/th/smartphones/',
  benchmark_url:'https://browser.geekbench.com/v6/cpu/123456',
  verified:true,checked_at:new Date(now).toISOString()
};
// Synthetic measured outcomes exist only in this test fixture, never in the catalog.
function measuredInputs(model, at = now, score = 80) {
  const date = new Date(at).toISOString();
  const entries = V.profiles.flatMap(profile => V.evaluate({}, {}, profile.id, at).groups.flatMap(group => group.metrics));
  return {model, checked_at:date, base_checked_at:date, variant_confirmed:true, model_identity_confirmed:true, metrics:{security_support_end:{value:'2033-10-21',url:'https://www.samsung.com/th/',source_field:'update_policy'}},
    usage_evidence:Object.fromEntries(entries.map(metric => [metric.key, {
      model, kind:'measured', score, url:'https://example.com/synthetic-phone-test', checked_at:date, tested_at:date,
      rubric_version:'yesspec-usage-v3', protocol_id:'yesspec-v3:'+metric.key, reviewed:true,
      method:'Synthetic controlled test fixture; identical conditions and fixed scoring rubric.'
    }]))};
}
const policyWeight = profile => profile==='balanced'?10:profile==='work'?15:0;
const expectedScore = profile => 80+(100-80)*policyWeight(profile)/100;
const expectedValue = (profile,price) => Math.round(expectedScore(profile)*1000/price*10000)/10000;
function item(id, price, rank=1) {
  const row = structuredClone(feed.categories[0].items[0]);
  row.listing_id=id; row.rank=rank;
  row.value_specs={...specs}; row.value_specs_source='manual';
  row.spec_research.value_inputs=measuredInputs(row.display_name);
  row.purchase_offers=[{platform:'shopee',url:'https://s.shopee.co.th/test',price,variant:specs.variant,
    source:'manual',recorded_at:new Date(now).toISOString()}];
  return row;
}
test('all six modes rerank after each cart price edit, retain suitability and share ties',()=>{
  for (const {id:profile} of V.profiles) {
    const a=item('1/1',10000), b=item('1/2',20000,2);
    const suitability=offers.suitabilityScore(b,now,profile);
    let rows=offers.orderItems([a,b],'value',now,profile);
    assert.equal(rows[0].value_result.spec_score,expectedScore(profile),profile);
    assert.equal(rows[0].value_result.measured_coverage,100-policyWeight(profile),profile);
    assert.equal(rows[0].value_result.proxy_coverage,policyWeight(profile),profile);
    assert.equal(rows[0].value_result.provisional,policyWeight(profile)>0,profile);
    assert.equal(rows[0].value_result.score,expectedValue(profile,10000),profile);
    assert.deepEqual(rows.map(i=>i.rank),[1,2],profile);
    b.purchase_offers[0].price=5000;
    rows=offers.orderItems([a,b],'value',now,profile);
    assert.equal(rows[0].listing_id,'1/2',profile);
    assert.equal(rows[0].value_result.score,expectedValue(profile,5000),profile);
    assert.deepEqual(offers.suitabilityScore(b,now,profile),suitability,profile);
    assert.deepEqual(offers.orderItems([a,b],'suitability',now,profile).map(i=>i.rank),[1,1],profile);
    assert.equal(a.rank,1);assert.equal(b.rank,2); // Do not mutate source evidence.
    b.purchase_offers[0].price=10000;
    assert.deepEqual(offers.orderItems([a,b],'value',now,profile).map(i=>i.rank),[1,1],profile);
    assert.deepEqual(offers.orderItems([a,b],'sales',now,profile).map(i=>i.listing_id),['1/1','1/2'],profile);
  }
});
test('unverified or invalid identity/variant/price data never produces a value rank',()=>{
  for(const change of [
    i=>{i.value_specs.verified=false;}, i=>{i.value_specs.ram_gb=null;},
    i=>{i.value_specs.spec_url='javascript:alert(1)';},
    i=>{i.spec_research.value_inputs.model_identity_confirmed=false;},
    i=>{i.purchase_offers[0].variant='8GB / 128GB';}, i=>{i.purchase_offers[0].price=null;},
    i=>{i.purchase_offers[0].price=0;}, i=>{i.purchase_offers[0].price=NaN;},
    i=>{i.purchase_offers[0].url='https://evil.test/';},
    i=>{i.purchase_offers[0].recorded_at='2026-10-17T10:00:00Z';},
    i=>{i.purchase_offers[0].recorded_at='2026-10-22T10:00:00Z';},
    i=>{i.purchase_offers[0].source='shopee_affiliate_csv';}
  ]) for (const {id:profile} of V.profiles) {
    const row=item('1/1',10000);change(row);
    assert.equal(offers.orderItems([row],'value',now,profile)[0].rank,null,profile);
  }
});
test('the cheapest eligible channel wins for the exact variant; measured outcomes do not double-count specs',()=>{
  const row=item('1/1',10000);
  row.purchase_offers.push({...row.purchase_offers[0],platform:'lazada',url:'https://s.lazada.co.th/s.test',price:8000});
  row.purchase_offers.push({...row.purchase_offers[0],platform:'tiktok',url:'https://vt.tiktok.com/test',price:500,variant:'wrong'});
  for (const {id:profile} of V.profiles) {
    const score=offers.valueScore(row,now,profile);
    assert.equal(score.price,8000);assert.equal(score.platform,'lazada');assert.equal(score.score,expectedValue(profile,8000));
    row.value_specs.geekbench6_multi=20000;row.value_specs.battery_mah=10000;
    assert.equal(offers.valueScore(row,now,profile).spec_score,expectedScore(profile),profile);
    row.value_specs.geekbench6_multi=100;row.value_specs.battery_mah=1000;
    assert.equal(offers.valueScore(row,now,profile).spec_score,expectedScore(profile),profile);
  }
});
test('all six modes rerank independent reference prices and fall back to carts only after clearing',()=>{
  for (const {id:profile} of V.profiles) {
    const a=item('1/1',1000), b=item('1/2',20000,2);
    a.purchase_offers=[];
    a.reference_price={price:10000,variant:specs.variant,source:'manual_reference',recorded_at:new Date(now).toISOString()};
    assert.equal(offers.valueScore(a,now,profile).score,expectedValue(profile,10000),profile);
    b.reference_price={...a.reference_price,price:5000};
    let rows=offers.orderItems([a,b],'value',now,profile);
    assert.equal(rows[0].listing_id,'1/2',profile);assert.equal(rows[0].value_result.score,expectedValue(profile,5000),profile);
    b.reference_price.price=40000;
    rows=offers.orderItems([a,b],'value',now,profile);
    assert.equal(rows[0].listing_id,'1/1',profile);
    b.reference_price=null;
    assert.equal(offers.valueScore(b,now,profile).price,20000,profile);
  }
});
test('stale reference prices remain labeled and usable, but invalid references cannot borrow cart prices or variant specs',()=>{
  for (const {id:profile} of V.profiles) {
    const row=item('1/1',10000);
    row.reference_price={price:5000,variant:specs.variant,source:'manual_reference',recorded_at:'2026-10-10T10:00:00Z'};
    assert.equal(offers.valueScore(row,now,profile).score,expectedValue(profile,5000),profile);
    assert.equal(offers.valueScore(row,now,profile).stale,true,profile);
    row.reference_price.variant='8/128';
    assert.equal(offers.valueScore(row,now,profile).score,null,profile);
    row.reference_price.variant=specs.variant;row.reference_price.recorded_at='2099-01-01';
    assert.equal(offers.valueScore(row,now,profile).score,null,profile);
    row.reference_price.recorded_at=new Date(now).toISOString();row.value_specs.verified=false;
    assert.equal(offers.valueScore(row,now,profile).score,null,profile);
  }
});
test('unrelated absent or invalid Geekbench does not block sourced photographic outcomes',()=>{
  const row=item('1/1',10000), original=offers.suitabilityScore(row,now,'photo');
  row.value_specs.benchmark_url='https://browser.geekbench.com/v5/cpu/123';
  assert.deepEqual(offers.suitabilityScore(row,now,'photo'),original);
  row.value_specs.geekbench6_single=null;row.value_specs.geekbench6_multi=null;
  assert.deepEqual(offers.suitabilityScore(row,now,'photo'),original);
});
test('reference displays separately without a purchase link, escapes notes, and respects source binding',()=>{
  const {purchaseHTML}=require('../assets/shopee-ranking.js');
  const first=feed.categories[0].items[0];
  const entry={binding:{title:first.title,model_count:first.price.model_count,
    model_examples:first.price.model_examples.map(m=>({id:m.id,name:m.name}))},
    offers:{shopee:null,lazada:null,tiktok:null},
    reference_price:{price:6808,variant:'8/128',note:'<script>bad()</script>',source:'manual_reference',recorded_at:'2026-10-10T10:00:00Z'}};
  const registry={schema_version:1,items:{[first.listing_id]:entry}};
  let attached=offers.attach(feed,registry).categories[0].items[0];
  assert.equal(attached.reference_price.price,6808);
  const html=purchaseHTML(attached,now);
  assert.match(html,/฿6,808/);
  assert.match(html,/ราคาที่ลิงก์ซื้ออาจต่างกัน/);
  assert.match(html,/เกิน 48 ชม/);
  assert.doesNotMatch(html,/<a |<script>/);
  entry.binding.title+=' changed';
  attached=offers.attach(feed,registry).categories[0].items[0];
  assert.equal(attached.reference_price,null);
});
test('refresh bypasses the cached registry and updates the active list without clearing search or budget',async()=>{
  let registry={schema_version:1,items:{}};
  const syntheticFeed=structuredClone(feed);
  const first=syntheticFeed.categories[0].items[0];
  first.spec_research.value_inputs=measuredInputs(first.display_name,Date.now());
  const freshSpec={...specs,checked_at:new Date().toISOString()};
  const {load:loader}=RankingData.create({fetcher:async path=>({ok:true,json:async()=>path.includes('ranking_manual') ? JSON.parse(JSON.stringify(registry)) : path.includes('official') ? {} : syntheticFeed})});
  const elements=new Map(),doc={getElementById(id){
    if(!elements.has(id))elements.set(id,{innerHTML:'',value:'',listeners:{},setAttribute(){},addEventListener(k,f){this.listeners[k]=f;}});
    return elements.get(id);
  }};
  const controller=createController(doc,loader);
  await controller.show('smartphone');
  doc.getElementById('categoryTop20Sort').listeners.change({target:{value:'value'}});
  controller.search('OPPO');
  doc.getElementById('categoryTop20Band').listeners.change({target:{value:'5000-9999'}});
  registry.items[first.listing_id]={binding:{title:first.title,model_count:first.price.model_count,model_examples:first.price.model_examples.map(m=>({id:m.id,name:m.name}))},
    value_specs:freshSpec,offers:{shopee:{source:'manual',url:'https://s.shopee.co.th/test',price:10000,variant:specs.variant,recorded_at:new Date().toISOString()}}};
  await controller.refresh();
  const html=doc.getElementById('categoryTop20Results').innerHTML;
  const before=offers.valueScore(offers.attach(syntheticFeed,registry).categories[0].items[0]).score;
  assert.ok(html.includes(`${before.toFixed(4)} คะแนน`));assert.match(html,/data-rank="1"/);
  assert.equal((html.match(/<article /g)||[]).length,1);
  assert.equal(doc.getElementById('categoryTop20Search').value,'OPPO');
  registry.items[first.listing_id].offers.shopee.price=5000;
  await controller.refresh();
  const after=offers.valueScore(offers.attach(syntheticFeed,registry).categories[0].items[0]).score;
  assert.ok(Math.abs(after-before*2)<.0001);
  assert.ok(doc.getElementById('categoryTop20Results').innerHTML.includes(`${after.toFixed(4)} คะแนน`));
});
