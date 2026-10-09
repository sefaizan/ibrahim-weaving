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
  test('stock lists each quality with a share bar, biggest first, then the total on top', () => {
    const t = app.alertStockText([{ name: '52 Picks', stock: 300.4 }, { name: '44 Picks', stock: 1240 }, { name: '60 Picks', stock: 0 }], 1540.4);
    const lines = t.body.split('\n');
    assert.equal(t.title, '📦 STOCK BY QUALITY');
    assert.equal(lines[0], '🟢 *Total: 1540 m*');
    assert.equal(lines[2], '▪️ *44 Picks*: 1240 m');
    assert.ok(/^ +▓+░* 80% of stock$/.test(lines[3]));
    assert.ok(lines[4].startsWith('▪️ *52 Picks*') && !t.body.includes('60 Picks'));
    assert.ok(lines[lines.length - 1].startsWith('🕒 _As of '));
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
  test('stock shows each open order: sent, covered by stock, still to weave; stock is shared oldest order first', () => {
    const orders = [{ quality: '44 Picks', client: 'Ali', no: 'ORD-1', date: '2026-09-01', qty: 1000, got: 300 }, { quality: '44 Picks', client: 'Bilal', no: 'ORD-2', date: '2026-09-10', qty: 1000, got: 0 }];
    const t = app.alertStockText([{ name: '44 Picks', stock: 1000 }], 1000, orders);
    assert.ok(t.body.includes('👤 Ali (ORD-1)') && t.body.includes('▓▓▓▒▒▒▒▒▒▒ *100%*  30% sent + 70% from stock'));
    assert.ok(t.body.includes('▒▒▒░░░░░░░ *30%*  0% sent + 30% from stock'));
    assert.ok(t.body.includes('▓ sent'));
    assert.ok(app.alertStockText([{ name: 'Q', stock: 50 }], 50, []).body.includes('of stock'));
  });
  test('the stock message is built from the ledger and the WhatsApp link carries it', () => {
    const a = load(`var computeStats = () => ({ stock: 1500, stockByQuality: [{ name: 'Q1', stock: 1500 }] });`);
    const msg = a.alertBuild('stock');
    assert.ok(msg.startsWith('*📦 STOCK BY QUALITY*\n━━━━━━━━━━━━━━\n🟢 *Total: 1500 m*') && msg.includes('▪️ *Q1*: 1500 m'));
    assert.equal(a.alertBuild('custom'), '');
    const url = a.alertWhatsAppUrl('Q1: 1500 m\nTotal');
    assert.ok(url.startsWith('https://wa.me/?text=') && decodeURIComponent(url.split('text=')[1]) === 'Q1: 1500 m\nTotal');
  });
});
