'use strict';
/*
 * Automatic email backup (js/autobackup.js): when a backup is sent, when it is not, what is sent,
 * and how failures are reported. Runs the real file in a sandbox with a fake localStorage, a fake
 * fetch and stand-ins for the few helpers it borrows from other files. The Backup & Restore card
 * itself (buttons and text) is checked by hand on a phone.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HOUR = 3600000;
// Local-time moments, so these tests behave the same in any time zone and at any time of day.
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const yesterdayNoon = () => { const d = startOfToday(); d.setHours(-12, 0, 0, 0); return d; };

function load(){
  const store = new Map();
  const localStorage = {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
  };
  const calls = [];
  const timers = [];   // fake setTimeout: nothing fires by itself; tests look at what was scheduled
  const world = { fetchImpl: async () => ({ ok: true, status: 200 }) };
  const ctx = vm.createContext({
    localStorage, crypto: globalThis.crypto, TextEncoder, TextDecoder, Uint8Array, AbortController,
    console, JSON, Date, Promise, Number, String, Object, Array, Math,
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms, live: true }); return id; },
    clearTimeout: id => { const t = timers.find(x => x.id === id); if(t) t.live = false; },
    document: { getElementById: () => null, addEventListener(){} },
    window: { addEventListener(){} },
    fetch: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return world.fetchImpl(url, init); },
    world,
  });
  // Stand-ins for what core.js / shell.js / encryption.js provide to the page.
  vm.runInContext(`
    var DATA = { sale: [], recovery: [], production: [], clients: [], expense: [], family: [], warp: [], weft: [],
      wagePayments: [], wageBonuses: [], wageSettlements: [], loanPayments: [], warpBeams: [], checkpoints: [] };
    const BACKUP_GZ_PREFIX = 'KHATA-GZ1:';
    const LAST_BACKUP_KEY = 'khata-last-backup-at', LAST_BACKUP_COUNT_KEY = 'khata-last-backup-count';
    var gzipOn = true;
    async function gzipToBase64(s){ return gzipOn ? 'ZZ' : null; }
    var encryptFails = false;
    async function encryptBackupText(text, pw){ if(encryptFails) throw new Error('no crypto'); return 'KHATA-ENC1:' + (pw + '|' + text).split('').reverse().join(''); }
    function backupFileName(suffix){ return 'Ibrahim_Weaving_2026-09-21_10-00-00' + (suffix||'') + '.txt'; }
    function backupCounts(o){ const n = k => Array.isArray(o[k]) ? o[k].length : 0;
      return {sales:n('sale'), recoveries:n('recovery'), production:n('production'), clients:n('clients'), other:n('expense')}; }
    const totalEntries = c => c.sales + c.recoveries + c.production + c.other;
    function currentEntryCount(){ return totalEntries(backupCounts(DATA)); }
    function lastBackupStatusText(){ return 'x'; }
    var refreshed = 0;
    function refreshBackupStrip(){ refreshed++; }
    var lockedEnc = false; var ENC_DEK = null;
    function encEnabled(){ return lockedEnc; }
  `, ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'autobackup.js'), 'utf8'), ctx, { filename: 'js/autobackup.js' });
  const run = async (code) => { const r = await vm.runInContext(code, ctx); return r === undefined ? r : JSON.parse(JSON.stringify(r)); };
  const configure = (over) => run(`autoBackupSetConfig(${JSON.stringify(Object.assign(
    { on: true, url: 'https://backup.example.netlify.app/api/backup', key: 'k3y', pw: '' }, over))})`);
  const addEntries = (n) => run(`DATA.sale.push(...Array.from({length:${n}}, (_, i) => ({id:'s'+(DATA.sale.length+i)})))`);
  // Pretend the last daily check / send happened at a given moment (local time), and its ledger fingerprint.
  const setLastOk = (when, hash) => run(`autoBackupSetState({lastOkAt: ${JSON.stringify(when.toISOString())}, lastCheckDay: autoBackupDayKey(new Date(${when.getTime()}))${hash ? `, lastHash: ${JSON.stringify(hash)}` : ''}})`);
  const liveTimers = () => timers.filter(x => x.live && x.ms > 1000 && x.ms !== 45000); // ignore the 45 s network time-out
  return { ctx, store, calls, world, run, configure, addEntries, setLastOk, timers, liveTimers };
}

describe('when a backup is sent', () => {
  test('nothing is sent until it is set up (off, or an address that is not https)', async () => {
    const t = load(); await t.addEntries(3);
    assert.equal((await t.run('autoBackupSend(false)')).skipped, true);
    await t.configure({ on: false });
    assert.equal((await t.run('autoBackupSend(true)')).skipped, true);
    await t.configure({ url: 'http://insecure.example/api/backup' });
    assert.equal((await t.run('autoBackupSend(true)')).skipped, true);
    assert.equal(t.calls.length, 0);
  });
  test('an empty ledger is never sent', async () => {
    const t = load(); await t.configure();
    const r = await t.run('autoBackupSend(true)');
    assert.equal(r.skipped, true); assert.equal(t.calls.length, 0);
  });
  test('a locked (encrypted) ledger is never sent', async () => {
    const t = load(); await t.configure(); await t.addEntries(3);
    await t.run('lockedEnc = true');
    const r = await t.run('autoBackupSend(true)');
    assert.equal(r.skipped, true); assert.equal(t.calls.length, 0);
  });
  test('the first backup goes out at once; the next day it is not repeated when nothing changed', async () => {
    const t = load(); await t.configure(); await t.addEntries(3);
    assert.equal((await t.run('autoBackupSend(false)')).ok, true);
    assert.equal(t.calls.length, 1);
    await t.setLastOk(yesterdayNoon());   // a new day has started, but the ledger is identical
    const again = await t.run('autoBackupSend(false)');
    assert.equal(again.skipped, true); assert.equal(t.calls.length, 1);
    assert.match(again.message, /No changes/);
  });
  test('at most one automatic backup per day: a change made today waits until after midnight', async () => {
    const t = load(); await t.configure(); await t.addEntries(3);
    await t.run('autoBackupSend(false)');            // today's backup
    await t.addEntries(1);                           // a later entry today
    const same = await t.run('autoBackupSend(false)');
    assert.equal(same.tooSoon, true);
    assert.equal(t.calls.length, 1, 'nothing more is sent the same day');
    assert.ok(same.waitMs > 0 && same.waitMs <= 25 * HOUR, 'tells the caller how long until midnight');
    const untilMidnight = new Date(Date.now() + same.waitMs);
    assert.equal(untilMidnight.getHours(), 0); assert.equal(untilMidnight.getMinutes(), 0);
    // the next day the change goes out
    await t.setLastOk(yesterdayNoon(), (await t.run('autoBackupState()')).lastHash);
    assert.equal((await t.run('autoBackupSend(false)')).ok, true);
    assert.equal(t.calls.length, 2);
  });
  test('a day with no change is still counted as checked, so opening the app twice does not resend', async () => {
    const t = load(); await t.configure(); await t.addEntries(3);
    await t.run('autoBackupSend(false)');
    await t.setLastOk(yesterdayNoon());
    await t.run('autoBackupSend(false)');            // new day, nothing changed: skipped, day marked checked
    await t.addEntries(1);                           // entry later the same day
    const r = await t.run('autoBackupSend(false)');
    assert.equal(r.tooSoon, true); assert.equal(t.calls.length, 1);
  });
  test('a failed send does not use up the day, so the next wake-up tries again', async () => {
    const t = load(); await t.configure(); await t.addEntries(3);
    t.world.fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
    assert.equal((await t.run('autoBackupSend(false)')).ok, false);
    t.world.fetchImpl = async () => ({ ok: true, status: 200 });
    assert.equal((await t.run('autoBackupSend(false)')).ok, true);
    assert.equal(t.calls.length, 2);
  });
  test('saving an entry sends nothing by itself; a single check is set for just after midnight', async () => {
    const t = load(); await t.configure(); await t.addEntries(3);
    await t.run('autoBackupSchedule()');
    await t.run('autoBackupSchedule()');             // every save calls this: still only one timer
    assert.equal(t.calls.length, 0);
    const live = t.liveTimers();
    assert.equal(live.length, 1);
    const at = new Date(Date.now() + live[0].ms);
    assert.equal(at.getHours(), 0); assert.equal(at.getMinutes(), 0);
    assert.ok(live[0].ms > 1000 && live[0].ms <= 25 * HOUR);
  });
  test('when the midnight check runs it sends, and sets up the next midnight', async () => {
    const t = load(); await t.configure(); await t.addEntries(3);
    await t.setLastOk(yesterdayNoon(), 'old-fingerprint');
    const r = await t.run('autoBackupRun()');
    assert.equal(r.ok, true); assert.equal(t.calls.length, 1);
    assert.equal(t.liveTimers().length, 1);
  });
  test('nothing is scheduled when automatic backup is off', async () => {
    const t = load(); await t.configure({ on: false });
    await t.run('autoBackupSchedule()');
    assert.equal(t.liveTimers().length, 0);
  });
  test('"Send now" ignores both the wait and the unchanged check', async () => {
    const t = load(); await t.configure(); await t.addEntries(3);
    await t.run('autoBackupSend(false)');
    assert.equal((await t.run('autoBackupSend(true)')).ok, true);
    assert.equal(t.calls.length, 2);
  });
  test('two sends at the same moment become one', async () => {
    const t = load(); await t.configure(); await t.addEntries(3);
    const both = await t.run('Promise.all([autoBackupSend(true), autoBackupSend(true)])');
    assert.equal(t.calls.length, 1);
    assert.equal(both.filter(r => r.ok).length, 1);
  });
});

describe('what is sent', () => {
  test('the address, key and the envelope the Netlify function expects', async () => {
    const t = load(); await t.configure(); await t.addEntries(4);
    await t.run('autoBackupSend(true)');
    const c = t.calls[0];
    assert.equal(c.url, 'https://backup.example.netlify.app/api/backup');
    assert.equal(c.init.method, 'POST');
    assert.equal(c.init.headers.Authorization, 'Bearer k3y');
    assert.equal(c.body.app, 'IbrahimWeavingWeb');
    assert.match(c.body.filename, /^[A-Za-z0-9._-]{1,120}$/, 'a file name the function accepts');
    assert.equal(c.body.filename, 'Ibrahim_Weaving_2026-09-21_10-00-00-compressed.txt');
    assert.equal(c.body.counts.sales, 4);
    assert.equal(c.body.protected, false);
    assert.equal(c.body.payload, 'KHATA-GZ1:ZZ');
    assert.ok(!isNaN(Date.parse(c.body.createdAt)));
  });
  test('without compression support the plain JSON ledger is sent', async () => {
    const t = load(); await t.configure(); await t.addEntries(2);
    await t.run('gzipOn = false');
    await t.run('autoBackupSend(true)');
    const c = t.calls[0].body;
    assert.equal(JSON.parse(c.payload).sale.length, 2);
    assert.equal(c.filename, 'Ibrahim_Weaving_2026-09-21_10-00-00.txt');
  });
  test('with a password the file is encrypted and marked protected', async () => {
    const t = load(); await t.configure({ pw: 'secret1' }); await t.addEntries(2);
    await t.run('autoBackupSend(true)');
    const c = t.calls[0].body;
    assert.equal(c.protected, true);
    assert.ok(c.payload.startsWith('KHATA-ENC1:'));
    assert.match(c.filename, /-compressed-protected\.txt$/);
  });
  test('if the file cannot be built (e.g. no encryption here) it says so instead of blaming the network', async () => {
    const t = load(); await t.configure({ pw: 'secret1' }); await t.addEntries(2);
    await t.run('encryptFails = true');
    const r = await t.run('autoBackupSend(true)');
    assert.equal(r.ok, false); assert.match(r.message, /Could not prepare the backup/);
    assert.equal(t.calls.length, 0);
    assert.doesNotMatch(r.message, /reach the backup service/);
  });
  test('a password shorter than 6 characters is ignored, never used to "protect" the file', async () => {
    const t = load(); await t.configure({ pw: '123' }); await t.addEntries(2);
    await t.run('autoBackupSend(true)');
    assert.equal(t.calls[0].body.protected, false);
  });
});

describe('results and failures', () => {
  test('success is remembered, and quiets the "take a backup" reminders', async () => {
    const t = load(); await t.configure(); await t.addEntries(3);
    const r = await t.run('autoBackupSend(true)');
    assert.equal(r.ok, true);
    const st = await t.run('autoBackupState()');
    assert.ok(st.lastOkAt); assert.equal(st.lastError, '');
    assert.ok(t.store.get('khata-last-backup-at'));
    assert.equal(t.store.get('khata-last-backup-count'), '3');
    assert.equal(await t.run('refreshed'), 1);
  });
  test('a wrong key says so, and the last success is not touched', async () => {
    const t = load(); await t.configure(); await t.addEntries(3);
    await t.run('autoBackupSend(true)');
    const before = (await t.run('autoBackupState()')).lastOkAt;
    t.world.fetchImpl = async () => ({ ok: false, status: 401 });
    const r = await t.run('autoBackupSend(true)');
    assert.equal(r.ok, false); assert.equal(r.message, 'The backup key is wrong.');
    const st = await t.run('autoBackupState()');
    assert.equal(st.lastError, 'The backup key is wrong.'); assert.equal(st.lastOkAt, before);
    assert.match(await t.run('autoBackupStatusText()'), /Last attempt failed: The backup key is wrong/);
  });
  test('wrong address, too large, other server errors, and no internet each get their own message', async () => {
    const t = load(); await t.configure(); await t.addEntries(3);
    for (const [status, re] of [[404, /address is wrong/], [413, /too large/], [500, /error \(500\)/]]) {
      t.world.fetchImpl = async () => ({ ok: false, status });
      assert.match((await t.run('autoBackupSend(true)')).message, re);
    }
    t.world.fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
    assert.match((await t.run('autoBackupSend(true)')).message, /Could not reach the backup service/);
    // and a failure never leaves it stuck "busy"
    t.world.fetchImpl = async () => ({ ok: true, status: 200 });
    assert.equal((await t.run('autoBackupSend(true)')).ok, true);
  });
});

describe('the Backup & Restore card', () => {
  test('never puts the saved key or password into the page, and escapes the address', async () => {
    const t = load();
    await t.configure({ url: 'https://x.example/api/backup?a="1"&b=<2>', key: 'SUPERKEY123', pw: 'hunter22' });
    const html = await t.run('autoBackupCardHtml()');
    assert.ok(!html.includes('SUPERKEY123'), 'the key must not be written into the page');
    assert.ok(!html.includes('hunter22'), 'the password must not be written into the page');
    assert.ok(html.includes('&quot;1&quot;') && html.includes('&lt;2&gt;') && html.includes('&amp;b='), 'address is HTML-escaped');
    assert.ok(html.includes('Saved — leave empty to keep it'));
    assert.ok(html.includes('id="ab_pwclear"'), 'offers to remove an existing password');
  });
  test('a fresh install shows an empty, switched-off card', async () => {
    const t = load();
    const html = await t.run('autoBackupCardHtml()');
    assert.ok(!html.includes(' checked'));
    assert.ok(!html.includes('ab_pwclear'));
    assert.equal(await t.run('autoBackupStatusText()'), 'Automatic email backup is off.');
  });
});
