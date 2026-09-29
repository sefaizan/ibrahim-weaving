'use strict';
/*
 * Cloud permissions record (js/cloud-sync.js): the config/access document holding the owner email and
 * the approved-people map (empty for now), who may create it, and the Firestore rules text that
 * protects it. Fake Firestore stands in for the SDK.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const OWNER = 'se.muhammadfaizan@gmail.com';
let ctx, store, docs, sets, gets, failSet;
function load(opts){
  opts = opts || {};
  store = new Map();
  docs = new Map(); sets = []; gets = 0; failSet = !!opts.failSet;
  const db = { collection: c => ({ doc: d => ({
    async get(){ gets++; const k = c + '/' + d; return { exists: docs.has(k), data: () => docs.get(k) }; },
    async set(v){ if(failSet){ const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; } sets.push({ path: c + '/' + d, value: v }); docs.set(c + '/' + d, v); },
  }) }) };
  ctx = vm.createContext({
    console: { log(){}, error(){} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp,
    setTimeout(){ return 1; }, clearTimeout(){}, setInterval(){},
    navigator: { onLine: opts.online !== false },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { getElementById: () => null, createElement: () => ({ style: {}, setAttribute(){}, appendChild(){}, remove(){} }), body: { appendChild(){} }, addEventListener(){} },
    escHtml: x => String(x), switchTab(){}, encEnabled: () => false, __db: db,
  });
  vm.runInContext(`var DATA = {};`, ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud-sync.js'), 'utf8'), ctx);
}
const run = code => vm.runInContext(code, ctx);
const signIn = (email, verified) => store.set('khata-cloud-user', JSON.stringify({ email, verified }));
beforeEach(() => load());

describe('who is the owner', () => {
  test('only the verified owner address, in any letter case', () => {
    assert.equal(run('cloudIsOwner()'), false);
    signIn(OWNER, true); assert.equal(run('cloudIsOwner()'), true);
    signIn('SE.MuhammadFaizan@Gmail.com', true); assert.equal(run('cloudIsOwner()'), true);
    signIn(OWNER, false); assert.equal(run('cloudIsOwner()'), false);
    signIn('someone@else.com', true); assert.equal(run('cloudIsOwner()'), false);
  });
});

describe('the record', () => {
  test('a new record has the owner, an empty approved map and a timestamp', () => {
    const r = JSON.parse(JSON.stringify(run('cloudAccessNewRecord(1_800_000_000_000)')));
    assert.equal(r.ownerEmail, OWNER);
    assert.deepEqual(r.approved, {});
    assert.equal(r.updatedAt, new Date(1_800_000_000_000).toISOString());
  });
  test('the owner creates it once at config/access, and never overwrites an existing one', async () => {
    signIn(OWNER, true);
    await run('cloudEnsureAccessRecord(__db)');
    assert.equal(sets.length, 1);
    assert.equal(sets[0].path, 'config/access');
    assert.equal(store.get('khata-cloud-access-ok'), OWNER);
    store.delete('khata-cloud-access-ok');
    docs.get('config/access').approved = { 'x@y.co': { expiresAt: 1, addedAt: 0 } };
    await run('cloudEnsureAccessRecord(__db)');
    assert.equal(sets.length, 1, 'existing record must be left alone');
    assert.deepEqual(Object.keys(docs.get('config/access').approved), ['x@y.co']);
  });
  test('once confirmed it is not read again on later starts', async () => {
    signIn(OWNER, true);
    await run('cloudEnsureAccessRecord(__db)');
    const before = gets;
    await run('cloudEnsureAccessRecord(__db)');
    assert.equal(gets, before);
  });
  test('anyone but the verified owner never touches it', async () => {
    signIn('someone@else.com', true); await run('cloudEnsureAccessRecord(__db)');
    signIn(OWNER, false); await run('cloudEnsureAccessRecord(__db)');
    assert.equal(gets, 0); assert.equal(sets.length, 0);
  });
  test('offline or refused by the rules: quiet, nothing marked as done, tried again later', async () => {
    load({ online: false }); signIn(OWNER, true);
    await run('cloudEnsureAccessRecord(__db)');
    assert.equal(gets, 0); assert.equal(store.has('khata-cloud-access-ok'), false);
    load({ failSet: true }); signIn(OWNER, true);
    await run('cloudEnsureAccessRecord(__db)');
    assert.equal(store.has('khata-cloud-access-ok'), false);
  });
});

describe('the rules text', () => {
  const rule = () => run('CLOUD_FIRESTORE_RULE');
  test('owner address is in, no placeholder, verified email required', () => {
    assert.ok(rule().includes(OWNER));
    assert.ok(!/YOU@EXAMPLE/i.test(rule()));
    assert.match(rule(), /email_verified == true/);
    assert.match(rule(), /request\.auth\.token\.email\.lower\(\)/);
  });
  test('ledger: owner or approved-and-unexpired may read; owner or approved with write may create/update; only owner deletes', () => {
    assert.match(rule(), /match \/sync\/\{doc\}[\s\S]*?allow read: if isOwner\(\) \|\| isApproved\(\);/);
    assert.match(rule(), /allow create, update: if isOwner\(\) \|\| mayWrite\(\);/);
    assert.match(rule(), /allow delete: if isOwner\(\);/);
  });
  test('approval means present in the map AND expiresAt in the future (missing = expired); write needs write:true', () => {
    assert.match(rule(), /me\(\) in grants\(\)/);
    assert.match(rule(), /get\('expiresAt', 0\) > request\.time\.toMillis\(\)/);
    assert.match(rule(), /get\('write', false\) == true/);
  });
  test('permissions record: only the owner reads or edits it, ownerEmail pinned, never deleted', () => {
    assert.match(rule(), /match \/config\/access[\s\S]*?allow read: if isOwner\(\);/);
    assert.match(rule(), /allow create, update: if isOwner\(\)\s*&& request\.resource\.data\.ownerEmail == '/);
    assert.match(rule(), /allow delete: if false;/);
  });
  test('braces and parentheses balance', () => {
    const r = rule();
    assert.equal((r.match(/\{/g) || []).length, (r.match(/\}/g) || []).length);
    assert.equal((r.match(/\(/g) || []).length, (r.match(/\)/g) || []).length);
  });
});
