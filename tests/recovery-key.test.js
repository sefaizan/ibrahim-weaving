'use strict';
/*
 * Recovery key (js/encryption.js): a random code shown once that opens the ledger if the PIN and
 * recovery answer are forgotten. Checks the code's format, that only the right code opens the data
 * key (any spacing / case), that creating a new one replaces the old, and that it refuses while
 * locked or with a wrong PIN. Real file, sandbox with a fake localStorage.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(){
  const store = new Map();
  const localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); } };
  const ctx = vm.createContext({
    localStorage, crypto: globalThis.crypto, TextEncoder, TextDecoder, Uint8Array, Blob, Response,
    CompressionStream, DecompressionStream, btoa, atob, console, Object, JSON,
    b64FromBytes: b => Buffer.from(b).toString('base64'),
    bytesFromB64: s => new Uint8Array(Buffer.from(s, 'base64')),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'encryption.js'), 'utf8'), ctx, { filename: 'js/encryption.js' });
  vm.runInContext(`var checkPin = async p => p === '482913';`, ctx);
  const run = async code => { const r = await vm.runInContext(code, ctx); return r === undefined ? r : JSON.parse(JSON.stringify(r)); };
  // An encrypted setup with a fast iteration count, unlocked.
  const setup = () => run(`(async()=>{
    const dek = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
    localStorage.setItem(ENC_META_KEY, JSON.stringify({v:1, iter:1000, pin: await encWrap(dek, '482913', 1000)}));
    ENC_DEK = dek; return true; })()`);
  return { run, setup, store };
}

describe('recovery key format', () => {
  test('20 characters in five groups of four, no look-alike characters, different each time', async () => {
    const { run } = load();
    const keys = await run(`Array.from({length: 50}, () => newRecoveryKey())`);
    keys.forEach(k => assert.match(k, /^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){4}$/));
    assert.equal(new Set(keys).size, 50);
  });
  test('spaces, dashes and lower case do not matter', async () => {
    const { run } = load();
    assert.equal(await run(`normalizeRecoveryKey(' k7qm 2xnr-4tda 9whc-b3pf ')`), 'K7QM2XNR4TDA9WHCB3PF');
  });
});

describe('unlocking with the recovery key', () => {
  test('the right key opens the data key (any layout); a wrong or missing key does not', async () => {
    const { run, setup } = load();
    await setup();
    const key = await run(`newRecoveryKey()`);
    assert.equal(await run(`setRecoveryKey('482913', ${JSON.stringify(key)})`), '');
    assert.equal(await run(`hasRecoveryKey()`), true);
    await run(`ENC_DEK = null`);
    assert.equal(await run(`checkRecoveryKey('AAAA-AAAA-AAAA-AAAA-AAAA')`), false);
    assert.equal(await run(`ENC_DEK === null`), true);
    assert.equal(await run(`checkRecoveryKey('')`), false);
    assert.equal(await run(`checkRecoveryKey(${JSON.stringify(key.toLowerCase().replace(/-/g, ' '))})`), true);
    assert.equal(await run(`ENC_DEK !== null`), true);
  });
  test('no key created yet: nothing opens', async () => {
    const { run, setup } = load();
    await setup();
    assert.equal(await run(`hasRecoveryKey()`), false);
    assert.equal(await run(`checkRecoveryKey('K7QM-2XNR-4TDA-9WHC-B3PF')`), false);
  });
  test('the key itself is never stored', async () => {
    const { run, setup, store } = load();
    await setup();
    const key = await run(`newRecoveryKey()`);
    await run(`setRecoveryKey('482913', ${JSON.stringify(key)})`);
    const all = [...store.values()].join('|');
    assert.ok(!all.includes(key) && !all.includes(key.replace(/-/g, '')));
  });
});

describe('creating and replacing', () => {
  test('a new key replaces the old one', async () => {
    const { run, setup } = load();
    await setup();
    await run(`setRecoveryKey('482913', 'AAAA-BBBB-CCCC-DDDD-EEEE')`);
    await run(`setRecoveryKey('482913', 'FFFF-GGGG-HHHH-JJJJ-KKKK')`);
    assert.equal(await run(`checkRecoveryKey('AAAA-BBBB-CCCC-DDDD-EEEE')`), false);
    assert.equal(await run(`checkRecoveryKey('FFFF-GGGG-HHHH-JJJJ-KKKK')`), true);
  });
  test('wrong PIN or locked app: refused, nothing changed', async () => {
    const { run, setup } = load();
    await setup();
    assert.match(await run(`setRecoveryKey('000000', 'AAAA-BBBB-CCCC-DDDD-EEEE')`), /PIN is incorrect/);
    assert.equal(await run(`hasRecoveryKey()`), false);
    await run(`ENC_DEK = null`);
    assert.match(await run(`setRecoveryKey('482913', 'AAAA-BBBB-CCCC-DDDD-EEEE')`), /Unlock the app first/);
    assert.equal(await run(`hasRecoveryKey()`), false);
  });
  test('changing the PIN keeps the recovery key working', async () => {
    const { run, setup } = load();
    await setup();
    await run(`setRecoveryKey('482913', 'AAAA-BBBB-CCCC-DDDD-EEEE')`);
    await run(`(async()=>{ const m = encMeta(); m.pin = await encWrap(ENC_DEK, '111111', m.iter); localStorage.setItem(ENC_META_KEY, JSON.stringify(m)); })()`);
    await run(`ENC_DEK = null`);
    assert.equal(await run(`checkRecoveryKey('AAAA-BBBB-CCCC-DDDD-EEEE')`), true);
  });
});
