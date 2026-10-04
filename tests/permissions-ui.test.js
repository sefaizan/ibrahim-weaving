'use strict';
/*
 * Release 3, on screen: what a role allows (js/view-only.js: perms*, plus the hooks in js/shell.js and
 * js/cloud-sync.js). Tabs the account cannot use are left out, sections it may not view are not kept on the
 * phone, Edit / Delete / Add controls are hidden per action, a click that slips through is stopped, and save()
 * refuses any change outside the role (last layer). Runs the real cloud-sync.js, view-only.js and write-access.js.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const OWNER = 'se.muhammadfaizan@gmail.com', WORKER = 'worker@example.com';
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const HOUR = 3600 * 1000;

const TABS = ['overview', 'production', 'sale', 'recovery', 'expense', 'wages', 'loans', 'ratecalc', 'family', 'personal', 'personalloans', 'warp', 'weft', 'warpbeams', 'checkpoints', 'graphs', 'settings', 'backup'].map(id => ({ id, label: id }));
const VIEWER = { production: 'v', reference: 'v', sales: 'v', recovery: 'v', business: 'v' };           // Business viewer
const OPERATOR = { production: 'vae', reference: 'v', business: 'v' };                                    // Production operator, edit switch on
const OPERATOR_OFF = { production: 'v', reference: 'v', business: 'v' };                                  // the same, edit switch off

let ctx, store, toasts, saves, redraws;
function load(opts) {
  opts = opts || {};
  store = new Map(); toasts = []; saves = []; redraws = [];
  const email = opts.email === undefined ? WORKER : opts.email;
  if (email) store.set('khata-cloud-user', JSON.stringify({ email, verified: true }));
  if (opts.perms) store.set('khata-cloud-perms', JSON.stringify(opts.perms));
  if (opts.grant) store.set('khata-write-grant', JSON.stringify({ email: WORKER, expiresAt: Date.now() + 2 * HOUR }));
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {}, animate() {}, classList: { add() {}, toggle() {} } });
  ctx = vm.createContext({
    console: { log() {}, error() {} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp,
    setTimeout: () => 1, clearTimeout() {}, setInterval() {}, navigator: { onLine: true },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { getElementById: () => null, createElement: el, body: { appendChild() {}, classList: { toggle() {} } }, addEventListener() {}, head: { appendChild() {} } },
    firebase: { apps: [{}], initializeApp() {}, auth: () => ({ currentUser: null, onAuthStateChanged: () => () => {}, async signOut() {} }), firestore: () => ({}) },
    escHtml: x => String(x), encEnabled: () => false, showToast: m => toasts.push(m), sha256Hex: async s => 'h' + s.length,
    switchTab() { redraws.push(1); }, tombResetBaseline() {}, ensureDataDefaults: async () => false, UNDO_STACK: [], updateUndoButton() {},
    save: async () => { saves.push(1); }, TABS, CUR_PANEL: opts.panel || 'production',
  });
  vm.runInContext(`var DATA = ${JSON.stringify(opts.data || {
    production: [{ id: 'p1', qty: 5 }], sale: [{ id: 's1', amt: 100 }], recovery: [{ id: 'r1' }], expense: [{ id: 'e1' }],
    wageBonuses: [], family: [{ id: 'f1' }], businessInfo: { name: 'Ibrahim Weaving' }, openingBalance: 0, employees: [{ id: 'emp1', name: 'A' }],
  })}; var CURRENT_TAB = 'production'; var UNDO_SUPPRESS = false;`, ctx);
  vm.runInContext(read('js/cloud-sync.js'), ctx);
  vm.runInContext(read('js/view-only.js'), ctx);
  vm.runInContext(read('js/write-access.js'), ctx);
}
const run = c => vm.runInContext(c, ctx);
const fake = attrs => ({ attrs, classes: new Set(), getAttribute(n) { return n in attrs ? attrs[n] : null; }, hasAttribute(n) { return n in attrs; }, classList: { add() {} } });
const baseline = () => run('VIEW_BASELINE = JSON.stringify(DATA)');

describe('who is limited', () => {
  test('the owner is never limited, and neither is an account whose permissions have not arrived', () => {
    load({ email: OWNER }); assert.equal(run('permsLimited()'), false);
    load({ email: WORKER }); assert.equal(run('permsLimited()'), false);
    load({ perms: VIEWER }); assert.equal(run('permsLimited()'), true);
  });
  test('an unlimited phone can open every tab and do everything', () => {
    load({ email: OWNER });
    TABS.forEach(t => assert.equal(run(`permsTabAllowed('${t.id}')`), true, t.id));
    assert.equal(run(`permsCan('expenses', 'd')`), true);
  });
});

describe('tabs', () => {
  test('the Audit tab opens for the owner only - not for a worker, a viewer, or a phone nobody signed in on', () => {
    load({ email: OWNER }); assert.equal(run("permsTabAllowed('audit')"), true);
    load({ email: WORKER }); assert.equal(run("permsTabAllowed('audit')"), false);
    load({ perms: VIEWER }); assert.equal(run("permsTabAllowed('audit')"), false);
    load({}); assert.equal(run("permsTabAllowed('audit')"), false);
    load({ perms: VIEWER }); assert.ok(!run("TABS.filter(t => permsTabAllowed(t.id)).map(t => t.id)").includes('audit'));
  });
  test('Business viewer: Overview (Production, Sales and Cheques cards only), Production, Sale and Recovery (plus the device pages); no Expense, Wages, Family ...', () => {
    load({ perms: VIEWER });
    const shown = TABS.filter(t => run(`permsTabAllowed('${t.id}')`)).map(t => t.id);
    assert.deepEqual(shown, ['overview', 'production', 'sale', 'recovery', 'warpbeams', 'settings', 'backup']);
  });
  test('the first tab it can open replaces one it cannot (a role with no Overview cards: Overview -> Production)', () => {
    load({ perms: OPERATOR, grant: true });
    assert.equal(run('permsFirstTab()'), 'production');
    load({ perms: VIEWER });
    assert.equal(run('permsFirstTab()'), 'overview');
  });
  test('Production operator: Production and Warp beams (they live in the Production section), nothing about money', () => {
    load({ perms: OPERATOR, grant: true });
    const shown = TABS.filter(t => run(`permsTabAllowed('${t.id}')`)).map(t => t.id);
    assert.deepEqual(shown, ['production', 'warpbeams', 'settings', 'backup']);
  });
  test('Graphs appears only for a role that can view every section it adds up; Overview needs at least one card (see overview-cards.test.js)', () => {
    load({ perms: { production: 'v', reference: 'v', sales: 'v', recovery: 'v', expenses: 'v', wages: 'v', loans: 'v', family: 'v', materials: 'v' } });
    assert.equal(run(`permsTabAllowed('overview')`), true); assert.equal(run(`permsTabAllowed('graphs')`), true);
    load({ perms: { production: 'v', reference: 'v', sales: 'v', recovery: 'v', expenses: 'v', wages: 'v', loans: 'v', family: 'v' } });
    assert.equal(run(`permsTabAllowed('graphs')`), false, 'Materials is missing');
    assert.equal(run(`permsTabAllowed('overview')`), true, 'Overview still opens, with the cards this role may see');
  });
  test('shell.js leaves those tabs out of the drawer and redirects switchTab', () => {
    const sh = read('js/shell.js');
    assert.match(sh, /function navTabAllowed\(id\)\{ return typeof permsTabAllowed === 'function' \? permsTabAllowed\(id\) : true; \}/);
    assert.match(sh, /TABS\.filter\(t=>t\.group===g && navTabAllowed\(t\.id\)\)/);
    assert.match(sh, /function switchTab\(id\)\{\n  if\(typeof permsTabAllowed === 'function' && !permsTabAllowed\(id\)\) id = permsFirstTab\(\)/);
  });
});

describe('actions', () => {
  test('a Production operator with the edit switch on may add and change Production, and delete nothing', () => {
    load({ perms: OPERATOR, grant: true });
    assert.equal(run(`permsCan('production', 'a')`), true); assert.equal(run(`permsCan('production', 'e')`), true);
    assert.equal(run(`permsCan('production', 'd')`), false);
    assert.equal(run(`permsCan('sales', 'a')`), false); assert.equal(run(`permsCan('sales', 'v')`), false);
  });
  test('with the edit switch off (or time up) the same role can only look', () => {
    load({ perms: OPERATOR_OFF });
    assert.equal(run(`permsCan('production', 'v')`), true); assert.equal(run(`permsCan('production', 'a')`), false);
    load({ perms: OPERATOR }); // letters are stored, but there is no live grant on this phone
    assert.equal(run(`permsCan('production', 'e')`), false, 'no live grant: view-only wins over stored letters');
  });
  test('each control needs the right letter in the right section', () => {
    load({ perms: OPERATOR, grant: true });
    const need = a => run(`permsNeedOf(${JSON.stringify({})})`) || null; void need;
    const check = (attrs, sec, letter) => { ctx.__el = fake(attrs); const n = run('permsNeedOf(__el)'); assert.deepEqual(JSON.parse(JSON.stringify(n)), { sec, letter }, JSON.stringify(attrs)); };
    check({ 'data-edit': 'sale:s1' }, 'sales', 'e');
    check({ 'data-del': 'expense:e1' }, 'expenses', 'd');
    check({ 'data-del': 'production:p1' }, 'production', 'd');
    check({ 'data-quick-add': 'sale' }, 'sales', 'a');
    check({ 'data-quick-add': 'recovery' }, 'recovery', 'a');
    check({ id: 'saveBusinessInfo' }, 'business', 'e');
    check({ id: 'saveRateChange' }, 'wages', 'e');
    check({ id: 'restoreJsonBtn' }, null, null);
    ctx.__el = fake({ 'data-edit': 'production:p1' }); assert.equal(run('permsNeedMet(permsNeedOf(__el))'), true);
    ctx.__el = fake({ 'data-del': 'production:p1' }); assert.equal(run('permsNeedMet(permsNeedOf(__el))'), false);
    ctx.__el = fake({ 'data-edit': 'sale:s1' }); assert.equal(run('permsNeedMet(permsNeedOf(__el))'), false);
    ctx.__el = fake({ id: 'restoreJsonBtn' }); assert.equal(run('permsNeedMet(permsNeedOf(__el))'), false, 'restore / import / undo can touch every section: never for a limited account');
    ctx.__el = fake({ 'data-tab': 'x' }); assert.equal(run('permsNeedOf(__el)'), null, 'plain controls are free');
  });
  test('the message says what is not allowed and where', () => {
    load({ perms: OPERATOR, grant: true });
    assert.equal(run(`permsNeedMessage({ sec: 'production', letter: 'd' })`), 'Not allowed \u2014 your role can\u2019t delete entries in Production.');
  });
  test('permsApply hides Edit / Delete / shortcuts the role lacks, and only those', () => {
    load({ perms: OPERATOR, grant: true, panel: 'production' });
    const mk = attrs => { const e = fake(attrs); e.classList = { add: c => e.classes.add(c) }; return e; };
    const edit = mk({ 'data-edit': 'production:p1' }), del = mk({ 'data-del': 'production:p1' }), saleEdit = mk({ 'data-edit': 'sale:s1' }), quick = mk({ 'data-quick-add': 'sale' });
    ctx.__scope = { querySelectorAll: sel => sel.startsWith('[data-edit]') ? [edit, del, saleEdit, quick] : [] , children: [1] };
    run('permsApply(__scope)');
    assert.equal(edit.classes.has('perm-hide'), false, 'may edit Production');
    assert.equal(del.classes.has('perm-hide'), true, 'may not delete');
    assert.equal(saleEdit.classes.has('perm-hide'), true, 'Sales is not theirs');
    assert.equal(quick.classes.has('perm-hide'), true);
  });
  test('a click on a control the role may not use is stopped, with a message', () => {
    load({ perms: OPERATOR, grant: true });
    const target = fake({ 'data-del': 'production:p1' }); target.closest = sel => sel.includes('[data-del]') ? target : null;
    let stopped = 0; ctx.__ev = { target, preventDefault() { stopped++; }, stopPropagation() { stopped++; }, stopImmediatePropagation() { stopped++; } };
    assert.equal(run('permsGuardClick(__ev)'), true); assert.equal(stopped, 3); assert.match(toasts[0], /can.t delete entries in Production/);
    const ok = fake({ 'data-edit': 'production:p1' }); ok.closest = sel => sel.includes('[data-edit]') ? ok : null;
    ctx.__ev = { target: ok, preventDefault() { stopped++; }, stopPropagation() {}, stopImmediatePropagation() {} };
    assert.equal(run('permsGuardClick(__ev)'), false); assert.equal(stopped, 3);
  });
  test('the CSS class exists and view-only.js is wired to the click guard and the page draw', () => {
    assert.match(read('index.html'), /\.perm-hide\{ display:none !important; \}/);
    const vo = read('js/view-only.js');
    assert.match(vo, /if\(permsGuardClick\(e\)\) return;/); assert.match(vo, /permsApply\(scope\);/);
  });
});

describe('save() refuses what the role does not allow (last layer)', () => {
  beforeEach(() => { load({ perms: OPERATOR, grant: true }); baseline(); });
  test('adding and changing Production is fine, and the baseline moves on', () => {
    run(`DATA.production.push({ id: 'p2', qty: 1 }); DATA.production[0].qty = 9`);
    assert.equal(run('viewOnlySaveBlocked()'), false);
    assert.match(run('VIEW_BASELINE'), /"p2"/);
  });
  test('deleting a Production entry is refused, the ledger goes back, and the person is told', async () => {
    run(`DATA.production.length = 0`);
    assert.equal(run('viewOnlySaveBlocked()'), true);
    await new Promise(r => setImmediate(r));
    assert.equal(run('DATA.production.length'), 1); assert.equal(redraws.length, 1);
    assert.match(toasts[0], /can.t delete entries in Production/);
  });
  test('adding a Sale (a section that is not theirs) is refused', async () => {
    run(`DATA.sale.push({ id: 's2' })`);
    assert.equal(run('viewOnlySaveBlocked()'), true); await new Promise(r => setImmediate(r));
    assert.equal(run('DATA.sale.length'), 1); assert.match(toasts[0], /can.t add entries in Sales & clients/);
  });
  test('changing Business info or an existing Sale is refused too', () => {
    run(`DATA.businessInfo.name = 'Other'`); assert.deepEqual(JSON.parse(JSON.stringify(run('permsViolation()'))), { sec: 'business', letter: 'e' });
    load({ perms: OPERATOR, grant: true }); baseline();
    run(`DATA.sale[0].amt = 1`); assert.deepEqual(JSON.parse(JSON.stringify(run('permsViolation()'))), { sec: 'sales', letter: 'e' });
  });
  test('a default being filled in (an empty list appearing) is not a change', () => {
    run(`DATA.warpTypes = []; DATA.dyeingUnits = []; DATA.wageRateHistory = {}`);
    assert.equal(run('permsViolation()'), null);
  });
  test('a role that may delete, deletes', () => {
    load({ perms: { production: 'vaed' }, grant: true }); baseline();
    run(`DATA.production.length = 0`); assert.equal(run('viewOnlySaveBlocked()'), false);
  });
  test('the cloud copy arriving is always allowed to store', async () => {
    run(`DATA.sale.push({ id: 'from-cloud' })`);
    await run(`viewOnlyAllowSave(() => save())`);
    assert.equal(saves.length, 1);
    assert.equal(run('permsViolation()'), null, 'and it becomes the new starting point');
  });
  test('cloudApplySections stores through that gate, whatever the mode', () => {
    assert.match(read('js/cloud-sync.js'), /else await \(typeof viewOnlyAllowSave === 'function' \? viewOnlyAllowSave\(\(\)=> save\(\)\) : save\(\)\)/);
  });
  test('the owner and an unlimited phone are never checked', () => {
    load({ email: OWNER }); baseline(); run(`DATA.sale.length = 0`); assert.equal(run('viewOnlySaveBlocked()'), false);
  });
});

describe('sections the role may not view are not kept on the phone', () => {
  test('they are emptied and stored once; sections it may view stay', async () => {
    load({ perms: VIEWER });
    assert.equal(await run('permsPurgeHidden()'), true);
    assert.deepEqual(JSON.parse(run('JSON.stringify([DATA.expense, DATA.family, DATA.businessInfo.name, DATA.openingBalance])')), [[], [], 'Ibrahim Weaving', 0]);
    assert.equal(run('DATA.production.length'), 1); assert.equal(run('DATA.sale.length'), 1); assert.equal(run('DATA.recovery.length'), 1);
    assert.equal(saves.length, 1);
    assert.equal(await run('permsPurgeHidden()'), false, 'nothing left to remove: no second save');
  });
  test('the owner keeps everything', async () => {
    load({ email: OWNER }); assert.equal(await run('permsPurgeHidden()'), false); assert.equal(run('DATA.expense.length'), 1);
  });
  test('learning new permissions redraws the drawer and purges; hearing the same again does nothing', async () => {
    load({ perms: null });
    run(`cloudPermsSave(${JSON.stringify(VIEWER)})`); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
    assert.equal(run('DATA.expense.length'), 0); assert.equal(redraws.length, 1);
    run(`cloudPermsSave(${JSON.stringify(VIEWER)})`); await new Promise(r => setImmediate(r));
    assert.equal(redraws.length, 1, 'unchanged: no redraw');
    run('cloudPermsClear()'); await new Promise(r => setImmediate(r)); assert.equal(redraws.length, 2);
  });
});

describe('Release 3 step 6 files stay in step', () => {
  const pkg = JSON.parse(read('package.json')), html = read('index.html'), sw = read('service-worker.js');
  test('version, badge and cache agree', () => {
    assert.match(pkg.version, /^3\.\d+\.\d+$/);
    assert.equal(html.match(/id="appVersionTag">v([\d.]+)</)[1], pkg.version); assert.match(sw, /CACHE_VERSION = 'v\d+'/);
  });
});
