const test=require('node:test');
const assert=require('node:assert/strict');
const V=require('../assets/phone-value');
const R=require('../assets/ranking-offers');
const P=require('../assets/phone-specs');
const feed=require('../data/shopee_feed_rankings.json');
const research=require('../data/mobile_spec_research.json');
const now=Date.parse('2026-10-21T20:00:00Z');
const base={geekbench6_single:3000,geekbench6_multi:10000,ram_gb:12,storage_gb:512,battery_mah:6000,refresh_hz:120};
function complete(){
  return {checked_at:'2026-10-21',metrics:Object.fromEntries(Object.values(V.metrics).flat().filter(([k])=>!(k in base)).map(([key,,,ref])=>[key,{value:typeof ref==='number'?ref:true,url:'https://www.samsung.com/th/',source_field:'test'}]))};
}
test('complete evidence reaches 100 in every profile; unknown inputs keep fixed weights and explicit bounds',()=>{
  for(const p of V.profiles){
    assert.equal(Object.values(p.weights).reduce((a,b)=>a+b),100);
    const s=V.evaluate(base,complete(),p.id,now);
    assert.equal(s.score,100);assert.equal(s.coverage,100);assert.equal(s.provisional,false);
  }
  const inputs=complete();delete inputs.metrics.os_upgrades;delete inputs.metrics.security_years;
  const s=V.evaluate(base,inputs,'balanced',now);
  assert.equal(s.score,95);assert.equal(s.score_low,90);assert.equal(s.score_high,100);assert.equal(s.coverage,90);
  assert.equal(s.missing.length,2);assert.equal(s.provisional,true);
  const empty=V.evaluate({},{});assert.equal(empty.score,null);assert.equal(empty.spec_score,50);assert.equal(empty.coverage,0);
});
test('unknown, explicit absence, invalid sources and future evidence stay distinct',()=>{
  const known=complete(), absent=complete(), unknown=complete();
  absent.metrics.camera_ois.value=false;delete unknown.metrics.camera_ois;
  const a=V.evaluate(base,known,'photo',now),b=V.evaluate(base,absent,'photo',now),c=V.evaluate(base,unknown,'photo',now);
  assert.equal(a.score-b.score,13.5);assert.equal(a.score-c.score,6.75);assert.equal(b.provisional,false);assert.equal(c.provisional,true);
  unknown.metrics.camera_ois={value:true,url:'https://samsung.com.evil.test/',source_field:'main_ois'};
  assert.equal(V.evaluate(base,unknown,'photo',now).score,c.score);
  known.checked_at='2099-01-01';assert.equal(V.evaluate(base,known,'balanced',now).coverage,51.5);
});
test('profiles change actual winners and live prioritizes front video; suitability does not depend on price',()=>{
  const camera=complete(), speed=complete();
  for(const [key] of V.metrics.camera)speed.metrics[key].value=['camera_ois','camera_ultrawide'].includes(key)?false:key==='camera_optical_zoom'?0:.2;
  const slow={...base,geekbench6_single:1200,geekbench6_multi:4000};
  assert.ok(V.evaluate(slow,camera,'photo',now).score>V.evaluate(base,speed,'photo',now).score);
  assert.ok(V.evaluate(slow,camera,'gaming',now).score<V.evaluate(base,speed,'gaming',now).score);
  const live=V.evaluate(base,camera,'live',now).groups.find(g=>g.id==='camera');
  assert.equal(live.metrics.find(m=>m.key==='camera_front_video').weight,55);
  const item=R.attach(feed,{schema_version:1,items:{}}).categories[0].items.find(i=>i.display_name==='Samsung Galaxy A37 5G');
  const original=R.suitabilityScore(item,now,'gaming');
  item.reference_price={source:'manual_reference',price:8000,variant:item.value_specs.variant,recorded_at:'2026-10-21T10:00:00Z'};
  const price=R.valueScore(item,now,'gaming');item.reference_price.price=4000;
  assert.deepEqual(R.suitabilityScore(item,now,'gaming'),original);
  assert.ok(Math.abs(R.valueScore(item,now,'gaming').score-price.score*2)<.0001);
});
test('typed data preserves source identity, official citations, unknowns and the full 30-model collection',()=>{
  const items=feed.categories[0].items;
  assert.equal(items.length,30);
  for(const item of items){
    const r=research.items[item.listing_id];assert.deepEqual(item.spec_research.value_inputs,r.value_inputs);
    assert.equal(r.value_inputs.model,item.display_name);
    for(const fact of Object.values(r.value_inputs.metrics)){
      assert.ok(P.officialURL(fact.url));assert.equal(r.comparison.fields[fact.source_field].url,fact.url);
      assert.ok(typeof fact.value==='number'||typeof fact.value==='boolean');
    }
  }
  const rows=R.attach(feed,{schema_version:1,items:{}}).categories[0].items;
  const fold=rows.find(i=>i.display_name.includes('Fold8'));assert.equal(R.suitabilityScore(fold,now).score,null);
  const oppo=rows.find(i=>i.display_name==='OPPO A6t Pro');
  assert.equal(oppo.value_specs.geekbench6_multi,null);
  assert.equal(R.suitabilityScore(oppo,now).provisional,true);
  assert.equal(R.suitabilityScore(oppo,now).coverage,50);
});
test('admin and public use the same bound research while explicit drafts, null overrides and changed identity fail closed',()=>{
  const raw=feed.categories[0].items[0], registry={schema_version:1,items:{}};
  let publicRow=R.attach(feed,registry).categories[0].items[0];
  const admin={listing_id:raw.listing_id,title:raw.display_name,source_title:raw.title,research_identity:raw.spec_research.binding,spec_research:raw.spec_research,value_specs:raw.researched_value_specs,value_specs_source:'research',purchase_offers:[]};
  assert.deepEqual(R.suitabilityScore(publicRow,now),R.suitabilityScore(admin,now));
  admin.research_identity={...admin.research_identity,title:'changed'};
  assert.equal(R.suitabilityScore(admin,now).score,null);
  registry.items[raw.listing_id]={binding:raw.spec_research.binding,value_specs:raw.researched_value_specs,offers:{}};
  publicRow=R.attach(feed,registry).categories[0].items[0];assert.equal(publicRow.value_specs_source,'research');
  registry.items[raw.listing_id].value_specs_source='manual';
  publicRow=R.attach(feed,registry).categories[0].items[0];assert.equal(R.suitabilityScore(publicRow,now).score,null);
  registry.items[raw.listing_id].value_specs=null;
  assert.equal(R.suitabilityScore(R.attach(feed,registry).categories[0].items[0],now).score,null);
  assert.equal(R.suitabilityScore(R.attach(feed,null).categories[0].items[0],now).score,null);
});
