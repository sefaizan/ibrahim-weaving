'use strict';
/*
 * Shortfall ("Difference") shares.
 * For each production entry: Difference = quantity produced - the meters logged against
 * employees. It is split equally between the employees named on that entry and paid at that
 * day's rate. The important safety check: every meter produced is paid for exactly once.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, prod, closeTo } = require('./helpers/load-app');

const app = loadApp();
const names = ['Riaz', 'Gafar', 'Anwar'];
const setup = (production, rate = 10) => app.setData({
  qualities: [{ name: 'Q' }],
  employees: names.map(name => ({ id: name, name })),
  wageRateHistory: { Q: [{ date: '2026-01-01', rate }] },
  production,
});
const meters = (name) => app.computeWageMeters(name, 'Q', null, null);
const totalMetersPaid = () => names.reduce((s, n) => s + meters(n).total, 0);

describe('shortfall shares', () => {
  test('two employees split the shortfall equally and are paid for it at the day\'s rate', () => {
    setup([prod({ qty: 100, e1: 'Riaz', e1m: 60, e2: 'Gafar', e2m: 30 })]); // shortfall 10 -> 5 each
    const r = meters('Riaz'), g = meters('Gafar');
    closeTo(r.own, 60, 'Riaz own'); closeTo(r.diffShare, 5, 'Riaz share'); closeTo(r.total, 65, 'Riaz total');
    closeTo(r.wages, 650, 'Riaz wages'); closeTo(r.diffWages, 50, 'Riaz wages from the share');
    closeTo(g.total, 35, 'Gafar total'); closeTo(g.wages, 350, 'Gafar wages');
  });

  test('a lone employee gets the whole shortfall', () => {
    setup([prod({ qty: 100, e1: 'Riaz', e1m: 80 })]);
    closeTo(meters('Riaz').diffShare, 20, 'share');
    closeTo(meters('Riaz').total, 100, 'total');
  });

  test('three employees each get a third', () => {
    setup([prod({ qty: 100, e1: 'Riaz', e1m: 30, e2: 'Gafar', e2m: 30, e3: 'Anwar', e3m: 30 })]);
    names.forEach(n => closeTo(meters(n).diffShare, 10 / 3, n + ' share'));
    closeTo(totalMetersPaid(), 100, 'all 100 m paid exactly once');
  });

  test('when logged meters exceed the quantity the excess is shared as a deduction', () => {
    setup([prod({ qty: 90, e1: 'Riaz', e1m: 50, e2: 'Gafar', e2m: 50 })]); // shortfall -10
    closeTo(meters('Riaz').diffShare, -5, 'Riaz share');
    closeTo(meters('Riaz').wages, 450, 'Riaz wages');
    closeTo(totalMetersPaid(), 90, 'still exactly the 90 m produced');
  });

  test('no shortfall means no extra pay', () => {
    setup([prod({ qty: 100, e1: 'Riaz', e1m: 100 })]);
    closeTo(meters('Riaz').diffShare, 0, 'share');
    closeTo(meters('Riaz').wages, 1000, 'wages');
  });

  test('an entry with no employee named pays nobody', () => {
    setup([prod({ qty: 100 })]);
    names.forEach(n => closeTo(meters(n).wages, 0, n));
  });

  test('shares are added up across entries, each entry split among its own employees', () => {
    setup([
      prod({ qty: 100, e1: 'Riaz', e1m: 60, e2: 'Gafar', e2m: 30 }), // shortfall 10 -> 5 / 5
      prod({ qty: 50, e1: 'Riaz', e1m: 40 }),                        // shortfall 10 -> Riaz only
    ]);
    closeTo(meters('Riaz').diffShare, 15, 'Riaz');
    closeTo(meters('Gafar').diffShare, 5, 'Gafar');
    closeTo(totalMetersPaid(), 150, 'all 150 m paid exactly once');
  });

  test('the share is paid at the rate of the entry\'s own date', () => {
    app.setData({
      qualities: [{ name: 'Q' }], employees: [{ id: 'r', name: 'Riaz' }],
      wageRateHistory: { Q: [{ date: '2026-01-01', rate: 10 }, { date: '2026-06-01', rate: 20 }] },
      production: [
        prod({ date: '2026-05-31', qty: 100, e1: 'Riaz', e1m: 90 }), // share 10 at Rs 10
        prod({ date: '2026-06-01', qty: 100, e1: 'Riaz', e1m: 90 }), // share 10 at Rs 20
      ],
    });
    closeTo(meters('Riaz').diffWages, 100 + 200, 'wages from shares');
  });

  test('with no rate set the meters still count but earn nothing', () => {
    app.setData({
      qualities: [{ name: 'Q' }], employees: [{ id: 'r', name: 'Riaz' }],
      production: [prod({ qty: 100, e1: 'Riaz', e1m: 60 })],
    });
    closeTo(meters('Riaz').total, 100, 'meters');
    closeTo(meters('Riaz').wages, 0, 'wages');
  });
});
