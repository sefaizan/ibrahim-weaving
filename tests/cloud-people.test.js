'use strict';
/*
 * Approving people from the app (js/cloud-sync.js, "Approving people" and the People card
 * in Settings): owner-only approve / extend / remove, everyone approved is
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
    cloudPeopleEmail: { value: '' }, cloudPeopleAmount: { value: '30', style: {} }, cloudPeopleUnit: { value: 'days' }, cloudPeopleUntil: { value: '' }, cloudPeopleUntilRow: { style: {} }, cloudPeopleAddBtn: { disabled: false },
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
    assert.deepEqual(out.record.approved['new@example.com'], { expiresAt: NOW + 30 * DAY, write: false, addedAt: NOW, role: '', perms: {} });
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
    assert.deepEqual(a.record.approved['a@example.com'], { expiresAt: NOW + 10 * DAY, write: false, addedAt: 5, role: '', perms: {} });
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
  test('only a verified owner gets the People card; a viewer sees the View only note in the account block', () => {
    signIn(OWNER); assert.match(run('cloudPeopleSection()'), /<h2>People<\/h2>[\s\S]*id="cloudPeople"/);
    assert.doesNotMatch(run('cloudAccountHtml()'), /cloudPeople/, 'the list no longer lives in the Cloud Sync card');
    load(); signIn(OWNER, false); assert.equal(run('cloudPeopleSection()'), '');
    load(); signIn('viewer@example.com'); assert.equal(run('cloudPeopleSection()'), '');
    assert.match(run('cloudAccountHtml()'), /View only/);
    load(); assert.equal(run('cloudPeopleSection()'), '');
  });
  test('Settings draws the People card after Cloud Sync', () => {
    const shell = fs.readFileSync(path.join(__dirname, '..', 'js', 'shell.js'), 'utf8');
    assert.match(shell, /cloudSyncSection\(\) \+ cloudPeopleSection\(\)/);
  });
  test('time left: days, hours, within the hour, expired', () => {
    const t = ms => run(`cloudPeopleTimeLeft(${NOW + ms}, ${NOW})`);
    assert.equal(t(3 * DAY), '3 days left'); assert.equal(t(DAY + 5000), '1 day left');
    assert.equal(t(5 * 3600000), '5 hours left'); assert.equal(t(3600000 + 1), '1 hour left');
    assert.equal(t(20 * 60000), 'Expires within the hour');
    assert.equal(t(0), 'Expired'); assert.equal(t(-DAY), 'Expired');
  });
  test('the block starts with a date 30 days ahead, and the list is drawn when the card is wired', async () => {
    load({ record: record({ 'a@example.com': { expiresAt: Date.now() + 3 * DAY, write: false, addedAt: 1 } }) }); signIn(OWNER);
    const h = run('cloudPeopleHtml()');
    assert.match(h, /id="cloudPeopleAmount"[^>]*value="30"/); assert.match(h, /<option value="days" selected>/);
    ['minutes', 'hours', 'days', 'until'].forEach(u => assert.ok(h.includes('<option value="' + u + '"'), u));
    assert.match(h, /type="datetime-local" id="cloudPeopleUntil" value="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}"/);
    await run('cloudPeopleRefresh()');
    assert.match(page.cloudPeopleList.innerHTML, /a@example\.com/);
    assert.match(page.cloudPeopleList.innerHTML, /View only/);
  });
  test('the list says Expired, View only or Can edit, offers Extend / Shorten / Revoke, and escapes what it shows', () => {
    const rec = record({ 'ok@example.com': { expiresAt: NOW + 3 * DAY, write: false }, 'gone@example.com': { expiresAt: NOW - DAY, write: false }, 'edit@example.com': { expiresAt: NOW + 3 * DAY, write: true }, '<b>@x.com': { expiresAt: NOW + DAY, write: false } });
    const html = run(`cloudPeopleListHtml(${JSON.stringify(rec)}, ${NOW})`);
    assert.match(html, /View only \u00B7 3 days left \(until /); assert.match(html, /Expired /); assert.match(html, /Can edit \u00B7 3 days left \(until /);
    assert.match(html, /data-cp-open="extend" data-cp-email="ok@example\.com"/); assert.match(html, /data-cp-open="shorten" data-cp-email="ok@example\.com"/); assert.match(html, /data-cp-revoke="ok@example\.com"/);
    assert.match(html, /data-cp-open="shorten" data-cp-email="gone@example\.com" disabled/, 'nothing to shorten once it has ended');
    assert.doesNotMatch(html, /<b>@x/);
    assert.match(run('cloudPeopleListHtml({ approved: {} }, 1)'), /No one is approved yet/);
  });
  test('Approve to view: saves the person as view-only until the chosen date, clears the email box, says what to do next', async () => {
    load({ record: record() }); signIn(OWNER);
    page.cloudPeopleEmail.value = ' Viewer@Example.com '; page.cloudPeopleUnit.value = 'until'; page.cloudPeopleUntil.value = '2026-12-31T17:45';
    await run('cloudPeopleAdd()');
    const saved = docs.get('config/access').approved['viewer@example.com'];
    assert.equal(saved.write, false); assert.equal(saved.expiresAt, new Date(2026, 11, 31, 17, 45, 0, 0).getTime());
    assert.equal(page.cloudPeopleEmail.value, '');
    assert.match(page.cloudPeopleMsg.textContent, /viewer@example\.com approved until .*Sync Now/);
    assert.match(page.cloudPeopleList.innerHTML, /viewer@example\.com/);
    assert.equal(page.cloudPeopleAddBtn.disabled, false);
  });
  test('Approve to view: a bad email or duration shows the reason and writes nothing', async () => {
    load({ record: record() }); signIn(OWNER);
    page.cloudPeopleEmail.value = 'not-an-email'; page.cloudPeopleAmount.value = '5';
    await run('cloudPeopleAdd()');
    assert.match(page.cloudPeopleMsg.textContent, /doesn't look right/); assert.equal(sets.length, 0);
    page.cloudPeopleEmail.value = 'a@example.com'; page.cloudPeopleAmount.value = '0';
    await run('cloudPeopleAdd()');
    assert.match(page.cloudPeopleMsg.textContent, /whole number of days/); assert.equal(sets.length, 0);
  });
  test('Approve to view: Firebase refusing it is explained and the button comes back', async () => {
    load({ record: record(), failSet: true }); signIn(OWNER);
    page.cloudPeopleEmail.value = 'a@example.com'; page.cloudPeopleAmount.value = '3';
    await run('cloudPeopleAdd()');
    assert.match(page.cloudPeopleMsg.textContent, /rules/); assert.equal(page.cloudPeopleAddBtn.disabled, false);
  });
  test('Extend adds the chosen time after the later of now and their end; the message says the new end', async () => {
    load({ record: record({ 'a@example.com': { expiresAt: Date.now() + 2 * DAY, write: true, addedAt: 1 } }) }); signIn(OWNER);
    await run(`cloudPeopleAdjust('a@example.com', 'extend', '3', 'hours')`);
    const e = docs.get('config/access').approved['a@example.com'];
    assert.ok(Math.abs(e.expiresAt - (Date.now() + 2 * DAY + 3 * 3600000)) < 5000);
    assert.equal(e.write, true, 'write flag and added-on time are kept'); assert.equal(e.addedAt, 1);
    assert.match(page.cloudPeopleMsg.textContent, /a@example\.com extended by 3 hours\. Now ends /);
  });
  test('Shorten takes the chosen time off their end time', async () => {
    load({ record: record({ 'a@example.com': { expiresAt: Date.now() + 2 * DAY, write: false, addedAt: 1 } }) }); signIn(OWNER);
    await run(`cloudPeopleAdjust('a@example.com', 'shorten', '1', 'days')`);
    assert.ok(Math.abs(docs.get('config/access').approved['a@example.com'].expiresAt - (Date.now() + DAY)) < 5000);
    assert.match(page.cloudPeopleMsg.textContent, /shortened by 1 days\. Now ends /);
  });
  test('Shorten that would end it now or sooner, or on an expired approval, is refused and writes nothing (Revoke is the way)', async () => {
    load({ record: record({ 'a@example.com': { expiresAt: Date.now() + DAY, write: false, addedAt: 1 }, 'old@example.com': { expiresAt: Date.now() - DAY, write: false, addedAt: 1 } }) }); signIn(OWNER);
    await run(`cloudPeopleAdjust('a@example.com', 'shorten', '2', 'days')`);
    assert.match(page.cloudPeopleMsg.textContent, /Use Revoke to cut their access immediately/); assert.equal(sets.length, 0);
    await run(`cloudPeopleAdjust('old@example.com', 'shorten', '1', 'minutes')`);
    assert.match(page.cloudPeopleMsg.textContent, /already ended/); assert.equal(sets.length, 0);
  });
  test('Extend / Shorten with a bad number or unit writes nothing; an extension past 10 years is refused', async () => {
    load({ record: record({ 'a@example.com': { expiresAt: Date.now() + DAY, write: false, addedAt: 1 } }) }); signIn(OWNER);
    await run(`cloudPeopleAdjust('a@example.com', 'extend', '0', 'days')`);
    assert.match(page.cloudPeopleMsg.textContent, /whole number of days/);
    await run(`cloudPeopleAdjust('a@example.com', 'extend', '3651', 'days')`);
    assert.match(page.cloudPeopleMsg.textContent, /more than 10 years/);
    await run(`cloudPeopleAdjust('nobody@example.com', 'extend', '1', 'days')`);
    assert.match(page.cloudPeopleMsg.textContent, /no longer on the list/);
    assert.equal(sets.length, 0);
  });
  test('an expired approval restarts from now when extended', () => {
    const rec = record({ 'gone@example.com': { expiresAt: NOW - 20 * DAY, write: false, addedAt: 1 } });
    const g = j(run(`cloudAccessApplyShift(${JSON.stringify(rec)}, 'gone@example.com', ${2 * 3600000}, ${NOW})`));
    assert.equal(g.record.approved['gone@example.com'].expiresAt, NOW + 2 * 3600000);
  });
  test('Revoke needs a second tap, then deletes the person, confirms by reading back, and leaves others alone', async () => {
    load({ record: record({ 'a@example.com': { expiresAt: Date.now() + 2 * DAY, write: true, addedAt: 1 }, 'b@example.com': { expiresAt: Date.now() + DAY, write: false, addedAt: 2 } }) }); signIn(OWNER);
    const rm = { disabled: false, textContent: 'x', getAttribute: n => n === 'data-cp-revoke' ? 'a@example.com' : null };
    await run('cloudPeopleAct')(rm, 'revoke');
    assert.equal(rm.textContent, 'Tap again'); assert.equal(sets.length, 0, 'first tap only arms it');
    await run('cloudPeopleAct')(rm, 'revoke');
    assert.equal(sets.length, 1); assert.deepEqual(Object.keys(docs.get('config/access').approved), ['b@example.com']);
    assert.match(page.cloudPeopleMsg.textContent, /a@example\.com revoked\. Firebase stops letting them in/);
    assert.ok(gets >= 2, 'the record was read again after the write');
  });
  test('Revoke works whether the person had write access or had already expired, and shows a message if Firebase refuses', async () => {
    load({ record: record({ 'gone@example.com': { expiresAt: Date.now() - DAY, write: false, addedAt: 1 } }), failSet: true }); signIn(OWNER);
    const rm = { disabled: false, textContent: 'x', getAttribute: () => 'gone@example.com' };
    await run('cloudPeopleAct')(rm, 'revoke'); await run('cloudPeopleAct')(rm, 'revoke');
    assert.match(page.cloudPeopleMsg.textContent, /rules/); assert.ok('gone@example.com' in docs.get('config/access').approved, 'a refused revoke leaves the record as it was');
  });
  test('Revoke says so if the read-back still shows the person (it is never reported as done when it might not be)', async () => {
    load({ record: record({ 'a@example.com': { expiresAt: Date.now() + DAY, write: false, addedAt: 1 } }) }); signIn(OWNER);
    // a database whose writes silently do not stick
    run(`__db.collection = c => ({ doc: d => ({ async get(){ return { exists: true, data: () => ({ ownerEmail: '${OWNER}', approved: { 'a@example.com': { expiresAt: ${Date.now() + DAY}, write: false } } }) }; }, async set(){} }) })`);
    const rm = { disabled: false, textContent: 'x', getAttribute: () => 'a@example.com' };
    await run('cloudPeopleAct')(rm, 'revoke'); await run('cloudPeopleAct')(rm, 'revoke');
    assert.match(page.cloudPeopleMsg.textContent, /Could not confirm the revoke/);
  });
  test('when the database offers transactions the change is made inside one', async () => {
    load({ record: record({ 'a@example.com': { expiresAt: Date.now() + DAY, write: false, addedAt: 1 } }) }); signIn(OWNER);
    let used = 0;
    run(`__db.runTransaction = async fn => { __used(); return fn({ get: async ref => ref.get(), set: (ref, v) => { __txset(v); } }); }`);
    // wire counters into the sandbox
    ctx.__used = () => { used++; }; ctx.__txset = v => { docs.set('config/access', JSON.parse(JSON.stringify(v))); };
    run(`__db.runTransaction = async fn => { __used(); return fn({ get: async ref => ref.get(), set: (ref, v) => { __txset(v); } }); }`);
    await run(`cloudAccessEdit(r => cloudAccessApplyRemove(r, 'a@example.com', ${Date.now()}))`);
    assert.equal(used, 1); assert.deepEqual(Object.keys(docs.get('config/access').approved), []);
  });
  test('offline the list says so instead of showing an empty one', async () => {
    load({ online: false }); signIn(OWNER);
    await run('cloudPeopleRefresh()');
    assert.match(page.cloudPeopleList.innerHTML, /offline/i);
  });
});

describe('choosing how long', () => {
  const exp = (u, a, t) => run(`cloudAccessExpiry(${JSON.stringify(u)}, ${JSON.stringify(a)}, ${JSON.stringify(t)}, ${NOW})`);
  test('minutes, hours and days count from now', () => {
    assert.equal(exp('minutes', '45'), NOW + 45 * 60000);
    assert.equal(exp('hours', '8'), NOW + 8 * 3600000);
    assert.equal(exp('days', 3), NOW + 3 * DAY);
    assert.equal(exp('minutes', ' 1 '), NOW + 60000);
  });
  test('a date and time is used exactly, on this phone\'s clock (seconds ignored)', () => {
    assert.equal(exp('until', '', '2026-10-01T09:30'), new Date(2026, 9, 1, 9, 30, 0, 0).getTime());
    assert.equal(exp('until', '', '2026-10-01T09:30:45'), new Date(2026, 9, 1, 9, 30, 0, 0).getTime());
  });
  test('blank, zero, negative, fractional, text and unknown units are refused with a reason', () => {
    ['', '0', '-5', '2.5', 'abc', '1e3'].forEach(a => assert.throws(() => exp('hours', a), /whole number of hours/, a));
    assert.throws(() => exp('weeks', '2'), /Choose minutes, hours or days/);
  });
  test('a past, blank or malformed date and time is refused', () => {
    assert.throws(() => exp('until', '', '2026-09-30T11:59'), /in the future/);
    assert.throws(() => exp('until', '', '2026-09-30T12:00'), /in the future/, 'right now is not the future');
    assert.throws(() => exp('until', '', ''), /Pick the date and time/);
    assert.throws(() => exp('until', '', '2026-10-01'), /Pick the date and time/);
  });
  test('more than 10 years is refused (a typo can\'t grant access for centuries)', () => {
    assert.equal(exp('days', '3650'), NOW + 3650 * DAY);
    assert.throws(() => exp('days', '3651'), /more than 10 years/);
    assert.throws(() => exp('minutes', '99999999'), /more than 10 years/);
    assert.throws(() => exp('until', '', '2099-01-01T00:00'), /more than 10 years/);
  });
  test('the date-and-time box starts 30 days ahead', () => {
    const d = new Date(NOW + 30 * DAY), p = n => (n < 10 ? '0' : '') + n;
    assert.equal(run(`cloudAccessDefaultDateTime(${NOW})`), `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`);
  });
  test('Approve to view with minutes / hours: saves now + that long, still view-only', async () => {
    load({ record: record() }); signIn(OWNER);
    page.cloudPeopleEmail.value = 'a@example.com'; page.cloudPeopleUnit.value = 'minutes'; page.cloudPeopleAmount.value = '90';
    const before = Date.now(); await run('cloudPeopleAdd()'); const after = Date.now();
    const e = docs.get('config/access').approved['a@example.com'];
    assert.ok(e.expiresAt >= before + 90 * 60000 && e.expiresAt <= after + 90 * 60000);
    assert.equal(e.write, false); assert.equal(typeof e.expiresAt, 'number');
    assert.match(page.cloudPeopleMsg.textContent, /a@example\.com approved until/);
  });
  test('approving again with a shorter time shortens it (it replaces, it does not add)', async () => {
    load({ record: record({ 'a@example.com': { expiresAt: Date.now() + 30 * DAY, write: false, addedAt: 1 } }) }); signIn(OWNER);
    page.cloudPeopleEmail.value = 'a@example.com'; page.cloudPeopleUnit.value = 'hours'; page.cloudPeopleAmount.value = '2';
    await run('cloudPeopleAdd()');
    const e = docs.get('config/access').approved['a@example.com'];
    assert.ok(e.expiresAt < Date.now() + 3 * 3600000); assert.equal(e.addedAt, 1);
    assert.match(page.cloudPeopleMsg.textContent, /updated until/);
  });
  test('picking "until a date and time" swaps the number box for the date box, and back', () => {
    page.cloudPeopleUnit.value = 'until'; run('cloudPeopleSyncUnit()');
    assert.equal(page.cloudPeopleAmount.style.display, 'none'); assert.equal(page.cloudPeopleUntilRow.style.display, 'block');
    page.cloudPeopleUnit.value = 'hours'; run('cloudPeopleSyncUnit()');
    assert.equal(page.cloudPeopleAmount.style.display, ''); assert.equal(page.cloudPeopleUntilRow.style.display, 'none');
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
