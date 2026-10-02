'use strict';
/*
 * Release 3 step "Needs approval": the owner switches it on or off for each person, per section, on the People
 * card. It is saved with the rest of the permissions (config/access, and the person's small note in sync/), needs
 * no Firebase console change, and never changes what the person may see or do - it only tells their phone which
 * sections the owner wants to OK changes in (what happens to those changes is a later step).
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


const boxesFor = (email, on) => ({ querySelectorAll: sel => sel === '[data-cp-appr]' ? Object.keys(on).map(id => ({ checked: on[id], getAttribute: () => email + '|' + id })) : [] });
const all = v => { const o = {}; run('cloudSectionIds()').forEach(id => { o[id] = v; }); return o; };
const R0 = () => rec({ [WORKER]: entry({ role: 'production_operator', write: true }) });

describe('the record', () => {
  test('saving with switches stores only the sections that are on, and the letters are untouched', () => {
    const out = j(run(`cloudAccessApplySetPerms(${JSON.stringify(R0())}, '${WORKER}', { production: 'vae', reference: 'v', business: 'v' }, ${NOW}, { production: true, wages: false, sales: true })`));
    const e = out.record.approved[WORKER];
    assert.deepEqual(e.needsApproval, { production: true, sales: true });
    assert.deepEqual(e.perms, { production: 'vae', reference: 'v', business: 'v' }, 'same permissions as without the switch');
    assert.deepEqual(out.needsApproval, { production: true, sales: true });
  });
  test('turning every switch off removes the field completely', () => {
    const r1 = j(run(`cloudAccessApplySetPerms(${JSON.stringify(R0())}, '${WORKER}', { production: 'vae' }, ${NOW}, { production: true })`)).record;
    const r2 = j(run(`cloudAccessApplySetPerms(${JSON.stringify(r1)}, '${WORKER}', { production: 'vae' }, ${NOW}, { production: false })`)).record;
    assert.equal('needsApproval' in r2.approved[WORKER], false);
  });
  test('leaving the approval argument out keeps what was set (other callers of Set perms do not wipe it)', () => {
    const r1 = j(run(`cloudAccessApplySetPerms(${JSON.stringify(R0())}, '${WORKER}', { production: 'vae' }, ${NOW}, { production: true })`)).record;
    const r2 = j(run(`cloudAccessApplySetPerms(${JSON.stringify(r1)}, '${WORKER}', { production: 'va' }, ${NOW})`)).record;
    assert.deepEqual(r2.approved[WORKER].needsApproval, { production: true });
  });
  test('only true counts: false, text and unknown sections are dropped when cleaned', () => {
    assert.deepEqual(j(run(`cloudNeedsApprovalClean({ production: true, sales: false, wages: 'yes', nonsense: true })`)), { production: true });
    assert.deepEqual(j(run('cloudNeedsApprovalClean(null)')), {});
  });
  test('an unknown section is refused and nothing is changed', () => {
    const r = R0();
    assert.throws(() => run(`cloudAccessApplySetPerms(${JSON.stringify(r)}, '${WORKER}', {}, ${NOW}, { nonsense: true })`), /Unknown section/);
    assert.equal(r.approved[WORKER].needsApproval, undefined);
  });
  test('the switches survive a role change, a new end time, Allow edit / Stop edit and editing the role', () => {
    let r = j(run(`cloudAccessApplySetPerms(${JSON.stringify(R0())}, '${WORKER}', { production: 'vae', reference: 'v', business: 'v' }, ${NOW}, { production: true })`)).record;
    r = j(run(`cloudAccessApplySetRole(${JSON.stringify(r)}, '${WORKER}', 'business_viewer', ${NOW})`)).record;
    assert.deepEqual(r.approved[WORKER].needsApproval, { production: true });
    r = j(run(`cloudAccessApplyApprove(${JSON.stringify(r)}, '${WORKER}', ${NOW + 5 * DAY}, ${NOW}, undefined, 'production_operator')`)).record;
    assert.deepEqual(r.approved[WORKER].needsApproval, { production: true });
    r = j(run(`cloudAccessApplySetWrite(${JSON.stringify(r)}, '${WORKER}', false, ${NOW})`)).record;
    assert.deepEqual(r.approved[WORKER].needsApproval, { production: true });
    r = j(run(`cloudAccessApplyRoleSave(${JSON.stringify(r)}, 'production_operator', 'Production operator', { production: 'vaed' }, ${NOW})`)).record;
    assert.deepEqual(r.approved[WORKER].needsApproval, { production: true });
  });
  test('it is one person only: someone else on the list is not touched', () => {
    const r = rec({ [WORKER]: entry({ role: 'production_operator' }), 'other@example.com': entry({ role: 'production_operator' }) });
    const out = j(run(`cloudAccessApplySetPerms(${JSON.stringify(r)}, '${WORKER}', { production: 'vae' }, ${NOW}, { production: true })`)).record;
    assert.equal(out.approved['other@example.com'].needsApproval, undefined);
  });
  test('the list for the screen carries it; the record passed in is not changed', () => {
    const r = rec({ [WORKER]: entry({ role: 'production_operator', needsApproval: { wages: true } }) });
    assert.deepEqual(j(run(`cloudAccessList(${JSON.stringify(r)}, ${NOW})`))[0].needsApproval, { wages: true });
    const before = JSON.stringify(r);
    run(`cloudAccessApplySetPerms(${JSON.stringify(r)}, '${WORKER}', {}, ${NOW}, { production: true })`);
    assert.equal(JSON.stringify(r), before);
  });
});

describe('the People card', () => {
  test('each person gets one Needs approval box per section, ticked where it is on, and a summary line', () => {
    const r = rec({ [WORKER]: entry({ role: 'production_operator', needsApproval: { production: true, wages: true } }), 'b@example.com': entry({ role: 'business_viewer' }) });
    const html = run(`cloudPeopleListHtml(${JSON.stringify(r)}, ${NOW})`);
    assert.equal((html.match(/data-cp-appr="worker@example\.com\|/g) || []).length, 12);
    assert.equal((html.match(/data-cp-appr="worker@example\.com\|(production|wages)" checked/g) || []).length, 2);
    assert.match(html, /Needs your approval: Production, Wages/);
    assert.equal((html.match(/Needs your approval:/g) || []).length, 1, 'no summary line for a person with none on');
    assert.match(html, /Needs my approval/);
  });
  test('Save access saves the switches together with the letters in one write', async () => {
    load(OWNER, { [WORKER]: entry({ role: 'production_operator', write: true }) });
    const on = all(false); on.production = true; on.reference = true;
    const pb = [['production', 'v'], ['production', 'a'], ['production', 'e'], ['reference', 'v'], ['business', 'v']].map(([s, l]) => ({ checked: true, getAttribute: () => WORKER + '|' + s + '|' + l }));
    ctx.__b = { querySelectorAll: sel => sel === '[data-cp-perm]' ? pb : (sel === '[data-cp-appr]' ? boxesFor(WORKER, on).querySelectorAll(sel) : []) };
    await run(`cloudPeopleSavePerms(__b, { disabled: false }, '${WORKER}')`);
    const e = docs.get('config/access').approved[WORKER];
    assert.deepEqual(e.needsApproval, { production: true, reference: true });
    assert.deepEqual(e.perms, { production: 'vae', reference: 'v', business: 'v' });
    assert.match(page.cloudPeopleMsg.textContent, /Needs your approval: Production, Employees, looms, qualities/);
  });
  test('unticking everything and saving turns it off again, in the record and in their note', async () => {
    load(OWNER, { [WORKER]: entry({ role: 'production_operator', write: true, needsApproval: { production: true } }) });
    const pb = [['production', 'v'], ['production', 'a'], ['production', 'e'], ['reference', 'v'], ['business', 'v']].map(([s, l]) => ({ checked: true, getAttribute: () => WORKER + '|' + s + '|' + l }));
    ctx.__b = { querySelectorAll: sel => sel === '[data-cp-perm]' ? pb : (sel === '[data-cp-appr]' ? boxesFor(WORKER, all(false)).querySelectorAll(sel) : []) };
    await run(`cloudPeopleSavePerms(__b, { disabled: false }, '${WORKER}')`);
    assert.equal('needsApproval' in docs.get('config/access').approved[WORKER], false);
    assert.deepEqual(docs.get(noteId(WORKER)).needsApproval, {});
  });
  test('Reset to role only resets the letters; the switches stay', async () => {
    load(OWNER, { [WORKER]: entry({ role: 'business_viewer', overrides: { wages: 'v' }, needsApproval: { sales: true } }) });
    await run(`cloudPeopleResetPerms({ disabled: false }, '${WORKER}')`);
    const e = docs.get('config/access').approved[WORKER];
    assert.equal(e.overrides, undefined); assert.deepEqual(e.needsApproval, { sales: true });
  });
  test('a switch is refused for someone no longer on the list, and nothing is written', async () => {
    load(OWNER, {});
    ctx.__b = boxesFor(WORKER, all(true));
    await run(`cloudPeopleSavePerms(__b, { disabled: false }, '${WORKER}')`);
    assert.match(page.cloudPeopleMsg.textContent, /no longer on the list/);
    assert.equal(docs.has(noteId(WORKER)), false);
  });
});

describe('the person\'s note and phone', () => {
  test('the note carries the switches next to the permissions; old entries get an empty map', async () => {
    load(OWNER, { [WORKER]: entry({ role: 'production_operator', write: true, needsApproval: { production: true } }), 'old@example.com': entry({ role: 'business_viewer' }) });
    await run(`cloudAccessEdit(r => cloudAccessApplySetWrite(r, '${WORKER}', true, ${NOW}))`);
    assert.deepEqual(docs.get(noteId(WORKER)).needsApproval, { production: true });
    await run(`cloudAccessEdit(r => cloudAccessApplySetWrite(r, 'old@example.com', false, ${NOW}))`);
    assert.deepEqual(docs.get(noteId('old@example.com')).needsApproval, {});
  });
  test('the phone learns the switches from the note; only the flagged sections need approval', async () => {
    load(WORKER);
    docs.set(noteId(WORKER), { write: true, expiresAt: Date.now() + DAY, role: 'production_operator', perms: { production: 'vae', reference: 'v', business: 'v' }, needsApproval: { production: true } });
    assert.equal(await run('waRefreshGrant()'), 'active');
    assert.deepEqual(JSON.parse(store.get('khata-cloud-needs-approval')), { production: true });
    assert.equal(run(`cloudNeedsApproval('production')`), true);
    assert.equal(run(`cloudNeedsApproval('reference')`), false);
    assert.deepEqual(j(run('cloudWriteSections()')), [], 'since 3.17.29 the person\'s own phone never sends a section that needs approval (the cloud rule refuses it too)');
  });
  test('switching it off on the owner\'s phone reaches the other phone on its next check', async () => {
    load(WORKER);
    docs.set(noteId(WORKER), { write: true, expiresAt: Date.now() + DAY, role: 'production_operator', perms: { production: 'vae' }, needsApproval: { production: true } });
    await run('waRefreshGrant()');
    docs.set(noteId(WORKER), { write: true, expiresAt: Date.now() + DAY, role: 'production_operator', perms: { production: 'vae' }, needsApproval: {} });
    await run('waRefreshGrant()');
    assert.equal(run(`cloudNeedsApproval('production')`), false);
  });
  test('a note from before this step (no field) means nothing needs approval', async () => {
    load(WORKER);
    docs.set(noteId(WORKER), { write: true, expiresAt: Date.now() + DAY, role: 'production_operator', perms: { production: 'vae' } });
    await run('waRefreshGrant()');
    assert.equal(run(`cloudNeedsApproval('production')`), false);
  });
  test('a view-only person holds the switches too (they count the moment edit is allowed)', async () => {
    load(WORKER);
    docs.set(noteId(WORKER), { write: false, expiresAt: Date.now() + DAY, role: 'production_operator', perms: { production: 'v' }, needsApproval: { production: true } });
    await run('waRefreshGrant()');
    assert.equal(run(`cloudNeedsApproval('production')`), true);
  });
  test('no note, an ended note or a removed approval clears them with the permissions', async () => {
    load(WORKER); store.set('khata-cloud-perms', JSON.stringify({ production: 'vae' })); store.set('khata-cloud-needs-approval', JSON.stringify({ production: true }));
    await run('waRefreshGrant()');
    assert.equal(store.has('khata-cloud-needs-approval'), false); assert.equal(run(`cloudNeedsApproval('production')`), false);
    docs.set(noteId(WORKER), { write: true, expiresAt: Date.now() - 1000, perms: { production: 'vae' }, needsApproval: { production: true } });
    store.set('khata-cloud-needs-approval', JSON.stringify({ production: true }));
    await run('waRefreshGrant()');
    assert.equal(store.has('khata-cloud-needs-approval'), false);
  });
  test('a damaged stored value is read as nothing needing approval', () => {
    load(WORKER);
    store.set('khata-cloud-needs-approval', '{not json');
    assert.equal(run(`cloudNeedsApproval('production')`), false);
    store.set('khata-cloud-needs-approval', '[1,2]');
    assert.equal(run(`cloudNeedsApproval('production')`), false);
  });
  test('the owner is never asked, even if a value were stored on the owner\'s phone', () => {
    store.set('khata-cloud-needs-approval', JSON.stringify({ production: true }));
    assert.equal(run(`cloudNeedsApproval('production')`), false);
  });
});

describe('nothing else changes, and nothing to do in the Firebase console', () => {
  test('the same person with and without switches has identical permissions and identical rules text', () => {
    const a = j(run(`cloudAccessApplySetPerms(${JSON.stringify(R0())}, '${WORKER}', { production: 'vae' }, ${NOW})`)).record.approved[WORKER];
    const b = j(run(`cloudAccessApplySetPerms(${JSON.stringify(R0())}, '${WORKER}', { production: 'vae' }, ${NOW}, ${JSON.stringify(all(true))})`)).record.approved[WORKER];
    assert.deepEqual(a.perms, b.perms); assert.equal(a.write, b.write); assert.equal(a.expiresAt, b.expiresAt);
  });
  test('the note stays in the existing sync collection (already covered by the current rules)', async () => {
    load(OWNER, { [WORKER]: entry({ role: 'production_operator', needsApproval: { production: true } }) });
    await run(`cloudAccessEdit(r => cloudAccessApplySetWrite(r, '${WORKER}', true, ${NOW}))`);
    assert.ok([...docs.keys()].every(k => k === 'config/access' || k.startsWith('sync/grant-')), [...docs.keys()].join(', '));
  });
});
