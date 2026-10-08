'use strict';
/*
 * Wages page redesign (3.17.38): period chips, the Summary tab (employee cards, by quality, Diff, rates,
 * bonus), the quick-entry sheet (Payment / Bonus / Settle, suggested amounts, next person, held changes),
 * and the rules that keep the new buttons behind view-only and role permissions.
 * Runs the real js/calc.js and js/wages-ui.js with the few page helpers they use replaced by stand-ins.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { emptyData, prod, closeTo } = require('./helpers/load-app');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function load(data, today = '2026-10-02') {
  const els = {}, vals = {};
  const el = (id) => (els[id] = els[id] || { id, value: '', innerHTML: '', textContent: '', classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {} });
  const log = { toasts: [], tabs: 0 };
  const ctx = vm.createContext({
    DATA: Object.assign(emptyData(), data), PAGE: {}, EDITING: 'stale',
    todayStr: () => today, nowStr: () => '12:00', recoveryDescription: () => 'Payment',
    fmtQtyMtr: (n) => String(Math.round(n * 100) / 100),
    fmtRs: (n) => 'Rs ' + Math.round(n || 0), fmtRs2: (n) => 'Rs ' + (n || 0).toFixed(2), fmtDate: (d) => d,
    escHtml: (s) => String(s), ICON_CHEV: '<svg/>', uid: (() => { let i = 0; return () => 'id' + (++i); })(),
    employeeSelectField: () => '<select id="wq_emp"></select>',
    v: (id) => (id in vals ? vals[id] : ''), requireFields: (rows) => rows.every((r) => r[0]),
    showToast: (m) => log.toasts.push(m), switchTab: () => { log.tabs++; },
    save: async () => {}, wireEnterSubmit: () => {},
    document: { getElementById: (id) => el(id), querySelectorAll: () => [] },
  });
  vm.runInContext(read('js/calc.js'), ctx, { filename: 'js/calc.js' });
  vm.runInContext(read('js/wages-ui.js'), ctx, { filename: 'js/wages-ui.js' });
  // `const` declarations in the sandbox are not properties of ctx: read them through a tiny accessor.
  const get = (name) => vm.runInContext(name, ctx);
  return { ctx, el, vals, log, get, run: (code) => vm.runInContext(code, ctx) };
}

const emp = (name, extra) => ({ id: 'e-' + name, name, ...extra });
// Two qualities woven at the same time; Ali also has a Diff share; the A rate changes on 2026-09-30.
const ledger = () => ({
  qualities: [{ name: 'A' }, { name: 'B' }],
  employees: [emp('Ali'), emp('Bilal')],
  wageRateHistory: { A: [{ date: '2026-01-01', rate: 10 }, { date: '2026-09-30', rate: 12 }], B: [{ date: '2026-01-01', rate: 5 }] },
  production: [
    prod({ date: '2026-09-28', quality: 'A', qty: 100, e1: 'Ali', e1m: 100 }),                // 100 x 10
    prod({ date: '2026-09-28', quality: 'B', qty: 50, e1: 'Ali', e1m: 40, e2: 'Bilal', e2m: 0 }), // 40 own + 10 unassigned
    prod({ date: '2026-10-01', quality: 'A', qty: 80, e1: 'Bilal', e1m: 80 }),                // 80 x 12
  ],
  wageBonuses: [{ id: 'b1', date: '2026-09-29', employee: 'Bilal', amount: 500, remarks: '' }],
  wagePayments: [{ id: 'p1', date: '2026-09-30', employee: 'Ali', amount: 600, remarks: '' }],
});

describe('period chips', () => {
  test('this wage week (Fri-Thu), last wage week and this month', () => {
    const { run } = load({}, '2026-10-02'); // a Friday
    const p = JSON.parse(run('JSON.stringify(wagePeriodPresets())'));
    assert.deepEqual(p.map((x) => [x.id, x.from, x.to]), [
      ['week', '2026-10-02', '2026-10-08'], ['last', '2026-09-25', '2026-10-01'], ['month', '2026-10-01', '2026-10-31']]);
  });
  test('February and a Thursday: the month ends on the right day and the week starts last Friday', () => {
    const { run } = load({}, '2028-02-17'); // Thursday, leap year
    const p = JSON.parse(run('JSON.stringify(wagePeriodPresets())'));
    assert.equal(p[0].from, '2028-02-11'); assert.equal(p[0].to, '2028-02-17');
    assert.equal(p[2].to, '2028-02-29');
  });
  test('the chip matching the dates is lit, otherwise Custom is', () => {
    const { run } = load({});
    assert.match(run("wagesChipsHtml('2026-10-02','2026-10-08')"), /wg-chip on" data-wg-from="2026-10-02"/);
    const custom = run("wagesChipsHtml('2026-10-03','2026-10-08')");
    assert.match(custom, /wg-chip on" data-wg-custom/); assert.doesNotMatch(custom, /wg-chip on" data-wg-from/);
  });
});

describe('Summary tab', () => {
  test('one card per employee, with Pay button, per-quality rows, Diff, rate and bonus', () => {
    const t = load(ledger());
    t.vals.wg_from = '2026-09-28'; t.vals.wg_to = '2026-10-02';
    t.run('renderWages()');
    const html = t.el('wagesWrap').innerHTML;
    ['Ali', 'Bilal'].forEach((n) => assert.match(html, new RegExp(`data-wg-emp="${n}"`)));
    assert.match(html, /data-wage-add="pay" data-wage-emp="Ali"/);
    assert.match(html, /<td>A<\/td>/); assert.match(html, /<td>B<\/td>/);     // both qualities listed
    assert.match(html, /12\.00\*/);                                            // A's rate changed inside the period
    assert.doesNotMatch(html.match(/<td>B<\/td>[^]*?<\/tr>/)[0], /\*/);        // B's did not
    assert.match(html, /Total with bonus/); assert.match(html, /Full tables/);
  });
  test('figures tie to the calculation code: owed = positive balances, earned and paid for the period', () => {
    const t = load(ledger());
    t.vals.wg_from = '2026-09-28'; t.vals.wg_to = '2026-10-02';
    t.run('renderWages()');
    const html = t.el('wagesWrap').innerHTML;
    const bal = (n) => JSON.parse(t.run(`JSON.stringify(computeEmployeeWageBalance('${n}'))`)).balance;
    const owed = ['Ali', 'Bilal'].reduce((s, n) => s + Math.max(0, bal(n)), 0);
    assert.ok(html.includes(`<div class="wg-hero-big">Rs ${Math.round(owed)}</div>`), 'hero shows the running balance owed');
    // Ali: A 100 x 10 = 1000, B (40 own + 5 of the 10 unassigned) x 5 = 225, paid 600 -> balance 625
    closeTo(bal('Ali'), 625, 'Ali balance');
    // Bilal: A 80 x 12 = 960 + his 5 of the unassigned B meters x 5 = 25 + bonus 500 = 1485
    closeTo(bal('Bilal'), 1485, 'Bilal balance');
    assert.match(html, /Rs 625 owed/); assert.match(html, /Rs 1485 owed/);
  });
  test('summary card lists production by quality (Diff included) with a total', () => {
    const t = load(ledger());
    t.vals.wg_from = '2026-09-28'; t.vals.wg_to = '2026-10-02';
    t.run('renderWages()');
    const hero = t.el('wagesWrap').innerHTML.match(/<div class="card wg-hero">[^]*?<div class="card"><div class="card-head">/)[0];
    assert.match(hero, /Production by Quality \(mtr\)/);
    assert.match(hero, /<span class="q">A<\/span><span class="m">180<\/span>/);   // 100 + 80
    assert.match(hero, /<span class="q">B<\/span><span class="m">50<\/span>/);    // 40 own + 10 unassigned shared
    assert.match(hero, /Total production<\/span><span class="m">230<\/span>/);
  });
  test('Diff share is shown on its own and still counted once', () => {
    const t = load(ledger());
    t.vals.wg_from = '2026-09-28'; t.vals.wg_to = '2026-10-02';
    t.run('renderWages()');
    const aliCard = t.el('wagesWrap').innerHTML.match(/data-wg-emp="Ali"[^]*?data-wg-emp="Bilal"/)[0];
    assert.match(aliCard, /<td>B<\/td><td>40<\/td><td>5<\/td>/); // own 40, Diff share 5 (the 10 m is split between Ali and Bilal)
  });
  test('a person with earnings in the period is never left out, and with nothing set up the page says so', () => {
    const d = ledger(); d.employees.push(emp('Zahid', { active: false }));
    d.production.push(prod({ date: '2026-09-29', quality: 'B', qty: 20, e1: 'Zahid', e1m: 20 }));
    const t = load(d); t.vals.wg_from = '2026-09-28'; t.vals.wg_to = '2026-10-02'; t.run('renderWages()');
    assert.match(t.el('wagesWrap').innerHTML, /data-wg-emp="Zahid"/);
    const e = load({}); e.run('renderWages()');
    assert.match(e.el('wagesWrap').innerHTML, /Add employees and qualities/);
  });
});

describe('quick-entry sheet', () => {
  const setup = (kind) => {
    const t = load(ledger());
    t.vals.wg_from = '2026-09-28'; t.vals.wg_to = '2026-10-02';
    t.run(`WAGES_UI.sheet = { kind: '${kind}', emp: '', date: '2026-10-02' }`);
    return t;
  };
  test('Payment: suggests what is due for the period, with Period due / Full balance / Last paid chips', () => {
    const t = setup('pay'); t.vals.wq_emp = 'Ali'; t.run('wagesSheetFill(true)');
    assert.equal(t.el('wq_amt').value, '625'); // period earned 1225 - paid 600
    const chips = t.el('wq_chips').innerHTML;
    assert.match(chips, /Period due Rs 625\.00/); assert.match(chips, /Last paid Rs 600\.00/);
    assert.doesNotMatch(chips, /Full balance/); // same as the period due, so not repeated
  });
  test('Settle suggests the current balance and a Zero chip; Bonus has no default', () => {
    const s = setup('settle'); s.vals.wq_emp = 'Bilal'; s.run('wagesSheetFill(true)');
    assert.equal(s.el('wq_amt').value, '1485'); assert.match(s.el('wq_chips').innerHTML, /data-wq-amt="0">Zero</);
    const b = setup('bonus'); b.vals.wq_emp = 'Bilal'; b.run('wagesSheetFill(true)');
    assert.equal(b.el('wq_amt').value, ''); assert.match(b.el('wq_chips').innerHTML, /Last bonus Rs 500\.00/);
  });
  test('saving a payment adds the same record the Payments form adds, then moves to the next person who is due', async () => {
    const t = setup('pay'); Object.assign(t.vals, { wq_emp: 'Ali', wq_date: '2026-10-02', wq_amt: '650', wq_rem: 'cash' });
    await t.run('wagesSheetSave()');
    const pays = JSON.parse(t.run('JSON.stringify(DATA.wagePayments)'));
    assert.equal(pays.length, 2);
    assert.deepEqual({ ...pays[1], id: 'x' }, { id: 'x', date: '2026-10-02', employee: 'Ali', amount: 650, remarks: 'cash', periodFrom: '2026-09-28', periodTo: '2026-10-02' }); // plus the period the page was showing
    assert.equal(t.run('EDITING'), null, 'a half-finished edit on the old form is dropped');
    assert.match(t.log.toasts[0], /Paid Rs 650\.00 · Ali/);
    assert.equal(t.run('WAGES_UI.sheet.emp'), 'Bilal');     // Bilal is the next one still due
    assert.equal(t.log.tabs, 1);
  });
  test('a payment saved for a chosen period keeps that period', async () => {
    const t = setup('pay'); Object.assign(t.vals, { wq_emp: 'Ali', wq_date: '2026-10-02', wq_amt: '650', wg_from: '2026-09-25', wg_to: '2026-10-01' });
    await t.run('wagesSheetSave()');
    const p = JSON.parse(t.run('JSON.stringify(DATA.wagePayments)'))[1];
    assert.equal(p.periodFrom, '2026-09-25'); assert.equal(p.periodTo, '2026-10-01');
  });
  test('Pay is off for a period that is already paid in full, and on while anything is still due', () => {
    const t = setup('pay');
    assert.match(t.run("wagesPayBtn('Ali', {earned: 1000, paid: 1000, net: 0})"), /disabled[^>]*>Paid</);
    assert.doesNotMatch(t.run("wagesPayBtn('Ali', {earned: 1000, paid: 400, net: 600})"), /disabled/);
    assert.doesNotMatch(t.run("wagesPayBtn('Ali', {earned: 0, paid: 0, net: 0})"), /disabled/, 'nothing earned: not a paid period');
  });
  test('a paid card offers the receipt of its period\'s newest payment right there; an unpaid card does not', () => {
    const t = setup('pay');
    t.run("DATA.wagePayments.push({ id: 'p7', date: '2026-10-01', employee: 'Ali', amount: 10, remarks: '' }, { id: 'p8', date: '2026-10-20', employee: 'Ali', amount: 10, remarks: '' })");
    const paid = t.run("wagesPayBtn('Ali', {earned: 1000, paid: 1000, net: 0}, '2026-09-28', '2026-10-02')");
    assert.match(paid, /data-wage-share="p7"/);            // p8 is outside the period, p1 is older
    assert.doesNotMatch(t.run("wagesPayBtn('Ali', {earned: 1000, paid: 400, net: 600}, '2026-09-28', '2026-10-02')"), /data-wage-share/);
  });
  test('when nobody else is due the sheet closes; Bonus and Settle land in their own lists and stay open', async () => {
    const t = setup('pay'); Object.assign(t.vals, { wq_emp: 'Bilal', wq_date: '2026-10-02', wq_amt: '1485' });
    t.run("DATA.wagePayments.push({ id: 'p9', date: '2026-10-01', employee: 'Ali', amount: 650, remarks: '' })"); // Ali already square
    await t.run('wagesSheetSave()');
    assert.equal(t.run('WAGES_UI.sheet'), null);
    const b = setup('bonus'); Object.assign(b.vals, { wq_emp: 'Ali', wq_date: '2026-10-02', wq_amt: '200' });
    await b.run('wagesSheetSave()');
    assert.equal(JSON.parse(b.run('JSON.stringify(DATA.wageBonuses)')).length, 2);
    assert.ok(b.run('WAGES_UI.sheet') && b.run('WAGES_UI.sheet.kind') === 'bonus');
    const s = setup('settle'); Object.assign(s.vals, { wq_emp: 'Ali', wq_date: '2026-10-02', wq_amt: '-50' });
    await s.run('wagesSheetSave()');
    const st = JSON.parse(s.run('JSON.stringify(DATA.wageSettlements)'));
    assert.deepEqual({ ...st[0], id: 'x' }, { id: 'x', date: '2026-10-02', employee: 'Ali', carryForward: -50, remarks: '' });
  });
  test('missing employee or amount saves nothing; a change held for approval is not announced as paid', async () => {
    const t = setup('pay'); Object.assign(t.vals, { wq_emp: '', wq_date: '2026-10-02', wq_amt: '10' });
    await t.run('wagesSheetSave()');
    assert.equal(JSON.parse(t.run('JSON.stringify(DATA.wagePayments)')).length, 1);
    const h = setup('pay'); Object.assign(h.vals, { wq_emp: 'Ali', wq_date: '2026-10-02', wq_amt: '10' });
    h.run('save = async () => { DATA.wagePayments.pop(); }'); // what the proposals layer does: the ledger is put back
    await h.run('wagesSheetSave()');
    assert.equal(h.log.toasts.length, 0); assert.equal(h.run('WAGES_UI.sheet'), null);
  });
});

describe('new buttons follow the same permission rules as the old ones', () => {
  const vo = read('js/view-only.js'), html = read('index.html'), pw = read('js/panels-wages-receipts.js');
  test('the + and Pay buttons are write controls: blocked on view-only phones and need "add" on Wages', () => {
    assert.match(vo, /VIEW_ONLY_WRITE_SELECTOR[^]*\[data-wage-add\]/);
    assert.match(vo, /has\('data-wage-add'\)\) return \{ sec: 'wages', letter: 'a' \}/);
    assert.ok(html.includes('body.view-only [data-wage-add]'));
    assert.equal((vo.match(/\[data-wage-add\]/g) || []).length >= 3, true);
  });
  test('the sheet Save button sits in a .form-actions block (hidden and blocked where the role cannot add or edit)', () => {
    const w = read('js/wages-ui.js');
    assert.match(w, /<div class="form-actions"><button type="button" class="primary" id="wq_save">/);
  });
  test('the old forms and their ids are all still on the page', () => {
    ['wp_emp', 'wp_amt', 'wb_emp', 'ws_emp', 'ws_carry', 'rc_quality', 'saveRateChange', 'wg_rateRowsBody', 'wg_rateHistoryWrap', 'addWagePayment', 'addWageBonus', 'addWageSettlement', 'settleAllEmployees', 'saveOpeningBalances']
      .forEach((id) => assert.ok(pw.includes(`id="${id}"`) || pw.includes(`'${id}'`) || pw.includes(`"${id}"`), id));
    assert.ok(read('js/wages-ui.js').includes('id="wg_from"') && read('js/wages-ui.js').includes('id="wg_to"'));
  });
});
