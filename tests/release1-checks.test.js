'use strict';
/*
 * Release 1 (email login + view-only phones) - final checks that sit around the feature rather than
 * inside it: what a viewer's phone shows and does on screen (header label, locked fields, swallowed
 * taps), what happens when the rules refuse an account, and that the version, cache and notes were
 * kept in step. Runs the real cloud-sync.js and view-only.js against a fake page and fake Firebase.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const OWNER = 'se.muhammadfaizan@gmail.com';
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// ---- a very small fake page -----------------------------------------------------------------
function fakeEl(attrs){
  const el = { attrs: attrs || {}, disabled: false, hidden: false, textContent: '', classes: new Set(), parentNode: null,
    classList: { add: c => el.classes.add(c), remove: c => el.classes.delete(c), toggle: (c, on) => { if(on === undefined) on = !el.classes.has(c); on ? el.classes.add(c) : el.classes.delete(c); } },
    closest(sel){ let n = el; while(n){ if(n.matches && n.matches(sel)) return n; n = n.parentNode; } return null; },
    querySelector(){ return null; },
    matches(sel){ return sel.split(',').some(part => {
      part = part.trim();
      if(part.startsWith('[') && part.endsWith(']')) return Object.prototype.hasOwnProperty.call(el.attrs, part.slice(1, -1));
      if(part.startsWith('#')) return el.attrs.id === part.slice(1);
      if(part.startsWith('.')) return el.classes.has(part.slice(1));
      return false;
    }); },
  };
  return el;
}

let ctx, store, sets, saves, toasts, redraws, handlers, body, badge, getError, remoteDoc;
function load(opts){
  opts = opts || {};
  store = new Map([['khata-cloud-sync-on', '1']]);
  sets = []; saves = []; toasts = []; redraws = []; handlers = [];
  getError = opts.getError || null; remoteDoc = opts.remote === undefined ? null : opts.remote;
  body = fakeEl(); badge = fakeEl({ id: 'viewOnlyBadge' }); badge.hidden = true;
  const panels = opts.panels || fakeEl({ id: 'panels' });
  const user = opts.user || null;
  const db = { collection: c => ({ doc: d => ({
    async get(){ if(getError) throw getError; return c + '/' + d === 'sync/ledger' ? { exists: !!remoteDoc, data: () => remoteDoc } : { exists: false, data: () => null }; },
    async set(v){ sets.push(c + '/' + d); },
  }) }) };
  const auth = { get currentUser(){ return user; }, onAuthStateChanged(cb){ Promise.resolve().then(()=>cb(user)); return ()=>{}; }, async signOut(){} };
  ctx = vm.createContext({
    console: { log(){}, error(){} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp,
    setTimeout: () => 1, clearTimeout(){}, setInterval(){}, navigator: { onLine: true },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { body, getElementById: id => id === 'viewOnlyBadge' ? badge : id === 'panels' ? panels : null,
      createElement: () => fakeEl(), addEventListener: (t, fn, cap) => handlers.push({ t, fn, cap }), head: { appendChild(){} } },
    firebase: { apps: [{}], initializeApp(){}, auth: () => auth, firestore: () => db },
    escHtml: x => String(x), switchTab(){ redraws.push(1); }, encEnabled: () => false, showToast: m => toasts.push(m),
    sha256Hex: async s => 'hash:' + s.length, currentEntryCount: () => 1, tombResetBaseline(){}, ensureDataDefaults: async () => false,
    UNDO_STACK: [], updateUndoButton(){}, save: async () => { saves.push(1); },
  });
  vm.runInContext(`var DATA = { production: [{ id: 'a' }] }; var CURRENT_TAB = 'overview'; var UNDO_SUPPRESS = false;`, ctx);
  vm.runInContext(read('js/cloud-sync.js'), ctx);
  vm.runInContext(read('js/view-only.js'), ctx);
}
const run = code => vm.runInContext(code, ctx);
const signIn = (email, verified) => store.set('khata-cloud-user', JSON.stringify({ email, verified: verified !== false }));
const click = target => { const ev = { target, stopped: false, prevented: false, preventDefault(){ ev.prevented = true; }, stopPropagation(){}, stopImmediatePropagation(){ ev.stopped = true; } };
  handlers.filter(h => h.t === 'click').forEach(h => h.fn(ev)); return ev; };
beforeEach(() => load());

describe('the header label and the page class', () => {
  test('a viewer sees the label and the view-only page class; the owner and a never-signed-in phone do not', () => {
    signIn('viewer@example.com'); run('viewOnlyApply()');
    assert.equal(badge.hidden, false); assert.ok(body.classes.has('view-only'));
    load(); signIn(OWNER); run('viewOnlyApply()');
    assert.equal(badge.hidden, true); assert.ok(!body.classes.has('view-only'));
    load(); run('viewOnlyApply()');
    assert.equal(badge.hidden, true); assert.ok(!body.classes.has('view-only'));
  });
  test('the owner signing in on a phone that was a viewer removes the label straight away', () => {
    run(`cloudSetUser({ email: 'viewer@example.com', emailVerified: true })`);
    assert.equal(badge.hidden, false);
    run(`cloudSetUser({ email: '${OWNER}', emailVerified: true })`);
    assert.equal(badge.hidden, true); assert.ok(!body.classes.has('view-only'));
  });
  test('signing out leaves the label on', () => {
    run(`cloudSetUser({ email: 'viewer@example.com', emailVerified: true })`);
    run(`cloudSetUser(null)`);
    assert.equal(badge.hidden, false); assert.ok(body.classes.has('view-only'));
  });
});

describe('the pages on a viewer phone', () => {
  function pageWith(fields, empties, formCards){
    const panels = fakeEl({ id: 'panels' });
    panels.children = [{}];
    panels.querySelectorAll = sel => {
      if(sel.includes('#ob')) return fields;
      if(sel === '.empty') return empties;
      if(sel === '.form-actions') return formCards.map(c => c.actions);
      return [];
    };
    return panels;
  }
  test('saved values stay visible but locked, and "add one above" no longer points at a missing form', () => {
    const f1 = fakeEl({ id: 'ob' }), f2 = fakeEl({ id: 'biz_name' }), empty = fakeEl(); empty.textContent = 'No entries yet - add one above';
    load({ panels: pageWith([f1, f2], [empty], []) });
    signIn('viewer@example.com'); run('viewOnlyApply()');
    assert.equal(f1.disabled, true); assert.equal(f2.disabled, true);
    assert.equal(empty.textContent, 'No entries yet');
  });
  test('an owner sees the pages untouched', () => {
    const f1 = fakeEl({ id: 'ob' }), empty = fakeEl(); empty.textContent = 'No entries yet - add one above';
    load({ panels: pageWith([f1], [empty], []) });
    signIn(OWNER); run('viewOnlyApply()');
    assert.equal(f1.disabled, false); assert.equal(empty.textContent, 'No entries yet - add one above');
  });
});

describe('taps on a viewer phone', () => {
  test('a tap on Edit / Delete / Save-type controls is swallowed with a message', () => {
    signIn('viewer@example.com');
    ['data-edit', 'data-del', 'data-add', 'data-cheque', 'data-undo-id', 'data-l-confirm'].forEach(a => {
      const btn = fakeEl({ [a]: '1' }), ev = click(btn);
      assert.equal(ev.stopped, true, a); assert.equal(ev.prevented, true, a);
    });
    const save = fakeEl({ id: 'saveRateChange' }); assert.equal(click(save).stopped, true);
    const inside = fakeEl({ 'data-edit': '1' }), child = fakeEl(); child.parentNode = inside; assert.equal(click(child).stopped, true, 'a tap on something inside the button');
    assert.match(toasts[toasts.length - 1], /View only/);
  });
  test('a tap on a reading control (filters, pages, PDF) goes through', () => {
    signIn('viewer@example.com');
    const before = toasts.length;
    [fakeEl({ 'data-page': '2' }), fakeEl({ id: 'downloadPdf' }), fakeEl({ 'data-period': 'week' })].forEach(el => assert.equal(click(el).stopped, false));
    assert.equal(toasts.length, before);
  });
  test('the owner and a never-signed-in phone are never blocked', () => {
    [null, OWNER].forEach(who => {
      load(); if(who) signIn(who);
      assert.equal(click(fakeEl({ 'data-edit': '1' })).stopped, false);
    });
  });
});

describe('an account the rules refuse', () => {
  test('a signed-in phone the owner has not approved gets a plain message, keeps its ledger and sends nothing', async () => {
    load({ user: { email: 'stranger@example.com', emailVerified: true }, getError: { code: 'permission-denied', message: 'Missing or insufficient permissions.' } });
    signIn('stranger@example.com');
    await run('cloudSyncCheckOnStart()');
    assert.equal(run('CLOUD_STATUS'), 'error');
    assert.match(run('cloudStatusText()'), /approve/);
    assert.equal(run('JSON.stringify(DATA.production.map(r => r.id))'), '["a"]');
    assert.equal(sets.length, 0); assert.equal(saves.length, 0);
  });
  test('an approval that has expired is refused the same way and the phone stays view-only', async () => {
    load({ user: { email: 'viewer@example.com', emailVerified: true }, getError: { code: 'permission-denied', message: 'insufficient permissions' } });
    signIn('viewer@example.com');
    await run('cloudSyncCheckOnStart()');
    assert.match(run('cloudStatusText()'), /approve/);
    assert.equal(run('viewOnly()'), true);
    assert.equal(sets.length, 0);
  });
});

describe('version, cache and notes stay in step', () => {
  const pkg = JSON.parse(read('package.json')), html = read('index.html'), sw = read('service-worker.js');
  test('the version is the same in package.json and on the header tag', () => {
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    assert.equal(html.match(/id="appVersionTag">v([\d.]+)</)[1], pkg.version);
  });
  test('the service worker has a cache version and caches view-only.js', () => {
    assert.match(sw, /const CACHE_VERSION = 'v\d+';/);
    assert.ok(sw.includes("'./js/view-only.js'"));
  });
  test('HOSTING.txt explains view-only phones, how to approve someone, and what a viewer can see', () => {
    const h = read('HOSTING.txt');
    assert.match(h, /View-only phones/); assert.match(h, /config\/access/); assert.match(h, /expiresAt/); assert.match(h, /write:\s*false/); assert.match(h, /Settings > People/); assert.match(h, /Approve to view/);
    assert.match(h, /Who sees what/);
  });
  test('the tests README lists the view-only and cloud sign-in test files', () => {
    const r = read('tests/README.md');
    ['view-only.test.js', 'release1-checks.test.js', 'cloud-access.test.js', 'cloud-auth.test.js', 'cloud-people.test.js'].forEach(f => assert.ok(r.includes('`' + f + '`'), f));
  });
});
