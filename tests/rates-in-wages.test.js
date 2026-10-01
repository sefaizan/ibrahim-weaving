'use strict';
/*
 * Release 3, step 7: wage rates and earnings stay inside the Wages section.
 * A Production operator sees quality names and quantities only: the rate history (per quality, by date) is
 * kept in the Wages section, so it is never downloaded to, or kept on, a phone whose role cannot view Wages;
 * the Production page and the Settings lists (qualities, employees, looms) show names and meters, no money;
 * and renaming a quality or an employee (which rewrites records in other sections, the rates included) is
 * allowed only for an account that may edit every section the rename reaches.
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
const OPERATOR = { production: 'vae', reference: 'v', business: 'v' };
const RATES = { 'Quality A': [{ date: '2000-01-01', rate: 12 }, { date: '2026-09-01', rate: 14 }] };

let ctx, store;
function load(opts) {
  opts = opts || {};
  store = new Map();
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
    escHtml: x => String(x), encEnabled: () => false, showToast() {}, sha256Hex: async s => 'h' + s.length,
    switchTab() {}, tombResetBaseline() {}, ensureDataDefaults: async () => false, UNDO_STACK: [], updateUndoButton() {},
    save: async () => {}, TABS: [], CUR_PANEL: 'production',
  });
  vm.runInContext(`var DATA = ${JSON.stringify(opts.data || {
    production: [{ id: 'p1', quality: 'Quality A', qty: 50, e1: 'Ali', e1m: 50, date: '2026-09-10' }],
    qualities: [{ id: 'q1', name: 'Quality A' }], employees: [{ id: 'emp1', name: 'Ali' }], looms: [{ id: 'l1', name: '1' }],
    wageRateHistory: RATES, wagePayments: [{ id: 'w1', employee: 'Ali', amount: 5000 }], wageBonuses: [], sale: [{ id: 's1', quality: 'Quality A', amt: 100 }],
  })}; var CURRENT_TAB = 'production'; var UNDO_SUPPRESS = false;`, ctx);
  vm.runInContext(read('js/calc.js'), ctx);
  vm.runInContext(read('js/shell.js').match(/const MASTER_REF_FIELDS = \{[\s\S]*?\n\};/)[0], ctx); // the rename table the real page has
  vm.runInContext(read('js/cloud-sync.js'), ctx);
  vm.runInContext(read('js/view-only.js'), ctx);
  vm.runInContext(read('js/write-access.js'), ctx);
}
const run = c => vm.runInContext(c, ctx);

describe('where the rates live', () => {
  beforeEach(() => load({ email: OWNER }));
  test('rate history, the wage period and every wage record belong to the Wages section, and nothing wage-like is kept anywhere else', () => {
    ['wageRateHistory', 'wageFrom', 'wageTo', 'wageBonuses', 'wagePayments', 'wageSettlements'].forEach(k => assert.equal(run(`cloudSectionOf('${k}')`), 'wages', k));
    const misplaced = run('CLOUD_SECTIONS').filter(s => s.id !== 'wages').flatMap(s => s.keys.filter(k => /wage|earn|salary/i.test(k)).map(k => s.id + '.' + k));
    assert.deepEqual(JSON.parse(JSON.stringify(misplaced)), []);
  });
  test('a new or unknown key goes to the owner-only Tools section, never to Production or the reference lists', () => {
    assert.equal(run(`cloudSectionOf('someFutureRates')`), 'tools');
  });
  test('splitting the ledger keeps the rates out of the Production and reference documents', () => {
    const parts = JSON.parse(JSON.stringify(run('cloudSplit(DATA)')));
    ['production', 'reference', 'business'].forEach(sec => assert.doesNotMatch(JSON.stringify(parts[sec]), /"rate"|wage|Rate/i, sec));
    assert.deepEqual(parts.wages.wageRateHistory, RATES);
    assert.equal(JSON.stringify(parts.reference), JSON.stringify({ qualities: [{ id: 'q1', name: 'Quality A' }], looms: [{ id: 'l1', name: '1' }], employees: [{ id: 'emp1', name: 'Ali' }] }).replace(/^\{"qualities"/, '{"qualities"'));
  });
});

describe('a Production operator phone', () => {
  beforeEach(() => load({ perms: OPERATOR, grant: true }));
  test('holds no rates and no wage records once the phone has been told its role', async () => {
    assert.equal(run('permsCan("wages", "v")'), false);
    await run('permsPurgeHidden()');
    assert.deepEqual(JSON.parse(run('JSON.stringify(DATA.wageRateHistory)')), {});
    assert.equal(run('DATA.wagePayments.length'), 0);
    assert.equal(run('DATA.sale.length'), 0);
  });
  test('keeps the quality names, employees, looms and quantities it is meant to see', async () => {
    await run('permsPurgeHidden()');
    assert.equal(run('DATA.qualities[0].name'), 'Quality A'); assert.equal(run('DATA.employees[0].name'), 'Ali');
    assert.equal(run('DATA.looms[0].name'), '1'); assert.equal(run('DATA.production[0].qty'), 50);
  });
  test('with the rates gone, any wage calculation gives 0: there is nothing to work an earning out from', async () => {
    await run('permsPurgeHidden()');
    assert.equal(run(`rateForQualityOn('Quality A', '2026-09-10')`), 0);
    assert.equal(run(`currentRateForQuality('Quality A')`), 0);
  });
  test('cannot open Wages or the Wages controls, and the rate form is locked', () => {
    assert.equal(run(`permsTabAllowed('wages')`), false); assert.equal(run(`permsTabAllowed('loans')`), false);
    assert.equal(run(`permsCan('wages', 'e')`), false);
    const need = run(`permsNeedOf({ getAttribute: n => n === 'id' ? 'saveRateChange' : null, hasAttribute: () => false })`);
    assert.deepEqual(JSON.parse(JSON.stringify(need)), { sec: 'wages', letter: 'e' });
    assert.equal(run(`permsNeedMet(${JSON.stringify(need)})`), false);
  });
});

describe('the pages an operator can open show no money', () => {
  const daily = read('js/panels-daily.js'), shell = read('js/shell.js');
  const body = (src, name) => { const i = src.indexOf('function ' + name + '('); const j = src.indexOf('\n}\n', i); return src.slice(i, j); };
  test('the Production page, its log table and its CSV: names and meters, no Rs amounts, no rate or earning', () => {
    const b = body(daily, 'productionPanel');
    assert.ok(b.length > 500, 'found productionPanel');
    assert.doesNotMatch(b, /fmtRs|rateForQualityOn|currentRateForQuality|wageRateHistory|computeWage|computeEmployee|earned|earning/);
    assert.match(b, /\['Date','Time','Loom','Quality','Qty','Beam','Emp 1','Emp 2','Emp 3','Diff',''\]/);
  });
  test('the Settings lists (qualities, employees, looms) are name-only', () => {
    const b = body(shell, 'settingsPanel');
    assert.ok(b.length > 500, 'found settingsPanel');
    assert.doesNotMatch(b, /rateForQualityOn|currentRateForQuality|wageRateHistory|computeWage|computeEmployee/);
    assert.match(b, /<thead><tr><th>Name<\/th><th><\/th><\/tr><\/thead>/);
  });
  test('only the Wages page (and its receipts) reads a rate: no other panel file calls the rate functions', () => {
    ['js/panels-daily.js', 'js/overview.js', 'js/shell.js', 'js/lock-init.js'].forEach(f =>
      assert.doesNotMatch(read(f), /rateForQualityOn|currentRateForQuality|sortedRateHistory|wageRateHistory\[(?!oldName)/, f));
  });
  test('the header "Week ... m" pill adds up meters only', () => {
    assert.match(body(read('js/calc.js'), 'weeklyProductionTotal'), /meters/);
    assert.doesNotMatch(body(read('js/calc.js'), 'weeklyProductionTotal'), /rate|wage(?!Week)/i);
  });
});

describe('renaming reaches other sections, so it needs edit on all of them', () => {
  test('the owner and an unlimited phone can rename anything', () => {
    load({ email: OWNER });
    ['qualities', 'employees', 'looms', 'clients'].forEach(k => assert.equal(run(`permsRenameBlocked('${k}')`), null, k));
  });
  test('a Production operator (reference is view-only) cannot rename a quality, employee or loom', () => {
    load({ perms: OPERATOR, grant: true });
    ['qualities', 'employees', 'looms'].forEach(k => assert.deepEqual(JSON.parse(JSON.stringify(run(`permsRenameBlocked('${k}')`))), { sec: 'reference', letter: 'e' }, k));
  });
  test('a quality rename also needs Sales and Wages (its rate history): a role without Wages is refused', () => {
    load({ perms: { production: 'vae', reference: 'vae', sales: 'vae' }, grant: true });
    assert.deepEqual(JSON.parse(JSON.stringify(run(`permsRenameBlocked('qualities')`))), { sec: 'wages', letter: 'e' });
  });
  test('an employee rename needs Wages and Employee loans too (their payments and loans carry the name)', () => {
    load({ perms: { production: 'vae', reference: 'vae', wages: 'vae' }, grant: true });
    assert.deepEqual(JSON.parse(JSON.stringify(run(`permsRenameBlocked('employees')`))), { sec: 'loans', letter: 'e' });
  });
  test('a role that may edit every section the rename reaches can do it', () => {
    load({ perms: { production: 'vae', reference: 'vae', sales: 'vae', wages: 'vae', loans: 'vae' }, grant: true });
    assert.equal(run(`permsRenameBlocked('qualities')`), null); assert.equal(run(`permsRenameBlocked('employees')`), null);
  });
  test('switched off or expired (edit letters do not count) it is refused again', () => {
    load({ perms: { production: 'v', reference: 'v', sales: 'v', wages: 'v', loans: 'v' } });
    assert.notEqual(run(`permsRenameBlocked('qualities')`), null);
  });
  test('the Settings handler asks before it changes anything', () => {
    const w = read('js/wiring.js');
    const i = w.indexOf('permsRenameBlocked(key)'), j = w.indexOf('editingRec.name = name;');
    assert.ok(i > 0 && j > i, 'the check comes before the name is changed');
  });
});

describe('release 3 step 7 files stay in step', () => {
  test('version, badge, cache and build label agree', () => {
    const ver = JSON.parse(read('package.json')).version; assert.match(ver, /^3\.17\.\d+$/);
    assert.equal(read('index.html').match(/id="appVersionTag">v([\d.]+)</)[1], ver); assert.match(read('index.html'), /name="app-build" content="[^"]*release3-/);
    assert.match(read('service-worker.js'), /CACHE_VERSION = 'v\d+'/);
  });
});
