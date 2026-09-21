'use strict';
/*
 * Warp beams: when each beam finished, how long it ran, and meters woven on it.
 * A beam finishes either when the next beam is chained onto the same loom, or when it is marked
 * Finished by hand. The dates below are worked out by hand.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, prod, closeTo } = require('./helpers/load-app');

const beam = (o) => ({ id: 'b', date: '2026-09-01', time: '08:00', loom: '1', warpType: 'Micro', length: 1000, ...o });

describe('beam finish date', () => {
  test('a beam replaced by the next one on the loom finished when that next beam went on', () => {
    const app = loadApp();
    app.setData({ warpBeams: [
      beam({ id: 'b1', date: '2026-09-01', time: '08:00' }),
      beam({ id: 'b2', date: '2026-09-11', time: '14:30' }),
    ]});
    const d = app.computeBeamDetails();
    assert.equal(d.b1.finishedOn, '2026-09-11');
    assert.equal(d.b1.finishedTime, '14:30');
    assert.equal(d.b1.finishedHow, 'replaced');
    assert.equal(d.b1.isActive, false);
    // 1 Sep 08:00 -> 11 Sep 14:30 = 10 days 6.5 hours
    closeTo(d.b1.daysTaken, 10 + 6.5 / 24, 'days taken');
  });

  test('the newest beam on a loom is still active: no finish date', () => {
    const app = loadApp();
    app.setData({ warpBeams: [ beam({ id: 'b1' }), beam({ id: 'b2', date: '2026-09-11' }) ] });
    const d = app.computeBeamDetails();
    assert.equal(d.b2.finishedOn, null);
    assert.equal(d.b2.finishedHow, null);
    assert.equal(d.b2.isActive, true);
  });

  test('a beam marked Finished by hand uses the date and time it was marked', () => {
    const app = loadApp();
    app.setData({ warpBeams: [ beam({ id: 'b1', finished: true, finishedDate: '2026-09-08', finishedTime: '17:45' }) ] });
    const d = app.computeBeamDetails();
    assert.equal(d.b1.finishedOn, '2026-09-08');
    assert.equal(d.b1.finishedTime, '17:45');
    assert.equal(d.b1.finishedHow, 'manual');
    assert.equal(d.b1.isActive, false);
    closeTo(d.b1.daysTaken, 7 + 9.75 / 24, 'days taken');
  });

  test('marked finished but no date stored (older entry): reported as manual, without inventing a date', () => {
    const app = loadApp();
    app.setData({ warpBeams: [ beam({ id: 'b1', finished: true }) ] });
    const d = app.computeBeamDetails();
    assert.equal(d.b1.finishedOn, null);
    assert.equal(d.b1.finishedHow, 'manual');
  });

  test('beams on different looms do not finish each other', () => {
    const app = loadApp();
    app.setData({ warpBeams: [ beam({ id: 'a1', loom: '1' }), beam({ id: 'a2', loom: '2', date: '2026-09-05' }) ] });
    const d = app.computeBeamDetails();
    assert.equal(d.a1.finishedOn, null);
    assert.equal(d.a2.finishedOn, null);
  });

  test('a beam still counts the meters woven while it was on the loom', () => {
    const app = loadApp();
    app.setData({
      warpBeams: [ beam({ id: 'b1', date: '2026-09-01' }), beam({ id: 'b2', date: '2026-09-11' }) ],
      production: [ prod({ loom: '1', date: '2026-09-03', qty: 120, beam: 'b1' }), prod({ loom: '1', date: '2026-09-12', qty: 80, beam: 'b2' }) ],
    });
    const d = app.computeBeamDetails();
    closeTo(d.b1.woven, 120, 'beam 1 woven');
    closeTo(d.b2.woven, 80, 'beam 2 woven');
    closeTo(d.b1.shrinkage, 880, 'beam 1 shrinkage (length - woven)');
  });
});
