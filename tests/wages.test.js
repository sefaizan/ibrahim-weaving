'use strict';
/* Wages: the rate that applied on each production date, wage totals, settlements and loans. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, prod, closeTo } = require('./helpers/load-app');

const app = loadApp();
const emp = (name, extra) => ({ id: 'e-' + name, name, ...extra });

describe('rate history — which rate applies on a given date', () => {
  // Deliberately out of order, and one rate stored as text, like a hand-edited backup.
  const history = { Q: [
    { date: '2026-09-01', rate: 15 },
    { date: '2026-01-01', rate: 10 },
    { date: '2026-06-01', rate: '12' },
  ] };

  test('uses the latest rate whose effective date is on or before the day', () => {
    app.setData({ wageRateHistory: history });
    assert.equal(app.rateForQualityOn('Q', '2026-05-31'), 10);
    assert.equal(app.rateForQualityOn('Q', '2026-06-01'), 12); // the effective date itself already uses the new rate
    assert.equal(app.rateForQualityOn('Q', '2026-08-31'), 12);
    assert.equal(app.rateForQualityOn('Q', '2026-09-01'), 15);
    assert.equal(app.rateForQualityOn('Q', '2027-03-01'), 15);
  });

  test('a date before the first rate falls back to the earliest rate, not zero', () => {
    app.setData({ wageRateHistory: history });
    assert.equal(app.rateForQualityOn('Q', '2025-12-31'), 10);
  });

  test('a quality with no rate set pays 0', () => {
    app.setData({ wageRateHistory: history });
    assert.equal(app.rateForQualityOn('Other', '2026-09-01'), 0);
    assert.equal(app.currentRateForQuality('Other'), 0);
  });

  test("the current rate is the newest entry's rate", () => {
    app.setData({ wageRateHistory: history });
    assert.equal(app.currentRateForQuality('Q'), 15);
  });
});

describe('wages follow the rate in force on each production date', () => {
  test('a rate change only affects production on or after its effective date', () => {
    app.setData({
      qualities: [{ name: 'Q' }], employees: [emp('Riaz')],
      wageRateHistory: { Q: [{ date: '2026-01-01', rate: 10 }, { date: '2026-06-01', rate: 12 }] },
      production: [
        prod({ date: '2026-05-31', qty: 100, e1: 'Riaz', e1m: 100 }), // 100 m x 10 = 1000
        prod({ date: '2026-06-01', qty: 100, e1: 'Riaz', e1m: 100 }), // 100 m x 12 = 1200
      ],
    });
    closeTo(app.computeWageMeters('Riaz', 'Q', null, null).wages, 2200, 'whole period');
    closeTo(app.computeWageMeters('Riaz', 'Q', null, '2026-05-31').wages, 1000, 'up to 31 May');
    closeTo(app.computeWageMeters('Riaz', 'Q', '2026-06-01', null).wages, 1200, 'from 1 June');
  });

  test('adding a newer rate never rewrites wages already worked out for earlier dates', () => {
    const data = {
      qualities: [{ name: 'Q' }], employees: [emp('Riaz')],
      wageRateHistory: { Q: [{ date: '2026-01-01', rate: 10 }] },
      production: [
        prod({ date: '2026-05-31', qty: 100, e1: 'Riaz', e1m: 100 }),
        prod({ date: '2026-07-15', qty: 100, e1: 'Riaz', e1m: 100 }),
      ],
    };
    app.setData(data);
    closeTo(app.computeWageMeters('Riaz', 'Q', null, '2026-06-30').wages, 1000, 'before the change');
    data.wageRateHistory.Q.push({ date: '2026-07-01', rate: 15 });
    app.setData(data);
    closeTo(app.computeWageMeters('Riaz', 'Q', null, '2026-06-30').wages, 1000, 'still 1000 after the change');
    closeTo(app.computeWageMeters('Riaz', 'Q', '2026-07-01', null).wages, 1500, 'July at the new rate');
  });

  test('each quality is paid at its own rate, and other qualities are ignored', () => {
    app.setData({
      qualities: [{ name: 'Q1' }, { name: 'Q2' }], employees: [emp('Riaz')],
      wageRateHistory: { Q1: [{ date: '2026-01-01', rate: 10 }], Q2: [{ date: '2026-01-01', rate: 20 }] },
      production: [
        prod({ quality: 'Q1', qty: 50, e1: 'Riaz', e1m: 50 }),
        prod({ quality: 'Q2', qty: 30, e1: 'Riaz', e1m: 30 }),
      ],
    });
    closeTo(app.computeWageMeters('Riaz', 'Q1', null, null).wages, 500, 'Q1');
    closeTo(app.computeWageMeters('Riaz', 'Q2', null, null).wages, 600, 'Q2');
  });

  test('the From/To dates include both end days; undated entries are skipped', () => {
    app.setData({
      qualities: [{ name: 'Q' }], employees: [emp('Riaz')],
      wageRateHistory: { Q: [{ date: '2026-01-01', rate: 10 }] },
      production: [
        prod({ date: '2026-09-01', qty: 10, e1: 'Riaz', e1m: 10 }),
        prod({ date: '2026-09-02', qty: 20, e1: 'Riaz', e1m: 20 }),
        prod({ date: '2026-09-03', qty: 40, e1: 'Riaz', e1m: 40 }),
        prod({ date: '', qty: 999, e1: 'Riaz', e1m: 999 }),
      ],
    });
    closeTo(app.computeWageMeters('Riaz', 'Q', '2026-09-02', '2026-09-03').wages, 600, '2 and 3 Sept');
  });
});

describe('computeWages — the Wages table', () => {
  const base = () => ({
    qualities: [{ name: 'Q' }],
    wageRateHistory: { Q: [{ date: '2026-01-01', rate: 10 }] },
  });

  test('total = wages for meters + bonuses dated inside the period', () => {
    app.setData({
      ...base(), employees: [emp('Riaz')],
      production: [prod({ date: '2026-09-10', qty: 100, e1: 'Riaz', e1m: 100 })],
      wageBonuses: [
        { id: 'b1', employee: 'Riaz', date: '2026-09-15', amount: 250 },
        { id: 'b2', employee: 'Riaz', date: '2026-10-15', amount: 999 }, // outside the period
        { id: 'b3', employee: 'Someone', date: '2026-09-15', amount: 777 }, // another employee
      ],
    });
    const [row] = app.computeWages('2026-09-01', '2026-09-30');
    assert.equal(row.employee, 'Riaz');
    closeTo(row.totalWagesNoBonus, 1000, 'wages before bonus');
    closeTo(row.bonus, 250, 'bonus');
    closeTo(row.totalWages, 1250, 'total');
  });

  test('an inactive employee stays listed only while they still have something in the period', () => {
    app.setData({
      ...base(), employees: [emp('Riaz'), emp('Left', { active: false })],
      production: [prod({ date: '2026-09-10', qty: 100, e1: 'Left', e1m: 100 })],
    });
    assert.deepEqual(app.computeWages('2026-09-01', '2026-09-30').map(r => r.employee).sort(), ['Left', 'Riaz']);
    assert.deepEqual(app.computeWages('2026-10-01', '2026-10-31').map(r => r.employee), ['Riaz']);
  });
});

describe('wage balance since the last settlement', () => {
  const employees = [emp('Riaz')];
  const rates = { Q: [{ date: '2026-01-01', rate: 10 }] };
  const production = [
    prod({ date: '2026-08-30', qty: 100, e1: 'Riaz', e1m: 100 }),
    prod({ date: '2026-08-31', qty: 100, e1: 'Riaz', e1m: 100 }),
    prod({ date: '2026-09-01', qty: 100, e1: 'Riaz', e1m: 100 }),
    prod({ date: '2026-09-05', qty: 50, e1: 'Riaz', e1m: 50 }),
  ];
  const bonuses = [
    { id: 'b1', employee: 'Riaz', date: '2026-08-31', amount: 500 },
    { id: 'b2', employee: 'Riaz', date: '2026-09-02', amount: 200 },
  ];
  const payments = [
    { id: 'w1', employee: 'Riaz', date: '2026-08-31', amount: 400 },
    { id: 'w2', employee: 'Riaz', date: '2026-09-03', amount: 700 },
  ];

  test('with no settlement, everything ever earned and paid counts', () => {
    app.setData({ qualities: [{ name: 'Q' }], employees, wageRateHistory: rates, production,
      wageBonuses: bonuses, wagePayments: payments });
    const b = app.computeEmployeeWageBalance('Riaz');
    closeTo(b.owed, 3500 + 700, 'owed = 350 m x 10 + bonuses');
    closeTo(b.paid, 1100, 'paid');
    closeTo(b.balance, 3100, 'balance');
    assert.equal(b.lastSettled, null);
  });

  test('after a settlement only the days AFTER it count, plus the amount carried forward', () => {
    app.setData({ qualities: [{ name: 'Q' }], employees, wageRateHistory: rates, production,
      wageBonuses: bonuses, wagePayments: payments,
      wageSettlements: [{ id: 's1', employee: 'Riaz', date: '2026-08-31', carryForward: 300 }] });
    const b = app.computeEmployeeWageBalance('Riaz');
    // Counted: 1 Sep (100 m) + 5 Sep (50 m) = 1500, bonus 200 on 2 Sep, payment 700 on 3 Sep.
    // Not counted: everything dated 31 Aug or earlier, including the 500 bonus and 400 payment that day.
    closeTo(b.owed, 1700, 'owed');
    closeTo(b.paid, 700, 'paid');
    closeTo(b.carryForward, 300, 'carry forward');
    closeTo(b.balance, 300 + 1700 - 700, 'balance');
    assert.equal(b.lastSettled, '2026-08-31');
  });

  test('when there are several settlements the newest one is used', () => {
    app.setData({ qualities: [{ name: 'Q' }], employees, wageRateHistory: rates, production,
      wageSettlements: [
        { id: 's1', employee: 'Riaz', date: '2026-08-30', carryForward: 111 },
        { id: 's2', employee: 'Riaz', date: '2026-09-01', carryForward: 0 },
        { id: 's3', employee: 'Other', date: '2026-09-04', carryForward: 999 },
      ] });
    const b = app.computeEmployeeWageBalance('Riaz');
    assert.equal(b.lastSettled, '2026-09-01');
    closeTo(b.balance, 500, 'only the 5 Sep production (50 m x 10) is left');
  });

  test('an inactive employee with an unsettled balance is still listed', () => {
    app.setData({ qualities: [{ name: 'Q' }], wageRateHistory: rates,
      employees: [emp('Riaz'), emp('Left', { active: false }), emp('Paid', { active: false })],
      production: [prod({ date: '2026-09-01', qty: 10, e1: 'Left', e1m: 10 })] });
    assert.deepEqual(app.wageRelevantEmployees().map(e => e.name).sort(), ['Left', 'Riaz']);
  });
});

describe('nextDayStr', () => {
  test('rolls over month ends, year ends and leap days', () => {
    assert.equal(app.nextDayStr('2026-09-20'), '2026-09-21');
    assert.equal(app.nextDayStr('2026-09-30'), '2026-10-01');
    assert.equal(app.nextDayStr('2026-12-31'), '2027-01-01');
    assert.equal(app.nextDayStr('2026-02-28'), '2026-03-01');
    assert.equal(app.nextDayStr('2028-02-28'), '2028-02-29');
  });
});

describe('employee loans', () => {
  test('balance = loans given minus loans repaid (an entry with no type counts as given)', () => {
    app.setData({ loanPayments: [
      { id: 'l1', employee: 'Riaz', type: 'Loan Given', amount: 1000 },
      { id: 'l2', employee: 'Riaz', amount: '500' },
      { id: 'l3', employee: 'Riaz', type: 'Loan Repaid', amount: 300 },
      { id: 'l4', employee: 'Other', type: 'Loan Given', amount: 9999 },
    ] });
    assert.deepEqual(app.computeEmployeeLoanBalance('Riaz'), { given: 1500, repaid: 300, balance: 1200 });
  });

  test('an inactive employee stays on the Loans list until the loan is cleared', () => {
    app.setData({
      employees: [emp('Owes', { active: false }), emp('Clear', { active: false }), emp('Active')],
      loanPayments: [
        { id: 'l1', employee: 'Owes', type: 'Loan Given', amount: 100 },
        { id: 'l2', employee: 'Clear', type: 'Loan Given', amount: 100 },
        { id: 'l3', employee: 'Clear', type: 'Loan Repaid', amount: 100 },
      ],
    });
    assert.deepEqual(app.loanRelevantEmployees().map(e => e.name).sort(), ['Active', 'Owes']);
  });
});
