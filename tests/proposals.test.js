'use strict';
/*
 * Release 3 step "Proposals" (js/proposals.js, the hook at the top of save() in js/core.js): when a person the owner
 * marked "Needs approval" for a section adds, edits or deletes, the change is kept as a proposal (action, section,
 * list, record, before, after, who, when) instead of changing the ledger, and the ledger is put back. Runs the real
 * cloud-sync.js, view-only.js, write-access.js, audit.js and proposals.js.
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

describe('when a save is held', () => {
  test('an add in a section that needs approval becomes a proposal and the ledger is put back', async () => {
    const before = data();
    run(`DATA.production.push({ id: 'p3', date: '2026-09-05', loom: 'L1', qty: 9 })`);
    assert.equal(await trySave(), 'held');
    assert.deepEqual(data(), before, 'the ledger is exactly as it was');
    const [p] = await run('proposalsList()');
    assert.equal(p.action, 'add'); assert.equal(p.section, 'production'); assert.equal(p.list, 'production'); assert.equal(p.recId, 'p3');
    assert.equal(p.before, null); assert.deepEqual(j(p.after), { id: 'p3', date: '2026-09-05', loom: 'L1', qty: 9 });
    assert.equal(p.by, WORKER); assert.ok(Math.abs(p.ct - Date.now()) < 5000); assert.equal(p.status, 'pending');
    assert.match(toasts[toasts.length - 1], /proposal.*owner approves/); assert.ok(redraws.length >= 1, 'the screen is redrawn from the ledger');
  });
  test('an edit keeps the old and the new value (record stamps left off)', async () => {
    run(`DATA.production[0].qty = 50; DATA.production[0]._mt = 123; DATA.production[0]._mb = 'w'`);
    assert.equal(await trySave(), 'held');
    const [p] = await run('proposalsList()');
    assert.equal(p.action, 'edit'); assert.equal(p.recId, 'p1');
    assert.deepEqual(j(p.before), { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 5 });
    assert.deepEqual(j(p.after), { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 50, });
    assert.equal(data().production[0].qty, 5);
  });
  test('a delete is a proposal too, and the record stays', async () => {
    run(`DATA.production = DATA.production.filter(r => r.id !== 'p2')`);
    assert.equal(await trySave(), 'held');
    const [p] = await run('proposalsList()');
    assert.equal(p.action, 'delete'); assert.equal(p.recId, 'p2'); assert.equal(p.after, null); assert.equal(p.before.qty, 7);
    assert.equal(data().production.length, 2);
    assert.equal(data().deletedIds, undefined, 'no deletion note was left behind');
  });
  test('one proposal per record when a save changes several; each has its own id', async () => {
    run(`DATA.production[0].qty = 1; DATA.production[1].qty = 2; DATA.production.push({ id: 'p9', qty: 3 })`);
    assert.equal(await trySave(), 'held');
    const list = await run('proposalsList()');
    assert.deepEqual(j(list.map(p => p.action + ':' + p.recId).sort()), ['add:p9', 'edit:p1', 'edit:p2']);
    assert.equal(new Set(list.map(p => p.id)).size, 3);
    assert.match(toasts[toasts.length - 1], /3 changes saved as proposals/);
  });
  test('a single setting (business info) is one edit proposal with the old and new value', async () => {
    load({ approval: { business: true } });
    run(`DATA.businessInfo = { name: 'New Name' }`);
    assert.equal(await trySave(), 'held');
    const [p] = await run('proposalsList()');
    assert.equal(p.section, 'business'); assert.equal(p.action, 'edit'); assert.equal(p.list, 'businessInfo'); assert.equal(p.recId, '');
    assert.deepEqual(j(p.before), { name: 'Ibrahim Weaving' }); assert.deepEqual(j(p.after), { name: 'New Name' });
    assert.equal(data().businessInfo.name, 'Ibrahim Weaving');
  });
  test('a list that was only re-ordered is one edit proposal of the list', async () => {
    load({ approval: { reference: true } });
    run(`DATA.qualities = ['Q2', 'Q1']`);
    assert.equal(await trySave(), 'held');
    const list = await run('proposalsList()');
    assert.equal(list.length, 1); assert.equal(list[0].action, 'edit'); assert.equal(list[0].label, 'Order changed');
    assert.deepEqual(j(list[0].before), ['Q1', 'Q2']); assert.deepEqual(j(list[0].after), ['Q2', 'Q1']);
    assert.deepEqual(data().qualities, ['Q1', 'Q2']);
  });
  test('one save is one action: a flagged section and another section in the same save both wait', async () => {
    run(`DATA.production.push({ id: 'p3', qty: 1 }); DATA.sale.push({ id: 's2', client: 'B', amt: 5 })`);
    assert.equal(await trySave(), 'held');
    const list = await run('proposalsList()');
    assert.deepEqual(j(list.map(p => p.section).sort()), ['production', 'sales']);
    assert.equal(data().sale.length, 1); assert.equal(data().production.length, 2);
  });
  test('proposals are not part of the ledger: not in DATA, not in any section that is synced', async () => {
    run(`DATA.production.push({ id: 'p3', qty: 1 })`);
    await trySave();
    assert.equal(JSON.stringify(run('cloudSplit(DATA)')).includes('p3'), false);
    assert.equal(JSON.stringify(data()).includes('proposal'), false);
    assert.equal(run('proposalsCount()'), 1);
  });
  test('the person is told how many are waiting, on their account note', async () => {
    assert.equal(run('waProposalsNoteHtml()'), '');
    run(`DATA.production.push({ id: 'p3', qty: 1 })`); await trySave();
    run(`DATA.production.push({ id: 'p4', qty: 1 })`); await trySave();
    assert.match(run('waAccountNoteHtml()'), /2 changes are<\/b> waiting|2 changes are waiting/);
  });
});

describe('when a save is NOT held', () => {
  test('a change only in sections that do not need approval is stored as always', async () => {
    run(`DATA.sale.push({ id: 's2', client: 'B', amt: 5 })`);
    assert.equal(run('proposalsWouldHold()'), null);
    assert.equal(await trySave(), 'stored');
    assert.equal(data().sale.length, 2); assert.equal(queue().length, 0);
  });
  test('nobody needs approval: everything is stored as always', async () => {
    load({ approval: null });
    run(`DATA.production.push({ id: 'p3', qty: 1 })`);
    assert.equal(run('proposalsWouldHold()'), null); assert.equal(await trySave(), 'stored');
  });
  test('the owner is never held, even if an approval value were stored on the phone', async () => {
    load({ email: OWNER, perms: null, grant: false });
    store.set('khata-cloud-needs-approval', JSON.stringify({ production: true }));
    run(`DATA.production.push({ id: 'p3', qty: 1 })`);
    assert.equal(run('proposalsWouldHold()'), null); assert.equal(await trySave(), 'stored');
  });
  test('a phone that has not been told its permissions is not held', async () => {
    load({ perms: null });
    run(`DATA.production.push({ id: 'p3', qty: 1 })`);
    assert.equal(run('proposalsWouldHold()'), null);
  });
  test('a view-only phone is refused by the usual layer, not turned into proposals', async () => {
    load({ grant: false, perms: { production: 'v' } });
    run(`DATA.production.push({ id: 'p3', qty: 1 })`);
    assert.equal(run('proposalsWouldHold()'), null); assert.equal(await trySave(), 'blocked'); assert.equal(queue().length, 0);
  });
  test('a change the role does not allow at all is refused as before, not proposed', async () => {
    load({ perms: { production: 'va' }, approval: { production: true } });   // add only: no delete
    run(`DATA.production = DATA.production.filter(r => r.id !== 'p2')`);
    assert.equal(run('proposalsWouldHold()'), null);
    assert.equal(await trySave(), 'blocked'); assert.equal(queue().length, 0);
    assert.match(toasts[toasts.length - 1], /can.t delete entries in Production/);
    assert.equal(data().production.length, 2);
  });
  test('nothing changed, or only defaults filled in, is not a proposal', async () => {
    assert.equal(run('proposalsWouldHold()'), null);
    run(`DATA.loomAssignments = []; DATA.wageRateHistory = {}`);
    assert.equal(run('proposalsWouldHold()'), null);
  });
  test('the cloud copy arriving is never held', async () => {
    run(`DATA.production.push({ id: 'p3', qty: 1 }); VIEW_SAVE_ALLOWED = true`);
    assert.equal(run('proposalsWouldHold()'), null);
  });
});

describe('nothing is lost or let through when something goes wrong', () => {
  test('if the proposal cannot be kept (storage full) nothing is proposed and nothing is changed', async () => {
    load({ storageFull: true });
    run(`DATA.production.push({ id: 'p3', qty: 1 })`);
    assert.equal(await trySave(), 'held');
    assert.equal(data().production.length, 2); assert.equal(queue().length, 0);
    assert.match(toasts[toasts.length - 1], /Nothing was changed/);
  });
  test('too many waiting: the change is refused with a message and the ledger is untouched', async () => {
    store.set('khata-proposals', JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ id: 'x' + i, by: WORKER, ct: 1, status: 'pending', payload: '{}' }))));
    run(`DATA.production.push({ id: 'p3', qty: 1 })`);
    assert.equal(await trySave(), 'held');
    assert.equal(queue().length, 500); assert.equal(data().production.length, 2);
    assert.match(toasts[toasts.length - 1], /too many changes are already waiting/);
  });
  test('an error while deciding does not let the change through', async () => {
    run(`DATA.production.push({ id: 'p3', qty: 1 }); permsViolation = () => { throw new Error('boom'); }`);
    const held = run('proposalsWouldHold()');
    assert.equal(held, 'fail');
    assert.equal(await run('proposalsHold')(held), true);
    assert.equal(data().production.length, 2); assert.equal(queue().length, 0);
  });
  test('the decision cannot be skipped by a fault elsewhere in the file: it fails closed only when something needs approval', () => {
    run(`cloudSplit = () => { throw new Error('boom'); }; DATA.production.push({ id: 'p3' })`);
    assert.equal(run('proposalsWouldHold()'), 'fail');
    load({ approval: null }); run(`cloudSplit = () => { throw new Error('boom'); }`);
    assert.equal(run('proposalsWouldHold()'), null);
  });
  test('two holds at once: the second is refused politely, nothing is lost', async () => {
    load({ enc: true });   // sealing takes a moment, so the first hold is still busy when the second arrives
    run(`DATA.production.push({ id: 'p3', qty: 1 })`);
    const held = run('proposalsWouldHold()');
    const first = run('proposalsHold')(held);
    run(`DATA.production.push({ id: 'p4', qty: 1 })`);
    const second = await run('proposalsHold')(run('proposalsWouldHold()'));
    await first;
    assert.equal(second, true); assert.match(toasts.join('|'), /Wait a moment/);
    assert.equal(queue().length, 1);
  });
});

describe('private: nothing readable next to an encrypted ledger', () => {
  test('with Encrypt Data on, before / after / label are sealed on the phone; who, when, section, action stay plain', async () => {
    load({ enc: true });
    run(`DATA.sale.push({ id: 's2', client: 'Secret Client', amt: 5 })`); // section sales: not flagged, so flag it
    load({ enc: true, approval: { sales: true } });
    run(`DATA.sale.push({ id: 's2', client: 'Secret Client', amt: 5 })`);
    assert.equal(await trySave(), 'held');
    const raw = store.get('khata-proposals');
    assert.equal(raw.includes('Secret Client'), false, 'no readable ledger value in the stored queue');
    const [q] = queue();
    assert.equal(q.local, true); assert.match(q.payload, /^LOCAL:/); assert.equal(q.action, 'add'); assert.equal(q.section, 'sales'); assert.equal(q.by, WORKER);
    const [p] = await run('proposalsList()');
    assert.equal(p.after.client, 'Secret Client');
  });
  test('locked (no key to seal with): nothing is kept and nothing is changed', async () => {
    load({ enc: true, locked: true, approval: { sales: true } });
    run(`DATA.sale.push({ id: 's2', client: 'B', amt: 5 })`);
    assert.equal(await trySave(), 'held');
    assert.equal(queue().length, 0); assert.equal(data().sale.length, 1); assert.match(toasts[toasts.length - 1], /Nothing was changed/);
  });
  test('without encryption the queue holds plain values (same as the ledger on that phone)', async () => {
    run(`DATA.production.push({ id: 'p3', qty: 1 })`); await trySave();
    assert.equal(queue()[0].local, false); assert.match(queue()[0].payload, /"qty":1/);
  });
});

describe('how it is wired', () => {
  test('save() asks the proposals gate first, before the view-only gate and before anything is stored', () => {
    const core = read('js/core.js'), at = core.indexOf('async function save(){');
    const a = core.indexOf('proposalsWouldHold', at), b = core.indexOf('viewOnlySaveBlocked()', at), c = core.indexOf('Saving', at);
    assert.ok(a > at && a < b && b < c);
  });
  test('proposals.js is loaded after audit.js and before lock-init.js, and is cached offline', () => {
    const html = read('index.html'), sw = read('service-worker.js');
    const at = f => html.indexOf('./js/' + f);
    assert.ok(at('audit.js') < at('proposals.js') && at('proposals.js') < at('lock-init.js'));
    assert.ok(sw.includes("'./js/proposals.js'"));
  });
  test('a normal save is not delayed: the gate answers at once when nothing is held', () => {
    assert.equal(run('proposalsWouldHold()'), null);
    assert.equal(run('proposalsWouldHold.constructor.name'), 'Function', 'an ordinary function, not an async one: save() does not wait for it');
  });
});

describe('through the real save() of core.js', () => {
  // Runs save() exactly as written in js/core.js, with stand-ins for the storage and screen it touches.
  let stored, status;
  function withRealSave() {
    const core = read('js/core.js');
    const src = core.slice(core.indexOf('async function save(){'), core.indexOf('async function load(){'));
    stored = []; status = { textContent: '' };
    ctx.window = { storage: { set: async (k, v) => { stored.push([k, v]); } } };
    ctx.document.getElementById = id => id === 'statusLine' ? status : null;
    vm.runInContext(`var STORAGE_KEY = 'k', UNDO_PREV_PARTS = null, NEXT_UNDO_LABEL = null; var haptic = () => {}, clearSaveFailure = () => {}, noteLedgerSize = () => {}, showSaveFailure = () => {}, undoParts = () => ({}), recordUndoEntry = () => null, ledgerToStorage = async () => {};`, ctx);
    vm.runInContext(src.replace('async function save(){', 'var realSave = async function(){'), ctx);
  }
  test('a held change: save() stops before it says Saving, stores nothing, and the ledger is as it was', async () => {
    withRealSave();
    const before = data();
    run(`DATA.production.push({ id: 'p3', qty: 1 })`);
    await run('realSave()');
    assert.equal(status.textContent, ''); assert.equal(stored.length, 0);
    assert.deepEqual(data(), before); assert.equal(queue().length, 1);
  });
  test('an edit and a delete go through the same way', async () => {
    withRealSave();
    run(`DATA.production[0].qty = 99`); await run('realSave()');
    run(`DATA.production = DATA.production.filter(r => r.id !== 'p2')`); await run('realSave()');
    assert.equal(stored.length, 0); assert.deepEqual(queue().map(q => q.action), ['edit', 'delete']);
    assert.equal(data().production.length, 2); assert.equal(data().production[0].qty, 5);
  });
  test('an ordinary change (section that does not need approval) is stored by the same save()', async () => {
    withRealSave();
    run(`DATA.sale.push({ id: 's2', client: 'B', amt: 5 })`);
    await run('realSave()');
    assert.equal(stored.length, 1); assert.equal(status.textContent, 'Saved'); assert.equal(queue().length, 0);
    assert.equal(data().sale.length, 2);
  });
  test('after a stored change the next held one is compared with the new ledger, not the old one', async () => {
    withRealSave();
    run(`DATA.sale.push({ id: 's2', client: 'B', amt: 5 })`); await run('realSave()');
    run(`DATA.production.push({ id: 'p3', qty: 1 })`); await run('realSave()');
    const [p] = queue(); assert.equal(queue().length, 1); assert.equal(p.section, 'production');
    assert.equal(data().sale.length, 2, 'the earlier stored change is still there');
  });
  test('the owner\'s save() is untouched by all of this', async () => {
    load({ email: OWNER, perms: null, grant: false, approval: null });
    withRealSave();
    run(`DATA.production.push({ id: 'p3', qty: 1 })`); await run('realSave()');
    assert.equal(stored.length, 1); assert.equal(data().production.length, 3);
  });
});

describe('what the person sees and can do with their own proposals', () => {
  const hold = async () => { run(`DATA.production.push({ id: 'p3', date: '2026-09-05', loom: 'L1', qty: 9 })`); assert.equal(await trySave(), 'held'); };
  test('a waiting proposal is listed with the tag "Waiting for approval" and a Withdraw button', async () => {
    await hold();
    const [p] = await run('proposalsMine()');
    const html = run('proposalsRowHtml')(p);
    assert.match(html, /Not sent yet/); assert.match(html, /data-prop-withdraw=/); assert.match(html, /Added/); assert.match(html, /Production/);
    assert.doesNotMatch(html, /Accepted|Rejected|Owner/);
  });
  test('withdrawing removes it from the queue; the ledger is untouched; a second withdraw finds nothing', async () => {
    await hold();
    const before = data(); const [p] = await run('proposalsMine()');
    assert.equal(await run(`proposalsWithdraw(${JSON.stringify(p.id)})`), 'ok');
    assert.equal(queue().length, 0); assert.equal(store.has('khata-proposals'), false); assert.deepEqual(data(), before); assert.equal(run('proposalsCount()'), 0);
    assert.equal(await run(`proposalsWithdraw(${JSON.stringify(p.id)})`), 'missing');
  });
  test('only one is withdrawn; the others keep waiting', async () => {
    run(`DATA.production[0].qty = 1; DATA.production[1].qty = 2`); assert.equal(await trySave(), 'held');
    const [a, b] = await run('proposalsMine()');
    assert.equal(await run(`proposalsWithdraw(${JSON.stringify(a.id)})`), 'ok');
    assert.deepEqual(queue().map(q => q.id), [b.id]);
  });
  test('an accepted proposal shows "Accepted" with the owner\'s note and can no longer be withdrawn', async () => {
    await hold(); const [p] = await run('proposalsMine()');
    assert.equal(await run(`proposalsDecide(${JSON.stringify(p.id)}, 'accepted', '  Fine, thanks  ')`), 'ok');
    const [q] = await run('proposalsMine()');
    assert.equal(q.status, 'accepted'); assert.equal(q.note, 'Fine, thanks'); assert.ok(q.decidedAt > 0);
    const html = run('proposalsRowHtml')(q);
    assert.match(html, /Accepted/); assert.match(html, /Owner.s note:<\/b> Fine, thanks/); assert.doesNotMatch(html, /Waiting for approval|data-prop-withdraw/);
    assert.equal(await run(`proposalsWithdraw(${JSON.stringify(p.id)})`), 'decided'); assert.equal(queue().length, 1);
    assert.equal(run('proposalsCount()'), 0, 'no longer counted as waiting');
  });
  test('a rejected proposal shows "Rejected" with the note; the first answer stands', async () => {
    await hold(); const [p] = await run('proposalsMine()');
    assert.equal(await run(`proposalsDecide(${JSON.stringify(p.id)}, 'rejected', 'Wrong loom')`), 'ok');
    assert.equal(await run(`proposalsDecide(${JSON.stringify(p.id)}, 'accepted', 'changed my mind')`), 'decided');
    const [q] = await run('proposalsMine()'); const html = run('proposalsRowHtml')(q);
    assert.equal(q.status, 'rejected'); assert.match(html, /Rejected/); assert.match(html, /Wrong loom/); assert.doesNotMatch(html, /changed my mind/);
  });
  test('a decision with no note shows no note line; bad status and unknown id are refused', async () => {
    await hold(); const [p] = await run('proposalsMine()');
    assert.equal(await run(`proposalsDecide(${JSON.stringify(p.id)}, 'maybe', 'x')`), 'bad-status');
    assert.equal(await run(`proposalsDecide('nope', 'accepted', 'x')`), 'missing');
    assert.equal(await run(`proposalsDecide(${JSON.stringify(p.id)}, 'accepted')`), 'ok');
    assert.doesNotMatch(run('proposalsRowHtml')((await run('proposalsMine()'))[0]), /Owner.s note/);
  });
  test('the owner\'s note is escaped (it is shown on the page)', async () => {
    await hold(); const [p] = await run('proposalsMine()');
    ctx.escHtml = x => String(x).replace(/</g, '&lt;');
    await run(`proposalsDecide(${JSON.stringify(p.id)}, 'rejected', '<b>hi</b>')`);
    assert.match(run('proposalsRowHtml')((await run('proposalsMine()'))[0]), /&lt;b>hi/);
  });
  test('a decided one can be cleared from the list; a waiting one cannot', async () => {
    await hold(); const [p] = await run('proposalsMine()');
    assert.equal(run(`proposalsDismiss(${JSON.stringify(p.id)})`), 'pending'); assert.equal(queue().length, 1);
    await run(`proposalsDecide(${JSON.stringify(p.id)}, 'accepted', '')`);
    assert.equal(run(`proposalsDismiss(${JSON.stringify(p.id)})`), 'ok'); assert.equal(queue().length, 0);
  });
  test('only this account\'s proposals are listed or withdrawn', async () => {
    await hold();
    const q = queue(); q.push(Object.assign({}, q[0], { id: 'pother', by: 'someone@else.com' })); store.set('khata-proposals', JSON.stringify(q));
    assert.equal((await run('proposalsMine()')).length, 1);
    assert.equal(await run(`proposalsWithdraw('pother')`), 'missing'); assert.equal(queue().length, 2);
  });
  test('with Encrypt Data on, the note is sealed with the rest and is never readable in the queue', async () => {
    load({ enc: true }); await hold(); const [p] = await run('proposalsMine()');
    assert.equal(await run(`proposalsDecide(${JSON.stringify(p.id)}, 'rejected', 'secret reason')`), 'ok');
    assert.doesNotMatch(store.get('khata-proposals'), /secret reason/);
    const [q] = await run('proposalsMine()'); assert.equal(q.note, 'secret reason'); assert.equal(q.status, 'rejected');
  });
  test('locked with Encrypt Data on: the decision is not recorded (nothing readable is kept) and the entry stays waiting', async () => {
    load({ enc: true }); await hold(); const [p] = await run('proposalsMine()');
    opts.locked = true;
    assert.equal(await run(`proposalsDecide(${JSON.stringify(p.id)}, 'accepted', 'x')`), 'fail');
    assert.equal(queue()[0].status, 'pending');
  });
  test('the Settings note carries the list box only when this account has proposals', async () => {
    assert.equal(run('proposalsBoxHtml()'), ''); await hold();
    assert.match(run('proposalsBoxHtml()'), /id="proposalsBox"/); assert.match(run('waAccountNoteHtml()'), /id="proposalsBox"/);
  });
});


// ---- Sending to the owner, the owner's inbox, and the answer coming back -------------------------------------------
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

describe('sending to the owner', () => {
  beforeEach(() => { db = fakeDb(); useDb(db); });
  test('a held change is sent as a pending document with who, when, section, action and what it was', async () => {
    await workerHolds(`DATA.production[0].qty = 50`);
    assert.equal(db.docs.size, 1);
    const [id, d] = [...db.docs][0];
    assert.equal(d.by, WORKER); assert.equal(d.status, 'pending'); assert.equal(d.section, 'production'); assert.equal(d.action, 'edit'); assert.equal(d.recId, 'p1'); assert.equal(d.encrypted, false);
    assert.equal(JSON.parse(d.payload).after.qty, 50); assert.equal(JSON.parse(d.payload).before.qty, 5);
    assert.equal(queue()[0].sent, true); assert.equal(queue()[0].id, id);
  });
  test('it is sent once, not again at the next check', async () => {
    await workerHolds(`DATA.production[0].qty = 50`);
    db.docs.clear(); await syncWorker(); assert.equal(db.docs.size, 0);
  });
  test('no connection: it stays queued unsent and the failure is raised; the next check sends it', async () => {
    load(); useDb(db); run(`DATA.production[0].qty = 50`); await trySave();
    db.failSet = true; await assert.rejects(syncWorker()); assert.notEqual(queue()[0].sent, true); assert.equal(db.docs.size, 0);
    db.failSet = false; await syncWorker(); assert.equal(db.docs.size, 1);
  });
  test('the cloud refusing it (rule not pasted yet) leaves it queued without an error', async () => {
    load(); useDb(db); run(`DATA.production[0].qty = 50`); await trySave();
    db.denySet = true; await syncWorker(); assert.equal(queue().length, 1); assert.notEqual(queue()[0].sent, true);
  });
  test('with Encrypt Data on, nothing readable is sent when the section key is not on the phone', async () => {
    load({ enc: true }); useDb(db); run(`DATA.production[0].qty = 50`); await trySave(); await syncWorker();
    assert.equal(db.docs.size, 0); assert.doesNotMatch(store.get('khata-proposals'), /"qty":50/);
  });
  test('the owner\'s answer comes back: status and note are recorded on the person\'s phone', async () => {
    await workerHolds(`DATA.production[0].qty = 50`);
    const [id, d] = [...db.docs][0]; d.status = 'rejected'; d.notePayload = 'Wrong loom'; d.noteEncrypted = false;
    await syncWorker();
    const [p] = await run('proposalsMine()'); assert.equal(p.status, 'rejected'); assert.equal(p.note, 'Wrong loom');
    assert.match(toasts[toasts.length - 1], /owner has answered/);
  });
  test('an answer with no note shows none, and still waiting ones stay waiting', async () => {
    await workerHolds(`DATA.production[0].qty = 1; DATA.production[1].qty = 2`);
    const [aid, a] = [...db.docs][0]; a.status = 'accepted'; a.notePayload = ''; await syncWorker();
    const list = await run('proposalsMine()'); const acc = list.find(p => p.id === aid);
    assert.deepEqual(j(list.map(p => p.status).sort()), ['accepted', 'pending']); assert.equal(acc.status, 'accepted'); assert.equal(acc.note, '');
  });
  test('withdrawing one that was sent removes it from the cloud too', async () => {
    await workerHolds(`DATA.production[0].qty = 50`);
    const [id] = [...db.docs][0];
    assert.equal(await run(`proposalsWithdraw(${JSON.stringify(id)})`), 'ok'); assert.equal(db.docs.size, 0); assert.equal(queue().length, 0);
  });
  test('withdrawing one that was sent needs a connection, and nothing changes without it', async () => {
    await workerHolds(`DATA.production[0].qty = 50`);
    const [id] = [...db.docs][0]; ctx.navigator.onLine = false;
    assert.equal(await run(`proposalsWithdraw(${JSON.stringify(id)})`), 'offline'); assert.equal(db.docs.size, 1); assert.equal(queue().length, 1);
    ctx.navigator.onLine = true; db.failSet = false; db.denyDelete = false;
  });
  test('withdrawing after the owner has answered is refused, and the answer is shown instead', async () => {
    await workerHolds(`DATA.production[0].qty = 50`);
    const [id, d] = [...db.docs][0]; d.status = 'accepted'; d.notePayload = 'done'; db.denyDelete = true;
    assert.equal(await run(`proposalsWithdraw(${JSON.stringify(id)})`), 'decided');
    const [p] = await run('proposalsMine()'); assert.equal(p.status, 'accepted'); assert.equal(p.note, 'done'); assert.equal(db.docs.size, 1);
  });
});

describe('the owner\'s inbox', () => {
  beforeEach(() => { db = fakeDb(); useDb(db); });
  const loadInbox = async () => { await run('proposalsInboxLoad()'); return j(run('INBOX_ROWS')); };
  test('lists what is waiting with who, when, what it was and what it would become', async () => {
    await workerHolds(`DATA.production[0].qty = 50`);
    OWNER_PHONE(); const rows = await loadInbox();
    assert.equal(rows.length, 1); assert.equal(rows[0].doc.by, WORKER); assert.ok(Math.abs(rows[0].doc.ct - Date.now()) < 5000);
    const html = run('proposalsInboxRowHtml')(rows[0]);
    assert.match(html, /worker@example\.com/); assert.match(html, /Edited/); assert.match(html, /Quantity/); assert.match(html, /<s>5<\/s>/); assert.match(html, />50</);
    assert.match(html, /data-inb-accept=/); assert.match(html, /data-inb-reject=/); assert.match(html, /data-inb-note=/); assert.doesNotMatch(html, /audit-detail" hidden/);
  });
  test('answered ones are not listed; oldest first', async () => {
    await workerHolds(`DATA.production[0].qty = 50; DATA.production[1].qty = 60`);
    [...db.docs][1][1].status = 'rejected';
    OWNER_PHONE(); assert.equal((await loadInbox()).length, 1);
  });
  test('Accept puts an edit into the ledger, records the note for the person, and removes it from the inbox', async () => {
    await workerHolds(`DATA.production[0].qty = 50`);
    const [id] = [...db.docs][0]; OWNER_PHONE(); await loadInbox();
    const x = j(await run(`proposalsOwnerAct(${JSON.stringify(id)}, 'accepted', '  Looks right ')`));
    assert.equal(x.result, 'ok'); assert.equal(data().production[0].qty, 50); assert.equal(data().production[0]._ct, 1, 'the record\'s own stamps are kept'); assert.equal(saves, 1);
    assert.equal(db.docs.get(id).status, 'accepted'); assert.equal(db.docs.get(id).notePayload, 'Looks right'); assert.equal(run('INBOX_ROWS.length'), 0);
  });
  test('Accept of an add and of a delete', async () => {
    await workerHolds(`DATA.production.push({ id: 'p3', date: '2026-09-05', loom: 'L1', qty: 9 }); DATA.production = DATA.production.filter(r => r.id !== 'p2')`);
    // one save: both are proposals
    OWNER_PHONE(); const rows = await loadInbox(); assert.equal(rows.length, 2);
    for (const r of rows) assert.equal(j(await run(`proposalsOwnerAct(${JSON.stringify(r.id)}, 'accepted', '')`)).result, 'ok');
    assert.deepEqual(data().production.map(r => r.id).sort(), ['p1', 'p3']); assert.equal(saves, 2);
  });
  test('Reject leaves the ledger alone and records the note', async () => {
    await workerHolds(`DATA.production[0].qty = 50`);
    const [id] = [...db.docs][0]; OWNER_PHONE(); await loadInbox(); const before = data();
    assert.equal(j(await run(`proposalsOwnerAct(${JSON.stringify(id)}, 'rejected', 'Wrong loom')`)).result, 'ok');
    assert.deepEqual(data(), before); assert.equal(saves, 0); assert.equal(db.docs.get(id).status, 'rejected'); assert.equal(db.docs.get(id).notePayload, 'Wrong loom'); assert.equal(run('INBOX_ROWS.length'), 0);
  });
  test('a note is optional', async () => {
    await workerHolds(`DATA.production[0].qty = 50`);
    const [id] = [...db.docs][0]; OWNER_PHONE(); await loadInbox();
    await run(`proposalsOwnerAct(${JSON.stringify(id)}, 'rejected')`); assert.equal(db.docs.get(id).notePayload, '');
  });
  test('Accept refuses an edit when the record has changed since, and the proposal stays waiting', async () => {
    await workerHolds(`DATA.production[0].qty = 50`);
    const [id] = [...db.docs][0]; OWNER_PHONE(); await loadInbox(); run(`DATA.production[0].qty = 7`);
    const x = j(await run(`proposalsOwnerAct(${JSON.stringify(id)}, 'accepted', '')`));
    assert.equal(x.result, 'conflict'); assert.match(x.why, /changed since/); assert.equal(data().production[0].qty, 7); assert.equal(db.docs.get(id).status, 'pending'); assert.equal(saves, 0); assert.equal(run('INBOX_ROWS.length'), 1);
  });
  test('Accept refuses a delete of a record that is already gone', async () => {
    await workerHolds(`DATA.production = DATA.production.filter(r => r.id !== 'p2')`);
    const [id] = [...db.docs][0]; OWNER_PHONE(); await loadInbox(); run(`DATA.production = DATA.production.filter(r => r.id !== 'p2')`);
    assert.equal(j(await run(`proposalsOwnerAct(${JSON.stringify(id)}, 'accepted', '')`)).result, 'conflict');
  });
  test('a single setting (business info) is applied when it is still as it was', async () => {
    load({ approval: { business: true } }); useDb(db); run(`DATA.businessInfo = { name: 'New Name' }`); await trySave(); await syncWorker();
    const [id] = [...db.docs][0]; OWNER_PHONE(); await loadInbox();
    assert.equal(j(await run(`proposalsOwnerAct(${JSON.stringify(id)}, 'accepted', '')`)).result, 'ok'); assert.equal(data().businessInfo.name, 'New Name');
  });
  test('answered on another phone first: nothing is applied here', async () => {
    await workerHolds(`DATA.production[0].qty = 50`);
    const [id, d] = [...db.docs][0]; OWNER_PHONE(); await loadInbox(); d.status = 'rejected';
    assert.equal(j(await run(`proposalsOwnerAct(${JSON.stringify(id)}, 'accepted', '')`)).result, 'decided'); assert.equal(data().production[0].qty, 5); assert.equal(saves, 0);
  });
  test('no connection while answering: nothing is applied', async () => {
    await workerHolds(`DATA.production[0].qty = 50`);
    const [id] = [...db.docs][0]; OWNER_PHONE(); await loadInbox(); db.offlineTx = true;
    assert.equal(j(await run(`proposalsOwnerAct(${JSON.stringify(id)}, 'accepted', '')`)).result, 'offline'); assert.equal(data().production[0].qty, 5); assert.equal(saves, 0);
  });
  test('Accept all takes everything from one person, oldest first, and leaves other people\'s alone', async () => {
    await workerHolds(`DATA.production[0].qty = 50; DATA.production[1].qty = 60; DATA.production.push({ id: 'p3', qty: 1 })`);
    db.docs.set('pother', Object.assign({}, [...db.docs][0][1], { id: 'pother', by: 'other@example.com', recId: 'zz', action: 'add', payload: JSON.stringify({ label: 'x', before: null, after: { id: 'zz', qty: 2 } }) }));
    OWNER_PHONE(); await loadInbox();
    const x = j(await run(`proposalsOwnerAcceptAll('${WORKER}')`));
    assert.equal(x.ok, 3); assert.equal(x.stuck.length, 0); assert.equal(data().production.find(r => r.id === 'p1').qty, 50); assert.equal(data().production.find(r => r.id === 'p2').qty, 60); assert.ok(data().production.find(r => r.id === 'p3'));
    assert.equal(db.docs.get('pother').status, 'pending'); assert.equal(run('INBOX_ROWS.length'), 1); assert.equal(saves, 3);
  });
  test('Accept all: ones that no longer fit stay waiting and are reported', async () => {
    await workerHolds(`DATA.production[0].qty = 50; DATA.production[1].qty = 60`);
    OWNER_PHONE(); await loadInbox(); run(`DATA.production[1].qty = 99`);
    const x = j(await run(`proposalsOwnerAcceptAll('${WORKER}')`));
    assert.equal(x.ok, 1); assert.equal(x.stuck.length, 1); assert.equal(x.stuck[0].result, 'conflict'); assert.equal(data().production[1].qty, 99); assert.equal(run('INBOX_ROWS.length'), 1);
  });
  test('end to end: the person\'s phone learns Accepted / Rejected and the owner\'s notes', async () => {
    load(); useDb(db); run(`DATA.production[0].qty = 50; DATA.production[1].qty = 60`); await trySave(); await syncWorker();
    const keep = store.get('khata-proposals'), ids = [...db.docs].map(([id]) => id).sort();
    OWNER_PHONE(); await loadInbox();
    await run(`proposalsOwnerAct(${JSON.stringify(ids[0])}, 'accepted', 'Thanks')`); await run(`proposalsOwnerAct(${JSON.stringify(ids[1])}, 'rejected', 'Wrong loom')`);
    load(); useDb(db); store.set('khata-proposals', keep); await syncWorker();
    const mine = await run('proposalsMine()'); const byId = Object.fromEntries(mine.map(p => [p.id, p]));
    assert.equal(byId[ids[0]].status, 'accepted'); assert.equal(byId[ids[0]].note, 'Thanks'); assert.equal(byId[ids[1]].status, 'rejected'); assert.equal(byId[ids[1]].note, 'Wrong loom');
  });
});

describe('the approvals badge, the screen and the rules', () => {
  beforeEach(() => { db = fakeDb(); useDb(db); });
  const badge = () => { const el = { hidden: true, textContent: '' }; ctx.document.getElementById = id => id === 'inboxBadge' ? el : null; return el; };
  test('the badge shows the count to the owner and is hidden at zero', async () => {
    await workerHolds(`DATA.production[0].qty = 50; DATA.production[1].qty = 60`);
    OWNER_PHONE(); const el = badge(); await run('proposalsInboxLoad()');
    assert.equal(el.hidden, false); assert.equal(el.textContent, '2 to approve');
    run('INBOX_ROWS = []; proposalsSetCount(0)'); assert.equal(el.hidden, true);
  });
  test('the badge shows the last known count before the cloud answers', () => {
    OWNER_PHONE(); store.set('khata-inbox-count', '3'); const el = badge(); run('proposalsBadgeUpdate()'); assert.equal(el.textContent, '3 to approve');
  });
  test('a sync check on the owner\'s phone refreshes the count', async () => {
    await workerHolds(`DATA.production[0].qty = 50`); OWNER_PHONE(); const el = badge(); await syncWorker(); assert.equal(el.textContent, '1 to approve');
  });
  test('no badge and no inbox for anyone but the owner', async () => {
    await workerHolds(`DATA.production[0].qty = 50`);
    const el = badge(); store.set('khata-inbox-count', '5'); run('proposalsBadgeUpdate()'); assert.equal(el.hidden, true);
    assert.equal(run("permsTabAllowed('inbox')"), false); assert.match(run('proposalsInboxPanel()'), /Only the owner/);
    OWNER_PHONE(); assert.equal(run("permsTabAllowed('inbox')"), true); assert.doesNotMatch(run('proposalsInboxPanel()'), /Only the owner/);
  });
  test('the person\'s own sync never reads other people\'s proposals (only its own by-filter)', async () => {
    await workerHolds(`DATA.production[0].qty = 50`);
    db.docs.set('pother', { by: 'other@example.com', status: 'accepted', notePayload: 'x' });
    await syncWorker(); assert.equal(queue().length, 1); assert.equal(queue()[0].status, 'pending');
  });
  test('the Firestore rule: person creates and reads their own, withdraws only while pending; the owner answers', () => {
    const c = vm.createContext({ localStorage: { getItem: () => null } }); vm.runInContext(read('js/cloud-sync.js').split('// True on a view-only phone')[0], c);
    const rule = vm.runInContext('CLOUD_FIRESTORE_RULE', c); const i = rule.indexOf('match /proposals/{id}'); assert.ok(i > 0);
    const blk = rule.slice(i, rule.indexOf('\n    }\n', i));
    assert.match(blk, /allow read: if isOwner\(\) \|\| \(signedIn\(\) && \(resource == null \|\| resource\.data\.by == me\(\)\)\)/);
    assert.match(blk, /request\.resource\.data\.by == me\(\)/); assert.match(blk, /request\.resource\.data\.status == 'pending'/); assert.match(blk, /hasOnly\(\['by','ct','section','action','list','recId','status','encrypted','kv','payload'\]\)/);
    assert.match(blk, /allow update: if isOwner\(\)/); assert.match(blk, /resource\.data\.status == 'pending'/);
    assert.ok(i > rule.indexOf('match /config/access'), 'placed after the audit block the older tests slice');
  });
});
