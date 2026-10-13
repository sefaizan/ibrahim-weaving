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
  test('totals, entries, days logged, and the all-looms average (sum of each loom\'s daily rate)', () => {
    assert.equal(s.meters, 300.5); assert.equal(s.entries, 3); assert.equal(s.days, 2); assert.equal(s.perDay, 75); // loom 1: 150 m over the 2 days since 1 Oct; loom 2 has one log so far
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
    const f = app.productionSummary(rows.filter(r => r.quality === 'Q44'), rows); assert.equal(f.meters, 50.5); assert.equal(f.days, 1);
  });
});

describe('the card on the Production page', () => {
  const src = read('js/panels-daily.js');
  test('is a collapsible summary card (starts collapsed: sumCardOpen only opens remembered keys)', () => {
    assert.match(src, /function productionSummaryCard[\s\S]*?sumCardOpen\('summary','Production Summary', badge\)[\s\S]*?sumCardClose\(\)/);
  });
  test('is fed the same filtered rows as the Production Log, just above it', () => {
    assert.match(src, /\$\{productionSummaryCard\(filteredProduction, qualityVal, fromVal, toVal, productionFilterHtml, loomVal\)\}\s*<div class="card"><h2>Production Log<\/h2>/);
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

describe('This Week / Last Week ranges follow the wage week (Friday to Thursday)', () => {
  // quickPeriodRange lives in core.js and uses currentWageWeek from calc.js, so lift just those two functions.
  const vm = require('node:vm');
  const core = read('js/core.js').match(/^function quickPeriodRange[\s\S]*?^}/m)[0];
  const calc = read('js/calc.js').match(/^function currentWageWeek[\s\S]*?^}/m)[0];
  const ctx = vm.createContext({ todayStr: () => '2026-10-14' });
  vm.runInContext(calc + '\n' + core + '\nthis.f = quickPeriodRange;', ctx);
  const range = (p, d) => JSON.parse(JSON.stringify(ctx.f(p, d)));
  test('mid-week (Wednesday)', () => {
    assert.deepEqual(range('this-week', '2026-10-14'), { from: '2026-10-09', to: '2026-10-15' });
    assert.deepEqual(range('last-week', '2026-10-14'), { from: '2026-10-02', to: '2026-10-08' });
  });
  test('Friday starts a new week; Thursday is its last day', () => {
    assert.deepEqual(range('this-week', '2026-10-09'), { from: '2026-10-09', to: '2026-10-15' });
    assert.deepEqual(range('this-week', '2026-10-15'), { from: '2026-10-09', to: '2026-10-15' });
    assert.deepEqual(range('this-week', '2026-10-16'), { from: '2026-10-16', to: '2026-10-22' });
  });
  test('weekend belongs to the week that began on Friday', () => {
    assert.deepEqual(range('this-week', '2026-10-10'), { from: '2026-10-09', to: '2026-10-15' });
    assert.deepEqual(range('this-week', '2026-10-11'), { from: '2026-10-09', to: '2026-10-15' });
  });
  test('crosses month and year ends', () => {
    assert.deepEqual(range('this-week', '2026-10-30'), { from: '2026-10-30', to: '2026-11-05' });
    assert.deepEqual(range('this-week', '2027-01-02'), { from: '2027-01-01', to: '2027-01-07' });
    assert.deepEqual(range('last-week', '2027-01-02'), { from: '2026-12-25', to: '2026-12-31' });
  });
  test('defaults to the app\'s own today when no date is passed', () => assert.deepEqual(JSON.parse(JSON.stringify(ctx.f('this-week'))), { from: '2026-10-09', to: '2026-10-15' }));
  test('existing periods unchanged', () => assert.deepEqual(range('this-month', '2026-10-14'), { from: '2026-10-01', to: '2026-10-31' }));
});

describe('By Loom average per day: days BETWEEN logs, not days with entries', () => {
  const L = (rs, all, range) => app.productionSummary(rs, all || rs, range).byLoom;
  const p = (date, loom, qty, quality) => prod({ date, loom, qty, quality: quality || 'Q50' });
  test('logged after 2 days: 200 m since the last log = 100 m/day', () => {
    const r = [p('2026-10-01', '1', 100), p('2026-10-03', '1', 200)];
    const l = L(r)[0]; assert.equal(l.days, 2); assert.equal(l.perDay, 100);
  });
  test('the first-ever entry is skipped (nothing before it to measure from)', () => {
    const l = L([p('2026-10-01', '1', 500), p('2026-10-03', '1', 200)])[0];
    assert.equal(l.perDay, 100); assert.equal(l.meters, 700);              // total still shows everything
  });
  test('uneven gaps: 2 days then 3 days', () => {
    const l = L([p('2026-10-01', '1', 999), p('2026-10-03', '1', 180), p('2026-10-06', '1', 300)])[0];
    assert.equal(l.days, 5); assert.equal(l.perDay, 96);                    // (180+300) / (2+3)
  });
  test('days after the last entry are never counted (today not logged yet)', () => {
    const r = [p('2026-10-01', '1', 100), p('2026-10-03', '1', 200)];
    assert.equal(L(r)[0].perDay, 100);                                     // same whether "today" is the 3rd or the 12th
  });
  test('two entries on one date are added together; the date counts once', () => {
    const l = L([p('2026-10-05', '3', 1), p('2026-10-07', '3', 80), p('2026-10-07', '3', 120)]).find(x => x.name === '3');
    assert.equal(l.days, 2); assert.equal(l.perDay, 100);
  });
  test('a loom with a single log has no average yet', () => {
    const l = L([p('2026-10-05', '9', 300)])[0]; assert.equal(l.days, 0); assert.equal(l.perDay, 0);
  });
  test('each loom is measured on its own log dates', () => {
    const l = L([p('2026-10-01', '1', 1), p('2026-10-03', '1', 200), p('2026-10-02', '2', 1), p('2026-10-03', '2', 90)]);
    assert.equal(l.find(x => x.name === '1').perDay, 100); assert.equal(l.find(x => x.name === '2').perDay, 90);
  });
  test('date filter: the log just before the range is still the starting point', () => {
    const all = [p('2026-10-01', '1', 100), p('2026-10-03', '1', 200), p('2026-10-06', '1', 300)];
    const inRange = all.filter(r => r.date >= '2026-10-03');
    const l = L(inRange, all, { from: '2026-10-03', to: '2026-10-31' })[0];
    assert.equal(l.days, 5); assert.equal(l.perDay, 100);                  // (200+300) / (2+3)
    const one = L(all.filter(r => r.date === '2026-10-03'), all, { from: '2026-10-03', to: '2026-10-03' })[0];
    assert.equal(one.days, 2); assert.equal(one.perDay, 100);
  });
  test('quality filter: days still come from all of the loom\'s logs, meters only from that quality', () => {
    const all = [p('2026-10-01', '1', 1, 'Q44'), p('2026-10-03', '1', 120, 'Q50'), p('2026-10-05', '1', 80, 'Q44')];
    const l = L(all.filter(r => r.quality === 'Q50'), all)[0];             // Q50 meters 120 over 2+2 days
    assert.equal(l.days, 4); assert.equal(l.perDay, 30);
  });
  test('the all-looms average is the sum of each loom\'s daily rate', () => {
    const r = [p('2026-10-01', '1', 1), p('2026-10-03', '1', 200), p('2026-10-02', '2', 1), p('2026-10-03', '2', 90)];
    assert.equal(app.productionSummary(r).perDay, 190);
  });
  test('only the loom table shows the Avg / Day column, with a note when there is nothing to average', () => {
    const src = read('js/panels-daily.js');
    assert.match(src, /table\('By Loom', sm\.byLoom, 'Loom', true\)/);
    assert.match(src, /table\('By Quality', sm\.byQuality, 'Quality'\)/);
    assert.match(src, /<th>Avg \/ Day<\/th>/); assert.match(src, /needs 2 logs/);
    assert.match(src, /productionSummary\(rows, DATA\.production, \{from: fromVal, to: toVal\}\)/);
  });
});

