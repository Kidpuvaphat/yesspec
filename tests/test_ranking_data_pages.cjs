const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..');
const readJSON = name => JSON.parse(fs.readFileSync(path.join(repo, 'data', name), 'utf8'));
const now = Date.parse('2026-10-21T20:00:00Z');
const flush = () => new Promise(resolve => setImmediate(resolve));
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}

function fixture() {
  const feed = readJSON('shopee_feed_rankings.json');
  const first = feed.categories[0].items.find(item => item.display_name === 'Samsung Galaxy A37 5G');
  const second = feed.categories[0].items.find(item => item.display_name === 'Samsung Galaxy A27 5G');
  assert.ok(first && second, 'two sourced models with confirmed variants are available');
  const registry = {schema_version: 1, items: {}};
  [first, second].forEach((item, index) => {
    registry.items[item.listing_id] = {
      binding: {title: item.title, model_count: item.price.model_count,
        model_examples: item.price.model_examples.map(({id, name}) => ({id, name}))},
      offers: {},
      reference_price: {price: index ? 20000 : 10000, variant: item.spec_research.value_specs.variant,
        source: 'manual_reference', recorded_at: new Date(now).toISOString()}
    };
  });
  return {first, second, registry, failPrices: false, sources: {
    'shopee_feed_rankings.json': feed,
    'official_product_specs.json': readJSON('official_product_specs.json'),
    'shopee_feed_review.json': readJSON('shopee_feed_review.json'),
    'phone_images.json': readJSON('phone_images.json')
  }};
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    async dispatch(type, event = {}) {
      await Promise.all([...listeners.get(type) || []].map(listener => listener(event)));
    }
  };
}

// DOM adapter for ranking behavior only. Image decoding, layout and native focus
// remain browser checks; no product module is replaced with a fake implementation.
function documentAdapter(html) {
  const elements = new Map();
  function selectOptions(element, html) {
    const options = [...html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
    const selected = options.find(match => /\bselected\b/.test(match[1])) || options[0];
    element.value = selected?.[1].match(/\bvalue="([^"]*)"/)?.[1] || '';
  }
  function make(id = '', tagName = 'div') {
    let html = '', text = '';
    const classes = new Set();
    const element = {...eventTarget(), id, tagName, nodeType: 1, value: '', hidden: false,
      disabled: false, checked: false, dataset: {}, attributes: {},
      classList: {
        toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
        contains(name) { return classes.has(name); }
      },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return this.attributes[name] ?? null; },
      querySelectorAll() { return []; }, querySelector() { return null; },
      matches() { return false; }, append() {}, focus() {},
    };
    Object.defineProperties(element, {
      innerHTML: {get: () => html, set(value) {
        html = String(value); text = html.replace(/<[^>]*>/g, '');
        parse(html);
        if (tagName === 'select') selectOptions(element, html);
      }},
      textContent: {get: () => text, set(value) {text = String(value); html = '';}}
    });
    return element;
  }
  function parse(html) {
    for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
      if (!elements.has(match[3])) elements.set(match[3], make(match[3], match[1]));
      if (/\bhidden\b/.test(match[2])) elements.get(match[3]).hidden = true;
    }
    for (const match of html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
      selectOptions(elements.get(match[1]), match[2]);
    }
  }
  parse(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
  return {...eventTarget(), readyState: 'loading', hidden: false, body: make(),
    getElementById: id => elements.get(id) || null,
    createElement: tag => make('', tag), querySelectorAll: () => [], querySelector: () => null};
}

async function openPage(file, state) {
  const html = fs.readFileSync(path.join(repo, file), 'utf8');
  const document = documentAdapter(html);
  const params = file === 'compare.html'
    ? `?models=${state.first.listing_id},${state.second.listing_id}&profile=battery&keep=yes` : '';
  const location = new URL('https://yesspec.com/' + file + params + '#smartphone');
  const saved = new Map(), errors = [], requests = [];
  const localStorage = {getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, String(value)), removeItem: key => saved.delete(key)};
  const fetch = async (url, options) => {
    const name = new URL(url, location).pathname.split('/').pop();
    requests.push({name, options});
    if (name === 'ranking_manual_offers.json' && state.failPrices) return {ok: false};
    const payload = name === 'ranking_manual_offers.json' ? state.registry : state.sources[name];
    assert.ok(payload, 'unexpected data request: ' + url);
    return {ok: true, json: async () => structuredClone(payload)};
  };
  const browser = {...eventTarget(), document, location, fetch, localStorage,
    history: {replaceState(a, b, next) { location.href = String(next); }},
    setInterval() { return 1; }, clearInterval() {}, setTimeout, clearTimeout, AbortController,
    MutationObserver: class { observe() {} disconnect() {} },
    console: {error: error => errors.push(error)}, Date: FixedDate, URL, URLSearchParams};
  browser.window = browser;
  const context = vm.createContext(browser);
  // Read the actual HTML entry point. Missing or misordered dependencies are not
  // supplied separately by the test. Inline legacy catalog code is out of scope.
  const scripts = [...html.matchAll(/<script\b([^>]*\bsrc="([^"]+)"[^>]*)>/gi)]
    .map(match => ({src: match[2].split('?')[0], defer: /\bdefer\b/.test(match[1])}));
  for (const script of [...scripts.filter(s => !s.defer), ...scripts.filter(s => s.defer)]) {
    assert.ok(script.src.startsWith('assets/'), 'external script is a local published asset');
    vm.runInContext(fs.readFileSync(path.join(repo, script.src), 'utf8'), context, {filename: script.src});
  }
  document.readyState = 'interactive';
  await document.dispatch('DOMContentLoaded');
  document.readyState = 'complete';
  if (file === 'index.html') await browser.ShopeeCategoryCatalog.show('smartphone');
  await flush();
  return {browser, document, requests, errors,
    get: id => document.getElementById(id),
    async change(id, value, type = 'change') {
      const target = document.getElementById(id);
      assert.ok(target, 'control exists: ' + id);
      if (typeof value === 'boolean') target.checked = value; else target.value = value;
      await target.dispatch(type, {target});
      await document.dispatch(type, {target});
    },
    async refresh() { await browser.dispatch('focus'); await flush(); }
  };
}

for (const file of ['index.html', 'shopee-ranking.html', 'compare.html']) {
  test(`${file} loads its published scripts, reranks saved prices and recovers without losing choices`, async () => {
    const state = fixture(), page = await openPage(file, state), comparison = file === 'compare.html';
    const home = file === 'index.html';
    const resultId = comparison ? 'comparisonTable' : home ? 'categoryTop20Results' : 'rankingResults';
    const statusId = comparison ? 'compareStatus' : home ? 'categoryTop20Meta' : 'rankingReadiness';
    const result = () => page.get(resultId).innerHTML;
    const status = () => page.get(statusId).innerHTML + page.get(statusId).textContent;
    const ids = () => [...result().matchAll(/data-listing-id="([^"]+)"/g)].map(match => match[1]);
    assert.match(result(), /Samsung Galaxy A37 5G/);
    assert.match(result(), /฿20,000/);
    assert.doesNotMatch(status(), /พักอันดับ|โหลด.*ไม่ได้/);
    if (comparison) {
      await page.change('differencesOnly', true);
    } else {
      await page.change(home ? 'categoryTop20Sort' : 'rankingSort', 'value');
      await page.change(home ? 'categoryTop20Profile' : 'rankingProfile', 'battery');
      await page.change(home ? 'categoryTop20Band' : 'budgetBand', state.first.price_band);
      await page.change(home ? 'categoryTop20Search' : 'listingSearch', 'Samsung', 'input');
      if (!home) await page.get('reviewView').dispatch('click');
      assert.deepEqual(ids(), [state.first.listing_id, state.second.listing_id]);
    }
    const assertChoices = () => {
      if (comparison) {
        assert.equal(page.get('differencesOnly').checked, true);
        assert.equal(page.get('comparisonProfile').value, 'battery');
        const link = new URL(page.get('comparisonPermalink').href);
        assert.equal(link.searchParams.get('models'), `${state.first.listing_id},${state.second.listing_id}`);
        assert.equal(link.searchParams.get('profile'), 'battery');
        assert.equal(link.searchParams.get('keep'), 'yes');
        assert.equal(page.get('compareModel0').value, state.first.listing_id);
        assert.equal(page.get('compareModel1').value, state.second.listing_id);
      } else {
        assert.equal(page.get(home ? 'categoryTop20Search' : 'listingSearch').value, 'Samsung');
        assert.equal(page.get(home ? 'categoryTop20Band' : 'budgetBand').value, state.first.price_band);
        assert.equal(page.get(home ? 'categoryTop20Sort' : 'rankingSort').value, 'value');
        assert.equal(page.get(home ? 'categoryTop20Profile' : 'rankingProfile').value, 'battery');
        if (!home) assert.equal(page.get('reviewView').classList.contains('active'), true);
      }
    };
    state.registry.items[state.second.listing_id].reference_price.price = 5000;
    await page.refresh();
    assert.match(result(), /฿5,000/);
    assert.doesNotMatch(result(), /฿20,000/);
    if (!comparison) assert.deepEqual(ids(), [state.second.listing_id, state.first.listing_id]);
    assertChoices();
    state.failPrices = true;
    await page.refresh();
    assert.match(status(), /พักอันดับชั่วคราว/);
    assert.match(result(), /Samsung Galaxy A37 5G/);
    assert.doesNotMatch(result(), /฿5,000|฿10,000/);
    if (!comparison) assert.deepEqual([...result().matchAll(/data-rank="([^"]*)"/g)].map(m => m[1]), ['', '']);
    assertChoices();
    state.failPrices = false;
    await page.refresh();
    assert.doesNotMatch(status(), /พักอันดับ|โหลด.*ไม่ได้/);
    assert.match(result(), /฿5,000/);
    if (!comparison) assert.deepEqual(ids(), [state.second.listing_id, state.first.listing_id]);
    assertChoices();
    assert.deepEqual(page.errors, []);
    for (const source of ['shopee_feed_rankings.json', 'official_product_specs.json', 'ranking_manual_offers.json', 'shopee_feed_review.json']) {
      assert.equal(page.requests.filter(request => request.name === source).length, 4, source + ' participates in all four reads');
    }
  });
}
