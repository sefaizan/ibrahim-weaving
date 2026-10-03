'use strict';
/* Production entry forms: Employee 2's automatic meters, and who gets the leftover (Diff). */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, prod, closeTo } = require('./helpers/load-app');
const app = loadApp();

describe('entry split', () => {
  test('Employee 2 gets whole meters after Employee 1', () => {
    assert.equal(app.entryEmployee2Meters(100, 60, 0), 40);
    assert.equal(app.entryEmployee2Meters(100.5, 60, 0), 40); // the .5 stays in Diff
  });
  test('Employee 3 meters are deducted from Employee 2', () => {
    assert.equal(app.entryEmployee2Meters(100, 60, 15), 25);
    assert.equal(app.entryEmployee2Meters(100, 60, 0), 40);
  });
  test('nothing left gives 0; too much assigned gives null', () => {
    assert.equal(app.entryEmployee2Meters(100, 100, 0), 0);
    assert.equal(app.entryEmployee2Meters(100, 90, 20), null);
  });
  test('leftover fraction is shared equally between all employees on the entry', () => {
    app.setData({ qualities: [{ name: 'Q' }], employees: ['A','B','C'].map(n => ({ id: n, name: n })),
      wageRateHistory: { Q: [{ date: '2026-01-01', rate: 10 }] },
      production: [prod({ qty: 100.5, e1: 'A', e1m: 60, e2: 'B', e2m: 25, e3: 'C', e3m: 15 })] });
    ['A','B','C'].forEach(n => closeTo(app.computeWageMeters(n, 'Q', null, null).diffShare, 0.5 / 3, n));
  });
});

describe('weft type label', () => {
  test('shows name (count N); a type without a count is just its name', () => {
    assert.equal(app.weftTypeLabel({ name: 'Nishat', count: 36 }), 'Nishat (count 36)');
    assert.equal(app.weftTypeLabel({ name: 'Nishat', count: 30 }), 'Nishat (count 30)');
    assert.equal(app.weftTypeLabel({ name: '20/1 Carded' }), '20/1 Carded');
    assert.equal(app.weftTypeLabel({ name: 'X', count: 0 }), 'X');
  });
});

describe('quality auto name', () => {
  test('picks and warp type make the name; nothing until both are given', () => {
    assert.equal(app.qualityAutoName('150.144', 44), '44 - 150.144');
    assert.equal(app.qualityAutoName('150.144 Micro', '46'), '46 - 150.144 Micro');
    assert.equal(app.qualityAutoName('', 44), '');
    assert.equal(app.qualityAutoName('150.144', 0), '');
  });
});
