'use strict';
/* Share an alert on WhatsApp: the message texts and the link. Loads js/alert-share.js with small stand-ins. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function load(extra){
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'alert-share.js'), 'utf8');
  const ctx = vm.createContext({ fmtRs: n => 'Rs ' + Math.round(n || 0), fmtQtyMtr: n => Math.round(n) + ' m', beamAlertText: f => 'Loom ' + f.loom + ' ends soon', todayStr: () => '2026-10-09', dateAddDays: () => '2026-10-16' });
  vm.runInContext(src.replace(/^const /gm, 'var ') + (extra || ''), ctx);
  return ctx;
}
describe('alert texts', () => {
  const app = load();
  test('stock: total, then the qualities in one monospace block (short names, meters aligned), biggest first', () => {
    const t = app.alertStockText([{ name: '52 Picks', stock: 300.4 }, { name: '60/52 (Micro 150.144)', stock: 0 }, { name: '62/44 (Micro 150.144)', stock: 1240 }], 1540.4);
    assert.equal(t.title, '📦 STOCK BY QUALITY');
    assert.equal(t.body.split('\n').slice(0, 4).join('\n'), '🟢 *Total: 1540 m*\n\n```62/44      1240 m\n52 Picks    300 m```');
    assert.ok(!t.body.includes('60/52') && !t.body.includes('ORDERS'));
    assert.ok(/^_As of .+ (AM|PM)_$/.test(t.body.split('\n').pop()));
  });
  test('qualities that would get the same short name keep their full name', () => {
    const t = app.alertStockText([{ name: '62/44 (Micro 150.144)', stock: 500 }, { name: '62/44 (Polyester)', stock: 400 }], 900);
    assert.ok(t.body.includes('62/44 (Micro 150.144)') && t.body.includes('62/44 (Polyester)'));
  });
  test('orders: bars of sent / stock / to weave, stock shared oldest first, blank line between orders, tick when finished', () => {
    const o = (no, date, qty, got, quality) => ({ no, date, qty, got, quality: quality || 'Q1', client: 'SECRET' });
    const t = app.alertStockText([{ name: 'Q1', stock: 1240 }, { name: 'Q2', stock: 300 }], 1540, [o('ORD-12', '2026-09-01', 2000, 600), o('ORD-14', '2026-09-05', 3000, 0), o('ORD-15', '2026-09-10', 1000, 400), o('ORD-16', '2026-09-02', 400, 100, 'Q2')]);
    const b = t.body;
    assert.ok(b.includes('📋 *ORDERS*\n*Q1*\n\nORD-12 ▓▓▓▒▒▒▒▒▒░ *92%*\n↳ 30% sent + 62% from stock\n\nORD-14 ░░░░░░░░░░ *0%*\n\nORD-15 ▓▓▓▓░░░░░░ *40%*\n↳ 40% sent + 0% from stock\n\n*Q2*\n\nORD-16 ▓▓▓▒▒▒▒▒▒▒ *100%* ✅\n↳ 25% sent + 75% from stock\n\n_▓ sent  ▒ stock  ░ to weave_\n_As of '));
    assert.ok(!b.includes('SECRET'));
  });
  test('only 3 orders per quality are listed, the rest are counted', () => {
    const many = [1, 2, 3, 4, 5].map(i => ({ no: 'ORD-' + i, date: '2026-09-0' + i, qty: 1000, got: 0, quality: 'Q1' }));
    const b = app.alertStockText([{ name: 'Q1', stock: 10 }], 10, many).body;
    assert.ok(b.includes('ORD-3') && !b.includes('ORD-4') && b.includes('+ 2 more orders'));
  });
  test('cheques: overdue and due-soon counted, far-off ones left out', () => {
    const t = app.alertChequeText([{ client: 'A', amount: 1000, chequeDate: '2026-10-01' }, { client: 'B', amount: 500, chequeDate: '2026-10-12' }, { client: 'C', amount: 9000, chequeDate: '2026-12-30' }, { client: 'D', amount: 1, chequeDate: '' }], '2026-10-09', '2026-10-16');
    assert.equal(t.title, '🚨 CHEQUES OVERDUE 🚨');
    assert.ok(t.body.includes('1 OVERDUE:* Rs 1000') && t.body.includes('1 due within 7 days:* Rs 500') && !t.body.includes('Rs 9000'));
    assert.ok(app.alertChequeText([], '2026-10-09', '2026-10-16').body.includes('No cheques overdue'));
  });
  test('weft and beam texts', () => {
    assert.equal(app.alertWeftText({ hasData: true, bags: 12.34, lbs: 1234, cover: 4.2, perDay: 300, low: true }).title, '🚨 WEFT RUNNING LOW 🚨');
    assert.equal(app.alertWeftText({ hasData: true, bags: 50, lbs: 5000, cover: 20, perDay: 250, low: false }).title, '🧵 WEFT STOCK');
    assert.ok(app.alertWeftText({ hasData: false }).body.startsWith('No weft'));
    assert.ok(app.alertBeamText([{ loom: 3 }], 3).body.includes('⏰ Loom 3 ends soon'));
    assert.ok(app.alertBeamText([], 3).body.startsWith('✅ No beam is ending within 3 days'));
  });
  test('the stock message is built from the ledger and the WhatsApp link carries it', () => {
    const a = load(`var computeStats = () => ({ stock: 1500, stockByQuality: [{ name: 'Q1', stock: 1500 }] });`);
    const msg = a.alertBuild('stock');
    assert.ok(msg.startsWith('*📦 STOCK BY QUALITY*\n━━━━━━━━━━━━━━\n🟢 *Total: 1500 m*\n\n```Q1   1500 m```'));
    assert.equal(a.alertBuild('custom'), '');
    const url = a.alertWhatsAppUrl('Q1: 1500 m\nTotal');
    assert.ok(url.startsWith('https://wa.me/?text=') && decodeURIComponent(url.split('text=')[1]) === 'Q1: 1500 m\nTotal');
  });
});
