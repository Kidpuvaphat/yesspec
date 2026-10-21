const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(callback) {
  const events = {}, documentEvents = {};
  const window = {
    PhoneValue: {profiles: []},
    document: {hidden: false, addEventListener: (type, fn) => { documentEvents[type] = fn; }},
    addEventListener: (type, fn) => { events[type] = fn; },
    setInterval(fn, ms) { this.interval = fn; assert.equal(ms, 60000); }
  };
  vm.runInNewContext(fs.readFileSync('assets/ranking-offers.js', 'utf8'), {window});
  window.RankingOffers.watchChanges(callback);
  return {window, events, documentEvents};
}

test('a saved price arriving during an in-flight reload triggers a second reload', async () => {
  let complete, calls = 0;
  const first = new Promise(resolve => { complete = resolve; });
  const {events} = harness(async () => { if (++calls === 1) await first; });
  const pending = events.focus();
  assert.equal(calls, 1);
  events.storage({key: 'yesspec_offers_updated'});
  events.storage({key: 'yesspec_offers_updated'});
  assert.equal(calls, 1); // Coalesce events without concurrent reads of stale data.
  complete();
  await pending;
  assert.equal(calls, 2);
  events.storage({key: 'unrelated'});
  assert.equal(calls, 2);
});

test('returning to a hidden page refreshes prices; a failed reload does not lock later updates', async () => {
  let calls = 0;
  const {window, events, documentEvents} = harness(async () => {
    if (++calls === 1) throw new Error('temporary fetch failure');
  });
  window.document.hidden = true;
  await events.focus();
  assert.equal(calls, 0);
  window.document.hidden = false;
  await assert.rejects(documentEvents.visibilitychange(), /temporary fetch failure/);
  await events.focus();
  assert.equal(calls, 2);
});
