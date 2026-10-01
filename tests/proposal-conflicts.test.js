'use strict';
/*
 * Release 3 conflicts (js/proposals.js): when the record changed after a proposal was made the owner is shown both versions and
 * chooses - Accept anyway (only the person's changed fields go on top of the record as it is now), Edit (the owner's own values)
 * or Reject - and two proposals for one record never overwrite each other silently. Runs the real stamping / audit code.
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


const WORKER2 = 'other@example.com';
const before = { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 5 };
const edit = (qty, loom, by) => prop('edit', 'production', 'p1', before, Object.assign({}, before, { qty: qty === undefined ? before.qty : qty, loom: loom === undefined ? before.loom : loom }), by ? { by } : {});
const load1 = async () => { await run('proposalsInboxLoad()'); return j(run('INBOX_ROWS')); };
const act = (id, status, note, opts) => run(`proposalsOwnerAct(${JSON.stringify(id)}, ${JSON.stringify(status)}, ${JSON.stringify(note || '')}, ${JSON.stringify(opts || null)})`).then(j);
const rowHtml = async id => { const rows = await load1(); return run('proposalsInboxRowHtml')(rows.find(r => r.id === id)); };
beforeEach(() => { load(); db.docs.set('A', edit(50)); });

describe('the owner sees both versions when the record changed since', () => {
  test('a plain proposal: Accept, Edit and Reject, no conflict panel', async () => {
    const h = await rowHtml('A');
    assert.match(h, /data-inb-accept=/); assert.match(h, /data-inb-edit=/); assert.match(h, /data-inb-reject=/); assert.doesNotMatch(h, /data-inb-force|data-inb-conflict/);
  });
  test('changed since: the panel shows what they saw, what is there now and what they want; Accept anyway / Edit / Reject, no plain Accept', async () => {
    run(`DATA.production[0].qty = 7`);
    const h = await rowHtml('A');
    assert.match(h, /Changed since worker@example\.com made this proposal/); assert.match(h, /Nothing is applied until you choose/);
    assert.match(h, /They saw<\/span><span[^>]*>5</); assert.match(h, /Now<\/span><span[^>]*>7</); assert.match(h, /They want<\/span><span[^>]*>50</); assert.match(h, /you both changed this/);
    assert.match(h, /data-inb-force=/); assert.match(h, /data-inb-edit=/); assert.match(h, /data-inb-reject=/); assert.doesNotMatch(h, /data-inb-accept=/);
  });
  test('a field only the owner changed is listed as "changed since", not as part of the proposal', async () => {
    run(`DATA.production[0].loom = 'L9'`);
    const h = await rowHtml('A'), panel = h.slice(h.indexOf('data-inb-conflict'), h.indexOf('data-inb-editbox')); assert.match(panel, /Loom/); assert.match(panel, /changed since, not part of the proposal/); assert.doesNotMatch(panel, /Date/, 'fields nobody changed are not listed');
  });
  test('plain Accept still refuses and says it can be forced; nothing changes and it stays waiting', async () => {
    run(`DATA.production[0].qty = 7`); await load1();
    const x = await act('A', 'accepted'); assert.equal(x.result, 'conflict'); assert.equal(x.canForce, true); assert.equal(data().production[0].qty, 7); assert.equal(db.docs.get('A').status, 'pending'); assert.equal(saves, 0);
  });
  test('the record was deleted since: only Reject is offered and forcing is refused', async () => {
    run(`DATA.production = DATA.production.filter(r => r.id !== 'p1')`);
    const h = await rowHtml('A'); assert.match(h, /This cannot be applied: the record is no longer there/); assert.doesNotMatch(h, /data-inb-accept|data-inb-force|data-inb-edit=/); assert.match(h, /data-inb-reject=/);
    const x = await act('A', 'accepted', '', { force: true }); assert.equal(x.result, 'conflict'); assert.equal(x.canForce, false); assert.equal(db.docs.get('A').status, 'pending'); assert.equal(saves, 0);
  });
  test('Reject works in every case and leaves the ledger as it is', async () => {
    run(`DATA.production[0].qty = 7`); await load1(); const b = data();
    assert.equal((await act('A', 'rejected', 'Checked with the floor')).result, 'ok'); assert.deepEqual(data(), b); assert.equal(db.docs.get('A').status, 'rejected'); assert.equal(saves, 0);
  });
});

describe('Accept anyway puts only what the person changed on top of the record as it is now', () => {
  test('a field the owner changed since is kept; theirs is applied; stamped as their edit approved by the owner', async () => {
    run(`DATA.production[0].loom = 'L9'`); await load1();
    const x = await act('A', 'accepted', '', { force: true }); assert.equal(x.result, 'ok');
    const r = data().production[0]; assert.equal(r.qty, 50); assert.equal(r.loom, 'L9'); assert.equal(r._mb, WORKER); assert.equal(r._ma, OWNER); assert.equal(r._cb, 'old@example.com');
    assert.equal(db.docs.get('A').status, 'accepted'); assert.equal(db.docs.get('A').notePayload, 'Accepted on top of a newer version of the record'); assert.equal(saves, 1);
  });
  test('the same field changed by both: theirs wins, and it was shown as a clash first', async () => {
    run(`DATA.production[0].qty = 7`); assert.match(await rowHtml('A'), /you both changed this/);
    await act('A', 'accepted', 'Yours is right', { force: true }); assert.equal(data().production[0].qty, 50); assert.equal(db.docs.get('A').notePayload, 'Yours is right', 'the owner\'s own note is kept');
  });
  test('the audit entry records the real before (what was there now) and after, in the person\'s name, approved by the owner', async () => {
    run(`DATA.production[0].qty = 7`); await load1(); await act('A', 'accepted', '', { force: true });
    const [e] = auditQueue(); assert.equal(e.doc.by, WORKER); assert.equal(e.doc.ab, OWNER); const b = JSON.parse(e.doc.payload); assert.equal(b.before.qty, 7); assert.equal(b.after.qty, 50);
  });
  test('a delete of a record that changed since is applied only when forced, through the normal tombstone path', async () => {
    db.docs.clear(); db.docs.set('D', prop('delete', 'production', 'p1', before, null)); run('tombRebaseline(); DATA.production[0].qty = 7'); run('tombRebaseline()'); await load1();
    assert.equal((await act('D', 'accepted')).result, 'conflict'); assert.equal(data().production.length, 2);
    assert.equal((await act('D', 'accepted', '', { force: true })).result, 'ok'); assert.deepEqual(data().production.map(r => r.id), ['p2']); assert.ok(JSON.stringify(data().deletedIds).includes('p1'));
  });
  test('a setting (business info) changed since: their changed fields go on top of the current value', async () => {
    db.docs.clear(); db.docs.set('B', prop('edit', 'businessInfo', '', { name: 'Ibrahim Weaving' }, { name: 'New Name' }, { section: 'business' }));
    run(`DATA.businessInfo = { name: 'Ibrahim Weaving', phone: '0300' }`); await load1();
    assert.equal((await act('B', 'accepted')).result, 'conflict'); assert.equal((await act('B', 'accepted', '', { force: true })).result, 'ok');
    assert.deepEqual(data().businessInfo, { name: 'New Name', phone: '0300' });
  });
});

describe('two proposals for one record never overwrite each other silently', () => {
  beforeEach(() => { db.docs.clear(); db.docs.set('A', edit(50)); db.docs.set('B', edit(undefined, 'L9', WORKER2)); });
  test('each row says another proposal for the same record is waiting', async () => {
    const rows = await load1(); const a = run('proposalsInboxRowHtml')(rows.find(r => r.id === 'A')), b = run('proposalsInboxRowHtml')(rows.find(r => r.id === 'B'));
    assert.match(a, /Another proposal for this same record is waiting \(other@example\.com, edit\)/); assert.match(b, /Another proposal for this same record is waiting \(worker@example\.com, edit\)/);
    assert.match(a, /nothing is overwritten without you seeing both/);
  });
  test('proposals for different records do not mention each other', async () => {
    db.docs.set('C', prop('edit', 'production', 'p2', { id: 'p2', date: '2026-09-02', loom: 'L2', qty: 7 }, { id: 'p2', date: '2026-09-02', loom: 'L2', qty: 8 }));
    const rows = await load1(); assert.doesNotMatch(run('proposalsInboxRowHtml')(rows.find(r => r.id === 'C')), /Another proposal/);
  });
  test('accepting the first makes the second stop and show both versions; forcing the second keeps the first one\'s change', async () => {
    await load1(); assert.equal((await act('A', 'accepted')).result, 'ok');
    const h = await rowHtml('B'); assert.match(h, /Changed since other@example\.com made this proposal/); assert.match(h, /data-inb-force=/); assert.doesNotMatch(h, /data-inb-accept=/);
    assert.equal((await act('B', 'accepted')).result, 'conflict'); assert.equal(data().production[0].loom, 'L1', 'nothing was applied');
    assert.equal((await act('B', 'accepted', '', { force: true })).result, 'ok');
    const r = data().production[0]; assert.equal(r.qty, 50, 'the first proposal\'s change is still there'); assert.equal(r.loom, 'L9'); assert.equal(r._mb, WORKER2); assert.equal(r._ma, OWNER);
  });
  test('Accept all takes the first and leaves the second waiting, reported; it never forces', async () => {
    await load1(); const x = j(await run(`proposalsOwnerAcceptAll('${WORKER}')`)); assert.equal(x.ok, 1);
    db.docs.set('A2', edit(60)); await load1(); const y = j(await run(`proposalsOwnerAcceptAll('${WORKER}')`));
    assert.equal(y.ok, 0); assert.equal(y.stuck[0].result, 'conflict'); assert.equal(data().production[0].qty, 50); assert.equal(db.docs.get('A2').status, 'pending');
  });
  test('two proposals from the SAME person for one record: the second asks instead of overwriting the first', async () => {
    db.docs.clear(); db.docs.set('A', edit(50)); db.docs.set('A2', edit(60)); await load1();
    assert.equal((await act('A', 'accepted')).result, 'ok'); assert.equal((await act('A2', 'accepted')).result, 'conflict'); assert.equal(data().production[0].qty, 50);
    const h = await rowHtml('A2'); assert.match(h, /They saw<\/span><span[^>]*>5</); assert.match(h, /Now<\/span><span[^>]*>50</); assert.match(h, /They want<\/span><span[^>]*>60</);
  });
});

describe('Edit: the owner picks the final values', () => {
  test('the edit form starts from the record as it is now with their changes on top, keeps the id out, and shows nested values read-only', async () => {
    run(`DATA.production[0].loom = 'L9'; DATA.production[0].note = 'x'`); const h = await rowHtml('A');
    assert.match(h, /data-inb-editbox=/); assert.match(h, /data-k="qty" data-t="n" value="50"/); assert.match(h, /data-k="loom" data-t="s" value="L9"/); assert.doesNotMatch(h, /data-k="id"|data-k="_ct"|data-k="_cb"/);
    assert.match(h, /Save my version and accept/);
  });
  test('Save applies the owner\'s version through the normal save: stamped as theirs, approved by the owner, noted for the person', async () => {
    await load1(); const x = await act('A', 'accepted', '', { force: true, result: { id: 'p1', date: '2026-09-01', loom: 'L1', qty: 48 } });
    assert.equal(x.result, 'ok'); const r = data().production[0]; assert.equal(r.qty, 48); assert.equal(r._mb, WORKER); assert.equal(r._ma, OWNER); assert.equal(r._ct, 1);
    assert.equal(db.docs.get('A').status, 'accepted'); assert.equal(db.docs.get('A').notePayload, 'Accepted with changes by the owner');
    const b = JSON.parse(auditQueue()[0].doc.payload); assert.equal(b.after.qty, 48);
  });
  test('an edited add is added with the owner\'s values; an edited version must keep the record\'s id', async () => {
    db.docs.clear(); db.docs.set('N', prop('add', 'production', 'p3', null, { id: 'p3', loom: 'L1', qty: 9 })); await load1();
    const bad = await act('N', 'accepted', '', { force: true, result: { id: 'zzz', qty: 1 } }); assert.equal(bad.result, 'conflict'); assert.match(bad.why, /not valid/); assert.equal(data().production.length, 2); assert.equal(db.docs.get('N').status, 'pending');
    assert.equal((await act('N', 'accepted', '', { force: true, result: { id: 'p3', loom: 'L2', qty: 10 } })).result, 'ok');
    const r = data().production.find(x => x.id === 'p3'); assert.equal(r.qty, 10); assert.equal(r.loom, 'L2'); assert.equal(r._cb, WORKER); assert.equal(r._ca, OWNER);
  });
  test('a delete cannot be edited', async () => {
    db.docs.clear(); db.docs.set('D', prop('delete', 'production', 'p2', { id: 'p2', date: '2026-09-02', loom: 'L2', qty: 7 }, null)); await load1();
    assert.doesNotMatch(run('proposalsInboxRowHtml')(j(run('INBOX_ROWS'))[0]), /data-inb-edit=/);
    assert.equal((await act('D', 'accepted', '', { force: true, result: { id: 'p2' } })).result, 'conflict'); assert.equal(data().production.length, 2);
  });
  test('a setting can be edited: one box per field', async () => {
    db.docs.clear(); db.docs.set('B', prop('edit', 'businessInfo', '', { name: 'Ibrahim Weaving' }, { name: 'New Name' }, { section: 'business' })); const h = await rowHtml('B');
    assert.match(h, /data-k="name" data-t="s" value="New Name"/);
    assert.equal((await act('B', 'accepted', '', { force: true, result: { name: 'Final Name' } })).result, 'ok'); assert.equal(data().businessInfo.name, 'Final Name');
  });
  test('the form\'s values: numbers stay numbers, commas allowed, a half-typed number is refused, Yes / No stays true / false', () => {
    const f = (k, t, raw) => ({ k, t, raw });
    assert.deepEqual(j(run(`proposalsBuildResult({ id: 'p1', qty: 50, loom: 'L1', ok: true }, ${JSON.stringify([f('qty', 'n', '1,250.5'), f('loom', 's', ' L2 '), f('ok', 'b', 'false')])})`)), { result: { id: 'p1', qty: 1250.5, loom: ' L2 ', ok: false } });
    assert.match(j(run(`proposalsBuildResult({ id: 'p1', qty: 50 }, ${JSON.stringify([f('qty', 'n', '12abc')])})`)).bad, /Quantity must be a number/);
    assert.deepEqual(j(run(`proposalsBuildResult({ id: 'p1', qty: 50 }, ${JSON.stringify([f('qty', 'n', '')])})`)), { result: { id: 'p1', qty: '' } });
    assert.equal(j(run(`proposalsBuildResult(5, ${JSON.stringify([f('', 'n', '8')])})`)).result, 8);
  });
  test('an answered-elsewhere or offline answer applies nothing, with force or result too', async () => {
    await load1(); db.docs.get('A').status = 'rejected';
    assert.equal((await act('A', 'accepted', '', { force: true, result: { id: 'p1', qty: 1 } })).result, 'decided'); assert.equal(data().production[0].qty, 5); assert.equal(saves, 0);
  });
});
