'use strict';
/* Year Report > Years at a glance (v3.17.71): history rows match the report, Indian short numbers, deltas, cached. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let ctx;
function load(patch) {
  const d = Object.assign({
    qualities: [{ id: 'q1', name: 'Q-44' }, { id: 'q2', name: 'Q-46' }, { id: 'q3', name: 'Q-50' }], clients: [{ id: 'c1', name: 'Acme' }, { id: 'c2', name: 'Zed' }],
    employees: [{ id: 'e1', name: 'Ali' }, { id: 'e2', name: 'Riaz' }], production: [], sale: [], recovery: [], expense: [], family: [], personal: [], warp: [], weft: [],
    wagePayments: [], wageBonuses: [], wageSettlements: [], loanPayments: [], personalLoans: [], ownerLoans: [], checkpoints: [], warpBeams: [], looms: [], banks: [],
    dyeingUnits: [], wageRateHistory: {}, businessInfo: {}, openingBalance: 0, stockValuations: [], fiscalOpenings: {},
  }, patch || {});
  ctx = vm.createContext({ console, Date, Math, JSON, Object, Array, Set, Map, Number, String, RegExp, Error, DATA: d, escHtml: x => String(x), fmtRs: n => 'Rs ' + Math.round(n || 0),
    fmtDate: x => x, field: (l, id) => `<input id="${id}">`, todayStr: () => '2026-10-03', v: () => '', uid: () => 'u', showToast() {}, switchTab() {}, save: async () => {}, wireDelete() {},
    document: { querySelectorAll: () => [], getElementById: () => null } });
  vm.runInContext(read('js/calc.js'), ctx); vm.runInContext(read('js/fiscal.js'), ctx);
}
const run = c => JSON.parse(JSON.stringify(vm.runInContext(c, ctx)));
const prod = (id, date, qty, q) => ({ id, date, quality: q, qty, loom: 'L1' });
const sale = (id, date, qty, amount, q, client) => ({ id, date, client: client || 'Acme', quality: q, qty, amount });

describe('years at a glance', () => {
  test('short Indian numbers', () => {
    load();
    assert.equal(run('fiscalCompact(1240000)'), '12.4L'); assert.equal(run('fiscalCompact(12000000)'), '1.2Cr');
    assert.equal(run('fiscalCompact(-250000)'), '-2.5L'); assert.equal(run('fiscalCompact(950)'), '950');
  });
  test('delta arrows: up, down, and nothing when there is no earlier figure', () => {
    load();
    assert.match(run('fiscalDelta(120, 100)'), /up.*\u25B2 20%/); assert.match(run('fiscalDelta(-50, 100)'), /dn.*\u25BC 150%/);
    assert.equal(run('fiscalDelta(100, 0)'), ''); assert.equal(run('fiscalDelta(100, null)'), '');
  });
  test('the history row equals the full report to the rupee, and is cached until data changes', () => {
    load({ sale: [sale('s1', '2026-03-05', 100, 55555, 'Q-44')], expense: [{ id: 'x', date: '2026-03-06', amount: 1234, category: 'Rent' }] });
    const row = j => JSON.parse(JSON.stringify(j));
    const h = run('fiscalHistory().map(x=> ({ id: x.p.id, sales: x.r.sales, pa: x.r.profitAfter, cc: x.r.closingCapital }))');
    const r = run("(function(){ const x = fiscalReport(null, '2026-12-31'); return { sales: x.sales, pa: x.profitAfter, cc: x.closingCapital }; })()");
    assert.equal(h[0].id, 'first'); assert.equal(h[0].sales, r.sales); assert.equal(h[0].pa, r.pa); assert.equal(h[0].cc, null);
    assert.equal(run('fiscalHistory() === fiscalHistory()'), true);
    vm.runInContext("DATA.sale.push({ id: 's2', date: '2026-04-01', client: 'Acme', quality: 'Q-44', qty: 10, amount: 1000 })", ctx);
    assert.equal(run('fiscalHistory()[0].r.sales'), r.sales + 1000);
  });
  test('the page shows the history card, a tappable row with its own PDF button, and keeps the dropdowns', () => {
    load({ sale: [sale('s1', '2026-03-05', 100, 55555, 'Q-44')] });
    const h = run('fiscalPanel()');
    assert.match(h, /data-fhtoggle="first"/); assert.match(h, /data-fhpdf="first"/); assert.match(h, /id="fhCsv"/);
    assert.match(h, /id="fy_period"/); assert.match(h, /Year-on-year starts from your second year/);
  });
  test('empty ledger shows the empty state, not a broken chart', () => {
    load();
    const h = run('fiscalHistoryHtml()'); assert.match(h, /No figures yet/); assert.doesNotMatch(h, /<svg/);
  });
});
