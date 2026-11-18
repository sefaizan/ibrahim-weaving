'use strict';
/* Date / Time columns come last in every log table (v3.19.14). Exports keep the original order. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'panels-wages-receipts.js'), 'utf8');
const logColumnOrder = new Function(src.match(/function logColumnOrder\(headers\)\{[\s\S]*?\n\}/)[0] + '; return logColumnOrder;')();
const shown = h => logColumnOrder(h).map(i => h[i]);

describe('date and time last in log tables', () => {
  test('Date, Time move to the end, just before the action column', () => {
    assert.deepEqual(shown(['Date','Time','Category','Description','Amount','']), ['Category','Description','Amount','Date','Time','']);
    assert.deepEqual(shown(['Date','Employee','Amount','Remarks','']), ['Employee','Amount','Remarks','Date','']);
  });
  test('"Agreed on" (no action column) goes last; "Beam Date" and a table without a leading date are left alone', () => {
    assert.deepEqual(shown(['Agreed on','Client','Quality','Rate','Mtr','Discount','Note']), ['Client','Quality','Rate','Mtr','Discount','Note','Agreed on']);
    assert.deepEqual(shown(['Date','Time','Loom','Qty','Beam Date','']), ['Loom','Qty','Beam Date','Date','Time','']);
    assert.deepEqual(shown(['Client','Date','Amount']), ['Client','Date','Amount']);
  });
  test('rows are reordered with the same order, rowStyle is kept, and exports still use the original order', () => {
    assert.match(src, /const shownRow = r=>\{ const c = mapFn\(r\), out = order\.map\(i=>c\[i\]\); if\(c\.rowStyle\) out\.rowStyle = c\.rowStyle; return out; \};/);
    assert.match(src, /\$\{table\(shownHeaders, pageRows\.map\(shownRow\), true\)\}/);
    assert.match(src, /EXPORT_SOURCES\[pageKey\] = \(\) => \(\{headers, cells: filtered\.map\(mapFn\)\}\);/);
  });
});
