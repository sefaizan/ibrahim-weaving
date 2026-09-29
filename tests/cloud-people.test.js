'use strict';
/*
 * Approving people from the app (js/cloud-sync.js, "Approving people" and the "People who can view"
 * block in Settings > Cloud Sync): owner-only approve / extend / remove, everyone approved is
 * view-only, the record is only written when the change is valid, and the screen shows the right
 * things to the right person. A fake Firestore and a tiny fake page stand in for the real ones.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const OWNER = 'se.muhammadfaizan@gmail.com';
const DAY = 86400000;
const NOW = new Date(2026, 8, 30, 12, 0, 0).getTime(); // 30 Sep 2026, midday on this machine's clock

let ctx, store, docs, sets, gets, page, timers, failSet;
function load(opts){
  opts = opts || {};
  store = new Map(); docs = new Map(); sets = []; gets = 0; timers = []; failSet = !!opts.failSet;
  if(opts.record) docs.set('config/access', opts.record);
  page = {
    cloudPeopleEmail: { value: '' }, cloudPeopleDate: { value: '' }, cloudPeopleAddBtn: { disabled: false },
    cloudPeopleMsg: { textContent: '', style: {} },
    cloudPeopleList: { innerHTML: '', querySelectorAll: () => [] },
  };
  const db = { collection: c => ({ doc: d => ({
    async get(){ gets++; const k = c + '/' + d; return { exists: docs.has(k), data: () => docs.get(k) }; },
    async set(v){ if(failSet){ const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; } sets.push({ path: c + '/' + d, value: v }); docs.set(c + '/' + d, JSON.parse(JSON.stringify(v))); },
  }) }) };
  ctx = vm.createContext({
    console: { log(){}, error(){} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout(){}, setInterval(){},
    navigator: { onLine: opts.online !== false },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { getElementById: id => page[id] || null, createElement: () => ({ style: {}, setAttribute(){}, appendChild(){}, remove(){} }), body: { appendChild(){} }, addEventListener(){} },
    escHtml: x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    switchTab(){}, encEnabled: () => false, __db: db,
  });
  vm.runInContext(`var DATA = {};`, ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud-sync.js'), 'utf8'), ctx);
  vm.runInContext(`cloudSdkReady = async () => __db;`, ctx); // the real one needs Firebase's SDK
}
const run = code => vm.runInContext(code, ctx);
const j = v => JSON.parse(JSON.stringify(v)); // copy out of the sandbox so deepEqual compares plain objects
const signIn = (email, verified) => store.set('khata-cloud-user', JSON.stringify({ email, verified: verified !== false }));
const record = approved => ({ ownerEmail: OWNER, approved: approved || {}, updatedAt: '2026-09-01T00:00:00.000Z' });
beforeEach(() => load());

describe('the email and the date', () => {
  test('emails are trimmed and lower-cased; blank, malformed and the owner\'s own are refused', () => {
    assert.equal(run(`cloudAccessNormEmail('  Viewer@Example.COM ')`), 'viewer@example.com');
    assert.throws(() => run(`cloudAccessNormEmail('   ')`), /Enter their email/);
    assert.throws(() => run(`cloudAccessNormEmail('nobody')`), /doesn't look right/);
    assert.throws(() => run(`cloudAccessNormEmail('a b@c.com')`), /doesn't look right/);
    assert.throws(() => run(`cloudAccessNormEmail('${OWNER.toUpperCase()}')`), /your own account/);
  });
  test('the end date means the last moment of that day; today, the past and nonsense are refused', () => {
    const ms = run(`cloudAccessParseDate('2026-10-15', ${NOW})`);
    assert.equal(ms, new Date(2026, 9, 15, 23, 59, 59, 999).getTime());
    assert.equal(run(`cloudAccessParseDate('2026-09-30', ${NOW})`), new Date(2026, 8, 30, 23, 59, 59, 999).getTime(), 'today is allowed until midnight');
    assert.throws(() => run(`cloudAccessParseDate('2026-09-29', ${NOW})`), /after today/);
    assert.throws(() => run(`cloudAccessParseDate('', ${NOW})`), /Pick the date/);
    assert.throws(() => run(`cloudAccessParseDate('15/10/2026', ${NOW})`), /Pick the date/);
  });
  test('the date box starts 30 days ahead', () => {
    assert.equal(run(`cloudAccessDefaultDate(${NOW})`), '2026-10-30');
  });
});

describe('approve, extend, remove (pure)', () => {
  test('a new person is view-only, with the date and the day they were added; others are kept; the owner is pinned', () => {
    const rec = record({ 'old@example.com': { expiresAt: NOW + DAY, write: false, addedAt: 1 } });
    const out = j(run(`cloudAccessApplyApprove(${JSON.stringify(rec)}, ' New@Example.com ', ${NOW + 30 * DAY}, ${NOW})`));
    assert.equal(out.email, 'new@example.com'); assert.equal(out.updated, false);
    assert.deepEqual(out.record.approved['new@example.com'], { expiresAt: NOW + 30 * DAY, write: false, addedAt: NOW });
    assert.deepEqual(out.record.approved['old@example.com'], rec.approved['old@example.com']);
    assert.equal(out.record.ownerEmail, OWNER);
    assert.equal(out.record.updatedAt, new Date(NOW).toISOString());
    assert.equal(typeof out.record.approved['new@example.com'].expiresAt, 'number', 'the rules compare it as a number');
    assert.equal(out.record.approved['new@example.com'].write, false, 'the rules want a real boolean');
  });
  test('approving someone already on the list changes the date, keeps when they were added, and never adds write access', () => {
    const rec = record({ 'a@example.com': { expiresAt: NOW - DAY, write: false, addedAt: 5 }, 'b@example.com': { expiresAt: NOW + DAY, write: true, addedAt: 6 } });
    const a = j(run(`cloudAccessApplyApprove(${JSON.stringify(rec)}, 'A@example.com', ${NOW + 10 * DAY}, ${NOW})`));
    assert.equal(a.updated, true);
    assert.deepEqual(a.record.approved['a@example.com'], { expiresAt: NOW + 10 * DAY, write: false, addedAt: 5 });
    const b = j(run(`cloudAccessApplyApprove(${JSON.stringify(rec)}, 'b@example.com', ${NOW + 10 * DAY}, ${NOW})`));
    assert.equal(b.record.approved['b@example.com'].write, true, 'a date change never takes write access away or gives it');
  });
  test('the record passed in is not changed', () => {
    const rec = record({ 'a@example.com': { expiresAt: NOW + DAY, write: false, addedAt: 5 } });
    const before = JSON.stringify(rec);
    run(`(function(r){ cloudAccessApplyApprove(r, 'x@example.com', ${NOW + DAY}, ${NOW}); cloudAccessApplyExtend(r, 'a@example.com', ${NOW}); cloudAccessApplyRemove(r, 'a@example.com', ${NOW}); })(${before})`);
    const r2 = j(run(`(function(r){ cloudAccessApplyRemove(r, 'a@example.com', ${NOW}); return r; })(${before})`));
    assert.deepEqual(r2, rec);
  });
  test('a record with no approved map at all still works', () => {
    const out = j(run(`cloudAccessApplyApprove({ ownerEmail: '${OWNER}' }, 'a@example.com', ${NOW + DAY}, ${NOW})`));
    assert.deepEqual(Object.keys(out.record.approved), ['a@example.com']);
  });
  test('extending adds 30 days after the later of today and their end date', () => {
    const rec = record({ 'soon@example.com': { expiresAt: NOW + 5 * DAY, write: false, addedAt: 1 }, 'gone@example.com': { expiresAt: NOW - 20 * DAY, write: false, addedAt: 1 } });
    const s = j(run(`cloudAccessApplyExtend(${JSON.stringify(rec)}, 'soon@example.com', ${NOW})`));
    assert.equal(s.record.approved['soon@example.com'].expiresAt, NOW + 35 * DAY);
    const g = j(run(`cloudAccessApplyExtend(${JSON.stringify(rec)}, 'gone@example.com', ${NOW})`));
    assert.equal(g.record.approved['gone@example.com'].expiresAt, NOW + 30 * DAY, 'an expired approval restarts from today');
    assert.equal(g.record.approved['gone@example.com'].write, false);
    assert.throws(() => run(`cloudAccessApplyExtend(${JSON.stringify(rec)}, 'nobody@example.com', ${NOW})`), /no longer on the list/);
  });
  test('removing takes only that person off the list', () => {
    const rec = record({ 'a@example.com': { expiresAt: NOW + DAY, write: false }, 'b@example.com': { expiresAt: NOW + DAY, write: false } });
    const out = j(run(`cloudAccessApplyRemove(${JSON.stringify(rec)}, 'A@example.com', ${NOW})`));
    assert.deepEqual(Object.keys(out.record.approved), ['b@example.com']);
    assert.throws(() => run(`cloudAccessApplyRemove(${JSON.stringify(rec)}, 'z@example.com', ${NOW})`), /no longer on the list/);
  });
  test('the list shows soonest-ending first, expired last, and who can edit', () => {
    const rec = record({
      'late@example.com': { expiresAt: NOW + 50 * DAY, write: false }, 'soon@example.com': { expiresAt: NOW + 2 * DAY, write: true },
      'old@example.com': { expiresAt: NOW - DAY, write: false }, 'nodate@example.com': { write: false },
    });
    const list = j(run(`cloudAccessList(${JSON.stringify(rec)}, ${NOW})`));
    assert.deepEqual(list.map(r => r.email), ['soon@example.com', 'late@example.com', 'nodate@example.com', 'old@example.com']);
    assert.deepEqual(list.map(r => r.expired), [false, false, true, true], 'no date means expired, the same as the rules');
    assert.equal(list[0].write, true); assert.equal(list[1].write, false);
  });
});

describe('saving to the cloud', () => {
  test('a phone that is not the verified owner cannot read or change the list, and asks the cloud nothing', async () => {
    for(const who of [null, ['viewer@example.com', true], [OWNER, false]]){
      load(); if(who) signIn(who[0], who[1]);
      await assert.rejects(run(`cloudAccessEdit(r => ({ record: r }))`), /Only the owner/);
      await assert.rejects(run(`cloudAccessRead()`), /Only the owner/);
      assert.equal(gets, 0); assert.equal(sets.length, 0);
    }
  });
  test('offline: says so and does not touch the record', async () => {
    load({ online: false }); signIn(OWNER);
    await assert.rejects(run(`cloudAccessEdit(r => ({ record: r }))`), /offline/);
    assert.equal(sets.length, 0);
  });
  test('the owner\'s change is read, applied and written back to config/access', async () => {
    load({ record: record({ 'a@example.com': { expiresAt: NOW + DAY, write: false, addedAt: 1 } }) }); signIn(OWNER);
    const out = await run(`cloudAccessEdit(r => cloudAccessApplyApprove(r, 'b@example.com', ${NOW + 9 * DAY}, ${NOW}))`);
    assert.equal(out.email, 'b@example.com');
    assert.equal(sets.length, 1); assert.equal(sets[0].path, 'config/access');
    assert.deepEqual(Object.keys(sets[0].value.approved).sort(), ['a@example.com', 'b@example.com']);
    assert.equal(sets[0].value.ownerEmail, OWNER);
  });
  test('if the record does not exist yet it is created with the new person in it', async () => {
    signIn(OWNER);
    await run(`cloudAccessEdit(r => cloudAccessApplyApprove(r, 'b@example.com', ${NOW + DAY}, ${NOW}))`);
    assert.deepEqual(Object.keys(docs.get('config/access').approved), ['b@example.com']);
    assert.equal(store.get('khata-cloud-access-ok'), OWNER);
  });
  test('an invalid change writes nothing', async () => {
    load({ record: record() }); signIn(OWNER);
    await assert.rejects(run(`cloudAccessEdit(r => cloudAccessApplyRemove(r, 'nobody@example.com', ${NOW}))`), /no longer on the list/);
    assert.equal(sets.length, 0);
  });
  test('the record Firebase refuses gives a plain message', () => {
    assert.match(run(`cloudPeopleErrorText({ code: 'permission-denied' })`), /rules/);
    assert.equal(run(`cloudPeopleErrorText(new Error('Enter their email address.'))`), 'Enter their email address.');
  });
});

describe('the screen', () => {
  test('only a verified owner sees the People block; a viewer sees the View only note instead', () => {
    signIn(OWNER); assert.match(run('cloudAccountHtml()'), /id="cloudPeople"/);
    load(); signIn(OWNER, false); assert.doesNotMatch(run('cloudAccountHtml()'), /id="cloudPeople"/);
    load(); signIn('viewer@example.com'); const v = run('cloudAccountHtml()');
    assert.doesNotMatch(v, /cloudPeople/); assert.match(v, /View only/);
    load(); assert.doesNotMatch(run('cloudAccountHtml()'), /cloudPeople/);
  });
  test('the block starts with a date 30 days ahead, and the list is drawn when the card is wired', async () => {
    load({ record: record({ 'a@example.com': { expiresAt: NOW + 3 * DAY, write: false, addedAt: 1 } }) }); signIn(OWNER);
    assert.match(run('cloudPeopleHtml()'), /type="date" id="cloudPeopleDate" value="\d{4}-\d{2}-\d{2}"/);
    await run('cloudPeopleRefresh()');
    assert.match(page.cloudPeopleList.innerHTML, /a@example\.com/);
    assert.match(page.cloudPeopleList.innerHTML, /View only/);
  });
  test('the list says Expired, View only or Can edit, offers +30 days and Remove, and escapes what it shows', () => {
    const rec = record({ 'ok@example.com': { expiresAt: NOW + 3 * DAY, write: false }, 'gone@example.com': { expiresAt: NOW - DAY, write: false }, 'edit@example.com': { expiresAt: NOW + 3 * DAY, write: true }, '<b>@x.com': { expiresAt: NOW + DAY, write: false } });
    const html = run(`cloudPeopleListHtml(${JSON.stringify(rec)}, ${NOW})`);
    assert.match(html, /View only \u00B7 until/); assert.match(html, /Expired /); assert.match(html, /Can edit \u00B7 until/);
    assert.match(html, /data-cp-extend="ok@example\.com"/); assert.match(html, /data-cp-remove="ok@example\.com"/); assert.match(html, /\+30 days/);
    assert.doesNotMatch(html, /<b>@x/);
    assert.match(run('cloudPeopleListHtml({ approved: {} }, 1)'), /No one is approved yet/);
  });
  test('Approve to view: saves the person as view-only until the chosen date, clears the email box, says what to do next', async () => {
    load({ record: record() }); signIn(OWNER);
    page.cloudPeopleEmail.value = ' Viewer@Example.com '; page.cloudPeopleDate.value = '2026-12-31';
    await run('cloudPeopleAdd()');
    const saved = docs.get('config/access').approved['viewer@example.com'];
    assert.equal(saved.write, false); assert.equal(saved.expiresAt, new Date(2026, 11, 31, 23, 59, 59, 999).getTime());
    assert.equal(page.cloudPeopleEmail.value, '');
    assert.match(page.cloudPeopleMsg.textContent, /viewer@example\.com approved until .*Sync Now/);
    assert.match(page.cloudPeopleList.innerHTML, /viewer@example\.com/);
    assert.equal(page.cloudPeopleAddBtn.disabled, false);
  });
  test('Approve to view: a bad email or date shows the reason and writes nothing', async () => {
    load({ record: record() }); signIn(OWNER);
    page.cloudPeopleEmail.value = 'not-an-email'; page.cloudPeopleDate.value = '2026-12-31';
    await run('cloudPeopleAdd()');
    assert.match(page.cloudPeopleMsg.textContent, /doesn't look right/); assert.equal(sets.length, 0);
    page.cloudPeopleEmail.value = 'a@example.com'; page.cloudPeopleDate.value = '2020-01-01';
    await run('cloudPeopleAdd()');
    assert.match(page.cloudPeopleMsg.textContent, /after today/); assert.equal(sets.length, 0);
  });
  test('Approve to view: Firebase refusing it is explained and the button comes back', async () => {
    load({ record: record(), failSet: true }); signIn(OWNER);
    page.cloudPeopleEmail.value = 'a@example.com'; page.cloudPeopleDate.value = '2099-01-01';
    await run('cloudPeopleAdd()');
    assert.match(page.cloudPeopleMsg.textContent, /rules/); assert.equal(page.cloudPeopleAddBtn.disabled, false);
  });
  test('+30 days extends at once; Remove needs a second tap', async () => {
    load({ record: record({ 'a@example.com': { expiresAt: Date.now() + 2 * DAY, write: false, addedAt: 1 } }) }); signIn(OWNER);
    const mk = attr => { const b = { disabled: false, textContent: 'x', getAttribute: n => n === attr ? 'a@example.com' : null }; return b; };
    const ext = mk('data-cp-extend');
    await run('cloudPeopleAct')(ext, 'extend');
    assert.equal(sets.length, 1); assert.match(page.cloudPeopleMsg.textContent, /extended by 30 days/);
    assert.ok(Math.abs(docs.get('config/access').approved['a@example.com'].expiresAt - (Date.now() + 32 * DAY)) < 5000);
    const rm = mk('data-cp-remove');
    await run('cloudPeopleAct')(rm, 'remove');
    assert.equal(rm.textContent, 'Tap again'); assert.equal(sets.length, 1, 'first tap only arms it');
    await run('cloudPeopleAct')(rm, 'remove');
    assert.equal(sets.length, 2); assert.deepEqual(Object.keys(docs.get('config/access').approved), []);
    assert.match(page.cloudPeopleMsg.textContent, /a@example\.com removed/);
    assert.match(page.cloudPeopleList.innerHTML, /No one is approved yet/);
  });
  test('offline the list says so instead of showing an empty one', async () => {
    load({ online: false }); signIn(OWNER);
    await run('cloudPeopleRefresh()');
    assert.match(page.cloudPeopleList.innerHTML, /offline/i);
  });
});

describe('what the rules will make of what the app writes', () => {
  test('the rules read expiresAt as a number and write as a boolean, which is what the app saves', () => {
    const rule = run('CLOUD_FIRESTORE_RULE');
    assert.match(rule, /get\('expiresAt', 0\) > request\.time\.toMillis\(\)/);
    assert.match(rule, /get\('write', false\) == true/);
    const out = j(run(`cloudAccessApplyApprove(${JSON.stringify(record())}, 'a@example.com', ${NOW + DAY}, ${NOW})`));
    const entry = out.record.approved['a@example.com'];
    assert.equal(typeof entry.expiresAt, 'number'); assert.equal(typeof entry.write, 'boolean');
  });
});
