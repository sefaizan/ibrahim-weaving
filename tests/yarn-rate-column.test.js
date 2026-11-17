'use strict';
/* Warp and weft log tables show Rate / lb (v3.19.13). */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'panels-daily.js'), 'utf8');
const core = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');

describe('rate per lb in the yarn logs', () => {
  test('both log tables have a Rate / lb column between Weight and Amount, filled by yarnRateCell', () => {
    assert.match(src, /'Cartons','Weight \(lbs\)','Rate \/ lb','Amount',''\]/);
    assert.match(src, /'Bags','Weight \(lbs\)','Rate \/ lb','Amount',''\]/);
    assert.equal((src.match(/fmtNum\(r\.lbs\), yarnRateCell\(r\), fmtRs\(r\.amount\)/g) || []).length, 2);
  });
  test('the cell shows the saved rate, falls back to amount / lbs for an old entry, and a dash when there is nothing', () => {
    const fmtRateN = new Function(core.match(/const fmtRateN = n => [^\n]+/)[0] + '; return fmtRateN;')();
    const yarnRateCell = new Function('fmtRateN', src.match(/function yarnRateCell\(r\)\{[\s\S]*?\n\}/)[0] + '; return yarnRateCell;')(fmtRateN);
    assert.equal(yarnRateCell({ lbs: 100, rate: 412.5, amount: 41250 }), 'Rs 412.50');
    assert.equal(yarnRateCell({ lbs: 200, amount: 80000 }), 'Rs 400.00');
    assert.equal(yarnRateCell({ lbs: 0, amount: 0 }), '\u2014');
  });
});
