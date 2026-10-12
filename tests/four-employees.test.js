'use strict';
/* v3.18.89+: a production entry can have up to FOUR employees (the fourth is optional and opens only after the third).
   Entries without a fourth employee behave exactly as before. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, prod, closeTo } = require('./helpers/load-app');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = loadApp();
const setup = rows => app.setData({ qualities: [{ name: 'Q' }], employees: ['A','B','C','D'].map(n => ({ id: n, name: n })),
  wageRateHistory: { Q: [{ date: '2026-01-01', rate: 10 }] }, production: rows });

describe('wages with four employees', () => {
  test('each employee gets their own meters; the leftover is shared by all FOUR', () => {
    setup([prod({ qty: 100.5, e1: 'A', e1m: 40, e2: 'B', e2m: 30, e3: 'C', e3m: 20, e4: 'D', e4m: 10 })]);
    const w = n => app.computeWageMeters(n, 'Q', null, null);
    assert.equal(w('D').own, 10);
    ['A','B','C','D'].forEach(n => closeTo(w(n).diffShare, 0.5 / 4, n));
    closeTo(w('D').wages, (10 + 0.125) * 10, 'D wages');
  });
  test('nothing is lost or counted twice: the four totals add up to the quantity', () => {
    setup([prod({ qty: 100.5, e1: 'A', e1m: 40, e2: 'B', e2m: 30, e3: 'C', e3m: 20, e4: 'D', e4m: 10 })]);
    const sum = ['A','B','C','D'].reduce((t, n) => t + app.computeWageMeters(n, 'Q', null, null).total, 0);
    closeTo(sum, 100.5, 'sum');
  });
  test('an entry with three employees (no fourth) is shared by three, exactly as before', () => {
    setup([prod({ qty: 100.5, e1: 'A', e1m: 60, e2: 'B', e2m: 25, e3: 'C', e3m: 15 })]);
    ['A','B','C'].forEach(n => closeTo(app.computeWageMeters(n, 'Q', null, null).diffShare, 0.5 / 3, n));
    assert.equal(app.computeWageMeters('D', 'Q', null, null).own, 0);
  });
});

describe('production summary and the automatic split', () => {
  test('the summary credits the fourth employee', () => {
    const s = app.productionSummary([prod({ qty: 100, e1: 'A', e1m: 40, e2: 'B', e2m: 30, e3: 'C', e3m: 20, e4: 'D', e4m: 10 })]);
    assert.deepEqual(Object.fromEntries(s.byEmployee.map(e => [e.name, e.meters])), { A: 40, B: 30, C: 20, D: 10 });
  });
  test('Employee 2 keeps what is left after Employee 1 and the typed meters of Employees 3 and 4', () => {
    assert.equal(app.entryEmployee2Meters(100, 40, 20 + 10), 30);
    assert.equal(app.entryEmployee2Meters(100, 90, 20 + 10), null);
  });
  test('renaming an employee also renames them on the fourth slot', () => {
    assert.match(read('js/shell.js'), /\['production','e3'\], \['production','e4'\]/);
  });
});

describe('the forms', () => {
  const panels = read('js/panels-daily.js'), wiring = read('js/wiring.js');
  test('Log Production has an Employee 4 row and a button that only appears once Employee 3 is open', () => {
    assert.match(panels, /id="p_e4wrap"/); assert.match(panels, /id="p_toggleE4"[^>]*display:none/);
    assert.match(wiring, /e4btn\.style\.display = e3Open \? '' : 'none'/);
    assert.match(wiring, /e3btn\.style\.display = \(need && !e4Open\)/);                 // the third is removed only after the fourth
  });
  test('Employee 4 is only saved when there is one (other entries are stored exactly as before)', () => {
    assert.match(wiring, /if\(v\('p_e4'\) \|\| \(old && old\.e4\)\)\{ rec\.e4 = v\('p_e4'\)/);
    assert.doesNotMatch(wiring, /e3:v\('p_e3'\), e3m:Number\(v\('p_e3m'\)\|\|0\), e4:/);
  });
  test('Remaining-to-assign and the automatic split count Employee 4 only while it is open', () => {
    assert.match(wiring, /e4wrap\.style\.display !== 'none' \? Number\(v\('p_e4m'\)\|\|0\) : 0/);
    assert.match(wiring, /Number\(v\('p_e3m'\)\|\|0\) \+ \(e4wrap\.style\.display !== 'none'/);
  });
  test('Editing an entry opens Employee 3 and 4 when they are filled', () => {
    assert.match(wiring, /p_e4:'e4',p_e4m:'e4m'/); assert.match(wiring, /if\(v\('p_e4'\)\)\{ showE4\(\);/);
  });
  test('Multiple Entries cards have an Employee 4 row, opened after Employee 3', () => {
    assert.match(panels, /class="mb-e4" style="display:none"/); assert.match(panels, /class="ghost mb-tg4"/);
    assert.match(wiring, /for\(const n of \(e4On\(c\)\?\[1,2,3,4\]:e3On\(c\)\?\[1,2,3\]:\[1,2\]\)\)/);
  });
  test('Bulk Import takes up to four employee/meters pairs and refuses more (nothing is silently dropped)', () => {
    assert.match(panels, /Employee3, Meters3\[, Employee4, Meters4\]\]\]/);
    assert.match(wiring, /at most 4 employees per loom/); assert.match(wiring, /\.\.\.\(empPairs\[3\] \? \{e4: empPairs\[3\]\[0\], e4m: empPairs\[3\]\[1\]\} : \{\}\)/);
  });
  test('The Production Log shows an Emp 4 column only when a shown entry has a fourth employee', () => {
    assert.match(panels, /function prodLogHead\(head, rows\)/);
    assert.match(panels, /prodLogHead\(\['Date','Time','Loom','Quality','Qty','Beam','Emp 1','Emp 2','Emp 3','Diff',''\], filteredProduction\)/);
  });
  test('Urdu has the new labels', () => {
    const i = read('js/i18n.js');
    ['Employee 4', 'Employee 4 Meters', '+ Add a fourth employee', '− Remove fourth employee', 'Emp 4'].forEach(k => assert.ok(i.includes("'" + k + "':"), k));
  });
  test('Multiple Entries: the Employee 4 row is sized like rows 1-3 (name box wide, meters box beside it)', () => {
    const css = read('index.html');
    assert.match(css, /\.mb-rw input\.mb_m3,\.mb-rw input\.mb_m4\{flex:1 1 30%;min-width:0\}/);
    assert.match(css, /\.mb-tg,\.mb-tg4\{margin-top:6px\}/);
  });
});
