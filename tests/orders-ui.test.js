'use strict';
/* Orders page markup (v3.18.17): runs js/orders.js in a small sandbox and checks what the page and the agreement contain. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..', 'js');
function load(data){
  const ctx = {DATA: data, BIZ_LOGO_PNG: 'data:x', fmtNum: x => String(x), fmtDate: x => x, fmtRs: x => 'Rs ' + x, escHtml: x => String(x), todayStr: () => '2026-10-07', costCfg: () => ({widthByReed: {}, width: 63}),
    field: (l, id, t, ex) => `<input id="${id}" ${ex || ''}>`, textareaField: (l, id) => `<textarea id="${id}"></textarea>`,
    clientSelectField: (l, id, ex) => `<select id="${id}" ${ex || ''}><option value="">—</option><option value="Javed">Javed</option></select>`,
    selectField: (l, id, a, ex) => `<select id="${id}" ${ex || ''}><option value="">—</option>${(a || []).map(x => `<option value="${x.name}">${x.name}</option>`).join('')}</select>`,
    document: {getElementById: () => null}, console};
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(root, 'calc.js'), 'utf8') + fs.readFileSync(path.join(root, 'orders.js'), 'utf8') + ';this.panel = ordersPanel; this.agr = orderAgreementHtml;', ctx); return ctx;
}
const base = {id: 'o1', no: 'ORD-001', client: 'Javed', quality: 'Q1', qty: 20000, rate: 100, date: '2026-10-01', closed: false, witBuyer: 'Ali', witSeller: 'Umar'};
const mk = (orders, sale) => load({orders, sale: sale || [], qualities: [{name: 'Q1'}], clients: [{name: 'Javed'}], production: [], businessInfo: {name: 'IW', address: 'Faisalabad', phone: '0300'}});
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
