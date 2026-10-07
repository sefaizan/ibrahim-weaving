'use strict';
/* Cost & Margin per meter (v3.18.9): yarn-use rules, rent by month, the month profit estimate. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app');
const closeTo = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `expected ${b} (within ${tol}), got ${a}`);
const app = loadApp();

const seed = () => app.setData({
  qualities: [{id: 'q1', name: '62/44 (150.144 Micro)', warpType: '150.144 Micro', picks: 44, kangi: 62}],
  warp: [{id: 'w1', date: '2026-08-27', type: '150.144 Micro', rate: 273, lbs: 3175}, {id: 'w2', date: '2026-09-13', type: '150.144 Micro', rate: 298, lbs: 4603}],
  warpBeams: [{id: 'b1', purchaseId: 'w2', date: '2026-09-14', length: 1800}],
  weft: [{date: '2026-09-02', rate: 340, lbs: 1000}, {date: '2026-09-20', rate: 360, lbs: 1000}],
  wageRateHistory: {'62/44 (150.144 Micro)': [{date: '2000-01-01', rate: 3.85}, {date: '2026-09-04', rate: 4.1}]},
  production: [{date: '2026-09-10', quality: '62/44 (150.144 Micro)', qty: 1000}, {date: '2026-09-25', quality: '62/44 (150.144 Micro)', qty: 1000, beam: 'b1'}],
  sale: [{date: '2026-09-12', quality: '62/44 (150.144 Micro)', qty: 2000, rate: 100, amount: 200000}],
});

describe('yarn use rules', () => {
  test('62 reed, 64 in, count 36 uses about 0.165 lbs of warp per meter; 44 picks x 64 in uses about 0.1025 lbs of weft', () => {
    seed();
    closeTo(app.costWarpLbs(62, 64, 36), 0.1648, 0.0005); closeTo(app.costWeftLbs(44, 64), 0.1025, 0.0005);
  });
  test('rent follows the month: 58,500 now, 64,350 from November', () => {
    seed(); assert.equal(app.costRent('2026-10'), 58500); assert.equal(app.costRent('2026-11'), 64350);
  });
  test('the newest rate on or before a date is used, per yarn type', () => {
    seed(); assert.equal(app.costLastRate(app.getData().weft, '2026-09-10'), 340); assert.equal(app.costLastRate(app.getData().warp, null, '150.144 Micro'), 298);
  });
});

describe('cost per meter and the month estimate', () => {
  test('Rs 275 warp, Rs 342 weft, 62/44 gives roughly Rs 94 a meter', () => {
    seed();
    const b = app.costBreakdown({reed: 62, width: 64, picks: 44, count: 36, warpRate: 275, weftRate: 342, wage: 4.1, power: 4.3, rent: 58500 / 40000, other: 4});
    closeTo(b.total, 94.2, 0.5);
  });
  test('September: a beam-linked meter takes its own lot rate, the rest the lot being woven; the bill sets electricity', () => {
    seed();
    const r = app.costMonth('2026-09', 100000);
    assert.equal(r.M, 2000); assert.equal(r.linked, 1000); assert.equal(r.est, false);
    closeTo(r.lines.power, 50, 1e-9);
    const warp = (0.00145 * 62 * 66 / 36) * (273 + 298) / 2;  // 1000 m at 273 (no beam, last lot before 10 Sep) + 1000 m at 298 (beam)
    closeTo(r.lines.warp, warp, 0.05);
    closeTo(r.sale, 100, 1e-9);
  });
  test('no bill entered: electricity falls back to the saved Rs per meter and the result is marked as an estimate', () => {
    seed(); const r = app.costMonth('2026-09'); assert.equal(r.est, true); closeTo(r.lines.power, 4.3, 1e-9);
  });
});

describe('month profit from the ledger (v3.18.30)', () => {
  const withExp = () => { seed(); const d = app.getData(); d.employees = d.employees || []; d.expense = [
    {id: 'e1', date: '2026-09-05', category: 'Rent', amount: 58500}, {id: 'e2', date: '2026-09-11', category: 'Electricity', amount: 99999},
    {id: 'e3', date: '2026-09-12', category: 'Other', amount: 41500}, {id: 'e4', date: '2026-10-02', category: 'Other', amount: 7777}]; return d; };
  test('electricity is the whole bill you type; every other expense of the month is added, Electricity entries and other months are not', () => {
    withExp(); const r = app.costMonth('2026-09', 100000);
    closeTo(r.totals.power, 100000, 1e-9); closeTo(r.totals.exp, 100000, 1e-9); closeTo(r.lines.power, 50, 1e-9); closeTo(r.lines.other, 50, 1e-9);
  });
  test('a live quote uses the real use rules and the overheads of the latest month with a saved bill', () => {
    const d = withExp(); d.costSettings = {bills: {'2026-09': 100000}};
    const q = app.costQuote({thread: 62, width: 64, warpCount: 36, picks: 44, warpRate: 275, weftRate: 342}, 100);
    closeTo(q.lines.warp, 45.3, 0.1); closeTo(q.lines.weft, 35.1, 0.1); assert.equal(q.ref.month, '2026-09'); closeTo(q.lines.power + q.lines.other, 100, 1e-9);
    closeTo(q.margin, 100 - q.cost, 1e-9);
  });
});
