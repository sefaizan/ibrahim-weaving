'use strict';
/*
 * Wage slip (Wages > Payments > Wage payment log): Receipt (print / PDF) + Share (image) buttons, and what
 * the slip says: wages, bonus, paid, the rounding balance, and ONLY the employee's loan outstanding total.
 * Runs the real js/calc.js and the wage-slip part of js/panels-wages-receipts.js.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { emptyData, prod } = require('./helpers/load-app');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function load(extra) {
  const data = Object.assign(emptyData(), {
    qualities: [{ name: 'A' }], employees: [{ id: 'e1', name: 'Ali' }, { id: 'e2', name: 'Riaz' }],
    wageRateHistory: { A: [{ date: '2026-01-01', rate: 10 }] },
    production: [prod({ date: '2026-10-01', quality: 'A', qty: 849, e1: 'Ali', e1m: 849 })], // Ali earns 8490
    wageBonuses: [{ id: 'b1', date: '2026-10-02', employee: 'Ali', amount: 500 }],
    wagePayments: [{ id: 'p1', date: '2026-10-03', employee: 'Ali', amount: 9000, remarks: '' }],
    loanPayments: [], businessInfo: {},
  }, extra || {});
  const toasts = [];
  const ctx = vm.createContext({
    DATA: data, BIZ_LOGO_PNG: 'x', receiptWatermarkDiv: '', dateTimeStamp: () => 'T',
    fmtRs: (n) => 'Rs ' + Math.round(n || 0), fmtRs2: (n) => 'Rs ' + (n || 0).toFixed(2), fmtDate: (d) => d,
    escHtml: (s) => String(s), showToast: (m) => toasts.push(m), document: { getElementById: () => ({}) },
  });
  vm.runInContext(read('js/calc.js'), ctx);
  const src = read('js/panels-wages-receipts.js');
  vm.runInContext(src.slice(src.indexOf('function wageReceiptFacts')), ctx);
  return { ctx, toasts, html: (id) => vm.runInContext(`printWageReceipt('${id}',{htmlOnly:true})`, ctx), facts: (id) => JSON.parse(vm.runInContext(`JSON.stringify(wageReceiptFacts('${id}'))`, ctx)) };
}

describe('wage slip numbers', () => {
  test('paid more than earned: the difference is shown as receivable from the employee', () => {
    const { facts, html } = load();
    const f = facts('p1');
    assert.equal(f.earned, 8490); assert.equal(f.bonus, 500); assert.equal(f.balance, -10);
    const h = html('p1');
    assert.match(h, /Receivable from employee/); assert.match(h, /Rs 10\.00/);
  });
  test('paid less than earned: shown as still payable', () => {
    const { html } = load({ wagePayments: [{ id: 'p1', date: '2026-10-03', employee: 'Ali', amount: 8000, remarks: '' }] });
    assert.match(html('p1'), /Still payable to employee/);
  });
  test('paid exactly: Settled', () => {
    const { html } = load({ wagePayments: [{ id: 'p1', date: '2026-10-03', employee: 'Ali', amount: 8990, remarks: '' }] });
    assert.match(html('p1'), /Settled/);
  });
  test('a settlement earlier on is brought forward and only later payments count', () => {
    const { facts } = load({
      wageSettlements: [{ id: 's1', date: '2026-09-30', employee: 'Ali', carryForward: -7 }],
      wagePayments: [{ id: 'p0', date: '2026-09-29', employee: 'Ali', amount: 1, remarks: '' }, { id: 'p1', date: '2026-10-03', employee: 'Ali', amount: 9000, remarks: '' }],
    });
    const f = facts('p1');
    assert.equal(f.carry, -7); assert.equal(f.paidEarlier, 0); assert.equal(f.balance, -17);
  });
  test('a missing payment gives no slip and a message instead of an error', () => {
    const { ctx, toasts } = load();
    assert.equal(vm.runInContext("printWageReceipt('nope')", ctx), undefined);
    assert.equal(toasts.length, 1);
  });
});

describe('loan on the wage slip: outstanding total only', () => {
  const loans = [
    { id: 'l1', employee: 'Riaz', date: '2026-09-01', type: 'Loan Given', amount: 5000 },
    { id: 'l2', employee: 'Riaz', date: '2026-09-10', type: 'Loan Repaid', amount: 2000 },
    { id: 'l3', employee: 'Ali', date: '2026-09-01', type: 'Loan Given', amount: 700 },
  ];
  test('given 5000, repaid 2000 -> one line, Loan outstanding Rs 3000, no history', () => {
    const { html } = load({
      production: [prod({ date: '2026-10-01', quality: 'A', qty: 100, e1: 'Riaz', e1m: 100 })],
      wagePayments: [{ id: 'p1', date: '2026-10-03', employee: 'Riaz', amount: 1000, remarks: '' }], loanPayments: loans,
    });
    const h = html('p1');
    assert.match(h, /Loan outstanding<\/span><span>Rs 3000\.00/);
    assert.equal((h.match(/Loan/g) || []).length, 1);
    assert.doesNotMatch(h, /Repaid|Given|Loan Account/);
  });
  test("another employee's loan never appears; a later loan does not change an earlier slip", () => {
    const { html } = load({ loanPayments: loans.concat([{ id: 'l4', employee: 'Ali', date: '2026-10-20', type: 'Loan Given', amount: 9999 }]) });
    const h = html('p1');
    assert.match(h, /Rs 700\.00/); assert.doesNotMatch(h, /3000|9999/);
  });
  test('no outstanding loan -> no loan line at all', () => {
    const { html } = load({ loanPayments: [{ id: 'l1', employee: 'Ali', date: '2026-09-01', type: 'Loan Given', amount: 500 }, { id: 'l2', employee: 'Ali', date: '2026-09-05', type: 'Loan Repaid', amount: 500 }] });
    assert.doesNotMatch(html('p1'), /Loan/);
  });
});

describe('buttons are wired', () => {
  test('each Wage Payments log row has Receipt and Share buttons', () => {
    const s = read('js/panels-wages-receipts.js');
    assert.match(s, /wageReceiptBtn\(r\.id\)\}\$\{canShareFiles\(\) \? shareWageReceiptBtn\(r\.id\)/);
    assert.match(s, /data-wage-receipt="\$\{id\}"/); assert.match(s, /data-share-wage-receipt="\$\{id\}"/);
  });
  test('taps call the right functions (lock-init.js) and Share builds an image via kind "wage" (core.js)', () => {
    const l = read('js/lock-init.js'), c = read('js/core.js');
    assert.match(l, /closest\('\[data-wage-receipt\]'\)[\s\S]{0,200}printWageReceipt\(btn\.dataset\.wageReceipt\)/);
    assert.match(l, /closest\('\[data-share-wage-receipt\]'\)[\s\S]{0,200}shareWageReceipt\(btn\.dataset\.shareWageReceipt\)/);
    assert.match(c, /kind === 'wage' \? printWageReceipt\(id, \{htmlOnly:true\}\)/);
    assert.match(c, /kind === 'wage' \? buildWageReceiptFields\(id\)/);
  });
  test('the new buttons are not in the view-only write list (reading a receipt stays allowed)', () => {
    assert.doesNotMatch(read('js/view-only.js').match(/VIEW_ONLY_WRITE_SELECTOR = \[[\s\S]*?\]\.join/)[0], /receipt/);
  });
});
