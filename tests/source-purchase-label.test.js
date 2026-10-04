'use strict';
/*
 * Source Purchase label: "Supplier Name - No. Of Cartons - Date - Day Name"
 * e.g. "AbuBakar - 50 Cartons - 03-09-2026 - Thursday". One helper (purchaseText in js/panels-daily.js)
 * builds it, and every place that shows a source purchase must go through it.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const panels = read('js/panels-daily.js');

function loadHelper(){
  const start = panels.indexOf('const DAY_NAMES');
  const end = panels.indexOf("// Warp purchases don't have a plain display name");
  assert.ok(start > 0 && end > start, 'helper block found');
  const core = read('js/core.js');
  const fmtDateSrc = core.slice(core.indexOf('const fmtDate = d =>'), core.indexOf('// Today\'s date as YYYY-MM-DD'));
  const ctx = vm.createContext({});
  vm.runInContext(fmtDateSrc + '\nconst fmtNum = n => Number(n).toLocaleString("en-US");\n' + panels.slice(start, end)
    + '\nthis.purchaseText = purchaseText; this.dayNameOf = dayNameOf;', ctx);
  return ctx;
}

describe('purchaseText', () => {
  const h = loadHelper();
  test('matches the requested example exactly', () => {
    assert.equal(h.purchaseText({ supplier: 'AbuBakar', cartons: 50, date: '2026-09-03' }),
      'AbuBakar - 50 Cartons - 03-09-2026 - Thursday');
  });
  test('day names follow the calendar (no timezone shift)', () => {
    assert.equal(h.dayNameOf('2026-10-05'), 'Monday');
    assert.equal(h.dayNameOf('2026-01-01'), 'Thursday');
    assert.equal(h.dayNameOf('2026-12-31'), 'Thursday');
    assert.equal(h.dayNameOf('2028-02-29'), 'Tuesday');
    assert.equal(h.dayNameOf(''), '—');
    assert.equal(h.dayNameOf('not a date'), '—');
  });
  test('older purchases without supplier or cartons show dashes instead of breaking', () => {
    assert.equal(h.purchaseText({ date: '2026-09-03', lbs: 900 }), '— - — Cartons - 03-09-2026 - Thursday');
    assert.equal(h.purchaseText({ supplier: '  ', cartons: 0, date: '2026-09-03' }), '— - — Cartons - 03-09-2026 - Thursday');
    assert.equal(h.purchaseText(null), '—');
  });
});

describe('every place that shows a source purchase uses the helper', () => {
  test('no old "date — type — amount" purchase labels remain', () => {
    assert.ok(!/fmtDate\(p\.date\)\} — /.test(panels), 'old select label gone');
    assert.ok(!/fmtDate\(r\.purchase\.date\)\} — /.test(panels), 'old summary label gone');
    assert.ok(!/fmtDate\(p\.date\)\} \(/.test(panels), 'old beam-log label gone');
  });
  test('select, three filters, beam log, yield panel, overview card and audit all call purchaseText', () => {
    const uses = (panels.match(/purchaseText\(/g) || []).length;
    assert.ok(uses >= 7, 'panels-daily.js: 6 call sites plus the definition, found ' + uses);
    assert.match(read('js/overview.js'), /purchaseText\(r\.purchase\)/);
    assert.match(read('js/audit.js'), /purchaseText\(pu\)/);
  });
});
