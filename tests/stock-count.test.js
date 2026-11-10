'use strict';
/* Stock Count (v3.19.7): a physical count saves a signed adjustment that moves Stock only. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, prod, sale, closeTo } = require('./helpers/load-app.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function ledger(adj){
  return { qualities: [{ name: 'Q1' }, { name: 'Q2' }], clients: [{ name: 'A' }],
    production: [prod({ date: '2026-09-01', quality: 'Q1', qty: 1000 }), prod({ date: '2026-09-02', quality: 'Q2', qty: 300 })],
    sale: [sale({ date: '2026-09-05', client: 'A', quality: 'Q1', qty: 995, amount: 100000 })],
    stockAdjust: adj || [] };
}

describe('stock count adjustments', () => {
  test('no adjustments: stock is produced - sold, and an old backup without the list still works', () => {
    const app = loadApp(); const d = ledger(); delete d.stockAdjust; app.setData(d);
    const s = app.computeStats('');
    closeTo(s.stock, 305); closeTo(s.stockAdjusted, 0);
  });
  test('a -3 count lowers stock for that quality only; produced and sold do not move', () => {
    const app = loadApp(); app.setData(ledger([{ id: 'a1', date: '2026-09-10', quality: 'Q1', counted: 2, expected: 5, delta: -3 }]));
    const s = app.computeStats('');
    closeTo(s.stock, 302); closeTo(s.stockAdjusted, -3);
    const q1 = s.stockByQuality.find(r => r.name === 'Q1'), q2 = s.stockByQuality.find(r => r.name === 'Q2');
    closeTo(q1.stock, 2); closeTo(q1.adjusted, -3); closeTo(q1.produced, 1000); closeTo(q1.sold, 995);
    closeTo(q2.stock, 300); closeTo(q2.adjusted, 0);
    closeTo(s.producedCum, 1300);
  });
  test('a positive count adds stock, and a quality with only an adjustment still shows', () => {
    const app = loadApp(); app.setData(ledger([{ id: 'a1', date: '2026-09-10', quality: 'Q1', delta: 4 }, { id: 'a2', date: '2026-09-10', quality: 'Q3', delta: 7 }]));
    const s = app.computeStats('');
    closeTo(s.stockByQuality.find(r => r.name === 'Q1').stock, 9);
    closeTo(s.stockByQuality.find(r => r.name === 'Q3').stock, 7);
  });
  test('wired in: data default, tab, permission, sync section, backup, export and undo labels, Urdu', () => {
    assert.match(read('js/core.js'), /"stockAdjust": \[\]/);
    assert.match(read('js/core.js'), /id:'stockcount'/);
    assert.match(read('js/view-only.js'), /stockcount: \['production'\]/);
    assert.match(read('js/cloud-sync.js'), /'warpBeams','stockAdjust'\]/);
    assert.match(read('js/shell.js'), /'checkpoints','stockAdjust'\]/);
    assert.match(read('js/shell.js'), /stockAdjust:'Stock_Counts'/);
    assert.match(read('js/shell.js'), /stockAdjust:'Stock count'/);
    assert.match(read('js/wiring.js'), /stockcount: stockCountPanel/);
  });
});
