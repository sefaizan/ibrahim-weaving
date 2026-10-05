/* Ledger storage. Loaded right after calc.js (before core.js), needs nothing from the other files.
 *
 * WHY: the ledger used to live in localStorage, which gives one app only about 5 million characters.
 * It now lives in IndexedDB (room for hundreds of MB). Only the big ledger text goes here — the small
 * settings (PIN, encryption key wraps, sync flags ...) stay in localStorage exactly as before.
 *
 * WHAT USES IT: core.js (save / load) and encryption.js (turning encryption on/off, joining a synced key,
 * saving the encrypted copy) call ledgerRead / ledgerWrite / ledgerRemove with the same two keys as
 * always: STORAGE_KEY (plain ledger) and ENC_DATA_KEY (encrypted ledger). Safety copies (shell.js) have
 * their own IndexedDB store and are untouched.
 *
 * SAFETY RULES — the ledger must never be lost or silently replaced by a blank one:
 *  1. MIGRATION: the first time a phone that still has the ledger in localStorage reads it, the text is
 *     copied into IndexedDB and READ BACK; only when the copy is identical is the localStorage copy removed.
 *     If anything fails the localStorage copy stays and the app keeps working from it; next start tries again.
 *  2. SAVING: a save is finished only when the IndexedDB transaction has committed. If IndexedDB fails, the
 *     text is written to localStorage instead and marked "newest" (khata-idb-stale-<key>), so the next read
 *     takes that copy and moves it into IndexedDB as soon as IndexedDB works again.
 *  3. NEVER BLANK: once IndexedDB has been used on this phone (khata-idb-in-use), if it cannot be read and
 *     there is no localStorage copy, ledgerRead throws 'unreadable' instead of returning nothing, so core.js
 *     does not start from an empty ledger and saving is blocked (the next save would overwrite the real one).
 *  4. A phone where IndexedDB does not exist at all (some private modes) simply keeps using localStorage.
 */

const LEDGER_IDB_NAME = 'khata-ledger';
const LEDGER_IDB_STORE = 'kv';
const LEDGER_IDB_FLAG = 'khata-idb-in-use';          // set once the ledger has really been stored in IndexedDB
const LEDGER_STALE_PREFIX = 'khata-idb-stale-';      // + key: the newest copy of that key is in localStorage
const LEDGER_IDB_OPEN_TIMEOUT_MS = 10000;
let LEDGER_DB_PROMISE = null;
let LEDGER_CHARS = 0;            // size, in characters, of the ledger text as last read or written (Settings shows it)
let LEDGER_BACKEND = 'unknown';  // 'idb' | 'local' — where the ledger last really went / came from
let LEDGER_LOAD_FAILED = false;  // set when the ledger exists in IndexedDB but could not be read: saving stays blocked

function ledgerLsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function ledgerLsRemove(k){ try{ localStorage.removeItem(k); }catch(e){ /* best effort */ } }
function ledgerLsSetQuiet(k, v){ try{ localStorage.setItem(k, v); return true; }catch(e){ return false; } }
function ledgerIdbExists(){ return typeof indexedDB !== 'undefined' && !!indexedDB; }

function ledgerIdbOpen(){
  if(LEDGER_DB_PROMISE) return LEDGER_DB_PROMISE;
  LEDGER_DB_PROMISE = new Promise((resolve, reject)=>{
    if(!ledgerIdbExists()){ reject(new Error('IndexedDB unavailable')); return; }
    let done = false, rq;
    // Some phones never answer the very first open after a restart; a timeout turns that into a normal failure.
    const timer = setTimeout(()=>{ if(!done){ done = true; reject(new Error('IndexedDB open timed out')); } }, LEDGER_IDB_OPEN_TIMEOUT_MS);
    try{ rq = indexedDB.open(LEDGER_IDB_NAME, 1); }
    catch(e){ clearTimeout(timer); done = true; reject(e); return; }
    rq.onupgradeneeded = ()=>{ try{ rq.result.createObjectStore(LEDGER_IDB_STORE); }catch(e){ /* store already there */ } };
    rq.onsuccess = ()=>{
      clearTimeout(timer);
      const db = rq.result;
      if(done){ try{ db.close(); }catch(e){} return; }
      done = true;
      // If the browser closes or upgrades the database under us, forget the connection so the next call reopens it.
      db.onclose = db.onversionchange = ()=>{ LEDGER_DB_PROMISE = null; try{ db.close(); }catch(e){} };
      resolve(db);
    };
    rq.onerror = ()=>{ clearTimeout(timer); if(done) return; done = true; reject(rq.error || new Error('IndexedDB open failed')); };
  });
  LEDGER_DB_PROMISE.catch(()=>{ LEDGER_DB_PROMISE = null; });
  return LEDGER_DB_PROMISE;
}
// fn(store) returns an IDBRequest; resolves with its result once the whole transaction has committed.
async function ledgerIdbTx(mode, fn){
  const db = await ledgerIdbOpen();
  return new Promise((resolve, reject)=>{
    let tx, req;
    try{
      tx = mode === 'readwrite' ? db.transaction(LEDGER_IDB_STORE, mode, {durability: 'strict'}) : db.transaction(LEDGER_IDB_STORE, mode);
      req = fn(tx.objectStore(LEDGER_IDB_STORE));
    }catch(e){ LEDGER_DB_PROMISE = null; reject(e); return; }
    tx.oncomplete = ()=> resolve(req ? req.result : undefined);
    tx.onerror = tx.onabort = ()=> reject(tx.error || new Error('IndexedDB transaction failed'));
  });
}

// Copies `value` into IndexedDB, reads it back, and only if it matches drops the localStorage copy
// (and the "newest is in localStorage" mark). Returns true on success; never throws.
async function ledgerMoveToIdb(key, value){
  try{
    await ledgerIdbTx('readwrite', s => s.put(value, key));
    const back = await ledgerIdbTx('readonly', s => s.get(key));
    if(back !== value) return false;
    ledgerLsSetQuiet(LEDGER_IDB_FLAG, '1');
    ledgerLsRemove(key);
    ledgerLsRemove(LEDGER_STALE_PREFIX + key);
    LEDGER_BACKEND = 'idb';
    return true;
  }catch(e){ return false; }
}

// The stored text for a key, or null when there is none. Throws Error('unreadable') in the one case where
// carrying on with "nothing" would be dangerous (see rule 3 above).
async function ledgerRead(key){
  const local = ledgerLsGet(key);
  const stale = ledgerLsGet(LEDGER_STALE_PREFIX + key) === '1';
  let idbVal = null, idbOk = true;
  try{ idbVal = await ledgerIdbTx('readonly', s => s.get(key)); }
  catch(e){ idbOk = false; }
  let out;
  if(stale && local !== null){
    // An earlier IndexedDB save failed, so localStorage holds the newest copy: use it, and try to move it across.
    if(idbOk) await ledgerMoveToIdb(key, local);
    else LEDGER_BACKEND = 'local';
    out = local;
  }else if(idbOk){
    LEDGER_BACKEND = 'idb';
    if(typeof idbVal === 'string'){
      ledgerLsRemove(key); // a leftover pre-migration copy would only waste the 5 MB
      out = idbVal;
    }else if(local !== null){
      await ledgerMoveToIdb(key, local); // first start after the update: migrate (rule 1)
      out = local;
    }else out = null;
  }else{
    LEDGER_BACKEND = 'local';
    if(local !== null) out = local;
    else if(ledgerLsGet(LEDGER_IDB_FLAG) === '1'){ LEDGER_LOAD_FAILED = true; throw new Error('unreadable'); }
    else out = null; // a brand-new phone whose IndexedDB is unusable: start fresh on localStorage
  }
  if(typeof out === 'string') LEDGER_CHARS = out.length;
  return out;
}

// Stores `value` under `key`. Resolves once it is safely stored; throws if it could not be stored anywhere
// (the caller then shows "Your last change was NOT saved").
async function ledgerWrite(key, value){
  if(LEDGER_LOAD_FAILED) throw new Error('unreadable');
  try{
    await ledgerIdbTx('readwrite', s => s.put(value, key));
  }catch(idbErr){
    // IndexedDB failed this time: keep the data safe in localStorage (this throws if that is full too).
    LEDGER_BACKEND = 'local';
    if(ledgerIdbExists() && !ledgerLsSetQuiet(LEDGER_STALE_PREFIX + key, '1')) throw idbErr;
    localStorage.setItem(key, value);
    LEDGER_CHARS = value.length;
    return;
  }
  LEDGER_BACKEND = 'idb';
  LEDGER_CHARS = value.length;
  ledgerLsSetQuiet(LEDGER_IDB_FLAG, '1');
  ledgerLsRemove(key);                       // IndexedDB now holds the newest copy
  ledgerLsRemove(LEDGER_STALE_PREFIX + key);
}

// Deletes a key from IndexedDB and from localStorage (best effort on both).
async function ledgerRemove(key){
  try{ await ledgerIdbTx('readwrite', s => s.delete(key)); }catch(e){ /* IndexedDB unavailable or nothing to delete */ }
  ledgerLsRemove(key);
  ledgerLsRemove(LEDGER_STALE_PREFIX + key);
}
