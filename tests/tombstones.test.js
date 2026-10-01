'use strict';
/*
 * Deletion tracking (js/cloud-sync.js): a record deleted on one device must stay deleted after a
 * merge with another device, and Undo / restore must not leave wrong "deleted" notes behind.
 * Runs the real file in a sandbox; only DATA and the browser bits it never touches here are faked.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let ctx;
function load(){
  ctx = vm.createContext({ console, Date, Math, JSON, Object, Array, Set, Map, Number, String });
  vm.runInContext('var DATA = {};', ctx);
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud-sync.js'), 'utf8');
  vm.runInContext(src, ctx);
}
const run = code => vm.runInContext(code, ctx);
const set = obj => run(`DATA = ${JSON.stringify(obj)}; tombRebaseline();`);
const data = () => JSON.parse(run('JSON.stringify(DATA)'));

beforeEach(load);

describe('noting deletions on save', () => {
  test('a removed record is noted; untouched ones are not', () => {
    set({ sale: [{ id: 'a' }, { id: 'b' }], clients: [{ id: 'c' }] });
    run(`DATA.sale = DATA.sale.filter(r => r.id !== 'a'); tombRecordDeletions();`);
    const d = data();
    assert.deepEqual(Object.keys(d.deletedIds), ['sale']);
    assert.deepEqual(Object.keys(d.deletedIds.sale), ['a']);
  });
  test('editing or adding records notes nothing', () => {
    set({ sale: [{ id: 'a', amount: 1 }] });
    run(`DATA.sale[0].amount = 2; DATA.sale.push({ id: 'z' }); tombRecordDeletions();`);
    assert.equal(data().deletedIds, undefined);
  });
  test('a record that comes back (Undo) is no longer noted as deleted', () => {
    set({ sale: [{ id: 'a' }] });
    run(`DATA.sale = []; tombRecordDeletions();`);
    assert.ok(data().deletedIds.sale.a);
    run(`DATA.sale = [{ id: 'a' }]; tombRecordDeletions();`);
    assert.equal(data().deletedIds, undefined);
  });
  test('replacing the whole ledger (restore / cloud pull) is not read as deletions', () => {
    set({ sale: [{ id: 'a' }, { id: 'b' }] });
    run(`tombResetBaseline(); DATA = { sale: [{ id: 'x' }] }; tombRecordDeletions();`);
    assert.equal(data().deletedIds, undefined);
    // ...and tracking works again afterwards
    run(`DATA.sale = []; tombRecordDeletions();`);
    assert.ok(data().deletedIds.sale.x);
  });
  test('notes older than a year are dropped', () => {
    set({ sale: [] });
    const old = Date.now() - 400 * 86400000;
    run(`DATA.deletedIds = { sale: { old: ${old}, fresh: ${Date.now()} } }; tombRecordDeletions();`);
    assert.deepEqual(Object.keys(data().deletedIds.sale), ['fresh']);
  });
  test('lists whose records have no id are ignored', () => {
    set({ loomAssignments: [{ loom: 'L1' }] });
    run(`DATA.loomAssignments = []; tombRecordDeletions();`);
    assert.equal(data().deletedIds, undefined);
  });
});

describe('merge respects deletions', () => {
  const merge = (l, r) => JSON.parse(run(`JSON.stringify(mergeLedgers(${JSON.stringify(l)}, ${JSON.stringify(r)}))`));
  test('a record deleted here does not come back from the other device', () => {
    const local = { sale: [{ id: 'b' }], deletedIds: { sale: { a: 5 } } };
    const remote = { sale: [{ id: 'a' }, { id: 'b' }] };
    assert.deepEqual(merge(local, remote).sale.map(r => r.id), ['b']);
  });
  test('a record deleted on the other device is removed here too', () => {
    const local = { sale: [{ id: 'a' }, { id: 'b' }] };
    const remote = { sale: [{ id: 'b' }], deletedIds: { sale: { a: 5 } } };
    const m = merge(local, remote);
    assert.deepEqual(m.sale.map(r => r.id), ['b']);
    assert.ok(m.deletedIds.sale.a);
  });
  test('additions on both sides are still kept, and notes from both sides are combined', () => {
    const local = { sale: [{ id: 'n1' }], deletedIds: { sale: { x: 1 } } };
    const remote = { sale: [{ id: 'n2' }], deletedIds: { sale: { y: 2 }, clients: { z: 3 } } };
    const m = merge(local, remote);
    assert.deepEqual(m.sale.map(r => r.id).sort(), ['n1', 'n2']);
    assert.deepEqual(Object.keys(m.deletedIds.sale).sort(), ['x', 'y']);
    assert.ok(m.deletedIds.clients.z);
  });
  test('same-note-on-both keeps the later time; no notes means no deletedIds key', () => {
    const m = merge({ sale: [], deletedIds: { sale: { a: 1 } } }, { sale: [], deletedIds: { sale: { a: 9 } } });
    assert.equal(m.deletedIds.sale.a, 9);
    assert.equal('deletedIds' in merge({ sale: [{ id: 1 }] }, { sale: [{ id: 2 }] }), false);
  });
  test('numeric ids match their noted (string) ids', () => {
    const m = merge({ sale: [{ id: 7 }, { id: 8 }], deletedIds: { sale: { 7: 5 } } }, { sale: [] });
    assert.deepEqual(m.sale.map(r => r.id), [8]);
  });
});
