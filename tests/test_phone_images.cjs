const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const images=require('../assets/phone-images.js');
const registry=JSON.parse(fs.readFileSync('data/phone_images.json','utf8'));
const feed=JSON.parse(fs.readFileSync('data/shopee_feed_rankings.json','utf8'));
const phones=feed.categories.flatMap(c=>c.items);

test('all 30 catalog phones have a visually checked exact-model source and intact local image',()=>{
 assert.equal(phones.length,30);assert.equal(Object.keys(registry.items).length,30);
 const manifest=JSON.parse(fs.readFileSync('deploy/release-files.json','utf8'));
 for(const phone of phones){
  const record=images.resolve(registry,phone.listing_id,phone.display_name);
  assert.ok(record,phone.display_name);assert.equal(record.source_type,'official');
  assert.ok(record.alt.includes(phone.display_name),phone.display_name+' accessible description');
  const bytes=fs.readFileSync(record.asset_path);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),record.sha256);
  assert.equal(bytes.length,record.bytes);
  assert.ok(manifest.includes(record.asset_path));
  const signature=bytes.subarray(0,12);
  if(/\.png$/.test(record.asset_path))assert.equal(signature.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  if(/\.jpe?g$/.test(record.asset_path))assert.equal(signature.subarray(0,3).toString('hex'),'ffd8ff');
  if(/\.webp$/.test(record.asset_path)){assert.equal(signature.subarray(0,4).toString(),'RIFF');assert.equal(signature.subarray(8,12).toString(),'WEBP');}
 }
});
test('image matching fails closed for renamed models, pending sources and invalid paths',()=>{
 const [id,record]=Object.entries(registry.items)[0];
 assert.equal(images.resolve(registry,id,record.model+' Pro Max'),null);
 assert.equal(images.resolve(registry,'0/0',record.model),null);
 for(const bad of [{status:'pending'},{visual_checked:false},{asset_path:'../private.png'},{asset_path:'https://other.test/a.png'},{source_url:'javascript:alert(1)'},{image_url:'data:image/png;base64,abc'},{sha256:'wrong'}]){
  assert.equal(images.resolve({schema_version:1,items:{[id]:{...record,...bad}}},id,record.model),null);
 }
});
test('image markup retains aspect ratio, lazy loading, alt text and source attribution safely',()=>{
 const record=Object.values(registry.items)[0];
 const html=images.imageHTML({...record,alt:'<fake image>',source_name:'"unsafe"'});
 assert.match(html,/loading="lazy" decoding="async"/);assert.match(html,/width="\d+" height="\d+"/);
 assert.match(html,/&lt;fake image&gt;/);assert.doesNotMatch(html,/<fake image>/);
 assert.match(html,/rel="noopener noreferrer"/);assert.ok(html.includes(record.source_url));
 assert.doesNotMatch(images.imageHTML(record,false),/<a |<figcaption>/);
});
test('broken images reveal fallback while preserving their source and avoiding repeated hydration',()=>{
 const [id,record]=Object.entries(registry.items)[0];let onError;
 const image={hidden:false,addEventListener(type,fn){assert.equal(type,'error');onError=fn;}};
 const fallback={hidden:true};const slot={dataset:{phoneImage:id,imageModel:record.model,imageCitation:'yes'},innerHTML:'',querySelector:selector=>selector==='img'?image:fallback};
 const doc={querySelectorAll:()=>slot.dataset.imageReady?[]:[slot]};
 images.hydrate(doc,registry);assert.equal(slot.dataset.imageState,'verified');
 onError();assert.equal(image.hidden,true);assert.equal(fallback.hidden,false);assert.equal(slot.dataset.imageState,'failed');
 images.hydrate(doc,registry);assert.equal(slot.dataset.imageState,'failed');assert.ok(slot.innerHTML.includes(record.source_url));
});
test('an unavailable registry leaves a useful placeholder without affecting product data',()=>{
 const slot={dataset:{phoneImage:'1/1',imageModel:'Example'},innerHTML:''};
 images.hydrate({querySelectorAll:()=>[slot]},null);
 assert.equal(slot.dataset.imageState,'unavailable');assert.match(slot.innerHTML,/โหลดรูปไม่ได้/);
});
