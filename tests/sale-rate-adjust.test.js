'use strict';
/* Sale rate adjustment (v3.19.6): an AGREED discount per meter on a sale lot. The original stays as the record; a linked
   adjusted entry (new rate, reduced amount, history) is what every total, statement and receipt counts. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadApp, sale, payment, closeTo, emptyData } = require('./helpers/load-app');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = loadApp();
const plain = x => JSON.parse(JSON.stringify(x));

// The sale-receipt builders live in js/panels-wages-receipts.js; run that slice next to the real calc.js.
function loadReceipt(saleRows){
  const ctx = vm.createContext({
    DATA: Object.assign(emptyData(), { sale: saleRows, recovery: [] }),
    fmtQtyMtr: n => String(n), fmtRs: n => 'Rs ' + Math.round(n || 0).toLocaleString('en-IN'), fmtRs2: n => 'Rs ' + (Number(n) || 0).toFixed(2), fmtRateN: n => 'Rs ' + (Number(n) || 0).toFixed(2),
    fmtDate: d => d, dateTimeStamp: () => 'T', fmtLCount: n => String(n), escHtml: s => String(s), todayStr: () => '2026-11-08', nowStr: () => '12:00',
    recoveryDescription: () => 'Payment', uid: (() => { let i = 0; return () => 'u' + (++i); })(),
  });
  vm.runInContext(read('js/calc.js'), ctx);
  const src = read('js/panels-wages-receipts.js');
  vm.runInContext(src.slice(src.indexOf('function lNegotiatedNote'), src.indexOf('function printSaleReceipt')), ctx);
  const run = code => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, ctx));
  return { run, ctx };
}

// Sold 1200 mtr at Rs 100 = 120,000; the client later asked for Rs 1 off per meter.
function setup(extra){
  app.setToday('2026-11-08');
  app.setData({ sale: [sale({ id: 'S1', date: '2026-11-01', client: 'Noor', quality: 'Poplin', qty: 1200, rate: 100, amount: 120000, ...(extra || {}) })], recovery: [] });
}
const live = () => plain(app.activeSaleRows());

describe('applying an agreed discount', () => {
  test('Rs 1 off per meter: rate 99, amount reduced, original kept but no longer counted', () => {
    setup();
    const r = app.applySaleRateAdjustment('S1', 1, '2026-11-08', 'agreed in meeting');
    assert.ok(!r.error);
    closeTo(r.discount, 1200); closeTo(r.fromRate, 100); closeTo(r.toRate, 99);
    const rows = live();
    assert.equal(rows.length, 1);
    closeTo(rows[0].rate, 99); closeTo(rows[0].amount, 118800); closeTo(rows[0].qty, 1200);
    assert.equal(rows[0].rAdjustedFromId, 'S1');
    assert.equal(rows[0].rHistory.length, 1); assert.equal(rows[0].rHistory[0].note, 'agreed in meeting');
    assert.equal(plain(app.getData().sale.find(s => s.id === 'S1')).rSupersededBy, rows[0].id);   // original is still there
    closeTo(app.getData().sale.length, 2);
  });
  test('every total counts the adjusted lot only (receivable follows)', () => {
    setup();
    app.applySaleRateAdjustment('S1', 1, '2026-11-08');
    closeTo(app.activeSaleRows().reduce((t, s) => t + s.amount, 0), 118800);
    const ledger = app.buildClientLedger('Noor');
    closeTo(ledger.totalSales, 118800);
    assert.match(ledger.rows.map(x => x.detail).join('|'), /rate adjusted Rs 100 → Rs 99/);
  });
  test('decimals count: the adjusted amount is exactly what a fresh sale at the new rate would be (qty x new rate, whole rupees)', () => {
    setup({ qty: 1234.5, amount: 123450 });
    const r = app.applySaleRateAdjustment('S1', 1, '2026-11-08');
    closeTo(live()[0].amount, Math.floor(1234.5 * 99 + 1e-6)); closeTo(live()[0].amount, 122215);
    closeTo(r.discount, 123450 - 122215);
  });
  test('a discount with decimals per meter is not cut to whole rupees first (Rs 0.125 x 100 mtr)', () => {
    setup({ qty: 100, amount: 10000 });
    const r = app.applySaleRateAdjustment('S1', 0.125, '2026-11-08');
    closeTo(r.toRate, 99.875); closeTo(live()[0].amount, 9987); closeTo(r.discount, 13);
  });
  test('a small decimal discount on a few meters still counts (Rs 0.5 on 3 mtr)', () => {
    setup({ qty: 3, amount: 300 });
    const r = app.applySaleRateAdjustment('S1', 0.5, '2026-11-08');
    closeTo(live()[0].amount, 298); closeTo(r.discount, 2);       // 3 x 99.5 = 298.5 -> 298
  });
  test('the sheet preview shows exactly what Agree & save will store', () => {
    setup({ qty: 1234.5, amount: 123450 });
    const p = app.previewSaleRateAdjustment(live()[0], 0.75);
    const r = app.applySaleRateAdjustment('S1', 0.75, '2026-11-08');
    closeTo(p.newAmount, live()[0].amount); closeTo(p.discount, r.discount); closeTo(p.toRate, r.toRate);
  });
  test('a second agreed discount stacks on the first, and both stay in the history', () => {
    setup();
    app.applySaleRateAdjustment('S1', 1, '2026-11-08');
    const id1 = live()[0].id;
    const r2 = app.applySaleRateAdjustment(id1, 0.5, '2026-11-10', 'second talk');
    closeTo(r2.toRate, 98.5);
    const rows = live();
    assert.equal(rows.length, 1);
    closeTo(rows[0].amount, 118800 - 600); assert.equal(rows[0].rHistory.length, 2);
    closeTo(rows[0].rBase.rate, 100); closeTo(rows[0].rBase.amount, 120000);   // the receipt starts from the original lot
  });
  test('the adjusted entry does not inherit the original\'s who/when stamps', () => {
    setup({ _ct: 111, _cb: 'a@b.c', _mt: 222 });
    app.applySaleRateAdjustment('S1', 1, '2026-11-08');
    const a = live()[0];
    assert.equal(a._ct, undefined); assert.equal(a._cb, undefined); assert.equal(a._mt, undefined);
  });
});

describe('rules', () => {
  test('refuses: no discount, discount >= rate, bad date, under Rs 1 total, lot waiting for L (AIL), already replaced', () => {
    setup();
    assert.ok(app.applySaleRateAdjustment('S1', 0, '2026-11-08').error);
    assert.ok(app.applySaleRateAdjustment('S1', 100, '2026-11-08').error);
    assert.ok(app.applySaleRateAdjustment('S1', 150, '2026-11-08').error);
    assert.ok(app.applySaleRateAdjustment('S1', 1, '').error);
    assert.ok(app.applySaleRateAdjustment('S1', 1, '08-11-2026').error);
    assert.equal(app.getData().sale.length, 1);                       // nothing was created by any refusal
    setup({ lStatus: 'awaiting' });
    assert.match(app.applySaleRateAdjustment('S1', 1, '2026-11-08').error, /L \(AIL\)/);
    setup();
    app.applySaleRateAdjustment('S1', 1, '2026-11-08');
    assert.match(app.applySaleRateAdjustment('S1', 1, '2026-11-09').error, /already replaced/);
  });
  test('an L (AIL) shortage-adjusted entry can take a discount too, and keeps its L link', () => {
    app.setToday('2026-11-08');
    app.setData({ sale: [
      sale({ id: 'O', date: '2026-11-01', client: 'Noor', quality: 'Poplin', qty: 1200, rate: 100, amount: 120000, lStatus: 'applied', lSupersededBy: 'L1', lShortageQty: 100, lDeduction: 10000, lCount: 3 }),
      sale({ id: 'L1', date: '2026-11-01', client: 'Noor', quality: 'Poplin', qty: 1100, rate: 100, amount: 110000, lAdjustedFromId: 'O' }),
    ], recovery: [] });
    const r = app.applySaleRateAdjustment('L1', 1, '2026-11-08');
    assert.ok(!r.error); closeTo(r.discount, 1100);
    const a = live()[0];
    assert.equal(a.lAdjustedFromId, 'O'); closeTo(a.amount, 108900);
    closeTo(app.activeSaleRows().length, 1);
  });
});

describe('undo', () => {
  test('undo removes the adjusted entry and the original counts again', () => {
    setup();
    app.applySaleRateAdjustment('S1', 1, '2026-11-08');
    assert.equal(app.undoSaleRateAdjustment(live()[0].id), true);
    const rows = live();
    assert.equal(rows.length, 1); assert.equal(rows[0].id, 'S1'); closeTo(rows[0].amount, 120000);
    assert.equal(rows[0].rSupersededBy, undefined);
  });
  test('undo of a second adjustment goes back to the first, not the original', () => {
    setup();
    app.applySaleRateAdjustment('S1', 1, '2026-11-08');
    app.applySaleRateAdjustment(live()[0].id, 0.5, '2026-11-10');
    app.undoSaleRateAdjustment(live()[0].id);
    const rows = live(); closeTo(rows[0].rate, 99); closeTo(rows[0].amount, 118800); assert.equal(rows[0].rHistory.length, 1);
  });
  test('undo on an entry that is not an adjustment does nothing', () => {
    setup(); assert.equal(app.undoSaleRateAdjustment('S1'), false); assert.equal(live().length, 1);
  });
});

describe('discounts given', () => {
  test('totals, this month, per client - only discounts that still stand', () => {
    app.setToday('2026-11-08');
    app.setData({ sale: [
      sale({ id: 'A', date: '2026-10-01', client: 'Noor', quality: 'P', qty: 1000, rate: 100, amount: 100000 }),
      sale({ id: 'B', date: '2026-11-02', client: 'Zahid', quality: 'P', qty: 500, rate: 120, amount: 60000 }),
    ], recovery: [] });
    app.applySaleRateAdjustment('A', 2, '2026-10-20');       // 2,000 off in October
    app.applySaleRateAdjustment('B', 1, '2026-11-05');       // 500 off in November
    const d = plain(app.computeSaleDiscounts());
    closeTo(d.total, 2500); closeTo(d.thisMonth, 500);
    closeTo(d.byClient.Noor, 2000); closeTo(d.byClient.Zahid, 500);
    assert.equal(d.items[0].date, '2026-11-05');             // newest first
    app.undoSaleRateAdjustment(app.activeSaleRows().find(s => s.client === 'Zahid').id);
    closeTo(app.computeSaleDiscounts().total, 2000);
  });
});

describe('receipt', () => {
  const base = () => sale({ id: 'S1', date: '2026-11-01', client: 'Noor', quality: 'Poplin', qty: 1200, rate: 100, amount: 120000 });
  const adjust = (rows, id, per, date) => {   // apply through the real calc.js inside the receipt sandbox
    const { run, ctx } = loadReceipt(rows);
    return { run, ctx, res: run(`applySaleRateAdjustment('${id}', ${per}, '${date}')`) };
  };
  test('shows the original lot, one "Less: Rate adjustment" row per agreed discount, then the net total', () => {
    const { run, res } = adjust([base()], 'S1', 1, '2026-11-08');
    run(`applySaleRateAdjustment(activeSaleRows()[0].id, 0.5, '2026-11-10')`);
    const r = run(`(()=>{ const a = activeSaleRows()[0]; const f = buildReceiptFields(a.id); return {rows: saleReceiptRows(f.r, f.rate), cur: f.currentSale}; })()`);
    assert.equal(r.rows.rows.length, 3);
    assert.match(r.rows.rows[0].label, /Original rate/); assert.equal(r.rows.rows[0].rate, 'Rs 100.00'); assert.equal(r.rows.rows[0].amount, 'Rs 1,20,000');
    assert.match(r.rows.rows[1].label, /Less: Rate adjustment/); assert.equal(r.rows.rows[1].rate, '-Rs 1.00'); assert.equal(r.rows.rows[1].amount, '-Rs 1,200');
    assert.equal(r.rows.rows[2].rate, '-Rs 0.50'); assert.equal(r.rows.rows[2].amount, '-Rs 600');
    assert.match(r.rows.totalLabel, /after rate adjustment/); assert.equal(r.rows.totalAmount, 'Rs 1,18,200');
    closeTo(r.cur, 118200);
  });
  test('the replaced original points to the adjusted invoice and nets to the same figure', () => {
    const { run } = adjust([base()], 'S1', 1, '2026-11-08');
    const r = run(`(()=>{ const f = buildReceiptFields('S1'); return {rows: saleReceiptRows(f.r, f.rate), cur: f.currentSale}; })()`);
    assert.match(r.rows.totalLabel, /see adjusted invoice/); assert.equal(r.rows.totalAmount, 'Rs 1,18,800'); closeTo(r.cur, 118800);
  });
  test('after an L (AIL) shortage the dispatched and shortage rows come first', () => {
    const rows = [
      sale({ id: 'O', client: 'Noor', quality: 'P', qty: 1200, rate: 100, amount: 120000, lStatus: 'applied', lSupersededBy: 'L1', lShortageQty: 100, lDeduction: 10000, lCount: 3 }),
      sale({ id: 'L1', client: 'Noor', quality: 'P', qty: 1100, rate: 100, amount: 110000, lAdjustedFromId: 'O' }),
    ];
    const { run } = adjust(rows, 'L1', 1, '2026-11-08');
    const r = run(`(()=>{ const a = activeSaleRows()[0]; const f = buildReceiptFields(a.id); return saleReceiptRows(f.r, f.rate); })()`);
    assert.deepEqual(r.rows.map(x => x.label.split(' (')[0].split(' — ')[0]), ['P', 'Less: L', 'Less: Rate adjustment']);
    assert.equal(r.totalAmount, 'Rs 1,08,900');
  });
});

describe('wiring', () => {
  const wiring = read('js/wiring.js'), lock = read('js/lock-init.js'), vo = read('js/view-only.js'), panels = read('js/panels-daily.js'), idx = read('index.html');
  test('the Adjust button is on sale rows, opens the sheet, and is hidden for view-only / limited accounts', () => {
    assert.match(panels, /\$\{saleAdjustBtn\(r\)\}\$\{actionBtns\('sale',r\.id\)\}/);
    assert.match(lock, /openSaleAdjustSheet\(adjBtn\.getAttribute\('data-sale-adjust'\)\)/);
    assert.match(vo, /\[data-sale-adjust\]/); assert.match(idx, /body\.view-only \[data-sale-adjust\]/);
  });
  test('deleting a sale takes the whole adjustment chain with it; qty/rate/amount are locked on linked entries', () => {
    assert.match(wiring, /cur\.rAdjustedFromId, cur\.rSupersededBy/);
    assert.match(wiring, /existing\.rSupersededBy \|\| existing\.rAdjustedFromId/);
  });
  test('only agreed discounts are saved: the sheet only creates anything from "Agree & save"', () => {
    assert.equal((wiring.match(/applySaleRateAdjustment\(/g) || []).length, 1);
  });
});

describe('rate adjustment card and rate display (v3.19.12)', () => {
  const rd = f => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', f), 'utf8');
  test('the Rate Adjustments card is collapsible, closed by default, remembers when opened, and shows the total while closed', () => {
    const src = rd('js/panels-daily.js');
    assert.match(src, /<details class="card" data-sale-disc\$\{SALE_DISC_OPEN \? ' open' : ''\}><summary/);
    assert.match(src, /let SALE_DISC_OPEN = false;/);
    assert.match(rd('js/wiring.js'), /details\[data-sale-disc\]/);
  });
  test('rates keep up to 4 decimals on screen (Rs 99.875, not Rs 99.88); the inputs accept any decimal', () => {
    const m = rd('js/core.js').match(/const fmtRateN = n => [^\n]+/);
    const fmtRateN = new Function(m[0] + '; return fmtRateN;')();
    assert.equal(fmtRateN(99.875), 'Rs 99.875'); assert.equal(fmtRateN(100), 'Rs 100.00'); assert.equal(fmtRateN(99.25), 'Rs 99.25');
    assert.match(rd('js/wiring.js'), /id="sa_per" type="number" inputmode="decimal" step="any"/);
  });
});
