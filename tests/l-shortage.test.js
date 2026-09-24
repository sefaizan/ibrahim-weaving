'use strict';
/*
 * L (AIL) shortage-deduction feature.
 * A dyeing unit reports a lot as short by "L" (ail) — market convention (confirmed by the
 * business's senior, supersedes an earlier mm-based guess): shortage meters = (total meters
 * sold / 400) x L, and the PKR deduction is that shortage x the lot's own rate. Once applied,
 * the original Sale entry is superseded by a linked adjustment entry — see lStatus/
 * lAdjustedFromId on the records and activeSaleRows() in calc.js, which is what every
 * balance/total in the app reads instead of DATA.sale directly.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, sale, closeTo } = require('./helpers/load-app');

const app = loadApp();

describe('L (AIL) shortage formula', () => {
  test('the confirmed worked example: 5,000m lot, 7 L, Rs 120/mtr -> 87.5m short, Rs 10,500 deducted', () => {
    const shortage = app.lShortageMeters(5000, 7);
    closeTo(shortage, 87.5, 'shortage meters');
    const deduction = app.lDeductionAmount(shortage, 120);
    closeTo(deduction, 10500, 'deduction amount');
  });

  test('0 L is 0 shortage and 0 deduction', () => {
    closeTo(app.lShortageMeters(5000, 0), 0, 'shortage meters');
    closeTo(app.lDeductionAmount(0, 120), 0, 'deduction amount');
  });

  test('shortage scales linearly with both qty and L count', () => {
    closeTo(app.lShortageMeters(400, 1), 1, '400m lot, 1 L -> 1m short');
    closeTo(app.lShortageMeters(800, 1), 2, '800m lot, 1 L -> 2m short');
    closeTo(app.lShortageMeters(400, 5), 5, '400m lot, 5 L -> 5m short (at the tolerance)');
  });

  test('deduction amount is floored to whole paisa the same way a normal Sale amount is', () => {
    // 333 meters / 400 * 1 L = 0.8325m short, at a rate that produces a fractional result.
    const shortage = app.lShortageMeters(333, 1);
    const deduction = app.lDeductionAmount(shortage, 3);
    assert.equal(deduction, Math.floor(shortage * 3 + 1e-6), 'floored like addSale\'s Amount');
  });
});

describe('activeSaleRows excludes superseded/returned Sales from every total', () => {
  test('an "applied" (L-adjusted) original is excluded; its linked adjustment entry counts instead', () => {
    app.setData({
      sale: [
        sale({ id: 'orig', qty: 5000, amount: 600000, rate: 120, client: 'A', lStatus: 'applied', lCount: 7, lShortageQty: 87.5, lDeduction: 10500, lSupersededBy: 'adj' }),
        sale({ id: 'adj', qty: 4912.5, amount: 589500, rate: 120, client: 'A', lAdjustedFromId: 'orig' }),
      ],
    });
    const active = app.activeSaleRows();
    const ids = active.map(r => r.id);
    assert.ok(!ids.includes('orig'), 'the superseded original should not be active');
    assert.ok(ids.includes('adj'), 'the adjustment entry should be active');
    closeTo(active.reduce((s, r) => s + r.amount, 0), 589500, 'total active amount is just the adjusted figure, not both');
  });

  test('a "returned" lot is excluded entirely — no adjustment entry replaces it', () => {
    app.setData({
      sale: [
        sale({ id: 'orig', qty: 5000, amount: 600000, client: 'A', lStatus: 'returned', lCount: 9 }),
        sale({ id: 'other', qty: 1000, amount: 120000, client: 'A' }),
      ],
    });
    const active = app.activeSaleRows();
    assert.deepEqual(active.map(r => r.id), ['other'], 'only the unrelated sale remains active');
  });

  test('"awaiting" and "ok" statuses still count as active — only applied/returned are excluded', () => {
    app.setData({
      sale: [
        sale({ id: 'waiting', qty: 500, amount: 60000, client: 'A', lStatus: 'awaiting' }),
        sale({ id: 'clean', qty: 500, amount: 60000, client: 'A', lStatus: 'ok', lCount: 0 }),
        sale({ id: 'untracked', qty: 500, amount: 60000, client: 'A' }),
      ],
    });
    const ids = app.activeSaleRows().map(r => r.id);
    assert.deepEqual(ids.sort(), ['clean', 'untracked', 'waiting'], 'none of these should be excluded');
  });

  test('receivableBeforeLastSale ignores a superseded original and uses the adjusted amount', () => {
    app.setData({
      sale: [
        sale({ id: 'orig', date: '2026-09-01', qty: 5000, amount: 600000, client: 'A', lStatus: 'applied', lCount: 7, lSupersededBy: 'adj' }),
        sale({ id: 'adj', date: '2026-09-01', qty: 4912.5, amount: 589500, client: 'A', lAdjustedFromId: 'orig' }),
      ],
      recovery: [],
    });
    // With only one active sale (the adjustment), "receivable before the last sale" should be 0 —
    // if the superseded original were still counted this would wrongly include its amount too.
    const before = app.receivableBeforeLastSale('A');
    closeTo(before.amount, 0, 'nothing owed before the client\'s one (adjusted) sale');
  });

  test('buildClientLedger only lists the adjusted entry, not the superseded original, and notes the adjustment', () => {
    app.setData({
      sale: [
        sale({ id: 'orig', date: '2026-09-01', qty: 5000, amount: 600000, rate: 120, client: 'A', quality: 'Q', lStatus: 'applied', lCount: 7, lSupersededBy: 'adj' }),
        sale({ id: 'adj', date: '2026-09-01', qty: 4912.5, amount: 589500, rate: 120, client: 'A', quality: 'Q', lAdjustedFromId: 'orig' }),
      ],
      recovery: [],
    });
    const ledger = app.buildClientLedger('A', null, null);
    const ids = ledger.rows.map(e => e.id);
    assert.deepEqual(ids, ['adj'], 'only the adjusted entry appears on the statement');
    assert.match(ledger.rows[0].detail, /adjusted for L \(AIL\)/, 'the ledger line notes the L adjustment');
  });
});
