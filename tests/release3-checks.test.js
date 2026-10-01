'use strict';
/*
 * Release 3 (sections, roles and per-action permissions) - final checks that sit around the feature: a whole
 * hand-over between two fake phones for each of the two presets (owner approves with a role -> the other phone
 * learns exactly what that role allows -> owner changes the role or revokes -> the phone follows), and that the
 * version, cache and notes were kept in step. The pieces themselves are tested in roles.test.js,
 * permissions-ui.test.js, overview-cards.test.js, rates-in-wages.test.js and section-keys.test.js.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const OWNER = 'se.muhammadfaizan@gmail.com';
const BUSINESS = 'business@example.com', OPERATOR = 'operator@example.com';
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const HOUR = 3600000;
const clone = v => JSON.parse(JSON.stringify(v));
const j = v => JSON.parse(JSON.stringify(v));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const noteId = email => 'sync/grant-' + sha('write-grant:' + email);
const TABS = ['overview', 'production', 'sale', 'recovery', 'expense', 'wages', 'loans', 'ratecalc', 'family', 'personal', 'personalloans', 'warp', 'weft', 'warpbeams', 'checkpoints', 'graphs', 'settings', 'backup'].map(id => ({ id, label: id }));

// One fake phone. `docs` is the shared fake Firestore, so two phones can talk through it.
function phone(email, docs){
  const store = new Map([['khata-cloud-sync-on', '1']]);
  const page = {
    cloudPeopleEmail: { value: '' }, cloudPeopleAmount: { value: '30', style: {} }, cloudPeopleUnit: { value: 'days' }, cloudPeopleUntil: { value: '' }, cloudPeopleRole: { value: 'business_viewer' },
    cloudPeopleUntilRow: { style: {} }, cloudPeopleAddBtn: { disabled: false }, cloudPeopleEditBtn: { disabled: false },
    cloudPeopleMsg: { textContent: '', style: {} }, cloudPeopleList: { innerHTML: '', querySelectorAll: () => [] },
    writeBadge: { hidden: true, textContent: '' },
  };
  const toasts = [];
  const db = { collection: c => ({ doc: d => { const k = c + '/' + d; return {
    async get(){ return { exists: docs.has(k), data: () => docs.get(k) }; },
    async set(v){ docs.set(k, clone(v)); },
    async delete(){ docs.delete(k); },
  }; } }) };
  const user = { email, emailVerified: true, isAnonymous: false, async reload(){}, async getIdToken(){} };
  const auth = { get currentUser(){ return user; }, onAuthStateChanged(cb){ Promise.resolve().then(() => cb(user)); return () => {}; }, async signOut(){} };
  const ctx = vm.createContext({
    console: { log(){}, error(){} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp,
    setTimeout: () => 1, clearTimeout(){}, setInterval: () => 1, navigator: { onLine: true },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { getElementById: id => page[id] || null, createElement: () => ({ style: {}, setAttribute(){}, appendChild(){}, remove(){}, animate(){}, classList: { add(){}, toggle(){} }, firstChild: { textContent: '' }, querySelector: () => ({}) }),
      body: { appendChild(){}, classList: { toggle(){} } }, addEventListener(){}, head: { appendChild(){} } },
    firebase: { apps: [{}], initializeApp(){}, auth: () => auth, firestore: () => db },
    escHtml: x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    switchTab(){}, showToast: m => toasts.push(m), encEnabled: () => false, ENC_DEK: null, sha256Hex: async s => sha(s),
    snapAdd: async () => {}, currentEntryCount: () => 1, tombResetBaseline(){}, ensureDataDefaults: async () => false, UNDO_STACK: [], updateUndoButton(){}, save: async () => {}, TABS, CUR_PANEL: 'production',
  });
  vm.runInContext(`var DATA = { production: [{ id: 'p1', qty: 5 }], sale: [{ id: 's1', amt: 100 }], expense: [{ id: 'e1' }], family: [{ id: 'f1' }], businessInfo: { name: 'Ibrahim Weaving' }, openingBalance: 0 }; var CURRENT_TAB = 'production'; var UNDO_SUPPRESS = false;`, ctx);
  store.set('khata-cloud-user', JSON.stringify({ email, verified: true }));
  ['js/cloud-sync.js', 'js/view-only.js', 'js/write-access.js'].forEach(f => vm.runInContext(read(f), ctx));
  if(email !== OWNER) store.set('khata-view-only', '1');
  return { ctx, page, store, toasts, run: code => vm.runInContext(code, ctx) };
}
const setup = () => { const docs = new Map([['config/access', { ownerEmail: OWNER, approved: {} }]]); return { docs, owner: phone(OWNER, docs) }; };
async function approve(owner, email, role, edit){
  owner.page.cloudPeopleEmail.value = email; owner.page.cloudPeopleAmount.value = '4'; owner.page.cloudPeopleUnit.value = 'hours';
  owner.page.cloudPeopleRole.value = role;
  await owner.run(`cloudPeopleAdd(${edit ? 'true' : ''})`);
}
const tabs = p => TABS.filter(t => p.run(`permsTabAllowed('${t.id}')`)).map(t => t.id);

describe('Business viewer: a whole hand-over between two phones', () => {
  test('owner approves the role -> that phone may look at Production, Sales and Cheques and nothing private', async () => {
    const { docs, owner } = setup(); const w = phone(BUSINESS, docs);
    await approve(owner, BUSINESS, 'business_viewer');
    await w.run('waRefreshGrant()');
    assert.deepEqual(j(w.run('cloudReadSections()')), ['production', 'reference', 'sales', 'recovery', 'business']);
    ['wages', 'loans', 'family', 'expenses'].forEach(s => assert.equal(w.run(`cloudCanViewSection('${s}')`), false, s));
    const shown = tabs(w);
    ['overview', 'production', 'sale', 'recovery'].forEach(t => assert.ok(shown.includes(t), t));
    ['expense', 'wages', 'loans', 'family', 'personal', 'personalloans', 'graphs'].forEach(t => assert.ok(!shown.includes(t), t));
  });
  test('view only in every section, even with the edit switch on', async () => {
    const { docs, owner } = setup(); const w = phone(BUSINESS, docs);
    await approve(owner, BUSINESS, 'business_viewer', true);
    await w.run('waRefreshGrant()');
    assert.equal(w.run('viewOnly()'), true);
    assert.deepEqual(j(w.run('cloudWriteSections()')), []);
    ['production', 'sales', 'recovery'].forEach(s => ['a', 'e', 'd'].forEach(l => assert.equal(w.run(`permsCan('${s}', '${l}')`), false, s + l)));
  });
  test('the owner takes the role away -> the phone knows nothing about what it may see and sends nothing', async () => {
    const { docs, owner } = setup(); const w = phone(BUSINESS, docs);
    await approve(owner, BUSINESS, 'business_viewer');
    await w.run('waRefreshGrant()');
    await owner.run(`cloudAccessEdit(r => cloudAccessApplyRemove(r, '${BUSINESS}', Date.now()))`);
    assert.equal(docs.has(noteId(BUSINESS)), false);
    await w.run('waRefreshGrant()');
    assert.equal(w.store.has('khata-cloud-perms'), false);
    assert.deepEqual(j(w.run('cloudWriteSections()')), []);
  });
});

describe('Production operator: a whole hand-over between two phones', () => {
  test('without the edit switch the phone only looks: Production plus view-only employees, looms and qualities', async () => {
    const { docs, owner } = setup(); const w = phone(OPERATOR, docs);
    await approve(owner, OPERATOR, 'production_operator');
    await w.run('waRefreshGrant()');
    assert.equal(w.run('viewOnly()'), true);
    assert.deepEqual(j(w.run('cloudReadSections()')), ['production', 'reference', 'business']);
    assert.equal(w.run(`permsCan('production', 'a')`), false);
  });
  test('with the edit switch on it may add and change Production, never delete, and nothing outside Production', async () => {
    const { docs, owner } = setup(); const w = phone(OPERATOR, docs);
    await approve(owner, OPERATOR, 'production_operator', true);
    assert.equal(await w.run('waRefreshGrant()'), 'active');
    assert.equal(w.run('viewOnly()'), false);
    assert.deepEqual(j(w.run('cloudWriteSections()')), ['production']);
    assert.equal(w.run(`permsCan('production', 'a')`), true);
    assert.equal(w.run(`permsCan('production', 'e')`), true);
    assert.equal(w.run(`permsCan('production', 'd')`), false);
    ['reference', 'sales', 'recovery', 'wages', 'expenses', 'family'].forEach(s => ['a', 'e', 'd'].forEach(l => assert.equal(w.run(`permsCan('${s}', '${l}')`), false, s + l)));
  });
  test('it opens on Production, has no Overview, and sees nothing about money', async () => {
    const { docs, owner } = setup(); const w = phone(OPERATOR, docs);
    await approve(owner, OPERATOR, 'production_operator', true);
    await w.run('waRefreshGrant()');
    assert.equal(w.run('permsFirstTab()'), 'production');
    const shown = tabs(w);
    assert.ok(shown.includes('production')); assert.ok(!shown.includes('overview'));
    ['sale', 'recovery', 'expense', 'wages', 'loans', 'family', 'graphs'].forEach(t => assert.ok(!shown.includes(t), t));
    ['wages', 'sales', 'expenses', 'loans', 'family'].forEach(s => assert.equal(w.run(`cloudCanViewSection('${s}')`), false, s));
  });
  test('the owner stops edit -> the phone is view only again; ending the time does the same', async () => {
    const { docs, owner } = setup(); const w = phone(OPERATOR, docs);
    await approve(owner, OPERATOR, 'production_operator', true);
    await w.run('waRefreshGrant()');
    assert.equal(w.run('viewOnly()'), false);
    await owner.run(`cloudPeopleSetWrite({ disabled: false }, '${OPERATOR}', false)`);
    await w.run('waRefreshGrant()');
    assert.equal(w.run('viewOnly()'), true);
    assert.deepEqual(j(w.run('cloudWriteSections()')), []);
    await owner.run(`cloudPeopleSetWrite({ disabled: false }, '${OPERATOR}', true)`);
    assert.equal(await w.run('waRefreshGrant()'), 'active');
    docs.set(noteId(OPERATOR), Object.assign({}, docs.get(noteId(OPERATOR)), { expiresAt: Date.now() - 1000 }));
    await w.run('waRefreshGrant()');
    assert.equal(w.run('viewOnly()'), true);
  });
});

describe('changing roles and sections moves the other phone with it', () => {
  test('a role change on the People card reaches the phone on its next refresh', async () => {
    const { docs, owner } = setup(); const w = phone(BUSINESS, docs);
    await approve(owner, BUSINESS, 'business_viewer');
    await w.run('waRefreshGrant()');
    assert.equal(w.run(`cloudCanViewSection('sales')`), true);
    await owner.run(`cloudAccessEdit(r => cloudAccessApplySetRole(r, '${BUSINESS}', 'production_operator', Date.now()))`);
    await w.run('waRefreshGrant()');
    assert.equal(w.run(`cloudCanViewSection('sales')`), false);
    assert.equal(w.run(`cloudCanViewSection('production')`), true);
  });
  test('giving one extra section to one person does not touch the preset or anyone else', async () => {
    const { docs, owner } = setup(); const a = phone(BUSINESS, docs), b = phone(OPERATOR, docs);
    await approve(owner, BUSINESS, 'business_viewer'); await approve(owner, OPERATOR, 'business_viewer');
    await owner.run(`cloudAccessEdit(r => cloudAccessApplySetPerms(r, '${BUSINESS}', { production: 'v', reference: 'v', sales: 'v', recovery: 'v', business: 'v', expenses: 'v' }, Date.now()))`);
    await a.run('waRefreshGrant()'); await b.run('waRefreshGrant()');
    assert.equal(a.run(`cloudCanViewSection('expenses')`), true);
    assert.equal(b.run(`cloudCanViewSection('expenses')`), false);
  });
  test('the owner\'s own phone is never limited by any of this', async () => {
    const { owner } = setup();
    assert.equal(owner.run('permsLimited()'), false);
    assert.equal(owner.run(`permsCan('wages', 'd')`), true);
    assert.equal(tabs(owner).length, TABS.length);
  });
});

describe('version, cache and notes stay in step (Release 3)', () => {
  const pkg = JSON.parse(read('package.json')), html = read('index.html'), sw = read('service-worker.js'), hosting = read('HOSTING.txt'), readme = read('tests/README.md');
  test('the version is the same in package.json and on the header tag; the cache version and build label are set', () => {
    assert.equal(html.match(/id="appVersionTag">v([\d.]+)</)[1], pkg.version);
    assert.match(sw, /const CACHE_VERSION = 'v\d+';/);
    assert.match(html, /<meta name="app-build" content="[^"]+">/);
  });
  test('the service worker caches the Release 3 script', () => { assert.ok(sw.includes("'./js/section-keys.js'")); assert.ok(html.includes('./js/section-keys.js')); });
  test('HOSTING.txt explains roles, per-action letters, the two presets, rates in Wages, the Overview and the section keys', () => {
    assert.match(hosting, /Business viewer/); assert.match(hosting, /Production operator/);
    assert.match(hosting, /Access code/); assert.match(hosting, /Wage rates stay in Wages/); assert.match(hosting, /Overview by role/);
    assert.match(hosting, /Who sees what \(Release 3\)/);
  });
  test('HOSTING.txt no longer says roles are still to come', () => {
    assert.doesNotMatch(hosting, /comes with the roles in Release 3/); assert.doesNotMatch(hosting, /What a viewer or an editor can see: for now/);
  });
  test('the tests README lists the Release 3 test files', () => {
    ['roles.test.js', 'permissions-ui.test.js', 'rates-in-wages.test.js', 'overview-cards.test.js', 'section-keys.test.js', 'release3-checks.test.js'].forEach(f => assert.ok(readme.includes('`' + f + '`'), f));
  });
});
