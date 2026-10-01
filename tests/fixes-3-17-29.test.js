'use strict';
/*
 * Version 3.17.29 - fixes found by the strict QA pass of 3.17.28:
 *  D1  an Accept whose change could not be stored on the owner's phone is taken back and the proposal goes back to waiting
 *  S1  the cloud rule refuses a person's own write to a section that needs approval (and their phone no longer tries)
 *  S2  audit entries and proposals need the letter that fits the action (view alone is not enough)
 *  B1  a rejected proposal is kept in the audit log
 *  B2  a proposal the cloud already holds is never mistaken for "access ended" when it is sent again
 *  B3  one refused audit entry no longer holds back the others
 *  and: same data in another key order is not a change; the owner is told when more than 200 are waiting.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WORKER = 'worker@example.com', OWNER = 'se.muhammadfaizan@gmail.com';
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const HOUR = 3600 * 1000;
const PERMS = { production: 'vaed', reference: 'vae', sales: 'vae', business: 've', wages: 'v' };   // edit switch on
const DATA0 = () => ({
  production: [{ id: 'p1', date: '2026-09-01', loom: 'L1', qty: 5, _ct: 1, _cb: 'x' }, { id: 'p2', date: '2026-09-02', loom: 'L2', qty: 7 }],
  sale: [{ id: 's1', date: '2026-09-03', client: 'Acme', amt: 100 }],
  employees: [{ id: 'emp1', name: 'A' }], qualities: ['Q1', 'Q2'], looms: [],
  businessInfo: { name: 'Ibrahim Weaving' }, openingBalance: 0, wagePayments: [], wageBonuses: [],
});

let ctx, store, toasts, redraws, opts;
function load(o) {
  opts = Object.assign({ email: WORKER, perms: PERMS, approval: { production: true }, grant: true, enc: false, locked: false, data: DATA0() }, o || {});
  store = new Map(); toasts = []; redraws = [];
  if (opts.email) store.set('khata-cloud-user', JSON.stringify({ email: opts.email, verified: true }));
  if (opts.perms) store.set('khata-cloud-perms', JSON.stringify(opts.perms));
  if (opts.approval) store.set('khata-cloud-needs-approval', JSON.stringify(opts.approval));
  if (opts.grant) store.set('khata-write-grant', JSON.stringify({ email: WORKER, expiresAt: Date.now() + 2 * HOUR }));
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {}, animate() {}, classList: { add() {}, toggle() {} } });
  ctx = vm.createContext({
    console: { log() {}, error() {} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp, Uint8Array,
    setTimeout: () => 1, clearTimeout() {}, setInterval() {}, navigator: { onLine: true },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => { if (opts.storageFull && k === 'khata-proposals') throw new Error('QuotaExceededError'); store.set(k, String(v)); }, removeItem: k => store.delete(k) },
    document: { getElementById: () => null, createElement: el, body: { appendChild() {}, classList: { toggle() {} } }, addEventListener() {}, head: { appendChild() {} } },
    firebase: { apps: [{}], initializeApp() {}, auth: () => ({ currentUser: null, onAuthStateChanged: () => () => {}, async signOut() {} }), firestore: () => ({}) },
    escHtml: x => String(x), showToast: m => toasts.push(m), sha256Hex: async s => 'h' + s.length,
    switchTab() { redraws.push(1); }, tombResetBaseline() {}, ensureDataDefaults: async () => false, UNDO_STACK: [], updateUndoButton() {},
    save: async () => {}, TABS: [], CUR_PANEL: 'production',
    encEnabled: () => opts.enc,
    encSeal: async j => { if (opts.locked) throw new Error('locked'); return 'LOCAL:' + Buffer.from(j, 'utf8').toString('base64'); },
    encOpen: async p => { if (opts.locked) throw new Error('locked'); return Buffer.from(String(p).slice(6), 'base64').toString('utf8'); },
    skSealSection: async () => { throw new Error('no key'); }, skMustEncrypt: () => false,
  });
  vm.runInContext(`var DATA = ${JSON.stringify(opts.data)}; var CURRENT_TAB = 'production'; var UNDO_SUPPRESS = false;`, ctx);
  ['js/cloud-sync.js', 'js/view-only.js', 'js/write-access.js', 'js/audit.js', 'js/proposals.js'].forEach(f => vm.runInContext(read(f), ctx));
  run('VIEW_BASELINE = JSON.stringify(DATA)');   // the page has been drawn: this is the ledger as it is
}
const run = c => vm.runInContext(c, ctx);
const j = v => JSON.parse(JSON.stringify(v));
const queue = () => JSON.parse(store.get('khata-proposals') || '[]');
const data = () => j(run('DATA'));
// What save() does first: decide, then keep and put back.
async function trySave() {
  const held = run('proposalsWouldHold()');
  if (held && await run('proposalsHold')(held)) return 'held';
  return run('viewOnlySaveBlocked()') ? 'blocked' : 'stored';
}
beforeEach(() => load());
function fakeDb() {
  const docs = new Map();
  const denied = () => { const e = new Error('Missing or insufficient permissions'); e.code = 'permission-denied'; return e; };
  const snapOf = arr => ({ docs: arr, size: arr.length, empty: !arr.length, forEach: f => arr.forEach(f) });
  const db = {
    docs, denySet: false, failSet: false, denyDelete: false, offlineTx: false,
    collection: () => ({
      doc: id => ({ id,
        async set(d) { if (db.failSet) throw new Error('network'); if (db.denySet || (db.denyIds && db.denyIds.has(id))) throw denied(); (db.order = db.order || []).push(id); docs.set(id, JSON.parse(JSON.stringify(d))); },
        async delete() { if (db.denyDelete) throw denied(); docs.delete(id); },
        async get() { return { exists: docs.has(id), data: () => docs.get(id) }; },
        async update(p) { if (db.failUpdate) throw new Error('network'); Object.assign(docs.get(id), p); } }),
      where: (f, op, v) => ({ limit() { return this; }, async get() { return snapOf([...docs].filter(([, d]) => d[f] === v).map(([id, d]) => ({ id, data: () => d }))); } }),
    }),
    async runTransaction(fn) { if (db.offlineTx) throw new Error('network'); return fn({ async get(ref) { return { exists: docs.has(ref.id), data: () => docs.get(ref.id) }; }, update(ref, p) { Object.assign(docs.get(ref.id), p); } }); },
  };
  return db;
}
let db, saves;
const useDb = d => { db = d; ctx.cloudSdkReady = async () => d; saves = 0; ctx.save = async () => { saves++; }; };
const OWNER_PHONE = () => { load({ email: OWNER, perms: null, grant: false, approval: null }); useDb(db); };
const syncWorker = () => run('proposalsSync')(db);
async function workerHolds(fn) { load(); useDb(db); run(fn); assert.equal(await trySave(), 'held'); await syncWorker(); }


const DB = () => { db = fakeDb(); useDb(db); };
const loadInbox = async () => { await run('proposalsInboxLoad()'); return j(run('INBOX_ROWS')); };
const idOf = n => [...db.docs][n][0];
const act = (id, status, note, o) => run(`proposalsOwnerAct(${JSON.stringify(id)}, ${JSON.stringify(status)}, ${JSON.stringify(note || '')}, ${o ? JSON.stringify(o) : 'undefined'})`).then(j);
// The person's phone comes back later with the same queue, learns the answers.
async function workerLearns(keep) { load(); useDb(db); store.set('khata-proposals', keep); await syncWorker(); return Object.fromEntries((await run('proposalsMine()')).map(p => [p.id, p])); }


// One edit by the worker, held, sent; then the owner's phone with the inbox loaded.
async function heldAndSent() {
  DB(); load(); useDb(db); run(`DATA.production[0].qty = 50`);
  assert.equal(await trySave(), 'held'); await syncWorker();
  const id = idOf(0); const keep = store.get('khata-proposals');
  OWNER_PHONE(); await loadInbox();
  return { id, keep };
}
const QTY = () => data().production.find(x => x.id === 'p1').qty;

describe('D1: an Accept that could not be stored is taken back', () => {
  test('save() reports false (Locked / Save failed): the ledger is as before, the cloud says pending again, the row stays in the inbox', async () => {
    const { id } = await heldAndSent();
    ctx.save = async () => false;
    const r = await act(id, 'accepted', '');
    assert.equal(r.result, 'fail'); assert.match(r.why, /could not be stored/);
    assert.equal(db.docs.get(id).status, 'pending'); assert.equal(QTY(), 5);
    assert.equal(run('INBOX_ROWS.length'), 1);
  });
  test('save() throws: same - nothing applied, back to waiting, and the audit entries / Undo entries of the failed try are removed', async () => {
    const { id } = await heldAndSent();
    ctx.save = async () => { run(`AUDIT_PENDING.push({ by: 'x', ct: 1, action: 'edit', list: 'production', recId: 'p1', body: {} })`); throw new Error('boom'); };
    const r = await act(id, 'accepted', '');
    assert.equal(r.result, 'fail'); assert.equal(db.docs.get(id).status, 'pending'); assert.equal(QTY(), 5);
    assert.equal(run('AUDIT_PENDING.length'), 0); assert.equal(run('UNDO_STACK.length'), 0);
  });
  test('when the cloud cannot be reached either, the proposal is put back at the next inbox load', async () => {
    const { id } = await heldAndSent();
    ctx.save = async () => false; db.failUpdate = true;
    const r = await act(id, 'accepted', '');
    assert.equal(r.result, 'fail'); assert.match(r.why, /put back in the list when there is a connection/);
    assert.equal(db.docs.get(id).status, 'accepted'); assert.ok(JSON.parse(store.get('khata-inbox-reopen')).includes(id));
    db.failUpdate = false;
    const rows = await loadInbox();
    assert.equal(db.docs.get(id).status, 'pending'); assert.equal(rows.length, 1); assert.equal(store.get('khata-inbox-reopen') || null, null);
  });
  test('a locked owner phone is told before the cloud is touched', async () => {
    const { id } = await heldAndSent();
    opts.enc = true; ctx.ENC_DEK = null;
    const r = await act(id, 'accepted', '');
    assert.equal(r.result, 'fail'); assert.match(r.why, /locked/); assert.equal(db.docs.get(id).status, 'pending'); assert.equal(saves, 0);
  });
  test('a normal Accept still stores the change and answers ok (save() = true or nothing)', async () => {
    const { id } = await heldAndSent();
    ctx.save = async () => { run(`DATA.production[0].qty = 50`); return true; };
    const r = await act(id, 'accepted', '');
    assert.equal(r.result, 'ok'); assert.equal(db.docs.get(id).status, 'accepted'); assert.equal(QTY(), 50);
  });
  test('core.js: save() answers false when it stored nothing and true when it did', () => {
    const c = read('js/core.js');
    assert.match(c, /proposalsHold\(held\)\) return false;/); assert.match(c, /viewOnlySaveBlocked\(\)\) return false;/);
    assert.equal((c.match(/saveOk = true;/g) || []).length, 2); assert.match(c, /return saveOk;\n\}\nasync function load\(\)/);
  });
});

describe('B1: a rejected proposal is kept in the audit log', () => {
  test('Reject leaves the ledger alone and queues an audit entry: proposed by the worker, rejected by the owner, before / after / note', async () => {
    const { id } = await heldAndSent();
    const r = await act(id, 'rejected', 'wrong quantity');
    assert.equal(r.result, 'ok'); assert.equal(saves, 0); assert.equal(QTY(), 5);
    const q = JSON.parse(store.get('khata-audit-queue') || '[]'); assert.equal(q.length, 1);
    const d = q[0].doc, body = JSON.parse(d.payload);
    assert.equal(d.action, 'reject'); assert.equal(d.by, WORKER); assert.equal(d.ab, OWNER); assert.equal(d.list, 'production'); assert.equal(d.section, 'production');
    assert.equal(body.before.qty, 5); assert.equal(body.after.qty, 50); assert.equal(body.note, 'wrong quantity'); assert.equal(body.proposed, 'edit');
    await run('auditFlush')(db);
    const sent = [...db.docs.values()].find(x => x.action === 'reject'); assert.ok(sent); assert.equal(sent.ab, OWNER);
    assert.equal(run('AUDIT_ACTION_LABELS.reject'), 'Rejected');
  });
  test('Accept does not add a reject entry (the change itself is logged by the normal save)', async () => {
    const { id } = await heldAndSent();
    ctx.save = async () => true;
    await act(id, 'accepted', '');
    assert.equal(JSON.parse(store.get('khata-audit-queue') || '[]').filter(x => x.doc.action === 'reject').length, 0);
  });
  test('the Audit screen can filter, show and export rejected entries', () => {
    const a = read('js/audit.js');
    assert.match(a, /\['add', 'edit', 'delete', 'reject'\]/); assert.match(a, /d\.action === 'reject' \? ' \(rejected by '/);
  });
});

describe('B2: sending a proposal again after the owner answered it', () => {
  test('counts as sent (not as ended access) and the answer is read back in the same check', async () => {
    const { id, keep } = await heldAndSent();
    await act(id, 'rejected', 'no');
    load(); useDb(db); db.denySet = true;                       // the rule refuses a second set on an answered proposal
    store.set('khata-proposals', JSON.stringify(JSON.parse(keep).map(p => Object.assign({}, p, { sent: false }))));
    await syncWorker();
    const mine = (await run('proposalsMine()')).find(p => p.id === id);
    assert.equal(mine.status, 'rejected'); assert.equal(mine.sent, true); assert.ok(!mine.blocked);
  });
  test('when the proposal is not in the cloud, a refusal still means access ended', async () => {
    const { id, keep } = await heldAndSent();
    db.docs.delete(id);
    load(); useDb(db); db.denySet = true;
    store.set('khata-proposals', JSON.stringify(JSON.parse(keep).map(p => Object.assign({}, p, { sent: false }))));
    await syncWorker();
    const mine = (await run('proposalsMine()')).find(p => p.id === id);
    assert.equal(mine.status, 'pending'); assert.equal(mine.blocked, 'access');
  });
});

describe('B3: one refused audit entry does not hold back the rest', () => {
  const entry = (n, extra) => Object.assign({ uid: 'a' + n, doc: { by: WORKER, ct: 1000 + n, section: 'production', action: 'edit', list: 'production', recId: 'p' + n, encrypted: false, payload: '{}' } }, extra || {});
  test('the others go out, the refused one stays marked, and is tried last next time', async () => {
    DB(); load(); useDb(db); db.denyIds = new Set(['a2']);
    store.set('khata-audit-queue', JSON.stringify([entry(1), entry(2), entry(3)]));
    const r = await run('auditFlush')(db);
    assert.equal(r.sent, 2); assert.equal(r.left, 1);
    const q = JSON.parse(store.get('khata-audit-queue')); assert.equal(q.length, 1); assert.equal(q[0].uid, 'a2'); assert.ok(q[0].deniedAt > 0);
    assert.equal(run('AUDIT_STATUS.state'), 'denied');
    store.set('khata-audit-queue', JSON.stringify([entry(2, { deniedAt: 5 }), entry(4)])); db.order = []; db.denyIds = new Set();
    await run('auditFlush')(db);
    assert.equal(db.order[0], 'a4'); assert.equal(db.order[1], 'a2');
  });
});

describe('S1 / S2: the cloud rule', () => {
  const rule = () => { const c = vm.createContext({ localStorage: { getItem: () => null } }); vm.runInContext(read('js/cloud-sync.js').split('// True on a view-only phone')[0], c); return vm.runInContext('CLOUD_FIRESTORE_RULE', c); };
  test('S1: a section that needs approval is refused for the person\'s own write (create and update)', () => {
    const r = rule();
    assert.match(r, /function needsApproval\(sec\) \{\s*return grants\(\)\[me\(\)\]\.get\('needsApproval', \{\}\)\.get\(sec, false\) == true;/);
    assert.match(r, /match \/ledger\/\{sec\}[\s\S]*?allow create, update: if isOwner\(\) \|\| \(canChange\(sec\) && !needsApproval\(sec\) && keepsEncryption\(\)\);/);
  });
  test('S1: the person\'s phone does not try to send such a section', () => {
    load(); const w = j(run('cloudWriteSections()')); assert.ok(!w.includes('production')); assert.ok(w.includes('reference') || w.includes('sales'));
    load({ approval: null }); assert.ok(j(run('cloudWriteSections()')).includes('production'));
  });
  test('S2: audit entries and proposals need the letter that fits the action; view alone is not enough', () => {
    const r = rule();
    assert.match(r, /function mayLog\(sec, action\)/);
    ['a', 'e', 'd'].forEach((l, i) => assert.ok(r.includes(`action == '${['add', 'edit', 'delete'][i]}' && grantPerms().get(sec, '').matches('.*${l}.*')`), l));
    assert.equal((r.match(/mayLog\(request\.resource\.data\.section, request\.resource\.data\.action\)/g) || []).length, 2);
    assert.ok(!/mayLog\(request\.resource\.data\.section\)/.test(r));
    assert.ok(!r.includes("grantPerms().get(sec, '') != ''"));
  });
});

describe('small things', () => {
  test('the same record with its fields in another order is not "changed since"', () => {
    assert.equal(run('proposalsSame({ a: 1, b: { c: 2, d: [1, { x: 1, y: 2 }] } }, { b: { d: [1, { y: 2, x: 1 }], c: 2 }, a: 1 })'), true);
    assert.equal(run('proposalsSame({ a: 1 }, { a: 2 })'), false); assert.equal(run('proposalsSame([1, 2], [2, 1])'), false);
  });
  test('the inbox says so when 200 are showing', () => {
    assert.match(read('js/proposals.js'), /Showing the first 200 waiting\./);
  });
});
