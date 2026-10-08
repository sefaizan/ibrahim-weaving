'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, prod } = require('./helpers/load-app');
const app = loadApp();
const base = () => ({ qualities: [{ name: 'Q50', picks: 50, kangi: 62 }, { name: 'Q44', picks: 44, kangi: 62 }],
  weft: [{ date: '2026-09-01', lbs: 1000, lbsPerBag: 100 }] });
describe('weft stock estimate', () => {
  test('44 picks uses 44/50 of the weft of 50 picks', () => {
    app.setData({ ...base(), production: [prod({ date: '2026-09-10', quality: 'Q50', qty: 1000 })] });
    const a = 1000 - app.weftStockEstimate().lbs;
    app.setData({ ...base(), production: [prod({ date: '2026-09-10', quality: 'Q44', qty: 1000 })] });
    const b = 1000 - app.weftStockEstimate().lbs;
    assert.ok(Math.abs(b / a - 44 / 50) < 1e-9);
  });
  test('a count resets the estimate; later purchases and production adjust it', () => {
    app.setData({ ...base(), production: [prod({ date: '2026-09-10', quality: 'Q50', qty: 1000 })],
      costSettings: { weftStockCount: { at: '2026-09-15 12:00', lbs: 500 } } });
    assert.equal(app.weftStockEstimate().lbs, 500);
    app.setData({ ...base(), weft: [...base().weft, { date: '2026-09-16', lbs: 200, lbsPerBag: 100 }], production: [],
      costSettings: { weftStockCount: { at: '2026-09-15 12:00', lbs: 500 } } });
    assert.equal(app.weftStockEstimate().lbs, 700);
  });
  test('alerts at 3 days of cover or fewer, by recent production pace, ignoring a shutdown gap', () => {
    const day = d => prod({ date: d, quality: 'Q50', qty: 1000 }); // ~113 lbs a day
    app.setData({ ...base(), weft: [{ date: '2026-06-01', lbs: 1000, lbsPerBag: 100 }], production: [day('2026-06-10'), day('2026-09-18')],
      costSettings: { weftStockCount: { at: '2026-09-18 23:00', lbs: 300 } } });
    const e = app.weftStockEstimate(); assert.ok(e.cover > 2.5 && e.cover < 2.8 && e.low);
    app.setData({ ...base(), production: [day('2026-09-18')], costSettings: { weftStockCount: { at: '2026-09-18 23:00', lbs: 600 } } });
    assert.equal(app.weftStockEstimate().low, false);
  });
  test('bags follow each purchase\'s own lbs per bag', () => {
    app.setData({ ...base(), weft: [{ date: '2026-09-01', lbs: 1000, lbsPerBag: 100 }, { date: '2026-09-05', lbs: 550, lbsPerBag: 110 }], production: [] });
    assert.equal(app.weftStockEstimate().bags, 15); // 5 bags of 110 + 10 bags of 100
    assert.equal(app.weftBagsToLbs(7), 750);        // newest 5 bags of 110 = 550, then 2 bags of 100 = 200
  });
});
