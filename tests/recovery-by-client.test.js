'use strict';
/*
 * Recovery page, "Received by Client" (3.17.40): who paid how much in the chosen period, biggest first,
 * split by cash / bank / cheque, using the same "received" amount as everywhere else (bounced and
 * replaced cheques are left out). Runs the real calc.js plus the card's own functions from panels-daily.js.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { emptyData } = require('./helpers/load-app');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function load(recovery, today = '2026-10-02', extra = {}) { // a Friday: this wage week = 2026-10-02 .. 2026-10-08
  const src = read('js/panels-daily.js');
  const card = src.slice(src.indexOf('/* ---------------- Recovery: "Received by Client"'), src.indexOf('function recoveryPanel(){'));
  assert.ok(card.length > 500, 'the Received by Client functions are in panels-daily.js');
  const ctx = vm.createContext({
    DATA: Object.assign(emptyData(), { recovery }, extra), FILTER: {},
    todayStr: () => today, nowStr: () => '12:00', recoveryDescription: () => 'Payment', fmtQtyMtr: String,
    fmtRs: (n) => 'Rs ' + Math.round(n || 0), fmtDate: (d) => d, escHtml: (s) => String(s),
  });
  vm.runInContext(read('js/calc.js'), ctx);
  vm.runInContext(card, ctx);
  return { ctx, run: (c) => vm.runInContext(c, ctx) };
}
const rec = (o) => ({ id: 'r' + Math.random(), time: '10:00', ...o });
const data = () => [
  rec({ date: '2026-10-02', client: 'Zaid', cashAmount: 1000, bankAmount: 500, cheques: [] }),
  rec({ date: '2026-10-03', client: 'Amir', cashAmount: 0, bankAmount: 0, cheques: [{ id: 'c1', amount: 4000, status: 'Pending' }, { id: 'c2', amount: 900, status: 'Bounced' }, { id: 'c3', amount: 700, status: 'Replaced' }] }),
  rec({ date: '2026-10-04', client: 'Zaid', cashAmount: 250, bankAmount: 0, cheques: [] }),
  rec({ date: '2026-09-20', client: 'Old', cashAmount: 9999, bankAmount: 0, cheques: [] }),   // outside this week
];

describe('Received by Client', () => {
  test('this week: biggest payer first, bounced/replaced cheques left out, Zaid\'s two payments added', () => {
    const { run } = load(data());
    const rows = JSON.parse(run('JSON.stringify(recoveryByClientData(recoveryPeriods()[0]))'));
    assert.deepEqual(rows.map((r) => [r.name, r.total, r.cash, r.bank, r.cheque, r.count]),
      [['Amir', 4000, 0, 0, 4000, 1], ['Zaid', 1750, 1250, 500, 0, 2]]);
  });
  test('total equals the sum of Received for the same records', () => {
    const { run } = load(data());
    const tot = run('recoveryByClientData(recoveryPeriods()[0]).reduce((s,o)=>s+o.total,0)');
    const exp = run("DATA.recovery.filter(r=>r.date>='2026-10-02'&&r.date<='2026-10-08').reduce((s,r)=>s+recoveryReceivableAmount(r),0)");
    assert.equal(tot, exp);
  });
  test('periods: this week, last week, this month, all time', () => {
    const { run } = load(data());
    const p = JSON.parse(run('JSON.stringify(recoveryPeriods())'));
    assert.deepEqual(p.map((x) => [x.id, x.from, x.to]), [['week', '2026-10-02', '2026-10-08'], ['last', '2026-09-25', '2026-10-01'], ['month', '2026-10-01', '2026-10-31'], ['all', '', '']]);
    assert.equal(run('recoveryByClientData(recoveryPeriods()[3]).length'), 3);               // Old shows up under All time
    assert.equal(run('recoveryByClientData(recoveryPeriods()[1]).length'), 0);
  });
  test('card shows rank, share, split line and total; chip choice is remembered; empty period says so', () => {
    const { run } = load(data());
    const html = run('recoveryByClientCardHtml()');
    assert.match(html, /Received by Client/); assert.match(html, /Rs 5750/);
    assert.match(html, /<span class="nm">Amir<\/span>/); assert.match(html, /Cash Rs 1250 · Bank Rs 500/); assert.match(html, /70%/);
    assert.match(html, /data-rcp="week"/);
    run("FILTER.recoveryPeriod = 'last'");
    assert.match(run('recoveryByClientCardHtml()'), /No payments received in this period/);
  });
  test('no recovery entries at all: no card', () => {
    assert.equal(load([]).run('recoveryByClientCardHtml()'), '');
  });
});

describe('payment form: client balance line (3.17.41)', () => {
  const sale = [{ id: 's1', date: '2026-09-01', client: 'Zaid', amount: 10000 }, { id: 's2', date: '2026-09-02', client: 'Amir', amount: 500 }];
  test('outstanding = sales - received - bounced; editing leaves the edited payment out', () => {
    const rows = [
      rec({ id: 'p1', date: '2026-10-02', client: 'Zaid', cashAmount: 3000, bankAmount: 0, cheques: [] }),
      rec({ id: 'p2', date: '2026-10-03', client: 'Zaid', cashAmount: 0, bankAmount: 0, cheques: [{ id: 'c', amount: 1000, status: 'Bounced' }] }),
    ];
    const { run } = load(rows, '2026-10-02', { sale });
    assert.deepEqual(JSON.parse(run("JSON.stringify(clientOutstanding('Zaid'))")), { receivable: 6000, bounced: 1000 });
    assert.equal(run("clientOutstanding('Zaid', 'p1').receivable"), 9000);                    // p1 not counted while it is edited
  });
  test('line shows outstanding with Bank / Cash fill buttons, paid ahead without them, nothing for no client', () => {
    const { run } = load([rec({ id: 'p1', date: '2026-10-02', client: 'Amir', cashAmount: 800, bankAmount: 0, cheques: [] })], '2026-10-02', { sale });
    const owes = run("recoveryClientInfoHtml('Zaid')");
    assert.match(owes, /Outstanding <b>Rs 10000<\/b>/); assert.match(owes, /data-rfill="bank"/); assert.match(owes, /data-rfill="cash"/);
    const ahead = run("recoveryClientInfoHtml('Amir')");
    assert.match(ahead, /Paid ahead <b>Rs 300<\/b>/); assert.doesNotMatch(ahead, /data-rfill/);
    assert.equal(run("recoveryClientInfoHtml('')"), '');
  });
});
