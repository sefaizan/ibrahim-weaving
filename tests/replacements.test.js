'use strict';
/*
 * Replacing a bounced cheque: a payment can say "this much of me replaces that cheque".
 * The link changes no money figure — these tests check the bookkeeping around it: what can be
 * linked, what is refused, how cheque statuses follow the links, and how old (unlinked)
 * Replaced cheques are found and matched.
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, sale, payment, cheque, closeTo } = require('./helpers/load-app');

const app = loadApp();

// A client whose 200k cheque bounced on 5 Sep and who paid 500k on 12 Sep, 200k of it to make it good.
function scenario(){
  const bounced = cheque(200, 'Bounced', { id: 'c-bad', chequeNo: '140', bank: 'Meezan Bank', owner: 'M Sajid' });
  const first = payment({ id: 'p1', date: '2026-09-05', cashAmount: 75, cheques: [bounced, cheque(225, 'Cleared', { id: 'c-ok' })] });
  const second = payment({ id: 'p2', date: '2026-09-12', cashAmount: 500 });
  app.setData({ sale: [sale({ id: 's1', date: '2026-08-01', amount: 2000 })], recovery: [first, second] });
  return { first, second };
}
const status = (rid, cid) => app.findCheque(rid, cid).cheque.status;
const rec = id => app.replacementLinks().filter(l => l.paymentId === id);

describe('what a payment can replace', () => {
  test('lists the same client\'s Bounced cheques, nothing else', () => {
    scenario();
    const other = payment({ id: 'p3', client: 'B', date: '2026-09-06', cheques: [cheque(50, 'Bounced', { id: 'c-b' })] });
    const pending = payment({ id: 'p4', date: '2026-09-07', cheques: [cheque(60, 'Pending', { id: 'c-pend' })] });
    app.setData({ sale: [], recovery: [payment({ id: 'p1', date: '2026-09-05', cheques: [cheque(200, 'Bounced', { id: 'c-bad' }), cheque(10, 'Cleared', { id: 'c-ok' })] }), other, pending] });
    const list = app.replaceableCheques('A', null);
    assert.deepEqual(list.map(x => x.chequeId), ['c-bad']);
    closeTo(list[0].owed, 200);
  });
  test('a payment is never offered its own cheque', () => {
    scenario();
    assert.equal(app.replaceableCheques('A', 'p1').length, 0);
  });
  test('a cheque already fully replaced is not offered again, but stays listed for the payment that replaces it', () => {
    scenario();
    assert.equal(app.linkReplacement('p2', 'p1', 'c-bad', 200).ok, true);
    assert.equal(status('p1', 'c-bad'), 'Replaced');
    assert.equal(app.replaceableCheques('A', null).length, 0);
    const forEdit = app.replaceableCheques('A', 'p2');
    assert.equal(forEdit.length, 1);
    closeTo(forEdit[0].owed, 200, 'still owed before counting p2\'s own share');
  });
});

describe('what is refused', () => {
  test('more than is still owed on the cheque', () => {
    scenario();
    assert.match(app.checkReplacementLinks('p2', 'A', 500, [{ recoveryId: 'p1', chequeId: 'c-bad', amount: 250 }]), /Only Rs 200 .* still owed/);
  });
  test('more than the payment itself', () => {
    scenario();
    assert.match(app.checkReplacementLinks('p2', 'A', 150, [{ recoveryId: 'p1', chequeId: 'c-bad', amount: 200 }]), /more than this payment/);
  });
  test('a zero amount, another client\'s cheque, its own cheque, a cheque that is gone', () => {
    scenario();
    assert.match(app.checkReplacementLinks('p2', 'A', 500, [{ recoveryId: 'p1', chequeId: 'c-bad', amount: 0 }]), /Enter how much/);
    assert.match(app.checkReplacementLinks('p2', 'B', 500, [{ recoveryId: 'p1', chequeId: 'c-bad', amount: 10 }]), /different client/);
    assert.match(app.checkReplacementLinks('p1', 'A', 500, [{ recoveryId: 'p1', chequeId: 'c-bad', amount: 10 }]), /own cheque/);
    assert.match(app.checkReplacementLinks('p2', 'A', 500, [{ recoveryId: 'p1', chequeId: 'nope', amount: 10 }]), /no longer exists/);
  });
  test('a valid link passes', () => {
    scenario();
    assert.equal(app.checkReplacementLinks('p2', 'A', 500, [{ recoveryId: 'p1', chequeId: 'c-bad', amount: 200 }]), null);
  });
});

describe('cheque status follows the links', () => {
  test('fully replaced -> Replaced; a part payment leaves it Bounced until the rest arrives', () => {
    scenario();
    app.linkReplacement('p2', 'p1', 'c-bad', 120);
    assert.equal(status('p1', 'c-bad'), 'Bounced');
    closeTo(app.chequeStillOwed('p1', 'c-bad'), 80);
    const third = payment({ id: 'p5', date: '2026-09-15', cashAmount: 100 });
    app.setData({ ...appData(), recovery: appData().recovery.concat([third]) });
    assert.equal(app.linkReplacement('p5', 'p1', 'c-bad', 80).ok, true);
    assert.equal(status('p1', 'c-bad'), 'Replaced');
  });
  test('deleting the replacing payment puts the cheque back to Bounced', () => {
    scenario();
    app.linkReplacement('p2', 'p1', 'c-bad', 200);
    const oldLinks = rec('p2');
    app.setData({ ...appData(), recovery: appData().recovery.filter(r => r.id !== 'p2') });   // the delete
    app.settleReplacementLinks(oldLinks, [], null);
    assert.equal(status('p1', 'c-bad'), 'Bounced');
  });
  test('editing the link down (or removing it) re-opens the cheque', () => {
    scenario();
    app.linkReplacement('p2', 'p1', 'c-bad', 200);
    const old = rec('p2');
    app.replacePayment('p2', p => { p.replaces = [{ recoveryId: 'p1', chequeId: 'c-bad', amount: 150 }]; });
    app.settleReplacementLinks(old, rec('p2'), 'p2');
    assert.equal(status('p1', 'c-bad'), 'Bounced');
    const old2 = rec('p2');
    app.replacePayment('p2', p => { delete p.replaces; });
    app.settleReplacementLinks(old2, [], 'p2');
    assert.equal(status('p1', 'c-bad'), 'Bounced');
    assert.equal(rec('p2').length, 0);
  });
  test('a cheque marked Replaced by hand is left alone when nothing links to it', () => {
    scenario();
    app.replacePayment('p1', p => { p.cheques[0].status = 'Replaced'; });
    app.settleReplacementLinks([], [], 'p1');
    assert.equal(status('p1', 'c-bad'), 'Replaced');
  });
  test('if the cheque row is removed from its payment, links to it are dropped', () => {
    scenario();
    app.linkReplacement('p2', 'p1', 'c-bad', 200);
    app.replacePayment('p1', p => { p.cheques = p.cheques.filter(c => c.id !== 'c-bad'); });
    app.settleReplacementLinks([], [], 'p1');
    assert.equal(rec('p2').length, 0);
  });
});

describe('no money figure moves', () => {
  test('Receivable, Received and the statement are the same with or without the link', () => {
    scenario();
    const before = { recv: app.recoveryReceivableAmount(appData().recovery[0]) + app.recoveryReceivableAmount(appData().recovery[1]),
      close: app.buildClientLedger('A').closingBalance, bounced: app.recoveryBouncedAmount(appData().recovery[0]) };
    app.linkReplacement('p2', 'p1', 'c-bad', 200);    // also flips the cheque Bounced -> Replaced
    const after = { recv: app.recoveryReceivableAmount(appData().recovery[0]) + app.recoveryReceivableAmount(appData().recovery[1]),
      close: app.buildClientLedger('A').closingBalance };
    closeTo(after.recv, before.recv, 'received');
    // the only change: the 200 is no longer in the Bounced bucket (it has been made good) -- receivable itself is unchanged
    closeTo(after.close, before.close, 'statement closing balance');
    assert.equal(app.recoveryBouncedAmount(appData().recovery[0]), 0);
  });
});

describe('older Replaced cheques with no linked payment', () => {
  test('are listed, with the payments that could be the one', () => {
    const { first } = scenario();
    app.replacePayment('p1', p => { p.cheques[0].status = 'Replaced'; });
    const list = app.uncoveredReplacedCheques();
    assert.equal(list.length, 1);
    closeTo(list[0].missing, 200);
    const sug = app.suggestReplacementPayments('p1', 'c-bad');
    assert.deepEqual(sug.map(x => x.paymentId), ['p2']);
  });
  test('a payment dated before the cheque, or too small, is not suggested', () => {
    scenario();
    app.replacePayment('p1', p => { p.cheques[0].status = 'Replaced'; });
    const early = payment({ id: 'p0', date: '2026-08-20', cashAmount: 900 });
    const tiny = payment({ id: 'p6', date: '2026-09-20', cashAmount: 50 });
    app.setData({ ...appData(), recovery: [early].concat(appData().recovery, [tiny]) });
    assert.deepEqual(app.suggestReplacementPayments('p1', 'c-bad').map(x => x.paymentId), ['p2']);
  });
  test('confirming a match links it, and the cheque drops off the list', () => {
    scenario();
    app.replacePayment('p1', p => { p.cheques[0].status = 'Replaced'; });
    assert.equal(app.linkReplacement('p2', 'p1', 'c-bad', 200).ok, true);
    assert.equal(app.uncoveredReplacedCheques().length, 0);
    assert.equal(status('p1', 'c-bad'), 'Replaced');
  });
  test('the same payment cannot be used twice beyond its value', () => {
    scenario();
    const b2 = cheque(400, 'Replaced', { id: 'c-2', chequeNo: '141' });
    app.replacePayment('p1', p => { p.cheques[0].status = 'Replaced'; p.cheques.push(b2); });
    assert.equal(app.linkReplacement('p2', 'p1', 'c-bad', 200).ok, true);
    const r = app.linkReplacement('p2', 'p1', 'c-2', 400);
    assert.equal(r.ok, false); assert.match(r.error, /more than this payment/);
  });
});

describe('what each side of the link can say', () => {
  test('the replacing payment says what it replaces; the cheque\'s payment says what replaced it', () => {
    scenario();
    app.linkReplacement('p2', 'p1', 'c-bad', 200);
    const a = app.replacementNotes('p2');
    assert.equal(a.replaces.length, 1);
    assert.equal(a.replaces[0].chequeNo, '140'); closeTo(a.replaces[0].amount, 200);
    const b = app.replacementNotes('p1');
    assert.equal(b.replacedBy.length, 1);
    assert.equal(b.replacedBy[0].chequeNo, '140');
    assert.deepEqual(b.replacedBy[0].by.map(x => x.paymentId), ['p2']);
    assert.equal(app.replacementNotes('nope').replaces.length, 0);
  });
});

// helpers that reach into the loaded app's data (calc.js keeps it in a sandbox)
function appData(){ return app.getData(); }
