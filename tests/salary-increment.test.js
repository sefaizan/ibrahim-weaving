'use strict';
/* Salary increments (v3.19.10): salaried staff only; the owner picks the effective date; days before it keep the old salary. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, closeTo } = require('./helpers/load-app.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function ledger(){
  return { qualities: [{ name: 'Q1' }], clients: [],
    employees: [{ id: 'e1', name: 'Ali', salaried: true }, { id: 'e2', name: 'Bilal' }],
    staffSalary: { Ali: { rates: [{ date: '2026-09-07', weekly: 21000 }] } } };
}

describe('salary increments', () => {
  test('a raise from a picked mid-week date splits that week exactly (Mon-Tue old, Wed-Sun new)', () => {
    const app = loadApp(); app.setToday('2026-11-12'); app.setData(ledger());
    assert.deepEqual(app.addSalaryIncrement('Ali', 24500, '2026-10-14', 'yearly increment'), { ok: true });
    closeTo(app.salaryAccrued('Ali', '2026-10-12', '2026-10-18'), 2 * 3000 + 5 * 3500);
    closeTo(app.salaryAccrued('Ali', '2026-10-05', '2026-10-11'), 21000);          // the week before is untouched
    closeTo(app.salaryWeeklyOn('Ali', '2026-10-13'), 21000); closeTo(app.salaryWeeklyOn('Ali', '2026-10-14'), 24500);
  });
  test('history shows the change in Rs and %, the reason, and keeps the first salary without a change', () => {
    const app = loadApp(); app.setToday('2026-11-12'); app.setData(ledger());
    app.addSalaryIncrement('Ali', 24500, '2026-10-14', 'yearly increment');
    const h = app.salaryHistory('Ali');
    assert.equal(h.length, 2); assert.equal(h[0].change, null);
    closeTo(h[1].change, 3500); closeTo(h[1].pct, 100 / 6); assert.equal(h[1].reason, 'yearly increment');
  });
  test('same date = correction, not a duplicate line; the old 4-argument save keeps the reason', () => {
    const app = loadApp(); app.setData(ledger());
    app.addSalaryIncrement('Ali', 24500, '2026-10-14', 'r1'); app.addSalaryIncrement('Ali', 25000, '2026-10-14', 'r2');
    assert.equal(app.salaryHistory('Ali').length, 2); closeTo(app.salaryHistory('Ali')[1].weekly, 25000);
    app.saveStaffSalary('Ali', 26000, '2026-10-14', '');
    assert.equal(app.salaryHistory('Ali')[1].reason, 'r2');
  });
  test('only salaried staff: a per-meter employee is refused and nothing is written', () => {
    const app = loadApp(); app.setData(ledger());
    const r = app.addSalaryIncrement('Bilal', 20000, '2026-10-14', '');
    assert.equal(r.ok, false); assert.equal(app.staffSalaryOf('Bilal'), null);
  });
  test('bad input is refused: no amount, no date, after the last working day', () => {
    const app = loadApp(); const d = ledger(); d.staffSalary.Ali.to = '2026-12-31'; app.setData(d);
    assert.equal(app.addSalaryIncrement('Ali', 0, '2026-10-14').ok, false);
    assert.equal(app.addSalaryIncrement('Ali', 25000, '').ok, false);
    assert.equal(app.addSalaryIncrement('Ali', 25000, '2027-01-05').ok, false);
    assert.equal(app.addSalaryIncrement('Ali', 25000, '2026-12-01').ok, true);
    assert.equal(app.staffSalaryOf('Ali').to, '2026-12-31');                      // last working day kept
  });
  test('deleting a raise restores the old pay; the only salary cannot be deleted', () => {
    const app = loadApp(); app.setToday('2026-11-12'); app.setData(ledger());
    app.addSalaryIncrement('Ali', 24500, '2026-10-14', '');
    assert.equal(app.deleteSalaryRate('Ali', '2026-10-14').ok, true);
    closeTo(app.salaryAccrued('Ali', '2026-10-12', '2026-10-18'), 21000);
    assert.equal(app.deleteSalaryRate('Ali', '2026-09-07').ok, false);
  });
  test('wired in: Increment button only for salaried staff with wages edit access, hidden on view-only phones, old form guarded', () => {
    assert.match(read('js/shell.js'), /x\.salaried && canSalEdit/);
    assert.doesNotMatch(read('js/shell.js'), /rowbtn" data-sal-inc/);                 // not in the cramped button strip (v3.19.11)
    assert.match(read('js/shell.js'), /\+ Give increment/);
    assert.match(read('js/view-only.js'), /\[data-sal-inc\]/);
    assert.match(read('index.html'), /body\.view-only \[data-sal-inc\]/);
    assert.match(read('js/wiring.js'), /openSalarySheet\(DATA\.employees\.find/);
    assert.match(read('js/wiring.js'), /For a raise use the Increment button/);
    assert.match(read('js/wiring.js'), /type="date"|field\('Effective from','sal_date','date'/);
  });
});
