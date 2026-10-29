'use strict';
/* Production > Multiple Entries (v3.19.4): per-employee totals above "Save all entries", own meters only (no Diff share). */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./helpers/load-app');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = loadApp();
const plain = a => JSON.parse(JSON.stringify(a));

describe('mbEmployeeTotals', () => {
  test('adds each employee across looms, in order of first appearance', () => {
    const t = app.mbEmployeeTotals([
      { name: 'Iftkhar', meters: 91 }, { name: 'Nawaz', meters: 78 },      // loom 1 (Gzana 169)
      { name: 'Iftkhar', meters: 60 }, { name: 'Nawaz', meters: 55 },      // loom 2
    ]);
    assert.deepEqual(plain(t), [{ name: 'Iftkhar', meters: 151 }, { name: 'Nawaz', meters: 133 }]);
  });
  test('a 3rd and a 4th employee are listed too; the same person in two slots is added together', () => {
    const t = app.mbEmployeeTotals([
      { name: 'A', meters: 40 }, { name: 'B', meters: 30 }, { name: 'C', meters: 20 }, { name: 'D', meters: 10 },
      { name: 'C', meters: 5 },
    ]);
    assert.deepEqual(plain(t), [{ name: 'A', meters: 40 }, { name: 'B', meters: 30 }, { name: 'C', meters: 25 }, { name: 'D', meters: 10 }]);
  });
  test('no Diff share: only the meters typed against each employee count', () => {
    // Gzana 100 with 40 + 30 typed leaves a Diff of 30 - it is NOT split into the employees' totals
    const t = app.mbEmployeeTotals([{ name: 'A', meters: 40 }, { name: 'B', meters: 30 }]);
    assert.equal(t.reduce((s, x) => s + x.meters, 0), 70);
  });
  test('blank names, empty or zero meters, and junk are ignored; nothing selected gives an empty list', () => {
    assert.deepEqual(plain(app.mbEmployeeTotals([{ name: '', meters: 50 }, { name: 'A', meters: 0 }, { name: 'B', meters: '' }, null, {}])), []);
    assert.deepEqual(plain(app.mbEmployeeTotals()), []);
  });
  test('sixteenths add up exactly', () => {
    assert.equal(app.mbEmployeeTotals([{ name: 'A', meters: 12.0625 }, { name: 'A', meters: 7.1875 }])[0].meters, 19.25);
  });
});

describe('the form shows it', () => {
  const panels = read('js/panels-daily.js'), wiring = read('js/wiring.js');
  test('a totals box sits right after the Total Gzana line, above Save all entries', () => {
    const i = panels.indexOf('id="mb_totals"'), j = panels.indexOf('id="mb_emp"'), k = panels.indexOf('id="saveMultiProduction"');
    assert.ok(i > 0 && j > i && k > j);
  });
  test('the totals are refreshed on every recalculation and use the 3rd / 4th slot only when they are shown', () => {
    assert.match(wiring, /empSlots\.push/); assert.match(wiring, /mbEmployeeTotals\(empSlots\)/);
    assert.match(wiring, /n===3 && !e3On\(c\)/); assert.match(wiring, /n===4 && !e4On\(c\)/);
  });
  test('Total Gzana / Assigned / Diff line is unchanged', () => {
    assert.match(wiring, /Total Gzana: \$\{fmtQtyMtr\(T\)\} · Assigned: \$\{fmtQtyMtr\(A\)\} · Diff:/);
  });
});
