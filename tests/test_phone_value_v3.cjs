const test=require('node:test');
const assert=require('node:assert/strict');
const V=require('../assets/phone-value');
const now=Date.parse('2026-10-21T12:00:00Z');
const official='https://www.samsung.com/th/';
const spec={checked_at:'2026-10-21',spec_url:official,benchmark_url:'https://browser.geekbench.com/v6/cpu/12345',
  geekbench6_single:3000,geekbench6_multi:10000,ram_gb:12,storage_gb:256,battery_mah:6000,refresh_hz:120};
const fact=value=>({value,url:official,source_field:'fixture'});
function evidence(key,score=80) {
  return {model:'Fixture Phone',kind:'measured',score,url:'https://example.com/review',checked_at:'2026-10-21',tested_at:'2026-10-20',
    rubric_version:V.version,protocol_id:'yesspec-v3:'+key,reviewed:true,method:'A reviewed comparable test with documented scoring anchors.'};
}
function fixture(profile,score=80) {
  const keys=V.evaluate({}, {},profile,now).groups.flatMap(g=>g.metrics.map(m=>m.key));
  return {model:'Fixture Phone',checked_at:'2026-10-21',base_checked_at:'2026-10-21',
    metrics:{security_support_end:fact('2033-10-21')},usage_evidence:Object.fromEntries(keys.map(k=>[k,evidence(k,score)]))};
}
test('all approved task groups keep their exact weights and each outcome is counted once per mode',()=>{
  const expected={
    balanced:[25,25,15,15,10,10],photo:[25,20,20,15,10,10],gaming:[40,20,20,10,10],
    work:[25,20,15,15,15,10],live:[30,25,20,15,10],battery:[60,15,15,10]
  };
  for(const p of V.profiles){
    assert.deepEqual(Object.values(p.weights),expected[p.id]);
    assert.equal(Object.values(p.weights).reduce((a,b)=>a+b),100);
    const result=V.evaluate({}, {},p.id,now),keys=result.groups.flatMap(g=>g.metrics.map(m=>m.key));
    assert.equal(new Set(keys).size,keys.length);
    assert.equal(result.score,null);assert.equal(result.spec_score,50);assert.equal(result.missing_coverage,100);
    assert.equal(result.evidence_status,'pending');
    for(const g of result.groups)assert.ok(Math.abs(g.metrics.reduce((a,m)=>a+m.weight,0)-100)<1e-9);
  }
  const gaming=V.evaluate({}, {},'gaming',now);
  const m=Object.fromEntries(gaming.groups.flatMap(g=>g.metrics).map(x=>[x.key,x.contribution_weight]));
  assert.equal(m.game_fps,25);assert.equal(m.game_frame_consistency,15);assert.equal(m.game_runtime,15);assert.equal(m.charge_recovery,5);
  const battery=V.evaluate({}, {},'battery',now).groups[0].metrics.map(m=>m.contribution_weight);
  assert.deepEqual(battery,[20,20,10,10]);
});
test('reviewed comparable outcomes replace proxies, preserve zero, and do not double count stronger specifications',()=>{
  for(const profile of ['photo','gaming','live','battery']){
    const measured=fixture(profile,80);
    const a=V.evaluate(spec,measured,profile,now),b=V.evaluate({...spec,battery_mah:1000,ram_gb:1},measured,profile,now);
    assert.equal(a.score,80);assert.equal(a.measured_coverage,100);assert.equal(a.proxy_coverage,0);assert.equal(a.provisional,false);
    assert.equal(b.score,a.score);assert.equal(a.score_low,a.score_high);
    assert.equal(V.evaluate(spec,fixture(profile,0),profile,now).score,0);
  }
});
test('evidence identity, review, rubric, protocol, dates, source and score must all validate',()=>{
  const key='photo_main_image';
  const invalids=[{model:'Other Phone'},{reviewed:false},{rubric_version:'other'},{protocol_id:'other'},
    {checked_at:'2099-01-01'},{tested_at:'2099-01-01'},{tested_at:'2026-10-22',checked_at:'2026-10-20'},
    {tested_at:'2026-02-30'},{checked_at:'tomorrow'},{url:'javascript:alert(1)'},{url:'https://user:pass@example.com/'},
    {score:101},{score:-1},{score:NaN},{score:Infinity},{score:true},{method:'good'},{kind:'spec'}];
  for(const bad of invalids){
    const input={model:'Fixture Phone',usage_evidence:{[key]:{...evidence(key),...bad}}};
    const result=V.evaluate(spec,input,'photo',now);
    assert.equal(result.measured_coverage,0,JSON.stringify(bad));
    assert.ok(result.missing.some(m=>m.key===key));
  }
});
test('missing evidence keeps its midpoint and fixed weight; only at least 50% support enters ranking',()=>{
  const input={model:'Fixture Phone',usage_evidence:{photo_main_image:evidence('photo_main_image',100),photo_lowlight_image:evidence('photo_lowlight_image',100)}};
  let r=V.evaluate({},input,'photo',now);
  assert.equal(r.coverage,45);assert.equal(r.score,null);assert.equal(r.spec_score,72.5);assert.equal(r.score_low,45);assert.equal(r.score_high,100);
  input.usage_evidence.photo_wide=evidence('photo_wide',100);r=V.evaluate({},input,'photo',now);
  assert.equal(r.coverage,50);assert.equal(r.score,75);assert.equal(r.provisional,true);assert.equal(r.missing_coverage,50);
});
test('spec proxies are explicitly estimated even with full coverage and are replaced only within the same outcome',()=>{
  const input=fixture('battery',80);
  delete input.usage_evidence.battery_web;
  const result=V.evaluate(spec,input,'battery',now);
  assert.equal(result.coverage,100);assert.equal(result.measured_coverage,80);assert.equal(result.proxy_coverage,20);
  assert.equal(result.missing_coverage,0);assert.equal(result.provisional,true);assert.equal(result.evidence_status,'estimated');
  assert.equal(result.score,84);assert.equal(result.score_low,result.score_high);
  assert.deepEqual(result.estimated.map(m=>m.key),['battery_web']);
  const m=result.groups[0].metrics[0];assert.equal(m.evidence_type,'spec_proxy');assert.equal(m.evidence[0].value,6000);
  assert.match(m.evidence[0].note,/ไม่ใช่ชั่วโมง/);
});
test('CPU, RAM and recorded video never stand in for photography, FPS, livestream quality or battery runtime outcomes',()=>{
  const input={checked_at:'2026-10-21',metrics:{camera_rear_video:fact(1),camera_front_video:fact(1),camera_ois:fact(true)}};
  const slower={...spec,geekbench6_single:300,geekbench6_multi:1000,ram_gb:1};
  for(const id of ['photo','gaming','live','battery'])assert.equal(V.evaluate(spec,input,id,now).spec_score,V.evaluate(slower,input,id,now).spec_score);
  assert.ok(V.evaluate(spec,input,'balanced',now).spec_score>V.evaluate(slower,input,'balanced',now).spec_score);
  const live=V.evaluate(spec,input,'live',now);
  assert.ok(live.missing.some(m=>m.key==='live_delivered_image'));assert.ok(live.missing.some(m=>m.key==='live_stream_continuity'));
  const game=V.evaluate(spec,input,'gaming',now);
  assert.ok(game.missing.some(m=>m.key==='game_fps'));assert.ok(game.missing.some(m=>m.key==='game_frame_consistency'));
});
test('invalid Geekbench sources remove only their proxy contribution and do not invalidate unrelated modes',()=>{
  const bad={...spec,benchmark_url:'https://example.com/not-geekbench'};
  const input={checked_at:'2026-10-21',metrics:{wired_watts:fact(80),display_ppi:fact(450),display_hbm_nits:fact(1200),display_oled:fact(true)}};
  assert.equal(V.evaluate(spec,input,'balanced',now).coverage-V.evaluate(bad,input,'balanced',now).coverage,15);
  for(const mode of ['photo','gaming','live','battery'])assert.deepEqual(V.evaluate(spec,input,mode,now),V.evaluate(bad,input,mode,now));
});
test('unknown, explicit false, invalid official source and partial proxy coverage remain distinct',()=>{
  const empty=V.evaluate({}, {},'photo',now);
  const input={checked_at:'2026-10-21',metrics:{camera_ultrawide:fact(false)}};
  const absent=V.evaluate({},input,'photo',now);assert.equal(absent.coverage,5);assert.equal(absent.spec_score,empty.spec_score-2.5);
  input.metrics.camera_ultrawide.value=true;assert.equal(V.evaluate({},input,'photo',now).spec_score,empty.spec_score+2.5);
  input.metrics.camera_ultrawide.url='https://samsung.com.evil.test/';assert.equal(V.evaluate({},input,'photo',now).coverage,0);
  const partial=V.evaluate({}, {checked_at:'2026-10-21',metrics:{display_ppi:fact(450)}},'balanced',now);
  const m=partial.groups.find(g=>g.id==='daily_display').metrics.find(m=>m.key==='display_readability');
  assert.equal(m.proxy_coverage,50);assert.equal(m.missing_coverage,50);assert.equal(m.score,75);
  assert.equal(partial.proxy_coverage,4.5);assert.ok(partial.missing.some(m=>m.key==='display_readability:display_hbm_nits'));
});
test('maximum optical reach is counted once and cannot assert image quality or intermediate zoom coverage',()=>{
  const input={checked_at:'2026-10-21',metrics:{camera_optical_zoom:fact(5)}};
  const result=V.evaluate({},input,'photo',now);
  assert.equal(result.proxy_coverage,5);
  assert.equal(result.groups.find(g=>g.id==='photo_lenses').metrics.filter(m=>m.evidence_type==='spec_proxy').length,1);
  assert.ok(result.missing.some(m=>m.key==='photo_lens_quality'));
  assert.equal(V.evaluate({}, {...input,metrics:{camera_optical_zoom:fact(10)}},'photo',now).spec_score,result.spec_score);
});
test('support uses remaining calendar time, ignores opaque measured scores and never treats total promise as remaining',()=>{
  let input={model:'Fixture Phone',checked_at:'2026-10-21',metrics:{security_years:fact(7)},usage_evidence:{remaining_security:evidence('remaining_security',100)}};
  const unknown=V.evaluate({},input,'work',now);assert.equal(unknown.coverage,0);
  input.metrics.security_support_end= fact('2030-10-21');
  const current=V.evaluate({},input,'work',now),later=V.evaluate({},input,'work',Date.parse('2027-10-21T12:00:00Z'));
  assert.equal(current.proxy_coverage,15);assert.equal(current.measured_coverage,0);assert.ok(current.spec_score>later.spec_score);
  assert.equal(V.evaluate({},input,'work',Date.parse('2031-10-21T12:00:00Z')).groups.find(g=>g.id==='work_support').score,0);
  input.metrics.security_support_end=fact('2030-02-30');assert.equal(V.evaluate({},input,'work',now).coverage,0);
  input.metrics.security_support_start=fact('2026-01-01');assert.equal(V.evaluate({},input,'work',now).coverage,15);
});
