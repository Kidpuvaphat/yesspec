const test=require('node:test');
const assert=require('node:assert/strict');
const V=require('../assets/phone-value');
const R=require('../assets/ranking-offers');
const P=require('../assets/phone-specs');
const feed=require('../data/shopee_feed_rankings.json');
const research=require('../data/mobile_spec_research.json');
const now=Date.parse('2026-10-21T20:00:00Z');
// Regression coverage retained from v2; the active policy is now usage v3.
// These records are synthetic controlled outcomes, never production research.
function complete(score=100){
  const model='Synthetic fixture phone', date='2026-10-21T10:00:00Z';
  const metrics=V.profiles.flatMap(profile=>V.evaluate({}, {}, profile.id,now).groups.flatMap(group=>group.metrics));
  return {model,checked_at:date,metrics:{security_support_end:{value:'2033-10-21',url:'https://www.samsung.com/th/',source_field:'update_policy'}},usage_evidence:Object.fromEntries(metrics.map(metric=>[metric.key,{
    model,kind:'measured',score,url:'https://example.com/synthetic-phone-test',checked_at:date,tested_at:date,
    rubric_version:'yesspec-usage-v3',protocol_id:'yesspec-v3:'+metric.key,reviewed:true,
    method:'Synthetic controlled comparison under identical conditions and a fixed scoring rubric.'
  }]))};
}
test('reviewed outcomes and dated policy evidence reach 100; unknown criteria retain fixed weights and explicit bounds',()=>{
  for(const p of V.profiles){
    assert.equal(Object.values(p.weights).reduce((a,b)=>a+b),100);
    const s=V.evaluate({},complete(),p.id,now);
    const policyWeight=p.id==='balanced'?10:p.id==='work'?15:0;
    assert.equal(s.score,100,p.id);assert.equal(s.coverage,100,p.id);assert.equal(s.provisional,policyWeight>0,p.id);
    assert.equal(s.measured_coverage,100-policyWeight,p.id);assert.equal(s.proxy_coverage,policyWeight,p.id);assert.equal(s.missing_coverage,0,p.id);
    const inputs=complete();
    const group=s.groups[0];
    for(const metric of group.metrics)delete inputs.usage_evidence[metric.key];
    const partial=V.evaluate({},inputs,p.id,now),known=100-group.weight;
    assert.equal(partial.spec_score,known+group.weight/2,p.id);
    assert.equal(partial.score_low,known,p.id);assert.equal(partial.score_high,100,p.id);
    assert.equal(partial.coverage,known,p.id);assert.equal(partial.provisional,true,p.id);
    assert.equal(partial.score===null,known<50,p.id);
  }
  const empty=V.evaluate({},{});assert.equal(empty.score,null);assert.equal(empty.spec_score,50);assert.equal(empty.coverage,0);
});
test('a measured zero is evidence; missing, unreviewed, future, wrong-model or invalid-source records are unknown',()=>{
  const full=V.evaluate({},complete(),'photo',now),key=full.groups[0].metrics[0].key;
  const zero=complete(),absent=complete();zero.usage_evidence[key].score=0;delete absent.usage_evidence[key];
  const a=V.evaluate({},zero,'photo',now),b=V.evaluate({},absent,'photo',now);
  assert.equal(a.coverage,100);assert.equal(a.provisional,false);
  assert.ok(b.coverage<100);assert.equal(b.provisional,true);assert.ok(a.score<b.score);
  for(const change of [
    r=>{r.url='javascript:alert(1)';},r=>{r.checked_at='2099-01-01';},r=>{r.tested_at='2099-01-01';},
    r=>{r.model='Wrong phone';},r=>{r.reviewed=false;},r=>{r.protocol_id='different-protocol';},
    r=>{r.rubric_version='v2';},r=>{delete r.method;},r=>{r.score=NaN;}
  ]) {
    const inputs=complete();change(inputs.usage_evidence[key]);
    assert.equal(V.evaluate({},inputs,'photo',now).spec_score,b.spec_score);
    assert.equal(V.evaluate({},inputs,'photo',now).coverage,b.coverage);
  }
});
test('task-specific evidence changes the winner without unrelated spec bonuses',()=>{
  const camera=complete(80),gaming=complete(80);
  const keys=profile=>V.evaluate({}, {},profile,now).groups.flatMap(g=>g.metrics).map(m=>m.key);
  for(const key of keys('photo')){camera.usage_evidence[key].score=95;gaming.usage_evidence[key].score=30;}
  for(const key of keys('gaming')){camera.usage_evidence[key].score=30;gaming.usage_evidence[key].score=95;}
  assert.ok(V.evaluate({},camera,'photo',now).score>V.evaluate({},gaming,'photo',now).score);
  assert.ok(V.evaluate({},camera,'gaming',now).score<V.evaluate({},gaming,'gaming',now).score);
  const original=V.evaluate({},camera,'photo',now);
  const unrelated={geekbench6_single:3000,geekbench6_multi:10000,ram_gb:24,storage_gb:1024};
  assert.deepEqual(V.evaluate(unrelated,camera,'photo',now),original);
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
  assert.equal(R.suitabilityScore(oppo,now).measured_coverage,0);
  assert.ok(R.suitabilityScore(oppo,now).missing.length>0);
  for(const row of rows){
    assert.ok(!Object.keys(row.spec_research.value_inputs.usage_evidence||{}).length,'No synthetic outcomes in production data');
    const result=R.suitabilityScore(row,now);
    assert.equal(result.measured_coverage,0);assert.equal(result.provisional,true);
  }
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
