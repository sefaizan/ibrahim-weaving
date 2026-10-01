'use strict';
/*
 * Cloud sync safety point + Undo (js/cloud-sync.js): applying cloud data first files a safety copy,
 * and Undo puts the old ledger back without letting anything push over the other device's data.
 * The real file runs in a sandbox with stand-ins for storage, saving, screens and the safety-copy store.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let ctx, log;
function load(){
  log = { snaps: [], saves: [], notices: [], status: [], pushes: 0 };
  const store = new Map();
  ctx = vm.createContext({
    console, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, setTimeout, clearTimeout,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { getElementById: () => null, createElement: () => ({ style: {}, setAttribute(){}, appendChild(){}, remove(){} }), body: { appendChild(){} } },
  });
  vm.runInContext(`
    var DATA = { sale: [{ id: 'mine', amount: 1 }] };
    var UNDO_SUPPRESS = false, UNDO_STACK = [1, 2], CURRENT_TAB = 'overview';
    function updateUndoButton(){} function switchTab(){}
    async function sha256Hex(t){ return 'h' + t.length; }
    async function save(){ __log.saves.push(JSON.stringify(DATA)); }
    async function snapAdd(reason, json){ __log.snaps.push({ reason, json }); }
    var __ok = true;`, Object.assign(ctx, { __log: log }));
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud-sync.js'), 'utf8'), ctx);
  // Capture notices instead of drawing them, and count pushes.
  vm.runInContext(`
    cloudDecryptRemote = async function(r){ return { json: r.json }; };
    setCloudStatus = function(s){ __log.status.push(s); };
    var __notices = [];
    showSyncNotice = function(msg, undo){ __notices.push({ msg, undo }); };
    var __pushes = 0;
    cloudPushNow = async function(){ if(!cloudSyncEnabled || CLOUD_PENDING_PULL) return; __pushes++; };`, ctx);
}
const run = code => vm.runInContext(code, ctx);
const data = () => JSON.parse(run('JSON.stringify(DATA)'));

beforeEach(load);

describe('applying cloud data', () => {
  test('files a "before-sync" safety copy of the old ledger, then replaces it', async () => {
    run(`localStorage.setItem(CLOUD_LAST_SEEN_KEY, 'T1'); localStorage.setItem(CLOUD_LAST_HASH_KEY, 'H1');`);
    await run(`cloudApplyRemote({ savedAt: 'T2', json: JSON.stringify({ sale: [{ id: 'theirs' }] }) })`);
    assert.equal(log.snaps.length, 1);
    assert.equal(log.snaps[0].reason, 'before-sync');
    assert.deepEqual(JSON.parse(log.snaps[0].json).sale.map(r => r.id), ['mine']);
    assert.deepEqual(data().sale.map(r => r.id), ['theirs']);
    const n = run('__notices')[0];
    assert.match(n.msg, /synced/i);
    assert.equal(typeof n.undo, 'function');
  });
  test('a failing safety-copy store does not stop the sync', async () => {
    run(`snapAdd = async function(){ throw new Error('no idb'); };`);
    await run(`cloudApplyRemote({ savedAt: 'T2', json: JSON.stringify({ sale: [] }) })`);
    assert.deepEqual(data().sale, []);
  });
});

describe('Undo', () => {
  test('restores the old ledger and marker values, and holds the cloud data as waiting', async () => {
    run(`localStorage.setItem(CLOUD_LAST_SEEN_KEY, 'T1'); localStorage.setItem(CLOUD_LAST_HASH_KEY, 'H1');`);
    await run(`cloudApplyRemote({ savedAt: 'T2', json: JSON.stringify({ sale: [{ id: 'theirs' }] }) })`);
    assert.equal(run(`localStorage.getItem(CLOUD_LAST_SEEN_KEY)`), 'T2');
    await run(`__notices[0].undo()`);
    assert.deepEqual(data().sale.map(r => r.id), ['mine']);
    assert.equal(run(`localStorage.getItem(CLOUD_LAST_SEEN_KEY)`), 'T1');
    assert.equal(run(`localStorage.getItem(CLOUD_LAST_HASH_KEY)`), 'H1');
    assert.notEqual(run('CLOUD_PENDING_PULL'), null);      // pushes are blocked
    assert.equal(run('CLOUD_PENDING_PULL.mode'), 'pull');
    assert.equal(log.status.at(-1), 'waiting');
    assert.equal(run('UNDO_STACK.length'), 0);
    run('cloudSyncEnabled = true;');
    await run('cloudPushNow()');
    assert.equal(run('__pushes'), 0);                        // nothing was pushed over the other device
  });
  test('with no earlier markers, undo clears them again', async () => {
    await run(`cloudApplyRemote({ savedAt: 'T2', json: JSON.stringify({ sale: [] }) })`);
    await run(`__notices[0].undo()`);
    assert.equal(run(`localStorage.getItem(CLOUD_LAST_SEEN_KEY)`), null);
  });
});
