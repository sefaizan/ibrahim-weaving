'use strict';
/* Production Summary card (Production page): collapsed by default, follows the Production Log filters. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, prod } = require('./helpers/load-app');
const app = loadApp();
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const rows = [
  prod({ date: '2026-10-01', quality: 'Q50', loom: '1', qty: 100, e1: 'Riaz', e1m: 60, e2: 'Gafar', e2m: 40 }),
  prod({ date: '2026-10-01', quality: 'Q44', loom: '2', qty: 50.5, e1: 'Riaz', e1m: 50.5 }),
  prod({ date: '2026-10-03', quality: 'Q50', loom: '1', qty: 150, e1: 'Gafar', e1m: 150 }),
];

describe('productionSummary', () => {
  const s = app.productionSummary(rows);
  test('totals, entries, distinct days and average per day', () => {
    assert.equal(s.meters, 300.5); assert.equal(s.entries, 3); assert.equal(s.days, 2); assert.equal(s.perDay, 150.25);
  });
  test('by quality, biggest first', () => {
    assert.deepEqual(s.byQuality.map(r => [r.name, r.meters, r.entries]), [['Q50', 250, 2], ['Q44', 50.5, 1]]);
  });
  test('by loom', () => assert.deepEqual(s.byLoom.map(r => [r.name, r.meters, r.entries]), [['1', 250, 2], ['2', 50.5, 1]]));
  test('by employee uses the meters credited to each person', () => {
    assert.deepEqual(s.byEmployee.map(r => [r.name, r.meters, r.entries]), [['Gafar', 190, 2], ['Riaz', 110.5, 2]]);
  });
  test('empty or missing rows are safe', () => {
    const e = app.productionSummary([]); assert.equal(e.meters, 0); assert.equal(e.perDay, 0); assert.equal(e.byQuality.length, 0);
    assert.equal(app.productionSummary(null).entries, 0);
  });
  test('a filtered subset gives a filtered summary', () => {
    const f = app.productionSummary(rows.filter(r => r.quality === 'Q44')); assert.equal(f.meters, 50.5); assert.equal(f.days, 1);
  });
});

describe('the card on the Production page', () => {
  const src = read('js/panels-daily.js');
  test('is a collapsible summary card (starts collapsed: sumCardOpen only opens remembered keys)', () => {
    assert.match(src, /function productionSummaryCard[\s\S]*?sumCardOpen\('summary','Production Summary', badge\)[\s\S]*?sumCardClose\(\)/);
  });
  test('is fed the same filtered rows as the Production Log, just above it', () => {
    assert.match(src, /\$\{productionSummaryCard\(filteredProduction, qualityVal, fromVal, toVal, productionFilterHtml\)\}\s*<div class="card"><h2>Production Log<\/h2>/);
  });
  test('a fresh launch has nothing remembered open', () => {
    assert.match(read('js/core.js'), /let OPEN_SUMMARIES = new Set\(\);/);
  });
});

describe('the filters live inside the summary card', () => {
  const src = read('js/panels-daily.js');
  test('quality, week / month / year chips and a custom date range are all there', () => {
    const f = src.match(/const productionFilterHtml = `([\s\S]*?)`;\n/)[1];
    for (const id of ['pf_quality', 'pf_chips', 'pf_from', 'pf_to', 'pf_custom']) assert.ok(f.includes('id="' + id + '"'), id);
    for (const p of ['', 'this-week', 'last-week', 'this-month', 'last-month', 'this-year', 'custom']) assert.ok(f.includes('data-period="' + p + '"'), 'chip ' + p);
  });
  test('the log card no longer carries its own copy (ids would clash)', () => {
    assert.equal((src.match(/id="pf_quality"/g) || []).length, 1);
  });
  test('a "Filtered" badge shows on the collapsed header', () => assert.match(src, /<b>Filtered<\/b>/));
});

describe('This Week / Last Week ranges (Monday to Sunday)', () => {
  // quickPeriodRange lives in core.js (not loaded by the calc helper), so lift just that function.
  const fnSrc = read('js/core.js').match(/^function quickPeriodRange[\s\S]*?^}/m)[0];
  const ctx = require('node:vm').createContext({}); require('node:vm').runInContext(fnSrc + '\nthis.f = quickPeriodRange;', ctx);
  const range = (p, d) => JSON.parse(JSON.stringify(ctx.f(p, d)));
  test('mid-week', () => {
    assert.deepEqual(range('this-week', '2026-10-14'), { from: '2026-10-12', to: '2026-10-18' });
    assert.deepEqual(range('last-week', '2026-10-14'), { from: '2026-10-05', to: '2026-10-11' });
  });
  test('Sunday belongs to the week that started the Monday before', () => {
    assert.deepEqual(range('this-week', '2026-10-11'), { from: '2026-10-05', to: '2026-10-11' });
  });
  test('Monday starts a new week', () => assert.deepEqual(range('this-week', '2026-10-12'), { from: '2026-10-12', to: '2026-10-18' }));
  test('crosses month and year ends', () => {
    assert.deepEqual(range('this-week', '2026-12-31'), { from: '2026-12-28', to: '2027-01-03' });
    assert.deepEqual(range('last-week', '2027-01-05'), { from: '2026-12-28', to: '2027-01-03' });
  });
  test('existing periods unchanged', () => assert.deepEqual(range('this-month', '2026-10-14'), { from: '2026-10-01', to: '2026-10-31' }));
});
