const test = require('node:test');
const assert = require('node:assert/strict');
const offers = require('../assets/ranking-offers.js');
const {listingHTML} = require('../assets/shopee-ranking.js');
const {createLoader} = require('../assets/category-top20.js');
const feed = require('../data/shopee_feed_rankings.json');
const item = feed.categories[0].items[0];
const clone = v => JSON.parse(JSON.stringify(v));
const binding = {title:item.title,model_count:item.price.model_count,model_examples:item.price.model_examples.map(m=>({id:m.id,name:m.name}))};
const url = {shopee:item.product_url,lazada:'https://s.lazada.co.th/s.test?cc=affiliate&t=keep',tiktok:'https://vt.tiktok.com/ZStest/?tag=keep&is_copy_url=1'};
const store = changes => ({schema_version:1,items:{[item.listing_id]:{binding,offers:changes}}});
const render = registry => listingHTML(offers.attach({categories:[{items:[item]}]},registry).categories[0].items[0],{});

test('each of three platforms only renders its own price and button when it has a valid cart', () => {
  for (const pf of Object.keys(offers.names)) {
    const changes = {shopee:null,lazada:null,tiktok:null,[pf]:{url:url[pf],price:123.45,source:'manual'}};
    const html = render(store(changes));
    assert.equal((html.match(/data-platform=/g)||[]).length,1);
    assert.match(html,new RegExp(`data-platform="${pf}"`));
    assert.match(html,/฿123.45/);
    for (const other of Object.keys(offers.names).filter(p=>p!==pf)) assert.doesNotMatch(html,new RegExp(`ดูบน ${offers.names[other]}`));
    changes[pf].url='';
    const hidden = render(store(changes));
    assert.doesNotMatch(hidden,/purchase-offers|฿123.45|ดูบน/);
  }
});
test('a cart without price shows a dash; no zero, inferred prices or hidden VIP values', () => {
  const html=render(store({shopee:null,tiktok:{url:url.tiktok,price:null,source:'manual'}}));
  assert.match(html,/class="metric-value">—<\/div>/);
  assert.doesNotMatch(html,/฿0|data-platform="shopee"|ราคา VIP/);
  const hidden = {...item,vip_reference:{amount:99,variant:'v',observed_at:'2026-10-19T00:00:00Z'},purchase_offers:[]};
  assert.doesNotMatch(listingHTML(hidden,{}),/฿|ดูบน|purchase-offers/);
});
test('TikTok and Lazada links retain exact affiliate parameters and are escaped', () => {
  const html=render(store({shopee:null,lazada:{url:url.lazada,price:12,source:'manual'},tiktok:{url:url.tiktok,price:11,source:'manual',variant:'<img src=x>',note:'<script>bad</script>'}}));
  assert.match(html,/cc=affiliate&amp;t=keep/); assert.match(html,/tag=keep&amp;is_copy_url=1/);
  assert.doesNotMatch(html,/<script>|<img/); assert.match(html,/&lt;script&gt;/);
});
test('profile/search/unsafe/cross-platform URLs cannot render as purchase channels', () => {
  for (const value of ['http://vt.tiktok.com/abc','https://vt.tiktok.com.evil.test/abc','https://u:p@vt.tiktok.com/abc','https://vt.tiktok.com:444/abc','https://www.tiktok.com/@shop','https://www.tiktok.com/search?q=a','javascript:alert(1)','https://www.tiktok.com/view/product/1\n']) assert.equal(offers.validURL(value,'tiktok'),'');
  assert.equal(offers.validURL(url.tiktok,'lazada'),'');
  assert.equal(offers.validURL('https://shopee.co.th/search?keyword=1','shopee'),'');
  for(const value of ['https://www.tiktok.com/view/product/1730012459782476598','https://shop.tiktok.com/view/product/1730012459782476598','https://www.tiktok.com/shop/pdp/a/1730012459782476598','https://vm.tiktok.com/abc/']) assert.equal(offers.validURL(value,'tiktok'),value);
});
test('manual prices never change ranks, sales or feed prices; title/options changes drop old matches', () => {
  const source=clone(feed), before=JSON.stringify(source), registry=store({tiktok:{url:url.tiktok,price:9,source:'manual'},shopee:null});
  const attached=offers.attach(source,registry);
  assert.equal(JSON.stringify(source),before);
  assert.deepEqual(attached.categories.map(c=>c.items.map(i=>[i.rank,i.sales,i.price])),feed.categories.map(c=>c.items.map(i=>[i.rank,i.sales,i.price])));
  for(const change of [i=>i.title+=' changed',i=>i.price.model_count++,i=>i.price.model_examples[0].name='another']) {
    const edited=clone(item);change(edited);assert.deepEqual(offers.resolve(edited,registry),[]);
  }
});
test('a replacement Shopee cart shows flash sale conditions without assigning source sales to the new cart', () => {
  const replacement='https://s.shopee.co.th/Lo9720VLk';
  const html=render(store({shopee:{url:replacement,price:6808,price_type:'flash_sale',source:'manual',variant:'OPPO A6t Pro 8/128GB'}}));
  assert.match(html,/href="https:\/\/s\.shopee\.co\.th\/Lo9720VLk"/);
  assert.match(html,/฿6,808/);
  assert.match(html,/ราคาแฟลชเซล/);
  assert.match(html,/OPPO A6t Pro 8\/128GB/);
  assert.match(html,/ตรวจราคาและสิทธิ์โปรโมชันที่หน้าร้าน/);
  assert.match(html,/ยอดขายข้างต้นอ้างอิงตะกร้าในฟีด/);
  assert.match(html,new RegExp(`data-sales="${item.sales.value}"`));
  assert.match(html,new RegExp(`data-rank="${item.rank}"`));
});
test('unavailable manual registry fails closed without hiding rankings or restoring cleared carts', async () => {
  const load=createLoader(async path=>{if(path.endsWith('ranking_manual_offers.json'))throw new Error('offline');return {ok:true,json:async()=>path.endsWith('official_product_specs.json')?require('../data/official_product_specs.json'):feed};});
  const data=await load();assert.equal(data.categories.length,32);
  for(const category of data.categories) {assert.equal(category.items.length,20);for(const row of category.items)assert.deepEqual(row.purchase_offers,[]);}
});
test('the unchanged feed keeps its 640 Shopee carts with the empty manual registry', () => {
  const data=offers.attach(feed,{schema_version:1,items:{}});
  assert.equal(data.categories.flatMap(c=>c.items).filter(i=>i.purchase_offers.length===1).length,640);
});
test('confirmed page prices age from lookup time, and edited prices lose that claim', () => {
  const checked='2026-10-17T00:00:00Z', recorded='2026-10-20T00:00:00Z';
  const offer={platform:'tiktok',url:url.tiktok,price:199.5,price_type:'regular',source:'manual',recorded_at:recorded,
    price_lookup:{confirmed:true,requested_url:url.tiktok,amount:199.5,checked_at:checked}};
  let html=listingHTML({...item,purchase_offers:[offer]}, {}, false, Date.parse(recorded));
  assert.match(html,/ราคาที่ผู้ดูแลยืนยัน/);assert.match(html,/อ่านจากหน้า/);assert.match(html,/เกิน 48 ชม/);
  html=listingHTML({...item,purchase_offers:[{...offer,price:200}]}, {}, false, Date.parse(recorded));
  assert.match(html,/ราคาที่ผู้ดูแลกรอก/);assert.doesNotMatch(html,/อ่านจากหน้า|เกิน 48 ชม/);
});
