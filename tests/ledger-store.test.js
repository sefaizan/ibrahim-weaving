'use strict';
/*
 * js/ledger-store.js — the ledger lives in IndexedDB (localStorage only as a safety net).
 * A small fake IndexedDB and a fake localStorage (with the real ~5 MB limit) let these tests check the
 * promises that matter: nothing is ever lost, a failed migration leaves the old copy alone, a failed save
 * is kept in localStorage and moved over later, and an unreadable ledger is never replaced by a blank one.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SRC = read('js/ledger-store.js');
const KEY = 'khata-data-v3', ENC = 'khata-data-v3-enc', FLAG = 'khata-idb-in-use', STALE = 'khata-idb-stale-';

function fakeIdb(backing, flags){
  const makeDb = () => ({
    createObjectStore(){}, close(){},
    transaction(){
      const tx = {}, ops = [];
      const store = {
        get(k){ const r = {}; ops.push(() => {
          if(flags.failGet) throw new Error('read failed');
          if(flags.corruptVerify && flags.justPut){ flags.justPut = false; r.result = 'CORRUPT'; return; }
          r.result = backing.has(k) ? backing.get(k) : undefined; }); return r; },
        put(v, k){ const r = {}; ops.push(() => { if(flags.failPut) throw new Error('write failed'); backing.set(k, v); flags.justPut = true; r.result = k; }); return r; },
        delete(k){ const r = {}; ops.push(() => { backing.delete(k); r.result = undefined; }); return r; },
      };
      tx.objectStore = () => store;
      setImmediate(() => {
        try{ ops.forEach(f => f()); }catch(e){ tx.error = e; if(tx.onabort) tx.onabort(); return; }
        if(tx.oncomplete) tx.oncomplete();
      });
      return tx;
    },
  });
  return { open(){
    flags.opens = (flags.opens || 0) + 1;
    const rq = {};
    setImmediate(() => {
      if(flags.failOpen){ rq.error = new Error('open failed'); if(rq.onerror) rq.onerror(); return; }
      rq.result = makeDb();
      if(rq.onupgradeneeded) rq.onupgradeneeded();
      if(rq.onsuccess) rq.onsuccess();
    });
    return rq;
  } };
}

// One "phone". Pass the same `phone` object to load() again to simulate closing and reopening the app.
function newPhone(o){ o = o || {}; return { ls: new Map(), idb: new Map(), flags: {}, quota: o.quota || Infinity, noIdb: !!o.noIdb }; }
function load(phone){
  const ls = {
    getItem: k => phone.ls.has(k) ? phone.ls.get(k) : null,
    setItem: (k, v) => {
      let total = 0; phone.ls.forEach((val, key) => { if(key !== k) total += val.length; });
      if(total + String(v).length > phone.quota) throw new Error('QuotaExceededError');
      phone.ls.set(k, String(v));
    },
    removeItem: k => { phone.ls.delete(k); },
  };
  const g = { localStorage: ls, setTimeout, clearTimeout, console };
  if(!phone.noIdb) g.indexedDB = fakeIdb(phone.idb, phone.flags);
  const ctx = vm.createContext(g);
  vm.runInContext(SRC, ctx, { filename: 'js/ledger-store.js' });
  return { run: code => vm.runInContext(code, ctx) };
}
const err = async (p) => p.then(() => null, e => e.message);

describe('a fresh phone', () => {
  test('nothing stored reads as nothing; a save goes to IndexedDB and leaves localStorage free', async () => {
    const phone = newPhone(), app = load(phone);
    assert.equal(await app.run(`ledgerRead('${KEY}')`), null);
    await app.run(`ledgerWrite('${KEY}', '{"a":1}')`);
    assert.equal(phone.idb.get(KEY), '{"a":1}');
    assert.equal(phone.ls.has(KEY), false);
    assert.equal(phone.ls.get(FLAG), '1');
    assert.equal(await load(phone).run(`ledgerRead('${KEY}')`), '{"a":1}', 'still there after reopening the app');
  });
  test('the plain and the encrypted ledger are separate keys', async () => {
    const phone = newPhone(), app = load(phone);
    await app.run(`ledgerWrite('${KEY}', 'plain')`); await app.run(`ledgerWrite('${ENC}', 'cipher')`);
    assert.equal(await app.run(`ledgerRead('${KEY}')`), 'plain');
    assert.equal(await app.run(`ledgerRead('${ENC}')`), 'cipher');
    await app.run(`ledgerRemove('${KEY}')`);
    assert.equal(await app.run(`ledgerRead('${KEY}')`), null);
    assert.equal(await app.run(`ledgerRead('${ENC}')`), 'cipher');
  });
});

describe('moving an existing ledger out of localStorage', () => {
  test('copied to IndexedDB, read back, and only then removed from localStorage', async () => {
    const phone = newPhone(); phone.ls.set(KEY, '{"sale":[1,2,3]}'); phone.ls.set('khata-pin-hash', 'keep');
    const app = load(phone);
    assert.equal(await app.run(`ledgerRead('${KEY}')`), '{"sale":[1,2,3]}');
    assert.equal(phone.idb.get(KEY), '{"sale":[1,2,3]}');
    assert.equal(phone.ls.has(KEY), false, 'the 5 MB is free again');
    assert.equal(phone.ls.get('khata-pin-hash'), 'keep', 'small settings are untouched');
    assert.equal(phone.ls.get(FLAG), '1');
    assert.equal(await app.run('LEDGER_BACKEND'), 'idb');
  });
  test('if IndexedDB cannot be written, the localStorage copy stays and is used', async () => {
    const phone = newPhone(); phone.ls.set(KEY, 'OLD'); phone.flags.failPut = true;
    const app = load(phone);
    assert.equal(await app.run(`ledgerRead('${KEY}')`), 'OLD');
    assert.equal(phone.ls.get(KEY), 'OLD');
    assert.equal(phone.idb.has(KEY), false);
    assert.equal(phone.ls.has(FLAG), false, 'IndexedDB is not marked as in use');
    // next start, IndexedDB works: it migrates then
    phone.flags.failPut = false;
    assert.equal(await load(phone).run(`ledgerRead('${KEY}')`), 'OLD');
    assert.equal(phone.idb.get(KEY), 'OLD'); assert.equal(phone.ls.has(KEY), false);
  });
  test('if the copy does not read back identically, the localStorage copy is not removed', async () => {
    const phone = newPhone(); phone.ls.set(KEY, 'OLD'); phone.flags.corruptVerify = true;
    const app = load(phone);
    assert.equal(await app.run(`ledgerRead('${KEY}')`), 'OLD');
    assert.equal(phone.ls.get(KEY), 'OLD');
  });
  test('a leftover old localStorage copy never beats the IndexedDB one', async () => {
    const phone = newPhone(); phone.idb.set(KEY, 'NEW'); phone.ls.set(KEY, 'OLD');
    assert.equal(await load(phone).run(`ledgerRead('${KEY}')`), 'NEW');
    assert.equal(phone.ls.has(KEY), false);
  });
});

describe('when IndexedDB fails while saving', () => {
  test('the data goes to localStorage, marked newest; the next read uses it and moves it to IndexedDB', async () => {
    const phone = newPhone(), app = load(phone);
    await app.run(`ledgerWrite('${KEY}', 'v1')`);
    phone.flags.failPut = true;
    await app.run(`ledgerWrite('${KEY}', 'v2')`);            // does not throw: it is safe in localStorage
    assert.equal(phone.ls.get(KEY), 'v2'); assert.equal(phone.ls.get(STALE + KEY), '1');
    assert.equal(phone.idb.get(KEY), 'v1', 'IndexedDB still has the older copy');
    // IndexedDB still broken: reading gives the newest copy, from localStorage
    assert.equal(await load(phone).run(`ledgerRead('${KEY}')`), 'v2');
    // IndexedDB healthy again
    phone.flags.failPut = false;
    assert.equal(await load(phone).run(`ledgerRead('${KEY}')`), 'v2', 'never the stale v1');
    assert.equal(phone.idb.get(KEY), 'v2'); assert.equal(phone.ls.has(KEY), false); assert.equal(phone.ls.has(STALE + KEY), false);
  });
  test('a later good save clears the mark and the localStorage copy', async () => {
    const phone = newPhone(), app = load(phone);
    phone.flags.failPut = true; await app.run(`ledgerWrite('${KEY}', 'v1')`);
    phone.flags.failPut = false; await app.run(`ledgerWrite('${KEY}', 'v2')`);
    assert.equal(phone.idb.get(KEY), 'v2'); assert.equal(phone.ls.has(KEY), false); assert.equal(phone.ls.has(STALE + KEY), false);
  });
  test('if localStorage is full as well, the save throws so the person is told', async () => {
    const phone = newPhone({ quota: 10 }), app = load(phone);
    phone.flags.failPut = true;
    assert.ok(await err(app.run(`ledgerWrite('${KEY}', 'x'.repeat(100))`)));
  });
});

describe('never replacing a real ledger with a blank one', () => {
  test('IndexedDB was in use but cannot be read and there is no other copy: unreadable, and saving is blocked', async () => {
    const phone = newPhone(); phone.idb.set(KEY, 'REAL'); phone.ls.set(FLAG, '1');
    phone.flags.failOpen = true;
    const app = load(phone);
    assert.equal(await err(app.run(`ledgerRead('${KEY}')`)), 'unreadable');
    assert.equal(await err(app.run(`ledgerWrite('${KEY}', 'BLANK')`)), 'unreadable');
    assert.equal(phone.idb.get(KEY), 'REAL');
    assert.equal(phone.ls.has(KEY), false, 'nothing was written anywhere');
  });
  test('a failed read of an in-use IndexedDB is also unreadable', async () => {
    const phone = newPhone(); phone.idb.set(KEY, 'REAL'); phone.ls.set(FLAG, '1'); phone.flags.failGet = true;
    assert.equal(await err(load(phone).run(`ledgerRead('${KEY}')`)), 'unreadable');
  });
  test('a brand-new phone whose IndexedDB is broken just starts fresh on localStorage', async () => {
    const phone = newPhone(); phone.flags.failOpen = true; const app = load(phone);
    assert.equal(await app.run(`ledgerRead('${KEY}')`), null);
    await app.run(`ledgerWrite('${KEY}', 'v1')`);
    assert.equal(phone.ls.get(KEY), 'v1');
    assert.equal(await load(phone).run(`ledgerRead('${KEY}')`), 'v1');
  });
});

describe('a browser with no IndexedDB at all', () => {
  test('works exactly as before: localStorage only, no marks left behind', async () => {
    const phone = newPhone({ noIdb: true }), app = load(phone);
    assert.equal(await app.run(`ledgerRead('${KEY}')`), null);
    await app.run(`ledgerWrite('${KEY}', 'v1')`);
    assert.equal(phone.ls.get(KEY), 'v1');
    assert.equal(phone.ls.has(FLAG), false); assert.equal(phone.ls.has(STALE + KEY), false);
    assert.equal(await app.run(`ledgerRead('${KEY}')`), 'v1');
    assert.equal(await app.run('LEDGER_BACKEND'), 'local');
  });
});

describe('room to grow', () => {
  test('a ledger far bigger than localStorage allows saves and loads', async () => {
    const phone = newPhone({ quota: 5000000 }), app = load(phone);
    const big = JSON.stringify({ sale: 'x'.repeat(8000000) });
    await app.run(`ledgerWrite('${KEY}', ${JSON.stringify(big)})`);
    assert.equal(phone.idb.get(KEY).length, big.length);
    assert.equal((await load(phone).run(`ledgerRead('${KEY}')`)).length, big.length);
    assert.equal(await app.run('LEDGER_CHARS'), big.length);
  });
  test('removing a key clears every copy of it', async () => {
    const phone = newPhone(), app = load(phone);
    await app.run(`ledgerWrite('${KEY}', 'v1')`); phone.ls.set(KEY, 'old'); phone.ls.set(STALE + KEY, '1');
    await app.run(`ledgerRemove('${KEY}')`);
    assert.equal(phone.idb.has(KEY), false); assert.equal(phone.ls.has(KEY), false); assert.equal(phone.ls.has(STALE + KEY), false);
  });
});

describe('the rest of the app goes through the store', () => {
  test('no code reads or writes the ledger keys in localStorage directly any more', () => {
    ['js/core.js', 'js/encryption.js', 'js/shell.js', 'js/lock-init.js', 'js/cloud-sync.js', 'js/autobackup.js'].forEach(f => {
      assert.ok(!/localStorage\.(get|set|remove)Item\(\s*(STORAGE_KEY|ENC_DATA_KEY)/.test(read(f)), f + ' touches a ledger key directly');
    });
  });
  test('load() and save() use the store, an unreadable ledger blocks saving, and the plain copy is purged from IndexedDB too', () => {
    const core = read('js/core.js'), enc = read('js/encryption.js');
    assert.match(core, /await ledgerRead\(STORAGE_KEY\)/); assert.match(core, /await ledgerRead\(ENC_DATA_KEY\)/);
    assert.match(core, /await ledgerToStorage\(json\)/); assert.match(core, /showLedgerUnreadable\(\); return;/);
    assert.match(enc, /await ledgerWrite\(ENC_DATA_KEY, await encSeal\(json\)\)/);
    assert.match(enc, /await ledgerRemove\(STORAGE_KEY\)/);
    assert.match(read('js/lock-init.js'), /await purgePlaintextLedgerAndHashes\(\)/);
  });
  test('while the ledger is unreadable, cloud sync and safety copies do nothing with the blank screen', () => {
    assert.match(read('js/cloud-sync.js'), /async function cloudPushNow\(force\)\{[\s\S]{0,260}LEDGER_LOAD_FAILED\) return;/);
    assert.match(read('js/shell.js'), /async function snapAdd\(reason, json\)\{\s*if\(typeof LEDGER_LOAD_FAILED[^\n]*return;/);
  });
  test('the size line in Settings follows where the ledger is kept', () => {
    const shell = read('js/shell.js');
    assert.match(shell, /LEDGER_BACKEND === 'idb'/); assert.match(shell, /plenty of room/);
  });
});
