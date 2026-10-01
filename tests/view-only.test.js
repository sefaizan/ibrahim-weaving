'use strict';
/*
 * View-only phones (js/view-only.js + the hooks in js/cloud-sync.js and js/core.js): who counts as
 * view-only, that saving and pushing are refused for them, that the cloud copy still comes down, and
 * that nothing changes for the owner or for a phone that never signed in to another account.
 * Runs the real cloud-sync.js and view-only.js together against a fake Firebase.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const OWNER = 'se.muhammadfaizan@gmail.com';
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let ctx, store, sets, saves, toasts, remoteDoc, redraws;
function load(opts){
  opts = opts || {};
  store = new Map([['khata-cloud-sync-on', '1']]);
  sets = []; saves = []; toasts = []; redraws = [];
  remoteDoc = opts.remote === undefined ? null : opts.remote;
  const user = opts.user || null;
  const db = { collection: c => ({ doc: d => ({
    async get(){ const k = c + '/' + d; if(k === 'ledger/production') return { exists: !!remoteDoc, data: () => remoteDoc }; return { exists: false, data: () => null }; },
    async set(v){ sets.push({ path: c + '/' + d, value: v }); },
  }) }) };
  const auth = { get currentUser(){ return user; }, onAuthStateChanged(cb){ Promise.resolve().then(()=>cb(user)); return ()=>{}; }, async signOut(){} };
  const firebase = { apps: [{}], initializeApp(){}, auth: () => auth, firestore: () => db };
  ctx = vm.createContext({
    console: { log(){}, error(){} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp,
    setTimeout: (f, ms)=>{ ctx.__timers.push({ f, ms }); return ctx.__timers.length; }, clearTimeout(){}, setInterval(){},
    __timers: [],
    navigator: { onLine: true },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { getElementById: () => null, createElement: () => ({ style: {}, setAttribute(){}, appendChild(){}, remove(){}, animate(){} }), body: { appendChild(){}, classList: { toggle(){} } }, addEventListener(){}, head: { appendChild(){} } },
    firebase, escHtml: x => String(x), switchTab(){ redraws.push(1); }, encEnabled: () => false,
    showToast: m => toasts.push(m),
    sha256Hex: async s => 'hash:' + s.length,
    currentEntryCount: () => 1, tombResetBaseline(){}, ensureDataDefaults: async () => false, UNDO_STACK: [], updateUndoButton(){},
    save: async () => { saves.push(JSON.stringify(ctx.DATA)); },
  });
  vm.runInContext(`var DATA = ${JSON.stringify(opts.data || { production: [{ id: 'a' }] })}; var CURRENT_TAB = 'overview'; var UNDO_SUPPRESS = false;`, ctx);
  vm.runInContext(read('js/cloud-sync.js'), ctx);
  vm.runInContext(read('js/view-only.js'), ctx);
  if(opts.flag) store.set('khata-view-only', '1');
}
const run = code => vm.runInContext(code, ctx);
const signIn = (email, verified) => store.set('khata-cloud-user', JSON.stringify({ email, verified: verified !== false }));
// The cloud keeps one document per section (ledger/<section>); these tests use the Production one.
const remoteLedger = (data, savedAt) => ({ section: 'production', payload: JSON.stringify(data), encrypted: false, savedAt: savedAt || '2026-09-30T10:00:00.000Z' });
beforeEach(() => load());

describe('who is view-only', () => {
  test('a phone that never signed in, and the owner, are not view-only', () => {
    assert.equal(run('viewOnly()'), false);
    signIn(OWNER); assert.equal(run('viewOnly()'), false);
    signIn(OWNER.toUpperCase()); assert.equal(run('viewOnly()'), false);
  });
  test('a verified account that is not the owner is view-only', () => {
    signIn('someone@example.com'); assert.equal(run('viewOnly()'), true);
  });
  test('an unverified account is not view-only (it cannot sync at all yet)', () => {
    signIn('someone@example.com', false); assert.equal(run('viewOnly()'), false);
  });
  test('signing in as a non-owner sets the flag, signing out keeps it, the owner signing in clears it', () => {
    run(`cloudSetUser({ email: 'someone@example.com', emailVerified: true })`);
    assert.equal(store.get('khata-view-only'), '1');
    run(`cloudSetUser(null)`);
    assert.equal(run('viewOnly()'), true, 'signing out must not unlock editing');
    run(`cloudSetUser({ email: '${OWNER}', emailVerified: true })`);
    assert.equal(store.has('khata-view-only'), false);
    assert.equal(run('viewOnly()'), false);
  });
  test('an unverified sign-in does not change the flag either way', () => {
    run(`cloudSetUser({ email: 'someone@example.com', emailVerified: false })`);
    assert.equal(store.has('khata-view-only'), false);
  });
});

describe('saving', () => {
  test('owner and never-signed-in phones save as before', () => {
    assert.equal(run('viewOnlySaveBlocked()'), false);
    signIn(OWNER); assert.equal(run('viewOnlySaveBlocked()'), false);
    assert.equal(toasts.length, 0);
  });
  test('a view-only phone refuses to save, says so, and puts the ledger back', async () => {
    signIn('someone@example.com');
    run(`viewOnlyApply = viewOnlyApply; VIEW_BASELINE = JSON.stringify(DATA);`);
    run(`DATA.production.push({ id: 'sneaky' });`);
    assert.equal(run('viewOnlySaveBlocked()'), true);
    await new Promise(r => setImmediate(r));
    assert.match(toasts[0], /View only/);
    assert.deepEqual(run('DATA.production.map(r => r.id)'), ['a'], 'the change that slipped through is undone');
    assert.equal(redraws.length, 1);
  });
  test('the only save allowed is the one storing the cloud copy, and only while it runs', async () => {
    signIn('someone@example.com');
    const seen = await run(`viewOnlyAllowSave(async () => viewOnlySaveBlocked())`);
    assert.equal(seen, false);
    assert.equal(run('VIEW_SAVE_ALLOWED'), false);
    assert.equal(run('viewOnlySaveBlocked()'), true);
  });
  test('core.js checks the gate first, before it touches anything', () => {
    const core = read('js/core.js');
    const at = core.indexOf('async function save(){');
    assert.ok(at > 0);
    const lines = core.slice(at, at + 900).split('\n').slice(1, 4);
    // Release 3 (Needs approval): the proposals gate (js/proposals.js) may come first - it only acts for a person who
    // needs approval, and stops the save before anything is stored. The view-only gate follows, still ahead of everything else.
    const gate = lines.findIndex(l => /viewOnlySaveBlocked/.test(l));
    assert.ok(gate === 0 || (gate === 1 && /proposalsWouldHold/.test(lines[0])), 'only the proposals gate may precede the view-only gate');
    assert.ok(core.indexOf('viewOnlySaveBlocked()', at) < core.indexOf('Saving', at), 'the gates run before the status line or anything else is touched');
  });
});

describe('Cloud Sync on a view-only phone', () => {
  test('never pushes: not scheduled, and a direct push sends nothing', async () => {
    signIn('someone@example.com');
    run('cloudSyncSchedule()');
    assert.equal(ctx.__timers.length, 0);
    await run('cloudPushNow()');
    assert.equal(sets.length, 0);
  });
  test('the owner still pushes', async () => {
    load({ user: { email: OWNER, emailVerified: true, async reload(){}, async getIdToken(){ return 't'; } } });
    signIn(OWNER);
    run('cloudSyncSchedule()');
    assert.equal(ctx.__timers.length, 1);
    await run('cloudPushNow()');
    assert.ok(sets.length >= 1, 'the owner sends its sections');
    assert.ok(sets.some(x => x.path === 'ledger/production'), 'one document per section');
  });
  test('a newer cloud copy is brought down and stored with no question asked, and nothing is sent', async () => {
    signIn('someone@example.com');
    load({ user: { email: 'someone@example.com', emailVerified: true }, remote: remoteLedger({ production: [{ id: 'x' }, { id: 'y' }] }) });
    signIn('someone@example.com');
    await run('cloudSyncCheckOnStart()');
    assert.deepEqual(run('DATA.production.map(r => r.id)'), ['x', 'y']);
    assert.equal(saves.length, 1);
    assert.equal(sets.length, 0);
    assert.equal(JSON.parse(store.get('khata-cloud-sec-seen')).production, '2026-09-30T10:00:00.000Z');
    assert.equal(run('CLOUD_STATUS'), 'synced');
    assert.equal(run('CLOUD_PENDING_PULL'), null);
  });
  test('the store is allowed only for that one save; a second look at the same copy changes nothing', async () => {
    load({ user: { email: 'someone@example.com', emailVerified: true }, remote: remoteLedger({ production: [{ id: 'x' }] }) });
    signIn('someone@example.com');
    await run('cloudSyncCheckOnStart()');
    await run('cloudSyncCheckOnStart()');
    assert.equal(saves.length, 1);
    assert.equal(sets.length, 0);
    assert.equal(run('CLOUD_STATUS'), 'synced');
  });
  test('no ledger in the cloud yet: says so and does not seed it from the phone', async () => {
    load({ user: { email: 'someone@example.com', emailVerified: true }, remote: null });
    signIn('someone@example.com');
    await run('cloudSyncCheckOnStart()');
    assert.equal(sets.length, 0);
    assert.equal(run('CLOUD_STATUS'), 'error');
    assert.match(run('cloudStatusText()'), /owner/);
  });
  test('a signed-out view-only phone gets no push either', async () => {
    load({ flag: true });
    run('cloudSyncSchedule()');
    assert.equal(ctx.__timers.length, 0);
  });
  test('the status line says view only', () => {
    signIn('someone@example.com');
    store.set('khata-cloud-last-ok', String(Date.now()));
    assert.match(run('cloudStatusText()'), /view only/);
    signIn(OWNER);
    assert.doesNotMatch(run('cloudStatusText()'), /view only/);
  });
});

describe('the screen', () => {
  const src = read('js/view-only.js');
  const selectors = src.match(/const VIEW_ONLY_WRITE_SELECTOR = \[([\s\S]*?)\]\.join/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  const html = read('index.html');
  const css = html.match(/View-only phone \(js\/view-only\.js\)[\s\S]*?\{ display:none !important; \}/)[0];

  test('every hidden control is hidden by the CSS as well as blocked by the click guard', () => {
    assert.ok(selectors.length > 20);
    selectors.forEach(sel => assert.ok(css.includes('body.view-only ' + sel), `${sel} is in view-only.js but not hidden by the CSS in index.html`));
  });
  test('every add / edit / delete / save control used in the pages is covered', () => {
    const code = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js') && f !== 'view-only.js').map(f => read('js/' + f)).join('\n');
    // data attributes that mark a control which changes the ledger
    ['data-edit', 'data-del', 'data-finish', 'data-add', 'data-cancel', 'data-toggle-active', 'data-move', 'data-cheque',
     'data-replace-cheque', 'data-link-replacement', 'data-toggle-form', 'data-snap-restore', 'data-quick-add', 'data-undo-id',
     'data-rh-edit', 'data-rh-del', 'data-l-ok', 'data-l-toggle', 'data-l-return', 'data-l-confirm', 'data-l-cancel']
      .forEach(a => { assert.ok(code.includes(a), `${a} is no longer used anywhere - remove it from view-only.js`); assert.ok(selectors.includes('[' + a + ']'), `${a} is not covered`); });
    // every button that saves a form: inside a .form-actions block, or listed here
    const alone = new Set(['saveBusinessInfo', 'saveOpening', 'saveOpeningBalances', 'saveRateCalc', 'saveRateChange', 'settleAllEmployees', 'importProduction', 'restoreJsonBtn', 'la_apply', 'r_addChequeRow']);
    alone.forEach(id => assert.ok(selectors.includes('#' + id), `#${id} is not covered`));
    const deviceOnly = new Set(['saveFailBackup', 'saveFailHide', 'pinChangeSaveBtn', 'pinDisableSaveBtn', 'pinRecSaveBtn']); // device settings / messages, not the ledger
    for (const m of code.matchAll(/<button[^>]*\bid="((?:add|save|settle|import|restore)[A-Za-z_]*)"/g)) {
      const id = m[1];
      if (deviceOnly.has(id) || alone.has(id)) continue;
      // must sit in a .form-actions block (hidden as a whole) - find the block that holds it
      const at = code.indexOf('id="' + id + '"');
      const before = code.slice(Math.max(0, at - 400), at);
      assert.ok(/class="form-actions"/.test(before), `button #${id} is not inside a .form-actions block and is not listed in view-only.js`);
    }
  });
  test('the header has the View only label, and the page loads view-only.js after cloud-sync.js and before the start-up file', () => {
    assert.match(html, /id="viewOnlyBadge"[^>]*hidden>View only</);
    const order = [...html.matchAll(/<script[^>]+src="\.\/(js\/[^"]+)"/g)].map(m => m[1]);
    assert.ok(order.indexOf('js/view-only.js') > order.indexOf('js/cloud-sync.js'));
    assert.ok(order.indexOf('js/view-only.js') < order.indexOf('js/lock-init.js'));
  });
});
