'use strict';
/*
 * Cheques: how each cheque status counts towards Cash Position, Receivable and the
 * Bounced bucket, and how the Bounced Cheques list is built.
 *   Cleared  - money in the bank: counts as cash and as received.
 *   Pending  - counts as received (client has paid) but NOT as cash yet.
 *   Bounced  - never received; shown in its own Bounced bucket.
 *   Replaced - bounced and substituted by a separate payment entry; counts as nothing.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, sale, payment, cheque, closeTo } = require('./helpers/load-app');

const app = loadApp();

describe('one payment record, split by cheque status', () => {
  const rec = payment({
    cashAmount: 1000, bankAmount: 500,
    cheques: [cheque(300, 'Pending'), cheque(200, 'Cleared'), cheque(100, 'Bounced'), cheque(50, 'Replaced')],
  });

  test('Received (Receivable side) = cash + bank + Pending + Cleared cheques', () => {
    closeTo(app.recoveryReceivableAmount(rec), 2000);
  });
  test('Cash Position side = cash + bank + Cleared cheques only', () => {
    closeTo(app.recoveryCashAmount(rec), 1700);
  });
  test('Bounced bucket = Bounced cheques only (not Replaced)', () => {
    closeTo(app.recoveryBouncedAmount(rec), 100);
  });
  test('face value counts every cheque, even one that bounced, but not a Replaced one (its replacement is a separate payment)', () => {
    closeTo(app.recoveryFaceAmount(rec), 2100);
  });
  test('face value = received + bounced (a Replaced cheque is never counted twice)', () => {
    closeTo(app.recoveryFaceAmount(rec), app.recoveryReceivableAmount(rec) + app.recoveryBouncedAmount(rec));
  });
  test('cheque amounts saved as text still add up', () => {
    const r = payment({ cheques: [cheque('300', 'Pending'), cheque('200', 'Bounced')] });
    closeTo(app.recoveryReceivableAmount(r), 300);
    closeTo(app.recoveryBouncedAmount(r), 200);
  });
});

describe('older payment records (saved before cash + bank + cheques were split)', () => {
  test('a plain amount with a method of Cash, Bank Transfer, or no method at all', () => {
    assert.deepEqual(app.recoveryParts({ method: 'Cash', amount: 700 }), { cashAmount: 700, bankAmount: 0, cheques: [] });
    assert.deepEqual(app.recoveryParts({ method: 'Bank Transfer', amount: '450' }), { cashAmount: 0, bankAmount: 450, cheques: [] });
    assert.deepEqual(app.recoveryParts({ amount: 90 }), { cashAmount: 90, bankAmount: 0, cheques: [] });
  });
  test('a cheque-method record takes its money from the cheques, not the amount field', () => {
    const r = { method: 'Cheque', amount: 999, cheques: [cheque(400, 'Cleared'), cheque(100, 'Bounced')] };
    closeTo(app.recoveryReceivableAmount(r), 400);
    closeTo(app.recoveryCashAmount(r), 400);
    closeTo(app.recoveryBouncedAmount(r), 100);
  });
});

describe('Bounced Cheques list', () => {
  test('lists only Bounced cheques, newest payment first, with client and payment date', () => {
    app.setData({ recovery: [
      payment({ id: 'r1', client: 'A', date: '2026-08-25', cheques: [cheque(1000, 'Bounced', { id: 'c1' }), cheque(500, 'Cleared', { id: 'c2' })] }),
      payment({ id: 'r2', client: 'B', date: '2026-09-05', cheques: [cheque(700, 'Bounced', { id: 'c3' }), cheque(50, 'Replaced', { id: 'c4' })] }),
      payment({ id: 'r3', client: 'C', date: '2026-09-06', cashAmount: 100 }),
    ] });
    const list = app.computeBouncedCheques();
    assert.deepEqual(list.map(c => c.id), ['c3', 'c1']);
    assert.deepEqual(list.map(c => c.client), ['B', 'A']);
    assert.deepEqual(list.map(c => c.date), ['2026-09-05', '2026-08-25']);
    assert.deepEqual(list.map(c => c.recoveryId), ['r2', 'r1']);
    closeTo(list.reduce((s, c) => s + c.amount, 0), 1700, 'total bounced');
  });

  test('no bounced cheques gives an empty list', () => {
    app.setData({ recovery: [payment({ cashAmount: 100, cheques: [cheque(50, 'Pending')] })] });
    assert.equal(app.computeBouncedCheques().length, 0);
  });

  test('Pending cheques are listed on their own, ordered by cheque date', () => {
    app.setData({ recovery: [
      payment({ id: 'r1', client: 'A', date: '2026-09-01', cheques: [cheque(10, 'Pending', { id: 'late', chequeDate: '2026-10-15' })] }),
      payment({ id: 'r2', client: 'B', date: '2026-09-02', cheques: [cheque(20, 'Pending', { id: 'soon', chequeDate: '2026-09-25' })] }),
    ] });
    assert.deepEqual(app.computePendingCheques().map(c => c.id), ['soon', 'late']);
  });
});

describe('life of a cheque — what the Overview shows at each step', () => {
  // Client A buys Rs 10,000 of cloth and pays with a single Rs 10,000 cheque.
  const overview = (status, extraPayments = []) => {
    app.setData({
      clients: [{ name: 'A' }],
      sale: [sale({ date: '2026-09-01', amount: 10000 })],
      recovery: [payment({ date: '2026-09-02', cheques: [cheque(10000, status)] }), ...extraPayments],
    });
    const s = app.computeStats('');
    return { receivable: s.receivable, cash: s.cash, row: s.receivablesByClient.find(r => r.name === 'A') };
  };

  test('Pending: the client has paid (Receivable 0) but no cash has arrived yet', () => {
    const o = overview('Pending');
    closeTo(o.receivable, 0, 'receivable'); closeTo(o.cash, 0, 'cash'); closeTo(o.row.bounced, 0, 'bounced');
  });
  test('Cleared: Receivable 0 and the money is now in Cash Position', () => {
    const o = overview('Cleared');
    closeTo(o.receivable, 0, 'receivable'); closeTo(o.cash, 10000, 'cash');
  });
  test('Bounced: no cash, and the Rs 10,000 moves into the Bounced column instead of Receivable', () => {
    const o = overview('Bounced');
    closeTo(o.receivable, 0, 'receivable'); closeTo(o.cash, 0, 'cash'); closeTo(o.row.bounced, 10000, 'bounced');
  });
  test('Replaced by a cash payment: the debt is settled and the Bounced column empties', () => {
    const o = overview('Replaced', [payment({ date: '2026-09-10', cashAmount: 10000 })]);
    closeTo(o.receivable, 0, 'receivable'); closeTo(o.cash, 10000, 'cash'); closeTo(o.row.bounced, 0, 'bounced');
  });
  test('Bounced with a partly-paid sale: only the genuinely unpaid part shows as Receivable', () => {
    app.setData({
      clients: [{ name: 'A' }],
      sale: [sale({ amount: 15000 })],
      recovery: [payment({ cashAmount: 5000 }), payment({ cheques: [cheque(4000, 'Bounced')] })],
    });
    const s = app.computeStats('');
    closeTo(s.receivable, 15000 - 5000 - 4000, 'receivable');
    closeTo(s.receivablesByClient[0].bounced, 4000, 'bounced');
  });
});
