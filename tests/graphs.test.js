'use strict';
/* Graphs page (v3.18.0): the figures behind the tiles/charts agree with Overview, and the page draws without NaN/undefined. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadApp, prod, sale, payment, closeTo } = require('./helpers/load-app.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function ledger(){
  return {
    qualities: [{ name: 'Q1' }, { name: 'Q2' }], clients: [{ name: 'A' }, { name: 'B' }],
    production: [prod({ date: '2026-07-10', quality: 'Q1', qty: 100 }), prod({ date: '2026-08-05', quality: 'Q1', qty: 200 }), prod({ date: '2026-08-20', quality: 'Q2', qty: 50 }), prod({ date: '2026-09-02', quality: 'Q2', qty: 400 })],
    sale: [sale({ date: '2026-08-06', client: 'A', quality: 'Q1', qty: 150, amount: 30000 }), sale({ date: '2026-09-03', client: 'B', quality: 'Q2', qty: 100, amount: 25000 }), sale({ date: '2026-09-04', client: 'A', quality: 'Q2', qty: 50, amount: 10000 })],
    recovery: [payment({ date: '2026-08-10', client: 'A', cashAmount: 12000 })],
    expense: [{ id: 'e1', date: '2026-08-15', amount: 5000 }], family: [{ id: 'f1', date: '2026-09-05', amount: 3000 }],
  };
}

describe('graphs figures', () => {
  test('month keys: previous window, quarter and year-to-date', () => {
    const app = loadApp(); app.setData({}); app.setToday('2026-09-20');
    assert.deepEqual(app.graphsPrevMonthKeys(['2026-08', '2026-09']), ['2026-06', '2026-07']);
    assert.deepEqual(app.graphsPrevMonthKeys(['2026-01']), ['2025-12']);
    assert.deepEqual(app.graphsRangeKeys('q'), ['2026-07', '2026-08', '2026-09']);
    assert.equal(app.graphsRangeKeys('ytd').length, 9);
  });
  test('per-month series match Overview (computeStats) and totals add up', () => {
    const app = loadApp(); app.setData(ledger()); app.setToday('2026-09-20');
    const keys = ['2026-07', '2026-08', '2026-09'];
    const D = app.computeGraphsData(keys, true);
    keys.forEach((k, i) => {
      const s = app.computeStats(k);
      closeTo(D.cur.produced[i], s.producedMonth); closeTo(D.cur.sales[i], s.salesAmtMonth);
      closeTo(D.cur.profit[i], s.profitMonth); closeTo(D.cur.received[i], s.receivedMonth); closeTo(D.cur.receivable[i], s.receivable);
    });
    closeTo(D.totals.produced, 750); closeTo(D.totals.sales, 65000); closeTo(D.totals.received, 12000);
    closeTo(D.totals.expenses, 8000); closeTo(D.totals.profit, 57000);
    assert.equal(D.prevTotals.sales, 0);
    // Aug: 30000 sold for 150 m -> Rs 200 / m; collection 12000 of 30000 = 40%
    closeTo(D.cur.avgRate[1], 200); closeTo(D.cur.collection[1], 40); assert.equal(D.cur.avgRate[0], null);
    // receivable at the start of the range (nothing before July) is 0, and ends at 65000 - 12000
    closeTo(D.startReceivable, 0); closeTo(D.cur.receivable[2], 53000);
  });
  test('production by quality, top clients and expense split', () => {
    const app = loadApp(); app.setData(ledger()); app.setToday('2026-09-20');
    const D = app.computeGraphsData(['2026-07', '2026-08', '2026-09'], false);
    assert.equal(D.prev, null);
    const q2 = D.qualities.find(q => q.name === 'Q2'), q1 = D.qualities.find(q => q.name === 'Q1');
    assert.deepEqual(q1.values, [100, 200, 0]); assert.deepEqual(q2.values, [0, 50, 400]);
    assert.equal(D.qualities[0].name, 'Q2', 'largest quality first');
    assert.deepEqual(D.clients.top.map(c => [c.name, c.amount, c.qty]), [['A', 40000, 200], ['B', 25000, 100]]);
    closeTo(D.clients.total, 65000);
    const split = Object.fromEntries(D.expenseSplit.map(x => [x.key, x.value]));
    assert.deepEqual(split, { Business: 5000, Family: 3000 });
  });
  test('weekly production buckets Monday-Sunday; latest entry date', () => {
    const app = loadApp(); app.setData(ledger()); app.setToday('2026-09-20');
    const w = app.graphsWeeklyProduction('2026-09-20', 4); // weeks starting 31 Aug, 24 Aug, 17 Aug, 10 Aug... (last = week of 14 Sep)
    assert.equal(w.length, 4); assert.equal(w[3].from, '2026-09-14'); assert.equal(w[2].from, '2026-09-07');
    const all = app.graphsWeeklyProduction('2026-09-20', 8);
    closeTo(all.find(x => x.from === '2026-08-31').meters, 400); closeTo(all.find(x => x.from === '2026-08-17').meters, 50);
    assert.equal(app.graphsLatestEntryDate(), '2026-09-04');
  });
});

describe('graphs page draws', () => {
  function page(rangeVal, extra){
    const ctx = vm.createContext({ console, Date, Math, JSON, Object, Array, Set, Map, Number, String, RegExp, Error, isFinite });
    const d = loadApp(); d.setData(Object.assign(ledger(), extra || {})); d.setToday('2026-09-20');
    vm.runInContext(read('js/calc.js'), ctx);
    vm.runInContext(`var DATA = ${JSON.stringify(Object.assign({ qualities: [], clients: [], employees: [], looms: [], warpBeams: [], wageBonuses: [], wagePayments: [], wageSettlements: [], loanPayments: [], production: [], warp: [], weft: [], sale: [], recovery: [], expense: [], family: [], personal: [], personalLoans: [], ownerLoans: [], checkpoints: [], openingBalance: 0, wageRateHistory: {}, loomAssignments: [], familyMembers: [], warpTypes: [], banks: [] }, ledger(), extra || {}))};
      var todayStr = () => '2026-09-20'; var nowStr = () => '12:00'; var fmtQtyMtr = n => String(n); var recoveryDescription = r => 'Payment';
      var fmtRs = n => 'Rs ' + (Math.round(n||0)).toLocaleString('en-IN'); var FILTER = { graphsRange: '${rangeVal}' };`, ctx);
    vm.runInContext(read('js/overview.js').replace(/^const MONTH_NAMES/m, 'var MONTH_NAMES'), ctx);
    return vm.runInContext('graphsPanel()', ctx);
  }
  for(const r of ['q', 'ytd', '6', '12', 'all']){
    test(`range ${r}: renders every card, no NaN/undefined`, () => {
      const html = page(r);
      ['gx-tiles', 'Highlights', 'Production vs Sales', 'Production by Quality', 'Weekly Production', 'Profit / Loss', 'Receivable Trend', 'Collection Rate', 'Average Selling Rate', 'Top Clients', 'Where the Money Went'].forEach(t => assert.ok(html.includes(t), `${r}: missing ${t}`));
      assert.ok(!/NaN|undefined|Infinity/.test(html), `${r}: bad value in page`);
      assert.ok(html.includes('data-tip='), 'bars are tappable');
      assert.equal(html.includes('graphs_compare'), r !== 'all', 'compare toggle hidden for All');
    });
  }
  test('empty ledger still draws safely', () => {
    const html = page('12', { production: [], sale: [], recovery: [], expense: [], family: [] });
    assert.ok(html.includes('gx-tiles') && !/NaN|undefined|Infinity/.test(html));
  });
});
