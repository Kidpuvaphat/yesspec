const test = require('node:test');
const assert = require('node:assert/strict');
const {productUrl, stalePrice, filterItems, listingHTML} = require('../assets/shopee-ranking.js');
const feed = require('../data/shopee_rankings.json');
const item = feed.categories.find(c => c.id === 'headphone').items.find(i => i.vip_reference);
const observed = Date.parse(item.observed_at);

test('links require the exact observed shop and item, not just a matching item ID', () => {
  assert.equal(productUrl(item), `https://shopee.co.th/product/${item.listing_id}`);
  assert.equal(productUrl({...item, shop_id: '999'}), '');
  assert.equal(productUrl({...item, product_url: 'https://shopee.co.th.evil.test/product/1/2'}), '');
  assert.equal(productUrl({...item, product_url: 'javascript:alert(1)'}), '');
});
test('prices become historical without losing the original observation', () => {
  assert.equal(stalePrice(item, observed + 47 * 3600000), false);
  assert.equal(stalePrice(item, observed + 49 * 3600000), true);
  assert.equal(stalePrice(item, observed - 1000), true);
});
test('sales, displayed price and VIP evidence are distinct and period is explicit', () => {
  const html = listingHTML(item, feed.reason_labels, false, observed);
  assert.match(html, /ไม่ระบุช่วงเวลา/);
  assert.match(html, /ยอดขายที่ปลั๊กอินรายงาน/);
  assert.match(html, /เคยตรวจราคา VIP ฿2,920/);
  assert.match(html, /Black/);
  assert.match(html, /รอตรวจตัวเลือกและเงื่อนไข/);
  assert.doesNotMatch(html, /30 วัน|ยอดขายต่อวัน/);
});
test('untrusted product titles and shop names cannot insert markup', () => {
  const html = listingHTML({...item, title: '<img src=x onerror="alert(1)">', shop_name: '<script>oops</script>'}, feed.reason_labels);
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;img/);
});
test('search keeps original ranks, supports shop names and returns an empty state input', () => {
  const items = feed.categories.find(c => c.id === 'headphone').items;
  const result = filterItems(items, '  sPaCe oNe  ');
  assert.ok(result.length > 0);
  assert.ok(result.every(i => i.title.toLowerCase().includes('space one')));
  assert.equal(result[0].rank, items.find(i => i.title.toLowerCase().includes('space one')).rank);
  assert.ok(filterItems(items, item.shop_name).length > 0);
  assert.equal(filterItems(items, 'ไม่มีสินค้าชื่อนี้แน่นอนxyz').length, 0);
});
test('review view opens evidence and expired prices are labelled', () => {
  const html = listingHTML(item, feed.reason_labels, true, observed + 49 * 3600000);
  assert.match(html, /class="listing-details" open/);
  assert.match(html, /ข้อมูลราคาเกิน 48 ชม/);
});
test('CSV source and unknown price time remain explicit and buy link belongs to owner', () => {
  const data = require('../data/archive/shopee_feed_rankings-20261019.json');
  const row = data.categories[0].items[0];
  const html = listingHTML(row, data.reason_labels);
  assert.match(html, /ยอดขายใน Product Feed/);
  assert.match(html, /เวลาอัปเดตราคาไม่ระบุ/);
  assert.match(html, /อ่านไฟล์เมื่อ/);
  assert.match(html, /affiliate_id=15385610012/);
  assert.doesNotMatch(html, /ยอดขายที่ปลั๊กอินรายงาน/);
});
