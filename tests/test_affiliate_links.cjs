const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const a = require('../assets/affiliate-links.js');

test('official wrapper contains the verified owner and exact product destination', () => {
  const source = 'https://shopee.co.th/product/123/456?model_id=789';
  const url = new URL(a.build(source, 'headphone'));
  assert.equal(url.origin + url.pathname, 'https://s.shopee.co.th/an_redir');
  assert.equal(url.searchParams.get('affiliate_id'), '15385610012');
  assert.equal(url.searchParams.get('origin_link'), source);
  assert.equal(url.searchParams.get('sub_id').split('-').length, 5);
  assert(a.isTracked(url.href));
});
test('feed wrapper without owner and another owner are replaced without nested wrapping', () => {
  const target = 'https://shopee.co.th/product/1/2';
  for (const id of ['', '&affiliate_id=999']) {
    const result = new URL(a.build('https://shope.ee/an_redir?origin_link=' + encodeURIComponent(target) + id));
    assert.equal(result.searchParams.get('origin_link'), target);
    assert.equal(result.searchParams.get('affiliate_id'), a.affiliateId);
  }
});
test('an owned outer wrapper cannot hide another affiliate wrapper inside it', () => {
  const inner = 'https://s.shopee.co.th/an_redir?origin_link=' + encodeURIComponent('https://shopee.co.th/product/1/2') + '&affiliate_id=999';
  const outer = 'https://s.shopee.co.th/an_redir?origin_link=' + encodeURIComponent(inner) + '&affiliate_id=' + a.affiliateId;
  assert.equal(a.isTracked(outer), false);
  assert.equal(new URL(a.build(outer)).searchParams.get('origin_link'), 'https://shopee.co.th/product/1/2');
});
test('catalog search fallback is tracked when an opaque link has no known product target', () => {
  const m = require('../assets/market-data.js');
  const result = m.offers({id:'unmatched',name:'My Phone'}, {stores_sorted:[{platform:'shopee',link:'https://s.shopee.co.th/unknown'}]})[0];
  assert(a.isTracked(result.url));
  assert.equal(result.linkType,'search');
  assert.equal(new URL(new URL(result.url).searchParams.get('origin_link')).pathname,'/search');
});
test('encoding preserves target query parameters and removes prior attribution', () => {
  const built = new URL(a.build('https://shopee.co.th/search?keyword=phone%20case&utm_source=an_999&model_id=1', 'test&affiliate_id=999'));
  const target = new URL(built.searchParams.get('origin_link'));
  assert.equal(target.searchParams.get('keyword'), 'phone case');
  assert.equal(target.searchParams.get('model_id'), '1');
  assert.equal(target.searchParams.get('utm_source'), null);
  assert.equal(built.searchParams.get('affiliate_id'), a.affiliateId);
  assert.equal(built.searchParams.getAll('affiliate_id').length, 1);
});
test('legacy universal and named product links preserve identity without old ad signatures', () => {
  for (const path of ['/universal-link/product/123/456','/Phone-i.123.456']) {
    const link = new URL(a.build(`https://shopee.co.th${path}?gads_t_sig=old-ad&model_id=789`));
    assert.equal(link.searchParams.get('origin_link'), 'https://shopee.co.th/product/123/456?model_id=789');
  }
});
test('foreign hosts, incomplete carts, unknown short links and executable URLs are rejected', () => {
  for (const url of ['javascript:alert(1)','https://shopee.co.th.evil.test/product/1/2',
    'https://attacker@shopee.co.th/product/1/2','https://shopee.co.th:444/product/1/2',
    'https://shopee.co.th/product/2','https://s.shopee.co.th/unknown',
    'https://s.shopee.co.th/an_redir?origin_link=https%3A%2F%2Fevil.test']) assert.equal(a.build(url), '');
});
test('all ranking purchase destinations can carry the owner without changing either ID', () => {
  for (const file of ['shopee_rankings.json','shopee_feed_rankings.json']) {
    const dataset = JSON.parse(fs.readFileSync(`data/${file}`));
    for (const c of dataset.categories) for (const item of c.items) {
      const u = new URL(a.build(item.product_url));
      assert(a.isTracked(u.href));
      assert.equal(u.searchParams.get('origin_link'), `https://shopee.co.th/product/${item.shop_id}/${item.item_id}`);
    }
  }
});
test('homepage and every published article load tracking before storefront rendering', () => {
  for (const path of ['index.html','shopee-ranking.html',...fs.readdirSync('dist').filter(p=>p.endsWith('.html')).map(p=>'dist/'+p)]) {
    const html = fs.readFileSync(path,'utf8');
    assert(html.includes('assets/affiliate-links.js'), path);
    if(html.includes('assets/market-data.js')) assert(html.indexOf('assets/affiliate-links.js') < html.indexOf('assets/market-data.js'), path);
  }
});
