const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '..');
const flush = () => new Promise(resolve => setImmediate(resolve));
const copy = value => JSON.parse(JSON.stringify(value));
const decode = value => String(value).replace(/&(amp|lt|gt|quot|#39);/g, (_, key) => ({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]));

// A small DOM adapter for form interactions. It parses the actual rendered HTML;
// the draft module, price dialog, scoring modules and event handlers all run unchanged.
// Native validation, layout, focus and image decoding remain browser checks.
function documentAdapter(html) {
  let document;
  const voidTags = new Set(['input','img','meta','link','br','hr','base']);
  function eventTarget(target) {
    const listeners = new Map();
    target.addEventListener = (type, listener) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    };
    target.dispatch = async (type, options = {}) => {
      const event = {target, preventDefault(){}, ...options};
      for (let node = target; node; node = options.bubble === false ? null : node.parentElement) {
        for (const listener of node._listeners?.get(type) || []) await listener(event);
      }
    };
    target._listeners = listeners;
    return target;
  }
  function matches(node, selector) {
    if (!node.tagName) return false;
    const not = [...selector.matchAll(/:not\(([^)]+)\)/g)];
    if (not.some(match => matches(node, match[1]))) return false;
    selector = selector.replace(/:not\([^)]+\)/g, '');
    if (selector.includes(':checked') && !node.checked) return false;
    selector = selector.replace(/:checked/g, '');
    const tag = selector.match(/^[a-z][\w-]*/i)?.[0];
    if (tag && node.tagName !== tag.toLowerCase()) return false;
    const id = selector.match(/#([\w-]+)/)?.[1];
    if (id && node.id !== id) return false;
    if ([...selector.matchAll(/\.([\w-]+)/g)].some(match => !node.classList.contains(match[1]))) return false;
    return [...selector.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)].every(match =>
      node.hasAttribute(match[1]) && (match[2] === undefined || node.getAttribute(match[1]) === match[2]));
  }
  function query(root, selector) {
    const groups = selector.split(',').map(group => group.trim().split(/\s+(?![^[]*\])/));
    const descendants = [];
    function walk(node) { for (const child of node.children || []) {descendants.push(child); walk(child);} }
    walk(root);
    return descendants.filter(node => groups.some(parts => {
      if (!matches(node, parts.at(-1))) return false;
      let parent = node.parentElement;
      for (let i = parts.length - 2; i >= 0; i--) {
        while (parent && !matches(parent, parts[i])) parent = parent.parentElement;
        if (!parent) return false;
        parent = parent.parentElement;
      }
      return true;
    }));
  }
  function element(tagName, attrs = {}) {
    let value = attrs.value ?? '', rawHTML = '';
    const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    const node = eventTarget({tagName, attributes:attrs, children:[], parentElement:null,
      id:attrs.id || '', type:attrs.type || '', hidden:'hidden' in attrs, disabled:'disabled' in attrs,
      checked:'checked' in attrs, open:'open' in attrs,
      dataset:Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-'))
        .map(([key, val]) => [key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), val])),
      classList:{contains:key => classes.has(key), toggle(key, enabled) {enabled ? classes.add(key) : classes.delete(key);}},
      hasAttribute(key) {return Object.hasOwn(this.attributes,key);},
      getAttribute(key) {return this.attributes[key] ?? null;},
      setAttribute(key, val) {this.attributes[key]=String(val);}, removeAttribute(key) {delete this.attributes[key];},
      querySelectorAll(selector) {return query(this, selector);}, querySelector(selector) {return query(this, selector)[0] || null;},
      closest(selector) {for (let parent=this; parent; parent=parent.parentElement) if (selector.split(',').some(s=>matches(parent,s.trim()))) return parent; return null;},
      focus() {document.activeElement=this;},
      showModal() {this.open=true;}, close() {this.open=false; return this.dispatch('close',{bubble:false});}
    });
    Object.defineProperties(node, {
      value:{get:()=>value,set:next=>{value=String(next);}},
      innerHTML:{get:()=>rawHTML,set:next=>{rawHTML=String(next);node.children=parse(rawHTML,node);selectValue(node);}},
      outerHTML:{set:next=>{const parent=node.parentElement; assert.ok(parent,'replacement has parent'); const at=parent.children.indexOf(node);parent.children.splice(at,1,...parse(String(next),parent));}},
      textContent:{get:()=>node.children.map(child=>child.textContent).join(''),set:next=>{rawHTML='';node.children=[{textContent:String(next),parentElement:node}];}}
    });
    return node;
  }
  function selectValue(node) {
    if (node.tagName==='select') {
      const options=node.querySelectorAll('option'), selected=options.find(option=>option.hasAttribute('selected')) || options[0];
      node.value=selected?.getAttribute('value') ?? selected?.textContent ?? '';
    }
  }
  function parse(source,parent) {
    const holder={children:[]}, stack=[holder];
    for (const token of source.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g) || []) {
      if (/^<!/.test(token)) continue;
      if (/^<\//.test(token)) {
        const tag=token.match(/^<\/([\w-]+)/)?.[1].toLowerCase();
        const at=stack.findLastIndex(node=>node.tagName===tag);
        if(at>0){for(let i=stack.length-1;i>=at;i--)selectValue(stack[i]);stack.length=at;}
      } else if (token.startsWith('<')) {
        const start=token.match(/^<([\w-]+)([\s\S]*?)\/?\s*>$/); if(!start)continue;
        const attrs=Object.fromEntries([...start[2].matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
          .map(match=>[match[1],decode(match[2]??match[3]??match[4]??'')]));
        const node=element(start[1].toLowerCase(),attrs),container=stack.at(-1);
        node.parentElement=container===holder?parent:container; container.children.push(node);
        if(!voidTags.has(node.tagName))stack.push(node);
      } else stack.at(-1).children.push({textContent:decode(token),parentElement:stack.at(-1)===holder?parent:stack.at(-1)});
    }
    return holder.children;
  }
  document=eventTarget({readyState:'loading',children:[],activeElement:null,
    getElementById(id){return query(this,'#'+id)[0]||null;},querySelectorAll(selector){return query(this,selector);},querySelector(selector){return query(this,selector)[0]||null;}});
  document.children=parse(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),document);
  return {document,eventTarget};
}

function fixture() {
  const feed=JSON.parse(fs.readFileSync(path.join(repo,'data/shopee_feed_rankings.json'),'utf8'));
  const source=feed.categories[0].items.slice(0,2);
  const now=new Date().toISOString();
  const rows=source.map((item,index)=>{
    const variant=item.researched_value_specs?.variant || 'RAM 8GB / ROM 128GB';
    const offer=(url,price)=>({url,price,price_type:'vip',variant,note:'existing coupon',source:'manual',recorded_at:now,
      price_lookup:{requested_url:url,resolved_url:url,amount:price,checked_at:now,confirmed:true}});
    return {listing_id:item.listing_id,title:item.display_name,rank:index+1,source_title:item.title,
      shop_name:item.shop_name,price_band:'budget',price_band_label:'Budget',revision:'initial-'+index,needs_review:[],
      offers:{shopee:offer('https://s.shopee.co.th/Lo9720VLk?sub_id=exact%2Bcode',8000),
        lazada:offer('https://s.lazada.co.th/s.Exact?aff_sub=keep%2Bthis',9000),
        tiktok:offer('https://vt.tiktok.com/Exact/?tag=keep%2Bthat',10000)},
      reference_price:{price:7000,variant,note:'reference independent of cart',source:'manual_reference',recorded_at:now},
      value_specs:item.researched_value_specs, value_specs_source:'research',spec_research:item.spec_research,
      research_identity:item.spec_research.binding,
      feed_offer:{url:item.product_url,price:null,price_type:'coupon',variant:'',note:'',source:'awaiting_manual',recorded_at:null}};
  });
  return {rows,failGet:false,saveError:null,failAfterSave:false,checkResult:null,requests:[],saves:[],serial:0};
}
async function openAdmin(state) {
  const html=fs.readFileSync(path.join(repo,'admin-ranking.html'),'utf8');
  const {document,eventTarget}=documentAdapter(html), saved=new Map([['yesspec_admin_token','local-only-test']]);
  const localStorage={getItem:key=>saved.get(key)??null,setItem:(key,val)=>saved.set(key,String(val)),removeItem:key=>saved.delete(key)};
  const payload=()=>({ok:true,total:state.rows.length,categories:[{id:'smartphone',name:'มือถือ',icon:'',
    price_bands:[{id:'budget',label:'Budget',count:state.rows.length}],items:copy(state.rows)}]});
  const fetch=async(url,options={})=>{
    state.requests.push({url,options});
    if(url.startsWith('data/phone_images.json'))return {ok:true,json:async()=>({schema_version:1,items:{}})};
    if(url==='/api/admin/ranking-products'){
      if(state.failGet)throw Error('Failed to fetch');
      return {ok:true,status:200,json:async()=>payload()};
    }
    if(url==='/api/admin/check-ranking-price') {
      const args=JSON.parse(options.body);
      const result=typeof state.checkResult==='function'?await state.checkResult(args):state.checkResult;
      return {ok:true,status:200,json:async()=>({...result,ok:true})};
    }
    assert.equal(url,'/api/admin/save-ranking-offers');
    const body=JSON.parse(options.body);state.saves.push(body);
    if(state.beforeSave)await state.beforeSave();
    if(state.saveError==='network')throw Error('Failed to fetch');
    if(state.saveError)return {ok:false,status:state.saveError,json:async()=>({ok:false,error:state.saveError===409?'ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่':'ข้อมูลราคาไม่ถูกต้อง'})};
    for(const update of body.products){
      const row=state.rows.find(row=>row.listing_id===update.listing_id);
      assert.equal(update.revision,row.revision,'save uses current server revision');
      for(const platform of update.reset||[])row.offers[platform]=copy(row.feed_offer);
      for(const [platform,offer]of Object.entries(update.offers))row.offers[platform]=offer?.url?{...offer,price:offer.price?Number(offer.price):null,source:'manual',recorded_at:new Date().toISOString()}:null;
      if(Object.hasOwn(update,'reference_price'))row.reference_price=update.reference_price?.price?{...update.reference_price,price:Number(update.reference_price.price),source:'manual_reference',recorded_at:new Date().toISOString()}:null;
      if(Object.hasOwn(update,'value_specs'))row.value_specs=update.value_specs;
      row.revision='saved-'+(++state.serial);
    }
    if(state.failAfterSave)state.failGet=true;
    return {ok:true,status:200,json:async()=>({ok:true,updated_count:body.products.length})};
  };
  const browser=eventTarget({document,localStorage,fetch,URL,URLSearchParams,AbortController,Date,console,
    setTimeout,clearTimeout,MutationObserver:class{observe(){}},confirm:()=>true});
  browser.window=browser;
  const context=vm.createContext(browser);
  const scripts=[...html.matchAll(/<script\b([^>]*\bsrc="([^"]+)"[^>]*)>/g)]
    .map(match=>({src:match[2].split('?')[0],defer:/\bdefer\b/.test(match[1])}));
  for(const script of [...scripts.filter(s=>!s.defer),...scripts.filter(s=>s.defer)])
    vm.runInContext(fs.readFileSync(path.join(repo,script.src),'utf8'),context,{filename:script.src});
  document.readyState='interactive';await document.dispatch('DOMContentLoaded',{bubble:false});document.readyState='complete';await flush();
  const get=id=>document.getElementById(id), card=id=>document.querySelector(`[data-id="${id}"]`);
  return {document,browser,get,card,
    field(id,selector){const found=card(id)?.querySelector(selector);assert.ok(found,'form control exists: '+selector);return found;},
    async input(id,selector,value,type='input'){
      const target=this.field(id,selector);if(typeof value==='boolean')target.checked=value;else target.value=value;
      await target.dispatch(type);await flush();return target;
    },
    async click(target){assert.ok(target,'click target exists');await target.dispatch('click');await flush();},
    async change(id,value,type='change'){get(id).value=value;await get(id).dispatch(type);await flush();},
    async save(id){if(id)await card(id).querySelector('[data-product-form]').dispatch('submit');else await get('saveAll').dispatch('click');await flush();},
    async confirmPrice(){
      const dialog=get('priceCheckDialog');dialog.querySelector('[name="priceCandidate"]').checked=true;
      dialog.querySelector('#checkMatched').checked=true;dialog.querySelector('#checkPriceType').value='vip';
      const form=dialog.querySelector('#priceConfirmForm');await form.dispatch('change');await form.dispatch('submit');await flush();
    }
  };
}
const ref=field=>`[data-reference="${field}"]`;
const cart=(platform,field)=>`[data-platform="${platform}"][data-field="${field}"]`;

// These scenarios assert rendered values and submitted payloads, rather than
// inspecting implementation text or replacing the business module with a stub.
test('admin published scripts preserve unsaved prices and exact affiliate URLs across filters and per-item saves',async()=>{
  const state=fixture(),page=await openAdmin(state),[a,b]=state.rows.map(row=>row.listing_id);
  await page.input(a,ref('price'),'6808');
  const newURL='https://s.shopee.co.th/NewCart?sub_id=exact%2Bnew&x=1';
  await page.input(a,cart('shopee','url'),newURL);
  assert.equal(page.field(a,cart('shopee','price')).value,'');
  assert.equal(page.field(a,cart('shopee','variant')).value,'');
  assert.equal(page.field(a,cart('shopee','note')).value,'');
  assert.equal(page.field(a,ref('price')).value,'6808');
  assert.equal(page.field(a,cart('lazada','price')).value,'9000');
  await page.input(a,cart('shopee','price'),'6700');
  await page.input(b,ref('price'),'6100');
  await page.change('search',state.rows[0].title,'input');
  await page.change('budgetBand','budget');await page.change('rankingProfile','photo');
  assert.equal(page.field(a,ref('price')).value,'6808');
  assert.equal(page.field(a,cart('shopee','url')).value,newURL);
  await page.save(a);
  assert.equal(state.saves.length,1);assert.equal(state.saves[0].products.length,1);
  const patch=state.saves[0].products[0];
  assert.equal(patch.reference_price.price,'6808');assert.equal(patch.offers.shopee.url,newURL);
  assert.equal(patch.offers.shopee.price_lookup,null);assert.deepEqual(Object.keys(patch.offers),['shopee']);
  assert.equal(Object.hasOwn(patch,'value_specs'),false);
  assert.equal(page.get('search').value,state.rows[0].title);assert.equal(page.get('rankingProfile').value,'photo');
  await page.change('search','','input');
  assert.equal(page.field(b,ref('price')).value,'6100');assert.equal(page.get('saveAll').disabled,false);
  await page.save();assert.equal(state.saves[1].products[0].listing_id,b);
});

for(const failure of [400,409,'network'])test(`admin keeps draft and original revision after save ${failure}`,async()=>{
  const state=fixture(),page=await openAdmin(state),id=state.rows[0].listing_id;
  await page.input(id,ref('price'),'6808');state.saveError=failure;await page.save(id);
  assert.equal(page.field(id,ref('price')).value,'6808');assert.equal(page.get('saveAll').disabled,false);
  assert.match(page.get('status').textContent,/ข้อมูล.*ยังอยู่/);
  const first=copy(state.saves[0]);state.saveError=null;await page.save(id);
  assert.deepEqual(state.saves[1],first);assert.equal(page.get('saveAll').disabled,true);
});

test('admin saves once and blocks stale edits until read-back recovers without losing another draft',async()=>{
  const state=fixture(),page=await openAdmin(state),[a,b]=state.rows.map(row=>row.listing_id);
  await page.input(a,ref('price'),'6808');await page.input(b,ref('price'),'6100');
  state.failAfterSave=true;await page.save(a);
  assert.equal(state.rows[0].reference_price.price,6808);
  assert.match(page.get('status').textContent,/บันทึก.*(แล้ว|สำเร็จ)/);
  assert.equal(page.get('saveAll').disabled,true);
  assert.equal(page.field(a,ref('price')).disabled,true);
  await page.save();assert.equal(state.saves.length,1,'stale revision is never posted again');
  state.failGet=false;state.failAfterSave=false;await page.click(page.get('retry'));
  assert.equal(page.field(a,ref('price')).value,'6808');assert.equal(page.field(b,ref('price')).value,'6100');
  assert.equal(page.get('saveAll').disabled,false);
  await page.save();assert.equal(state.saves.length,2);assert.equal(state.saves[1].products[0].listing_id,b);
});

test('discard-and-reload keeps the existing draft if the new read fails',async()=>{
  const state=fixture(),page=await openAdmin(state),id=state.rows[0].listing_id;
  await page.input(id,ref('price'),'6808');state.failGet=true;await page.click(page.get('reload'));
  assert.equal(page.field(id,ref('price')).value,'6808');
  assert.equal(page.get('saveAll').disabled,false);
  state.failGet=false;await page.click(page.get('reload'));
  assert.equal(page.field(id,ref('price')).value,'7000');assert.equal(page.get('saveAll').disabled,true);
});

test('price dialog cannot apply an old result after edit-and-undo, and a fresh confirmation stays unsaved',async()=>{
  const state=fixture(),page=await openAdmin(state),id=state.rows[0].listing_id;
  state.checkResult=({platform,url})=>({platform,requested_url:url,resolved_url:url,status:'candidates_found',
    checked_at:new Date().toISOString(),message:'พบราคา',candidates:[{amount:6500,currency:'THB',product_title:'Known model'}]});
  await page.click(page.field(id,'[data-check="shopee"]'));
  assert.ok(page.get('priceCheckDialog').open);assert.ok(page.get('priceCheckDialog').querySelector('#priceConfirmForm'));
  await page.input(id,cart('shopee','price'),'8100');await page.input(id,cart('shopee','price'),'8000');
  await page.confirmPrice();
  assert.equal(page.field(id,cart('shopee','price')).value,'8000');assert.equal(state.saves.length,0);
  await page.click(page.field(id,'[data-check="shopee"]'));await page.confirmPrice();
  assert.equal(page.field(id,cart('shopee','price')).value,'6500');assert.equal(page.field(id,ref('price')).value,'7000');
  assert.equal(state.saves.length,0,'confirming a lookup only fills the draft');
  await page.save(id);assert.equal(state.saves[0].products[0].offers.shopee.price_lookup.amount,6500);
  assert.equal(Object.hasOwn(state.saves[0].products[0],'reference_price'),false);
});

test('reloading closes a pending price check and discards its late response',async()=>{
  const state=fixture(),page=await openAdmin(state),id=state.rows[0].listing_id;
  let finish;
  state.checkResult=args=>new Promise(resolve=>{finish=()=>resolve({platform:args.platform,requested_url:args.url,
    resolved_url:args.url,status:'candidates_found',checked_at:new Date().toISOString(),message:'late result',
    candidates:[{amount:6400,currency:'THB'}]});});
  await page.click(page.field(id,'[data-check="shopee"]'));
  assert.ok(page.get('priceCheckDialog').open);assert.equal(typeof finish,'function');
  await page.click(page.get('reload'));
  assert.equal(page.get('priceCheckDialog').open,false);
  finish();await flush();await flush();
  assert.equal(page.get('priceCheckDialog').open,false);
  assert.equal(page.get('priceCheckDialog').querySelector('#priceConfirmForm'),null);
  assert.equal(page.field(id,cart('shopee','price')).value,'8000');assert.equal(page.get('saveAll').disabled,true);
});

test('changing researched memory updates spec inputs and clears confirmation while keeping a priced reference variant',async()=>{
  const state=fixture(),row=state.rows[0],originalVariant=row.reference_price.variant;
  row.value_specs.verified=true;
  row.spec_research.memory_options=[{ram_gb:8,storage_gb:128,label:originalVariant},{ram_gb:12,storage_gb:256,label:'Test variant · RAM 12GB / ROM 256GB'}];
  const page=await openAdmin(state),id=row.listing_id;
  assert.equal(page.field(id,'[data-spec="verified"]').checked,true);
  await page.input(id,'[data-memory-option]','1');
  assert.equal(page.field(id,'[data-spec="ram_gb"]').value,'12');
  assert.equal(page.field(id,'[data-spec="storage_gb"]').value,'256');
  assert.equal(page.field(id,'[data-spec="variant"]').value,'Test variant · RAM 12GB / ROM 256GB');
  assert.equal(page.field(id,'[data-spec="verified"]').checked,false);
  assert.equal(page.field(id,ref('price')).value,'7000');assert.equal(page.field(id,ref('variant')).value,originalVariant);
  await page.save(id);
  assert.equal(state.saves[0].products[0].value_specs.verified,false);
  assert.equal(Object.hasOwn(state.saves[0].products[0],'reference_price'),false);
  assert.deepEqual(state.saves[0].products[0].offers,{});
});

test('retry from an earlier read failure cannot race an in-flight save or replace its new revision',async()=>{
  const state=fixture(),page=await openAdmin(state),id=state.rows[0].listing_id;
  await page.input(id,ref('price'),'6808');
  state.failGet=true;await page.click(page.get('reload'));
  assert.equal(page.get('retry').hidden,false);
  assert.equal(page.field(id,ref('price')).value,'6808');
  state.failGet=false;
  let finishSave;
  state.beforeSave=()=>new Promise(resolve=>{finishSave=resolve;});
  await page.save(id);
  assert.equal(typeof finishSave,'function');assert.equal(state.rows[0].reference_price.price,7000);
  assert.equal(page.get('retry').disabled,true);
  const reads=()=>state.requests.filter(request=>request.url==='/api/admin/ranking-products').length;
  const readsBeforeRetry=reads();
  // Dispatch deliberately even though the button is disabled: the handler guard
  // must also reject a retry already queued when the save began.
  await page.click(page.get('retry'));
  assert.equal(reads(),readsBeforeRetry,'no stale GET starts while the POST is pending');
  assert.equal(page.field(id,ref('price')).value,'6808');assert.equal(state.saves.length,1);
  state.beforeSave=null;finishSave();await flush();await flush();
  assert.equal(reads(),readsBeforeRetry+1,'only the post-save GET reads the new revision');
  assert.equal(page.field(id,ref('price')).value,'6808');assert.equal(page.get('saveAll').disabled,true);
  await page.input(id,ref('price'),'6809');await page.save(id);
  assert.equal(state.saves[1].products[0].revision,'saved-1');
  assert.equal(state.rows[0].reference_price.price,6809);
});
