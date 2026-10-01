'use strict';
/*
 * Cloud Sync sign-in (js/cloud-sync.js): email/password account with a fake Firebase standing in
 * for the SDK. Checks that sync only runs for a signed-in, email-verified account, that an old
 * anonymous session is dropped, that sign-up sends the verification email, that sign-out is local,
 * and that a saved login is still known (and the app still works) with no signal.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let ctx, store, fb, timers;
function makeUser(o){ return Object.assign({ email: 'a@b.co', emailVerified: true, isAnonymous: false,
  async reload(){ fb.reloads++; if(fb.verifyOnReload) this.emailVerified = true; },
  async getIdToken(){ return 'tok'; },
  async sendEmailVerification(){ fb.verificationsSent++; } }, o || {}); }
function load(opts){
  opts = opts || {};
  store = new Map([['khata-cloud-sync-on', '1']]);
  timers = [];
  fb = { reloads: 0, verificationsSent: 0, resets: [], signedOut: 0, verifyOnReload: false, listeners: [], current: opts.user || null };
  const auth = {
    get currentUser(){ return fb.current; },
    onAuthStateChanged(cb){ fb.listeners.push(cb); Promise.resolve().then(()=>cb(fb.current)); return ()=>{}; },
    async signInWithEmailAndPassword(e, p){
      if(p !== 'right-password'){ const err = new Error('bad'); err.code = 'auth/invalid-credential'; throw err; }
      fb.current = makeUser({ email: e }); return { user: fb.current };
    },
    async createUserWithEmailAndPassword(e){ fb.current = makeUser({ email: e, emailVerified: false }); return { user: fb.current }; },
    async sendPasswordResetEmail(e){ fb.resets.push(e); },
    async signOut(){ fb.signedOut++; fb.current = null; },
  };
  const firebase = { apps: [], initializeApp(){ this.apps.push({}); }, auth: () => auth, firestore: () => ({ tag: 'db' }) };
  ctx = vm.createContext({
    console: { log(){}, error(){} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp,
    setTimeout: (f, ms)=>{ timers.push({ f, ms }); return timers.length; }, clearTimeout(){}, setInterval(){},
    navigator: { onLine: opts.online !== false },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { getElementById: () => null, createElement: () => ({ style: {}, setAttribute(){}, appendChild(){}, remove(){} }), body: { appendChild(){} }, addEventListener(){} },
    firebase, escHtml: x => String(x), switchTab(){}, encEnabled: () => false,
  });
  vm.runInContext(`var DATA = {};`, ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud-sync.js'), 'utf8'), ctx);
}
const run = code => vm.runInContext(code, ctx);
const rejects = async (code) => { try{ await run(code); } catch(e){ return e; } assert.fail('should have thrown'); };
beforeEach(() => load());

describe('who may sync', () => {
  test('signed out: cloudSdkReady refuses with the signedout code, never signs in anonymously', async () => {
    const e = await rejects('cloudSdkReady()');
    assert.equal(e.cloudCode, 'signedout');
    assert.equal(fb.current, null);
  });
  test('signed in and verified: hands back the database and remembers the account', async () => {
    load({ user: makeUser() });
    assert.equal((await run('cloudSdkReady()')).tag, 'db');
    assert.deepEqual(JSON.parse(store.get('khata-cloud-user')), { email: 'a@b.co', verified: true });
  });
  test('signed in but not verified: refuses with the unverified code, and picks up a verification done meanwhile', async () => {
    load({ user: makeUser({ emailVerified: false }) });
    assert.equal((await rejects('cloudSdkReady()')).cloudCode, 'unverified');
    assert.equal(fb.reloads, 1);
    fb.verifyOnReload = true;
    assert.equal((await run('cloudSdkReady()')).tag, 'db');
  });
  test('an old anonymous session is signed out and treated as signed out', async () => {
    load({ user: makeUser({ isAnonymous: true, email: '' }) });
    assert.equal((await rejects('cloudSdkReady()')).cloudCode, 'signedout');
    assert.equal(fb.signedOut, 1);
  });
  test('failures map to the right status', () => {
    run(`cloudFail(Object.assign(new Error('x'), {cloudCode:'signedout'}))`); assert.equal(run('CLOUD_STATUS'), 'signedout');
    run(`cloudFail(Object.assign(new Error('x'), {cloudCode:'unverified'}))`); assert.equal(run('CLOUD_STATUS'), 'unverified');
    run(`cloudFail(Object.assign(new Error('Missing or insufficient permissions.'), {code:'permission-denied'}))`);
    assert.equal(run('CLOUD_STATUS'), 'error'); assert.match(run('cloudStatusText()'), /approved/);
  });
  test('automatic push is only scheduled for a verified account', () => {
    run('cloudSyncSchedule()'); assert.equal(timers.length, 0);
    store.set('khata-cloud-user', JSON.stringify({ email: 'a@b.co', verified: false }));
    run('cloudSyncSchedule()'); assert.equal(timers.length, 0);
    store.set('khata-cloud-user', JSON.stringify({ email: 'a@b.co', verified: true }));
    run('cloudSyncSchedule()'); assert.equal(timers.length, 1);
  });
  test('coming back to the app does not re-check while signed out', () => {
    run(`var __n = 0; cloudSyncCheckOnStart = function(){ __n++; }; setCloudStatus('signedout'); cloudSyncOnForeground();`);
    assert.equal(run('__n'), 0);
    run(`setCloudStatus('unverified'); cloudSyncOnForeground();`);
    assert.equal(run('__n'), 1);
  });
});

describe('sign-in, sign-up, reset, sign-out', () => {
  test('sign in with the right password saves the account; a wrong one gives a plain message', async () => {
    await run(`cloudSignIn('me@x.co', 'right-password')`);
    assert.equal(run('cloudUserNow().email'), 'me@x.co');
    const e = await rejects(`cloudSignIn('me@x.co', 'nope')`);
    assert.equal(run(`cloudAuthErrorText(${JSON.stringify({ code: e.code })})`), 'Email or password is incorrect.');
  });
  test('sign up sends the verification email and lands as not-yet-verified', async () => {
    await run(`cloudSignUp('new@x.co', 'a-long-password')`);
    assert.equal(fb.verificationsSent, 1);
    assert.deepEqual(JSON.parse(store.get('khata-cloud-user')), { email: 'new@x.co', verified: false });
    assert.equal(run('cloudCanSync()'), false);
  });
  test('password reset asks Firebase to email the link', async () => {
    await run(`cloudResetPassword('me@x.co')`);
    assert.deepEqual(fb.resets, ['me@x.co']);
  });
  test('sign out clears the saved account, stops a pending push, and keeps the ledger untouched', async () => {
    load({ user: makeUser() });
    run(`DATA.sale = [{id:1}]`);
    await run('cloudSdkReady()');
    await run('cloudSignOut()');
    assert.equal(store.has('khata-cloud-user'), false);
    assert.equal(run('CLOUD_STATUS'), 'signedout');
    assert.equal(run('DATA.sale.length'), 1);
  });
  test('the account form: the right block for each state', async () => {
    assert.match(run('cloudAccountHtml()'), /cloudSignInBtn/);
    run(`CLOUD_AUTH_MODE='signup'`); assert.match(run('cloudAccountHtml()'), /cloudSignUpBtn/);
    run(`CLOUD_AUTH_MODE='reset'`); assert.match(run('cloudAccountHtml()'), /cloudResetBtn/);
    store.set('khata-cloud-user', JSON.stringify({ email: 'a@b.co', verified: false }));
    assert.match(run('cloudAccountHtml()'), /cloudVerifiedBtn/);
    store.set('khata-cloud-user', JSON.stringify({ email: 'a@b.co', verified: true }));
    const h = run('cloudAccountHtml()');
    assert.match(h, /Signed in as a@b\.co/); assert.match(h, /cloudSignOutBtn/); assert.doesNotMatch(h, /cloudVerifiedBtn/);
  });
});

describe('offline', () => {
  test('a saved login is still shown with no signal, and signing in says to connect first', async () => {
    load({ online: false });
    store.set('khata-cloud-user', JSON.stringify({ email: 'a@b.co', verified: true }));
    assert.equal(run('cloudUserNow().email'), 'a@b.co');
    assert.equal(run('cloudCanSync()'), true);
    const e = await rejects(`cloudSignIn('a@b.co', 'right-password')`);
    assert.match(e.message, /offline/i);
  });
  test('the Firestore rule wants a verified email', () => {
    assert.match(run('CLOUD_FIRESTORE_RULE'), /email_verified == true/);
  });
});
