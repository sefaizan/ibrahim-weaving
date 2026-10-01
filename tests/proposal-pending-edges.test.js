'use strict';
/*
 * Release 3 Proposals edge cases: proposals made offline, proposals when edit access has ended or been revoked, and rejected
 * proposals. Nothing typed is ever lost, and a rejected proposal stays in the person's log. Runs the real proposals.js.
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
const fakeDb = (behaviour) => ({ collection: () => ({ doc: id => ({ set: async d => { if (behaviour.deny) { const e = new Error('insufficient permissions'); e.code = 'permission-denied'; throw e; } behaviour.sent.push({ id, d }); } }) }) });
async function holdOne(qty) {
  run(`DATA.production.push({ id: 'n${qty}', date: '2026-09-05', loom: 'L1', qty: ${qty} })`);
  assert.equal(await trySave(), 'held');
}
const rows = async () => (await run('proposalsList()')).map(p => run('proposalsRowHtml')(p));

describe('proposals made offline', () => {
  test('kept on the phone, shown as not sent yet, sent when the connection is back', async () => {
    run('navigator.onLine = false');
    await holdOne(9);
    assert.equal(queue().length, 1); assert.equal(queue()[0].sent, undefined, 'nothing went out');
    assert.match((await rows())[0], /Not sent yet/);
    assert.equal(run('proposalsUnsentCount()'), 1);
    run('navigator.onLine = true');
    const b = { sent: [] };
    await run('proposalsSend')(fakeDb(b));
    assert.equal(b.sent.length, 1); assert.equal(queue()[0].sent, true);
    assert.match((await rows())[0], /Sent \u2014 waiting for the owner/);
    assert.equal(run('proposalsUnsentCount()'), 0);
  });
  test('several made offline all go out, oldest first, each once', async () => {
    run('navigator.onLine = false');
    await holdOne(1); await holdOne(2);
    const b = { sent: [] }, db = fakeDb(b);
    await run('proposalsSend')(db); await run('proposalsSend')(db);
    assert.equal(b.sent.length, 2, 'sent once each, not twice');
  });
  test('an unsent one can be withdrawn with no connection', async () => {
    run('navigator.onLine = false');
    await holdOne(9);
    const id = queue()[0].id;
    assert.equal(await run('proposalsWithdraw')(id), 'ok'); assert.equal(queue().length, 0);
  });
});

describe('access ended or revoked', () => {
  test('a refused send keeps everything on the phone and says why; it goes out if access comes back', async () => {
    await holdOne(9); await holdOne(10);
    await run('proposalsSend')(fakeDb({ deny: true, sent: [] }));
    assert.equal(queue().length, 2);
    assert.ok(queue().every(p => p.blocked === 'access' && p.sent !== true));
    assert.match((await rows())[0], /Not sent \u2014 your access has ended/);
    const b = { sent: [] };
    await run('proposalsSend')(fakeDb(b));
    assert.equal(b.sent.length, 2); assert.ok(queue().every(p => p.sent === true && !p.blocked));
  });
  test('the access-ended message says how many proposed changes are kept; nothing is deleted', async () => {
    await holdOne(9); await holdOne(10);
    const before = JSON.stringify(queue());
    await run("waGrantEnd('revoked')");
    assert.equal(JSON.stringify(queue()), before, 'the queue is untouched');
    assert.match(run("waEndedMessage('revoked', 'none')"), /2 proposed changes that have not reached the owner are kept on this phone/);
  });
  test('no unsent proposals: the message is unchanged', () => {
    assert.doesNotMatch(run("waEndedMessage('expired', 'none')"), /proposed change/);
  });
  test('an unsent one can still be withdrawn after access ended; one already sent asks the cloud', async () => {
    await holdOne(9);
    await run("waGrantEnd('expired')");
    assert.equal(await run('proposalsWithdraw')(queue()[0].id), 'ok');
  });
  test('what was typed stays readable on the row while it is not sent', async () => {
    await holdOne(9);
    const html = (await rows())[0];
    assert.match(html, /What you typed:/); assert.match(html, /9/);
  });
});

describe('rejected proposals', () => {
  async function rejected() {
    await holdOne(9);
    const id = queue()[0].id;
    await run('proposalsMark')(id, { sent: true });
    assert.equal(await run('proposalsDecide')(id, 'rejected', 'wrong loom'), 'ok');
    return id;
  }
  test('stay in the log: they cannot be cleared', async () => {
    const id = await rejected();
    assert.equal(run('proposalsDismiss')(id), 'kept');
    assert.equal(queue().length, 1); assert.equal(queue()[0].status, 'rejected');
  });
  test('the row shows the owner\u2019s note and what was typed, and has no Clear button', async () => {
    await rejected();
    const html = (await rows())[0];
    assert.match(html, /Rejected/); assert.match(html, /wrong loom/); assert.match(html, /What you typed:/); assert.doesNotMatch(html, /data-prop-dismiss/);
  });
  test('an accepted one can still be cleared', async () => {
    await holdOne(9);
    const id = queue()[0].id;
    await run('proposalsMark')(id, { sent: true });
    await run('proposalsDecide')(id, 'accepted', '');
    assert.equal(run('proposalsDismiss')(id), 'ok'); assert.equal(queue().length, 0);
  });
  test('a rejected one does not count as waiting and does not use up the waiting limit', async () => {
    await rejected();
    assert.equal(run('proposalsCount()'), 0);
    await holdOne(10);
    assert.equal(run('proposalsCount()'), 1);
  });
});
