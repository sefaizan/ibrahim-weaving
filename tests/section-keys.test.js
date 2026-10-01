'use strict';
/*
 * Section keys (js/section-keys.js, with the hooks in js/cloud-sync.js and js/encryption.js): with
 * encryption on, a section a person may not view is not only refused by Firebase's rules, it is also
 * unreadable to them - they never receive its key. Real encryption (Node's WebCrypto) runs in several
 * sandboxed phones that share one fake cloud (a Map of documents), so a person's phone can be handed
 * EVERY section document (as if the rules had failed) and the test checks which of them it can open.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');

const OWNER = 'se.muhammadfaizan@gmail.com';
const VIEWER = 'viewer@example.com', VIEWER2 = 'viewer2@example.com', OPERATOR = 'operator@example.com';
const DAY = 86400000, NOW = Date.now();
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const j = v => v === undefined ? v : JSON.parse(JSON.stringify(v));
const ALL = ['production', 'reference', 'sales', 'recovery', 'expenses', 'wages', 'loans', 'family', 'materials', 'business', 'tools'];
const VIEWER_SECS = ['production', 'reference', 'sales', 'recovery', 'business'];
const OPERATOR_SECS = ['production', 'reference', 'business'];
const HIDDEN_FROM_VIEWER = ALL.filter(s => VIEWER_SECS.indexOf(s) < 0);

let cloud, writes, failLedgerWrites;
beforeEach(() => { cloud = new Map(); writes = []; failLedgerWrites = false; });

// One phone: its own storage and its own copy of the app files, talking to the shared `cloud`.
async function phone(email, o){
  o = o || {};
  const store = new Map(), page = {};
  const db = { collection: c => ({ doc: d => { const k = c + '/' + d; return {
    async get(){ return { exists: cloud.has(k), data: () => cloud.has(k) ? JSON.parse(JSON.stringify(cloud.get(k))) : undefined }; },
    async set(v){ if(failLedgerWrites && k.startsWith('ledger/')) throw new Error('no signal'); cloud.set(k, JSON.parse(JSON.stringify(v))); writes.push({ by: email, path: k }); },
    async delete(){ cloud.delete(k); writes.push({ by: email, path: k, deleted: true }); } }; } }) };
  const ctx = vm.createContext({
    console: { log(){}, error(){} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp,
    crypto: globalThis.crypto, TextEncoder, TextDecoder, Uint8Array, Blob, Response, CompressionStream, DecompressionStream, btoa, atob,
    setTimeout: () => 1, clearTimeout(){}, setInterval(){}, navigator: { onLine: true, clipboard: { writeText: async () => {} } },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { getElementById: id => page[id] || null, createElement: () => ({ style: {}, setAttribute(){}, appendChild(){}, remove(){} }), body: { appendChild(){} }, addEventListener(){} },
    escHtml: x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    switchTab(){}, showToast(){}, STORAGE_KEY: 'khata-data-v3', PIN_HASH_KEY: 'x1', PIN_SALT_KEY: 'x2', PIN_ANS_HASH_KEY: 'x3', PIN_ANS_SALT_KEY: 'x4',
    b64FromBytes: b => Buffer.from(b).toString('base64'), bytesFromB64: s => new Uint8Array(Buffer.from(s, 'base64')),
    sha256Hex: async s => nodeCrypto.createHash('sha256').update(s).digest('hex'),
    checkPin: async p => p === (o.pin || '1111'), checkRecoveryAnswer: async a => a === 'ans', normalizeAnswer: a => String(a).trim().toLowerCase(),
    snapList: async () => [], snapAdd: async () => {}, snapTx: async () => {}, save: async () => {}, __db: db,
  });
  vm.runInContext('var DATA = {}; var CURRENT_TAB = "overview";', ctx);
  ['js/encryption.js', 'js/cloud-sync.js', 'js/section-keys.js'].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
  vm.runInContext('cloudSdkReady = async () => __db; SK_ITER = 1000;', ctx);
  if(email) store.set('khata-cloud-user', JSON.stringify({ email, verified: true }));
  store.set('khata-cloud-sync-on', '1');
  const run = code => vm.runInContext(code, ctx);
  const p = { email, store, page, ctx, db, run, get: async code => j(await run(code)) };
  if(o.encrypt !== false){
    await run(`(async()=>{ const dek = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
      const meta = {v:1, iter:1000, pin: await encWrap(dek, '${o.pin || '1111'}', 1000), rec: await encWrap(dek, 'ans', 1000)};
      localStorage.setItem(ENC_META_KEY, JSON.stringify(meta)); ENC_DEK = dek; ENC_PENDING_LOAD = false; })()`);
  }
  return p;
}
const ledger = () => ({
  production: [{ id: 'pr1', meters: 120 }], loomAssignments: [], warpBeams: [], qualities: [{ id: 'q1', name: 'Poplin' }], looms: [], employees: [{ id: 'e1', name: 'Ali' }],
  sale: [{ id: 's1', total: 5000 }], clients: [], recovery: [{ id: 'r1', amount: 100 }], banks: [], expense: [{ id: 'x1', amount: 77 }],
  wageRateHistory: [{ id: 'w1', rate: 9 }], wagePayments: [{ id: 'w2', amount: 300 }], loanPayments: [{ id: 'l1', amount: 50 }],
  family: [{ id: 'f1', amount: 999 }], warp: [{ id: 'wp1' }], businessInfo: { name: 'Ibrahim Weaving' }, openingBalance: 1,
});
// The owner's phone, with encryption on, the whole ledger, and everything already sent to the cloud.
async function ownerWorld(){
  const owner = await phone(OWNER);
  owner.run(`DATA = ${JSON.stringify(ledger())};`);
  await owner.run('cloudPushNow(true)');
  return owner;
}
const approve = (owner, email, role, extra) => owner.run(`cloudAccessEdit(rec => cloudAccessApplyApprove(rec, '${email}', ${NOW + 30 * DAY}, ${NOW}, ${extra && extra.write ? 'true' : 'undefined'}, '${role}'))`);
const codeFor = (owner, email) => owner.get(`(async()=>{ const rec = await cloudAccessRead(); return skAccessCode(await skRingLoad(), '${email}', skCodeVer(rec.approved['${email}'])); })()`);
const secDoc = sec => j(cloud.get('ledger/' + sec));
// Can this phone open this section document as it stands in the cloud?
const opens = async (p, sec) => { const r = await p.get(`cloudDecryptRemote(${JSON.stringify(secDoc(sec))})`); return r.json !== undefined ? r.json : r.error; };

describe('the owner\'s phone: a key for every section, backed up before use', () => {
  test('each section gets its own random key; the keyring is stored sealed, not readable', async () => {
    const owner = await ownerWorld();
    const ring = await owner.get('skRingLoad()');
    assert.deepEqual(Object.keys(ring.s).sort(), ALL.slice().sort());
    const keys = Object.values(ring.s).map(e => e.k);
    assert.equal(new Set(keys).size, ALL.length, 'no two sections share a key');
    keys.forEach(k => assert.equal(Buffer.from(k, 'base64').length, 32));
    const stored = owner.store.get('khata-sec-keyring');
    assert.ok(stored.startsWith('KHENC1:'), 'sealed with the phone\'s own key');
    keys.concat([ring.m]).forEach(k => assert.ok(!stored.includes(k) && !JSON.stringify([...owner.store]).includes(k) || [...owner.store.values()].filter(v => v.includes(k)).length === 0));
  });
  test('the vault is in the cloud (owner\'s address) and opens only with the phone\'s data key', async () => {
    const owner = await ownerWorld();
    const v = cloud.get('keys/' + OWNER);
    assert.ok(v.keyWrap && v.vault && v.iter, 'PIN-locked key + sealed keyring');
    const ring = await owner.get('skRingLoad()');
    const opened = JSON.parse(await owner.run(`encOpen(${JSON.stringify(v.vault)})`));
    assert.deepEqual(opened.s, ring.s); assert.equal(opened.m, ring.m);
    const stranger = await phone(VIEWER);
    await assert.rejects(stranger.run(`encOpen(${JSON.stringify(v.vault)})`), 'another phone\'s key cannot open it');
  });
  test('the vault is written BEFORE any section is sealed', async () => {
    await ownerWorld();
    const firstVault = writes.findIndex(w => w.path === 'keys/' + OWNER), firstSection = writes.findIndex(w => w.path.startsWith('ledger/') && w.path !== 'ledger/manifest');
    assert.ok(firstVault >= 0 && firstSection >= 0 && firstVault < firstSection);
  });
  test('if the vault cannot be written nothing is sent', async () => {
    const owner = await phone(OWNER);
    owner.run(`DATA = ${JSON.stringify(ledger())}; __db.collection = c => ({ doc: d => ({ async get(){ return { exists: false, data: () => undefined }; }, async set(){ throw new Error('offline?'); } }) });`);
    await owner.run('cloudPushNow(true)');
    assert.equal([...cloud.keys()].filter(k => k.startsWith('ledger/')).length, 0);
  });
  test('it never makes fresh keys next to a vault it cannot open (a different phone made it)', async () => {
    await ownerWorld();
    const other = await phone(OWNER); // its own data key, no ring
    await assert.rejects(other.run('skOwnerPrepare(__db)'), /Join Encrypted Sync/);
    assert.ok(cloud.get('keys/' + OWNER).vault, 'the cloud vault is untouched');
  });
});

describe('what a section document holds', () => {
  test('sealed with that section\'s key and key version; no PIN-locked key travels with it', async () => {
    const owner = await ownerWorld();
    ALL.forEach(sec => { const d = secDoc(sec); assert.equal(d.encrypted, true, sec); assert.equal(d.kv, 1, sec); assert.equal(d.keyWrap, undefined, sec + ' has no keyWrap'); assert.equal(d.iter, undefined, sec); assert.ok(d.payload.startsWith('KHENC1:')); });
    const ring = await owner.get('skRingLoad()');
    const tryKey = (sec, keySec) => owner.run(`(async()=>{ const k = await skImport(${JSON.stringify(ring.s[keySec].k)}); return encOpenWith(k, ${JSON.stringify(secDoc(sec).payload)}); })()`);
    assert.match(await tryKey('wages', 'wages'), /"rate":9/);
    await assert.rejects(tryKey('wages', 'production'), 'the production key does not open wages');
    await assert.rejects(tryKey('family', 'sales'));
  });
  test('plain text never reaches the cloud while encryption is on', async () => {
    await ownerWorld();
    const all = JSON.stringify([...cloud.entries()].filter(([k]) => k.startsWith('ledger/')));
    ['Poplin', 'Ibrahim Weaving', '"amount":999'].forEach(t => assert.ok(!all.includes(t), t));
  });
  test('with encryption off on the owner\'s phone sections go up as plain text, as before', async () => {
    const owner = await phone(OWNER, { encrypt: false });
    owner.run(`DATA = ${JSON.stringify(ledger())};`);
    await owner.run('cloudPushNow(true)');
    const d = secDoc('production'); assert.equal(d.encrypted, false); assert.equal(d.kv, undefined); assert.match(d.payload, /"meters":120/);
    assert.equal(cloud.has('keys/' + OWNER), false);
  });
});

describe('access bundles: only the keys of sections the role may view', () => {
  test('Business viewer\'s bundle: Production, lists, Sales, Cheques, business name - nothing else', async () => {
    const owner = await ownerWorld();
    await approve(owner, VIEWER, 'business_viewer');
    const code = await codeFor(owner, VIEWER), b = cloud.get('keys/' + VIEWER);
    assert.ok(b.bundle && b.salt);
    const opened = JSON.parse(await owner.run(`(async()=>{ const k = await skCodeKey('${code}', bytesFromB64('${b.salt}'), ${b.iter}); return encOpenWith(k, ${JSON.stringify(b.bundle)}); })()`));
    assert.deepEqual(Object.keys(opened.s).sort(), VIEWER_SECS.slice().sort());
    HIDDEN_FROM_VIEWER.forEach(s => assert.equal(opened.s[s], undefined, s));
    assert.equal(JSON.stringify(b).includes(code), false, 'the code is not in the bundle document');
  });
  test('Production operator: Production, Employees / looms / qualities, business name', async () => {
    const owner = await ownerWorld();
    await approve(owner, OPERATOR, 'production_operator', { write: true });
    const code = await codeFor(owner, OPERATOR), b = cloud.get('keys/' + OPERATOR);
    const opened = JSON.parse(await owner.run(`(async()=>{ const k = await skCodeKey('${code}', bytesFromB64('${b.salt}'), ${b.iter}); return encOpenWith(k, ${JSON.stringify(b.bundle)}); })()`));
    assert.deepEqual(Object.keys(opened.s).sort(), OPERATOR_SECS.slice().sort());
    ['sales', 'recovery', 'wages', 'family', 'expenses', 'loans', 'materials'].forEach(s => assert.equal(opened.s[s], undefined, s));
  });
  test('a role with no sections gets no bundle; a custom role gets exactly what was ticked', async () => {
    const owner = await ownerWorld();
    await approve(owner, VIEWER, 'custom');
    assert.equal(cloud.has('keys/' + VIEWER), false);
    await owner.run(`cloudAccessEdit(rec => cloudAccessApplySetPerms(rec, '${VIEWER}', { wages: 'v' }, ${NOW}))`);
    const rec = cloud.get('config/access');
    assert.deepEqual(rec.approved[VIEWER].perms, { wages: 'v' });
    const code = await codeFor(owner, VIEWER), b = cloud.get('keys/' + VIEWER);
    const opened = JSON.parse(await owner.run(`(async()=>{ const k = await skCodeKey('${code}', bytesFromB64('${b.salt}'), ${b.iter}); return encOpenWith(k, ${JSON.stringify(b.bundle)}); })()`));
    assert.deepEqual(Object.keys(opened.s), ['wages']);
  });
});

describe('the access code', () => {
  test('20 letters and numbers from the no-look-alike alphabet; the same every time; different per person and per version', async () => {
    const owner = await ownerWorld();
    await approve(owner, VIEWER, 'business_viewer'); await approve(owner, VIEWER2, 'business_viewer');
    const a = await codeFor(owner, VIEWER), a2 = await codeFor(owner, VIEWER), b = await codeFor(owner, VIEWER2);
    assert.match(a, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{20}$/);
    assert.equal(a, a2); assert.notEqual(a, b);
    assert.match(await owner.run(`skCodeText('${a}')`), /^(\w{4}-){4}\w{4}$/);
    assert.notEqual(await owner.run(`skAccessCode(SK_RING, '${VIEWER}', 2)`), a);
  });
  test('upper or lower case, spaces and dashes when typing all work', async () => {
    const owner = await ownerWorld();
    await approve(owner, VIEWER, 'business_viewer');
    const code = await codeFor(owner, VIEWER), typed = code.toLowerCase().replace(/(.{4})/g, '$1 - ');
    const v = await phone(VIEWER);
    assert.equal(await v.run(`skJoinWithCode(${JSON.stringify(typed)})`), '');
  });
  test('Approve / Extend keep the code version, New code changes it and the old code stops working', async () => {
    const owner = await ownerWorld();
    await approve(owner, VIEWER, 'business_viewer');
    const before = await codeFor(owner, VIEWER);
    await owner.run(`cloudAccessEdit(rec => cloudAccessApplyExtend(rec, '${VIEWER}', ${NOW}, 5))`);
    await approve(owner, VIEWER, 'business_viewer');
    assert.equal(await codeFor(owner, VIEWER), before, 'same code after extending / re-approving');
    await owner.run(`cloudAccessEdit(rec => cloudAccessApplyNewCode(rec, '${VIEWER}', ${NOW}))`);
    assert.equal(cloud.get('config/access').approved[VIEWER].kc, 2);
    const after = await codeFor(owner, VIEWER); assert.notEqual(after, before);
    const v = await phone(VIEWER);
    assert.match(await v.run(`skJoinWithCode('${before}')`), /does not open/);
    assert.equal(await v.run(`skJoinWithCode('${after}')`), '');
    assert.throws(() => owner.run(`cloudAccessApplyNewCode({ approved: {} }, 'gone@example.com', 1)`), /no longer/);
  });
});

describe('a person\'s phone', () => {
  async function joined(email, role, write){
    const owner = await ownerWorld();
    await approve(owner, email, role, { write });
    const v = await phone(email);
    assert.equal(await v.run(`skJoinWithCode('${await codeFor(owner, email)}')`), '');
    return { owner, v };
  }
  test('opens the sections its role includes, and only those - even when handed every document', async () => {
    const { v } = await joined(VIEWER, 'business_viewer');
    for(const s of VIEWER_SECS) assert.match(await opens(v, s), /^\{/, s + ' opens');
    for(const s of HIDDEN_FROM_VIEWER){ const r = await opens(v, s); assert.ok(!r.startsWith('{'), s + ' stays sealed'); assert.match(r, /access code|encrypted/, s); }
    const ring = await v.get('skRingLoad()');
    assert.deepEqual(Object.keys(ring.s).sort(), VIEWER_SECS.slice().sort());
    assert.equal(ring.m, '', 'no master secret on a person\'s phone');
  });
  test('the operator opens Production and the lists, not Sales or Wages', async () => {
    const { v } = await joined(OPERATOR, 'production_operator', true);
    assert.match(await opens(v, 'production'), /"meters":120/); assert.match(await opens(v, 'reference'), /Poplin/);
    for(const s of ['sales', 'wages', 'family', 'expenses', 'loans']) assert.ok(!(await opens(v, s)).startsWith('{'), s);
  });
  test('the code is kept sealed on the phone, never as typed', async () => {
    const { owner, v } = await joined(VIEWER, 'business_viewer');
    const code = await codeFor(owner, VIEWER);
    assert.ok(![...v.store.values()].some(x => x.includes(code)), 'not in storage in the clear');
    assert.ok(v.store.get('khata-sec-code').startsWith('KHENC1:'));
  });
  test('needs Encrypt Data on first, and says so; a wrong or short code is refused', async () => {
    const owner = await ownerWorld(); await approve(owner, VIEWER, 'business_viewer');
    const plain = await phone(VIEWER, { encrypt: false });
    assert.match(await plain.run(`skJoinWithCode('${await codeFor(owner, VIEWER)}')`), /Encrypt Data/);
    const v = await phone(VIEWER);
    assert.match(await v.run(`skJoinWithCode('ABC')`), /20 letters/);
    assert.match(await v.run(`skJoinWithCode('AAAAAAAAAAAAAAAAAAAA')`), /does not open/);
    assert.equal(Object.keys((await v.get('skRingLoad()')).s).length, 0, 'nothing kept after a wrong code');
  });
  test('no bundle yet: told to ask the owner; not approved: told so', async () => {
    await ownerWorld();
    const v = await phone(VIEWER);
    assert.match(await v.run(`skJoinWithCode('AAAAAAAAAAAAAAAAAAAA')`), /has not made your code/);
    v.run(`__db.collection = () => ({ doc: () => ({ async get(){ const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; } }) });`);
    assert.match(await v.run(`skJoinWithCode('AAAAAAAAAAAAAAAAAAAA')`), /not approved/);
  });
  test('without encryption it cannot read an encrypted section and is told what to do', async () => {
    await ownerWorld();
    const plain = await phone(VIEWER, { encrypt: false });
    const r = await plain.get(`cloudDecryptRemote(${JSON.stringify(secDoc('production'))})`);
    assert.match(r.error, /Encrypt Data/);
  });
  test('without encryption it cannot send an encrypted section back as plain text', async () => {
    const { owner } = await joined(OPERATOR, 'production_operator', true);
    const plain = await phone(OPERATOR, { encrypt: false });
    await plain.get(`cloudDecryptRemote(${JSON.stringify(secDoc('production'))})`); // learns the section is encrypted
    await assert.rejects(plain.run(`cloudBuildSectionDoc('production', {}, '{}', null, '${OPERATOR}')`), /encrypted in the cloud/);
    void owner;
  });
  test('an editing person seals what they change with the section key, at the same version', async () => {
    const { v } = await joined(OPERATOR, 'production_operator', true);
    const doc = await v.get(`cloudBuildSectionDoc('production', {}, '{"production":[{"id":"n1"}]}', null, '${OPERATOR}')`);
    assert.equal(doc.encrypted, true); assert.equal(doc.kv, 1);
    cloud.set('ledger/production', doc);
    const owner = await phone(null, { encrypt: false }); void owner;
    assert.match(await opens(v, 'production'), /n1/);
  });
  test('a person cannot build a doc for a section they hold no key for', async () => {
    const { v } = await joined(OPERATOR, 'production_operator', true);
    await assert.rejects(v.run(`cloudBuildSectionDoc('wages', {}, '{}', null, '${OPERATOR}')`), /access code/);
  });
  test('an older single-key document is not opened by a person; the owner still opens it', async () => {
    const owner = await ownerWorld();
    const legacy = { section: 'production', payload: await owner.run(`encSeal('{"production":[{"id":"old"}]}')`), encrypted: true, savedAt: 'x' };
    assert.match((await owner.get(`cloudDecryptRemote(${JSON.stringify(legacy)})`)).json, /old/);
    await approve(owner, VIEWER, 'business_viewer');
    const v = await phone(VIEWER); await v.run(`skJoinWithCode('${await codeFor(owner, VIEWER)}')`);
    assert.match((await v.get(`cloudDecryptRemote(${JSON.stringify(legacy)})`)).error, /ask the owner/);
  });
});

describe('rotation: a section someone loses gets a new key', () => {
  async function two(){
    const owner = await ownerWorld();
    await approve(owner, VIEWER, 'business_viewer'); await approve(owner, VIEWER2, 'business_viewer');
    const a = await phone(VIEWER), b = await phone(VIEWER2);
    assert.equal(await a.run(`skJoinWithCode('${await codeFor(owner, VIEWER)}')`), '');
    assert.equal(await b.run(`skJoinWithCode('${await codeFor(owner, VIEWER2)}')`), '');
    return { owner, a, b };
  }
  test('revoking someone re-keys everything they held; the others keep working; the revoked cannot read the new copy', async () => {
    const { owner, a, b } = await two();
    const before = await owner.get('skRingLoad()'), beforeDocs = {}; VIEWER_SECS.forEach(sec => { beforeDocs[sec] = secDoc(sec); });
    const out = await owner.run(`cloudAccessEdit(rec => cloudAccessApplyRemove(rec, '${VIEWER}', ${NOW}))`);
    assert.deepEqual(j(out.rotated).sort(), VIEWER_SECS.slice().sort());
    const ring = await owner.get('skRingLoad()');
    VIEWER_SECS.forEach(s => { assert.equal(ring.s[s].v, 2, s); assert.equal(ring.s[s].p.k, before.s[s].k, 'previous key kept beside it'); assert.notEqual(ring.s[s].k, before.s[s].k); });
    HIDDEN_FROM_VIEWER.forEach(s => assert.equal(ring.s[s].v, 1, s + ' untouched'));
    assert.equal(cloud.has('keys/' + VIEWER), false, 'their bundle is removed');
    assert.ok(cloud.has('keys/' + VIEWER2));
    // the cloud copies were sealed again with the new keys, and nothing else about them changed
    VIEWER_SECS.forEach(s => { const d = secDoc(s); assert.equal(d.kv, 2, s); assert.equal(d.savedAt, beforeDocs[s].savedAt, s + ' keeps its date'); assert.notEqual(d.payload, beforeDocs[s].payload); });
    HIDDEN_FROM_VIEWER.forEach(s => assert.equal(secDoc(s).kv, 1, s + ' not touched'));
    assert.deepEqual(await owner.get('skDirty()'), []);
    // the person who stays: picks up the new key by itself
    b.run('SK_LAST_REFRESH = 0;');
    assert.match(await opens(b, 'production'), /"meters":120/);
    // the revoked person's keys open nothing new
    assert.equal((await a.get('skRingLoad()')).s.production.v, 1);
    assert.ok(!(await opens(a, 'production')).startsWith('{'));
  });
  test('re-sealing never uploads the owner phone\'s own data: an out-of-date phone cannot overwrite newer cloud data this way', async () => {
    const { owner } = await two();
    owner.run('DATA = {};'); // this phone knows nothing (it has not caught up with the cloud)
    await owner.run(`cloudAccessEdit(rec => cloudAccessApplyRemove(rec, '${VIEWER}', ${NOW}))`);
    assert.equal(secDoc('production').kv, 2);
    assert.match(await opens(owner, 'production'), /"meters":120/, 'the cloud copy is exactly what it was');
    assert.match(await opens(owner, 'sales'), /"total":5000/);
  });
  test('taking one section away from a person re-keys only that section', async () => {
    const { owner } = await two();
    const out = await owner.run(`cloudAccessEdit(rec => cloudAccessApplySetPerms(rec, '${VIEWER}', { production: 'v', reference: 'v', sales: 'v', business: 'v' }, ${NOW}))`);
    assert.deepEqual(j(out.rotated), ['recovery']);
    const ring = await owner.get('skRingLoad()');
    assert.equal(ring.s.recovery.v, 2); ['production', 'reference', 'sales', 'business'].forEach(s => assert.equal(ring.s[s].v, 1, s));
    const b = cloud.get('keys/' + VIEWER2);
    assert.ok(b, 'the other person still has a bundle, now with the new recovery key');
  });
  test('adding a section changes nobody\'s keys, only that person\'s bundle', async () => {
    const { owner } = await two();
    const out = await owner.run(`cloudAccessEdit(rec => cloudAccessApplySetPerms(rec, '${VIEWER}', { production: 'v', reference: 'v', sales: 'v', recovery: 'v', business: 'v', expenses: 'v' }, ${NOW}))`);
    assert.deepEqual(j(out.rotated || []), []);
    const ring = await owner.get('skRingLoad()'); ALL.forEach(s => assert.equal(ring.s[s].v, 1, s));
  });
  test('an approval that has ended is re-keyed the next time the owner\'s phone looks', async () => {
    const { owner } = await two();
    const rec = cloud.get('config/access'); rec.approved[VIEWER].expiresAt = NOW - 1000; cloud.set('config/access', rec);
    await owner.run('skReconcileQuiet(__db)');
    const ring = await owner.get('skRingLoad()');
    VIEWER_SECS.forEach(s => assert.equal(ring.s[s].v, 2, s));
    assert.equal(cloud.has('keys/' + VIEWER), false); assert.ok(cloud.has('keys/' + VIEWER2));
  });
  test('reconcile writes nothing when nothing changed', async () => {
    const { owner } = await two();
    writes.length = 0;
    const r = await owner.get(`skReconcile(__db, ${JSON.stringify(cloud.get('config/access'))})`);
    assert.deepEqual(r, { rotated: [], published: [] }); assert.deepEqual(writes, []);
  });
  test('if the re-seal cannot be done yet (no signal) the section stays readable with the previous key, and is finished later', async () => {
    const { owner, b } = await two();
    failLedgerWrites = true;
    await owner.run(`cloudAccessEdit(rec => cloudAccessApplyRemove(rec, '${VIEWER}', ${NOW}))`);
    assert.deepEqual((await owner.get('skDirty()')).sort(), VIEWER_SECS.slice().sort(), 'remembered as still to do');
    assert.equal(secDoc('production').kv, 1, 'the cloud copy is still at the old version');
    b.run('SK_LAST_REFRESH = 0;'); await b.run('skRefreshKeys()');
    assert.equal((await b.get('skRingLoad()')).s.production.v, 2);
    assert.match(await opens(b, 'production'), /"meters":120/, 'opened with the kept previous key');
    failLedgerWrites = false;
    await owner.run('skReconcileQuiet(__db)');
    assert.equal(secDoc('production').kv, 2); assert.deepEqual(await owner.get('skDirty()'), []);
    assert.match(await opens(b, 'production'), /"meters":120/);
  });
  test('a second change while a re-seal is still waiting keeps the key the cloud copy is really sealed with', async () => {
    const { owner } = await two();
    failLedgerWrites = true;
    await owner.run(`cloudAccessEdit(rec => cloudAccessApplyRemove(rec, '${VIEWER}', ${NOW}))`);
    await owner.run(`cloudAccessEdit(rec => cloudAccessApplyRemove(rec, '${VIEWER2}', ${NOW}))`);
    const ring = await owner.get('skRingLoad()');
    assert.equal(ring.s.production.v, 3); assert.equal(ring.s.production.p.v, 1, 'the previous key is still version 1');
    failLedgerWrites = false;
    await owner.run('skReconcileQuiet(__db)');
    assert.equal(secDoc('production').kv, 3); assert.match(await opens(owner, 'production'), /"meters":120/);
  });
  test('the person who lost access is not given the new keys', async () => {
    const { owner, a } = await two();
    await owner.run(`cloudAccessEdit(rec => cloudAccessApplyRemove(rec, '${VIEWER}', ${NOW}))`);
    a.run('SK_LAST_REFRESH = 0;'); await a.run('skRefreshKeys()').catch(() => {});
    const ring = await a.get('skRingLoad()'); assert.equal(ring.s.production.v, 1, 'still only the old version');
  });
});

describe('the owner\'s second phone, and switching encryption off and on', () => {
  test('Join Encrypted Sync adopts the shared data key and the keyring; a wrong PIN or a stranger\'s vault is refused', async () => {
    const owner = await ownerWorld();
    const second = await phone(OWNER, { pin: '2222' });
    const remote = await second.run('cloudJoinRemote(__db)');
    assert.ok(remote.keyWrap && remote.vault);
    assert.match(await second.run(`joinEncryptedSync('9999', '2222', 'ans', ${JSON.stringify(j(remote))})`), /check the PIN/);
    assert.equal(await second.run(`joinEncryptedSync('1111', '2222', 'ans', ${JSON.stringify(j(remote))})`), '');
    const a = await owner.get('skRingLoad()'), b = await second.get('skRingLoad()');
    assert.deepEqual(b.s, a.s); assert.equal(b.m, a.m);
    assert.match(await opens(second, 'wages'), /"rate":9/, 'reads what the first phone sealed');
    assert.match(await second.run(`joinEncryptedSync('1111', '3333', 'ans', ${JSON.stringify(j(remote))})`), /current PIN is incorrect/);
    assert.match(await second.run(`joinEncryptedSync('1111', '2222', 'ans', null)`), /No shared key/);
  });
  test('a second phone that changes access is followed by the first (newer key versions come from the vault)', async () => {
    const owner = await ownerWorld();
    const second = await phone(OWNER, { pin: '2222' });
    await second.run(`joinEncryptedSync('1111', '2222', 'ans', ${JSON.stringify(j(await second.run('cloudJoinRemote(__db)')))})`);
    await approve(second, VIEWER, 'business_viewer');
    await second.run(`cloudAccessEdit(rec => cloudAccessApplyRemove(rec, '${VIEWER}', ${NOW}))`);
    assert.equal(secDoc('production').kv, 2, 'the second phone re-sealed the cloud copies, uploading none of its own (empty) data');
    owner.run('SK_LAST_REFRESH = 0;');
    assert.match(await opens(owner, 'production'), /"meters":120/, 'the first phone fetched version 2 from the vault and still reads the data');
  });
  test('switching encryption off keeps the owner\'s keys on the phone; switching it on again finds the same ones', async () => {
    const owner = await ownerWorld();
    const before = await owner.get('skRingLoad()');
    await owner.run('skOnEncryptionOff()');
    assert.equal(owner.store.has('khata-sec-keyring'), false); assert.ok(owner.store.get('khata-sec-keyring-plain'));
    owner.store.delete('khata-enc-meta');
    await owner.run(`(async()=>{ const dek = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
      localStorage.setItem(ENC_META_KEY, JSON.stringify({v:1, iter:1000, pin: await encWrap(dek, '1111', 1000), rec: await encWrap(dek, 'ans', 1000)})); ENC_DEK = dek; })()`);
    await owner.run('skOwnerPrepare(__db)');
    const after = await owner.get('skRingLoad()');
    assert.deepEqual(after.s, before.s); assert.equal(after.m, before.m);
    assert.equal(owner.store.has('khata-sec-keyring-plain'), false, 'the plain copy is removed once sealed again');
    const vault = JSON.parse(await owner.run(`encOpen(${JSON.stringify(cloud.get('keys/' + OWNER).vault)})`));
    assert.deepEqual(vault.s, before.s, 'the cloud vault follows the new data key');
  });
  test('a changed PIN republishes the vault (the PIN-locked key changed) without re-sending every section', async () => {
    const owner = await ownerWorld();
    const wkBefore = cloud.get('keys/' + OWNER).keyWrap.wk;
    owner.run(`(async()=>{})()`); await owner.run(`(async()=>{ const m = encMeta(); m.pin = await encWrap(ENC_DEK, '5555', 1000); localStorage.setItem(ENC_META_KEY, JSON.stringify(m)); })()`);
    writes.length = 0; await owner.run('cloudPushNow()');
    assert.notEqual(cloud.get('keys/' + OWNER).keyWrap.wk, wkBefore);
    assert.deepEqual(writes.filter(w => w.path.startsWith('ledger/')), [], 'no section needed re-sending');
  });
});

describe('an earlier single-key setup is moved over once', () => {
  test('an old signature makes the owner send every section again, sealed with the section keys', async () => {
    const owner = await phone(OWNER);
    owner.run(`DATA = ${JSON.stringify(ledger())};`);
    owner.store.set('khata-cloud-keysig', 'e:oldwrap'); // what the earlier layout stored
    await owner.run('cloudPushNow()');
    ALL.forEach(s => assert.equal(secDoc(s).kv, 1, s));
    assert.equal(owner.store.get('khata-cloud-keysig'), 'e2');
    writes.length = 0; await owner.run('cloudPushNow()');
    assert.deepEqual(writes, [], 'and not again');
  });
});

describe('the People card and the code box', () => {
  const rec = () => cloud.get('config/access');
  test('an Access code button appears only while encryption is on, only for someone with a section and a running approval', async () => {
    const owner = await ownerWorld();
    await approve(owner, VIEWER, 'business_viewer'); await approve(owner, VIEWER2, 'custom');
    const html = await owner.run(`cloudPeopleListHtml(${JSON.stringify(rec())})`);
    assert.ok(html.includes(`data-cp-code="${VIEWER}"`)); assert.ok(!html.includes(`data-cp-code="${VIEWER2}"`), 'a role with no section has nothing to unlock');
    const off = await phone(OWNER, { encrypt: false });
    assert.ok(!(await off.run(`cloudPeopleListHtml(${JSON.stringify(rec())})`)).includes('data-cp-code='));
  });
  test('tapping it shows the same code the person must type, ready to send', async () => {
    const owner = await ownerWorld();
    await approve(owner, VIEWER, 'business_viewer');
    const el = { style: {}, innerHTML: '', getAttribute: () => VIEWER, querySelector: () => null };
    owner.ctx.__box = { querySelectorAll: () => [el] };
    await owner.run(`skPeopleCode(__box, '${VIEWER}')`);
    const code = await codeFor(owner, VIEWER);
    assert.ok(el.innerHTML.includes(await owner.run(`skCodeText('${code}')`)));
    assert.ok(el.innerHTML.includes('wa.me/?text='));
    assert.equal(el.style.display, 'block');
  });
  test('with encryption off it says no code is needed', async () => {
    const owner = await phone(OWNER, { encrypt: false });
    const el = { style: {}, innerHTML: '', getAttribute: () => VIEWER, querySelector: () => null };
    owner.ctx.__box = { querySelectorAll: () => [el] };
    await owner.run(`skPeopleCode(__box, '${VIEWER}')`);
    assert.match(el.innerHTML, /no code is needed/);
  });
  test('a person\'s Cloud Sync card shows the code box; the owner\'s shows Join instead', async () => {
    const v = await phone(VIEWER);
    assert.match(await v.run('skCodeCardHtml()'), /id="cloudCodeInput"/);
    const o = await phone(OWNER);
    assert.equal(await o.run('skCodeCardHtml()'), '');
    assert.match(await o.run('cloudSyncSection()'), /id="cloudJoinEnc" style="margin-top/);
    assert.match(await v.run('cloudSyncSection()'), /id="cloudJoinEnc" style="display:none;/);
  });
});

describe('the rules text', () => {
  const rule = () => vm.runInContext('CLOUD_FIRESTORE_RULE', vm.createContext((() => { const c = vm.createContext({}); vm.runInContext(read('js/cloud-sync.js').split('// True on a view-only phone')[0], c); return c; })()));
  const R = () => { const c = vm.createContext({ localStorage: { getItem: () => null } }); vm.runInContext(read('js/cloud-sync.js').split('// True on a view-only phone')[0], c); return vm.runInContext('CLOUD_FIRESTORE_RULE', c); };
  test('ledger sections: read needs v on that section; write needs a / e / d and the edit switch; encrypted stays encrypted; only the owner deletes', () => {
    const r = R();
    assert.match(r, /match \/ledger\/\{sec\}[\s\S]*?allow read: if isOwner\(\) \|\| canSee\(sec\);/);
    assert.match(r, /allow create, update: if isOwner\(\) \|\| \(canChange\(sec\) && !needsApproval\(sec\) && keepsEncryption\(\)\);/);
    assert.match(r, /match \/ledger\/\{sec\}[\s\S]*?allow delete: if isOwner\(\);/);
    assert.match(r, /grantPerms\(\)\.get\(sec, ''\)\.matches\('\.\*v\.\*'\)/);
    assert.match(r, /grantPerms\(\)\.get\(sec, ''\)\.matches\('\.\*\[aed\]\.\*'\)/);
    assert.match(r, /function canChange\(sec\) \{\s*return mayWrite\(\)/);
    assert.match(r, /request\.resource\.data\.get\('encrypted', false\) == true/);
  });
  test('keys: the owner reads and writes; a person reads only the document named with their own address', () => {
    const r = R();
    assert.match(r, /match \/keys\/\{email\}[\s\S]*?allow read: if isOwner\(\) \|\| \(isApproved\(\) && me\(\) == email\);/);
    assert.match(r, /match \/keys\/\{email\}[\s\S]*?allow write: if isOwner\(\);/);
  });
  test('the old whole-ledger document is the owner\'s alone; approved people read only their own note', () => {
    const r = R();
    assert.match(r, /match \/sync\/\{doc\}[\s\S]*?allow read: if isOwner\(\) \|\| \(isApproved\(\) && doc\.matches\('grant-\.\*'\)\);/);
    assert.match(r, /allow create, update, delete: if isOwner\(\);/);
    assert.ok(!/mayWrite\(\);\s*allow delete/.test(r));
  });
  test('the manifest and any section a person has no letters for are the owner\'s alone (no rule names them)', () => {
    assert.ok(!/match \/ledger\/manifest/.test(R()));
  });
  test('braces and parentheses balance', () => {
    const r = R();
    assert.equal((r.match(/\{/g) || []).length, (r.match(/\}/g) || []).length);
    assert.equal((r.match(/\(/g) || []).length, (r.match(/\)/g) || []).length);
    assert.equal((r.match(/\[/g) || []).length, (r.match(/\]/g) || []).length);
  });
  void rule;
});

describe('files stay in step', () => {
  test('the script is loaded after cloud-sync.js and before view-only.js, and cached for offline use', () => {
    const html = read('index.html'), sw = read('service-worker.js');
    const at = f => html.indexOf('<script src="./js/' + f + '"></script>');
    assert.ok(at('cloud-sync.js') > 0 && at('cloud-sync.js') < at('section-keys.js') && at('section-keys.js') < at('view-only.js'));
    assert.ok(sw.includes("'./js/section-keys.js'"));
  });
});
