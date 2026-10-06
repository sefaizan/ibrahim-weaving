'use strict';
/* Orders page markup (v3.18.17): runs js/orders.js in a small sandbox and checks what the page and the agreement contain. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..', 'js');
function load(data){
  const ctx = {DATA: data, BIZ_LOGO_PNG: 'data:x', receiptWatermarkDiv: '<div class="receipt-watermark"></div>', fmtNum: x => String(x), fmtDate: x => x, fmtRs: x => 'Rs ' + x, escHtml: x => String(x), todayStr: () => '2026-10-07', costCfg: () => ({widthByReed: {}, width: 63}),
    field: (l, id, t, ex) => `<input id="${id}" ${ex || ''}>`, textareaField: (l, id) => `<textarea id="${id}"></textarea>`,
    clientSelectField: (l, id, ex) => `<select id="${id}" ${ex || ''}><option value="">—</option><option value="Javed">Javed</option></select>`,
    selectField: (l, id, a, ex) => `<select id="${id}" ${ex || ''}><option value="">—</option>${(a || []).map(x => `<option value="${x.name}">${x.name}</option>`).join('')}</select>`,
    document: {getElementById: () => null}, console};
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(root, 'calc.js'), 'utf8') + fs.readFileSync(path.join(root, 'orders.js'), 'utf8') + ';this.panel = ordersPanel; this.agr = orderAgreementHtml;', ctx); return ctx;
}
const base = {id: 'o1', no: 'ORD-001', client: 'Javed', quality: 'Q1', qty: 20000, rate: 100, date: '2026-10-01', closed: false, witBuyer: 'Ali', witSeller: 'Umar'};
const mk = (orders, sale) => load({orders, sale: sale || [], qualities: [{name: 'Q1'}], clients: [{name: 'Javed'}], production: [], recovery: [], businessInfo: {name: 'IW', address: 'Faisalabad', phone: '0300'}});
describe('orders page', () => {
  test('the form follows the agreement and has the two name boxes; dropdowns start on the dash', () => {
    const h = mk([]).panel();
    for(const t of ['Agreement', 'Parties', 'Cloth and price', 'Delivery terms', 'In the presence of', 'id="o_wb"', 'id="o_ws"']) assert.ok(h.includes(t), t);
    assert.match(h, /<select id="o_client"[^>]*><option value="">—<\/option>/);
    assert.ok(h.includes('class="form-actions"'));
  });
  test('an open order offers Revoke; a revoked one hides Edit, Revoke and Mark complete and offers Undo + replacement buttons', () => {
    let h = mk([base]).panel(); assert.ok(h.includes('data-a="revoke"')); assert.ok(h.includes('data-a="edit"'));
    h = mk([Object.assign({}, base, {closed: true, revoked: {date: '2026-10-05', terms: 't', delivered: 0, rate: 100}})]).panel();
    for(const a of ['edit', 'revoke', 'done']) assert.ok(!h.includes('data-a="' + a + '"'), a);
    for(const a of ['unrev', 'mkrep', 'linkex']) assert.ok(h.includes('data-a="' + a + '"'), a);
  });
  test('every order button carries the permission hooks the roles use', () => {
    const h = mk([base]).panel(); assert.ok(h.includes('data-edit="orders:o1"')); assert.ok(h.includes('data-del="orders:o1"'));
  });
  test('the agreement shows the witness names, and the revocation block uses the frozen figures', () => {
    const c = mk([Object.assign({}, base, {closed: true, revoked: {date: '2026-10-05', terms: 'Rest cancelled', delivered: 4321, rate: 100}})]);
    const h = c.agr(c.DATA.orders[0], 'en'); assert.ok(h.includes('Ali') && h.includes('Umar')); assert.ok(h.includes('Rest cancelled') && h.includes('4321') && h.includes('Revoked'));
  });
  test('editing an order with deliveries locks client and quality', () => {
    const c = mk([base], [{id: 's1', order: 'o1', qty: 100, amount: 1}]); vm.runInContext('ORD_EDIT = "o1"', c);
    assert.match(c.panel(), /<select id="o_client" disabled/);
  });
});

describe('order width', () => {
  test('width is an editable number box, and the agreement prints the order\'s own width', () => {
    const c = mk([Object.assign({}, base, {width: 58})]); vm.runInContext('ORD_EDIT = "o1"', c);
    const h = c.panel(); assert.match(h, /<input id="o_width"[^>]*value="58"/); assert.ok(!/id="o_width"[^>]*disabled/.test(h));
    assert.ok(c.agr(c.DATA.orders[0], 'en').includes('58 inches'));
    assert.ok(mk([base]).agr(base, 'en').includes('64 inches'));
  });
});

describe('order card and language', () => {
  test('no language dropdown on the card; the agreement language follows the app language', () => {
    const c = mk([base]); assert.ok(!c.panel().includes('od-lang'));
    assert.equal(vm.runInContext('odLang()', c), 'en'); c.I18N_LANG = 'ur'; assert.equal(vm.runInContext('odLang()', c), 'ur');
    c.I18N_LANG = 'en'; assert.equal(vm.runInContext('odLang()', c), 'en');
  });
  test('the card shows initial, status, progress ring, tiles and the share row', () => {
    const h = mk([base]).panel();
    for(const t of ['od-av', 'od-chip', 'od-ring', 'od-bar', 'od-meta', 'data-a="img"', 'data-a="pdf"']) assert.ok(h.includes(t), t);
    assert.ok(h.includes('k-new')); assert.ok(mk([Object.assign({}, base, {closed: true, revoked: {date: 'd', terms: '', delivered: 0, rate: 100}})]).panel().includes('k-rev'));
  });
});

describe('sale form order dropdown', () => {
  const o = (id, no, client, quality, x) => Object.assign({id, no, client, quality, qty: 1000, rate: 100, closed: false}, x || {});
  const c = () => mk([o('a', 'ORD-001', 'Javed Ashraf', '62/44 (150.144 Micro)'), o('b', 'ORD-002', 'Ali', 'Q2'), o('c', 'ORD-010', 'Javed Ashraf', 'Q2'),
    o('d', 'ORD-003', 'Ali', 'Q2', {closed: true}), o('e', 'ORD-004', 'Ali', 'Q2', {closed: true, revoked: {date: 'd'}})]);
  const ids = (cx, cl, q, keep) => vm.runInContext(`orderSaleChoices(${JSON.stringify(cl)}, ${JSON.stringify(q)}, ${JSON.stringify(keep)}).map(x => x.id).join()`, cx);
  test('the label is order number - client - quality', () => {
    const cx = c(); assert.equal(vm.runInContext('orderLabel(DATA.orders[0])', cx), 'ORD-001 - Javed Ashraf - 62/44 (150.144 Micro)');
  });
  test('with nothing chosen every open order is listed (newest first); completed and revoked ones are left out', () => {
    assert.equal(ids(c(), '', '', ''), 'c,b,a');
  });
  test('choosing a client or quality narrows the list, but never to nothing', () => {
    const cx = c(); assert.equal(ids(cx, 'Javed Ashraf', '', ''), 'c,a'); assert.equal(ids(cx, 'Javed Ashraf', 'Q2', ''), 'c');
    assert.equal(ids(cx, 'Nobody', '', ''), 'c,b,a');
  });
  test('the order of the sale being edited stays listed even when completed', () => {
    assert.equal(ids(c(), 'Ali', 'Q2', 'd'), 'd,b');
  });
});

describe('completion statement', () => {
  const done = Object.assign({}, base, {closed: true, completedOn: '2026-10-06'});
  const sales = [{id: 's1', order: 'o1', client: 'Javed', date: '2026-10-02', invoice: 'INV-1', qty: 12000, rate: 100, amount: 1200000}, {id: 's2', order: 'o1', client: 'Javed', date: '2026-10-05', invoice: 'INV-2', qty: 8300, rate: 102, amount: 846600}];
  test('shows dates, deliveries, totals, result and the account balance; has no witness or signature block', () => {
    const c = mk([done], sales), h = vm.runInContext('orderCompletionHtml(DATA.orders[0], "en")', c);
    for(const t of ['Order Completion Statement', 'Completed', 'Completion date', '2026-10-06', 'INV-1', 'INV-2', '20300', 'Within the agreed tolerance', '102 *', 'Account balance (all orders)', 'not only this order']) assert.ok(h.includes(t), t);
    assert.ok(h.includes('2046600'), 'balance = all sales less recoveries'); assert.ok(!h.includes('In the presence of') && !h.includes('Ali') && !h.includes('Umar'));
  });
  test('Urdu version renders, and a short or over delivery is described as such', () => {
    const c = mk([done], [sales[0]]); assert.ok(vm.runInContext('orderCompletionHtml(DATA.orders[0], "ur")', c).includes('آرڈر تکمیل کا گوشوارہ'));
    assert.ok(vm.runInContext('orderCompletionHtml(DATA.orders[0], "en")', c).includes('Short of the order by 8000 m'));
  });
  test('only completed (not revoked) cards offer the completion buttons', () => {
    assert.ok(mk([done]).panel().includes('data-a="cimg"')); assert.ok(!mk([base]).panel().includes('data-a="cimg"'));
    assert.ok(!mk([Object.assign({}, done, {revoked: {date: 'd', delivered: 0, rate: 100}})]).panel().includes('data-a="cimg"'));
  });
});

describe('statement watermark and completed badge (v3.18.22)', () => {
  const done = Object.assign({}, base, {closed: true, completedOn: '2026-10-05'});
  test('the agreement and the completion statement both carry the receipt watermark', () => {
    const c = mk([done]);
    for(const fn of ['orderAgreementHtml', 'orderCompletionHtml']){
      const h = vm.runInContext(fn + '(DATA.orders[0], "en")', c);
      assert.ok(h.includes('class="receipt-watermark"'), fn);
    }
  });
  test('the completion statement shows a Completed stamp with a tick and the date', () => {
    const h = vm.runInContext('orderCompletionHtml(DATA.orders[0], "en")', mk([done]));
    assert.match(h, /<div class="cpb"><div class="in"><svg[\s\S]*<b>Completed<\/b><em dir="ltr">2026-10-05<\/em>/);
  });
});

describe('completion statement over several pictures (v3.18.25)', () => {
  const done = Object.assign({}, base, {closed: true, completedOn: '2026-10-06'});
  const many = Array.from({length: 12}, (_, i) => ({id: 's' + i, order: 'o1', client: 'Javed', date: '2026-10-' + String(i + 1).padStart(2, '0'), invoice: 'INV-' + (i + 1), qty: 1500, rate: 100, amount: 150000}));
  const html = (pg) => vm.runInContext('orderCompletionHtml(DATA.orders[0], "en", ' + JSON.stringify(pg) + ')', mk([done], many));
  test('the first picture has the letterhead, summary and stamp but no totals or balance', () => {
    const h = html({from: 0, to: 5, label: 'Page 1 of 3'});
    assert.ok(h.includes('class="cpb"') && h.includes('Account balance') === false && !h.includes('<tfoot>'));
    assert.ok(h.includes('INV-1<') && h.includes('INV-5<') && !h.includes('INV-6<')); assert.ok(h.includes('Page 1 of 3'));
  });
  test('a middle picture is marked continued and has only its own rows', () => {
    const h = html({from: 5, to: 9, label: 'Page 2 of 3'});
    assert.ok(h.includes('(continued)') && !h.includes('class="cpb"') && !h.includes('<tfoot>') && !h.includes('Account balance'));
    assert.ok(h.includes('INV-6<') && h.includes('INV-9<') && !h.includes('INV-5<') && !h.includes('INV-10<'));
  });
  test('the last picture carries the totals, the balance and the thank-you line', () => {
    const h = html({from: 9, to: 12, label: 'Page 3 of 3'});
    assert.ok(h.includes('<tfoot>') && h.includes('Account balance') && h.includes('Thank you for your business') && h.includes('INV-12<'));
    assert.ok(h.includes('18000'.replace(/(\d)(?=(\d{3})+$)/, '$1')) || h.includes('18000'));
  });
  test('without a slice the whole statement comes back in one piece, as before', () => {
    const h = vm.runInContext('orderCompletionHtml(DATA.orders[0], "en")', mk([done], many));
    assert.ok(h.includes('INV-1<') && h.includes('INV-12<') && h.includes('<tfoot>') && h.includes('class="cpb"') && !h.includes('(continued)'));
  });
});
