'use strict';
/*
 * Data-loss regression (3.17.32): one phone, two accounts.
 * A Production operator signing in on a phone that holds the owner's ledger empties the sections the operator
 * may not see (permsPurgeHidden). When the owner then signs in on the same phone, those empty sections must NOT
 * be sent to the cloud over the real data, and must be brought back from the cloud.
 * Runs the real cloud-sync.js and view-only.js against a fake Firebase that keeps documents in memory.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const OWNER = 'se.muhammadfaizan@gmail.com', OPERATOR = 'operator@example.com';
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function phone(){
  const store = new Map([['khata-cloud-sync-on', '1']]);
  const docs = new Map(), writes = [];
  let user = null;
  const db = { collection: c => ({ doc: d => ({
    async get(){ const k = c + '/' + d; return { exists: docs.has(k), data: () => docs.get(k) }; },
    async set(v){ docs.set(c + '/' + d, v); writes.push(c + '/' + d); },
  }) }) };
  const auth = { get currentUser(){ return user; }, onAuthStateChanged(cb){ Promise.resolve().then(()=>cb(user)); return ()=>{}; }, async signOut(){} };
  const ctx = vm.createContext({
    console: { log(){}, error(){} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp,
    setTimeout: ()=> 1, clearTimeout(){}, setInterval(){}, navigator: { onLine: true },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { getElementById: () => null, createElement: () => ({ style: {}, setAttribute(){}, appendChild(){}, remove(){}, animate(){} }), body: { appendChild(){}, classList: { toggle(){} } }, addEventListener(){}, head: { appendChild(){} }, querySelectorAll: () => [] },
    firebase: { apps: [{}], initializeApp(){}, auth: () => auth, firestore: () => db },
    escHtml: x => String(x), switchTab(){}, encEnabled: () => false, showToast(){}, tombResetBaseline(){},
    sha256Hex: async s => 'h' + s.length + ':' + s.slice(0, 40), currentEntryCount: () => 1, ensureDataDefaults: async () => false,
    UNDO_STACK: [], updateUndoButton(){}, save: async () => {},
  });
  vm.runInContext(`var DATA = ${JSON.stringify({ production: [{ id: 'p1' }], sale: [{ id: 's1', amount: 500 }], clients: [{ id: 'c1', name: 'Ali' }], expense: [{ id: 'e1' }], qualities: [{ id: 'q1' }] })}; var CURRENT_TAB = 'overview'; var UNDO_SUPPRESS = false;`, ctx);
  vm.runInContext(read('js/cloud-sync.js'), ctx);
  vm.runInContext(read('js/view-only.js'), ctx);
  const run = code => vm.runInContext(code, ctx);
  const signInAs = (email, perms) => {
    user = { email, emailVerified: true, isAnonymous: false };
    store.set('khata-cloud-user', JSON.stringify({ email, verified: true }));
    if(perms) store.set('khata-cloud-perms', JSON.stringify(perms)); else store.delete('khata-cloud-perms');
    store.delete('khata-write-grant');
    vm.runInContext('cloudSetUser(' + JSON.stringify(user) + ')', ctx); // what the app does when the account changes
  };
  return { run, store, docs, writes, signInAs, db };
}

describe('owner signing in after an operator on the same phone', () => {
  test('the wiped sections are not sent to the cloud, and come back from it', async () => {
    const p = phone();
    // 1. the owner's phone is in step with the cloud
    p.signInAs(OWNER);
    await p.run('cloudPushNow(true)');
    const cloudSales = JSON.stringify(p.docs.get('ledger/sales').payload);
    assert.ok(cloudSales.includes('s1'), 'the cloud holds the sale');

    // 2. the Production operator signs in on the same phone: sections he may not see are emptied here
    p.signInAs(OPERATOR, { production: 'vae', reference: 'v', business: 'v' });
    await p.run('permsPurgeHidden()');
    assert.deepEqual(JSON.parse(p.run('JSON.stringify(DATA.sale)')), [], 'sales emptied on the phone');
    assert.ok(JSON.parse(p.store.get('khata-purged-sections')).includes('sales'), 'the emptied section is remembered');

    // 3. the owner signs in again
    p.signInAs(OWNER);
    
    p.writes.length = 0;
    await p.run('cloudSyncCheckOnStart()');
    assert.ok(!p.writes.includes('ledger/sales') && !p.writes.includes('ledger/expenses'), 'nothing emptied was written to the cloud: ' + p.writes.join(','));
    assert.equal(JSON.stringify(p.docs.get('ledger/sales').payload), cloudSales, 'the cloud copy is untouched');
    assert.deepEqual(JSON.parse(p.run('JSON.stringify(DATA.sale)')), [{ id: 's1', amount: 500 }], 'the owner sees the sale again');
    assert.deepEqual(JSON.parse(p.run('JSON.stringify(DATA.clients)')), [{ id: 'c1', name: 'Ali' }]);
    assert.equal(p.store.get('khata-purged-sections') || null, null, 'the list is cleared once restored');
  });

  test('even a forced push (Keep this device / Sync Now) never sends a wiped section', async () => {
    const p = phone();
    p.signInAs(OWNER);
    await p.run('cloudPushNow(true)');
    p.signInAs(OPERATOR, { production: 'vae', reference: 'v', business: 'v' });
    await p.run('permsPurgeHidden()');
    p.signInAs(OWNER); 
    p.writes.length = 0;
    await p.run('cloudPushNow(true)');
    assert.ok(!p.writes.includes('ledger/sales') && !p.writes.includes('ledger/expenses'), 'wiped sections skipped: ' + p.writes.join(','));
    assert.ok(p.writes.includes('ledger/production'), 'sections that were not wiped still go');
  });

  test('an owner phone that never had another account on it behaves as before', async () => {
    const p = phone();
    p.signInAs(OWNER);
    await p.run('cloudPushNow(true)');
    p.writes.length = 0;
    p.run("DATA.sale.push({ id: 's2' })");
    await p.run('cloudPushNow()');
    assert.deepEqual(p.writes, ['ledger/sales'], 'only the changed section is sent');
  });
});
