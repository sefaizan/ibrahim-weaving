'use strict';
/*
 * Time-limited write access on the other phone (js/write-access.js + its hooks in cloud-sync.js and
 * view-only.js): the phone edits only while it holds an unexpired grant, shows the time left, drops back to
 * view-only by itself when the grant expires / is shortened / is revoked / the person signs out, and files
 * anything not yet synced as a safety copy first. Also the owner's side: the small note kept in step with
 * the permissions record. Runs the real files against a fake Firebase.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const OWNER = 'se.muhammadfaizan@gmail.com';
const WORKER = 'worker@example.com';
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const DAY = 86400000, HOUR = 3600000, MIN = 60000;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const noteId = email => 'sync/grant-' + sha('write-grant:' + email);

let ctx, store, docs, sets, deletes, snaps, toasts, bars, redraws, badge, denyAll, failNoteWrites, snapFails, timers, intervals, gets;
function load(opts){
  opts = opts || {};
  store = new Map([['khata-cloud-sync-on', '1']]);
  docs = new Map(); sets = []; deletes = []; snaps = []; toasts = []; bars = []; redraws = 0; gets = [];
  denyAll = false; failNoteWrites = !!opts.failNoteWrites; snapFails = !!opts.snapFails; timers = []; intervals = [];
  badge = { hidden: true, textContent: '' };
  const perm = () => { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; return e; };
  const clone = v => JSON.parse(JSON.stringify(v));
  const db = { collection: c => ({ doc: d => { const k = c + '/' + d; return {
    async get(){ gets.push(k); if(denyAll) throw perm(); return { exists: docs.has(k), data: () => docs.get(k) }; },
    async set(v){ if(denyAll) throw perm(); if(failNoteWrites && k.startsWith('sync/grant-')) throw new Error('write failed'); sets.push({ path: k, value: clone(v) }); docs.set(k, clone(v)); },
    async delete(){ if(failNoteWrites) throw new Error('delete failed'); deletes.push(k); docs.delete(k); },
  }; } }) };
  const email = opts.email === undefined ? WORKER : opts.email;
  const user = email ? { email, emailVerified: true, isAnonymous: false, async reload(){}, async getIdToken(){} } : null;
  const auth = { get currentUser(){ return user; }, onAuthStateChanged(cb){ Promise.resolve().then(() => cb(user)); return () => {}; }, async signOut(){} };
  const firebase = { apps: [{}], initializeApp(){}, auth: () => auth, firestore: () => db };
  const el = () => ({ style: {}, setAttribute(){}, appendChild(){}, remove(){}, animate(){}, firstChild: { textContent: '' }, querySelector: () => ({}) });
  ctx = vm.createContext({
    console: { log(){}, error(){} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout(){}, setInterval: (f, ms) => { intervals.push({ f, ms }); return intervals.length; },
    navigator: { onLine: opts.online !== false },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { getElementById: id => id === 'writeBadge' ? badge : null, createElement: () => { const e = el(); bars.push(e); return e; }, body: { appendChild(){}, classList: { toggle(){} } }, addEventListener(){}, head: { appendChild(){} } },
    firebase, escHtml: x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    switchTab(){ redraws++; }, showToast: m => toasts.push(m),
    encEnabled: () => !!opts.enc, ENC_DEK: opts.locked ? null : (opts.enc ? {} : null),
    sha256Hex: async s => sha(s),
    snapAdd: async (reason, json) => { if(snapFails) throw new Error('no IndexedDB'); snaps.push({ reason, json }); },
    currentEntryCount: () => 1, tombResetBaseline(){}, ensureDataDefaults: async () => false, UNDO_STACK: [], updateUndoButton(){},
    save: async () => {},
  });
  vm.runInContext(`var DATA = ${JSON.stringify(opts.data || { production: [{ id: 'a' }] })}; var CURRENT_TAB = 'overview'; var UNDO_SUPPRESS = false;`, ctx);
  if(email) store.set('khata-cloud-user', JSON.stringify({ email, verified: true }));
  vm.runInContext(read('js/cloud-sync.js'), ctx);
  vm.runInContext(read('js/view-only.js'), ctx);
  vm.runInContext(read('js/write-access.js'), ctx);
  if(opts.flag !== false && email && email !== OWNER) store.set('khata-view-only', '1');
}
const run = code => vm.runInContext(code, ctx);
const giveGrant = (msFromNow, extra) => store.set('khata-write-grant', JSON.stringify(Object.assign({ email: WORKER, expiresAt: Date.now() + msFromNow }, extra || {})));
const grantNote = (msFromNow, write) => docs.set(noteId(WORKER), { write: write !== false, expiresAt: Date.now() + msFromNow });
const syncedHash = () => store.set('khata-cloud-last-hash', sha(JSON.stringify(run('DATA')))); // marks the ledger as fully synced
beforeEach(() => load());

describe('who may edit', () => {
  test('a phone with no grant is view-only, as before', () => { assert.equal(run('viewOnly()'), true); assert.equal(run('cloudWriteGrantActive()'), false); });
  test('an unexpired grant for the signed-in account unlocks editing; the owner is unaffected', () => {
    giveGrant(2 * HOUR); assert.equal(run('cloudWriteGrantActive()'), true); assert.equal(run('viewOnly()'), false);
    load({ email: OWNER }); giveGrant(-1); assert.equal(run('viewOnly()'), false, 'the owner is never view-only');
  });
  test('an expired, ended, other-account or signed-out grant does not unlock editing', () => {
    giveGrant(-MIN); assert.equal(run('viewOnly()'), true);
    load(); giveGrant(HOUR, { ended: 'revoked' }); assert.equal(run('viewOnly()'), true);
    load(); store.set('khata-write-grant', JSON.stringify({ email: 'someone.else@example.com', expiresAt: Date.now() + HOUR })); assert.equal(run('viewOnly()'), true);
    load(); giveGrant(HOUR); store.delete('khata-cloud-user'); assert.equal(run('viewOnly()'), true, 'signed out: view-only even with a grant on file');
  });
  test('the moment the end time passes the phone is view-only, before any clean-up has run', () => {
    giveGrant(50); assert.equal(run('viewOnly()'), false);
    run(`(function(){ var real = Date.now; Date.now = () => real() + 100000; })()`);
    assert.equal(run('viewOnly()'), true);
  });
  test('while it may edit, changes are pushed; once it may not, nothing is scheduled', () => {
    giveGrant(HOUR); run('cloudSyncSchedule()'); assert.equal(timers.length, 1, 'a push is scheduled while editing is allowed');
    load(); run('cloudSyncSchedule()'); assert.equal(timers.length, 0, 'a view-only phone never pushes');
  });
});

describe('the time left', () => {
  test('wording', () => {
    const t = ms => run(`waLeftText(${ms})`);
    assert.equal(t(3 * DAY), '3 days'); assert.equal(t(2 * HOUR + 15 * MIN), '2h 15m'); assert.equal(t(3 * HOUR), '3h');
    assert.equal(t(40 * MIN), '40m'); assert.equal(t(20000), 'under a minute'); assert.equal(t(0), 'ended'); assert.equal(t(-5), 'ended');
  });
  test('the header badge shows it while active and hides when not', () => {
    giveGrant(2 * HOUR + 30000); run('waBadgeUpdate()');
    assert.equal(badge.hidden, false); assert.match(badge.textContent, /^Can edit \u00B7 2h( \d+m)? left$/);
    load(); run('waBadgeUpdate()'); assert.equal(badge.hidden, true);
  });
  test('Settings > Cloud Sync says "Can edit" with the time left, then "View only" again', () => {
    giveGrant(3 * DAY + HOUR);
    const on = run('cloudAccountHtml()'); assert.match(on, /<b>Can edit<\/b> until .*\(3 days left\)/); assert.doesNotMatch(on, /<b>View only<\/b>/);
    load(); assert.match(run('cloudAccountHtml()'), /<b>View only<\/b>/);
  });
});

describe('learning the grant from the note', () => {
  test('the note id is a hash, never the email', async () => {
    const id = await run(`waGrantDocId(' Worker@Example.com ')`);
    assert.equal(id, 'grant-' + sha('write-grant:' + WORKER)); assert.ok(!id.includes('worker'));
  });
  test('a live note switches the phone to editing, redraws it and says until when', async () => {
    grantNote(3 * HOUR);
    assert.equal(await run('waRefreshGrant()'), 'active');
    assert.equal(run('viewOnly()'), false); assert.ok(redraws >= 1); assert.match(toasts[0], /You can edit until /);
    assert.ok(Math.abs(JSON.parse(store.get('khata-write-grant')).expiresAt - (Date.now() + 3 * HOUR)) < 5000);
    assert.ok(intervals.some(i => i.ms === 60000), 'the once-a-minute check is started');
  });
  test('no note, a view-only note or an already-past note leaves the phone view-only and does not bother it', async () => {
    assert.equal(await run('waRefreshGrant()'), 'none');
    grantNote(HOUR, false); assert.equal(await run('waRefreshGrant()'), 'none');
    grantNote(-HOUR); assert.equal(await run('waRefreshGrant()'), 'none');
    assert.equal(run('viewOnly()'), true); assert.equal(toasts.length, 0); assert.equal(bars.length, 0); assert.equal(store.has('khata-write-grant'), false);
  });
  test('an extension made on the owner\'s phone is picked up on the next check', async () => {
    grantNote(HOUR); await run('waRefreshGrant()');
    grantNote(5 * HOUR); await run('waRefreshGrant()');
    assert.ok(JSON.parse(store.get('khata-write-grant')).expiresAt > Date.now() + 4 * HOUR); assert.equal(toasts.length, 1, 'not announced twice');
  });
  test('offline, or a network error, changes nothing', async () => {
    giveGrant(HOUR); load({ online: false }); giveGrant(HOUR);
    assert.equal(await run('waRefreshGrant()'), 'skipped'); assert.equal(run('viewOnly()'), false);
  });
  test('the owner\'s own phone never reads a note', async () => {
    load({ email: OWNER }); assert.equal(await run('waRefreshGrant()'), 'skipped'); assert.equal(gets.length, 0);
  });
  test('a sync check learns the grant before deciding what to do, so the phone edits from then on', async () => {
    docs.set('sync/ledger', { payload: JSON.stringify({ production: [{ id: 'a' }] }), encrypted: false, savedAt: '2026-09-30T10:00:00.000Z' });
    grantNote(2 * HOUR);
    await run('cloudSyncCheckOnStart()');
    assert.equal(run('viewOnly()'), false); assert.ok(gets.indexOf(noteId(WORKER)) < gets.indexOf('sync/ledger'), 'note read first');
  });
});

describe('dropping back to view-only', () => {
  test('expiry (the minute check): view-only, message, and the unsynced entry is filed as a safety copy first', async () => {
    run(`DATA.production.push({ id: 'unsynced-1', note: 'made just before it ended' })`);
    store.set('khata-cloud-last-hash', 'hash-of-an-older-ledger');
    giveGrant(-1000);
    await run('waTick()');
    assert.equal(run('viewOnly()'), true); assert.equal(store.has('khata-write-grant'), false);
    assert.equal(snaps.length, 1); assert.equal(snaps[0].reason, 'access-ended'); assert.match(snaps[0].json, /made just before it ended/);
    assert.equal(bars.length, 1); assert.match(bars[0].firstChild.textContent, /Your edit access has ended\. This phone is now view only\. Changes that had not synced were saved as a safety copy/);
    assert.ok(redraws >= 1);
  });
  test('nothing unsynced: no safety copy, but still told', async () => {
    syncedHash(); giveGrant(-1000); await run('waTick()');
    assert.equal(snaps.length, 0); assert.match(bars[0].firstChild.textContent, /view only\.$/);
  });
  test('revoked while offline-editing: the next push is refused, the phone finds the grant gone, keeps the entry, goes view-only', async () => {
    giveGrant(2 * HOUR); run(`DATA.production.push({ id: 'offline-edit' })`); store.set('khata-cloud-last-hash', 'old');
    denyAll = true;
    await run('cloudPushNow()'); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
    assert.equal(run('viewOnly()'), true);
    assert.equal(snaps.length, 1); assert.match(snaps[0].json, /offline-edit/);
    assert.match(bars[0].firstChild.textContent, /Your access was removed by the owner/);
  });
  test('revoked: the once-a-minute check notices even though nothing was pushed', async () => {
    giveGrant(2 * HOUR); store.set('khata-cloud-last-hash', 'old'); denyAll = true;
    await run('waTick()');
    assert.equal(run('viewOnly()'), true); assert.equal(snaps.length, 1);
  });
  test('shortened to the past or edit access switched off (still approved to view): "The owner turned off your edit access"', async () => {
    giveGrant(2 * HOUR); store.set('khata-cloud-last-hash', 'old'); grantNote(HOUR, false);
    await run('waRefreshGrant()');
    assert.equal(run('viewOnly()'), true); assert.match(bars[0].firstChild.textContent, /turned off your edit access/);
    load(); giveGrant(2 * HOUR); await run('waRefreshGrant()'); // the note is simply gone
    assert.equal(run('viewOnly()'), true);
  });
  test('shortened but still running: keeps editing, with the new, shorter time', async () => {
    giveGrant(5 * HOUR); grantNote(30 * MIN); await run('waRefreshGrant()');
    assert.equal(run('viewOnly()'), false); assert.ok(run('waLeftMs()') < HOUR);
  });
  test('a refused push while the note says the grant is fine does not take editing away', async () => {
    giveGrant(2 * HOUR); grantNote(2 * HOUR);
    run('waOnPermissionDenied()'); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
    assert.equal(run('viewOnly()'), false);
  });
  test('a plain viewer being refused is not treated as anything to end', async () => {
    denyAll = true; run('waOnPermissionDenied()'); await run('waRefreshGrant()');
    assert.equal(bars.length, 0); assert.equal(snaps.length, 0);
  });
  test('signing out ends editing here, filing unsynced entries first', async () => {
    giveGrant(2 * HOUR); run(`DATA.production.push({ id: 'before-signout' })`); store.set('khata-cloud-last-hash', 'old');
    await run('cloudSignOut()');
    assert.equal(run('viewOnly()'), true); assert.equal(snaps.length, 1); assert.match(snaps[0].json, /before-signout/);
    assert.match(bars[0].firstChild.textContent, /You signed out\. This phone is now view only/);
  });
  test('a push waiting to go out is cancelled when the grant ends', async () => {
    let cleared = 0; ctx.clearTimeout = () => { cleared++; };
    giveGrant(2 * HOUR); await run(`waGrantEnd('revoked')`); assert.ok(cleared >= 1);
  });
  test('ending twice at once files only one copy', async () => {
    giveGrant(2 * HOUR); store.set('khata-cloud-last-hash', 'old');
    await Promise.all([run(`waGrantEnd('revoked')`), run(`waGrantEnd('revoked')`)]);
    assert.equal(snaps.length, 1); assert.equal(bars.length, 1);
  });
});

describe('keeping the unsynced entries safe', () => {
  test('if IndexedDB is unavailable and the ledger is not encrypted, a copy is kept in the phone\'s own storage', async () => {
    load({ snapFails: true }); run(`DATA.production.push({ id: 'x-1' })`); giveGrant(-1000); store.set('khata-cloud-last-hash', 'old');
    await run('waTick()');
    assert.match(store.get('khata-unsynced-copy'), /x-1/); assert.match(bars[0].firstChild.textContent, /saved as a copy on this phone/);
  });
  test('if that fails and the ledger is encrypted, plain data is never written; the person is warned', async () => {
    load({ snapFails: true, enc: true }); giveGrant(-1000); store.set('khata-cloud-last-hash', 'old');
    await run('waTick()');
    assert.equal(store.has('khata-unsynced-copy'), false); assert.match(bars[0].firstChild.textContent, /Warning: changes that had not synced could not be saved/);
  });
  test('while the app is locked (encrypted) the clean-up waits; the phone is view-only meanwhile, and it finishes after unlocking', async () => {
    load({ enc: true, locked: true }); giveGrant(-1000); store.set('khata-cloud-last-hash', 'old');
    await run('waTick()');
    assert.equal(run('viewOnly()'), true); assert.equal(snaps.length, 0); assert.equal(bars.length, 0); assert.ok(store.has('khata-write-grant'), 'kept so it can finish later');
    run('ENC_DEK = {}'); await run('waTick()');
    assert.equal(snaps.length, 1); assert.equal(store.has('khata-write-grant'), false);
  });
  test('the safety copy type is named in Backup & Restore and kept generously', () => {
    const shell = read('js/shell.js');
    assert.match(shell, /'access-ended':'Unsynced entries \(access ended\)'/); assert.match(shell, /'access-ended':10/);
  });
});

describe('the owner\'s side: the note follows the record', () => {
  beforeEach(() => { load({ email: OWNER }); });
  const ent = (msFromNow, write) => ({ expiresAt: Date.now() + msFromNow, write: !!write, addedAt: 1 });
  test('approving someone with edit access writes their note; view-only or revoked people get none', async () => {
    docs.set('config/access', { ownerEmail: OWNER, approved: {} });
    await run(`cloudAccessEdit(r => cloudAccessApplyApprove(r, '${WORKER}', ${Date.now() + DAY}, ${Date.now()}))`);
    assert.deepEqual(deletes, [noteId(WORKER)], 'view-only: any old note is removed');
    docs.set('config/access', { ownerEmail: OWNER, approved: { [WORKER]: ent(DAY, true) } });
    sets.length = 0; await run(`cloudAccessEdit(r => cloudAccessApplyShift(r, '${WORKER}', ${HOUR}, ${Date.now()}))`);
    const note = sets.find(s => s.path === noteId(WORKER));
    assert.ok(note && note.value.write === true && typeof note.value.expiresAt === 'number' && note.value.expiresAt > Date.now() + DAY);
    deletes.length = 0; await run(`cloudAccessEdit(r => cloudAccessApplyRemove(r, '${WORKER}', ${Date.now()}))`);
    assert.deepEqual(deletes, [noteId(WORKER)]);
  });
  test('a failed note write does not undo the record and is reported', async () => {
    docs.set('config/access', { ownerEmail: OWNER, approved: { [WORKER]: ent(DAY, true) } });
    failNoteWrites = true;
    const out = j(await run(`cloudAccessEdit(r => cloudAccessApplyShift(r, '${WORKER}', ${HOUR}, ${Date.now()}))`));
    assert.equal(out.mirrorError, true);
    assert.ok(docs.get('config/access').approved[WORKER].expiresAt > Date.now() + DAY);
  });
  test('the card messages carry the warning when the note could not be sent', async () => {
    docs.set('config/access', { ownerEmail: OWNER, approved: { [WORKER]: ent(DAY, true) } });
    failNoteWrites = true;
    ctx.document.getElementById = id => id === 'cloudPeopleMsg' ? (ctx.__msg = ctx.__msg || { textContent: '', style: {} }) : null;
    await run(`cloudPeopleAdjust('${WORKER}', 'extend', '1', 'hours')`);
    assert.match(ctx.__msg.textContent, /extended by 1 hours/); assert.match(ctx.__msg.textContent, /Warning: their phone could not be sent the change/);
  });
  test('opening the People card re-sends every note (covers entries set by hand)', async () => {
    const rec = { ownerEmail: OWNER, approved: { [WORKER]: ent(DAY, true), 'viewer@example.com': ent(DAY, false) } };
    await run(`waMirrorAll(${JSON.stringify(rec)})`);
    assert.ok(sets.some(s => s.path === noteId(WORKER))); assert.ok(deletes.includes(noteId('viewer@example.com')));
  });
  test('the notes live in the "sync" collection the current rules already cover, so no rule change is needed', () => {
    assert.match(read('js/cloud-sync.js'), /match \/sync\/\{doc\}/);
    assert.match(read('js/write-access.js'), /collection\('sync'\)\.doc\(/);
  });
});

describe('wiring', () => {
  test('the script is loaded after view-only.js and cached for offline use, and the header has the badge', () => {
    const html = read('index.html'), sw = read('service-worker.js');
    const at = f => html.indexOf('<script src="./js/' + f + '"></script>');
    assert.ok(at('view-only.js') > 0 && at('view-only.js') < at('write-access.js') && at('write-access.js') < at('lock-init.js'));
    assert.ok(sw.includes("'./js/write-access.js'")); assert.match(html, /id="writeBadge"/);
  });
});
function j(v){ return JSON.parse(JSON.stringify(v)); }
