const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html', 'utf8');
function context(feed = {}) {
  const c = {localStorage: {getItem: () => null}, Date, URL, console,
    MarketData: fs.existsSync('assets/market-data.js') ? require('../assets/market-data.js') : {},
    getTotalProductSpecScore: () => 100};
  vm.createContext(c);
  vm.runInContext(html.slice(html.indexOf('    function escapeAttr('), html.indexOf('    // =========================================================================\n    // CURTAIN MENU')), c);
  vm.runInContext(html.slice(html.indexOf('    function getEffectiveLivePrice('), html.indexOf('    function getNewestReleaseScore(')), c);
  c.feed = {items_by_id: feed};
  vm.runInContext('LIVE_MCP_FEED = feed;', c);
  return c;
}
const product = {id: 'p', name: 'Phone', price: 10000};
test('missing evidence does not synthesize two prices', () => {
  assert.equal(context().getStoresForProduct(product)[0].netPrice, null);
});
test('legacy direct URL is not evidence of a price', () => {
  const c = context({p:{stores_sorted:[{platform:'shopee',store:'S',net_price:1,link:'https://shopee.co.th/product/1/2',link_type:'exact_pdp'}]}});
  assert.equal(c.getEffectiveLivePrice(product), null);
});
test('unknown prices are not rendered as zero baht', () => {
  assert.equal(context().formatTHB(null), 'รอตรวจราคา');
});
test('missing prices do not earn a value-for-money score', () => {
  assert.equal(context().getValueForMoneyScore(product), 0);
});
test('legacy unscoped sales do not become verified sales', () => {
  assert.equal(context({p:{sold_count:10000}}).getProductSoldCount({...product,soldCount:20000}), null);
});
function verifiedStore(overrides={}) {
 return {platform:'shopee', source:'manual', evidence_version:2, ranking_eligible:true,
 confirmed_match:true, item_id:'2', variant:'128GB', observed_at:new Date().toISOString(),
 product_url:'https://shopee.co.th/product/1/2', link:'https://shopee.co.th/product/1/2',
 link_type:'exact_pdp', price_verified:true, candidate_price:1234.5,
 price_basis:'sku', net_price:1234.5, ...overrides};
}
test('fresh prices keep decimal precision and do not fill missing marketplace',()=>{
 const offers=context({p:{stores_sorted:[verifiedStore()]}}).getStoresForProduct(product);
 assert.equal(offers[0].netPrice,1234.5);assert.equal(offers[1].netPrice,null);
});
test('an old feed expires in the browser even if scheduled rebuild did not run',()=>{
 const c=context({p:{stores_sorted:[verifiedStore({observed_at:'2020-01-01T00:00:00Z'})]}});
 assert.equal(c.getEffectiveLivePrice(product),null);
});
test('scaled options cannot inherit the base variant price',()=>{
 const c=context({p:{stores_sorted:[verifiedStore()]}});
 assert.equal(c.getEffectiveLivePrice({...product,_priceScale:1.5,_scaledQuery:'Phone 256GB'}),null);
});
test('missing prices sort last in both directions',()=>{
 const m=require('../assets/market-data.js');
 assert(m.comparePrices(null,100)>0);assert(m.comparePrices(null,100,true)>0);
});

const collected = {raw:'2k+ ชิ้น', value:2000, precision:'lower_bound', period:'unknown', scope:'listing'};
test('collected sales choose one listing rather than adding marketplaces',()=>{
 const c=context({p:{stores_sorted:[verifiedStore({sales:collected}), verifiedStore({
   platform:'lazada', product_url:'https://www.lazada.co.th/products/pdp-i3-s4.html',
   sales:{...collected,raw:'1.1K ชิ้น',value:1100,precision:'approximate'}
 })]}});
 const selected=c.getCollectedSalesOffer(product);
 assert.equal(selected.platform,'shopee');
 assert.equal(selected.sales.value,2000);
 assert.equal(selected.sales.raw,'2k+ ชิ้น');
 assert.equal(c.getPopularityScore(product),-1);
});
test('verified VIP price participates in price and value rankings with its condition label',()=>{
 const c=context({p:{stores_sorted:[verifiedStore({sales:collected,price_basis:'member',net_price:2920,candidate_price:2920})]}});
 assert.equal(c.getEffectiveLivePrice(product),2920);
 assert(c.getValueForMoneyScore(product)>0);
 assert.equal(c.formatProductPrice(product),'฿2,920 (VIP)');
 assert.equal(c.getCollectedSalesOffer(product).observedPrice,2920);
 const panel=c.renderCollectedSales(product,1);
 assert.match(panel,/2k\+ ชิ้น/);
 assert.match(panel,/ไม่ระบุช่วงเวลา/);
 assert.match(panel,/ค่าขั้นต่ำ/);
 assert.match(panel,/ราคาเฉพาะสมาชิก \/ VIP/);
 assert.match(panel,/ราคา ณ วันที่เก็บ/);
 assert.match(panel,/https:\/\/shopee.co.th\/product\/1\/2/);
});
test('historical collected sales do not refresh an expired price',()=>{
 const c=context({p:{stores_sorted:[verifiedStore({sales:collected,observed_at:'2020-01-01T00:00:00Z'})]}});
 assert.equal(c.getEffectiveLivePrice(product),null);
 assert.equal(c.getCollectedSalesOffer(product).sales.value,2000);
});
test('only scoped, matched observations with a real count enter collected sales',()=>{
 const m=require('../assets/market-data.js');
 for(const changes of [
   {confirmed_match:false},{source:'legacy_unverified'},{link_type:'search'},
   {product_url:'https://example.com/product/1/2'}, {observed_at:'invalid'},
   {observed_at:'2999-01-01T00:00:00Z'},
   ...[{value:null},{value:'2000'},{value:-1},{value:Infinity},{raw:''},{precision:'unknown'},{period:'30d'},{scope:'shop'}].map(sales=>({sales:{...collected,...sales}}))
 ]) assert.equal(m.collectedSalesEligible(verifiedStore({sales:collected,...changes})),false,JSON.stringify(changes));
 assert.equal(m.collectedSalesEligible(verifiedStore({sales:{...collected,raw:'0 ชิ้น',value:0,precision:'exact'}})),true);
});
test('collected sales put missing counts after genuine zero and preserve approximate labels',()=>{
 const c=context({p:{stores_sorted:[verifiedStore({sales:{...collected,value:0,raw:'0 ชิ้น',precision:'exact'}})]},
 q:{stores_sorted:[verifiedStore({sales:{...collected,value:1100,raw:'1.1K ชิ้น',precision:'approximate'}})]}});
 const sorted=[{id:'missing'},product,{id:'q',name:'Other'}].sort(c.compareCollectedSalesProducts);
 assert.deepEqual(sorted.map(p=>p.id),['q','p','missing']);
 assert.match(c.renderCollectedSales({id:'q'},1),/ค่าประมาณ/);
 assert.match(c.renderCollectedSales({id:'missing'},null),/ไม่จัดอันดับ \(ไม่ใช่ยอดขาย 0\)/);
 assert.equal(c.getCollectedSalesOffer({...product,_scaledQuery:'Phone 256GB'}),null);
});
test('sales display escapes source text',()=>{
 const c=context({p:{stores_sorted:[verifiedStore({sales:{...collected,raw:'<img src=x onerror=alert(1)>'},variant:'<script>bad</script>'})]}});
 const panel=c.renderCollectedSales(product,1);
 assert(!panel.includes('<img'));
 assert(!panel.includes('<script>'));
 assert.match(panel,/&lt;img/);
});
test('representative pilot listings preserve missing sales and member-price conditions',()=>{
 const m=require('../assets/market-data.js');
 const offers=m.offers(product,{stores_sorted:[
   verifiedStore({sales:{...collected,raw:'10k+ ชิ้น',value:10000},price_basis:'member',net_price:2920,candidate_price:2920}),
   verifiedStore({platform:'lazada',product_url:'https://www.lazada.co.th/products/pdp-i3-s4.html',sales:{...collected,raw:'1.1K ชิ้น',value:1100,precision:'approximate'},candidate_price:2899,net_price:2899})
 ]});
 const selected=m.collectedSalesOffer(offers);
 assert.equal(selected.sales.value,10000);
 assert.equal(selected.observedPrice,2920);
 assert.equal(selected.netPrice,2920);
 assert.equal(offers[0].platform,'lazada');
 assert.equal(selected.sales.scope,'listing');
 assert.equal(m.collectedSalesOffer(m.offers(product,{stores_sorted:[verifiedStore({sales:{raw:'',value:null,precision:'unknown',period:'unknown',scope:'listing'}})]})),null);
});
test('VIP prices still require fresh matching evidence and do not admit coupon or starting prices',()=>{
 for(const change of [{observed_at:'2020-01-01T00:00:00Z'},{confirmed_match:false},{availability:'out_of_stock'},{ranking_eligible:false},{price_basis:'coupon'},{price_basis:'starting'}]) {
  const c=context({p:{stores_sorted:[verifiedStore({price_basis:'member',...change})]}});
  assert.equal(c.getEffectiveLivePrice(product),null,JSON.stringify(change));
  assert.equal(c.formatProductPrice(product),'รอตรวจราคา');
 }
});
