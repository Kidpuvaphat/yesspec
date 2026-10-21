const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../assets/phone-specs.js');
const R=require('../assets/ranking-offers.js');
const C=require('../assets/phone-comparison.js');
const feed=require('../data/shopee_feed_rankings.json');
const original=feed.categories[0].items.find(i=>i.display_name==='Samsung Galaxy A37 5G');
const item=(id='1/1')=>({...original,listing_id:id,purchase_offers:[],value_specs:{...original.researched_value_specs},spec_research:{...original.spec_research,comparison:{checked_at:'2026-10-21',fields:{chipset:{value:'Test chip',url:'https://www.samsung.com/th/'}},notes:[]}}});

test('the comparison covers 43 distinct fields across 9 groups, with explicit unknowns',()=>{
 assert.equal(P.keys.length,43);assert.equal(new Set(P.keys).size,43);assert.equal(P.groups.length,9);
 const row=item();const html=C.tableHTML([row]);
 assert.match(html,/Test chip/);assert.match(html,/กล้องหน้า/);assert.match(html,/นโยบายอัปเดต/);assert.match(html,/eSIM/);
 assert.match(html,/ยังไม่ยืนยัน/);assert.match(html,/ไม่ใช่ค่าเฉลี่ย/);
 assert.doesNotMatch(html,/href="undefined"|>undefined</);
 assert.match(html,/ยังไม่มีลิงก์/);
});
test('only four unique known models can be selected from an untrusted URL or storage',()=>{
 const items=Array.from({length:6},(_,n)=>({listing_id:`1/${n}`}));
 assert.deepEqual(C.cleanSelection(['1/0','1/0','bad','1/1','1/2','1/3','1/4'],items),['1/0','1/1','1/2','1/3']);
 assert.deepEqual(C.cleanSelection({foo:1},items),[]);
});
test('source binding and official URLs prevent wrong-model or untrusted facts',()=>{
 const row=item();row.title='another model';
 assert.doesNotMatch(C.tableHTML([row]),/Test chip/);
 for(const url of ['javascript:alert(1)','https://samsung.com.evil.test/','https://evil.test/','https://user@www.samsung.com/','https://storage.googleapis.com/untrusted-bucket/specs']){
  assert.equal(P.field({comparison:{fields:{chipset:{value:'Wrong',url}}}},'chipset'),null);
 }
 assert.ok(P.officialURL('https://storage.googleapis.com/play_public/supported_devices.html'));
 const html=P.cellHTML({value:'<img src=x>',url:'https://www.samsung.com/',note:'<script>x</script>'});
 assert.doesNotMatch(html,/<img|<script/);
});
test('differences compare values rather than source URL and preserve meaningful qualifiers',()=>{
 const a=item(),b=item('1/2');
 b.spec_research.comparison.fields.chipset={value:'Test chip',url:'https://www.samsung.com/uk/'};
 assert.doesNotMatch(C.tableHTML([a,b],true),/>ชิปประมวลผล</);
 b.spec_research.comparison.fields.chipset.note='ตลาดสหราชอาณาจักร';
 assert.match(C.tableHTML([a,b],true),/>ชิปประมวลผล</);
});
test('comparison uses current independent reference price and preserves the chosen variant',()=>{
 const a=item(),now=Date.parse('2026-10-21T12:00:00Z');
 a.reference_price={source:'manual_reference',price:6808,variant:a.value_specs.variant,note:'coupon',recorded_at:'2026-10-21T10:00:00Z'};
 const html=C.tableHTML([a],false,now);
 assert.match(html,/฿6,808/);assert.match(html,/ราคาที่ลิงก์ซื้ออาจต่างกัน/);
 assert.match(html,new RegExp(R.valueScore(a,now).score.toFixed(4).replace('.','\\.')));
 a.reference_price.variant='different capacity';
 assert.match(C.tableHTML([a],false,now),/ระบุตัวเลือกของราคาต่ำสุดที่พบให้ตรงกับสเปก/);
});

test('a saved cart price remains visible when its model cannot yet be ranked',()=>{
 const a=item();a.value_specs.verified=false;
 a.purchase_offers=[{platform:'shopee',source:'manual',url:'https://s.shopee.co.th/example',price:6808,variant:'8/128GB',recorded_at:'2026-10-20T10:00:00Z'}];
 const html=C.tableHTML([a]);
 assert.match(html,/ราคาที่กรอก ฿6,808/);assert.match(html,/8\/128GB/);
 assert.match(html,/รอสเปกและแหล่งอ้างอิงที่ผู้ดูแลยืนยัน/);assert.match(html,/ยังไม่มีราคาพร้อมคำนวณ/);
});

test('comparison variant labels use scoring confirmation even when the legacy complete-spec flag is false',()=>{
 const rows=R.attach(feed,{schema_version:1,items:{}}).categories.flatMap(c=>c.items);
 const confirmed=rows.find(i=>i.display_name==='OPPO A6t Pro');
 const pending=rows.find(i=>i.display_name==='OPPO Reno 16 5G');
 const now=Date.parse('2026-10-21T12:00:00Z');
 assert.equal(confirmed.value_specs.verified,false);
 assert.equal(R.suitabilityScore(confirmed,now).variant_confirmed,true);
 const cells=C.summaryRows([confirmed,pending],now).find(row=>row.label==='ตัวเลือกที่สเปกจัดอันดับอ้างอิง').cells;
 assert.match(cells[0],/ยืนยัน RAM \/ ความจุที่ใช้อ้างอิงแล้ว/);assert.doesNotMatch(cells[0],/ยังรอยืนยัน/);
 assert.match(cells[1],/ยังไม่เลือกความจุ/);
});

test('all thirty published models have bound comparison data and official field sources',()=>{
 const registry=require('../data/mobile_spec_research.json');
 const items=feed.categories.flatMap(c=>c.items);
 assert.equal(items.length,30);
 for(const item of items){
  const r=registry.items[item.listing_id];
  assert.deepEqual(item.spec_research,r);
  assert.ok(R.sameBinding(item,r.binding));assert.equal(r.model,item.display_name);
  assert.equal(r.comparison.checked_at,'2026-10-21');
  assert.ok(Object.keys(r.comparison.fields).length>0);
  for(const [key,fact] of Object.entries(r.comparison.fields)){
   assert.ok(P.keys.includes(key),`${r.model}: unknown key ${key}`);
   assert.ok(P.field(r,key),`${r.model}: invalid fact ${key}`);
   assert.ok(!fact.note||typeof fact.note==='string');
  }
 }
 for(const model of ['Apple iPhone 16','Apple iPhone 17 Pro','MEIZU Mblu 21']){
  const r=items.find(i=>i.display_name===model).spec_research;
  assert.equal(P.field(r,'ram_options'),null);
 }
 for(const model of ['realme P4x','realme C100x','HONOR X7e 4G']){
  const r=items.find(i=>i.display_name===model).spec_research;
  assert.equal(r.value_specs.verified,false);
 }
 assert.equal(items.find(i=>i.display_name==='HONOR X7e 4G').spec_research.value_specs.battery_mah,null);
});
