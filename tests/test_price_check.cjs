const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(api,apply=()=>true) {
  const listeners={},nodes=new Map();
  const dialog={open:false,html:'',
    addEventListener(type,fn){listeners[type]=fn;},
    set innerHTML(value){this.html=value;nodes.clear();},get innerHTML(){return this.html;},
    showModal(){this.open=true;},close(){this.open=false;listeners.close?.();},
    querySelector(selector){
      if(!this.html.includes('id="priceConfirmForm"'))return null;
      if(selector==='[name="priceCandidate"]:checked')return nodes.get('candidate')||null;
      if(!nodes.has(selector))nodes.set(selector,{value:'',checked:false,disabled:true,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}});
      return nodes.get(selector);
    }
  };
  const root={RankingOffers:{names:{shopee:'Shopee',lazada:'Lazada',tiktok:'TikTok Shop'}}};
  vm.runInNewContext(fs.readFileSync('assets/price-check.js','utf8'),{window:root,AbortController},{filename:'price-check.js'});
  const manual=[];
  const controller=root.PriceCheck.create({dialog,api,apply,manual:context=>manual.push(context)});
  return {dialog,controller,manual,nodes,listeners};
}
const context={listing_id:'1/2',title:'Phone',platform:'tiktok',offer:{url:'https://vt.tiktok.com/abc',price:'900',variant:'128GB',note:''}};
const result={platform:'tiktok',status:'candidates_found',requested_url:context.offer.url,resolved_url:'https://shop.tiktok.com/view/product/34',checked_at:'2026-10-20T00:00:00Z',message:'พบราคา',candidates:[{amount:100,currency:'THB'},{amount:200,currency:'THB'}]};
test('dialog passes the explicit selection to the draft module and never applies a price on arrival',async()=>{
  const calls=[];let accept=false;
  const {controller,dialog,nodes}=setup(async()=>result,(...args)=>{calls.push(args);return accept;});
  await controller.open(context);
  assert.equal(calls.length,0);assert.equal(dialog.open,true);
  const form=dialog.querySelector('#priceConfirmForm');
  const submit=()=>form.listeners.submit({preventDefault(){}});
  submit();assert.equal(calls.length,0);
  nodes.set('candidate',{value:'1'});
  dialog.querySelector('#checkMatched').checked=true;
  submit();assert.equal(calls.length,0);
  dialog.querySelector('#checkPriceType').value='vip';
  dialog.querySelector('#checkVariant').value='128GB';
  dialog.querySelector('#checkNote').value='member';
  form.listeners.change();assert.equal(dialog.querySelector('#confirmCheckedPrice').disabled,false);
  submit();assert.equal(calls.length,1);assert.equal(dialog.open,true);
  assert.equal(calls[0][0],context);assert.equal(calls[0][1],result);assert.equal(calls[0][2],1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][3])),{matched:true,price_type:'vip',variant:'128GB',note:'member'});
  accept=true;submit();assert.equal(dialog.open,false);assert.equal(context.offer.price,'900');
});
test('cancel and a newer request ignore late responses, including abort-ignoring adapters',async()=>{
  const requests=[];
  const {controller,dialog}=setup((path,data,options)=>{const d=deferred();requests.push({...d,signal:options.signal});return d.promise;});
  const first=controller.open(context);controller.close();
  assert.equal(requests[0].signal.aborted,true);assert.equal(dialog.open,false);
  requests[0].resolve(result);await first;assert.doesNotMatch(dialog.innerHTML,/priceConfirmForm/);
  const old=controller.open(context),latest=controller.open({...context,title:'Latest'});
  assert.equal(requests[1].signal.aborted,true);
  requests[2].resolve(result);await latest;const html=dialog.innerHTML;assert.match(html,/Latest/);
  requests[1].resolve({...result,message:'stale'});await old;assert.equal(dialog.innerHTML,html);
});
test('unreadable or mismatched prices preserve the form and the manual action returns the same context',async()=>{
  for(const response of [{...result,status:'blocked',candidates:[]},{...result,platform:'shopee'}]) {
    let applied=0;const {controller,dialog,listeners,manual}=setup(async()=>response,()=>{applied++;return true;});
    await controller.open(context);
    assert.equal(applied,0);assert.match(dialog.innerHTML,/฿900/);assert.doesNotMatch(dialog.innerHTML,/id="priceConfirmForm"/);
    listeners.click({target:{closest:selector=>selector==='[data-check-manual]'?{}:null}});
    assert.equal(dialog.open,false);assert.equal(manual[0],context);assert.equal(context.offer.price,'900');
  }
  const {controller,dialog}=setup(async()=>{throw Error('offline');});
  await controller.open(context);assert.match(dialog.innerHTML,/offline/);assert.match(dialog.innerHTML,/ราคาเดิมยังอยู่/);
});
