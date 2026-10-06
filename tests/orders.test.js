'use strict';
/* Client orders (v3.18.12): progress against a never-exact order, tolerance, linked sales only, warnings. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app');
const app = loadApp();
const Q = '62/44 (150.144 Micro)';
const sale = (id, date, qty, o, extra) => Object.assign({id, date, client: 'Javed', quality: Q, qty, rate: 100, amount: qty * 100, order: o}, extra || {});
const seed = (sales, order) => app.setData({orders: [Object.assign({id: 'o1', no: 'ORD-001', client: 'Javed', quality: Q, qty: 20000, rate: 100, closed: false}, order || {})], sale: sales, production: []});

describe('order progress', () => {
  test('three batches that overshoot 20,000 m show over by 2,753 m and the average rate', () => {
    seed([sale('a', '2026-09-01', 7662, 'o1'), sale('b', '2026-09-08', 7505, 'o1'), sale('c', '2026-09-15', 7586, 'o1', {rate: 102, amount: 7586 * 102})]);
    const s = app.orderStats(app.getData().orders[0], '2026-09-20');
    assert.equal(s.got, 22753); assert.equal(s.diff, 2753); assert.equal(s.status, 'over'); assert.equal(s.offRate, 1); assert.equal(s.batches, 3);
    assert.ok(Math.abs(s.pct - 13.765) < 0.01);
  });
  test('within the default 5% band is within tolerance; a custom band changes the verdict; closed wins', () => {
    seed([sale('a', '2026-09-01', 20600, 'o1')]);
    assert.equal(app.orderStats(app.getData().orders[0]).status, 'within');
    seed([sale('a', '2026-09-01', 20600, 'o1')], {tolerance: 2}); assert.equal(app.orderStats(app.getData().orders[0]).status, 'over');
    seed([sale('a', '2026-09-01', 5000, 'o1')], {closed: true}); assert.equal(app.orderStats(app.getData().orders[0]).status, 'closed');
  });
  test('only sales linked to the order count, and L-applied originals are skipped', () => {
    seed([sale('a', '2026-09-01', 6000, 'o1'), sale('b', '2026-09-02', 9000, ''), sale('c', '2026-09-03', 3000, 'o1', {lStatus: 'applied'})]);
    const s = app.orderStats(app.getData().orders[0]); assert.equal(s.got, 6000); assert.equal(s.pending, 14000);
  });
  test('this week counts from Monday', () => {
    seed([sale('a', '2026-09-14', 4000, 'o1'), sale('b', '2026-09-21', 3000, 'o1')], {weekly: 6000});
    assert.equal(app.orderStats(app.getData().orders[0], '2026-09-23').weekGot, 3000);
  });
  test('a batch under the minimum, or on a completed order, warns', () => {
    seed([], {minBatch: 6000}); assert.match(app.orderSaleWarn({order: 'o1', qty: 5000}), /minimum of 6000/); assert.equal(app.orderSaleWarn({order: 'o1', qty: 6500}), '');
    seed([], {closed: true}); assert.match(app.orderSaleWarn({order: 'o1', qty: 7000}), /already marked complete/);
  });
});

describe('order revoke', () => {
  test('a revoked order reports revoked, keeps its deliveries, and warns on new sales', () => {
    seed([sale('a', '2026-09-01', 6000, 'o1')], {closed: true, revoked: {date: '2026-09-10', terms: 'Rest cancelled'}});
    const s = app.orderStats(app.getData().orders[0]); assert.equal(s.status, 'revoked'); assert.equal(s.got, 6000);
    assert.match(app.orderSaleWarn({order: 'o1', qty: 7000}), /revoked/);
  });
});
