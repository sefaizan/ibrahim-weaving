'use strict';
/*
 * Source Purchase label: "Supplier Name - Warp Type - No. Of Cartons - Date - N days ago"
 * e.g. "AbuBakar - Micro - 50 Cartons - 03-09-2026 - 3 days ago". One helper (purchaseText in js/panels-daily.js)
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
  const start = panels.indexOf('function daysAgoText');
  const end = panels.indexOf("// Warp purchases don't have a plain display name");
  assert.ok(start > 0 && end > start, 'helper block found');
  const core = read('js/core.js');
  const fmtDateSrc = core.slice(core.indexOf('const fmtDate = d =>'), core.indexOf('// Today\'s date as YYYY-MM-DD'));
  const ctx = vm.createContext({});
  vm.runInContext(fmtDateSrc + '\nvar __today = "2026-09-06"; var todayStr = () => __today;\nconst fmtNum = n => Number(n).toLocaleString("en-US");\n' + panels.slice(start, end)
    + '\nthis.purchaseText = purchaseText; this.daysAgoText = daysAgoText; this.setToday = d => { __today = d; };', ctx);
  return ctx;
}

describe('purchaseText', () => {
  const h = loadHelper();
  test('matches the requested example (today is 06-09-2026, purchase 03-09-2026)', () => {
    h.setToday('2026-09-06');
    assert.equal(h.purchaseText({ supplier: 'AbuBakar', type: 'Micro', cartons: 50, date: '2026-09-03' }),
      'AbuBakar - Micro - 50 Cartons - 03-09-2026 - 3 days ago');
  });
  test('today, yesterday, many days, across month and year ends', () => {
    h.setToday('2026-09-06');
    assert.equal(h.daysAgoText('2026-09-06'), 'Today');
    assert.equal(h.daysAgoText('2026-09-05'), '1 day ago');
    assert.equal(h.daysAgoText('2026-08-07'), '30 days ago');
    h.setToday('2027-01-02');
    assert.equal(h.daysAgoText('2026-12-30'), '3 days ago');
    h.setToday('2028-03-01');
    assert.equal(h.daysAgoText('2028-02-28'), '2 days ago');   // leap year: 29 Feb in between
  });
  test('a future date and bad dates do not break the label', () => {
    h.setToday('2026-09-06');
    assert.equal(h.daysAgoText('2026-09-07'), 'In 1 day');
    assert.equal(h.daysAgoText('2026-09-10'), 'In 4 days');
    assert.equal(h.daysAgoText(''), '—');
    assert.equal(h.daysAgoText('not a date'), '—');
  });
  test('older purchases without supplier, type or cartons show dashes instead of breaking', () => {
    h.setToday('2026-09-06');
    assert.equal(h.purchaseText({ date: '2026-09-03', lbs: 900 }), '— - — - — Cartons - 03-09-2026 - 3 days ago');
    assert.equal(h.purchaseText({ supplier: '  ', type: ' ', cartons: 0, date: '2026-09-03' }), '— - — - — Cartons - 03-09-2026 - 3 days ago');
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
