'use strict';
/* Weft stock auto-correction (v3.19.15): a physical count scales the weft-use constant by (real use / app use). */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, closeTo } = require('./helpers/load-app.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const K = 0.0000354, USE = 5000 * K * 50 * 64;                      // 566.4 lbs for 5,000 m of a 50-pick quality at width 64
function ledger(cost){
  return { qualities: [{ id: 'q', name: 'Q', picks: 50, kangi: 60 }], clients: [],
    weft: [{ id: 'w1', date: '2026-11-01', time: '08:00', lbs: 2000, bags: 20, lbsPerBag: 100 }],
    production: [{ id: 'p1', date: '2026-11-10', loom: '1', quality: 'Q', qty: 5000 }],
    costSettings: cost || {} };
}
function app(cost){ const a = loadApp(); a.setToday('2026-11-10'); a.setData(ledger(cost)); return a; }

describe('weft auto-correction', () => {
  test('the estimate before any correction is bought - K x meters x picks x width', () => {
    closeTo(app().weftStockEstimate().lbs, 2000 - USE);
  });
  test('a count 10% below the app\'s use scales the constant by 0.9, and the drift is reported (app high, +)', () => {
    const a = app(), counted = 2000 - USE * 0.9;
    const c = a.weftCalibrationFor(counted);
    assert.equal(c.calibrated, true); closeTo(c.ratio, 0.9); closeTo(c.scale, 0.9);
    closeTo(c.driftPct, ((2000 - USE) - counted) / counted * 100);
    assert.ok(c.driftPct < 0);                                        // app showed less than counted: "low"
  });
  test('the stored factor is used by the estimate', () => {
    closeTo(app({ weftKScale: 0.9 }).weftStockEstimate().lbs, 2000 - USE * 0.9);
  });
  test('it keeps correcting from the current factor (0.9 then another -10% = 0.81)', () => {
    const a = app({ weftKScale: 0.9 });
    const c = a.weftCalibrationFor(2000 - USE * 0.81);
    closeTo(c.ratio, 0.9); closeTo(c.scale, 0.81);
  });
  test('not trusted: too little weft used (< 300 lbs), a wild ratio (typo), or no use at all', () => {
    const a = app();
    const tiny = loadApp(); tiny.setToday('2026-11-10'); const d = ledger(); d.production[0].qty = 1000; tiny.setData(d);
    assert.equal(tiny.weftCalibrationFor(1500).calibrated, false);          // only ~113 lbs used
    assert.equal(a.weftCalibrationFor(2000 - USE * 0.2).calibrated, false);   // ratio 0.2
    assert.equal(a.weftCalibrationFor(2000 - USE * 3).calibrated, false);     // ratio 3 (and below zero stock)
    assert.equal(a.weftCalibrationFor(2200).calibrated, false);               // counted more than was ever there
  });
  test('the factor stays inside 0.7 - 1.3, and an out-of-band stored value is ignored', () => {
    const a = app({ weftKScale: 0.72 });
    const c = a.weftCalibrationFor(2000 - USE * 0.72 * 0.6);                   // ratio 0.6 would give 0.432
    assert.equal(c.calibrated, true); closeTo(c.scale, 0.7);
    closeTo(app({ weftKScale: 5 }).weftScale(), 1);
    closeTo(app({ weftKScale: 0 }).weftScale(), 1);
  });
  test('the count is compared BEFORE it is saved, and the new factor is saved with it; the card shows the drift', () => {
    const o = read('js/overview.js');
    assert.match(o, /cal = weftCalibrationFor\(lbs\);/);
    assert.match(o, /if\(cal\.calibrated\) patch\.weftKScale = cal\.scale;/);
    assert.match(o, /driftPct/);
    assert.match(o, /Before that count the app had said/);
  });
});
