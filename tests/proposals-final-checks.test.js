'use strict';
/*
 * Release 3 Proposals - final checks: a whole hand-over between the person's phone and the owner's phone for every action
 * (add, edit, delete, accept, reject, stale, offline, revoked), run through the real save() hook, sending, the owner's inbox
 * and the answer coming back; plus that the version, cache and notes were kept in step. The pieces are tested in
 * proposals.test.js, approved-stamps.test.js, proposal-conflicts.test.js and proposal-pending-edges.test.js.
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
        async set(d) { if (db.failSet) throw new Error('network'); if (db.denySet) throw denied(); docs.set(id, JSON.parse(JSON.stringify(d))); },
        async delete() { if (db.denyDelete) throw denied(); docs.delete(id); },
        async update(p) { Object.assign(docs.get(id), p); } }),
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

describe('add: proposed, sent, accepted', () => {
  test('the person adds -> ledger unchanged -> owner accepts -> record is in the ledger as the person\'s work, and the person sees Accepted', async () => {
    DB(); load(); useDb(db);
    run(`DATA.production.push({ id: 'p3', date: '2026-09-05', loom: 'L1', qty: 9 })`);
    assert.equal(await trySave(), 'held'); await syncWorker();
    assert.equal(data().production.length, 2); assert.equal(db.docs.size, 1);
    const keep = store.get('khata-proposals'), id = idOf(0);
    OWNER_PHONE(); assert.equal((await loadInbox()).length, 1);
    assert.equal((await act(id, 'accepted', 'Good')).result, 'ok');
    assert.deepEqual(data().production.map(r => r.id), ['p1', 'p2', 'p3']); assert.equal(saves, 1);
    const mine = await workerLearns(keep); assert.equal(mine[id].status, 'accepted'); assert.equal(mine[id].note, 'Good');
  });
});

describe('edit: proposed, sent, accepted', () => {
  test('the old value stays until the owner accepts; then the new value is in and the row keeps its own stamps', async () => {
    DB(); load(); useDb(db); run(`DATA.production[0].qty = 50`);
    assert.equal(await trySave(), 'held'); await syncWorker();
    assert.equal(data().production[0].qty, 5);
    const id = idOf(0); OWNER_PHONE(); await loadInbox();
    assert.equal((await act(id, 'accepted', '')).result, 'ok');
    assert.equal(data().production[0].qty, 50); assert.equal(data().production[0]._ct, 1);
  });
});

describe('delete: proposed, sent, accepted', () => {
  test('the record stays until the owner accepts; then it is gone', async () => {
    DB(); load(); useDb(db); run(`DATA.production = DATA.production.filter(r => r.id !== 'p2')`);
    assert.equal(await trySave(), 'held'); await syncWorker();
    assert.equal(data().production.length, 2);
    const id = idOf(0); OWNER_PHONE(); await loadInbox();
    assert.equal((await act(id, 'accepted', '')).result, 'ok');
    assert.deepEqual(data().production.map(r => r.id), ['p1']);
  });
});

describe('reject: nothing changes, the person keeps the reason', () => {
  test('rejected add / edit / delete leave the ledger alone and come back as Rejected with the note, never cleared by themselves', async () => {
    DB(); load(); useDb(db);
    run(`DATA.production.push({ id: 'p3', qty: 9 }); DATA.production[0].qty = 50; DATA.production = DATA.production.filter(r => r.id !== 'p2')`);
    assert.equal(await trySave(), 'held'); await syncWorker();
    const keep = store.get('khata-proposals'), ids = [...db.docs].map(([id]) => id);
    assert.equal(ids.length, 3);
    OWNER_PHONE(); await loadInbox(); const before = data();
    for (const id of ids) assert.equal((await act(id, 'rejected', 'No, see me')).result, 'ok');
    assert.deepEqual(data(), before); assert.equal(saves, 0); assert.equal(run('INBOX_ROWS.length'), 0);
    const mine = await workerLearns(keep);
    for (const id of ids) { assert.equal(mine[id].status, 'rejected'); assert.equal(mine[id].note, 'No, see me'); assert.equal(run(`proposalsDismiss(${JSON.stringify(id)})`), 'kept'); }
    assert.equal(queue().length, 3);
  });
});

describe('stale: the record changed since the person looked', () => {
  test('plain Accept is refused and it stays waiting; Accept anyway puts only their field on top; a record deleted since can only be rejected', async () => {
    DB(); load(); useDb(db); run(`DATA.production[0].qty = 50; DATA.production[1].qty = 60`);
    assert.equal(await trySave(), 'held'); await syncWorker();
    const [a, b] = [...db.docs].map(([id, d]) => [id, JSON.parse(d.payload).after.id]).sort((x, y) => x[1] < y[1] ? -1 : 1).map(x => x[0]);
    OWNER_PHONE(); await loadInbox();
    run(`DATA.production[0].qty = 7; DATA.production[0].loom = 'L9'; DATA.production = DATA.production.filter(r => r.id !== 'p2')`);
    let x = await act(a, 'accepted', ''); assert.equal(x.result, 'conflict'); assert.equal(x.canForce, true);
    assert.equal(db.docs.get(a).status, 'pending'); assert.equal(data().production[0].qty, 7); assert.equal(saves, 0);
    x = await act(a, 'accepted', '', { force: true }); assert.equal(x.result, 'ok');
    assert.equal(data().production[0].qty, 50); assert.equal(data().production[0].loom, 'L9', 'the owner\'s own later change stays');
    x = await act(b, 'accepted', '', { force: true }); assert.equal(x.result, 'conflict'); assert.equal(x.canForce, false);
    assert.equal((await act(b, 'rejected', 'Gone already')).result, 'ok');
  });
});

describe('offline: nothing is lost', () => {
  test('made with no connection -> kept, "Not sent yet" -> sent once when back -> owner sees it -> answer comes back', async () => {
    DB(); load(); useDb(db); run('navigator.onLine = false');
    run(`DATA.production[0].qty = 50`); assert.equal(await trySave(), 'held');
    assert.equal(db.docs.size, 0); assert.equal(run('proposalsUnsentCount()'), 1);
    assert.match(run('proposalsRowHtml')((await run('proposalsMine()'))[0]), /Not sent yet/);
    run('navigator.onLine = true'); await syncWorker(); await syncWorker();
    assert.equal(db.docs.size, 1); assert.equal(run('proposalsUnsentCount()'), 0);
    const keep = store.get('khata-proposals'), id = idOf(0);
    OWNER_PHONE(); await loadInbox(); assert.equal((await act(id, 'accepted', '')).result, 'ok');
    assert.equal((await workerLearns(keep))[id].status, 'accepted');
  });
  test('the owner\'s phone with no connection applies nothing, and the proposal is still waiting', async () => {
    DB(); load(); useDb(db); run(`DATA.production[0].qty = 50`); await trySave(); await syncWorker();
    const id = idOf(0); OWNER_PHONE(); await loadInbox(); db.offlineTx = true;
    assert.equal((await act(id, 'accepted', '')).result, 'offline'); assert.equal(data().production[0].qty, 5); assert.equal(saves, 0);
    db.offlineTx = false; assert.equal((await act(id, 'accepted', '')).result, 'ok');
  });
});

describe('revoked: access ended', () => {
  test('one already sent stays in the owner\'s inbox and can still be answered; one not yet sent stays on the phone marked as such and goes out if access returns', async () => {
    DB(); load(); useDb(db); run(`DATA.production[0].qty = 50`); await trySave(); await syncWorker();
    run(`DATA.production[1].qty = 60`); await trySave();
    db.denySet = true; await syncWorker();
    assert.equal(queue().length, 2); assert.equal(db.docs.size, 1);
    const unsent = queue().find(p => p.sent !== true); assert.equal(unsent.blocked, 'access');
    assert.match(run('proposalsRowHtml')(await run('proposalsMine()').then(l => l.find(p => p.id === unsent.id))), /Not sent \u2014 your access has ended/);
    const sentId = idOf(0); OWNER_PHONE(); assert.equal((await loadInbox()).length, 1);
    assert.equal((await act(sentId, 'accepted', '')).result, 'ok'); assert.equal(data().production[0].qty, 50);
    load(); useDb(db); store.set('khata-proposals', JSON.stringify([unsent])); db.denySet = false; await syncWorker();
    assert.equal(db.docs.size, 2); assert.equal(queue()[0].sent, true);
  });
  test('a person whose access has ended is not able to make new proposals out of thin air: view only applies and nothing is held or stored', async () => {
    load({ grant: false, perms: null, approval: null }); useDb(fakeDb());
    run(`DATA.production[0].qty = 50`);
    assert.equal(run('proposalsWouldHold()'), null); assert.equal(await trySave(), 'blocked'); assert.equal(queue().length, 0);
  });
});

describe('version, cache and notes stay in step (Proposals)', () => {
  const pkg = JSON.parse(read('package.json')), html = read('index.html'), sw = read('service-worker.js'), hosting = read('HOSTING.txt'), readme = read('tests/README.md');
  test('version is the same in package.json and on the header tag; cache version and build label are set', () => {
    assert.equal(html.match(/id="appVersionTag">v([\d.]+)</)[1], pkg.version);
    assert.match(sw, /const CACHE_VERSION = 'v\d+';/); assert.match(html, /<meta name="app-build" content="[^"]+">/);
  });
  test('the service worker caches and index.html loads the proposals script', () => { assert.ok(sw.includes("'./js/proposals.js'")); assert.ok(html.includes('./js/proposals.js')); });
  test('HOSTING.txt explains every action of Proposals', () => {
    assert.match(hosting, /Proposals \(final checks\)/);
    ['add', 'edit', 'delete', 'accept', 'reject', 'stale', 'offline', 'revoked'].forEach(w => assert.match(hosting, new RegExp('\\b' + w, 'i'), w));
  });
  test('the tests README lists the Proposals test files', () => {
    ['proposals.test.js', 'approved-stamps.test.js', 'proposal-conflicts.test.js', 'proposal-pending-edges.test.js', 'proposals-final-checks.test.js'].forEach(f => assert.ok(readme.includes('`' + f + '`'), f));
  });
});
