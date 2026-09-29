'use strict';
/*
 * Cloud Sync status (js/cloud-sync.js): the "Synced 2 min ago" wording, the check when the app comes
 * back to the foreground (once a minute at most, never over a waiting prompt), and the merge notice
 * that says what the other device brought in. Real file, sandbox with stand-ins for the page.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let ctx, store;
function load(){
  store = new Map([['khata-cloud-sync-on', '1']]);
  ctx = vm.createContext({
    console, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, setTimeout, clearTimeout,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { getElementById: () => null, createElement: () => ({ style: {}, setAttribute(){}, appendChild(){}, remove(){} }), body: { appendChild(){} } },
  });
  vm.runInContext(`var DATA = {};`, ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud-sync.js'), 'utf8'), ctx);
  vm.runInContext(`var __checks = 0; cloudSyncCheckOnStart = function(){ __checks++; CLOUD_LAST_CHECK_AT = Date.now(); };`, ctx);
}
const run = code => vm.runInContext(code, ctx);
beforeEach(load);

describe('"Synced X ago" wording', () => {
  test('just now, minutes, hours, then a date', () => {
    const t = 1_000_000_000_000;
    assert.equal(run(`cloudAgoText(${t}, ${t + 20_000})`), 'just now');
    assert.equal(run(`cloudAgoText(${t}, ${t + 2 * 60_000})`), '2 min ago');
    assert.equal(run(`cloudAgoText(${t}, ${t + 3 * 3600_000})`), '3 h ago');
    assert.equal(run(`cloudAgoShort(${t}, ${t + 2 * 60_000})`), '2m');
    assert.equal(run(`cloudAgoShort(${t}, ${t + 5 * 3600_000})`), '5h');
    assert.equal(run(`cloudAgoShort(${t}, ${t + 30_000})`), 'now');
  });
  test('a successful sync stamps the time and the status line reads from it', () => {
    run(`setCloudStatus('synced')`);
    assert.ok(Number(store.get('khata-cloud-last-ok')) > 0);
    assert.equal(run(`cloudStatusText()`), 'Synced just now');
    store.set('khata-cloud-last-ok', String(Date.now() - 2 * 60_000));
    assert.equal(run(`cloudStatusText()`), 'Synced 2 min ago');
  });
  test('errors and waiting data are not stamped as synced', () => {
    run(`setCloudStatus('error', 'x')`);
    assert.equal(store.has('khata-cloud-last-ok'), false);
  });
});

describe('check when the app comes back', () => {
  test('checks once, then not again within a minute', () => {
    run(`cloudSyncOnForeground(); cloudSyncOnForeground();`);
    assert.equal(run(`__checks`), 1);
    run(`CLOUD_LAST_CHECK_AT = Date.now() - 61000; cloudSyncOnForeground();`);
    assert.equal(run(`__checks`), 2);
  });
  test('does nothing when Cloud Sync is off, while a prompt or conflict waits, or while syncing', () => {
    store.set('khata-cloud-sync-on', '0'); run(`cloudSyncOnForeground()`);
    store.set('khata-cloud-sync-on', '1');
    run(`CLOUD_PENDING_PULL = {}; cloudSyncOnForeground(); CLOUD_PENDING_PULL = null;`);
    run(`CLOUD_STATUS = 'conflict'; cloudSyncOnForeground();`);
    run(`CLOUD_STATUS = 'syncing'; cloudSyncOnForeground();`);
    assert.equal(run(`__checks`), 0);
  });
});

describe('merge notice', () => {
  test('counts new, updated and removed records per list', () => {
    const before = { sale: [{ id: 1, a: 1 }, { id: 2 }], recovery: [], deletedIds: {} };
    const merged = { sale: [{ id: 1, a: 2 }, { id: 3 }, { id: 4 }], recovery: [{ id: 9 }], deletedIds: {} };
    const txt = run(`mergeSummaryText(${JSON.stringify(before)}, ${JSON.stringify(merged)})`);
    assert.match(txt, /\+2 sales/);
    assert.match(txt, /\+1 payment/);
    assert.match(txt, /updated: 1 sale/);
    assert.match(txt, /removed .*1 sale/);
  });
  test('nothing different gives an empty summary', () => {
    const d = { sale: [{ id: 1 }], deletedIds: {} };
    assert.equal(run(`mergeSummaryText(${JSON.stringify(d)}, ${JSON.stringify(d)})`), '');
  });
});
