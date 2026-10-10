'use strict';
/* Stock Position > Stock by Quality: Produced and Sold follow the selected period; In Stock stays cumulative to the period end. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const D = { qualities: [{ id: 'q1', name: 'Q-44' }], clients: [{ id: 'c1', name: 'Acme' }], employees: [], production: [
    { id: 'p1', date: '2026-08-10', quality: 'Q-44', qty: 1000, loom: '1' }, { id: 'p2', date: '2026-09-10', quality: 'Q-44', qty: 400, loom: '1' }],
  sale: [{ id: 's1', date: '2026-08-20', client: 'Acme', quality: 'Q-44', qty: 300, amount: 3000 }, { id: 's2', date: '2026-09-15', client: 'Acme', quality: 'Q-44', qty: 100, amount: 1000 }],
  recovery: [], expense: [], family: [], personal: [], warp: [], weft: [], wagePayments: [], wageBonuses: [], wageSettlements: [], loanPayments: [], personalLoans: [], ownerLoans: [],
  checkpoints: [], warpBeams: [], looms: [], banks: [], dyeingUnits: [], wageRateHistory: {}, businessInfo: {}, openingBalance: 0, stockValuations: [], fiscalOpenings: {} };
const ctx = vm.createContext({ console, Date, Math, JSON, Object, Array, Set, Map, Number, String, RegExp, Error, DATA: D, escHtml: x => String(x), fmtRs: n => String(n), fmtDate: x => x,
  todayStr: () => '2026-10-10', uid: () => 'u', showToast() {}, save: async () => {}, document: { querySelectorAll: () => [], getElementById: () => null } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/calc.js'), 'utf8'), ctx);
const row = m => vm.runInContext(`computeStats(${JSON.stringify(m)}).stockByQuality[0]`, ctx);
test('a period shows only that period\'s Produced/Sold per quality; stock stays cumulative', () => {
  const all = row(''); assert.equal(all.producedP, 1400); assert.equal(all.soldP, 400); assert.equal(all.stock, 1000);
  const sep = row('range:2026-09-01:2026-09-30'); assert.equal(sep.producedP, 400); assert.equal(sep.soldP, 100); assert.equal(sep.stock, 1000);
  const aug = row('range:2026-08-01:2026-08-31'); assert.equal(aug.producedP, 1000); assert.equal(aug.soldP, 300); assert.equal(aug.stock, 700);
  const upto = row('range::2026-08-31'); assert.equal(upto.producedP, 1000);
});
