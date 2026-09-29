'use strict';
/*
 * Edit stamps (js/cloud-sync.js): saves stamp changed records with _mt (when) and _mb (who), new records with
 * _ct (when) and _cb (who), and a merge keeps the more recently edited copy when the same record was edited on
 * both devices. Also the Info button text (js/panels-wages-receipts.js) and that it works on a view-only phone.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let ctx;
function load(){
  ctx = vm.createContext({ console, Date, Math, JSON, Object, Array, Set, Map, Number, String });
  vm.runInContext('var DATA = {};', ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud-sync.js'), 'utf8'), ctx);
}
const run = code => vm.runInContext(code, ctx);
const set = obj => run(`DATA = ${JSON.stringify(obj)}; tombRebaseline();`);
const data = () => JSON.parse(run('JSON.stringify(DATA)'));
const merge = (l, r) => JSON.parse(run(`JSON.stringify(mergeLedgers(${JSON.stringify(l)}, ${JSON.stringify(r)}))`));
beforeEach(load);

describe('stamping edits on save', () => {
  test('an edited record gets _mt; untouched and new records do not', () => {
    set({ sale: [{ id: 'a', amount: 1 }, { id: 'b', amount: 5 }] });
    run(`DATA.sale[0].amount = 2; DATA.sale.push({ id: 'n' }); tombRecordDeletions();`);
    const [a, b, n] = data().sale;
    assert.ok(a._mt > 0);
    assert.equal(b._mt, undefined);
    assert.equal(n._mt, undefined);
  });
  test('a save with nothing changed stamps nothing, and an old stamp is not refreshed', () => {
    set({ sale: [{ id: 'a', amount: 1, _mt: 1000 }] });
    run('tombRecordDeletions(); tombRecordDeletions();');
    assert.equal(data().sale[0]._mt, 1000);
  });
  test('after a whole-ledger replace nothing is stamped', () => {
    set({ sale: [{ id: 'a', amount: 1 }] });
    run(`tombResetBaseline(); DATA = { sale: [{ id: 'a', amount: 99 }] }; tombRecordDeletions();`);
    assert.equal(data().sale[0]._mt, undefined);
  });
  test('lists without ids are never stamped', () => {
    set({ loomAssignments: [{ loom: 'L1', e1: 'x' }] });
    run(`DATA.loomAssignments[0].e1 = 'y'; tombRecordDeletions();`);
    assert.equal(data().loomAssignments[0]._mt, undefined);
  });
});

describe('merge keeps the newer edit', () => {
  test('other device edited later -> its copy wins', () => {
    const m = merge({ sale: [{ id: 'a', amount: 1, _mt: 100 }] }, { sale: [{ id: 'a', amount: 2, _mt: 200 }] });
    assert.equal(m.sale[0].amount, 2);
  });
  test('this device edited later -> its copy wins', () => {
    const m = merge({ sale: [{ id: 'a', amount: 1, _mt: 300 }] }, { sale: [{ id: 'a', amount: 2, _mt: 200 }] });
    assert.equal(m.sale[0].amount, 1);
  });
  test('stamped beats unstamped in either direction', () => {
    assert.equal(merge({ sale: [{ id: 'a', amount: 1 }] }, { sale: [{ id: 'a', amount: 2, _mt: 5 }] }).sale[0].amount, 2);
    assert.equal(merge({ sale: [{ id: 'a', amount: 1, _mt: 5 }] }, { sale: [{ id: 'a', amount: 2 }] }).sale[0].amount, 1);
  });
  test('cannot tell (both unstamped, or equal times) -> this device wins', () => {
    assert.equal(merge({ sale: [{ id: 'a', amount: 1 }] }, { sale: [{ id: 'a', amount: 2 }] }).sale[0].amount, 1);
    assert.equal(merge({ sale: [{ id: 'a', amount: 1, _mt: 7 }] }, { sale: [{ id: 'a', amount: 2, _mt: 7 }] }).sale[0].amount, 1);
  });
  test('records only on one side are kept, and different records do not interfere', () => {
    const m = merge({ sale: [{ id: 'a', v: 1, _mt: 9 }, { id: 'x' }] }, { sale: [{ id: 'a', v: 2, _mt: 1 }, { id: 'y' }] });
    assert.deepEqual(m.sale.map(r => r.id).sort(), ['a', 'x', 'y']);
    assert.equal(m.sale.find(r => r.id === 'a').v, 1);
  });
});

describe('who and when: _mb, _ct, _cb', () => {
  const signIn = email => run(`CLOUD_USER = { email: ${JSON.stringify(email)}, verified: true };`);
  test('an edit is stamped with the signed-in email (lower case) and time', () => {
    signIn('Editor@Example.com');
    set({ sale: [{ id: 'a', amount: 1 }] });
    run(`DATA.sale[0].amount = 2; tombRecordDeletions();`);
    const a = data().sale[0];
    assert.equal(a._mb, 'editor@example.com');
    assert.ok(a._mt > 0);
  });
  test('a new record gets _ct and _cb, and no edit stamp', () => {
    signIn('adder@example.com');
    set({ sale: [{ id: 'a', amount: 1 }] });
    run(`DATA.sale.push({ id: 'n', amount: 9 }); tombRecordDeletions();`);
    const n = data().sale[1];
    assert.equal(n._cb, 'adder@example.com');
    assert.ok(n._ct > 0);
    assert.equal(n._mt, undefined);
    assert.equal(n._mb, undefined);
  });
  test('editing a new record later adds the edit stamp and keeps who added it', () => {
    signIn('adder@example.com');
    set({ sale: [] });
    run(`DATA.sale.push({ id: 'n', amount: 9 }); tombRecordDeletions();`);
    signIn('other@example.com');
    run(`DATA.sale[0].amount = 10; tombRecordDeletions();`);
    const n = data().sale[0];
    assert.equal(n._cb, 'adder@example.com');
    assert.equal(n._mb, 'other@example.com');
  });
  test('the stamps themselves never count as an edit', () => {
    signIn('a@example.com');
    set({ sale: [{ id: 'a', amount: 1, _ct: 5, _cb: 'x@example.com', _mt: 6, _mb: 'y@example.com' }] });
    run('tombRecordDeletions(); tombRecordDeletions();');
    const a = data().sale[0];
    assert.equal(a._mt, 6); assert.equal(a._mb, 'y@example.com'); assert.equal(a._ct, 5);
  });
  test('with no account on the phone the time is still stamped, without an email', () => {
    set({ sale: [{ id: 'a', amount: 1 }] });
    run(`DATA.sale[0].amount = 2; DATA.sale.push({ id: 'n' }); tombRecordDeletions();`);
    const [a, n] = data().sale;
    assert.ok(a._mt > 0); assert.equal(a._mb, undefined);
    assert.ok(n._ct > 0); assert.equal(n._cb, undefined);
  });
  test('a record that comes back (Undo of a delete) keeps its original added stamp', () => {
    signIn('a@example.com');
    set({ sale: [{ id: 'a', amount: 1, _ct: 5, _cb: 'first@example.com' }] });
    run(`const r = DATA.sale.pop(); tombRecordDeletions(); DATA.sale.push(r); tombRecordDeletions();`);
    const a = data().sale[0];
    assert.equal(a._ct, 5); assert.equal(a._cb, 'first@example.com');
  });
  test('after a whole-ledger replace nothing is stamped as new', () => {
    signIn('a@example.com');
    set({ sale: [{ id: 'a' }] });
    run(`tombResetBaseline(); DATA = { sale: [{ id: 'a' }, { id: 'b' }] }; tombRecordDeletions();`);
    assert.equal(data().sale[1]._ct, undefined);
  });
  test('a merge still decides by _mt only', () => {
    const m = merge({ sale: [{ id: 'a', amount: 1, _ct: 999 }] }, { sale: [{ id: 'a', amount: 2, _mt: 5 }] });
    assert.equal(m.sale[0].amount, 2);
  });
});

describe('the Info button', () => {
  const root = path.join(__dirname, '..');
  const src = fs.readFileSync(path.join(root, 'js', 'panels-wages-receipts.js'), 'utf8');
  function loadInfo(){
    const c = vm.createContext({ Date, Number, String, Object, Array, JSON });
    const block = src.slice(src.indexOf('function recStampWhen'), src.indexOf('let _recInfoTimer'));
    vm.runInContext(block, c);
    return c;
  }
  const lines = rec => JSON.parse(vm.runInContext(`JSON.stringify(recStampLines(${JSON.stringify(rec)}))`, loadInfo()));
  test('added and edited by different people', () => {
    const l = lines({ id: 'a', _cb: 'x@example.com', _ct: 1790000000000, _mb: 'y@example.com', _mt: 1790003600000 });
    assert.match(l[0], /^Added by x@example\.com \u00B7 .*2026/);
    assert.match(l[1], /^Last edited by y@example\.com \u00B7 .*2026/);
  });
  test('added but never edited', () => {
    const l = lines({ id: 'a', _cb: 'x@example.com', _ct: 1790000000000 });
    assert.equal(l[1], 'Not edited since it was added');
  });
  test('edited, but added before history was recorded', () => {
    const l = lines({ id: 'a', _mb: 'y@example.com', _mt: 1790003600000 });
    assert.equal(l[0], 'Added before history was recorded');
    assert.match(l[1], /^Last edited by y@example\.com/);
  });
  test('an old entry with no stamps, and an entry that is gone', () => {
    assert.deepEqual(lines({ id: 'a', amount: 1 }), ['No history recorded for this entry.']);
    assert.deepEqual(lines(null), ['This entry could not be found.']);
  });
  test('a time without an email still shows the time', () => {
    const l = lines({ id: 'a', _ct: 1790000000000 });
    assert.match(l[0], /^Added \u00B7 /);
  });
  test('searching a list does not match the stamps', () => {
    const c = vm.createContext({ Object, JSON, String });
    vm.runInContext(src.slice(src.indexOf('function recordMatchesSearch'), src.indexOf('// Renders a paginated, searchable log table')), c);
    const hit = (rec, term) => vm.runInContext(`recordMatchesSearch(${JSON.stringify(rec)}, ${JSON.stringify(term)})`, c);
    assert.equal(hit({ id: 'a', client: 'Javed', _cb: 'x@gmail.com', _mb: 'y@gmail.com' }, 'gmail'), false);
    assert.equal(hit({ id: 'a', client: 'Javed', _cb: 'x@gmail.com' }, 'javed'), true);
  });
  test('every row gets the button, it only reads (not in the view-only write list), and the tap is wired', () => {
    assert.match(src, /function actionBtns\(key,id\)\{ return `<span class="row-actions">\$\{infoBtn\(key,id\)\}/);
    const vo = fs.readFileSync(path.join(root, 'js', 'view-only.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(!vo.includes('data-rec-info'));
    assert.ok(!/body\.view-only[^{]*data-rec-info/.test(html));
    assert.match(fs.readFileSync(path.join(root, 'js', 'lock-init.js'), 'utf8'), /data-rec-info/);
  });
});
