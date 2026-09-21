'use strict';
/* Receivables: what each client owes, how old it is, the client statement and the Overview totals. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, sale, payment, cheque, closeTo } = require('./helpers/load-app');

const app = loadApp();

// "Today" is fixed at 2026-09-20 by the loader; this gives the date N days before it.
const daysAgo = (n) => new Date(Date.UTC(2026, 8, 20) - n * 86400000).toISOString().slice(0, 10);

describe('receivable aging (oldest sales are treated as paid first)', () => {
  test('payments settle the oldest sale first; the rest is aged from the sale it belongs to', () => {
    app.setData({
      clients: [{ name: 'A' }],
      sale: [sale({ date: daysAgo(100), amount: 1000 }), sale({ date: daysAgo(20), amount: 2000 })],
      recovery: [payment({ date: daysAgo(10), cashAmount: 1500 })],
    });
    const { rows, totals } = app.computeReceivablesAging();
    assert.equal(rows.length, 1);
    closeTo(rows[0].totalReceivable, 1500, 'owed'); // 3000 sold - 1500 paid
    assert.equal(rows[0].oldestDate, daysAgo(20));  // the 100-day-old sale is fully paid off
    assert.equal(rows[0].daysOutstanding, 20);
    closeTo(rows[0].buckets.d0_30, 1500, '0-30 days');
    closeTo(totals.d0_30, 1500, 'total 0-30');
  });

  test('bucket boundaries: 30 days is still 0-30, 31 starts 31-60, and so on', () => {
    app.setData({
      clients: [{ name: 'A' }],
      sale: [
        sale({ date: daysAgo(30), amount: 100 }),  sale({ date: daysAgo(31), amount: 200 }),
        sale({ date: daysAgo(60), amount: 400 }),  sale({ date: daysAgo(61), amount: 800 }),
        sale({ date: daysAgo(90), amount: 1600 }), sale({ date: daysAgo(91), amount: 3200 }),
      ],
    });
    const { rows } = app.computeReceivablesAging();
    const b = rows[0].buckets;
    closeTo(b.d0_30, 100, '0-30');
    closeTo(b.d31_60, 200 + 400, '31-60');
    closeTo(b.d61_90, 800 + 1600, '61-90');
    closeTo(b.d90plus, 3200, '90+');
    closeTo(rows[0].totalReceivable, 6300, 'total');
    assert.equal(rows[0].daysOutstanding, 91);
  });

  test('a client who has paid in full, or overpaid, is not listed', () => {
    app.setData({
      clients: [{ name: 'Paid' }, { name: 'Over' }, { name: 'Owes' }],
      sale: [sale({ client: 'Paid', amount: 500 }), sale({ client: 'Over', amount: 500 }), sale({ client: 'Owes', amount: 500 })],
      recovery: [payment({ client: 'Paid', cashAmount: 500 }), payment({ client: 'Over', cashAmount: 900 })],
    });
    assert.deepEqual(app.computeReceivablesAging().rows.map(r => r.name), ['Owes']);
  });

  test('the client with the oldest unpaid sale comes first', () => {
    app.setData({
      clients: [{ name: 'Recent' }, { name: 'Old' }],
      sale: [sale({ client: 'Recent', date: daysAgo(5), amount: 100 }), sale({ client: 'Old', date: daysAgo(70), amount: 100 })],
    });
    assert.deepEqual(app.computeReceivablesAging().rows.map(r => r.name), ['Old', 'Recent']);
  });

  test('a bounced or replaced cheque does not pay anything off; a pending one does', () => {
    const owed = (status) => {
      app.setData({
        clients: [{ name: 'A' }], sale: [sale({ date: daysAgo(10), amount: 1000 })],
        recovery: [payment({ cheques: [cheque(1000, status)] })],
      });
      const rows = app.computeReceivablesAging().rows;
      return rows.length ? rows[0].totalReceivable : 0;
    };
    closeTo(owed('Bounced'), 1000, 'bounced');
    closeTo(owed('Replaced'), 1000, 'replaced');
    closeTo(owed('Pending'), 0, 'pending');
    closeTo(owed('Cleared'), 0, 'cleared');
  });
});

describe('receivable just before a client\'s latest sale', () => {
  test('= earlier sales - everything received up to the latest sale\'s date, cheques at face value', () => {
    app.setData({
      sale: [sale({ id: 's1', date: '2026-08-01', amount: 1000 }), sale({ id: 's2', date: '2026-09-10', amount: 500 })],
      recovery: [
        payment({ date: '2026-08-15', cheques: [cheque(400, 'Bounced')] }), // counted, even though it bounced later
        payment({ date: '2026-09-10', cashAmount: 100 }),                    // same day as the sale: counted
        payment({ date: '2026-09-15', cashAmount: 300 }),                    // after the sale: not counted
        payment({ client: 'Other', date: '2026-08-20', cashAmount: 9999 }),  // someone else
      ],
    });
    const r = app.receivableBeforeLastSale('A');
    closeTo(r.amount, 1000 - (400 + 100), 'amount');
    assert.equal(r.lastSaleDate, '2026-09-10');
  });

  test('two sales on the same day: the one with the higher id is "last"', () => {
    app.setData({ sale: [sale({ id: 'a', date: '2026-09-01', amount: 100 }), sale({ id: 'b', date: '2026-09-01', amount: 40 })] });
    closeTo(app.receivableBeforeLastSale('A').amount, 100, 'amount');
  });

  test('a client with no sales has no figure', () => {
    app.setData({});
    assert.equal(app.receivableBeforeLastSale('Nobody'), null);
  });
});

describe('client statement (running balance)', () => {
  const data = () => ({
    sale: [sale({ id: 's1', date: '2026-08-01', amount: 1000 }), sale({ id: 's2', date: '2026-08-10', amount: 2000 })],
    recovery: [
      payment({ id: 'r1', date: '2026-08-05', cashAmount: 500 }),
      payment({ id: 'r2', date: '2026-08-12', cheques: [cheque(800, 'Bounced')] }),  // pays nothing
      payment({ id: 'r3', date: '2026-08-15', cheques: [cheque(300, 'Pending')] }),  // counts as paid
    ],
  });

  test('sales add to the balance, payments reduce it, bounced cheques reduce nothing', () => {
    app.setData(data());
    const l = app.buildClientLedger('A');
    assert.deepEqual(l.rows.map(r => r.balance), [1000, 500, 2500, 2500, 2200]);
    closeTo(l.closingBalance, 2200, 'closing');
  });

  test('choosing a From date folds everything earlier into an opening balance', () => {
    app.setData(data());
    const l = app.buildClientLedger('A', '2026-08-10');
    closeTo(l.openingBalance, 1000 - 500, 'opening');
    assert.deepEqual(l.rows.map(r => r.balance), [2500, 2500, 2200]);
    closeTo(l.closingBalance, 2200, 'closing');
  });

  test('the To date cuts the statement off (inclusive)', () => {
    app.setData(data());
    const l = app.buildClientLedger('A', null, '2026-08-10');
    assert.deepEqual(l.rows.map(r => r.balance), [1000, 500, 2500]);
  });

  test('a client with no history has no statement', () => {
    app.setData(data());
    assert.equal(app.buildClientLedger('Nobody'), null);
  });
});

describe('Overview Receivable', () => {
  // A: two sales, a cash payment and a cheque that bounced in August. B: one sale, part-paid.
  const data = () => ({
    clients: [{ name: 'A' }, { name: 'B' }],
    sale: [
      sale({ client: 'A', date: '2026-08-10', amount: 10000 }),
      sale({ client: 'A', date: '2026-09-05', amount: 5000 }),
      sale({ client: 'B', date: '2026-09-06', amount: 8000 }),
    ],
    recovery: [
      payment({ client: 'A', date: '2026-08-20', cashAmount: 3000 }),
      payment({ client: 'A', date: '2026-08-25', cheques: [cheque(6000, 'Bounced')] }),
      payment({ client: 'B', date: '2026-09-10', bankAmount: 2000 }),
    ],
  });
  const rows = (s) => Object.fromEntries(s.receivablesByClient.map(r => [r.name, r]));

  test('headline Receivable = all sales - received - bounced', () => {
    app.setData(data());
    const s = app.computeStats('');
    closeTo(s.salesAmtCum, 23000, 'sales');
    closeTo(s.receivedCum, 5000, 'received');
    closeTo(s.receivable, 23000 - 5000 - 6000, 'receivable');
  });

  test('each client\'s Receivable is their own sales - received - bounced', () => {
    app.setData(data());
    const r = rows(app.computeStats(''));
    closeTo(r.A.receivable, 15000 - 3000 - 6000, 'A');
    closeTo(r.B.receivable, 8000 - 2000, 'B');
    closeTo(r.A.bounced, 6000, 'A bounced');
  });

  for (const period of ['', '2026-09', '2026', 'range:2026-09-01:2026-09-30']) {
    test(`the client rows add up to the headline Receivable (period "${period || 'all time'}")`, () => {
      app.setData(data());
      const s = app.computeStats(period);
      const sum = s.receivablesByClient.reduce((t, r) => t + r.receivable, 0);
      closeTo(sum, s.receivable, 'sum of client rows vs headline');
    });
  }

  test('a cheque that bounced in an earlier month still comes off the client\'s Receivable when viewing a later month', () => {
    app.setData(data());
    const r = rows(app.computeStats('2026-09'));
    closeTo(r.A.receivable, 6000, 'A in September view (same as all-time)');
  });
});
