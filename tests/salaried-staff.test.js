'use strict';
/* Salaried staff: weekly salary accrues per day, joins the wage balance, raises and last working day work. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, closeTo } = require('./helpers/load-app');

const app = loadApp();
const emp = (name, extra) => ({ id: 'e-' + name, name, salaried: true, ...extra });

describe('weekly salary', () => {
  test('a full week earns exactly the weekly amount; part weeks are pro-rata by day', () => {
    app.setData({ employees: [emp('M')], staffSalary: { M: { rates: [{ date: '2026-09-04', weekly: 7000 }] } } });
    closeTo(app.salaryAccrued('M', '2026-09-04', '2026-09-10'), 7000, 'one week');
    closeTo(app.salaryAccrued('M', '2026-09-04', '2026-09-17'), 14000, 'two weeks');
    closeTo(app.salaryAccrued('M', '2026-09-04', '2026-09-06'), 3000, 'three days');
    closeTo(app.salaryAccrued('M', '2026-08-01', '2026-09-04'), 1000, 'nothing before the start date');
  });
  test('a raise applies from its date only; the last working day stops it', () => {
    app.setData({ employees: [emp('M')], staffSalary: { M: { rates: [{ date: '2026-09-01', weekly: 7000 }, { date: '2026-09-08', weekly: 14000 }], to: '2026-09-14' } } });
    closeTo(app.salaryAccrued('M', '2026-09-01', '2026-09-30'), 7000 + 14000, 'old week + raised week, then stopped');
  });
  test('no salary record means no salary', () => {
    app.setData({ employees: [emp('X')] });
    assert.equal(app.salaryAccrued('X', null, null), 0);
  });
});

describe('wage balance and rows', () => {
  test('salary counts in earned/balance, payments reduce it, settlements restart it', () => {
    app.setToday('2026-09-10');
    app.setData({ employees: [emp('M')], staffSalary: { M: { rates: [{ date: '2026-09-04', weekly: 7000 }] } },
      wagePayments: [{ id: 'p1', employee: 'M', date: '2026-09-10', amount: 5000 }] });
    const b = app.computeEmployeeWageBalance('M');
    closeTo(b.salary, 7000); closeTo(b.balance, 2000);
    closeTo(app.computeEmployeeWagesForPeriod('M', '2026-09-04', '2026-09-10'), 7000);
    const row = app.computeWages('2026-09-04', '2026-09-10')[0];
    closeTo(row.salary, 7000); closeTo(row.totalWages, 7000);
    app.setData({ employees: [emp('M')], staffSalary: { M: { rates: [{ date: '2026-09-04', weekly: 7000 }] } },
      wageSettlements: [{ id: 's1', employee: 'M', date: '2026-09-07', carryForward: 0 }] });
    closeTo(app.computeEmployeeWageBalance('M').balance, 3000, 'only 8-10 Sep after the settlement');
  });
  test('a left employee with salary in the period still shows', () => {
    app.setData({ employees: [emp('M', { active: false })], staffSalary: { M: { rates: [{ date: '2026-09-01', weekly: 7000 }], to: '2026-09-07' } } });
    assert.equal(app.computeWages('2026-09-01', '2026-09-30').length, 1);
  });
});

describe('saving a salary', () => {
  test('one rate per effective date; a new date adds a raise; last working day can be set and cleared', () => {
    app.setData({ employees: [emp('M')] });
    app.saveStaffSalary('M', 7000, '2026-09-01', '');
    app.saveStaffSalary('M', 8000, '2026-09-01', '');          // same date corrects the amount
    app.saveStaffSalary('M', 9000, '2026-10-01', '2026-12-31'); // later date is a raise
    let s = app.getData().staffSalary.M;
    assert.equal(JSON.stringify(s.rates), JSON.stringify([{ date: '2026-09-01', weekly: 8000 }, { date: '2026-10-01', weekly: 9000 }]));
    assert.equal(s.to, '2026-12-31');
    app.saveStaffSalary('M', 9000, '2026-10-01', '');
    assert.equal(app.getData().staffSalary.M.to, undefined);
  });
});

describe('bonus paid at the same time', () => {
  let n = 0; const id = () => 'id' + (++n);
  test('bonus alone stays owed; with "paid now" it also logs a matching payment and leaves no balance', () => {
    app.setToday('2026-09-10');
    app.setData({ employees: [emp('M')], staffSalary: { M: { rates: [{ date: '2026-09-04', weekly: 7000 }] } } });
    app.addWageBonusEntry({ date: '2026-09-10', employee: 'M', amount: 1000, remarks: '' }, false, id);
    assert.equal(app.getData().wagePayments.length, 0);
    closeTo(app.computeEmployeeWageBalance('M').balance, 8000);
    app.addWageBonusEntry({ date: '2026-09-10', employee: 'M', amount: 2500, remarks: 'Electricity bill' }, true, id);
    const pay = app.getData().wagePayments[0];
    assert.equal(pay.amount, 2500); assert.equal(pay.employee, 'M'); assert.equal(pay.date, '2026-09-10');
    assert.equal(pay.remarks, 'Paid with bonus: Electricity bill');
    closeTo(app.computeEmployeeWageBalance('M').balance, 8000, 'the paid bonus adds nothing owed');
  });
});

describe('switching pay basis', () => {
  test('going back to per meter stops salary after the last day; a later salary starts fresh with no gap paid', () => {
    app.setData({ employees: [emp('M')] });
    app.saveStaffSalary('M', 7000, '2026-09-01', '');
    app.endStaffSalary('M', '2026-09-14');
    closeTo(app.salaryAccrued('M', '2026-09-01', '2026-09-30'), 14000, 'two weeks only');
    app.saveStaffSalary('M', 9000, '2026-09-22', '');
    closeTo(app.salaryAccrued('M', '2026-09-01', '2026-09-28'), 14000 + 9000, 'gap 15-21 Sep not paid');
  });
});

describe('wage slip for salaried staff', () => {
  test('slip facts include salary, so the balance matches the Wages page', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', 'panels-wages-receipts.js'), 'utf8');
    assert.match(src, /salaryAccrued\(emp, from, p\.date\)/);
    assert.match(src, /carry \+ earned \+ salary \+ bonus/);
  });
  test('helpers: salaried flag, weekly rate on a date, first date', () => {
    app.setData({ employees: [emp('M'), { id: 'x', name: 'W' }], staffSalary: { M: { rates: [{ date: '2026-09-01', weekly: 7000 }, { date: '2026-09-08', weekly: 9000 }], to: '2026-09-30' } } });
    assert.equal(app.isSalariedEmp('M'), true); assert.equal(app.isSalariedEmp('W'), false);
    assert.equal(app.salaryWeeklyOn('M', '2026-09-05'), 7000); assert.equal(app.salaryWeeklyOn('M', '2026-09-20'), 9000);
    assert.equal(app.salaryWeeklyOn('M', '2026-10-05'), 0); assert.equal(app.salaryFirstDate('M'), '2026-09-01');
  });
});
