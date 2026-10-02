'use strict';
/*
 * Roles and per-section permissions (js/cloud-sync.js "Roles and per-section permissions", the People card,
 * and the note in js/write-access.js): the Business viewer and Production operator presets, per-person
 * overrides, the edit switch, what the record and the person's note hold, and what the phone learns.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const OWNER = 'se.muhammadfaizan@gmail.com', WORKER = 'worker@example.com';
const DAY = 86400000, NOW = Date.now();
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const noteId = e => 'sync/grant-' + sha('write-grant:' + e);
const j = v => JSON.parse(JSON.stringify(v));

let ctx, store, docs, page;
function load(email, recApproved){
  store = new Map(); docs = new Map();
  if(recApproved) docs.set('config/access', { ownerEmail: OWNER, approved: recApproved, updatedAt: '2026-09-01T00:00:00.000Z' });
  page = { cloudRolesMsg: { textContent: '', style: {} }, cloudPeopleMsg: { textContent: '', style: {} }, cloudPeopleList: { innerHTML: '', querySelectorAll: () => [] },
    cloudPeopleEmail: { value: '' }, cloudPeopleAmount: { value: '30' }, cloudPeopleUnit: { value: 'days' }, cloudPeopleUntil: { value: '' }, cloudPeopleRole: { value: 'business_viewer' },
    cloudPeopleAddBtn: { disabled: false }, cloudPeopleEditBtn: { disabled: false } };
  const db = { collection: c => ({ doc: d => { const k = c + '/' + d; return {
    async get(){ return { exists: docs.has(k), data: () => JSON.parse(JSON.stringify(docs.get(k))) }; },
    async set(v){ docs.set(k, JSON.parse(JSON.stringify(v))); }, async delete(){ docs.delete(k); } }; } }) };
  const user = { email, emailVerified: true, async reload(){}, async getIdToken(){} };
  ctx = vm.createContext({ console: { log(){}, error(){} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp,
    setTimeout: () => 1, clearTimeout(){}, setInterval(){}, navigator: { onLine: true },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { getElementById: id => page[id] || null, createElement: () => ({ style: {}, setAttribute(){}, appendChild(){}, remove(){}, animate(){} }), body: { appendChild(){}, classList: { toggle(){} } }, addEventListener(){}, head: { appendChild(){} } },
    firebase: { apps: [{}], initializeApp(){}, auth: () => ({ get currentUser(){ return user; }, onAuthStateChanged(cb){ Promise.resolve().then(() => cb(user)); return () => {}; }, async signOut(){} }), firestore: () => db },
    escHtml: x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'), switchTab(){}, showToast(){}, encEnabled: () => false, sha256Hex: async s => sha(s),
    snapAdd: async () => {}, currentEntryCount: () => 1, tombResetBaseline(){}, ensureDataDefaults: async () => false, UNDO_STACK: [], updateUndoButton(){}, save: async () => {} });
  vm.runInContext('var DATA = {}; var CURRENT_TAB = "overview"; var UNDO_SUPPRESS = false;', ctx);
  store.set('khata-cloud-user', JSON.stringify({ email, verified: true }));
  vm.runInContext(read('js/cloud-sync.js'), ctx); vm.runInContext(read('js/view-only.js'), ctx); vm.runInContext(read('js/write-access.js'), ctx);
}
const run = code => vm.runInContext(code, ctx);
const rec = approved => ({ ownerEmail: OWNER, approved: approved || {}, updatedAt: 'x' });
const entry = (o) => Object.assign({ expiresAt: NOW + DAY, write: false, addedAt: 1 }, o || {});
beforeEach(() => load(OWNER));

describe('the two presets', () => {
  test('Business viewer sees only Production, Sales, Cheques (and the lists and business name they need), view only', () => {
    const p = j(run(`cloudPermsFor('business_viewer', null)`));
    assert.deepEqual(p, { production: 'v', reference: 'v', sales: 'v', recovery: 'v', business: 'v' });
    ['expenses', 'wages', 'loans', 'family', 'materials', 'tools'].forEach(s => assert.equal(p[s], undefined, s + ' is hidden'));
    assert.ok(Object.values(p).every(l => l === 'v'), 'view only, even with the edit switch on');
    assert.equal(run(`cloudPermsCanWrite(cloudPermsEffective({ role: 'business_viewer', write: true }))`), false);
  });
  test('Production operator: Production with add and edit (no delete), the lists view-only, nothing private', () => {
    const p = j(run(`cloudPermsFor('production_operator', null)`));
    assert.deepEqual(p, { production: 'vae', reference: 'v', business: 'v' });
    ['sales', 'recovery', 'expenses', 'wages', 'loans', 'family', 'materials', 'tools'].forEach(s => assert.equal(p[s], undefined));
    assert.equal(p.production.includes('d'), false);
  });
  test('the edit switch decides whether the add / edit letters count', () => {
    assert.deepEqual(j(run(`cloudPermsEffective({ role: 'production_operator', write: false })`)), { production: 'v', reference: 'v', business: 'v' });
    assert.deepEqual(j(run(`cloudPermsEffective({ role: 'production_operator', write: true })`)), { production: 'vae', reference: 'v', business: 'v' });
  });
  test('no role (an entry from before roles) means no access; an unknown role too', () => {
    assert.deepEqual(j(run(`cloudPermsEffective({ write: true })`)), {});
    assert.deepEqual(j(run(`cloudPermsEffective({ role: 'admin', write: true })`)), {});
  });
  test('the owner-only sections are in no preset', () => {
    ['business_viewer', 'production_operator'].forEach(r => ['expenses', 'wages', 'loans', 'family', 'materials', 'tools'].forEach(s => assert.equal(run(`cloudPermsFor('${r}', null)['${s}']`), undefined)));
  });
});

describe('letters and overrides', () => {
  test('letters are cleaned: unknown dropped, order fixed, add / edit / delete imply view, unknown sections dropped', () => {
    assert.equal(run(`cloudPermsCleanLetters('DEAx')`), 'vaed');
    assert.equal(run(`cloudPermsCleanLetters('e')`), 've');
    assert.equal(run(`cloudPermsCleanLetters('zz')`), '');
    assert.deepEqual(j(run(`cloudPermsClean({ production: 'd', nope: 'v', sales: '' })`)), { production: 'vd' });
  });
  test('an override replaces that section only; an empty override removes it', () => {
    assert.deepEqual(j(run(`cloudPermsFor('business_viewer', { expenses: 'v', sales: '' })`)), { production: 'v', reference: 'v', recovery: 'v', business: 'v', expenses: 'v' });
  });
  test('a custom role starts with nothing; everything comes from overrides', () => {
    assert.deepEqual(j(run(`cloudPermsFor('custom', null)`)), {});
    assert.deepEqual(j(run(`cloudPermsFor('custom', { wages: 'vaed' })`)), { wages: 'vaed' });
  });
  test('a person can be given more than the preset, in one section, without touching the rest', () => {
    const r = rec({ [WORKER]: entry({ role: 'production_operator', write: true }) });
    const out = j(run(`cloudAccessApplySetPerms(${JSON.stringify(r)}, '${WORKER}', { production: 'vaed', reference: 'v', business: 'v', recovery: 'v' }, ${NOW})`));
    const e = out.record.approved[WORKER];
    assert.deepEqual(e.overrides, { production: 'vaed', recovery: 'v' }, 'only the differences are kept');
    assert.deepEqual(e.perms, { production: 'vaed', reference: 'v', business: 'v', recovery: 'v' });
  });
  test('taking a section away is an override of nothing', () => {
    const r = rec({ [WORKER]: entry({ role: 'production_operator', write: true }) });
    const e = j(run(`cloudAccessApplySetPerms(${JSON.stringify(r)}, '${WORKER}', { production: 'vae', reference: 'v' }, ${NOW})`)).record.approved[WORKER];
    assert.deepEqual(e.overrides, { business: '' }); assert.equal(e.perms.business, undefined);
  });
  test('saving exactly the preset leaves no overrides', () => {
    const r = rec({ [WORKER]: entry({ role: 'business_viewer', overrides: { expenses: 'v' } }) });
    const e = j(run(`cloudAccessApplySetPerms(${JSON.stringify(r)}, '${WORKER}', ${JSON.stringify({ production: 'v', reference: 'v', sales: 'v', recovery: 'v', business: 'v' })}, ${NOW})`)).record.approved[WORKER];
    assert.equal(e.overrides, undefined);
  });
  test('unknown sections and people without a role are refused', () => {
    const r = rec({ [WORKER]: entry({ role: 'business_viewer' }), 'norole@example.com': entry() });
    assert.throws(() => run(`cloudAccessApplySetPerms(${JSON.stringify(r)}, '${WORKER}', { payroll: 'v' }, ${NOW})`), /Unknown section/);
    assert.throws(() => run(`cloudAccessApplySetPerms(${JSON.stringify(r)}, 'norole@example.com', { sales: 'v' }, ${NOW})`), /role/);
    assert.throws(() => run(`cloudAccessApplySetPerms(${JSON.stringify(r)}, 'gone@example.com', { sales: 'v' }, ${NOW})`), /no longer/);
  });
});

describe('the record', () => {
  test('approving with a role stores the role and the effective permissions (view only until the edit switch is on)', () => {
    const v = j(run(`cloudAccessApplyApprove(${JSON.stringify(rec())}, '${WORKER}', ${NOW + DAY}, ${NOW}, undefined, 'production_operator')`));
    assert.equal(v.record.approved[WORKER].role, 'production_operator');
    assert.deepEqual(v.record.approved[WORKER].perms, { production: 'v', reference: 'v', business: 'v' });
    const w = j(run(`cloudAccessApplyApprove(${JSON.stringify(rec())}, '${WORKER}', ${NOW + DAY}, ${NOW}, true, 'production_operator')`));
    assert.equal(w.record.approved[WORKER].perms.production, 'vae');
  });
  test('an unknown role is refused and nothing is written', () => {
    assert.throws(() => run(`cloudAccessApplyApprove(${JSON.stringify(rec())}, '${WORKER}', ${NOW + DAY}, ${NOW}, false, 'admin')`), /role/);
  });
  test('changing the role clears the overrides; a date change keeps role and overrides', () => {
    const r = rec({ [WORKER]: entry({ role: 'production_operator', overrides: { sales: 'v' }, perms: {} }) });
    const again = j(run(`cloudAccessApplyApprove(${JSON.stringify(r)}, '${WORKER}', ${NOW + 9 * DAY}, ${NOW}, undefined, 'production_operator')`)).record.approved[WORKER];
    assert.deepEqual(again.overrides, { sales: 'v' }, 'same role: overrides stay');
    const changed = j(run(`cloudAccessApplySetRole(${JSON.stringify(r)}, '${WORKER}', 'business_viewer', ${NOW})`)).record.approved[WORKER];
    assert.equal(changed.role, 'business_viewer'); assert.equal(changed.overrides, undefined);
    const shifted = j(run(`cloudAccessApplyShift(${JSON.stringify(r)}, '${WORKER}', ${DAY}, ${NOW})`)).record.approved[WORKER];
    assert.equal(shifted.role, 'production_operator'); assert.deepEqual(shifted.overrides, { sales: 'v' });
  });
  test('Allow edit / Stop edit recompute the permissions', () => {
    const r = rec({ [WORKER]: entry({ role: 'production_operator', perms: { production: 'v', reference: 'v', business: 'v' } }) });
    const on = j(run(`cloudAccessApplySetWrite(${JSON.stringify(r)}, '${WORKER}', true, ${NOW})`)).record.approved[WORKER];
    assert.equal(on.perms.production, 'vae');
    const off = j(run(`cloudAccessApplySetWrite(${JSON.stringify({ ownerEmail: OWNER, approved: { [WORKER]: on } })}, '${WORKER}', false, ${NOW})`)).record.approved[WORKER];
    assert.equal(off.perms.production, 'v');
  });
  test('the record passed in is not changed', () => {
    const r = rec({ [WORKER]: entry({ role: 'business_viewer' }) }), before = JSON.stringify(r);
    run(`cloudAccessApplySetRole(${before}, '${WORKER}', 'production_operator', ${NOW})`);
    run(`var __r = ${before}; cloudAccessApplySetPerms(__r, '${WORKER}', { sales: 'v' }, ${NOW})`);
    assert.equal(run('JSON.stringify(__r)'), before);
  });
  test('the list shows role, overrides and effective permissions for the screen', () => {
    const r = rec({ [WORKER]: entry({ role: 'production_operator', overrides: { recovery: 'v' }, write: true }) });
    const row = j(run(`cloudAccessList(${JSON.stringify(r)}, ${NOW})`))[0];
    assert.equal(row.role, 'production_operator'); assert.deepEqual(row.overrides, { recovery: 'v' });
    assert.deepEqual(row.perms, { production: 'vae', reference: 'v', business: 'v', recovery: 'v' });
  });
});

describe('the People card', () => {
  const R = () => rec({ [WORKER]: entry({ role: 'production_operator', write: true, perms: {} }), 'norole@example.com': entry() });
  test('the list names each role, shows what is allowed, and offers the section grid and a role picker', () => {
    const html = run(`cloudPeopleListHtml(${JSON.stringify(R())}, ${NOW})`);
    assert.match(html, /Production operator/); assert.match(html, /No role yet/);
    assert.match(html, /Production VAE/); assert.match(html, /data-cp-role=/); assert.match(html, /data-cp-saveperms=/);
    assert.equal((html.match(/data-cp-perm="worker@example\.com\|/g) || []).length, 12 * 4, 'every section has V A E D boxes');
    assert.match(html, /data-cp-access="norole@example\.com" disabled/, 'no sections grid until a role is chosen');
  });
  test('the add form has the role picker listing the presets', () => {
    const html = run('cloudPeopleHtml()');
    assert.match(html, /id="cloudPeopleRole"/); assert.match(html, /Business viewer/); assert.match(html, /Production operator/); assert.match(html, /Custom/);
  });
  test('Approve to view / edit takes the chosen role', async () => {
    load(OWNER, {});
    page.cloudPeopleEmail.value = WORKER; page.cloudPeopleRole.value = 'production_operator';
    await run('cloudPeopleAdd(true)');
    const e = docs.get('config/access').approved[WORKER];
    assert.equal(e.role, 'production_operator'); assert.equal(e.write, true); assert.equal(e.perms.production, 'vae');
  });
  test('changing the role from the row writes it and updates the note', async () => {
    load(OWNER, { [WORKER]: entry({ role: 'business_viewer', write: true }) });
    await run(`cloudPeopleSetRole('${WORKER}', 'production_operator')`);
    assert.equal(docs.get('config/access').approved[WORKER].role, 'production_operator');
    assert.equal(docs.get(noteId(WORKER)).perms.production, 'vae');
  });
  test('Save access reads the boxes and keeps only what differs from the role; a section whose V is off counts as none', async () => {
    load(OWNER, { [WORKER]: entry({ role: 'business_viewer', write: false }) });
    const boxes = [['sales', 'v', true], ['sales', 'a', true], ['production', 'v', true], ['recovery', 'e', true], ['wages', 'v', true]].map(([s, l, on]) => ({ checked: on, getAttribute: () => WORKER + '|' + s + '|' + l }));
    const box = { querySelectorAll: sel => sel === '[data-cp-perm]' ? boxes : [] };
    ctx.__b = box;
    await run(`cloudPeopleSavePerms(__b, { disabled: false }, '${WORKER}')`);
    const e = docs.get('config/access').approved[WORKER];
    // ticked: sales V+A, production V, recovery E only (no V = none), wages V. Unticked role sections (reference, business) are removed.
    assert.deepEqual(e.overrides, { sales: 'va', recovery: '', reference: '', business: '', wages: 'v' });
    assert.equal(e.perms.sales, 'v', 'write is off, so only view counts for now');
    const off = [['sales', 'a', true], ['production', 'v', true]].map(([s2, l, on]) => ({ checked: on, getAttribute: () => WORKER + '|' + s2 + '|' + l }));
    ctx.__b = { querySelectorAll: () => off };
    await run(`cloudPeopleSavePerms(__b, { disabled: false }, '${WORKER}')`);
    assert.deepEqual(Object.keys(docs.get('config/access').approved[WORKER].perms), ['production'], 'sales has A but no V, so it counts as none');
  });
  test('Reset to role clears the overrides', async () => {
    load(OWNER, { [WORKER]: entry({ role: 'business_viewer', overrides: { wages: 'v' } }) });
    await run(`cloudPeopleResetPerms({ disabled: false }, '${WORKER}')`);
    assert.equal(docs.get('config/access').approved[WORKER].overrides, undefined);
  });
});

describe('the person\'s note and phone', () => {
  test('the note carries the role and the effective permissions; revoking deletes it', async () => {
    load(OWNER, { [WORKER]: entry({ role: 'production_operator', write: true }) });
    await run(`cloudAccessEdit(r => cloudAccessApplySetWrite(r, '${WORKER}', true, ${NOW}))`);
    const n = docs.get(noteId(WORKER));
    assert.equal(n.role, 'production_operator'); assert.equal(n.write, true); assert.deepEqual(n.perms, { production: 'vae', reference: 'v', business: 'v' });
    await run(`cloudAccessEdit(r => cloudAccessApplyRemove(r, '${WORKER}', ${NOW}))`);
    assert.equal(docs.has(noteId(WORKER)), false);
  });
  test('the phone learns its permissions from the note and edits only when an edit letter is among them', async () => {
    load(WORKER);
    docs.set(noteId(WORKER), { write: true, expiresAt: Date.now() + DAY, role: 'production_operator', perms: { production: 'vae', reference: 'v', business: 'v' } });
    assert.equal(await run('waRefreshGrant()'), 'active');
    assert.deepEqual(JSON.parse(store.get('khata-cloud-perms')), { production: 'vae', reference: 'v', business: 'v' });
    assert.deepEqual(j(run('cloudWriteSections()')), ['production']);
    assert.deepEqual(j(run('cloudReadSections()')), ['production', 'reference', 'business']);
  });
  test('a Business viewer with the edit switch on still cannot edit anything', async () => {
    load(WORKER);
    docs.set(noteId(WORKER), { write: true, expiresAt: Date.now() + DAY, role: 'business_viewer', perms: { production: 'v', sales: 'v' } });
    assert.equal(await run('waRefreshGrant()'), 'none');
    assert.equal(run('viewOnly()'), true); assert.deepEqual(j(run('cloudWriteSections()')), []);
  });
  test('a view-only note teaches the phone what it may look at', async () => {
    load(WORKER);
    docs.set(noteId(WORKER), { write: false, expiresAt: Date.now() + DAY, role: 'business_viewer', perms: { production: 'v', reference: 'v', sales: 'v', recovery: 'v', business: 'v' } });
    await run('waRefreshGrant()');
    assert.deepEqual(j(run('cloudReadSections()')), ['production', 'reference', 'sales', 'recovery', 'business']);
    assert.equal(run(`cloudCanViewSection('wages')`), false);
  });
  test('no note, an ended note, or a removed approval leaves the phone with no known permissions (it sends nothing)', async () => {
    load(WORKER); store.set('khata-cloud-perms', JSON.stringify({ production: 'vae' }));
    await run('waRefreshGrant()');
    assert.equal(store.has('khata-cloud-perms'), false); assert.deepEqual(j(run('cloudWriteSections()')), []);
    docs.set(noteId(WORKER), { write: true, expiresAt: Date.now() - 1000, perms: { production: 'vae' } });
    store.set('khata-cloud-perms', JSON.stringify({ production: 'vae' }));
    await run('waRefreshGrant()'); assert.equal(store.has('khata-cloud-perms'), false);
  });
  test('the owner\'s phone never stores permissions and always has every section', async () => {
    assert.equal(await run('waRefreshGrant()'), 'skipped');
    assert.equal(run('cloudSectionPerm("wages")'), 'vaed');
  });
});

// ---- Settings: creating and editing roles, granting for a duration, adjusting per section ---------------
const SAVE = (r, id, label, perms) => run(`cloudAccessApplyRoleSave(${JSON.stringify(r)}, ${JSON.stringify(id)}, ${JSON.stringify(label)}, ${JSON.stringify(perms)}, ${NOW})`);
const grid = (attr, key, letters) => Object.keys(letters).flatMap(sec => letters[sec].split('').map(l => ({ checked: true, getAttribute: () => key + '|' + sec + '|' + l })));
const card = (nameKey, nameVal, attr, key, letters) => ({ querySelectorAll: sel => sel === '[' + attr + ']' ? grid(attr, key, letters) : (sel === '[data-rl-name]' ? [{ getAttribute: () => nameKey, value: nameVal }] : []) });

describe('creating and editing roles (pure)', () => {
  test('a new role gets its own id, a cleaned permission map, and shows up with the built-ins', () => {
    const out = j(SAVE(rec(), null, '  Accounts clerk ', { expenses: 'vae', wages: 'v', nope: undefined }));
    assert.match(out.id, /^r-accounts-clerk-/); assert.deepEqual(out.emails, []);
    assert.deepEqual(out.record.roles[out.id], { label: 'Accounts clerk', perms: { expenses: 'vae', wages: 'v' } });
    const roles = j(run(`cloudRolesOf(${JSON.stringify(out.record)})`));
    assert.deepEqual(Object.keys(roles).slice(0, 3), ['business_viewer', 'production_operator', 'custom']);
    assert.equal(roles[out.id].builtin, false); assert.equal(roles.business_viewer.builtin, true);
  });
  test('names: blank, too long, or already used (any case) are refused', () => {
    assert.throws(() => SAVE(rec(), null, '   ', {}), /name/);
    assert.throws(() => SAVE(rec(), null, 'x'.repeat(41), {}), /under 40/);
    assert.throws(() => SAVE(rec(), null, 'business VIEWER', {}), /already a role called Business viewer/);
    assert.throws(() => SAVE(rec(), null, 'Custom', {}), /already a role/);
  });
  test('unknown sections are refused; the fixed Custom role and missing roles cannot be edited', () => {
    assert.throws(() => SAVE(rec(), null, 'A', { payroll: 'v' }), /Unknown section/);
    assert.throws(() => SAVE(rec(), 'custom', 'Custom', { sales: 'v' }), /cannot be changed/);
    assert.throws(() => SAVE(rec(), 'r-gone', 'Gone', {}), /no longer exists/);
  });
  test('two roles made in the same millisecond still get different ids', () => {
    const a = j(SAVE(rec(), null, 'Role A', {})); const b = j(SAVE(a.record, null, 'Role B', {}));
    assert.notEqual(a.id, b.id);
  });
  test('editing a role recomputes everyone who has it, keeps their own overrides, and lists them for note updates', () => {
    const r0 = rec({ [WORKER]: entry({ role: 'business_viewer', overrides: { expenses: 'v' }, write: true }), 'b@example.com': entry({ role: 'business_viewer' }), 'c@example.com': entry({ role: 'production_operator' }) });
    const out = j(SAVE(r0, 'business_viewer', 'Business viewer', { sales: 'v', recovery: 'v' }));
    assert.deepEqual(out.emails.sort(), ['b@example.com', WORKER]);
    assert.deepEqual(out.record.approved[WORKER].perms, { sales: 'v', recovery: 'v', expenses: 'v' }, 'the role changed, their adjustment stayed');
    assert.deepEqual(out.record.approved['b@example.com'].perms, { sales: 'v', recovery: 'v' });
    assert.deepEqual(out.record.approved['c@example.com'], r0.approved['c@example.com'], 'holders of other roles are untouched');
    assert.equal(out.record.roles.business_viewer.perms.production, undefined);
  });
  test('an edited role\'s edit letters reach its holders only while their edit switch is on', () => {
    const r0 = rec({ [WORKER]: entry({ role: 'production_operator', write: true }), 'b@example.com': entry({ role: 'production_operator', write: false }) });
    const out = j(SAVE(r0, 'production_operator', 'Production operator', { production: 'vaed', reference: 'v' }));
    assert.equal(out.record.approved[WORKER].perms.production, 'vaed'); assert.equal(out.record.approved['b@example.com'].perms.production, 'v');
  });
  test('renaming a role changes the name everywhere and not the people\'s access', () => {
    const r0 = rec({ [WORKER]: entry({ role: 'production_operator', write: true }) });
    const out = j(SAVE(r0, 'production_operator', 'Floor supervisor', { production: 'vae', reference: 'v', business: 'v' }));
    assert.equal(j(run(`cloudRolesOf(${JSON.stringify(out.record)})`)).production_operator.label, 'Floor supervisor');
    assert.equal(j(run(`cloudAccessList(${JSON.stringify(out.record)}, ${NOW})`))[0].role, 'production_operator');
  });
  test('the record passed in is not changed', () => {
    const r0 = rec({ [WORKER]: entry({ role: 'business_viewer' }) }), before = JSON.stringify(r0);
    SAVE(r0, 'business_viewer', 'Business viewer', { sales: 'v' });
    assert.equal(JSON.stringify(r0), before);
  });
});

describe('deleting and resetting roles (pure)', () => {
  const withClerk = () => j(SAVE(rec({ [WORKER]: entry({ role: 'business_viewer' }) }), null, 'Clerk', { expenses: 'v' }));
  test('a role you made can be deleted when nobody has it', () => {
    const c = withClerk();
    const out = j(run(`cloudAccessApplyRoleDelete(${JSON.stringify(c.record)}, '${c.id}', ${NOW})`));
    assert.equal(out.record.roles[c.id], undefined); assert.equal(out.reset, false);
  });
  test('it is refused while someone has it, saying how many', () => {
    const c = withClerk();
    const used = j(run(`cloudAccessApplySetRole(${JSON.stringify(c.record)}, '${WORKER}', '${c.id}', ${NOW})`)).record;
    assert.throws(() => run(`cloudAccessApplyRoleDelete(${JSON.stringify(used)}, '${c.id}', ${NOW})`), /1 person has this role/);
  });
  test('an edited built-in role can be reset to the original, and its holders follow', () => {
    const r0 = rec({ [WORKER]: entry({ role: 'business_viewer' }) });
    const edited = j(SAVE(r0, 'business_viewer', 'Business viewer', { sales: 'v' })).record;
    const out = j(run(`cloudAccessApplyRoleDelete(${JSON.stringify(edited)}, 'business_viewer', ${NOW})`));
    assert.equal(out.reset, true); assert.deepEqual(out.emails, [WORKER]);
    assert.deepEqual(out.record.approved[WORKER].perms, { production: 'v', reference: 'v', sales: 'v', recovery: 'v', business: 'v' });
  });
  test('an unchanged built-in role, Custom and a missing role cannot be deleted', () => {
    assert.throws(() => run(`cloudAccessApplyRoleDelete(${JSON.stringify(rec())}, 'business_viewer', ${NOW})`), /not been changed/);
    assert.throws(() => run(`cloudAccessApplyRoleDelete(${JSON.stringify(rec())}, 'custom', ${NOW})`), /cannot be removed/);
    assert.throws(() => run(`cloudAccessApplyRoleDelete(${JSON.stringify(rec())}, 'r-gone', ${NOW})`), /no longer exists/);
  });
});

describe('granting a role for a chosen time, and adjusting sections, with your own roles', () => {
  const clerkRec = () => { const c = j(SAVE(rec(), null, 'Clerk', { expenses: 'vae' })); return { id: c.id, record: c.record }; };
  test('approving with a role you made stores it, for the chosen end time', () => {
    const { id, record } = clerkRec();
    const out = j(run(`cloudAccessApplyApprove(${JSON.stringify(record)}, '${WORKER}', ${NOW + 2 * DAY}, ${NOW}, true, '${id}')`));
    const e = out.record.approved[WORKER];
    assert.equal(e.role, id); assert.equal(e.expiresAt, NOW + 2 * DAY); assert.deepEqual(e.perms, { expenses: 'vae' });
  });
  test('approving again with another role and a new duration replaces both and clears their overrides', () => {
    const { id, record } = clerkRec();
    const first = j(run(`cloudAccessApplyApprove(${JSON.stringify(record)}, '${WORKER}', ${NOW + DAY}, ${NOW}, true, 'production_operator')`)).record;
    const adjusted = j(run(`cloudAccessApplySetPerms(${JSON.stringify(first)}, '${WORKER}', { production: 'vaed', reference: 'v' }, ${NOW})`)).record;
    const again = j(run(`cloudAccessApplyApprove(${JSON.stringify(adjusted)}, '${WORKER}', ${NOW + 9 * DAY}, ${NOW}, undefined, '${id}')`)).record.approved[WORKER];
    assert.equal(again.role, id); assert.equal(again.expiresAt, NOW + 9 * DAY); assert.equal(again.overrides, undefined); assert.equal(again.write, true, 'edit switch kept');
  });
  test('per-person adjustments are measured against the role as edited', () => {
    const { id, record } = clerkRec();
    const r1 = j(run(`cloudAccessApplyApprove(${JSON.stringify(record)}, '${WORKER}', ${NOW + DAY}, ${NOW}, true, '${id}')`)).record;
    const r2 = j(run(`cloudAccessApplySetPerms(${JSON.stringify(r1)}, '${WORKER}', { expenses: 'vaed' }, ${NOW})`)).record;
    assert.deepEqual(r2.approved[WORKER].overrides, { expenses: 'vaed' });
    const r3 = j(SAVE(r2, id, 'Clerk', { expenses: 'vaed' })).record; // role now grants the same: the old override is redundant but harmless
    assert.equal(r3.approved[WORKER].perms.expenses, 'vaed');
  });
});

describe('the Roles card and the actions behind it', () => {
  test('the card appears for the owner with the roles, how many people have each, and Edit / New role', () => {
    const r0 = rec({ [WORKER]: entry({ role: 'production_operator' }), 'b@example.com': entry({ role: 'production_operator' }) });
    const html = run(`cloudRolesHtml(${JSON.stringify(r0)})`);
    assert.match(html, /Production operator<span[^>]*>2 people · built in/); assert.match(html, /Business viewer<span[^>]*>0 people/);
    assert.match(html, /Production VAE, Employees, looms, qualities V, Business info V/);
    assert.match(html, /data-rl-edit="business_viewer"/); assert.match(html, /data-rl-new="1"/); assert.match(html, /data-rl-save="new"/);
    assert.doesNotMatch(html, /data-rl-edit="custom"/, 'the fixed Custom role has no editor');
    assert.match(html, /data-rl-delete="business_viewer" disabled/, 'an unchanged built-in cannot be reset');
    assert.equal((html.match(/data-rl-perm="new\|/g) || []).length, 48, 'the new-role form has every section and letter');
    assert.match(run('cloudRolesCardHtml()'), /Roles/);
  });
  test('the Settings page shows the Roles card only to the verified owner, after People', () => {
    assert.match(run('cloudPeopleSection()'), /<h2>People<\/h2>[\s\S]*<h2>Roles<\/h2>/);
    load(WORKER); assert.equal(run('cloudPeopleSection()'), '');
  });
  test('a role you made appears in the add form\'s and each person\'s role pickers', () => {
    const c = j(SAVE(rec({ [WORKER]: entry() }), null, 'Clerk', { expenses: 'v' }));
    assert.match(run(`cloudPeopleListHtml(${JSON.stringify(c.record)}, ${NOW})`), new RegExp('<option value="' + c.id + '">Clerk</option>'));
    assert.match(run(`cloudRoleOptionsHtml(cloudRolesOf(${JSON.stringify(c.record)}), 'business_viewer')`), /Clerk/);
  });
  test('New role: reads the name and the ticked boxes, saves the role in the record', async () => {
    load(OWNER, {});
    ctx.__b = card('new', 'Accounts clerk', 'data-rl-perm', 'new', { expenses: 'vae', wages: 'v', sales: 'a' });
    await run(`cloudRolesSave(__b, { disabled: false }, 'new')`);
    const roles = docs.get('config/access').roles, id = Object.keys(roles)[0];
    assert.equal(roles[id].label, 'Accounts clerk');
    assert.deepEqual(roles[id].perms, { expenses: 'vae', wages: 'v' }, 'sales has Add ticked but not View, so it counts as none');
  });
  test('editing a role re-sends the note of everyone who has it, and not anyone else\'s', async () => {
    load(OWNER, { [WORKER]: entry({ role: 'production_operator', write: true }), 'other@example.com': entry({ role: 'business_viewer' }) });
    await run('waMirrorAll(JSON.parse(JSON.stringify({ approved: {} })))'); docs.delete(noteId('other@example.com'));
    ctx.__b = card('production_operator', 'Production operator', 'data-rl-perm', 'production_operator', { production: 'vaed', reference: 'v' });
    await run(`cloudRolesSave(__b, { disabled: false }, 'production_operator')`);
    assert.deepEqual(docs.get(noteId(WORKER)).perms, { production: 'vaed', reference: 'v' });
    assert.equal(docs.has(noteId('other@example.com')), false, 'nobody else\'s note was touched');
  });
  test('a refused save (duplicate name) shows the reason and changes nothing', async () => {
    load(OWNER, {});
    ctx.__b = card('new', 'business viewer', 'data-rl-perm', 'new', { sales: 'v' });
    await run(`cloudRolesSave(__b, { disabled: false }, 'new')`);
    assert.equal(docs.get('config/access').roles, undefined); assert.match(page.cloudRolesMsg.textContent, /already a role called/);
  });
  test('Delete needs a second tap; a role somebody has is refused with the reason', async () => {
    const c = j(SAVE(rec({ [WORKER]: entry() }), null, 'Clerk', { expenses: 'v' }));
    const used = j(run(`cloudAccessApplySetRole(${JSON.stringify(c.record)}, '${WORKER}', '${c.id}', ${NOW})`)).record;
    load(OWNER, used.approved); docs.set('config/access', used);
    const btn = { disabled: false, textContent: 'Delete', __armed: null };
    await run(`cloudRolesDelete(${JSON.stringify(btn)}, '${c.id}')`); // first tap on a copy arms nothing persistent; use the live object below
    ctx.__btn = btn;
    await run(`cloudRolesDelete(__btn, '${c.id}')`); assert.equal(btn.textContent, 'Tap again'); assert.ok(docs.get('config/access').roles[c.id]);
    await run(`cloudRolesDelete(__btn, '${c.id}')`);
    assert.match(page.cloudRolesMsg.textContent, /1 person has this role/); assert.ok(docs.get('config/access').roles[c.id]);
  });
  test('deleting an unused role removes it; resetting an edited built-in puts the original back', async () => {
    const c = j(SAVE(rec(), null, 'Clerk', { expenses: 'v' }));
    load(OWNER, {}); docs.set('config/access', c.record);
    ctx.__btn = { disabled: false, textContent: 'Delete', __armed: null };
    await run(`cloudRolesDelete(__btn, '${c.id}')`); await run(`cloudRolesDelete(__btn, '${c.id}')`);
    assert.equal(docs.get('config/access').roles[c.id], undefined);
    const edited = j(SAVE(rec(), 'business_viewer', 'Business viewer', { sales: 'v' })).record;
    docs.set('config/access', edited); ctx.__btn = { disabled: false, textContent: 'Reset', __armed: null };
    await run(`cloudRolesDelete(__btn, 'business_viewer')`); await run(`cloudRolesDelete(__btn, 'business_viewer')`);
    assert.equal(docs.get('config/access').roles.business_viewer, undefined);
  });
  test('the person row\'s Sections grid still saves per-action overrides on top of a role you made', async () => {
    const c = j(SAVE(rec({ [WORKER]: entry({ write: true }) }), null, 'Clerk', { expenses: 'vae' }));
    const set = j(run(`cloudAccessApplySetRole(${JSON.stringify(c.record)}, '${WORKER}', '${c.id}', ${NOW})`)).record;
    load(OWNER, {}); docs.set('config/access', set);
    ctx.__b = { querySelectorAll: sel => sel === '[data-cp-perm]' ? grid('data-cp-perm', WORKER, { expenses: 'vaed', loans: 'v' }) : [] };
    await run(`cloudPeopleSavePerms(__b, { disabled: false }, '${WORKER}')`);
    const e = docs.get('config/access').approved[WORKER];
    assert.deepEqual(e.overrides, { expenses: 'vaed', loans: 'v' }); assert.deepEqual(e.perms, { expenses: 'vaed', loans: 'v' });
    assert.deepEqual(docs.get(noteId(WORKER)).perms, e.perms, 'the phone is told');
  });
  test('the add form sends the chosen role and duration, so a person is granted a role for that long', async () => {
    const c = j(SAVE(rec(), null, 'Clerk', { expenses: 'vae' }));
    load(OWNER, {}); docs.set('config/access', c.record);
    page.cloudPeopleEmail.value = WORKER; page.cloudPeopleRole.value = c.id; page.cloudPeopleAmount.value = '3'; page.cloudPeopleUnit.value = 'hours';
    const before = Date.now(); await run('cloudPeopleAdd(true)');
    const e = docs.get('config/access').approved[WORKER];
    assert.equal(e.role, c.id); assert.ok(e.expiresAt >= before + 3 * 3600000 - 1000 && e.expiresAt <= Date.now() + 3 * 3600000 + 1000);
    assert.deepEqual(docs.get(noteId(WORKER)).perms, { expenses: 'vae' });
  });
  test('everything is owner only: another account cannot save or delete roles', async () => {
    load(WORKER, {});
    await run(`cloudRolesSave({ querySelectorAll: () => [] }, { disabled: false }, 'new')`);
    assert.equal(docs.get('config/access').roles, undefined, 'the record was not changed');
    assert.match(page.cloudRolesMsg.textContent, /Only the owner/);
  });
});
