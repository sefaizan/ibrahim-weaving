'use strict';
/* Cash Position on the Overview: opening balance or last checkpoint, plus/minus every cash movement. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, payment, cheque, closeTo } = require('./helpers/load-app');

const app = loadApp();

describe('Cash Position', () => {
  test('opening balance + cash actually received - everything paid out', () => {
    app.setData({
      openingBalance: 50000,
      recovery: [
        payment({ date: '2026-09-01', cashAmount: 10000, bankAmount: 4000 }),
        payment({ date: '2026-09-02', cheques: [cheque(5000, 'Pending'), cheque(3000, 'Cleared'), cheque(2000, 'Bounced')] }),
      ],
      expense: [{ id: 'x1', date: '2026-09-03', amount: 2500 }],
      wagePayments: [{ id: 'w1', date: '2026-09-03', employee: 'Riaz', amount: 6000 }],
      family: [{ id: 'f1', date: '2026-09-03', amount: 1000 }],
      warp: [{ id: 'k1', date: '2026-09-03', amount: 4000 }],
      weft: [{ id: 'y1', date: '2026-09-03', amount: 3000 }],
      loanPayments: [
        { id: 'l1', date: '2026-09-04', employee: 'Riaz', type: 'Loan Given', amount: 1500 },
        { id: 'l2', date: '2026-09-04', employee: 'Riaz', type: 'Loan Repaid', amount: 500 },
      ],
    });
    // Received as cash: 10000 + 4000 + 3000 (only the cleared cheque) = 17000.
    // Out: 2500 + 6000 + 1000 + 4000 + 3000 + net loans (1500 - 500).
    closeTo(app.computeStats('').cash, 50000 + 17000 - (2500 + 6000 + 1000 + 4000 + 3000) - (1500 - 500));
  });

  test('from a checkpoint: its balance + only what happened after its date and time', () => {
    app.setData({
      openingBalance: 999999, // ignored once a checkpoint exists
      checkpoints: [
        { id: 'c1', date: '2026-08-31', balance: 10000 },
        { id: 'c2', date: '2026-09-05', time: '12:00', balance: 20000 }, // the latest one is used
      ],
      recovery: [
        payment({ date: '2026-09-04', cashAmount: 1000 }),                  // before the checkpoint
        payment({ date: '2026-09-05', time: '11:59', cashAmount: 2000 }),   // earlier the same day
        payment({ date: '2026-09-05', time: '12:01', cashAmount: 3000 }),   // later the same day: counted
      ],
      wagePayments: [{ id: 'w1', date: '2026-09-05', employee: 'Riaz', amount: 700 }], // no time = start of day: before 12:00
      expense: [
        { id: 'x1', date: '2026-09-06', amount: 500 },
        { id: 'x2', date: '2026-09-05', time: '15:00', amount: 400 },       // later the same day: counted
        { id: 'x3', date: '2026-09-05', time: '09:00', amount: 9999 },      // earlier the same day: not counted
      ],
    });
    closeTo(app.computeStats('').cash, 20000 + 3000 - 500 - 400);
  });
});
