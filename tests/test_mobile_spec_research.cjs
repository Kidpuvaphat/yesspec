const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const offers = require('../assets/ranking-offers.js');
const feed = JSON.parse(fs.readFileSync(require.resolve('../data/shopee_feed_rankings.json'),'utf8'));
const binding = item => ({title:item.title,model_count:item.price.model_count,model_examples:item.price.model_examples.map(m=>({id:m.id,name:m.name}))});

test('research defaults are visible without a price and a manual override wins',()=>{
  const item = feed.categories[0].items.find(i=>i.display_name==='Samsung Galaxy A37 5G');
  const data = {...feed,categories:[{items:[item]}]};
  const attached = offers.attach(data,{schema_version:1,items:{}}).categories[0].items[0];
  assert.equal(attached.value_specs.geekbench6_single,1132);
  assert.equal(offers.valueScore(attached).score,null);
  assert.match(offers.researchHTML(attached.spec_research),/17811112/);
  const custom = {...attached.value_specs,storage_gb:512,verified:false};
  const manual = offers.attach(data,{schema_version:1,items:{[item.listing_id]:{binding:binding(item),value_specs:custom,offers:{}}}}).categories[0].items[0];
  assert.equal(manual.value_specs.storage_gb,512);
  assert.equal(manual.spec_research.value_specs.storage_gb,256);
  assert.equal(offers.researchedSpecs({...item,title:'another model'}),null);
});

test('research HTML preserves blanks and escapes untrusted evidence',()=>{
  const html=offers.researchHTML({facts:[{label:'<script>',value:'<img>',url:'javascript:alert(1)'},{label:'RAM',value:null}],notes:['<script>'],checked_at:'today'});
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
  assert.match(html,/— ยังไม่ยืนยัน/);
  assert.match(html,/ยังไม่ยืนยัน Geekbench 6/);
});

test('researched provisional evidence ranks after a matching price and reprices after the research date',()=>{
  const item=feed.categories[0].items.find(i=>i.display_name==='Samsung Galaxy A37 5G');
  const s=offers.researchedSpecs(item);
  const base={...item,value_specs:s,purchase_offers:[{platform:'shopee',source:'manual',url:'https://s.shopee.co.th/test',price:8000,variant:s.variant,recorded_at:'2026-10-21T10:00:00Z'}]};
  const now=Date.parse('2026-10-21T10:01:00Z');
  const before=offers.valueScore(base,now).score;
  const after=offers.valueScore({...base,purchase_offers:[{...base.purchase_offers[0],price:4000}]},now).score;
  assert.ok(before>0);
  assert.ok(Math.abs(after-2*before)<0.0002);
  assert.equal(offers.valueScore({...base,purchase_offers:[{...base.purchase_offers[0],variant:'other capacity'}]},now).score,null);
});
