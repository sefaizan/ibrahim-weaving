'use strict';
/* Year Report > Opening position: receivables, grey cloth and employee loans are pre-filled from the app (v3.17.63). */
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

describe('fiscalAutoOpening', () => {
  test('receivables per client are the app balances at the end of the day before the opening date', () => {
    load({ sale: [sale('s1', '2026-05-01', 10, 5000, 'Q-44'), sale('s2', '2026-12-31', 5, 3000, 'Q-44', 'Zed'), sale('s3', '2027-01-01', 5, 9999, 'Q-44')],
      recovery: [{ id: 'r1', date: '2026-06-01', client: 'Acme', method: 'Cash', amount: 2000, cheques: [] }] });
    const a = run("fiscalAutoOpening('2027-01-01')");
    assert.equal(a.prev, '2026-12-31'); assert.equal(a.rc.Acme, 3000); assert.equal(a.rc.Zed, 3000);
  });
  test('employee loans are given less repaid up to the day before; settled employees are left blank', () => {
    load({ loanPayments: [{ id: 'l1', date: '2026-03-01', employee: 'Ali', amount: 10000 }, { id: 'l2', date: '2026-04-01', employee: 'Ali', amount: 4000, type: 'Loan Repaid' },
      { id: 'l3', date: '2026-05-01', employee: 'Riaz', amount: 500 }, { id: 'l4', date: '2026-06-01', employee: 'Riaz', amount: 500, type: 'Loan Repaid' }, { id: 'l5', date: '2027-01-01', employee: 'Ali', amount: 777 }] });
    const a = run("fiscalAutoOpening('2027-01-01')");
    assert.equal(a.el.Ali, 6000); assert.equal(a.el.Riaz, undefined);
  });
  test('grey cloth lists only qualities that have stock, with produced less sold as the meters', () => {
    load({ production: [prod('p1', '2026-02-01', 1000, 'Q-44'), prod('p2', '2026-02-02', 300, 'Q-46')], sale: [sale('s1', '2026-03-01', 300, 1, 'Q-46'), sale('s2', '2026-03-02', 200, 1, 'Q-44')] });
    const a = run("fiscalAutoOpening('2027-01-01')");
    assert.deepEqual(Object.keys(a.gm), ['Q-44']); assert.equal(a.gm['Q-44'], 800);
  });
  test('the rate comes from the latest valuation on or before that day', () => {
    load({ production: [prod('p1', '2026-02-01', 10, 'Q-44')], stockValuations: [{ id: 'a', date: '2026-06-30', yarn: 0, bills: 0, greyRates: { 'Q-44': 90 } }, { id: 'b', date: '2026-12-31', yarn: 0, bills: 0, greyRates: { 'Q-44': 100 } }, { id: 'c', date: '2027-03-31', yarn: 0, bills: 0, greyRates: { 'Q-44': 999 } }] });
    assert.equal(run("fiscalAutoOpening('2027-01-01')").rates['Q-44'], 100);
  });
});

describe('opening card', () => {
  const html = () => run("fiscalOpeningCardHtml(2027)");
  test('fresh card: figures are pre-filled and editable; qualities without stock are hidden', () => {
    load({ production: [prod('p1', '2026-02-01', 800, 'Q-44')], sale: [sale('s1', '2026-05-01', 10, 5000, 'Q-44')] });
    const h = html();
    assert.match(h, /id="fo_rc0"[^>]*value="5000"/); assert.match(h, /id="fo_gm0"[^>]*value="790"/);
    assert.match(h, /data-gq="Q-44" style="display:flex/); assert.match(h, /data-gq="Q-46" style="display:none/); assert.match(h, /data-gq="Q-50" style="display:none/);
    assert.doesNotMatch(h, /data-man/);
  });
  test('a saved opening shows its saved figures as they are (not re-filled from the app)', () => {
    load({ production: [prod('p1', '2026-02-01', 800, 'Q-44')], fiscalOpenings: { 2027: { date: '2027-01-01', cash: 0, yarn: 0, bills: 0, receivables: { Acme: 123 }, empLoans: {}, grey: [{ quality: 'Q-44', meters: 700, rate: 95 }] } } });
    const h = html();
    assert.match(h, /id="fo_rc0"[^>]*data-man="1" value="123"/); assert.match(h, /id="fo_gm0"[^>]*value="700"/); assert.match(h, /id="fo_gr0"[^>]*value="95"/);
  });
  test('"no stock" message shows when no quality has any', () => { load(); assert.match(html(), /id="fo_greyNone" class="note" style="display:block"/); });
});
