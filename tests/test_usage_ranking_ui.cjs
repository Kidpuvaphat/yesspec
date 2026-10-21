const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const P=require('../assets/phone-specs.js');
const RankingData=require('../assets/ranking-data.js');
const RankingDraft=require('../assets/ranking-draft.js');
const profileKey='yesspec_usage_profile_v2';
const profiles=['balanced','photo','gaming','work','live','battery'].map((id,n)=>({id,label:['สมดุล','ถ่ายรูป','เล่นเกม','ทำงาน','ไลฟ์สด','เน้นแบตเตอรี่'][n]}));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function dom(initial={}) {
 const elements=new Map();
 const get=id=>{
  if(!elements.has(id))elements.set(id,{id,value:initial[id]??'',innerHTML:'',textContent:'',checked:false,hidden:false,listeners:{},
   addEventListener(key,fn){this.listeners[key]=fn;},setAttribute(){},classList:{toggle(){}},querySelectorAll:()=>[]});
  return elements.get(id);
 };
 return {getElementById:get,querySelectorAll:()=>[],readyState:'complete',addEventListener(){}};
}
function storage(initial={}) {
 const data=new Map(Object.entries(initial));
 return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
}
function rankingStub(calls=[]) {
 const score=(item,now,profile='balanced',score_kind='value')=>({score:profile==='gaming'?44:25,score_low:20,score_high:50,spec_score:50,provisional:true,coverage:65,measured_coverage:20,proxy_coverage:45,missing_coverage:35,profile,score_kind,price:4000,variant:'8/128GB',missing:['updates']});
 return {profiles,names:{shopee:'Shopee',lazada:'Lazada',tiktok:'TikTok Shop'},specMetrics:[],
  valueScore:score,suitabilityScore:(item,now,profile)=>score(item,now,profile,'suitability'),
  orderItems(items,mode,now,profile){calls.push({items,mode,profile});return items.map((item,n)=>({...item,rank:n+1,value_rank:n+1,ranking_mode:mode,score_kind:mode==='suitability'?'suitability':'value',value_result:score(item,now,profile)}));},
  formulaHTML:profile=>`formula:${profile}`,scoreDetailsHTML:s=>`<details class="score-details"><summary>ข้อมูลที่ขาด ${s.profile}</summary></details>`,
  researchHTML:()=>'',researchedSpecs:()=>null,referencePrice:()=>null,validURL:()=>null,watchChanges(){},attach:feed=>feed};
}
function run(file,sandbox) {vm.runInNewContext(fs.readFileSync(`assets/${file}`,'utf8'),sandbox,{filename:file});}

test('score cards distinguish suitability, value, provisional ranks and source-sales ranks without requiring complete specs',()=>{
 const R=rankingStub(),sandbox={window:{RankingOffers:R,ShopeeAffiliate:{},OfficialSpecs:{}},module:{exports:{}}};
 run('shopee-ranking.js',sandbox);
 const UI=sandbox.module.exports;
 const value_result={...R.valueScore({},Date.now(),'photo'),price_source:'manual_reference'};
 const base={value_result,rank:2,ranking_mode:'suitability',score_kind:'suitability',value_specs:null};
 const suitability=UI.valueHTML(base);
 assert.match(suitability,/คะแนนเหมาะกับการใช้งาน · ถ่ายรูป/);assert.match(suitability,/25\.00 \/ 100/);
 assert.match(suitability,/อันดับชั่วคราว/);assert.match(suitability,/ผลทดสอบ 20% · ประมาณจากสเปก 45% · ขาดข้อมูล 35%/);assert.match(suitability,/20\.00–50\.00/);
 assert.doesNotMatch(suitability,/คะแนน \/ 1,000 บาท/);
 const value=UI.valueHTML({...base,ranking_mode:'value',score_kind:'value'});
 assert.match(value,/25\.0000 คะแนน \/ 1,000 บาท/);assert.match(value,/ราคาต่ำสุดที่ผู้ดูแลพบ/);
 assert.doesNotMatch(UI.valueHTML({...base,ranking_mode:'sales',score_kind:'value'}),/อันดับชั่วคราว/);
});

test('profile changes preserve home search/budget and recalculate the selected score mode after refresh',async()=>{
 const calls=[],R=rankingStub(calls),localStorage=storage({[profileKey]:'photo'});
 const root={RankingOffers:R,ShopeeAffiliate:{},OfficialSpecs:{},RankingData,localStorage};
 const sandbox={window:root,module:{exports:{}}};
 run('shopee-ranking.js',sandbox);
 root.ShopeeRanking.listingHTML=item=>`${item.title}:${item.value_result.profile}:${item.score_kind}`;
 run('category-top20.js',sandbox);
 const document=dom(),items=[{listing_id:'1/1',title:'Example phone',shop_name:'Shop',price_band:'budget'}];
 const feed={catalog_mode:'smartphone_30',categories:[{id:'smartphone',listing_count:1,items,price_bands:[{id:'budget',label:'budget',count:1}]}]};
 const controller=sandbox.module.exports.createController(document,async()=>({dataset:feed,status:'ready',message:'',audit:null}));
 await controller.show('smartphone');
 const $=document.getElementById;
 assert.equal($('categoryTop20Profile').value,'photo');
 assert.equal(calls.at(-1).mode,'suitability');
 controller.search('Example');
 $('categoryTop20Band').value='budget';$('categoryTop20Band').listeners.change({target:{value:'budget'}});
 $('categoryTop20Sort').value='suitability';$('categoryTop20Sort').listeners.change({target:{value:'suitability'}});
 $('categoryTop20Profile').value='gaming';$('categoryTop20Profile').listeners.change({target:{value:'gaming'}});
 assert.equal($('categoryTop20Search').value,'Example');assert.equal($('categoryTop20Band').value,'budget');
 assert.equal(localStorage.getItem(profileKey),'gaming');
 assert.equal($('categoryTop20Formula').innerHTML,'formula:gaming');
 assert.match($('categoryTop20Results').innerHTML,/gaming:suitability/);
 await controller.refresh();
 assert.equal(calls.at(-1).profile,'gaming');assert.equal(calls.at(-1).mode,'suitability');
 assert.equal($('categoryTop20Search').value,'Example');assert.equal($('categoryTop20Band').value,'budget');
});

test('admin preserves drafts and filters; saving reranks even when browser storage notifications fail',async()=>{
 const document=dom({category:'smartphone',filter:'all',budgetBand:'all',rankingSort:'value',search:''}),calls=[],R=rankingStub(calls);
 const row={listing_id:'1/1',title:'Example phone',shop_name:'Shop',price_band:'budget',price_band_label:'Budget',revision:'first',offers:{shopee:null,lazada:null,tiktok:null},needs_review:[],value_specs:{variant:'8/128GB'},research_identity:{source_title:'bound source'}};
 const feed={ok:true,total:1,categories:[{id:'smartphone',name:'มือถือ',items:[row],price_bands:[{id:'budget',label:'budget',count:1}]}]};
 let submitted;
 const adminStorage=storage({yesspec_admin_token:'test-token'}),writeStorage=adminStorage.setItem;
 adminStorage.setItem=(key,value)=>{if(key==='yesspec_offers_updated')throw Error('Storage unavailable');writeStorage(key,value);};
 const sandbox={document,RankingOffers:R,RankingDraft,PriceCheck:{create:()=>({close(){}})},localStorage:adminStorage,
  fetch:async(path,options)=>({ok:true,status:200,json:async()=>{
   if(path.includes('save-ranking-offers')){submitted=JSON.parse(options.body);row.reference_price={...submitted.products[0].reference_price,price:6808};row.revision='saved';return {ok:true,updated_count:1};}
   return feed;
  }}),window:{addEventListener(){}},confirm:()=>{throw Error('Unexpected prompt');}};
 run('admin-ranking.js',sandbox);await flush();
 const $=document.getElementById;
 const target={dataset:{reference:'price'},value:'6808',closest:()=>({dataset:{id:'1/1'}})};
 $('products').listeners.input({target});
 $('search').value='Example';$('budgetBand').value='budget';
 $('rankingSort').value='suitability';$('rankingSort').listeners.change();
 $('rankingProfile').value='live';$('rankingProfile').listeners.change({target:{value:'live'}});
 assert.equal($('search').value,'Example');assert.equal($('budgetBand').value,'budget');
 assert.match($('products').innerHTML,/data-reference="price"[^>]*value="6808"/);
 assert.equal($('saveAll').disabled,false);
 assert.equal(calls.at(-1).items[0].research_identity,row.research_identity);
 await $('saveAll').listeners.click();
 assert.equal(submitted.products[0].reference_price.price,'6808');
 assert.equal(calls.at(-1).profile,'live');assert.equal(calls.at(-1).mode,'suitability');
 assert.equal($('saveAll').disabled,true);
 assert.match($('status').textContent,/คำนวณอันดับใหม่แล้ว/);
});

test('comparison honors the shared profile URL, preserves selected models and updates the permalink',async()=>{
 const document=dom(),R=rankingStub(),localStorage=storage({[profileKey]:'battery'});
 const items=[{listing_id:'1/1',display_name:'Phone A',title:'Phone A',purchase_offers:[]},{listing_id:'1/2',display_name:'Phone B',title:'Phone B',purchase_offers:[]}];
 const location={href:'https://yesspec.com/compare.html?models=1%2F1%2C1%2F2&profile=photo&keep=yes',search:'?models=1%2F1%2C1%2F2&profile=photo&keep=yes'};
 const root={document,PhoneSpecs:P,RankingOffers:R,RankingData:{create:()=>({load:async()=>({dataset:{catalog_mode:'smartphone_30',categories:[{items}]},status:'ready',message:'',audit:null}),watch(){}})},localStorage,location,history:{replaceState(a,b,url){location.href=String(url);location.search=new URL(url).search;}},
  fetch:async()=>({ok:true,json:async()=>({catalog_mode:'smartphone_30',categories:[{items}]})})};
 const sandbox={window:root,URL,URLSearchParams};
 run('phone-comparison.js',sandbox);await flush();
 const $=document.getElementById;
 assert.equal($('comparisonProfile').value,'photo');
 assert.match($('comparisonTable').innerHTML,/คะแนนเหมาะกับการใช้งาน · ถ่ายรูป/);
 $('differencesOnly').checked=true;
 $('comparisonProfile').value='gaming';$('comparisonProfile').listeners.change({target:{value:'gaming'}});
 assert.equal(localStorage.getItem(profileKey),'gaming');assert.equal($('differencesOnly').checked,true);
 const permalink=new URL($('comparisonPermalink').href);
 assert.equal(permalink.searchParams.get('profile'),'gaming');assert.equal(permalink.searchParams.get('models'),'1/1,1/2');assert.equal(permalink.searchParams.get('keep'),'yes');
 assert.equal($('comparisonFormula').innerHTML,'formula:gaming');
 assert.match($('modelSelectors').innerHTML,/1\/1" selected/);assert.match($('modelSelectors').innerHTML,/1\/2" selected/);
});

test('all four entry points load the score engine before ranking and expose the profile control',()=>{
 for(const [file,id] of [['index.html','categoryTop20Profile'],['shopee-ranking.html','rankingProfile'],['admin-ranking.html','rankingProfile'],['compare.html','comparisonProfile']]){
  const html=fs.readFileSync(file,'utf8');
  assert.match(html,new RegExp(`id="${id}"`));
  const paths=['phone-specs','phone-value','ranking-offers'].map(name=>html.indexOf(`assets/${name}.js?v=20261021-value3`));
  assert.ok(paths.every(n=>n>=0));assert.ok(paths[0]<paths[1]&&paths[1]<paths[2]);
 }
});

test('all-proxy scores remain estimated and pending cards explain missing weight',()=>{
 const R=rankingStub(),sandbox={window:{RankingOffers:R,ShopeeAffiliate:{},OfficialSpecs:{}},module:{exports:{}}};
 run('shopee-ranking.js',sandbox);
 const UI=sandbox.module.exports;
 const score={...R.valueScore({},Date.now(),'photo'),provisional:false,coverage:100,measured_coverage:0,proxy_coverage:100,missing_coverage:0};
 const html=UI.valueHTML({value_result:score,rank:1,ranking_mode:'suitability',score_kind:'suitability'});
 assert.match(html,/อันดับชั่วคราว · คะแนนประมาณการ/);assert.match(html,/ประมาณจากสเปก 100%/);
 assert.doesNotMatch(html,/คะแนนจากผลทดสอบ|ช่วงจากข้อมูลที่ขาด|ข้อมูลยืนยัน/);
 const pending=UI.valueHTML({value_result:{...score,score:null,coverage:20,proxy_coverage:20,missing_coverage:80,reason:'หลักฐานยังไม่ถึง 50%'},rank:null,ranking_mode:'suitability',score_kind:'suitability'});
 assert.match(pending,/รอข้อมูล/);assert.match(pending,/ขาดข้อมูล 80%/);assert.match(pending,/ข้อมูลที่ขาด photo/);
});

test('score details show source evidence, missing inputs and the limit of the score interval',()=>{
 const R=require('../assets/ranking-offers.js');
 const result={coverage:25,measured_coverage:0,proxy_coverage:25,missing_coverage:75,spec_score_low:10,spec_score_high:85,
  groups:[{id:'sample',label:'ทดสอบ',weight:100,score:47.5,coverage:25,proxy_coverage:25,metrics:[
   {key:'sample_metric',label:'หัวข้อประมาณ',weight:100,contribution_weight:100,known:true,evidence_type:'spec_proxy',score:47.5,missing_coverage:75,
    note:'<script>invalid</script>',evidence:[{label:'แบตเตอรี่',value:5000,url:'https://www.samsung.com/th/',note:'ความจุ ไม่ใช่ชั่วโมงใช้งาน'}]}
  ]}],missing:[{label:'ระยะใช้งานจริง'}],estimated:[{label:'หัวข้อประมาณ'}]};
 const html=R.scoreDetailsHTML(result);
 assert.match(html,/ผลทดสอบ 0.0% · ประมาณจากสเปก 25.0% · ขาดข้อมูล 75.0%/);
 assert.match(html,/data-evidence-type="spec_proxy"/);assert.match(html,/href="https:\/\/www.samsung.com\/th\/"/);
 assert.match(html,/แบตเตอรี่: 5000/);assert.match(html,/หัวข้อนี้ยังขาดข้อมูล 75.0%/);
 assert.match(html,/ข้อมูลที่ยังขาด:<\/strong> ระยะใช้งานจริง/);assert.match(html,/ยังไม่รวมความคลาดเคลื่อนของคะแนนประมาณจากสเปก/);
 assert.doesNotMatch(html,/<script>|undefined/);
});

test('formula explains the actual proxies and fixed numeric caps only for the selected task',()=>{
 const R=require('../assets/ranking-offers.js');
 const photo=R.formulaHTML('photo'),balanced=R.formulaHTML('balanced');
 assert.match(photo,/การประมาณเมื่อไม่มีผลทดสอบ/);
 assert.match(photo,/ค่าอ้างอิงเต็มคะแนน 5/);
 assert.doesNotMatch(photo,/Geekbench 6 Single-core/);
 assert.match(balanced,/ค่าอ้างอิงเต็มคะแนน 3000/);
 assert.match(balanced,/RAM จริง 100% ของหัวข้อนี้/);
});

 test('visible usage buttons select all six profiles and keep native control and pressed state in sync',()=>{
 const UI=require('../assets/shopee-ranking.js'), choices=profiles;
 const buttons=choices.map(p=>({dataset:{choice:p.id},setAttribute(key,value){this[key]=value;}}));
 const holder={innerHTML:'',listeners:{},querySelectorAll:()=>buttons,addEventListener(key,fn){this.listeners[key]=fn;}};
 const select={value:'balanced',listeners:{},addEventListener(key,fn){this.listeners[key]=fn;}};
 const doc={getElementById:id=>id==='choices'?holder:select};
 const changes=[];UI.bindChoices(doc,'choices','select',choices,'balanced',value=>changes.push(value));
 for(const button of buttons){holder.listeners.click({target:{closest:()=>button}});assert.equal(select.value,button.dataset.choice);assert.equal(button['aria-pressed'],'true');assert.equal(buttons.filter(b=>b['aria-pressed']==='true').length,1);}
 assert.deepEqual(changes,choices.map(p=>p.id));
 select.value='photo';select.listeners.change();assert.equal(buttons[1]['aria-pressed'],'true');assert.equal(buttons[5]['aria-pressed'],'false');
});
