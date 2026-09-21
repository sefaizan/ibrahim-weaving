'use strict';
/*
 * Encryption of the stored ledger (js/encryption.js): the parts that must never silently break —
 * the data key can only be opened with the right PIN / recovery answer, the ledger round-trips
 * (compressed or not), tampering is detected, and saving refuses to run while locked instead of
 * ever writing plain data next to an encrypted ledger. Runs the real file in a sandbox with a
 * fake localStorage; the page-only parts (Settings card buttons) are covered by hand on a phone.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(){
  const store = new Map();
  const localStorage = {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
  };
  Object.defineProperty(localStorage, 'length', { get: () => store.size });
  const ctx = vm.createContext({
    localStorage, crypto: globalThis.crypto, TextEncoder, TextDecoder, Uint8Array, Blob, Response,
    CompressionStream, DecompressionStream, btoa, atob, console, Object,
    STORAGE_KEY: 'khata-data-v3',
    // helpers that shell.js / lock-init.js provide to the page
    b64FromBytes: (bytes) => Buffer.from(bytes).toString('base64'),
    bytesFromB64: (b64) => new Uint8Array(Buffer.from(b64, 'base64')),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'encryption.js'), 'utf8'), ctx, { filename: 'js/encryption.js' });
  // vm keeps top-level let/const private to the context, so expose what the tests need
  // results are copied into this realm's plain objects so assert.deepEqual can compare them
  const run = async (code) => { const r = await vm.runInContext(code, ctx); return r === undefined ? r : JSON.parse(JSON.stringify(r)); };
  return { ctx, store, run };
}

describe('data key locking', () => {
  test('the right PIN opens the key, a wrong PIN does not', async () => {
    const { run } = load();
    const ok = await run(`(async()=>{
      const dek = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
      const w = await encWrap(dek, '482913', 1000);
      const good = await encUnwrap(w, '482913', 1000).then(()=>true, ()=>false);
      const bad = await encUnwrap(w, '482914', 1000).then(()=>true, ()=>false);
      return [good, bad];
    })()`);
    assert.deepEqual(ok, [true, false]);
  });
  test('the PIN never appears in what gets stored', async () => {
    const { run } = load();
    const text = await run(`(async()=>{
      const dek = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
      return JSON.stringify(await encWrap(dek, '482913', 1000));
    })()`);
    assert.ok(!text.includes('482913'));
  });
});

describe('ledger round trip', () => {
  test('encrypts and decrypts the same text (compressed when that helps)', async () => {
    const { run } = load();
    const r = await run(`(async()=>{
      const key = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
      const big = JSON.stringify({sale: Array.from({length: 300}, (_, i) => ({id: 's'+i, client: 'Ali Textiles', amount: 1000 + i}))});
      const blob = await encSealWith(key, big);
      return { same: (await encOpenWith(key, blob)) === big, smaller: blob.length < big.length, prefixed: blob.startsWith('KHENC1:'), plainVisible: blob.includes('Ali Textiles') };
    })()`);
    assert.deepEqual(r, { same: true, smaller: true, prefixed: true, plainVisible: false });
  });
  test('short and non-ASCII text survive too', async () => {
    const { run } = load();
    const r = await run(`(async()=>{
      const key = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
      const out = [];
      for (const t of ['{}', 'ابراہیم ویونگ — Rs 5,000', '']) out.push((await encOpenWith(key, await encSealWith(key, t))) === t);
      return out;
    })()`);
    assert.deepEqual(r, [true, true, true]);
  });
  test('a different key, or a damaged blob, is rejected', async () => {
    const { run } = load();
    const r = await run(`(async()=>{
      const mk = () => crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
      const k1 = await mk(), k2 = await mk();
      const blob = await encSealWith(k1, JSON.stringify({a: 1}));
      const wrongKey = await encOpenWith(k2, blob).then(()=>'opened', ()=>'rejected');
      const chars = blob.split(''); const i = blob.length - 6; chars[i] = chars[i] === 'A' ? 'B' : 'A';
      const tampered = await encOpenWith(k1, chars.join('')).then(()=>'opened', ()=>'rejected');
      return [wrongKey, tampered];
    })()`);
    assert.deepEqual(r, ['rejected', 'rejected']);
  });
  test('two seals of the same text differ (fresh IV each time)', async () => {
    const { run } = load();
    const r = await run(`(async()=>{
      const key = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
      return (await encSealWith(key, 'same')) !== (await encSealWith(key, 'same'));
    })()`);
    assert.equal(r, true);
  });
});

describe('storage rules', () => {
  test('encryption off: the ledger is written plain under the normal key', async () => {
    const { run, store } = load();
    await run(`ledgerToLocalStorage('{"x":1}')`);
    assert.equal(store.get('khata-data-v3'), '{"x":1}');
  });
  test('encryption on but locked: saving refuses and writes nothing', async () => {
    const { run, store } = load();
    store.set('khata-enc-meta', '{"v":1}');
    const msg = await run(`ledgerToLocalStorage('{"x":1}').then(()=>'wrote', e=>e.message)`);
    assert.equal(msg, 'locked');
    assert.equal(store.has('khata-data-v3'), false);
    assert.equal(store.has('khata-data-v3-enc'), false);
  });
  test('encryption on and unlocked: only ciphertext is stored, and it reads back', async () => {
    const { run, store } = load();
    store.set('khata-enc-meta', '{"v":1}');
    const back = await run(`(async()=>{
      ENC_DEK = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
      await ledgerToLocalStorage(JSON.stringify({client: 'Secret Client'}));
      return encOpen(localStorage.getItem(ENC_DATA_KEY));
    })()`);
    assert.equal(back, '{"client":"Secret Client"}');
    assert.equal(store.has('khata-data-v3'), false);
    assert.ok(!store.get('khata-data-v3-enc').includes('Secret Client'));
  });
  test('if the stored copy could not be read, saving stays blocked', async () => {
    const { run, store } = load();
    store.set('khata-enc-meta', '{"v":1}');
    const msg = await run(`(async()=>{
      ENC_DEK = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
      ENC_LOAD_FAILED = true;
      return ledgerToLocalStorage('{}').then(()=>'wrote', e=>e.message);
    })()`);
    assert.equal(msg, 'locked');
  });
});
