'use strict';
/*
 * Beam forecast: which beam runs out next, and when. "Today" in these tests is 20 Sep 2026.
 * Every expectation below was worked out by hand from the rules in js/calc.js:
 *   rate      = meters woven on the beam over its last <= 7 days (days off count as 0) / those days
 *   remaining = logged length x (median share of length your last finished beams actually wove) - woven
 *   days left = remaining / rate
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, prod, closeTo } = require('./helpers/load-app');

const beam = (o) => ({ id: 'b1', date: '2026-09-10', time: '08:00', loom: '1', warpType: 'Micro', length: 1000, ...o });
// one entry per day from..to (inclusive, same month), qty each
const daily = (loom, fromDay, toDay, qty, extra) => {
  const out = [];
  for (let d = fromDay; d <= toDay; d++) out.push(prod({ loom, date: `2026-09-${String(d).padStart(2, '0')}`, qty, ...(extra || {}) }));
  return out;
};
const only = (list) => { assert.equal(list.length, 1); return list[0]; };

describe('forecast for a running beam', () => {
  test('100 m/day for a week with 300 m left = about 3 days, ending on 23 Sep', () => {
    const app = loadApp();
    app.setData({ warpBeams: [beam()], production: daily('1', 14, 20, 100) });   // 7 x 100 = 700 woven
    const f = only(app.computeBeamForecasts(3));
    closeTo(f.woven, 700, 'woven');
    closeTo(f.remaining, 300, 'remaining');
    closeTo(f.rate, 100, 'rate');
    closeTo(f.daysLeft, 3, 'days left');
    assert.equal(f.finishDate, '2026-09-23');
    assert.equal(f.state, 'ending');
  });

  test('the "ending" threshold is the one you pass in', () => {
    const app = loadApp();
    app.setData({ warpBeams: [beam()], production: daily('1', 14, 20, 100) });
    assert.equal(only(app.computeBeamForecasts(2)).state, 'soon');     // 3 days left is not <= 2
    assert.equal(only(app.computeBeamForecasts(5)).state, 'ending');
  });

  test('a beam only a few days old averages over the days it has actually run', () => {
    const app = loadApp();
    app.setData({
      warpBeams: [beam({ date: '2026-09-18' })],
      production: [prod({ loom: '1', date: '2026-09-18', qty: 90 }), prod({ loom: '1', date: '2026-09-19', qty: 110 }), prod({ loom: '1', date: '2026-09-20', qty: 100 })],
    });
    const f = only(app.computeBeamForecasts(3));
    assert.equal(f.basisDays, 3);
    closeTo(f.rate, 100, 'rate');           // 300 m over 3 days, not over 7
    closeTo(f.daysLeft, 7, 'days left');    // 700 m left
    assert.equal(f.state, 'soon');
    assert.equal(f.finishDate, '2026-09-27');
  });

  test('days off count as zero output', () => {
    const app = loadApp();
    // 100 m on 14-18 Sep only; nothing on 19 and 20. Window = 12-18 Sep (7 days) -> 500/7 per day
    app.setData({ warpBeams: [beam({ date: '2026-09-01', length: 2000 })], production: daily('1', 14, 18, 100) });
    const f = only(app.computeBeamForecasts(3));
    assert.equal(f.basisDays, 7);
    closeTo(f.rate, 500 / 7, 'rate');
    closeTo(f.daysLeft, 1500 / (500 / 7), 'days left');   // 21 days
    assert.equal(f.state, 'ok');
  });

  test('several entries on the same day add together', () => {
    const app = loadApp();
    app.setData({
      warpBeams: [beam({ date: '2026-09-20' })],
      production: [prod({ loom: '1', date: '2026-09-20', qty: 60 }), prod({ loom: '1', date: '2026-09-20', qty: 40 })],
    });
    const f = only(app.computeBeamForecasts(3));
    closeTo(f.rate, 100, 'rate');           // 1 day, 100 m
    closeTo(f.daysLeft, 9, 'days left');    // 900 m left
  });
});

describe('when there is nothing to forecast from', () => {
  test('no output for more than 3 days: idle, no forecast (and flagged low when under 300 m left)', () => {
    const app = loadApp();
    // last output 10 Sep = 10 days ago; 800 of 1000 woven
    app.setData({ warpBeams: [beam({ date: '2026-09-01' })], production: daily('1', 5, 10, 800 / 6 * 1) });
    const f = only(app.computeBeamForecasts(3));
    assert.equal(f.state, 'idle');
    assert.equal(f.rate, null);
    assert.equal(f.daysLeft, null);
    assert.equal(f.lastDay, '2026-09-10');
    assert.equal(f.low, true);
  });

  test('a beam with no output logged yet', () => {
    const app = loadApp();
    app.setData({ warpBeams: [beam()], production: [] });
    const f = only(app.computeBeamForecasts(3));
    assert.equal(f.state, 'nodata');
    assert.equal(f.low, false);
  });

  test('a fully woven beam is reported as full, not as a future date', () => {
    const app = loadApp();
    app.setData({ warpBeams: [beam({ date: '2026-09-18' })], production: daily('1', 18, 20, 350) });   // 1050 of 1000
    const f = only(app.computeBeamForecasts(3));
    assert.equal(f.state, 'full');
    assert.equal(f.daysLeft, 0);
    assert.equal(f.remaining, 0);
  });

  test('finished beams and beams with no length are left out', () => {
    const app = loadApp();
    app.setData({
      warpBeams: [
        beam({ id: 'old', date: '2026-09-01' }),                                       // replaced by 'new' below
        beam({ id: 'new', date: '2026-09-15' }),
        beam({ id: 'zero', loom: '2', length: 0 }),
        beam({ id: 'done', loom: '3', finished: true, finishedDate: '2026-09-12' }),   // marked finished by hand
      ],
      production: daily('1', 15, 20, 100),
    });
    const list = app.computeBeamForecasts(3);
    assert.deepEqual(list.map(f => f.id), ['new']);
  });
});

describe('how much of its length a beam usually yields', () => {
  // loom 1 runs A -> B -> C. A wove 960 of 1000 and B 980 of 1000, so beams end at 97% (median of .96 and .98)
  const threeBeams = (a, b) => ({
    warpBeams: [
      beam({ id: 'A', date: '2026-09-01' }), beam({ id: 'B', date: '2026-09-08' }), beam({ id: 'C', date: '2026-09-14' }),
    ],
    production: [
      prod({ loom: '1', date: '2026-09-05', qty: a }), prod({ loom: '1', date: '2026-09-10', qty: b }),
      ...daily('1', 14, 20, 100),                       // C: 700 woven
    ],
  });

  test('two finished beams set the expected share (median), so the beam is expected to end at 97%', () => {
    const app = loadApp();
    app.setData(threeBeams(960, 980));
    const f = only(app.computeBeamForecasts(3));
    closeTo(f.yieldRatio, 0.97, 'yield ratio');
    assert.equal(f.yieldBasis, 2);
    closeTo(f.expectedRemaining, 270, 'expected remaining (970 - 700)');
    closeTo(f.remaining, 300, 'plain remaining is still length - woven');
    closeTo(f.daysLeft, 2.7, 'days left');
    assert.equal(f.finishDate, '2026-09-23');            // 20 Sep + round(2.7) days
  });

  test('with only one finished beam it assumes the full logged length', () => {
    const app = loadApp();
    const d = threeBeams(960, 980);
    d.warpBeams = d.warpBeams.slice(1);                  // drop beam A: only B is finished
    d.production = d.production.filter(r => r.date !== '2026-09-05');
    app.setData(d);
    const f = only(app.computeBeamForecasts(3));
    assert.equal(f.yieldRatio, 1);
    assert.equal(f.yieldBasis, 0);
    closeTo(f.expectedRemaining, 300, 'expected remaining');
  });

  test('an absurdly low past yield is held at 50% instead of predicting an instant finish', () => {
    const app = loadApp();
    app.setData(threeBeams(200, 200));
    const f = only(app.computeBeamForecasts(3));
    assert.equal(f.yieldRatio, 0.5);
    closeTo(f.expectedRemaining, 0, 'expected remaining (500 - 700, floored at 0)');
    assert.equal(f.state, 'full');
  });
});

describe('several looms', () => {
  test('most urgent first: fully woven, then fewest days left, then looms that have stopped (low ones first)', () => {
    const app = loadApp();
    app.setData({
      warpBeams: [
        beam({ id: 'ok', loom: '1', date: '2026-09-01', length: 5000 }),
        beam({ id: 'idleLow', loom: '2', date: '2026-09-01' }),
        beam({ id: 'ending', loom: '3', date: '2026-09-14' }),
        beam({ id: 'full', loom: '4', date: '2026-09-18' }),
      ],
      production: [
        ...daily('1', 14, 20, 100),                   // 700 of 5000, ~43 days left
        ...daily('2', 2, 6, 160),                     // 800 of 1000, last output 6 Sep: idle, 200 left
        ...daily('3', 14, 20, 100),                   // 700 of 1000: 3 days left
        ...daily('4', 18, 20, 400),                   // 1200 of 1000
      ],
    });
    assert.deepEqual(app.computeBeamForecasts(3).map(f => f.id), ['full', 'ending', 'ok', 'idleLow']);
  });
});

describe('alert wording', () => {
  test('a beam a few days out, tomorrow, today, and fully woven', () => {
    const app = loadApp();
    const f = (o) => ({ loom: '3', state: 'ending', daysLeft: 3, expectedRemaining: 300, ...o });
    assert.equal(app.beamAlertText(f()), 'Loom 3 beam ends in about 3 days (~300 m left)');
    assert.equal(app.beamAlertText(f({ daysLeft: 1.2, expectedRemaining: 118.4 })), 'Loom 3 beam ends tomorrow (~118 m left)');
    assert.equal(app.beamAlertText(f({ daysLeft: 0.3, expectedRemaining: 41 })), 'Loom 3 beam ends today (~41 m left)');
    assert.equal(app.beamAlertText(f({ state: 'full', daysLeft: 0 })), 'Loom 3 beam is fully woven — chain the next beam or mark it finished');
  });

  test('one beam reads in full; several collapse into one short line', () => {
    const app = loadApp();
    const a = { loom: '1', state: 'ending', daysLeft: 3, expectedRemaining: 300 };
    const b = { loom: '2', state: 'ending', daysLeft: 1.2, expectedRemaining: 100 };
    const c = { loom: '5', state: 'full', daysLeft: 0, expectedRemaining: 0 };
    assert.equal(app.beamAlertSummary([]), '');
    assert.equal(app.beamAlertSummary([a]), '⚠ Loom 1 beam ends in about 3 days (~300 m left)');
    assert.equal(app.beamAlertSummary([a, b, c]), '⚠ 3 beams ending soon: Loom 1 (~3 days), Loom 2 (tomorrow), Loom 5 (fully woven)');
  });
});
