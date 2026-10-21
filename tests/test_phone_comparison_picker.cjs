const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../assets/phone-specs.js');

const storageKey = 'yesspec_compare_phones_v1';
const source = fs.readFileSync(path.join(__dirname, '../assets/phone-comparison.js'), 'utf8');

// Run the real picker entry point without a browser or changes to the application.
function picker(initial = []) {
  const backing = new Map([[storageKey, JSON.stringify(initial)]]);
  const writes = [];
  const documentListeners = new Map();
  const windowListeners = new Map();
  const observers = new Map();
  const targets = new Map(['categoryTop20Results', 'rankingResults'].map(id => [id, {id}]));
  const buttons = Array.from({length: 6}, (_, index) => ({
    dataset: {compareId: `1/${index + 1}`},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  }));
  let tray;
  const document = {
    readyState: 'complete',
    getElementById: id => targets.get(id) || null,
    createElement: () => ({setAttribute() {}}),
    body: {append(element) { tray = element; }},
    querySelectorAll: selector => selector === '[data-compare-id]' ? buttons : [],
    addEventListener(name, callback) { documentListeners.set(name, callback); }
  };
  const sandbox = {
    PhoneSpecs: P,
    RankingOffers: {profiles:['balanced','photo','gaming','work','live','battery'].map(id=>({id}))},
    document,
    localStorage: {
      getItem: key => backing.get(key) ?? null,
      setItem(key, value) { writes.push({key, value}); backing.set(key, value); }
    },
    addEventListener(name, callback) { windowListeners.set(name, callback); },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target) { observers.set(target.id, this.callback); }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, {filename: 'phone-comparison.js'});

  return {
    writes,
    stored: () => JSON.parse(backing.get(storageKey) || '[]'),
    selected: () => {
      const href = /href="([^"]+)"/.exec(tray.innerHTML)[1];
      const value = new URL(href, 'https://yesspec.com/').searchParams.get('models');
      return value ? value.split(',') : [];
    },
    pressed: id => buttons.find(button => button.dataset.compareId === id).attributes['aria-pressed'],
    hidden: () => tray.hidden,
    profile: () => new URL(/href="([^"]+)"/.exec(tray.innerHTML)[1].replaceAll('&amp;','&'),'https://yesspec.com/').searchParams.get('profile'),
    changeProfile(id,profile) {
      backing.set('yesspec_usage_profile_v2',profile);
      documentListeners.get('change')({target:{id}});
    },
    rerender(id) { observers.get(id)(); },
    externalSelection(ids, dispatch = true) {
      const newValue = ids === null ? null : JSON.stringify(ids);
      if (newValue === null) backing.delete(storageKey);
      else backing.set(storageKey, newValue);
      if (dispatch) windowListeners.get('storage')({key: storageKey, newValue});
    },
    unrelatedStorageEvent() {
      windowListeners.get('storage')({key: 'another_preference', newValue: '["1/6"]'});
    },
    click(id) {
      const button = buttons.find(candidate => candidate.dataset.compareId === id);
      assert.ok(button, `Unknown test model: ${id}`);
      documentListeners.get('click')({target: {closest: selector => selector === '[data-compare-id]' ? button : null}});
    },
    clear() {
      documentListeners.get('click')({target: {closest: selector => selector === '[data-compare-clear]' ? {} : null}});
    }
  };
}

test('mounting and ranking rerenders never overwrite a newer selection from another tab', () => {
  const page = picker(['1/1']);
  assert.deepEqual(page.selected(), ['1/1']);
  assert.equal(page.pressed('1/1'), 'true');
  assert.equal(page.writes.length, 0);

  // The other tab has saved, but its storage event has not reached this tab yet.
  page.externalSelection(['1/2', '1/3'], false);
  page.rerender('categoryTop20Results');
  page.rerender('rankingResults');
  assert.deepEqual(page.stored(), ['1/2', '1/3']);
  assert.equal(page.writes.length, 0);
});

test('storage events update the tray and pressed buttons without echoing a storage write', () => {
  const page = picker(['1/1']);
  page.externalSelection(['1/2', '1/3']);
  assert.deepEqual(page.selected(), ['1/2', '1/3']);
  assert.equal(page.pressed('1/1'), 'false');
  assert.equal(page.pressed('1/2'), 'true');
  assert.equal(page.pressed('1/3'), 'true');
  assert.equal(page.hidden(), false);
  page.unrelatedStorageEvent();
  page.rerender('rankingResults');
  assert.deepEqual(page.selected(), ['1/2', '1/3']);
  assert.deepEqual(page.stored(), ['1/2', '1/3']);
  assert.equal(page.writes.length, 0);

  page.externalSelection(null);
  assert.deepEqual(page.selected(), []);
  assert.equal(page.pressed('1/2'), 'false');
  assert.equal(page.hidden(), true);
  assert.equal(page.writes.length, 0);
});

test('user add, remove and clear actions persist the synchronized selection', () => {
  const page = picker(['1/1']);
  page.externalSelection(['1/2', '1/3']);
  page.click('1/4');
  assert.deepEqual(page.stored(), ['1/2', '1/3', '1/4']);
  assert.deepEqual(page.selected(), ['1/2', '1/3', '1/4']);
  assert.equal(page.writes.length, 1);

  page.click('1/2');
  assert.deepEqual(page.stored(), ['1/3', '1/4']);
  assert.equal(page.pressed('1/2'), 'false');
  assert.equal(page.writes.length, 2);

  page.clear();
  assert.deepEqual(page.stored(), []);
  assert.deepEqual(page.selected(), []);
  assert.equal(page.hidden(), true);
  assert.equal(page.writes.length, 3);
  assert.ok(page.writes.every(write => write.key === storageKey));
});

test('attempting to add a fifth model preserves the saved selection without a write', () => {
  const page = picker(['1/1', '1/2', '1/3', '1/4']);
  page.click('1/5');
  assert.deepEqual(page.stored(), ['1/1', '1/2', '1/3', '1/4']);
  assert.deepEqual(page.selected(), ['1/1', '1/2', '1/3', '1/4']);
  assert.equal(page.pressed('1/5'), 'false');
  assert.equal(page.writes.length, 0);
});

test('changing the usage profile in the current page updates the compare link without a storage event', () => {
  const page=picker(['1/1']);
  assert.equal(page.profile(),'balanced');
  page.changeProfile('categoryTop20Profile','photo');
  assert.equal(page.profile(),'photo');
  page.changeProfile('rankingProfile','gaming');
  assert.equal(page.profile(),'gaming');
  assert.deepEqual(page.selected(),['1/1']);
  assert.equal(page.writes.length,0);
});
