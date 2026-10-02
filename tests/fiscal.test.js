'use strict';
/*
 * Year Report (js/fiscal.js): the first period (start - 31 Dec 2026) and yearly Jan-Dec after it, quarters, the opening
 * position management gives on 1 January, stock valuations, and the maths: profit before drawings, drawings as their own
 * line, profit after drawings, opening / closing capital, the position and the check. Runs the real calc.js (computeStats).
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let ctx;
const base = () => ({
  qualities: [{ id: 'q1', name: 'Q-44' }, { id: 'q2', name: 'Q-46' }], clients: [{ id: 'c1', name: 'Acme' }], employees: [{ id: 'e1', name: 'Ali' }],
  production: [], sale: [], recovery: [], expense: [], family: [], personal: [], warp: [], weft: [], wagePayments: [], wageBonuses: [], wageSettlements: [],
  loanPayments: [], personalLoans: [], ownerLoans: [], checkpoints: [], warpBeams: [], looms: [], banks: [], dyeingUnits: [], wageRateHistory: {},
  businessInfo: {}, openingBalance: 0, stockValuations: [], fiscalOpenings: {},
});
function load(patch) {
  const d = Object.assign(base(), patch || {});
  ctx = vm.createContext({ console, Date, Math, JSON, Object, Array, Set, Map, Number, String, RegExp, Error, DATA: d,
    escHtml: x => String(x), fmtRs: n => 'Rs ' + Math.round(n || 0), fmtDate: x => x, field: (l, id) => `<input id="${id}">`, todayStr: () => '2026-10-03',
    v: () => '', uid: () => 'u1', showToast() {}, switchTab() {}, save: async () => {}, wireDelete() {}, document: { querySelectorAll: () => [], getElementById: () => null } });
  vm.runInContext(read('js/calc.js'), ctx);
  vm.runInContext(read('js/fiscal.js'), ctx);
}
const run = c => vm.runInContext(c, ctx);
const j = v => JSON.parse(JSON.stringify(v));
const sale = (id, date, qty, amount, q) => ({ id, date, client: 'Acme', quality: q || 'Q-44', qty, amount });
const prod = (id, date, qty, q) => ({ id, date, quality: q || 'Q-44', qty, loom: 'L1' });
const exp = (id, date, amount) => ({ id, date, category: 'Other', amount });
const rec = (id, date, amount) => ({ id, date, client: 'Acme', method: 'Cash', amount, cheques: [] });

describe('periods', () => {
  beforeEach(() => load());
  test('the first period ends 31 Dec 2026 with a Q4 2025 stub and Q1-Q4 2026; then one entry per year from 2027', () => {
    const p = j(run('fiscalPeriods(2027)'));
    assert.equal(p[0].from, null); assert.equal(p[0].to, '2026-12-31');
    assert.deepEqual(p[0].quarters.map(q => q.label), ['Q4 2025', 'Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026']);
    assert.deepEqual(p.slice(1).map(x => x.id), ['2027']);
    assert.deepEqual(p[1].quarters.map(q => q.from + '..' + q.to), ['2027-01-01..2027-03-31', '2027-04-01..2027-06-30', '2027-07-01..2027-09-30', '2027-10-01..2027-12-31']);
  });
  test('later years appear as the calendar moves on; before 2027 only 2027 is offered', () => {
    assert.deepEqual(j(run('fiscalPeriods(2029)')).map(x => x.id), ['first', '2027', '2028', '2029']);
    assert.deepEqual(j(run('fiscalPeriods(2026)')).map(x => x.id), ['first', '2027']);
  });
});

describe('the maths of the first period', () => {
  beforeEach(() => load({
    production: [prod('p1', '2026-02-01', 1000)], sale: [sale('s1', '2026-03-01', 800, 100000)], recovery: [rec('r1', '2026-03-05', 60000)],
    expense: [exp('x1', '2026-03-10', 10000)], family: [{ id: 'f1', date: '2026-03-12', amount: 5000 }], warp: [{ id: 'w1', date: '2026-01-05', amount: 30000 }],
    weft: [{ id: 'we1', date: '2026-01-06', amount: 20000, bags: 1 }], wagePayments: [{ id: 'wp1', date: '2026-03-15', amount: 8000 }],
    stockValuations: [{ id: 'v1', date: '2026-06-30', yarn: 25000, bills: 0, greyRates: { 'Q-44': 90 } }],
  }));
  test('profit before drawings = sales - costs + closing stock - opening stock; drawings are their own line', () => {
    const r = j(run(`fiscalReport(null, '2026-06-30')`));
    assert.equal(r.sales, 100000); assert.equal(r.bizExp, 18000); assert.equal(r.wages, 8000); assert.equal(r.warp, 30000); assert.equal(r.weft, 20000);
    assert.equal(r.closeStock.yarn, 25000); assert.equal(r.closeStock.grey, 200 * 90, 'grey cloth meters = produced - sold, times the rate');
    assert.equal(r.openStock.yarn, 0);
    assert.equal(r.stockChange, 25000 + 18000);
    assert.equal(r.profitBefore, 100000 - 68000 + 43000);
    assert.equal(r.drawings, 5000); assert.equal(r.drawingsFamily, 5000); assert.equal(r.drawingsPersonal, 0);
    assert.equal(r.profitAfter, r.profitBefore - 5000);
  });
  test('the first period has no opening capital and no check', () => {
    const r = j(run(`fiscalReport(null, '2026-12-31')`));
    assert.equal(r.openingCapital, null); assert.equal(r.closingCapital, null); assert.equal(r.check, null);
  });
  test('no valuation yet: stock counts as 0 and the report says so; a missing grey rate is named', () => {
    load({ production: [prod('p1', '2026-02-01', 100)] });
    assert.equal(j(run(`fiscalReport(null, '2026-12-31')`)).closeStock.known, false);
    assert.match(run(`fiscalReportHtml(fiscalSelected())`), /No stock valuation on or before/);
    load({ production: [prod('p1', '2026-02-01', 100)], stockValuations: [{ id: 'v', date: '2026-06-01', yarn: 5, bills: 0, greyRates: {} }] });
    assert.deepEqual(j(run(`fiscalReport(null, '2026-12-31')`)).closeStock.missing, ['Q-44']);
  });
  test('personal loans are shown apart and never counted in the position', () => {
    load({ personalLoans: [{ id: 'pl1', date: '2026-03-01', person: 'X', type: 'Loan Given', amount: 4000 }], checkpoints: [{ id: 'c', date: '2026-01-01', time: '00:00', balance: 1000 }] });
    const p = j(run(`fiscalPositionAt('2026-12-31')`));
    assert.equal(p.personalLoans, 4000); assert.equal(p.total, p.cash + p.receivables + p.empLoans + p.yarn + p.grey - p.bills);
  });
});

describe('opening position and capital', () => {
  const OP = { date: '2027-01-01', cash: 100000, yarn: 50000, bills: 20000, receivables: { Acme: 30000 }, empLoans: { Ali: 5000 }, grey: [{ quality: 'Q-44', meters: 100, rate: 90 }] };
  test('the total of the opening position is the opening capital: cash + receivables + yarn + grey + employee loans - bills', () => {
    load({ fiscalOpenings: { 2027: OP } });
    const t = j(run(`fiscalOpeningTotals(DATA.fiscalOpenings['2027'])`));
    assert.equal(t.grey, 9000); assert.equal(t.total, 100000 + 30000 + 50000 + 9000 + 5000 - 20000);
    assert.equal(run(`fiscalOpeningCapital('2027-01-01')`), 174000);
  });
  test('no opening entered for a year: capital is not shown (dash), never a made-up zero', () => {
    load(); assert.equal(run(`fiscalOpeningCapital('2027-01-01')`), null);
    assert.match(run(`fiscalReportHtml({ from: '2027-01-01', to: '2027-12-31', label: '2027' })`), /Opening capital<\/span><span class="num">\u2014/);
  });
  test('opening stock of the year comes from the opening position; closing from the latest valuation', () => {
    load({ fiscalOpenings: { 2027: OP }, stockValuations: [{ id: 'v', date: '2027-03-31', yarn: 70000, bills: 0, greyRates: { 'Q-44': 100 } }] });
    const r = j(run(`fiscalReport('2027-01-01', '2027-03-31')`));
    assert.equal(r.openStock.yarn, 50000); assert.equal(r.openStock.grey, 9000); assert.equal(r.closeStock.yarn, 70000);
  });
  test('Q2 opens with the capital Q1 closed with (roll-forward), and the year closes with the sum of its quarters', () => {
    load({ fiscalOpenings: { 2027: OP }, production: [prod('p', '2027-01-10', 500)], sale: [sale('s', '2027-02-01', 500, 80000)], expense: [exp('x', '2027-02-05', 10000)], family: [{ id: 'f', date: '2027-02-06', amount: 3000 }],
      stockValuations: [{ id: 'v1', date: '2027-03-31', yarn: 50000, bills: 20000, greyRates: { 'Q-44': 90 } }, { id: 'v2', date: '2027-12-31', yarn: 60000, bills: 0, greyRates: { 'Q-44': 90 } }],
      sale2: 0 });
    const q1 = j(run(`fiscalReport('2027-01-01', '2027-03-31')`)), q2 = j(run(`fiscalReport('2027-04-01', '2027-06-30')`)), y = j(run(`fiscalReport('2027-01-01', '2027-12-31')`));
    assert.equal(q1.closingCapital, q1.openingCapital + q1.profitAfter);
    assert.equal(q2.openingCapital, q1.closingCapital);
    assert.equal(y.closingCapital, y.openingCapital + y.profitAfter);
    assert.equal(y.drawings, 3000);
  });
  test('the position and the check use the same lines; a gap shows up as a non-zero check', () => {
    load({ fiscalOpenings: { 2027: OP }, stockValuations: [{ id: 'v', date: '2027-03-31', yarn: 50000, bills: 20000, greyRates: { 'Q-44': 90 } }] });
    const r = j(run(`fiscalReport('2027-01-01', '2027-03-31')`));
    assert.equal(r.check, r.position.total - r.closingCapital);
  });
});

describe('the page', () => {
  test('it shows chips for the periods and quarters, the drawings box, the valuation form and the opening card', () => {
    load();
    const h = run('fiscalPanel()');
    assert.match(h, /First period/); assert.match(h, /Q1 2026/); assert.match(h, /Drawings \(owner/); assert.match(h, /Quarterly Stock Valuation/); assert.match(h, /Opening position 2027/);
    assert.match(h, /fiscalPdf/); assert.match(h, /Fixed assets are never included/);
  });
  test('wired in: a tab for owners / whole-business accounts, saved with the tools section, defaults for old backups', () => {
    const core = read('js/core.js'), cs = read('js/cloud-sync.js'), vo = read('js/view-only.js'), wi = read('js/wiring.js');
    assert.match(core, /id:'fiscal'.*Year Report/); assert.match(cs, /'stockValuations','fiscalOpenings'/); assert.match(vo, /fiscal: '\*'/);
    assert.match(wi, /fiscal: typeof fiscalPanel/); assert.match(wi, /fiscalWire\(\)/); assert.match(core, /DATA\.stockValuations = \[\]/); assert.match(core, /DATA\.fiscalOpenings = \{\}/);
  });
});

describe('year-end carry-over (v3.17.69)', () => {
  test('opening card shows the carry-over check and button; unsaved year says so', () => {
    load();
    const h = run('fiscalOpeningCardHtml(2027)');
    assert.match(h, /Year-end carry-over/); assert.match(h, /id="fiscalCarry"/); assert.match(h, /Not saved yet/);
  });
  test('a saved opening that equals the previous closing position matches; a different one shows the difference', () => {
    load({ sale: [sale('s1', '2026-05-01', 100, 50000)], recovery: [rec('r1', '2026-06-01', 20000)] });
    const pos = j(run("fiscalPositionAt('2026-12-31')"));
    const ok = { date: '2027-01-01', cash: pos.cash, yarn: 0, bills: 0, receivables: { Acme: pos.receivables }, empLoans: {}, grey: [] };
    const good = run(`fiscalCarryCheckHtml(2027, ${JSON.stringify(ok)})`);
    assert.match(good, /Matches/);
    const bad = run(`fiscalCarryCheckHtml(2027, ${JSON.stringify(Object.assign({}, ok, { cash: ok.cash + 500 }))})`);
    assert.match(bad, /Differs by Rs 500/);
  });
  test('2028 compares against the closing capital of 2027, from its own report', () => {
    load({ fiscalOpenings: { 2027: { date: '2027-01-01', cash: 1000, yarn: 0, bills: 0, receivables: {}, empLoans: {}, grey: [] } } });
    const h = run('fiscalCarryCheckHtml(2028, null)');
    assert.match(h, /2027 \u2014 closing capital/);
  });
});
