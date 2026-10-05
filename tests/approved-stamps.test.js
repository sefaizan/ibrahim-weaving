'use strict';
/*
 * Release 3 "Accept" through the normal save path (js/proposals.js proposalsOwnerAct, js/cloud-sync.js recStampEdits,
 * js/audit.js auditNote): when the owner accepts a proposal the change is applied like any other change - tombstones,
 * edit stamps, the audit log, sync - and the stamps show the person who proposed it (_cb / _mb, audit "by") and the owner
 * who approved it (_ca / _ma, audit "ab"). The save() used here runs the REAL stamping, tombstone and audit code.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WORKER = 'worker@example.com', OWNER = 'se.muhammadfaizan@gmail.com';
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const DATA0 = () => ({
  production: [{ id: 'p1', date: '2026-09-01', loom: 'L1', qty: 5, _ct: 1, _cb: 'old@example.com' }, { id: 'p2', date: '2026-09-02', loom: 'L2', qty: 7 }],
  employees: [{ id: 'emp1', name: 'A' }], qualities: ['Q1'], looms: [], businessInfo: { name: 'Ibrahim Weaving' }, openingBalance: 0,
});

let ctx, store, db, saves, pushes;
function fakeDb() {
  const docs = new Map();
  const snapOf = arr => ({ docs: arr, size: arr.length, empty: !arr.length, forEach: f => arr.forEach(f) });
  const d = {
    docs,
    collection: () => ({
      doc: id => ({ id, async set(v) { docs.set(id, JSON.parse(JSON.stringify(v))); }, async delete() { docs.delete(id); }, async update(p) { Object.assign(docs.get(id), p); } }),
      where: (f, op, v) => ({ limit() { return this; }, async get() { return snapOf([...docs].filter(([, x]) => x[f] === v).map(([id, x]) => ({ id, data: () => x }))); } }),
    }),
    async runTransaction(fn) { return fn({ async get(ref) { return { exists: docs.has(ref.id), data: () => docs.get(ref.id) }; }, update(ref, p) { Object.assign(docs.get(ref.id), p); } }); },
  };
  return d;
}
function load() {
  store = new Map(); saves = 0; pushes = 0;
  store.set('khata-cloud-user', JSON.stringify({ email: OWNER, verified: true }));
  store.set('khata-cloud-sync-on', '1');
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {}, animate() {}, classList: { add() {}, toggle() {} } });
  ctx = vm.createContext({
    console: { log() {}, error() {} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp, Uint8Array,
    setTimeout: () => 1, clearTimeout() {}, setInterval() {}, navigator: { onLine: true },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => store.delete(k) },
    document: { getElementById: () => null, createElement: el, body: { appendChild() {}, classList: { toggle() {} } }, addEventListener() {}, head: { appendChild() {} } },
    firebase: { apps: [{}], initializeApp() {}, auth: () => ({ currentUser: null, onAuthStateChanged: () => () => {}, async signOut() {} }), firestore: () => ({}) },
    escHtml: x => String(x), showToast() {}, sha256Hex: async s => 'h' + s.length, switchTab() {}, ensureDataDefaults: async () => false,
    updateUndoButton() {}, TABS: [], CUR_PANEL: 'production',
    encEnabled: () => false, encSeal: async j => j, encOpen: async p => p, skSealSection: async () => { throw new Error('no key'); }, skMustEncrypt: () => false,
  });
  vm.runInContext(`var DATA = ${JSON.stringify(DATA0())}; var CURRENT_TAB = 'production'; var UNDO_SUPPRESS = false; var NEXT_UNDO_LABEL = null;`, ctx);
  ['js/cloud-sync.js', 'js/view-only.js', 'js/write-access.js', 'js/audit.js', 'js/proposals.js'].forEach(f => vm.runInContext(read(f), ctx));
  // the real stamping / tombstone / audit steps of save(), then the parts that only store and push
  ctx.save = async () => { saves++; vm.runInContext('tombRecordDeletions()', ctx); await vm.runInContext('auditCommit()', ctx); };
  db = fakeDb(); ctx.cloudSdkReady = async () => db;
}
const run = c => vm.runInContext(c, ctx);
const j = v => JSON.parse(JSON.stringify(v));
const data = () => j(run('DATA'));
const auditQueue = () => JSON.parse(store.get('khata-audit-queue') || '[]');
const prop = (action, list, recId, before, after, extra) => ({
  by: WORKER, ct: 1700000000000, section: 'production', action, list, recId, status: 'pending', encrypted: false,
  payload: JSON.stringify({ label: 'x', before, after }), ...(extra || {}),
});
async function accept(doc) {
  db.docs.set('p-1', doc);
  await run('proposalsInboxLoad()');
  return j(await run(`proposalsOwnerAct('p-1', 'accepted', '')`));
}
beforeEach(load);

describe('an approved edit', () => {
  test('is stamped as the person\'s edit, approved by the owner; the record\'s own added stamps are kept', async () => {
    const before = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 5 }, after = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 50 };
    const t0 = Date.now();
    assert.equal((await accept(prop('edit', 'production', 'p1', before, after))).result, 'ok');
    const r = data().production[0];
    assert.equal(r.qty, 50); assert.equal(r._mb, WORKER); assert.equal(r._ma, OWNER); assert.ok(r._mt >= t0, 'edit time = when it reached the ledger (merge uses this)');
    assert.equal(r._ct, 1); assert.equal(r._cb, 'old@example.com'); assert.equal(saves, 1);
  });
  test('the Info button says who edited it and who approved it', async () => {
    const before = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 5 }, after = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 50 };
    await accept(prop('edit', 'production', 'p1', before, after));
    ctx.recStampWhen = ms => 'DATE'; run('');
    const src = read('js/panels-wages-receipts.js'); const fn = src.slice(src.indexOf('function recStampLines'), src.indexOf('let _recInfoTimer'));
    vm.runInContext(fn, ctx);
    const lines = run('recStampLines(DATA.production[0])');
    assert.equal(lines[1], 'Last edited by worker@example.com \u00B7 DATE \u00B7 approved by ' + OWNER);
    assert.equal(lines[0], 'Added by old@example.com \u00B7 DATE');
  });
  test('the stamps never count as a change of the record, and searching ignores them', async () => {
    const before = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 5 }, after = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 50 };
    await accept(prop('edit', 'production', 'p1', before, after));
    const a = run('recSigsNow()'); run('tombRecordDeletions()'); assert.deepEqual(j(run('recSigsNow()')), j(a));
    const fn = read('js/panels-wages-receipts.js'); vm.runInContext(fn.slice(fn.indexOf('function recordMatchesSearch'), fn.indexOf('// Renders a paginated')), ctx);
    assert.equal(run(`recordMatchesSearch(DATA.production[0], 'worker@')`), false); assert.equal(run(`recordMatchesSearch(DATA.production[0], '50')`), true);
  });
  test('a later normal edit by the owner takes the approval off: edited by the owner, no "approved by"', async () => {
    const before = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 5 }, after = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 50 };
    await accept(prop('edit', 'production', 'p1', before, after));
    run(`DATA.production[0].qty = 51`); await ctx.save();
    const r = data().production[0]; assert.equal(r._mb, OWNER); assert.equal(r._ma, undefined);
  });
  test('the approval is used once: the next ordinary save is stamped as the owner\'s own', async () => {
    const before = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 5 }, after = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 50 };
    await accept(prop('edit', 'production', 'p1', before, after));
    run(`DATA.production[1].qty = 8`); await ctx.save();
    const r = data().production[1]; assert.equal(r._mb, OWNER); assert.equal(r._ma, undefined); assert.equal(run('REC_APPROVAL'), null);
  });
});

describe('an approved add', () => {
  test('is stamped as added by the person (when they proposed it) and approved by the owner', async () => {
    const after = { id: 'p3', date: '2026-09-05', loom: 'L1', qty: 9 };
    assert.equal((await accept(prop('add', 'production', 'p3', null, after))).result, 'ok');
    const r = data().production.find(x => x.id === 'p3');
    assert.equal(r.qty, 9); assert.equal(r._cb, WORKER); assert.equal(r._ca, OWNER); assert.equal(r._ct, 1700000000000); assert.equal(r._mt, undefined);
  });
});

describe('an approved delete', () => {
  test('goes through the normal tombstone path', async () => {
    const before = { id: 'p2', date: '2026-09-02', loom: 'L2', qty: 7 };
    run('tombRebaseline()');
    assert.equal((await accept(prop('delete', 'production', 'p2', before, null))).result, 'ok');
    assert.deepEqual(data().production.map(r => r.id), ['p1']);
    assert.ok(JSON.stringify(data().deletedIds).includes('p2'), 'a tombstone is written so a cloud merge cannot bring it back');
  });
});

describe('the audit log', () => {
  test('an approved change is logged in the person\'s name with the owner as approver', async () => {
    const before = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 5 }, after = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 50 };
    await accept(prop('edit', 'production', 'p1', before, after));
    const q = auditQueue(); assert.equal(q.length, 1);
    assert.equal(q[0].doc.by, WORKER); assert.equal(q[0].doc.ab, OWNER); assert.equal(q[0].doc.action, 'edit'); assert.equal(q[0].doc.recId, 'p1');
    const body = JSON.parse(q[0].doc.payload); assert.equal(body.before.qty, 5); assert.equal(body.after.qty, 50); assert.equal(body.after._mb, undefined, 'record stamps are left off');
  });
  test('an approved delete and an approved add are logged the same way', async () => {
    run('tombRebaseline()');
    await accept(prop('delete', 'production', 'p2', { id: 'p2', date: '2026-09-02', loom: 'L2', qty: 7 }, null));
    db.docs.clear(); await accept(prop('add', 'production', 'p3', null, { id: 'p3', qty: 9 }));
    const q = auditQueue(); assert.deepEqual(q.map(e => e.doc.action), ['delete', 'add']); q.forEach(e => { assert.equal(e.doc.by, WORKER); assert.equal(e.doc.ab, OWNER); });
  });
  test('an approved setting (business info) is logged the same way', async () => {
    run('tombRebaseline()');
    db.docs.set('p-1', prop('edit', 'businessInfo', '', { name: 'Ibrahim Weaving' }, { name: 'New Name' }, { section: 'business' }));
    await run('proposalsInboxLoad()'); assert.equal(j(await run(`proposalsOwnerAct('p-1', 'accepted', '')`)).result, 'ok');
    const q = auditQueue(); assert.equal(q.length, 1); assert.equal(q[0].doc.by, WORKER); assert.equal(q[0].doc.ab, OWNER); assert.equal(data().businessInfo.name, 'New Name');
  });
  test('the owner\'s own changes are still logged in the owner\'s name, with no approver', async () => {
    run('tombRebaseline()'); run(`DATA.production[0].qty = 6`); await ctx.save();
    const q = auditQueue(); assert.equal(q.length, 1); assert.equal(q[0].doc.by, OWNER); assert.equal(q[0].doc.ab, undefined);
  });
  test('the owner\'s phone sends the entry (it is the approver), and the screen and CSV show both names', async () => {
    const before = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 5 }, after = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 50 };
    await accept(prop('edit', 'production', 'p1', before, after));
    const sent = new Map(); const adb = { collection: n => ({ doc: id => ({ set: async d => { sent.set(n + '/' + id, d); } }) }) };
    const r = j(await run('auditFlush')(adb)); assert.equal(r.sent, 1); assert.equal(r.left, 0);
    const [d] = [...sent.values()]; assert.equal(d.by, WORKER); assert.equal(d.ab, OWNER);
    const html = run('auditRowHtml')({ id: 'x', doc: d, body: { label: 'l', before: null, after: null } }, 0);
    assert.match(html, /worker@example\.com \(approved by se\.muhammadfaizan@gmail\.com\)/);
    run(`AUDIT_ROWS = [${JSON.stringify({ id: 'x', doc: d, body: { label: 'l', before: { qty: 5 }, after: { qty: 50 } } })}]`);
    assert.match(run('auditCsvSource()').cells[0][1], /worker@example\.com \(approved by se\.muhammadfaizan@gmail\.com\)/);
  });
});

describe('Undo, through the real save() of core.js and the real Undo code of shell.js', () => {
  let stored;
  function withRealSaveAndUndo() {
    const core = read('js/core.js'), shell = read('js/shell.js');
    stored = []; const status = { textContent: '' };
    ctx.window = { storage: { set: async (k, v) => { stored.push([k, v]); } } };
    ctx.document.getElementById = id => id === 'statusLine' ? status : null;
    Object.assign(ctx, { fmtRs: x => String(x), fmtDate: x => String(x), fmtQtyMtr: x => String(x), showUndoToast() {}, renderUndoSheet() {}, haptic() {}, clearSaveFailure() {}, noteLedgerSize() {}, showSaveFailure() {}, ledgerToStorage: async () => {} });
    vm.runInContext(`var STORAGE_KEY = 'k', EDITING = null;`, ctx);
    vm.runInContext(shell.slice(shell.indexOf('const UNDO_STACK'), shell.indexOf('function undoAgo')), ctx);
    vm.runInContext(core.slice(core.indexOf('let UNDO_PREV_PARTS'), core.indexOf('async function load(){')).replace('let UNDO_SUPPRESS', 'UNDO_SUPPRESS').replace('let NEXT_UNDO_LABEL', 'NEXT_UNDO_LABEL'), ctx); // the two flags are already declared by load()
    run('UNDO_PREV_PARTS = undoParts(); tombRebaseline()');
  }
  const before = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 5 }, after = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 50 };
  test('an approved edit is stored by the real save(), files an Undo entry named after the person, and sync is scheduled', async () => {
    withRealSaveAndUndo(); let scheduled = 0; ctx.cloudSyncSchedule = () => { scheduled++; };
    ctx.save = vm.runInContext('save', ctx);
    assert.equal((await accept(prop('edit', 'production', 'p1', before, after))).result, 'ok');
    assert.equal(stored.length, 1); assert.equal(scheduled, 1);
    const u = j(run('UNDO_STACK')); assert.equal(u.length, 1); assert.equal(u[0].label, 'Approved change by ' + WORKER);
    const r = JSON.parse(stored[0][1]).production[0]; assert.equal(r._mb, WORKER); assert.equal(r._ma, OWNER);
  });
  test('Undo puts the old record back; the undo is the owner\'s own change (no approval on it)', async () => {
    withRealSaveAndUndo(); ctx.cloudSyncSchedule = () => {}; ctx.save = vm.runInContext('save', ctx);
    await accept(prop('edit', 'production', 'p1', before, after));
    await run(`undoEntry(${run('UNDO_STACK[0].id')})`);
    const r = data().production[0]; assert.equal(r.qty, 5); assert.equal(r._mb, OWNER); assert.equal(r._ma, undefined);
    const q = auditQueue(); assert.equal(q.length, 2); assert.equal(q[1].doc.by, OWNER); assert.equal(q[1].doc.ab, undefined);
  });
  test('an approved delete is stored by the real save(), Undo brings the record back', async () => {
    withRealSaveAndUndo(); ctx.cloudSyncSchedule = () => {}; ctx.save = vm.runInContext('save', ctx);
    assert.equal((await accept(prop('delete', 'production', 'p2', { id: 'p2', date: '2026-09-02', loom: 'L2', qty: 7 }, null))).result, 'ok');
    assert.deepEqual(data().production.map(r => r.id), ['p1']); assert.ok(JSON.stringify(data().deletedIds).includes('p2'));
    assert.equal(j(run('UNDO_STACK'))[0].kind, 'removed');
    await run(`undoEntry(${run('UNDO_STACK[0].id')})`); assert.deepEqual(data().production.map(r => r.id), ['p1', 'p2']);
  });
});

describe('Undo, sync and a conflict', () => {
  test('Accept names the Undo entry, and saves once through the normal path', async () => {
    const before = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 5 }, after = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 50 };
    let label = null; ctx.save = async () => { saves++; label = vm.runInContext('NEXT_UNDO_LABEL', ctx); vm.runInContext('tombRecordDeletions()', ctx); await vm.runInContext('auditCommit()', ctx); };
    await accept(prop('edit', 'production', 'p1', before, after));
    assert.equal(label, 'Approved change by ' + WORKER); assert.equal(saves, 1);
  });
  test('a change that no longer fits is refused: nothing stamped, nothing logged, no approval left behind', async () => {
    const before = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 4 }, after = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 50 };
    const x = await accept(prop('edit', 'production', 'p1', before, after));
    assert.equal(x.result, 'conflict'); assert.equal(data().production[0].qty, 5); assert.equal(data().production[0]._ma, undefined); assert.equal(auditQueue().length, 0); assert.equal(run('REC_APPROVAL'), null);
  });
  test('a save that throws still clears the approval (and, since 3.17.29, takes the change back and puts the proposal back to waiting)', async () => {
    ctx.save = async () => { throw new Error('boom'); };
    const before = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 5 }, after = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 50 };
    db.docs.set('p-1', prop('edit', 'production', 'p1', before, after)); await run('proposalsInboxLoad()');
    const r = await run(`proposalsOwnerAct('p-1', 'accepted', '')`);
    assert.equal(r.result, 'fail'); assert.equal(run('REC_APPROVAL'), null);
    assert.equal(db.docs.get('p-1').status, 'pending', 'the cloud is not left saying accepted');
    assert.equal(data().production.find(x => x.id === 'p1').qty, 5, 'the ledger is as it was');
  });
  test('merge: the approved edit is stamped with its approval time, so a newer edit elsewhere still wins and an older one loses', async () => {
    const before = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 5 }, after = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 50 };
    await accept(prop('edit', 'production', 'p1', before, after));
    const mine = data(), t = mine.production[0]._mt;
    const merged = other => JSON.parse(run(`JSON.stringify(mergeLedgers(DATA, ${JSON.stringify(other)}))`)).production.find(r => r.id === 'p1');
    assert.equal(merged({ production: [{ id: 'p1', qty: 99, _mt: t + 1000 }] }).qty, 99);
    const keep = merged({ production: [{ id: 'p1', qty: 99, _mt: t - 1000 }] }); assert.equal(keep.qty, 50); assert.equal(keep._ma, OWNER);
  });
  test('the new stamp keys are part of the shared stamp list and the audit strip', () => {
    assert.deepEqual(j(run('REC_STAMP_KEYS')), ['_mt', '_mb', '_ct', '_cb', '_ca', '_ma']);
    assert.deepEqual(j(run(`auditStripStamps({ id: 1, _ca: 'a', _ma: 'b', _cb: 'c' })`)), { id: 1 });
  });
});
