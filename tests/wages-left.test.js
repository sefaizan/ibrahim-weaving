'use strict';
/* Wages: what is REALLY left for a week once extra paid earlier is taken off (v3.19.2).
   Before: the "Part" badge compared only this week's payment with this week's wages, so a person who had been
   paid ahead showed "Part" (and an active Pay button) although nothing was owed. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, prod, closeTo } = require('./helpers/load-app');

const app = loadApp();
const W1 = ['2026-09-07', '2026-09-13'], W2 = ['2026-09-14', '2026-09-20'];
// 1000 earned in each week (100 m x Rs 10). Rate 10 from January.
function setup(payments, settlements){
  app.setToday('2026-09-20');
  app.setData({
    qualities: [{ name: 'Q' }], employees: [{ id: 'r', name: 'Riaz' }],
    wageRateHistory: { Q: [{ date: '2026-01-01', rate: 10 }] },
    production: [
      prod({ date: '2026-09-10', qty: 100, e1: 'Riaz', e1m: 100 }),
      prod({ date: '2026-09-17', qty: 100, e1: 'Riaz', e1m: 100 }),
    ],
    wagePayments: payments || [], wageSettlements: settlements || [],
  });
}
const pay = (date, amount, i) => ({ id: 'p' + (i || date), employee: 'Riaz', date, amount });

describe('left to pay for a week', () => {
  test('your scenario: extra last week, extra again this week -> nothing left, still ahead', () => {
    setup([pay('2026-09-13', 1100), pay('2026-09-20', 950)]);   // last week +100; this week the app asked 900, paid 950
    const w2 = app.computeWageLeftForPeriod('Riaz', ...W2);
    closeTo(w2.net, 50, 'this week alone: 1000 earned - 950 paid');       // the OLD badge saw this and said "Part"
    closeTo(w2.left, 0, 'nothing is really left');
    closeTo(w2.credit, 50, 'ahead by 50 across both weeks');
  });
  test('extra last week, this week paid exactly what the app asked -> nothing left', () => {
    setup([pay('2026-09-13', 1100), pay('2026-09-20', 900)]);
    closeTo(app.computeWageLeftForPeriod('Riaz', ...W2).left, 0);
  });
  test('extra last week, this week paid less than asked -> only the real shortfall is left', () => {
    setup([pay('2026-09-13', 1100), pay('2026-09-20', 500)]);   // owes 900, paid 500
    const w2 = app.computeWageLeftForPeriod('Riaz', ...W2);
    closeTo(w2.net, 500, 'this week alone'); closeTo(w2.left, 400, 'but only 400 is really left');
  });
  test('no extra anywhere: left equals this week\'s net, as before', () => {
    setup([pay('2026-09-13', 1000), pay('2026-09-20', 700)]);
    closeTo(app.computeWageLeftForPeriod('Riaz', ...W2).left, 300);
  });
  test('nothing paid this week but last week\'s extra covers it all -> nothing left', () => {
    setup([pay('2026-09-13', 2000)]);
    const w2 = app.computeWageLeftForPeriod('Riaz', ...W2);
    closeTo(w2.paid, 0); closeTo(w2.left, 0);
  });
  test('an OLD week is judged by its own closing balance, not by later payments', () => {
    setup([pay('2026-09-13', 400), pay('2026-09-20', 5000)]);   // big payment AFTER week 1 must not hide week 1's shortfall
    closeTo(app.computeWageLeftForPeriod('Riaz', ...W1).left, 600);
  });
  test('after a settlement the earlier overpayment no longer applies', () => {
    setup([pay('2026-09-13', 1100), pay('2026-09-20', 900)], [{ id: 's1', employee: 'Riaz', date: '2026-09-13', carryForward: 0 }]);
    closeTo(app.computeWageLeftForPeriod('Riaz', ...W2).left, 100, 'settled at 0: week 2 stands alone (1000 - 900)');
  });
  test('computeEmployeeWageBalance without asOf is unchanged (the balance today)', () => {
    setup([pay('2026-09-13', 1100), pay('2026-09-20', 950)]);
    closeTo(app.computeEmployeeWageBalance('Riaz').balance, -50);
    closeTo(app.computeEmployeeWageBalance('Riaz', '2026-09-13').balance, -100 + 0, 'week 1 closed 100 ahead');
  });
});
