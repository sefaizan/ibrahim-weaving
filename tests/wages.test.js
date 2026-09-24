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

describe('net wages for a specific Wage Period (Employee Wage Balances page)', () => {
  // Paying exactly what a period earned should zero it out, and a later rate change on a date
  // inside that period should surface only the extra amount now due — not the full new total,
  // and not 0 — because the payment (already made, already dated) doesn't move.
  const setup = (rate) => app.setData({
    qualities: [{ name: 'Q' }], employees: [{ id: 'r', name: 'Riaz' }],
    wageRateHistory: { Q: [{ date: '2026-01-01', rate }] },
    production: [prod({ date: '2026-08-10', qty: 100, e1: 'Riaz', e1m: 100 })], // 100 m
  });

  test('nothing paid yet: Paid is 0 and Net equals the full amount earned', () => {
    setup(10);
    const n = app.computeEmployeeWageNetForPeriod('Riaz', '2026-08-01', '2026-08-31');
    closeTo(n.earned, 1000, 'earned'); closeTo(n.paid, 0, 'paid'); closeTo(n.net, 1000, 'net');
  });

  test('paid in full, dated inside the period: Net is exactly 0', () => {
    setup(10);
    app.setData({
      qualities: [{ name: 'Q' }], employees: [{ id: 'r', name: 'Riaz' }],
      wageRateHistory: { Q: [{ date: '2026-01-01', rate: 10 }] },
      production: [prod({ date: '2026-08-10', qty: 100, e1: 'Riaz', e1m: 100 })],
      wagePayments: [{ id: 'w1', employee: 'Riaz', date: '2026-08-31', amount: 1000 }],
    });
    const n = app.computeEmployeeWageNetForPeriod('Riaz', '2026-08-01', '2026-08-31');
    closeTo(n.paid, 1000, 'paid'); closeTo(n.net, 0, 'net — fully paid for this period');
  });

  test('a payment dated OUTSIDE the period does not count towards it', () => {
    app.setData({
      qualities: [{ name: 'Q' }], employees: [{ id: 'r', name: 'Riaz' }],
      wageRateHistory: { Q: [{ date: '2026-01-01', rate: 10 }] },
      production: [prod({ date: '2026-08-10', qty: 100, e1: 'Riaz', e1m: 100 })],
      wagePayments: [{ id: 'w1', employee: 'Riaz', date: '2026-09-05', amount: 1000 }], // next month
    });
    const n = app.computeEmployeeWageNetForPeriod('Riaz', '2026-08-01', '2026-08-31');
    closeTo(n.paid, 0, 'paid — the payment is outside this period'); closeTo(n.net, 1000, 'net');
  });

  test('raising a past rate after paying in full leaves exactly the extra amount as Net (not 0, not the full new total)', () => {
    app.setData({
      qualities: [{ name: 'Q' }], employees: [{ id: 'r', name: 'Riaz' }],
      wageRateHistory: { Q: [{ date: '2026-01-01', rate: 10 }] }, // 100 m @ 10 = 1000, paid in full below
      production: [prod({ date: '2026-08-10', qty: 100, e1: 'Riaz', e1m: 100 })],
      wagePayments: [{ id: 'w1', employee: 'Riaz', date: '2026-08-31', amount: 1000 }],
    });
    closeTo(app.computeEmployeeWageNetForPeriod('Riaz', '2026-08-01', '2026-08-31').net, 0, 'settled at the old rate');
    // Now raise the rate for August itself (effective from before the production date).
    app.setData({
      qualities: [{ name: 'Q' }], employees: [{ id: 'r', name: 'Riaz' }],
      wageRateHistory: { Q: [{ date: '2026-01-01', rate: 15 }] }, // 100 m @ 15 = 1500
      production: [prod({ date: '2026-08-10', qty: 100, e1: 'Riaz', e1m: 100 })],
      wagePayments: [{ id: 'w1', employee: 'Riaz', date: '2026-08-31', amount: 1000 }], // unchanged
    });
    const n = app.computeEmployeeWageNetForPeriod('Riaz', '2026-08-01', '2026-08-31');
    closeTo(n.earned, 1500, 'earned recomputes at the new rate');
    closeTo(n.paid, 1000, 'paid is unchanged — the old payment doesn\'t move');
    closeTo(n.net, 500, 'net is exactly the extra 500 now due, not 1500 and not 0');
  });

  test('overpaying for a period shows as a negative net (a credit), not a floored 0', () => {
    setup(10);
    app.setData({
      qualities: [{ name: 'Q' }], employees: [{ id: 'r', name: 'Riaz' }],
      wageRateHistory: { Q: [{ date: '2026-01-01', rate: 10 }] },
      production: [prod({ date: '2026-08-10', qty: 100, e1: 'Riaz', e1m: 100 })],
      wagePayments: [{ id: 'w1', employee: 'Riaz', date: '2026-08-31', amount: 1200 }],
    });
    closeTo(app.computeEmployeeWageNetForPeriod('Riaz', '2026-08-01', '2026-08-31').net, -200, 'net (negative = paid ahead)');
  });

  test('two payments in the same period add up', () => {
    app.setData({
      qualities: [{ name: 'Q' }], employees: [{ id: 'r', name: 'Riaz' }],
      wageRateHistory: { Q: [{ date: '2026-01-01', rate: 10 }] },
      production: [prod({ date: '2026-08-10', qty: 100, e1: 'Riaz', e1m: 100 })],
      wagePayments: [
        { id: 'w1', employee: 'Riaz', date: '2026-08-15', amount: 400 },
        { id: 'w2', employee: 'Riaz', date: '2026-08-31', amount: 300 },
      ],
    });
    const n = app.computeEmployeeWageNetForPeriod('Riaz', '2026-08-01', '2026-08-31');
    closeTo(n.paid, 700, 'paid'); closeTo(n.net, 300, 'net');
  });
});

describe('rate history — edit and delete an entry', () => {
  const hist = () => ({ Q: [
    { date: '2026-01-01', rate: 10 },
    { date: '2026-06-01', rate: 12 },
    { date: '2026-09-01', rate: 15 },
  ] });
  const q = () => app.getData().wageRateHistory.Q;

  test('editing changes that entry\'s rate and moves the rate that applies on each day', () => {
    app.setData({ wageRateHistory: hist() });
    app.saveRateHistoryEntry('Q', 13, '2026-06-01', '2026-06-01');
    assert.equal(q().length, 3);
    assert.equal(app.rateForQualityOn('Q', '2026-07-01'), 13);
    assert.equal(app.rateForQualityOn('Q', '2026-05-31'), 10);
  });

  test('editing the effective date moves the entry (no copy left on the old date)', () => {
    app.setData({ wageRateHistory: hist() });
    app.saveRateHistoryEntry('Q', 12, '2026-07-15', '2026-06-01');
    assert.deepEqual(q().map(e => e.date).sort(), ['2026-01-01', '2026-07-15', '2026-09-01']);
    assert.equal(app.rateForQualityOn('Q', '2026-07-01'), 10);
    assert.equal(app.rateForQualityOn('Q', '2026-07-15'), 12);
  });

  test('editing onto another entry\'s date overwrites that one instead of duplicating it', () => {
    app.setData({ wageRateHistory: hist() });
    app.saveRateHistoryEntry('Q', 14, '2026-09-01', '2026-06-01');
    assert.deepEqual(q().map(e => [e.date, e.rate]).sort(), [['2026-01-01', 10], ['2026-09-01', 14]]);
  });

  test('saving without an entry to replace adds a new one (and a repeated date overwrites)', () => {
    app.setData({ wageRateHistory: hist() });
    app.saveRateHistoryEntry('Q', 20, '2026-10-01');
    assert.equal(q().length, 4);
    app.saveRateHistoryEntry('Q', 21, '2026-10-01');
    assert.equal(q().length, 4);
    assert.equal(app.currentRateForQuality('Q'), 21);
  });

  test('deleting an entry hands its days back to the rate before it', () => {
    app.setData({ wageRateHistory: hist() });
    assert.equal(app.removeRateHistoryEntry('Q', '2026-09-01'), 'ok');
    assert.equal(app.currentRateForQuality('Q'), 12);
    assert.equal(app.rateForQualityOn('Q', '2026-10-01'), 12);
  });

  test('a quality\'s only rate cannot be deleted; a missing entry is reported', () => {
    app.setData({ wageRateHistory: { Q: [{ date: '2026-01-01', rate: 10 }] } });
    assert.equal(app.removeRateHistoryEntry('Q', '2026-01-01'), 'last');
    assert.equal(q().length, 1);
    assert.equal(app.removeRateHistoryEntry('Q', '2030-01-01'), 'missing');
    assert.equal(app.removeRateHistoryEntry('Nope', '2026-01-01'), 'missing');
  });

  test('wages follow an edited rate', () => {
    app.setData({
      employees: [emp('A')], qualities: [{ id: 'q1', name: 'Q' }],
      wageRateHistory: { Q: [{ date: '2026-01-01', rate: 2 }] },
      production: [prod({ date: '2026-03-01', quality: 'Q', qty: 100, e1: 'A', e1m: 100 })],
    });
    const before = app.computeWageMeters('A', 'Q', '2026-03-01', '2026-03-01');
    app.saveRateHistoryEntry('Q', 3, '2026-01-01', '2026-01-01');
    const after = app.computeWageMeters('A', 'Q', '2026-03-01', '2026-03-01');
    assert.equal(before.wages, 200);
    assert.equal(after.wages, 300);
  });
});

describe('rate history — which days an entry decides (shown in the edit / remove notes)', () => {
  const H = { Q: [
    { date: '2026-06-01', rate: 12 },
    { date: '2026-01-01', rate: 10 },
    { date: '2026-09-01', rate: 15 },
  ] };

  test('a middle entry covers from its own date up to the next entry; removal falls back to the rate before it', () => {
    app.setData({ wageRateHistory: H });
    assert.deepEqual(app.rateHistorySpan('Q', '2026-06-01'),
      { from: '2026-06-01', to: '2026-09-01', rate: 12, rateAfterRemoval: 10 });
  });

  test('the newest entry runs onward', () => {
    app.setData({ wageRateHistory: H });
    assert.deepEqual(app.rateHistorySpan('Q', '2026-09-01'),
      { from: '2026-09-01', to: null, rate: 15, rateAfterRemoval: 12 });
  });

  test('the earliest entry also pays every earlier day; removal hands them to the next rate', () => {
    app.setData({ wageRateHistory: H });
    assert.deepEqual(app.rateHistorySpan('Q', '2026-01-01'),
      { from: null, to: '2026-06-01', rate: 10, rateAfterRemoval: 12 });
  });

  test('an unknown entry gives null', () => {
    app.setData({ wageRateHistory: H });
    assert.equal(app.rateHistorySpan('Q', '2030-01-01'), null);
    assert.equal(app.rateHistorySpan('Nope', '2026-01-01'), null);
  });
});

describe('wage week (Friday to Thursday) and the Overview weekly summary', () => {
  test('the week containing any day runs Friday through the next Thursday', () => {
    // 2026-09-25 is a Friday.
    assert.deepEqual(app.currentWageWeek('2026-09-25'), { from: '2026-09-25', to: '2026-10-01' }); // Friday
    assert.deepEqual(app.currentWageWeek('2026-09-28'), { from: '2026-09-25', to: '2026-10-01' }); // Monday
    assert.deepEqual(app.currentWageWeek('2026-10-01'), { from: '2026-09-25', to: '2026-10-01' }); // Thursday
    assert.deepEqual(app.currentWageWeek('2026-10-02'), { from: '2026-10-02', to: '2026-10-08' }); // next Friday
    assert.deepEqual(app.currentWageWeek('2026-09-24'), { from: '2026-09-18', to: '2026-09-24' }); // Thursday before
  });

  test('week ranges cross month and year ends', () => {
    assert.deepEqual(app.currentWageWeek('2027-01-01'), { from: '2027-01-01', to: '2027-01-07' }); // Friday
    assert.deepEqual(app.currentWageWeek('2026-12-31'), { from: '2026-12-25', to: '2026-12-31' });
  });

  const setup = (extra) => app.setData({
    employees: [emp('A'), emp('B'), emp('C')],
    qualities: [{ id: 'q1', name: 'Q1' }, { id: 'q2', name: 'Q2' }],
    wageRateHistory: { Q1: [{ date: '2026-01-01', rate: 2 }], Q2: [{ date: '2026-01-01', rate: 3 }] },
    production: [
      prod({ date: '2026-09-24', quality: 'Q1', qty: 100, e1: 'A', e1m: 100 }),                 // Thursday before: not this week
      prod({ date: '2026-09-25', quality: 'Q1', qty: 100, e1: 'A', e1m: 100 }),                 // Friday
      prod({ date: '2026-09-28', quality: 'Q2', qty: 50, e1: 'A', e1m: 50 }),
      prod({ date: '2026-09-29', quality: 'Q1', qty: 80, e1: 'B', e1m: 80 }),
      prod({ date: '2026-10-01', quality: 'Q1', qty: 10, e1: 'B', e1m: 10 }),                   // Thursday: last day
      prod({ date: '2026-10-02', quality: 'Q1', qty: 500, e1: 'B', e1m: 500 }),                 // next Friday: not this week
    ],
    ...extra,
  });

  test('lists each employee\'s meters and wages per quality for the current week only', () => {
    setup();
    const w = app.weeklyWageSummary('2026-09-28');
    assert.equal(w.from, '2026-09-25'); assert.equal(w.to, '2026-10-01');
    assert.deepEqual(w.rows.map(r => r.employee), ['A', 'B']); // C has nothing this week
    const a = w.rows[0];
    assert.deepEqual(a.byQuality.map(q => [q.quality, q.meters, q.wages, q.rate]), [['Q1', 100, 200, 2], ['Q2', 50, 150, 3]]);
    assert.equal(a.totalMeters, 150); assert.equal(a.totalWages, 350);
    const b = w.rows[1];
    assert.deepEqual(b.byQuality.map(q => [q.quality, q.meters, q.wages]), [['Q1', 90, 180]]);
    assert.equal(w.totalMeters, 240); assert.equal(w.totalWages, 530);
  });

  test('bonuses are not part of the weekly wages', () => {
    setup({ wageBonuses: [{ id: 'b1', date: '2026-09-26', employee: 'A', amount: 1000 }] });
    assert.equal(app.weeklyWageSummary('2026-09-28').totalWages, 530);
  });

  test('a rate change inside the week is flagged, and each day still uses its own rate', () => {
    setup({ wageRateHistory: { Q1: [{ date: '2026-01-01', rate: 2 }, { date: '2026-09-29', rate: 4 }], Q2: [{ date: '2026-01-01', rate: 3 }] } });
    const w = app.weeklyWageSummary('2026-09-30');
    const aQ1 = w.rows[0].byQuality[0];                       // A: 100 m on Friday, before the change, paid at 2 (current rate is now 4)
    assert.equal(aQ1.wages, 200); assert.equal(aQ1.rate, 4); assert.equal(aQ1.rateChanged, true);
    const bQ1 = w.rows[1].byQuality[0];                       // B: 90 m, all on/after the change, at 4
    assert.equal(bQ1.wages, 360); assert.equal(bQ1.rateChanged, false);
  });

  test('an empty week lists nobody', () => {
    setup();
    const w = app.weeklyWageSummary('2026-12-03');
    assert.deepEqual(w.rows, []); assert.equal(w.totalWages, 0);
  });

  test('a fully settled, inactive employee with no production that week is left out', () => {
    setup({ employees: [emp('A'), emp('B'), emp('C', { active: false })] });
    assert.deepEqual(app.weeklyWageSummary('2026-09-28').rows.map(r => r.employee), ['A', 'B']);
  });
});

describe('weekly production total (header pill)', () => {
  test('adds up Qty Produced of every entry in the Friday-Thursday week, all qualities and looms', () => {
    app.setData({ production: [
      prod({ date: '2026-09-24', quality: 'Q1', qty: 999 }),            // Thursday before: not this week
      prod({ date: '2026-09-25', quality: 'Q1', qty: 100.5 }),          // Friday
      prod({ date: '2026-09-28', quality: 'Q2', qty: 50, loom: '2' }),
      prod({ date: '2026-10-01', quality: 'Q3', qty: 10 }),             // Thursday: last day
      prod({ date: '2026-10-02', quality: 'Q1', qty: 500 }),            // next Friday: not this week
    ] });
    const w = app.weeklyProductionTotal('2026-09-29');
    assert.deepEqual(w, { from: '2026-09-25', to: '2026-10-01', meters: 160.5 });
  });

  test('counts entries with no employee logged, and is 0 for an empty week', () => {
    app.setData({ production: [prod({ date: '2026-09-26', qty: 40 })] });
    assert.equal(app.weeklyProductionTotal('2026-09-30').meters, 40);
    assert.equal(app.weeklyProductionTotal('2026-12-03').meters, 0);
  });
});
