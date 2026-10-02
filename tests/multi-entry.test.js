'use strict';
/* Production page > Multiple Entries (v3.17.60): quick-button groups, card markup, cursor order, save rules, permissions. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const panels = read('js/panels-daily.js'), wiring = read('js/wiring.js'), core = read('js/core.js');

// The Multiple Entries helpers (and loomAssignmentFor) run unchanged, with small stand-ins for the page's own helpers.
const block = panels.slice(panels.indexOf('/* v3.17.60'), panels.indexOf('function productionPanel'));
const lam = panels.match(/function loomAssignmentFor[\s\S]*?\n}\n/)[0];
function load(data) {
  const ctx = vm.createContext({ DATA: data, escHtml: s => String(s), todayStr: () => '2026-10-03',
    field: (l, id) => `<input id="${id}">`, selectField: (l, id) => `<select id="${id}"></select>`,
    formToggleBtn: () => '', formBodyOpen: () => '' });
  vm.runInContext(lam + block + '\nthis.api={mbRangeLabel,mbGroups,mbLoomList,mbCardHtml,multiEntryCardHtml};', ctx);
  return ctx.api;
}
const L = (...n) => n.map(name => ({ id: 'l' + name, name }));
const pair = (loom, e1, e2) => ({ loom, e1, e2 });

describe('quick buttons follow Loom Assignments', () => {
  test('two pairs give two buttons with their ranges', () => {
    const api = load({ employees: [], looms: L('1', '2', '3', '9', '10'),
      loomAssignments: [pair('1', 'Iftkhar', 'Nawaz'), pair('2', 'Iftkhar', 'Nawaz'), pair('3', 'Iftkhar', 'Nawaz'), pair('9', 'Gafar', 'Riaz'), pair('10', 'Gafar', 'Riaz')] });
    assert.deepEqual(Array.from(api.mbGroups(), g => g.label), ['Iftkhar + Nawaz (1–3)', 'Gafar + Riaz (9–10)']);
  });
  test('three pairs (1-6, 7-12, 13-20) need no code change', () => {
    const nums = Array.from({ length: 20 }, (_, i) => String(i + 1));
    const who = n => (n <= 6 ? ['A', 'B'] : n <= 12 ? ['C', 'D'] : ['E', 'F']);
    const api = load({ employees: [], looms: L(...nums), loomAssignments: nums.map(n => pair(n, ...who(+n))) });
    assert.deepEqual(Array.from(api.mbGroups(), g => g.label), ['A + B (1–6)', 'C + D (7–12)', 'E + F (13–20)']);
  });
  test('looms without a pair go under Unassigned, last; gaps show as separate ranges', () => {
    const api = load({ employees: [], looms: L('1', '2', '4', '7'), loomAssignments: [pair('1', 'A', 'B'), pair('2', 'A', 'B'), pair('4', 'A', 'B')] });
    assert.deepEqual(Array.from(api.mbGroups(), g => g.label), ['A + B (1–2, 4)', 'Unassigned (7)']);
  });
  test('a single employee pair label and non-numeric loom names still work', () => {
    const api = load({ employees: [], looms: L('A', 'B'), loomAssignments: [pair('A', 'Solo', '')] });
    assert.deepEqual(Array.from(api.mbGroups(), g => g.label), ['Solo (A)', 'Unassigned (B)']);
  });
});

describe('loom cards', () => {
  const data = { employees: [{ name: 'Gafar' }, { name: 'Riaz' }, { name: 'Old', active: false }], looms: L('10', '9', '2'), loomAssignments: [pair('9', 'Gafar', 'Riaz')] };
  test('looms are listed in numeric order, not text order', () => assert.deepEqual(Array.from(load(data).mbLoomList()), ['2', '9', '10']));
  test('names default from the loom assignment; inactive employees are not offered', () => {
    const html = load(data).mbCardHtml('9');
    assert.match(html, /<option selected>Gafar<\/option>/); assert.match(html, /<option selected>Riaz<\/option>/);
    assert.doesNotMatch(html, /Old/);
  });
  test('cursor order: Gzana meters, sixteenths, Employee 1, Employee 2, Employee 3; names and the add button are skipped', () => {
    const html = load(data).mbCardHtml('9');
    const order = [...html.matchAll(/class="(mb_[gsm]\d?) mb_f"/g)].map(m => m[1]);
    assert.deepEqual(order, ['mb_g', 'mb_s', 'mb_m1', 'mb_m2', 'mb_m3']);
    assert.equal((html.match(/tabindex="-1"/g) || []).length, 4); // 3 name dropdowns + the add-third button
  });
  test('the sixteenths box has no "/16" watermark and sits after a line, not dashes', () => {
    const html = load(data).mbCardHtml('9');
    assert.doesNotMatch(html, /placeholder="\/16"/); assert.match(html, /class="mb-line"/); assert.doesNotMatch(html, /---/);
  });
  test('the card sits on the Production page, above Bulk Import', () => {
    assert.ok(panels.indexOf('${multiEntryCardHtml()}') < panels.indexOf('<h2>Bulk Import</h2>'));
    assert.ok(panels.indexOf('${multiEntryCardHtml()}') > panels.indexOf('id="addProduction"'));
  });
});

describe('Gzana, Employee 2 and Diff arithmetic (same helper as Log Production)', () => {
  const ctx = vm.createContext({}); vm.runInContext(core.match(/function combineMtr16[\s\S]*?\n}\n/)[0] + '\nthis.c=combineMtr16;', ctx);
  const diff = (g, s, ...e) => Math.round((ctx.c(g, s) - e.reduce((a, b) => a + b, 0)) * 16) / 16;
  test('sheet row: 169 = 91 + 78 leaves no diff', () => assert.equal(diff(169, 0, 91, 78), 0));
  test('leftover sixteenths show as the diff (169 and 3/16 less 91 and 78 = 3/16)', () => assert.equal(diff(169, 3, 91, 78), 3 / 16));
  test('a third employee is part of the diff', () => assert.equal(diff(100, 0, 40, 30, 30), 0));
  test('employees above Gzana give a negative diff', () => assert.ok(diff(100, 0, 60, 50) < 0));
});

describe('save rules and wiring', () => {
  const from = wiring.indexOf("document.getElementById('saveMultiProduction').onclick");
  const save = wiring.slice(from, wiring.indexOf('Saved ${recs.length}', from));
  test('needs date, quality, at least one loom, a total and Employee 1; blocks employees above Gzana', () => {
    ['Pick the date first.', 'Pick a quality first.', 'Tick at least one loom.', 'enter the Gzana', 'pick Employee 1', 'exceed the Gzana'].forEach(m => assert.ok(save.includes(m), m));
  });
  test('each loom becomes an ordinary production record (qty, e1-e3, meters) and the whole batch saves once', () => {
    assert.match(save, /DATA\.production\.push\(\{id:uid\(\), \.\.\.r\}\)/);
    ['qty:t', 'e1:', 'e1m:0', 'e2:', 'e2m:0', 'e3:', 'e3m:0', "beam:''"].forEach(k => assert.ok(save.includes(k), k));
    assert.equal((save.match(/await save\(\)/g) || []).length, 1);
  });
  test('the total is built with combineMtr16, so sixteenths are stored as fractions', () => assert.match(wiring, /combineMtr16\(q\(c,'\.mb_g'\)\.value, q\(c,'\.mb_s'\)\.value\)/));
  test('nothing is written to DATA before every loom has passed validation', () => assert.ok(save.indexOf('recs.forEach') > save.indexOf("exceed the Gzana")));
  test('Employee 2 auto-fill stops once typed by hand or when a third employee is added', () => assert.match(wiring, /m2\.dataset\.man \|\| e3On\(c\)/));
  test('the save button follows the Production add permission', () => assert.match(read('js/view-only.js'), /saveMultiProduction: \['production', 'a'\]/));
  test('the form body is hidden on view-only phones with the other forms (.form-actions)', () => assert.match(panels, /class="form-actions"><button class="primary" id="saveMultiProduction"/));
});
