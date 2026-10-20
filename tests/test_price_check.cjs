const test=require('node:test');
const assert=require('node:assert/strict');
const {selectedOffer}=require('../assets/price-check.js');
const current={url:'https://vt.tiktok.com/abc',price:'900',price_type:'vip',variant:'',note:'',price_lookup:null};
const result={status:'candidates_found',requested_url:current.url,resolved_url:'https://shop.tiktok.com/view/product/34',checked_at:'2026-10-20T00:00:00Z',candidates:[{amount:100,currency:'THB'},{amount:200,currency:'THB'}]};
const confirmation={matched:true,price_type:'regular',variant:'128GB',note:''};
test('only an explicit match confirmation, price choice and type can apply a candidate',()=>{
  assert.equal(selectedOffer(current,result,0,{...confirmation,matched:false}),null);
  assert.equal(selectedOffer(current,result,0,{...confirmation,price_type:''}),null);
  assert.equal(selectedOffer(current,result,99,confirmation),null);
  const offer=selectedOffer(current,result,1,confirmation);
  assert.equal(offer.price,'200');assert.equal(offer.price_type,'regular');assert.equal(offer.url,current.url);
  assert.equal(offer.price_lookup.checked_at,result.checked_at);assert.equal(offer.price_lookup.confirmed,true);
  assert.equal(current.price,'900');
});
test('changing URL or receiving no exact price never replaces the current price',()=>{
  assert.equal(selectedOffer({...current,url:current.url+'changed'},result,0,confirmation),null);
  for(const status of ['range_only','blocked','no_price'])assert.equal(selectedOffer(current,{...result,status},0,confirmation),null);
  assert.equal(selectedOffer(current,{...result,candidates:[{amount:1,currency:'USD'}]},0,confirmation),null);
});
