'use strict';
/*
 * Release 2 (time-limited write access, granted from the owner's phone) - final checks that sit around the
 * feature: the People card controls that give and take away edit access (Approve to edit, Allow edit / Stop
 * edit), a whole hand-over between two fake phones (owner grants -> worker's phone edits -> owner stops ->
 * worker's phone is view-only again), and that the version, cache and notes were kept in step. The pieces
 * themselves are tested in write-access.test.js, cloud-people.test.js and edit-stamps.test.js.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const OWNER = 'se.muhammadfaizan@gmail.com';
const WORKER = 'worker@example.com';
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const DAY = 86400000, HOUR = 3600000;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const noteId = email => 'sync/grant-' + sha('write-grant:' + email);
const clone = v => JSON.parse(JSON.stringify(v));

// One fake phone. `docs` is the shared fake Firestore, so two phones can talk through it.
function phone(email, docs){
  const store = new Map([['khata-cloud-sync-on', '1']]);
  const page = {
    cloudPeopleEmail: { value: '' }, cloudPeopleAmount: { value: '30', style: {} }, cloudPeopleUnit: { value: 'days' }, cloudPeopleUntil: { value: '' },
    cloudPeopleUntilRow: { style: {} }, cloudPeopleAddBtn: { disabled: false }, cloudPeopleEditBtn: { disabled: false },
    cloudPeopleMsg: { textContent: '', style: {} }, cloudPeopleList: { innerHTML: '', querySelectorAll: () => [] },
    writeBadge: { hidden: true, textContent: '' },
  };
  const sets = [], deletes = [];
  const db = { collection: c => ({ doc: d => { const k = c + '/' + d; return {
    async get(){ return { exists: docs.has(k), data: () => docs.get(k) }; },
    async set(v){ sets.push(k); docs.set(k, clone(v)); },
    async delete(){ deletes.push(k); docs.delete(k); },
  }; } }) };
  const user = { email, emailVerified: true, isAnonymous: false, async reload(){}, async getIdToken(){} };
  const auth = { get currentUser(){ return user; }, onAuthStateChanged(cb){ Promise.resolve().then(() => cb(user)); return () => {}; }, async signOut(){} };
  const ctx = vm.createContext({
    console: { log(){}, error(){} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp,
    setTimeout: () => 1, clearTimeout(){}, setInterval: () => 1, navigator: { onLine: true },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { getElementById: id => page[id] || null, createElement: () => ({ style: {}, setAttribute(){}, appendChild(){}, remove(){}, animate(){}, firstChild: { textContent: '' }, querySelector: () => ({}) }),
      body: { appendChild(){}, classList: { toggle(){} } }, addEventListener(){}, head: { appendChild(){} } },
    firebase: { apps: [{}], initializeApp(){}, auth: () => auth, firestore: () => db },
    escHtml: x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    switchTab(){}, showToast(){}, encEnabled: () => false, ENC_DEK: null, sha256Hex: async s => sha(s),
    snapAdd: async () => {}, currentEntryCount: () => 1, tombResetBaseline(){}, ensureDataDefaults: async () => false, UNDO_STACK: [], updateUndoButton(){}, save: async () => {},
  });
  vm.runInContext(`var DATA = { production: [{ id: 'a' }] }; var CURRENT_TAB = 'overview'; var UNDO_SUPPRESS = false;`, ctx);
  store.set('khata-cloud-user', JSON.stringify({ email, verified: true }));
  ['js/cloud-sync.js', 'js/view-only.js', 'js/write-access.js'].forEach(f => vm.runInContext(read(f), ctx));
  if(email !== OWNER) store.set('khata-view-only', '1');
  return { ctx, page, sets, deletes, store, run: code => vm.runInContext(code, ctx) };
}
const ownerWith = approved => { const docs = new Map([['config/access', { ownerEmail: OWNER, approved: approved || {} }]]); return { docs, p: phone(OWNER, docs) }; };
const ent = (ms, write) => ({ expiresAt: Date.now() + ms, write: !!write, addedAt: 1 });

describe('People card: giving edit access', () => {
  test('Approve to edit saves write: true until the chosen time, and sends that phone its note', async () => {
    const { docs, p } = ownerWith();
    p.page.cloudPeopleEmail.value = ' Worker@Example.com '; p.page.cloudPeopleAmount.value = '3'; p.page.cloudPeopleUnit.value = 'hours';
    const before = Date.now(); await p.run('cloudPeopleAdd(true)');
    const saved = docs.get('config/access').approved[WORKER];
    assert.equal(saved.write, true);
    assert.ok(saved.expiresAt >= before + 3 * HOUR && saved.expiresAt <= Date.now() + 3 * HOUR);
    const note = docs.get(noteId(WORKER));
    assert.ok(note && note.write === true && note.expiresAt === saved.expiresAt);
    assert.match(p.page.cloudPeopleMsg.textContent, /worker@example\.com approved to edit until/);
    assert.equal(p.page.cloudPeopleEditBtn.disabled, false);
  });
  test('Approve to view saves view only and sends no note', async () => {
    const { docs, p } = ownerWith();
    p.page.cloudPeopleEmail.value = WORKER;
    await p.run('cloudPeopleAdd()');
    assert.equal(docs.get('config/access').approved[WORKER].write, false);
    assert.equal(docs.has(noteId(WORKER)), false);
    assert.match(p.page.cloudPeopleMsg.textContent, /approved until/); assert.doesNotMatch(p.page.cloudPeopleMsg.textContent, /to edit|can still edit/);
  });
  test('Approve to view on someone who can edit keeps their edit access and says so', async () => {
    const { docs, p } = ownerWith({ [WORKER]: ent(DAY, true) });
    p.page.cloudPeopleEmail.value = WORKER;
    await p.run('cloudPeopleAdd()');
    assert.equal(docs.get('config/access').approved[WORKER].write, true);
    assert.match(p.page.cloudPeopleMsg.textContent, /can still edit.*Stop edit/);
  });
  test('a bad email or time writes nothing, and no note', async () => {
    const { docs, p } = ownerWith();
    p.page.cloudPeopleEmail.value = 'nobody'; await p.run('cloudPeopleAdd(true)');
    assert.deepEqual(clone(docs.get('config/access').approved), {});
    assert.equal(p.sets.length, 0);
    p.page.cloudPeopleEmail.value = WORKER; p.page.cloudPeopleAmount.value = '0'; await p.run('cloudPeopleAdd(true)');
    assert.equal(p.sets.length, 0);
  });
  test('only the owner\'s phone can do it', async () => {
    const { docs } = ownerWith();
    const w = phone(WORKER, docs);
    w.page.cloudPeopleEmail.value = 'friend@example.com';
    await w.run('cloudPeopleAdd(true)');
    assert.equal(w.sets.length, 0);
    assert.match(w.page.cloudPeopleMsg.textContent, /Only the owner/);
  });
});

describe('People card: Allow edit / Stop edit', () => {
  const btn = { disabled: false };
  test('Allow edit turns it on and keeps the end time; the note follows', async () => {
    const rec = ent(2 * DAY, false), { docs, p } = ownerWith({ [WORKER]: rec });
    await p.run(`cloudPeopleSetWrite(${JSON.stringify(btn)}, '${WORKER}', true)`);
    const saved = docs.get('config/access').approved[WORKER];
    assert.equal(saved.write, true); assert.equal(saved.expiresAt, rec.expiresAt); assert.equal(saved.addedAt, 1);
    assert.equal(docs.get(noteId(WORKER)).write, true);
    assert.match(p.page.cloudPeopleMsg.textContent, /can now edit until/);
  });
  test('Stop edit turns it off, keeps them approved to view, and removes the note', async () => {
    const rec = ent(2 * DAY, true), { docs, p } = ownerWith({ [WORKER]: rec });
    docs.set(noteId(WORKER), { write: true, expiresAt: rec.expiresAt });
    await p.run(`cloudPeopleSetWrite(${JSON.stringify(btn)}, '${WORKER}', false)`);
    const saved = docs.get('config/access').approved[WORKER];
    assert.equal(saved.write, false); assert.equal(saved.expiresAt, rec.expiresAt);
    assert.equal(docs.has(noteId(WORKER)), false);
    assert.match(p.page.cloudPeopleMsg.textContent, /view only again/);
  });
  test('an ended approval cannot be switched to edit (Extend first); someone not on the list is refused; nothing is written', async () => {
    const { docs, p } = ownerWith({ [WORKER]: ent(-HOUR, false) });
    await p.run(`cloudPeopleSetWrite(${JSON.stringify(btn)}, '${WORKER}', true)`);
    assert.match(p.page.cloudPeopleMsg.textContent, /already ended.*Extend first/);
    await p.run(`cloudPeopleSetWrite(${JSON.stringify(btn)}, 'ghost@example.com', true)`);
    assert.match(p.page.cloudPeopleMsg.textContent, /no longer on the list/);
    assert.equal(docs.get('config/access').approved[WORKER].write, false); assert.equal(p.sets.length, 0);
  });
  test('an ended approval can still be switched OFF', async () => {
    const { docs, p } = ownerWith({ [WORKER]: ent(-HOUR, true) });
    await p.run(`cloudPeopleSetWrite(${JSON.stringify(btn)}, '${WORKER}', false)`);
    assert.equal(docs.get('config/access').approved[WORKER].write, false);
  });
  test('the rows show the right button: Allow edit / Stop edit, disabled only for an ended view-only approval; Extend and Revoke are still there', () => {
    const { p } = ownerWith();
    const html = p.run(`cloudPeopleListHtml({ approved: { 'a@x.com': { expiresAt: ${Date.now() + DAY}, write: false }, 'b@x.com': { expiresAt: ${Date.now() + DAY}, write: true }, 'c@x.com': { expiresAt: 1, write: false } } }, ${Date.now()})`);
    assert.match(html, /data-cp-write="a@x\.com" data-cp-write-to="on">Allow edit</);
    assert.match(html, /data-cp-write="b@x\.com" data-cp-write-to="off">Stop edit</);
    assert.match(html, /data-cp-write="c@x\.com" data-cp-write-to="on" disabled>Allow edit</);
    assert.equal((html.match(/data-cp-revoke=/g) || []).length, 3); assert.equal((html.match(/data-cp-open="extend"/g) || []).length, 3);
    assert.match(html, /Can edit \u00B7/);
  });
  test('the card has both approve buttons and they are wired', () => {
    const { p } = ownerWith();
    const html = p.run('cloudPeopleHtml()');
    assert.match(html, /id="cloudPeopleAddBtn"[^>]*>Approve to view</); assert.match(html, /id="cloudPeopleEditBtn"[^>]*>Approve to edit</);
    p.run('wireCloudPeople()');
    assert.equal(typeof p.page.cloudPeopleAddBtn.onclick, 'function'); assert.equal(typeof p.page.cloudPeopleEditBtn.onclick, 'function');
  });
});

describe('the whole hand-over between two phones', () => {
  test('owner grants edit -> the worker\'s phone edits -> owner stops -> the worker\'s phone is view only again', async () => {
    const { docs, p: owner } = ownerWith();
    const worker = phone(WORKER, docs);
    assert.equal(worker.run('viewOnly()'), true, 'view only to begin with');
    owner.page.cloudPeopleEmail.value = WORKER; owner.page.cloudPeopleAmount.value = '2'; owner.page.cloudPeopleUnit.value = 'hours';
    await owner.run('cloudPeopleAdd(true)');
    assert.equal(await worker.run('waRefreshGrant()'), 'active');
    assert.equal(worker.run('viewOnly()'), false, 'may edit now');
    assert.equal(worker.run('cloudWriteGrantActive()'), true);
    await owner.run(`cloudPeopleSetWrite({ disabled: false }, '${WORKER}', false)`);
    assert.equal(await worker.run('waRefreshGrant()'), 'none');
    assert.equal(worker.run('viewOnly()'), true, 'view only again');
    assert.equal(worker.run('cloudWriteGrantActive()'), false);
  });
  test('a grant that has passed its end time does nothing on the worker\'s phone, even if it was never switched off', async () => {
    const { docs, p: owner } = ownerWith();
    const worker = phone(WORKER, docs);
    docs.set('config/access', { ownerEmail: OWNER, approved: { [WORKER]: ent(-1000, true) } });
    docs.set(noteId(WORKER), { write: true, expiresAt: Date.now() - 1000 });
    assert.equal(await worker.run('waRefreshGrant()'), 'none');
    assert.equal(worker.run('viewOnly()'), true);
    assert.ok(owner);
  });
});

describe('version, cache and notes stay in step (Release 2)', () => {
  const pkg = JSON.parse(read('package.json')), html = read('index.html'), sw = read('service-worker.js'), hosting = read('HOSTING.txt'), readme = read('tests/README.md');
  test('the version is the same in package.json and on the header tag; the cache version and build label are set', () => {
    assert.equal(html.match(/id="appVersionTag">v([\d.]+)</)[1], pkg.version);
    assert.match(sw, /const CACHE_VERSION = 'v\d+';/);
    assert.match(html, /<meta name="app-build" content="[^"]+">/);
  });
  test('the service worker caches write-access.js', () => { assert.ok(sw.includes("'./js/write-access.js'")); });
  test('HOSTING.txt explains how to give, switch off and lose edit access, the header label, safety copies and who-edited-what', () => {
    assert.match(hosting, /Approve to edit/); assert.match(hosting, /Allow edit/); assert.match(hosting, /Stop edit/);
    assert.match(hosting, /Can edit/); assert.match(hosting, /Unsynced entries \(access ended\)/);
    assert.match(hosting, /Info/); assert.match(hosting, /Added by/); assert.match(hosting, /Last edited by/);
    assert.match(hosting, /no rule\s+change/i);
  });
  test('HOSTING.txt no longer says the edit switch is still to come', () => {
    assert.doesNotMatch(hosting, /is the next step/); assert.doesNotMatch(hosting, /comes with Release 2/); assert.doesNotMatch(hosting, /Everyone approved this way is view-only/);
  });
  test('HOSTING.txt still says what a viewer or editor can see, and that roles come in Release 3', () => {
    assert.match(hosting, /whole ledger|everything/i); assert.match(hosting, /Release 3/);
  });
  test('the tests README lists the Release 2 test files', () => {
    ['write-access.test.js', 'edit-stamps.test.js', 'release2-checks.test.js'].forEach(f => assert.ok(readme.includes('`' + f + '`'), f));
  });
});
