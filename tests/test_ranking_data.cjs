const test = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../assets/ranking-data.js');
const Offers = require('../assets/ranking-offers.js');
const Value = require('../assets/phone-value.js');
const sourceFeed = require('../data/shopee_feed_rankings.json');

const paths = {
  feed:'/data/shopee_feed_rankings.json', official:'/data/official_product_specs.json',
  registry:'/data/ranking_manual_offers.json', audit:'/data/shopee_feed_review.json'
};
const now = Date.parse('2026-10-21T20:00:00Z');
const clone = value => structuredClone(value);
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = value => ({ok:true,json:async()=>clone(value)});
const deferred = () => { let resolve, reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
const binding = item => ({title:item.title,model_count:item.price.model_count,
  model_examples:item.price.model_examples.map(({id,name})=>({id,name}))});

function fixture() {
  const feed=clone(sourceFeed);
  feed.categories=[{...feed.categories[0],target_count:2,items:feed.categories[0].items.slice(0,2)}];
  const specs={geekbench6_single:3000,geekbench6_multi:10000,ram_gb:12,storage_gb:512,
    battery_mah:6000,refresh_hz:120,variant:'12GB / 512GB',verified:true,
    spec_url:'https://www.samsung.com/th/smartphones/',benchmark_url:'https://browser.geekbench.com/v6/cpu/123456',
    checked_at:new Date(now).toISOString()};
  // Controlled measured outcomes belong only to this fixture, never the product catalog.
  const metrics=Value.profiles.flatMap(profile=>Value.evaluate({}, {},profile.id,now).groups.flatMap(group=>group.metrics));
  const registry={schema_version:1,items:{}};
  feed.categories[0].items.forEach((item,index)=>{
    item.researched_value_specs=clone(specs);
    item.spec_research={...item.spec_research,model:item.display_name,binding:binding(item),value_specs:clone(specs),
      value_inputs:{model:item.display_name,checked_at:specs.checked_at,base_checked_at:specs.checked_at,
        variant_confirmed:true,model_identity_confirmed:true,
        metrics:{security_support_end:{value:'2033-10-21',url:'https://www.samsung.com/th/',source_field:'update_policy'}},
        usage_evidence:Object.fromEntries(metrics.map(metric=>[metric.key,{model:item.display_name,
          kind:'measured',score:80,url:'https://example.com/synthetic-phone-test',checked_at:specs.checked_at,
          tested_at:specs.checked_at,rubric_version:'yesspec-usage-v3',protocol_id:'yesspec-v3:'+metric.key,
          reviewed:true,method:'Synthetic controlled test fixture; identical conditions and fixed scoring rubric.'}]))}};
    registry.items[item.listing_id]={binding:binding(item),offers:{shopee:{url:'https://s.shopee.co.th/test',
      price:30000,variant:specs.variant,source:'manual',recorded_at:specs.checked_at}},
      reference_price:{price:index?20000:10000,variant:specs.variant,source:'manual_reference',recorded_at:specs.checked_at}};
  });
  return {feed,registry,official:{schema_version:1,listings:{},models:{}},
    audit:{schema_version:1,source:'shopee_affiliate_csv',categories:[]}};
}

function fetchHarness(state) {
  const calls=[];
  return {calls,fetcher:async(path,options)=>{
    calls.push({path,options});
    const name=Object.keys(paths).find(key=>paths[key]===path);
    assert.ok(name,'only root-relative data sources are requested: '+path);
    assert.equal(options.cache,'no-store');
    if(state[name] instanceof Error)throw state[name];
    if(state[name]?.httpError)return {ok:false,json:async()=>{throw Error('HTTP errors are not JSON');}};
    if(state[name]?.badJSON)return {ok:true,json:async()=>{throw SyntaxError('bad JSON');}};
    return response(state[name]);
  }};
}

function roundHarness(rounds) {
  const counts={};
  return async(path,options)=>{
    assert.equal(options.cache,'no-store');
    const name=Object.keys(paths).find(key=>paths[key]===path);
    assert.ok(name);
    const index=counts[name]||0;counts[name]=index+1;
    const value=rounds[index][name];
    return value?.promise || response(value);
  };
}

function fakeHost() {
  function events() {
    const listeners=new Map();
    return {listeners,addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
      removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
      emit(type,event={}){return Promise.all([...listeners.get(type)||[]].map(fn=>fn(event)));}};
  }
  const host=events(),timers=new Map();
  host.document={...events(),hidden:false};
  host.setInterval=(callback,ms)=>{assert.equal(ms,60000);const id=Symbol('interval');timers.set(id,callback);return id;};
  host.clearInterval=id=>timers.delete(id);
  host.timers=timers;
  return host;
}

function hostWithDeadlines() {
  const host=fakeHost(),deadlines=new Map();
  host.AbortController=AbortController;
  host.setTimeout=(callback,ms)=>{
    assert.equal(ms,15000);const id=Symbol('deadline');deadlines.set(id,callback);return id;
  };
  host.clearTimeout=id=>deadlines.delete(id);
  host.expireRequests=()=>{for(const callback of [...deadlines.values()])callback();};
  host.deadlines=deadlines;
  return host;
}

test('feed preparation preserves listing evidence, caps sorted sales and shares ties without mutating the source',()=>{
  const {feed}=fixture(),category=feed.categories[0];
  const third={...clone(category.items[0]),listing_id:'1/1',shop_id:'1',item_id:'1',product_url:'https://shopee.co.th/product/1/1'};
  category.items.forEach(item=>item.sales.value=100);third.sales.value=50;category.items.push(third);
  const before=clone(feed),prepared=Data.prepareDataset(feed);
  assert.deepEqual(prepared.categories[0].items.map(item=>item.rank),[1,1]);
  assert.equal(prepared.categories[0].listing_count,2);
  assert.deepEqual(feed,before);
  for(const change of [d=>d.source='plugin',d=>d.sales_period='rolling_30d',
    d=>d.categories[0].items[0].sales.period='rolling_30d',d=>d.categories[0].items[0].sales.scope='model',
    d=>d.categories[0].items[0].listing_id='wrong',d=>d.categories[0].items[0].product_url='https://example.com/',
    d=>d.categories[0].items[0].sales.value=NaN,d=>d.categories[0].items.push(clone(d.categories[0].items[0]))]){
    const invalid=clone(feed);change(invalid);assert.throws(()=>Data.prepareDataset(invalid));
  }
});

test('one cached snapshot joins all four sources; price refresh reranks all six modes without changing suitability',async()=>{
  const state=fixture(),{fetcher,calls}=fetchHarness(state),store=Data.create({fetcher});
  const initial=await store.load();
  assert.equal(initial.status,'ready');assert.equal(typeof initial.message,'string');assert.deepEqual(initial.audit,state.audit);
  assert.equal(await store.load(),initial);assert.equal(calls.length,4);
  const items=initial.dataset.categories[0].items,[a,b]=items;
  const suitability=Object.fromEntries(Value.profiles.map(({id})=>[id,Offers.suitabilityScore(b,now,id)]));
  for(const {id} of Value.profiles){
    assert.ok(suitability[id].score>0,id);
    assert.equal(Offers.orderItems(items,'value',now,id)[0].listing_id,a.listing_id,id);
  }
  state.registry.items[b.listing_id].reference_price.price=5000;
  const updated=await store.load(true);
  assert.equal(calls.length,8);assert.equal(updated.status,'ready');
  for(const {id} of Value.profiles){
    const ranked=Offers.orderItems(updated.dataset.categories[0].items,'value',now,id);
    assert.equal(ranked[0].listing_id,b.listing_id,id);
    assert.equal(ranked[0].value_result.score,Math.round(suitability[id].spec_score*1000/5000*10000)/10000,id);
    assert.deepEqual(Offers.suitabilityScore(ranked[0],now,id),suitability[id],id);
  }
  assert.equal(b.reference_price.price,20000,'refresh must not mutate a previously delivered snapshot');
});

test('a changed listing binding rejects saved reference prices, cart offers and manual specs',async()=>{
  const state=fixture(),item=state.feed.categories[0].items[0],entry=state.registry.items[item.listing_id];
  entry.binding.title+=' old title';entry.value_specs={...item.researched_value_specs,ram_gb:999};entry.value_specs_source='manual';
  const snapshot=await Data.create(fetchHarness(state)).load();
  const actual=snapshot.dataset.categories[0].items.find(row=>row.listing_id===item.listing_id);
  assert.equal(snapshot.status,'ready');assert.equal(actual.reference_price,null);
  assert.ok(actual.purchase_offers.every(offer=>offer.source!=='manual'));
  assert.equal(actual.value_specs_source,'research');assert.equal(actual.value_specs.ram_gb,12);
  assert.ok(Value.profiles.every(({id})=>Offers.valueScore(actual,now,id).score===null));
});

test('missing or malformed manual prices fail closed, preserve researched specs and recover on an ordinary retry',async()=>{
  for(const broken of [new Error('network'),{httpError:true},{badJSON:true},null,
    {schema_version:2,items:{}},{schema_version:1,items:[]},{schema_version:1}]){
    const state=fixture(),registry=clone(state.registry);state.registry=broken;
    const store=Data.create(fetchHarness(state)),failed=await store.load();
    assert.equal(failed.status,'prices_unavailable');assert.ok(failed.message);
    for(const item of failed.dataset.categories[0].items){
      assert.equal(item.reference_price,null);assert.deepEqual(item.purchase_offers,[]);
      assert.equal(item.value_specs_source,'research');assert.equal(item.value_specs.ram_gb,12);
      assert.equal(Offers.valueScore(item,now,'balanced').score,null);
    }
    state.registry=registry;const recovered=await store.load();
    assert.equal(recovered.status,'ready');assert.ok(recovered.dataset.categories[0].items[0].reference_price.price);
  }
});

test('feed failure never combines a previous catalog with newly fetched prices, and first-load failure remains retryable',async()=>{
  for(const broken of [{httpError:true},{badJSON:true},{source:'wrong'},new Error('offline')]){
    const state=fixture(),feed=clone(state.feed),store=Data.create(fetchHarness(state));
    state.feed=broken;const empty=await store.load();
    assert.equal(empty.status,'unavailable');assert.equal(empty.dataset,null);assert.ok(empty.message);
    state.feed=feed;const ready=await store.load();assert.equal(ready.status,'ready');
    state.feed=broken;
    Object.values(state.registry.items).forEach(entry=>entry.reference_price.price=1);
    const failed=await store.load(true);
    assert.equal(failed.status,'unavailable');assert.ok(failed.dataset);
    assert.deepEqual(failed.dataset.categories[0].items.map(i=>i.listing_id),ready.dataset.categories[0].items.map(i=>i.listing_id));
    for(const item of failed.dataset.categories[0].items){
      assert.equal(item.reference_price,null);assert.deepEqual(item.purchase_offers,[]);
      assert.equal(item.value_specs.ram_gb,12);assert.equal(Offers.valueScore(item,now,'balanced').score,null);
    }
  }
});

test('unavailable optional source documents do not discard a valid catalog or confirmed prices',async()=>{
  const state=fixture();state.official={badJSON:true};state.audit={httpError:true};
  const snapshot=await Data.create(fetchHarness(state)).load();
  assert.equal(snapshot.status,'ready');assert.equal(snapshot.audit,null);
  assert.equal(snapshot.dataset.categories[0].items.length,2);
  assert.ok(snapshot.dataset.categories[0].items.every(i=>Offers.valueScore(i,now,'balanced').score>0));
});

test('malformed nested listing options fail closed without poisoning the last usable catalog',async()=>{
  const state=fixture(),validFeed=clone(state.feed);
  const broken=clone(validFeed);broken.categories[0].items[0].price.model_examples='corrupt options';
  state.feed=broken;
  const store=Data.create(fetchHarness(state));
  const cold=await store.load();
  assert.equal(cold.status,'unavailable');assert.equal(cold.dataset,null);
  state.feed=validFeed;
  const ready=await store.load();assert.equal(ready.status,'ready');
  const ids=ready.dataset.categories[0].items.map(item=>item.listing_id);
  state.feed=broken;
  Object.values(state.registry.items).forEach(entry=>entry.reference_price.price=1);
  const warm=await store.load(true);
  assert.equal(warm.status,'unavailable');
  assert.deepEqual(warm.dataset.categories[0].items.map(item=>item.listing_id),ids);
  for(const item of warm.dataset.categories[0].items){
    assert.ok(Array.isArray(item.price.model_examples),'only the previous valid catalog may be retained');
    assert.equal(item.reference_price,null);assert.deepEqual(item.purchase_offers,[]);
    assert.equal(item.value_specs.ram_gb,12);
  }
});

test('superseded success or failure waits for the latest pending refresh and cannot become the cached result',async()=>{
  for(const outcome of ['success','failure']){
    const first=fixture(),second=fixture(),oldFeed=deferred(),newFeed=deferred();
    second.feed.revision_label='latest';
    const store=Data.create({fetcher:roundHarness([{...first,feed:oldFeed},{...second,feed:newFeed}])});
    const old=store.load(),latest=store.load(true);let oldSettled=false;
    old.then(()=>oldSettled=true);
    if(outcome==='success')oldFeed.resolve(response(first.feed));else oldFeed.reject(Error('stale failure'));
    await flush();assert.equal(oldSettled,false,'old callers must await the newest request');
    newFeed.resolve(response(second.feed));
    const current=await latest;
    assert.equal(current.status,'ready');assert.equal(current.dataset.revision_label,'latest');
    assert.equal(await old,current);assert.equal(await store.load(),current);
  }
});

test('an older success cannot resurrect prices after a newer refresh fails',async()=>{
  const state=fixture(),oldFeed=deferred(),newFeed=deferred();
  const store=Data.create({fetcher:roundHarness([{...state,feed:oldFeed},{...state,feed:newFeed}])});
  const old=store.load(),latest=store.load(true);
  newFeed.resolve({ok:false});const failed=await latest;
  oldFeed.resolve(response(state.feed));
  assert.equal(failed.status,'unavailable');assert.equal(failed.dataset,null);
  assert.equal(await old,failed);
});

test('watch refreshes on visible activity, coalesces pending events and removes listeners and polling on teardown',async()=>{
  const state=fixture(),gate=deferred(),host=fakeHost(),calls=[],seen=[];
  let hold=false;
  const base=fetchHarness(state);
  const store=Data.create({host,fetcher:(path,options)=>{
    calls.push(path);return hold&&path===paths.feed ? gate.promise : base.fetcher(path,options);
  }});
  await store.load();const stop=store.watch(snapshot=>seen.push(snapshot));
  assert.equal(typeof stop,'function');assert.equal(host.timers.size,1);assert.equal(calls.length,4);
  host.document.hidden=true;
  await host.emit('focus');await host.emit('storage',{key:'yesspec_offers_updated'});
  await Promise.all([...host.timers.values()].map(fn=>fn()));
  assert.equal(calls.length,4);assert.equal(seen.length,0);
  host.document.hidden=false;hold=true;
  const pending=host.document.emit('visibilitychange');await flush();assert.equal(calls.length,8);
  const queued=[host.emit('focus'),host.emit('storage',{key:'yesspec_offers_updated'}),host.emit('storage',{key:'yesspec_offers_updated'})];
  await flush();assert.equal(calls.length,8);
  hold=false;gate.resolve(response(state.feed));await pending;await Promise.all(queued);await flush();
  assert.equal(calls.length,12,'one follow-up refresh handles all events received while loading');
  assert.ok(seen.length>=1);assert.ok(seen.every(snapshot=>snapshot.status==='ready'));
  await host.emit('storage',{key:'unrelated'});assert.equal(calls.length,12);
  stop();assert.equal(host.timers.size,0);
  assert.ok([...host.listeners.values(),...host.document.listeners.values()].every(listeners=>listeners.size===0));
  await host.emit('focus');await host.document.emit('visibilitychange');assert.equal(calls.length,12);
});

test('a stalled price request or response body times out, releases the watcher and permits its queued recovery',async()=>{
  for(const stalledAt of ['fetch','body']){
    const state=fixture(),host=hostWithDeadlines(),gate=deferred(),seen=[],calls=[];
    const base=fetchHarness(state);let stalled=false,signal;
    const store=Data.create({host,fetcher:(path,options)=>{
      calls.push(path);
      if(stalled&&path===paths.registry){
        signal=options.signal;
        return stalledAt==='fetch'?gate.promise:Promise.resolve({ok:true,json:()=>gate.promise});
      }
      return base.fetcher(path,options);
    }});
    await store.load();assert.equal(host.deadlines.size,0);
    const stop=store.watch(snapshot=>seen.push(snapshot));
    stalled=true;const pending=host.emit('focus');await flush();
    assert.equal(calls.length,8);assert.equal(host.deadlines.size,1);assert.equal(seen.length,0);
    const queued=host.emit('storage',{key:'yesspec_offers_updated'});await flush();
    assert.equal(calls.length,8);
    stalled=false;
    const id=state.feed.categories[0].items[0].listing_id;
    state.registry.items[id].reference_price.price=5000;
    host.expireRequests();
    await pending;await queued;
    assert.equal(signal.aborted,true,'the network receives cancellation as well as a bounded wait');
    assert.deepEqual(seen.map(snapshot=>snapshot.status),['prices_unavailable','ready']);
    assert.equal(seen[0].dataset.categories[0].items[0].reference_price,null);
    assert.equal(seen[1].dataset.categories[0].items[0].reference_price.price,5000);
    assert.equal(calls.length,12,'the queued event starts exactly one fresh read after timeout');
    assert.equal(host.deadlines.size,0);
    // A fetch adapter may ignore abort. Its eventual response still cannot replace recovery.
    const late=clone(state.registry);late.items[id].reference_price.price=1;
    gate.resolve(stalledAt==='fetch'?response(late):late);await flush();
    assert.equal(await store.load(),seen[1]);assert.equal(seen.length,2);
    stop();assert.equal(host.timers.size,0);
  }
});

test('deadlines on optional documents still deliver the valid catalog and prices without waiting indefinitely',async()=>{
  const state=fixture(),host=hostWithDeadlines(),signals=[],base=fetchHarness(state);
  const never=new Promise(()=>{});
  const store=Data.create({host,fetcher:(path,options)=>{
    if(path===paths.official){signals.push(options.signal);return never;}
    if(path===paths.audit){signals.push(options.signal);return Promise.resolve({ok:true,json:()=>never});}
    return base.fetcher(path,options);
  }});
  let settled=false;const pending=store.load().then(snapshot=>{settled=true;return snapshot;});
  await flush();assert.equal(settled,false);assert.equal(host.deadlines.size,2);
  host.expireRequests();const snapshot=await pending;
  assert.equal(snapshot.status,'ready');assert.equal(snapshot.audit,null);
  assert.equal(snapshot.dataset.categories[0].items.length,2);
  assert.ok(snapshot.dataset.categories[0].items.every(item=>Offers.valueScore(item,now,'balanced').score>0));
  assert.ok(signals.every(signal=>signal.aborted));assert.equal(host.deadlines.size,0);
});
