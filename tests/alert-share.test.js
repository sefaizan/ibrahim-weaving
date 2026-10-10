'use strict';
/* Share an alert on WhatsApp: the message texts and the link. Loads js/alert-share.js with small stand-ins. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function load(extra){
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'alert-share.js'), 'utf8');
  const ctx = vm.createContext({ fmtRs: n => 'Rs ' + Math.round(n || 0), fmtQtyMtr: n => String(Math.round(n)), beamAlertText: f => 'Loom ' + f.loom + ' ends soon', todayStr: () => '2026-10-09', dateAddDays: () => '2026-10-16' });
  vm.runInContext(src.replace(/^const /gm, 'var ') + (extra || ''), ctx);
  return ctx;
}
describe('alert texts', () => {
  const app = load();
  test('stock: total, then each quality with its quantity on the next line after a spaced hand (short names), biggest first', () => {
    const t = app.alertStockText([{ name: '52 Picks', stock: 300.4 }, { name: '60/52 (Micro 150.144)', stock: 0 }, { name: '62/44 (Micro 150.144)', stock: 1240 }], 1540.4);
    assert.equal(t.title, '📦 STOCK IN HAND');
    assert.equal(t.body.split('\n').slice(0, 9).join('\n'), '🟢 *Total: 1,540 m*\n\n━━━━━━━━━━━━━━\n\n*62/44*\n   👉   *1,240 m*\n\n*52 Picks*\n   👉   *300 m*');
    assert.ok(!t.body.includes('60/52') && !t.body.includes('ORDERS'));
    assert.ok(/^🕙 \*As of .+ (AM|PM)\*$/.test(t.body.split('\n').pop()));
  });
  test('qualities that would get the same short name keep their full name', () => {
    const t = app.alertStockText([{ name: '62/44 (Micro 150.144)', stock: 500 }, { name: '62/44 (Polyester)', stock: 400 }], 900);
    assert.ok(t.body.includes('62/44 (Micro 150.144)') && t.body.includes('62/44 (Polyester)'));
  });
  test('orders: bars of sent / stock / to weave, stock shared oldest first, blank line between orders, tick when finished', () => {
    const o = (no, date, qty, got, quality) => ({ no, date, qty, got, quality: quality || 'Q1', client: 'SECRET' });
    const t = app.alertStockText([{ name: 'Q1', stock: 1240 }, { name: 'Q2', stock: 300 }], 1540, [o('ORD-12', '2026-09-01', 2000, 600), o('ORD-14', '2026-09-05', 3000, 0), o('ORD-15', '2026-09-10', 1000, 400), o('ORD-16', '2026-09-02', 400, 100, 'Q2')]);
    const b = t.body;
    assert.ok(b.includes('📋 *ORDERS*\n\n*Q1*\n\n*ORD-12*\n🟩🟩🟩🟨🟨🟨🟨🟨🟨⬜  *92%*\nSent: *30%*\nFrom stock: *62%*\nStill to weave: *8%*\n\n*ORD-14*\n⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜  *0%*\nSent: *0%*\nFrom stock: *0%*\nStill to weave: *100%*\n\n*ORD-15*'));
    assert.ok(b.includes('*ORD-16*\n🟩🟩🟩🟨🟨🟨🟨🟨🟨🟨  *100%* ✅\nSent: *25%*\nFrom stock: *75%*\nStill to weave: *0%*\n\n🟩 Sent   🟨 In stock   ⬜ To weave\n\n━━━━━━━━━━━━━━\n🕙 *As of '));
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
    assert.ok(msg.startsWith('*📦 STOCK IN HAND*\n━━━━━━━━━━━━━━\n🟢 *Total: 1,500 m*\n\n━━━━━━━━━━━━━━\n\n*Q1*\n   👉   *1,500 m*'));
    assert.ok(!msg.includes('ORDERS'), 'orders are off unless ticked');
    const b = load(`var computeStats = () => ({ stock: 1500, stockByQuality: [{ name: 'Q1', stock: 1500 }] }); var DATA = { orders: [{ quality: 'Q1', no: 'ORD-1', date: '2026-09-01', qty: 2000 }] }; var orderStats = () => ({ got: 500 });`);
    assert.ok(!b.alertBuild('stock').includes('ORDERS'), 'default: no orders');
    assert.ok(b.alertBuild('stock', { orders: true }).includes('📋 *ORDERS*') && b.alertBuild('stock', { orders: true }).includes('*ORD-1*'));
    const c = load(`var localStorage = { getItem: () => '{"stockOrders":true}', setItem(){} }; var computeStats = () => ({ stock: 1500, stockByQuality: [{ name: 'Q1', stock: 1500 }] }); var DATA = { orders: [{ quality: 'Q1', no: 'ORD-1', date: '2026-09-01', qty: 2000 }] }; var orderStats = () => ({ got: 500 });`);
    assert.ok(c.alertBuild('stock').includes('📋 *ORDERS*'), 'the saved tick turns orders on');
    assert.equal(a.alertBuild('custom'), '');
    const url = a.alertWhatsAppUrl('Q1: 1500 m\nTotal');
    assert.ok(url.startsWith('https://wa.me/?text=') && decodeURIComponent(url.split('text=')[1]) === 'Q1: 1500 m\nTotal');
  });
  test('WhatsApp link: optional phone number opens that chat; 03xx is read as +92', () => {
    assert.equal(app.alertWhatsAppUrl('hi'), 'https://wa.me/?text=hi');
    assert.ok(app.alertWhatsAppUrl('hi', '0300 1234567').startsWith('https://wa.me/923001234567?text='));
    assert.ok(app.alertWhatsAppUrl('hi', '+92 300 1234567').startsWith('https://wa.me/923001234567?'));
    assert.ok(app.alertWhatsAppUrl('hi', '12').startsWith('https://wa.me/?'));
  });
  test('open orders, money to receive, profit and cash sections', () => {
    const o = app.alertOrdersText([{ no: 'ORD-2', date: '2026-09-02', qty: 1000, got: 250, quality: 'Q' }, { no: 'ORD-1', date: '2026-09-01', qty: 2000, got: 2000, quality: 'Q' }]);
    assert.equal(o.title, '📋 OPEN ORDERS');
    assert.ok(o.body.startsWith('ORD-1 ▓▓▓▓▓▓▓▓▓▓ *100%*\n↳ 2,000 m of 2,000 m\n\nORD-2 ▓▓▓░░░░░░░ *25%*'));
    assert.ok(app.alertOrdersText([]).body.startsWith('✅ No open orders.'));
    assert.ok(app.alertReceivableText(250000).body.startsWith('🟡 *') && app.alertReceivableText(0).body.startsWith('✅'));
    const p = app.alertProfitText(-500, 90000, 'Oct 2026');
    assert.ok(p.body.startsWith('📉 *Profit Oct 2026:') && p.body.includes('💵 Cash in hand:'));
  });
  test('share message: your line, ticked sections in a fixed order, one As-of line at the end', () => {
    const a = load(`var computeStats = () => ({ stock: 1500, stockByQuality: [{ name: 'Q1', stock: 1500 }], receivable: 250000 });`);
    const msg = a.shareBuild({ stock: true, receivable: true, beams: false, note: ' Today ' });
    assert.ok(msg.startsWith('Today\n\n*📦 STOCK IN HAND*'));
    assert.ok(msg.indexOf('STOCK IN HAND') < msg.indexOf('MONEY TO RECEIVE'));
    assert.equal((msg.match(/As of /g) || []).length, 1);
    assert.ok(/🕙 \*As of .+\*$/.test(msg));
    assert.equal(a.shareBuild({ note: 'Hi' }), 'Hi');
    assert.equal(a.shareHasContent({}), false);
    assert.equal(a.shareHasContent({ weft: true }), true);
    assert.equal(a.sharePrefs().stock, true);
  });
  test('real meters formatter (bare number, sixteenths) gets commas and the unit', () => {
    assert.equal(load(`var fmtQtyMtr = n => '12400-8';`).alertMtr(1), '12,400-8 m');
    assert.equal(load(`var fmtQtyMtr = n => '-35';`).alertMtr(1), '-35 m');
  });
  test('Urdu: every message is worded in Urdu when the app language is Urdu, data stays as typed', () => {
    const u = load(`var I18N_LANG = 'ur'; var computeStats = () => ({ stock: 1540, stockByQuality: [{ name: '62/44 (Micro)', stock: 1240 }], receivable: 250000, profitMonth: 84500, cash: 3000 }); var DATA = { orders: [{ quality: '62/44 (Micro)', no: 'ORD-12', date: '2026-09-01', qty: 2000 }] }; var orderStats = () => ({ got: 600 });`);
    const st = u.alertJoin(u.alertStockText([{ name: '62/44 (Micro)', stock: 1240 }], 1540, [{ quality: '62/44 (Micro)', no: 'ORD-12', date: '2026-09-01', qty: 2000, got: 600 }]));
    assert.ok(st.startsWith('*📦 اسٹاک موجود*\n━━━━━━━━━━━━━━\n🟢 *کل اسٹاک: \u202A1,540\u202C میٹر*'));
    assert.ok(st.includes('\u200E*62/44*\n   👉   *\u202A1,240\u202C میٹر*') && st.includes('📋 *آرڈرز*') && st.includes('*ORD-12*\n🟩🟩🟩🟨🟨🟨🟨🟨🟨⬜  *92%*') && st.includes('بھیجا گیا: *30%*') && st.includes('اسٹاک سے: *62%*') && st.includes('بننا باقی: *8%*'));
    assert.ok(st.includes('🟩 بھیجا گیا   🟨 اسٹاک   ⬜ بننا باقی') && /🕙 \*تازہ ترین: \d+ \S+، \d+:\d\d \S+\*$/.test(st));
    assert.ok(!/[A-Za-z]{4}/.test(st.replace('Micro', '')), 'no English words left: ' + st);
    const w = u.alertJoin(u.alertWeftText({ hasData: true, bags: 12.3, lbs: 1234, cover: 4.2, perDay: 300, low: true }));
    assert.ok(w.includes('🚨 بانا ختم ہو رہا ہے 🚨') && w.includes('*12.3 بیگ* (1,234 پاؤنڈ)') && w.includes('*بانا ابھی منگوائیں*'));
    const b = u.alertBeamText([{ loom: 4, state: 'ending', daysLeft: 2.4, expectedRemaining: 120 }], 3);
    assert.ok(b.body.includes('لوم 4 کا بیم تقریباً 2 دن میں ختم ہوگا (~120 میٹر باقی)') && b.title.includes('بیم جلد ختم'));
    assert.ok(u.alertBeamText([], 3).body.includes('اگلے 3 دنوں میں کوئی بیم ختم نہیں ہو رہا'));
    const c = u.alertChequeText([{ client: 'Ali', amount: 1000, chequeDate: '2026-10-01' }, { client: 'Bilal', amount: 500, chequeDate: '2026-10-12' }], '2026-10-09', '2026-10-16');
    assert.ok(c.body.includes('❌ *1 چیک کی میعاد گزر چکی:* 1000 روپے') && c.body.includes('⏰ *1 چیک 7 دن کے اندر واجب الادا:* 500 روپے') && c.body.includes('Ali - 1000 روپے - 2026-10-01 (میعاد گزر چکی)') && c.body.includes('آج ہی رابطہ کریں'));
    assert.ok(u.alertBuild('receivable').includes('گاہکوں سے *250000 روپے* وصول ہونے ہیں'));
    assert.ok(u.alertBuild('profit').includes('منافع ') && u.alertBuild('profit').includes('نقد موجود: 3000 روپے'));
    assert.ok(u.alertBuild('orders').includes('↳ \u202A2,000\u202C میٹر میں سے \u202A600\u202C میٹر ڈیلیور'));
    assert.ok(u.shareBuild({ stock: true, note: 'آج کی رپورٹ' }).startsWith('آج کی رپورٹ\n\n*📦'));
    assert.equal(u.al('shChoose'), 'پہلے سیٹنگز میں چنیں کہ کیا شیئر کرنا ہے۔');
  });
  test('English stays English when the language is not Urdu', () => {
    assert.equal(app.alertUr(), false);
    assert.equal(app.al('shChoose'), 'Choose what to share in Settings first.');
  });
});
