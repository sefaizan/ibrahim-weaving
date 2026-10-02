/* Section keys (Release 3): what a person may not see is also unreadable to them when encryption is on.
 * Loaded after cloud-sync.js (uses its section list, people record and Firestore helpers) and before
 * view-only.js. Everything here is used at run time only, so the load order matters no further.
 *
 * Design
 *  - Every cloud section (production, sales, wages ...) is encrypted with ITS OWN random 256-bit key
 *    (AES-GCM, same sealing as the ledger on the phone). A section document says which key version sealed it
 *    (kv). The old single key that sealed every section is not used for the cloud any more.
 *  - The owner's phone holds all the keys (the "keyring"), stored on the phone sealed with the phone's own
 *    data key (so only while the app is unlocked). A copy of the keyring - the owner's "vault" - sits in
 *    keys/<owner email>, sealed with that same data key, next to the PIN-locked copy of the data key
 *    (keyWrap). Only the owner can read that document (see the rules in cloud-sync.js), so a viewer never
 *    receives keyWrap: it no longer travels with every section document.
 *  - Everyone else gets a "bundle" in keys/<their email>: only the keys of the sections their role may VIEW,
 *    sealed with a long random access code (20 characters). The code is worked out again from a secret in the
 *    keyring plus the email, so the owner's phone can show it again at any time and nothing has to be stored.
 *    The person types it once; their phone keeps it (sealed with the phone's own key) to fetch newer bundles.
 *  - When someone loses a section (revoked, expired, role or sections changed) that section's key is replaced.
 *    The cloud copy of the section is opened with the old key and sealed again with the new one, exactly as it
 *    is (nothing from the owner's own phone is uploaded, so a phone with older data can never overwrite newer
 *    cloud data by doing this), and the people who still have the section get the new key. The previous key
 *    travels along (p) so a section that has not been re-sealed yet can still be read.
 * Honest limits: data a person already downloaded stays readable to them; with encryption off on the owner's
 * phone sections are not encrypted and only Firebase's rules protect them.
 */
const SK_RING_KEY = 'khata-sec-keyring';            // this phone's keyring, sealed with ENC_DEK
const SK_RING_PLAIN_KEY = 'khata-sec-keyring-plain'; // owner: kept while encryption is switched off, so switching it on again finds the same keys
const SK_CODE_KEY = 'khata-sec-code';                // a person's access code, sealed with ENC_DEK
const SK_DIRTY_KEY = 'khata-sec-dirty';              // owner: sections whose key changed and must be sent again
const SK_VAULT_SIG_KEY = 'khata-sec-vaultsig';       // owner: which PIN-locked key the published vault belongs to
const SK_ENC_SEEN_KEY = 'khata-sec-enc';             // {section: true} sections seen encrypted in the cloud
let SK_ITER = 100000;                                // PBKDF2 rounds for the access code (it is long and random, so this is plenty)
let SK_RING = null, SK_RING_DEK = null;              // in-memory copy of the keyring, for the current unlock only
let SK_LAST_REFRESH = 0;

function skErr(code, msg){ const e = new Error(msg); e.skCode = code; return e; }
function skRingEmpty(){ return { m: '', s: {}, pub: {} }; }
function skRingClean(p){
  const r = skRingEmpty();
  if(p && typeof p === 'object'){
    r.m = String(p.m || '');
    if(p.s && typeof p.s === 'object') r.s = p.s;
    if(p.pub && typeof p.pub === 'object') r.pub = p.pub;
  }
  return r;
}
async function skNewKeyB64(){
  const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return b64FromBytes(new Uint8Array(await crypto.subtle.exportKey('raw', k)));
}
function skImport(b64){ return crypto.subtle.importKey('raw', bytesFromB64(b64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
async function skCodeKey(code, salt, iter){
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function skCodeText(code){ return String(code || '').replace(/(.{4})(?=.)/g, '$1-'); }
function skCodeVer(entry){ const n = Number(entry && entry.kc); return n > 0 ? Math.floor(n) : 1; }
// The person's access code: 20 characters from the same look-alike-free alphabet as the recovery key,
// worked out from a secret only the owner's keyring holds. Same email + same version = same code.
async function skAccessCode(ring, email, codeVer){
  if(!ring || !ring.m) throw new Error('This phone does not hold the owner\'s keys.');
  const hk = await crypto.subtle.importKey('raw', bytesFromB64(ring.m), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', hk, new TextEncoder().encode('access-code:' + String(email).trim().toLowerCase() + ':' + (codeVer || 1))));
  let out = '';
  for(let i = 0; i < RECOVERY_KEY_LEN; i++) out += RECOVERY_KEY_CHARS[sig[i] % RECOVERY_KEY_CHARS.length];
  return out;
}

// ---- The keyring on this phone -------------------------------------------------------------------
async function skRingLoad(){
  if(!encEnabled() || !ENC_DEK) return skRingEmpty();
  if(SK_RING && SK_RING_DEK === ENC_DEK) return SK_RING;
  let ring = skRingEmpty();
  try{
    const blob = localStorage.getItem(SK_RING_KEY);
    if(blob) ring = skRingClean(JSON.parse(await encOpen(blob)));
  }catch(e){ console.error(e); }
  SK_RING = ring; SK_RING_DEK = ENC_DEK;
  return ring;
}
async function skRingSave(ring){
  if(!encEnabled() || !ENC_DEK) throw new Error('locked');
  localStorage.setItem(SK_RING_KEY, await encSeal(JSON.stringify(ring)));
  SK_RING = ring; SK_RING_DEK = ENC_DEK;
}
function skDirty(){ try{ const a = JSON.parse(localStorage.getItem(SK_DIRTY_KEY) || '[]'); return Array.isArray(a) ? a : []; }catch(e){ return []; } }
function skDirtyAdd(list){
  const have = skDirty(); (list || []).forEach(s=>{ if(have.indexOf(s) < 0) have.push(s); });
  try{ localStorage.setItem(SK_DIRTY_KEY, JSON.stringify(have)); }catch(e){}
}
function skDirtyClear(sec){
  const have = skDirty().filter(s=> s !== sec);
  try{ localStorage.setItem(SK_DIRTY_KEY, JSON.stringify(have)); }catch(e){}
}
// Sections seen encrypted in the cloud: a phone without encryption must not send them back as plain text.
function skNoteEncrypted(sec){ if(!sec) return; const m = cloudMapGet(SK_ENC_SEEN_KEY); if(!m[sec]){ m[sec] = true; cloudMapSet(SK_ENC_SEEN_KEY, m); } }
function skMustEncrypt(sec){ return !!cloudMapGet(SK_ENC_SEEN_KEY)[sec]; }

// ---- Owner: keys exist, are backed up in the vault, then sections are sealed -----------------------------
const skOwnerVaultRef = db => db.collection('keys').doc(CLOUD_OWNER_EMAIL);
async function skVaultPublish(db, ring){
  const meta = encMeta();
  if(!meta || !meta.pin) throw new Error('encryption is not set up on this phone');
  await skOwnerVaultRef(db).set({
    email: CLOUD_OWNER_EMAIL, keyWrap: meta.pin, iter: meta.iter,
    vault: await encSeal(JSON.stringify({ m: ring.m, s: ring.s, pub: ring.pub })), updatedAt: new Date().toISOString(),
  });
  try{ localStorage.setItem(SK_VAULT_SIG_KEY, 'e:' + (meta.pin.wk || '')); }catch(e){}
}
// Called before the owner's phone sends anything encrypted. Creates any missing key and makes sure the
// vault (the backup of the keyring) is in the cloud FIRST, so a section can never be sealed with a key that
// exists nowhere else. Never creates fresh keys next to a vault this phone cannot open.
async function skOwnerPrepare(db){
  if(!cloudIsOwner() || !encEnabled() || !ENC_DEK) return;
  let ring = await skRingLoad(), changed = false, adopted = false;
  if(!ring.m){
    let plain = null; try{ plain = localStorage.getItem(SK_RING_PLAIN_KEY); }catch(e){}
    if(plain){ try{ ring = skRingClean(JSON.parse(plain)); adopted = !!ring.m; changed = adopted; }catch(e){ ring = skRingEmpty(); } }
  }
  if(!ring.m){
    const snap = await skOwnerVaultRef(db).get();
    if(snap.exists && snap.data() && snap.data().vault){
      try{ ring = skRingClean(JSON.parse(await encOpen(snap.data().vault))); changed = true; }
      catch(e){ throw new Error('the keys in the cloud were made on another phone \u2014 use "Join Encrypted Sync" in Settings > Cloud Sync to adopt them'); }
    }
  }
  if(!ring.m){ ring.m = await skNewKeyB64(); changed = true; }
  for(const sec of cloudSectionIds()){
    if(!ring.s[sec]){ ring.s[sec] = { v: 1, k: await skNewKeyB64() }; changed = true; }
  }
  if(changed) await skRingSave(ring);
  const meta = encMeta(); let last = null; try{ last = localStorage.getItem(SK_VAULT_SIG_KEY); }catch(e){}
  if(changed || last !== 'e:' + ((meta && meta.pin && meta.pin.wk) || '')) await skVaultPublish(db, ring);
  if(adopted){ try{ localStorage.removeItem(SK_RING_PLAIN_KEY); }catch(e){} }
}
// Seals one section for the cloud with that section's own key. Returns { payload, kv }.
async function skSealSection(sec, json){
  const ring = await skRingLoad(), e = ring.s[sec];
  if(!e) throw new Error(cloudIsOwner() ? 'no key for the ' + sec + ' section on this phone yet' : 'enter your access code first (Settings > Cloud Sync) \u2014 this phone has no key for the ' + sec + ' section');
  return { payload: await encSealWith(await skImport(e.k), json), kv: e.v };
}
async function skKeyFor(sec, kv){
  const ring = await skRingLoad(), e = ring.s[sec];
  if(!e) return null;
  if(e.v === kv) return skImport(e.k);
  if(e.p && e.p.v === kv) return skImport(e.p.k);
  return null;
}
function skNoKeyText(sec){
  return cloudIsOwner()
    ? 'this phone does not hold the key for the ' + sec + ' section \u2014 use "Join Encrypted Sync" below to adopt the keys'
    : 'the ' + sec + ' section is encrypted \u2014 enter your access code under Settings > Cloud Sync (ask the owner to send it)';
}
// Opens a section document. Returns { json } or { error } (never throws), like cloudDecryptRemote.
async function skOpenSection(remote){
  const sec = remote.section || '';
  skNoteEncrypted(sec);
  if(!encEnabled()){
    return { error: cloudIsOwner()
      ? 'the cloud copy is encrypted \u2014 use "Join Encrypted Sync" below to read it'
      : 'the ' + sec + ' section is encrypted \u2014 turn on Encrypt Data in Settings on this phone, then enter your access code under Cloud Sync' };
  }
  if(!ENC_DEK) return { error: 'app is locked \u2014 unlock with your PIN first, then try Sync Now' };
  let key = await skKeyFor(sec, remote.kv);
  if(!key){ try{ await skRefreshKeys(); }catch(e){ console.error(e); } key = await skKeyFor(sec, remote.kv); }
  if(!key) return { error: skNoKeyText(sec) };
  try{ return { json: await encOpenWith(key, remote.payload) }; }
  catch(e){ return { error: 'the ' + sec + ' section could not be decrypted \u2014 its key does not match' }; }
}

// ---- Owner: who holds which keys, rotation ------------------------------------------------------------
// Compares who SHOULD hold keys (approved, not expired, may view the section) with who was last given them
// (ring.pub). A section someone held and no longer should is re-keyed. Then every bundle that changed is
// written, people who no longer qualify lose theirs, and the vault is updated. Safe to run any number of
// times; it writes nothing when nothing changed. Returns { rotated: [sections], published: [emails] }.
async function skReconcile(db, rec){
  if(!cloudIsOwner() || !encEnabled() || !ENC_DEK) return { skipped: true, rotated: [], published: [] };
  await skOwnerPrepare(db);
  const ring = await skRingLoad(), now = Date.now(), ids = cloudSectionIds();
  const approved = (rec && rec.approved) || {}, want = {};
  Object.keys(approved).forEach(email=>{
    const a = approved[email] || {};
    if(!(Number(a.expiresAt) > now)) return;
    const perms = cloudPermsClean(a.perms);
    const secs = ids.filter(sec=> (perms[sec] || '').indexOf('v') >= 0);
    if(secs.length) want[email] = { s: secs, c: skCodeVer(a) };
  });
  const pub = ring.pub || {}, lost = [];
  Object.keys(pub).forEach(email=>{
    const w = (want[email] && want[email].s) || [];
    ((pub[email] && pub[email].s) || []).forEach(sec=>{ if(w.indexOf(sec) < 0 && lost.indexOf(sec) < 0 && ring.s[sec]) lost.push(sec); });
  });
  const pending = skDirty();
  for(const sec of lost){
    const old = ring.s[sec];
    // While an earlier re-seal is still waiting, the cloud copy is still sealed with the key kept in p: keep that one.
    ring.s[sec] = { v: old.v + 1, k: await skNewKeyB64(), p: (pending.indexOf(sec) >= 0 && old.p) ? old.p : { v: old.v, k: old.k } };
  }
  const next = {}, published = [];
  for(const email of Object.keys(want)){
    const w = want[email], vers = {};
    w.s.forEach(sec=>{ vers[sec] = ring.s[sec].v; });
    const old = pub[email];
    const same = old && old.c === w.c && JSON.stringify(old.s) === JSON.stringify(w.s) && JSON.stringify(old.v) === JSON.stringify(vers);
    if(!same){ await skPublishBundle(db, ring, email, w.c, w.s); published.push(email); }
    next[email] = { s: w.s, c: w.c, v: vers };
  }
  const gone = Object.keys(pub).filter(email=> !want[email]);
  for(const email of gone){ try{ await db.collection('keys').doc(email).delete(); }catch(e){ console.error(e); } }
  const changed = lost.length || published.length || gone.length || JSON.stringify(pub) !== JSON.stringify(next);
  if(changed){
    ring.pub = next;
    await skRingSave(ring);
    await skVaultPublish(db, ring);
    skDirtyAdd(lost);
  }
  await skResealDirty(db);
  return { rotated: lost, published };
}
// Opens the cloud copy of a section with the key it was sealed with and seals the same text again with the
// section's current key. The section's own date, author and count are left alone. Returns true when the
// section is current afterwards (or has nothing to do), false when it has to wait (kept for the next time).
async function skResealSection(db, sec){
  const ring = await skRingLoad(), cur = ring.s[sec];
  if(!cur){ skDirtyClear(sec); return true; }
  const ref = db.collection('ledger').doc(sec), snap = await ref.get();
  if(!snap.exists){ skDirtyClear(sec); return true; }
  const d = snap.data();
  if(!d.encrypted || d.kv === cur.v){ skDirtyClear(sec); return true; }
  const old = d.kv ? await skKeyFor(sec, d.kv) : ENC_DEK; // no kv: the earlier single-key layout
  if(!old) return false;
  const json = await encOpenWith(old, d.payload);
  d.payload = await encSealWith(await skImport(cur.k), json); d.kv = cur.v; d.rekeyedAt = new Date().toISOString();
  await ref.set(d);
  skDirtyClear(sec);
  return true;
}
async function skResealDirty(db){
  const done = [];
  for(const sec of skDirty()){
    try{ if(await skResealSection(db, sec)) done.push(sec); }catch(e){ console.error(e); }
  }
  return done;
}
async function skPublishBundle(db, ring, email, codeVer, secs){
  const code = await skAccessCode(ring, email, codeVer), salt = encRandom(16), key = await skCodeKey(code, salt, SK_ITER), s = {};
  secs.forEach(sec=>{ const e = ring.s[sec]; s[sec] = e.p ? { v: e.v, k: e.k, p: e.p } : { v: e.v, k: e.k }; });
  await db.collection('keys').doc(email).set({ email, salt: b64FromBytes(salt), iter: SK_ITER, bundle: await encSealWith(key, JSON.stringify({ s })), updatedAt: new Date().toISOString() });
}
// Quiet version for app start: reads the record, and re-keys / republishes when something expired or changed (and finishes any re-seal that could not be done earlier).
async function skReconcileQuiet(db){
  try{
    if(!cloudIsOwner() || !encEnabled() || !ENC_DEK || cloudOffline()) return;
    const snap = await cloudAccessRef(db).get();
    if(!snap.exists) return;
    await skReconcile(db, snap.data());
  }catch(e){ console.error(e); }
}

// ---- Getting keys (both kinds of phone) ---------------------------------------------------------------
async function skFetchBundle(code){
  const u = cloudUserNow(), email = String((u && u.email) || '').trim().toLowerCase();
  const db = await cloudSdkReady();
  let snap;
  try{ snap = await db.collection('keys').doc(email).get(); }
  catch(e){ if(cloudIsDenied(e)) throw skErr('denied', 'this account is not approved (or its approval has ended) \u2014 ask the owner'); throw e; }
  if(!snap.exists || !snap.data() || !snap.data().bundle) throw skErr('none', 'the owner has not made your code yet \u2014 ask them to open People and tap Access code');
  const d = snap.data();
  try{
    const p = JSON.parse(await encOpenWith(await skCodeKey(code, bytesFromB64(d.salt), d.iter || SK_ITER), d.bundle));
    return { s: p && p.s && typeof p.s === 'object' ? p.s : {} };
  }catch(e){ throw skErr('badcode', 'that code does not open your keys \u2014 check it, or ask the owner for a new one'); }
}
// A person types the code they were sent. Needs Encrypt Data on (that is where the keys are kept safe).
// Returns '' when done, otherwise the message to show.
async function skJoinWithCode(rawCode){
  if(!cloudCanSync()) return 'Sign in with your verified email first.';
  if(!encEnabled()) return 'Turn on Encrypt Data in Settings first (it keeps your keys safe on this phone), then enter the code.';
  if(!ENC_DEK) return 'Unlock the app first.';
  const code = normalizeRecoveryKey(rawCode);
  if(code.length !== RECOVERY_KEY_LEN) return 'The code has ' + RECOVERY_KEY_LEN + ' letters and numbers \u2014 check it.';
  try{
    const b = await skFetchBundle(code);
    const ring = await skRingLoad();
    ring.s = b.s;
    await skRingSave(ring);
    localStorage.setItem(SK_CODE_KEY, await encSeal(code));
    SK_LAST_REFRESH = Date.now();
    return '';
  }catch(e){ return e && e.message ? e.message : 'Something went wrong. Try again.'; }
}
// Fetches newer keys: the owner's phone from its vault, everyone else with the code kept on this phone.
// At most once every 30 seconds. Returns true when the keyring was updated.
async function skRefreshKeys(){
  if(!encEnabled() || !ENC_DEK) return false;
  if(Date.now() - SK_LAST_REFRESH < 30000) return false;
  SK_LAST_REFRESH = Date.now();
  const ring = await skRingLoad();
  if(cloudIsOwner()){
    const db = await cloudSdkReady(), snap = await skOwnerVaultRef(db).get();
    if(!snap.exists || !snap.data() || !snap.data().vault) return false;
    let p; try{ p = skRingClean(JSON.parse(await encOpen(snap.data().vault))); }catch(e){ return false; }
    ring.s = p.s; ring.pub = p.pub; if(!ring.m) ring.m = p.m;
    await skRingSave(ring);
    return true;
  }
  let code = null; try{ const blob = localStorage.getItem(SK_CODE_KEY); if(blob) code = await encOpen(blob); }catch(e){}
  if(!code) return false;
  const b = await skFetchBundle(code);
  ring.s = b.s;
  await skRingSave(ring);
  return true;
}
// "Join Encrypted Sync" on the owner's second phone: the vault (already opened with the shared data key).
async function skAdoptVault(vaultJson){
  const ring = skRingClean(JSON.parse(vaultJson));
  await skRingSave(ring);
  try{ localStorage.removeItem(SK_RING_PLAIN_KEY); }catch(e){}
}
// Called just before encryption is switched off: the owner's keys stay on the phone (as plain as the ledger
// itself now is) so switching it on again finds the same keys instead of clashing with the cloud vault.
async function skOnEncryptionOff(){
  const ring = await skRingLoad();
  try{
    if(ring.m) localStorage.setItem(SK_RING_PLAIN_KEY, JSON.stringify(ring));
    localStorage.removeItem(SK_RING_KEY); localStorage.removeItem(SK_CODE_KEY);
  }catch(e){}
  SK_RING = null; SK_RING_DEK = null;
}

// ---- The access code on the owner's People card -----------------------------------------------------------
function skCodeBoxHtml(email, code){
  const em = escHtml(email), text = skCodeText(code);
  const msg = 'Your access code for the Power Loom Ledger: ' + text + '\nOpen Settings > Cloud Sync, type it under Access code, then tap Sync Now.';
  return `<div class="note" style="margin:0 0 4px">Send this code to ${em} privately. They type it once in Settings > Cloud Sync (their phone needs Encrypt Data on).</div>
    <div style="font:600 20px/1.4 ui-monospace,Menlo,monospace;letter-spacing:1px;margin:6px 0;overflow-wrap:anywhere" data-cp-codetext="${em}">${escHtml(text)}</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      <button class="ghost" type="button" data-cp-codecopy="${em}" data-cp-codeval="${escHtml(msg)}">Copy</button>
      <a class="ghost" style="text-decoration:none;display:inline-flex;align-items:center;padding:0 14px;min-height:40px" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">WhatsApp</a>
      <button class="ghost" type="button" data-cp-newcode="${em}">New code</button>
    </div>
    <div class="note" style="margin:6px 0 0">New code: the old one stops working and they must type the new one.</div>`;
}
// The code shown must really open the bundle in the cloud. If it does not (the bundle was made with an older
// secret, or an older code), publish the bundle again with the code being shown. Never throws.
async function skEnsureBundleOpens(db, ring, email, a, code){
  try{
    const snap = await db.collection('keys').doc(email).get();
    const d = snap.exists ? snap.data() : null;
    if(d && d.bundle){
      try{ await encOpenWith(await skCodeKey(code, bytesFromB64(d.salt), d.iter || SK_ITER), d.bundle); return true; }catch(e){}
    }
    const entry = ring.pub && ring.pub[email];
    if(!entry || !entry.s || !entry.s.length) return false;
    await skPublishBundle(db, ring, email, skCodeVer(a), entry.s.filter(sec=> ring.s[sec]));
    return true;
  }catch(e){ console.error(e); return false; }
}
async function skPeopleCode(box, email){
  const el = cloudPeopleFind(box, 'data-cp-codebox', email);
  if(!el) return;
  if(el.style.display === 'block' && el.__shown){ el.style.display = 'none'; el.__shown = false; return; }
  el.style.display = 'block'; el.__shown = true;
  el.innerHTML = '<p class="note" style="margin:0">Working\u2026</p>';
  try{
    if(!encEnabled()){ el.innerHTML = '<p class="note" style="margin:0">Encryption is off on this phone, so the cloud copy is not encrypted and no code is needed. Turn on Encrypt Data in Settings if you want the sections encrypted.</p>'; return; }
    if(!ENC_DEK) throw new Error('Unlock the app first.');
    const rec = await cloudAccessRead(), db = await cloudSdkReady();
    const a = (rec.approved || {})[email];
    if(!a) throw new Error('That person is no longer on the list.');
    await skReconcile(db, rec);
    const ring = await skRingLoad();
    if(!(ring.pub && ring.pub[email])){ el.innerHTML = '<p class="note" style="margin:0">Nothing to unlock yet: their role does not include any section (or their approval has ended).</p>'; return; }
    const shownCode = await skAccessCode(ring, email, skCodeVer(a));
    await skEnsureBundleOpens(db, ring, email, a, shownCode);
    el.innerHTML = skCodeBoxHtml(email, shownCode);
    const copy = el.querySelector('[data-cp-codecopy]');
    if(copy) copy.onclick = async ()=>{ try{ await navigator.clipboard.writeText(copy.getAttribute('data-cp-codeval')); copy.textContent = 'Copied'; }catch(e){ copy.textContent = 'Copy failed'; } };
    const fresh = el.querySelector('[data-cp-newcode]');
    if(fresh) fresh.onclick = ()=> skPeopleNewCode(box, fresh, email);
  }catch(e){ console.error(e); el.innerHTML = '<p class="note" style="margin:0;color:var(--rust)">' + escHtml(cloudPeopleErrorText(e)) + '</p>'; }
}
// New code: tap once to arm, again to do it.
async function skPeopleNewCode(box, btn, email){
  if(!btn.__armed){
    btn.__armed = setTimeout(()=>{ btn.__armed = null; btn.textContent = 'New code'; }, 4000);
    btn.textContent = 'Tap again';
    return;
  }
  clearTimeout(btn.__armed); btn.__armed = null; btn.disabled = true;
  try{
    await cloudAccessEdit(rec => cloudAccessApplyNewCode(rec, email, Date.now()));
    const el = cloudPeopleFind(box, 'data-cp-codebox', email);
    if(el){ el.__shown = false; el.style.display = 'none'; }
    await skPeopleCode(box, email);
  }catch(e){ console.error(e); cloudPeopleSay(cloudPeopleErrorText(e)); btn.disabled = false; }
}

// ---- The access code box on a person's own phone (Settings > Cloud Sync) ----------------------------------
function skCodeCardHtml(){
  const u = cloudUserNow();
  if(!u || !u.verified || cloudIsOwner()) return '';
  return `<div id="cloudCodeBox" style="margin-top:14px;border-top:1px solid var(--field-border);padding-top:12px">
    <p class="note" style="margin:0 0 8px;font-weight:500">Access code</p>
    <p class="note" style="margin:0 0 8px">The owner sends you a code (20 letters and numbers). Type it once so this phone can read the sections your role includes. It needs Encrypt Data turned on in Settings.</p>
    <input type="text" id="cloudCodeInput" placeholder="Access code" autocomplete="off" autocapitalize="characters" spellcheck="false" style="width:100%;margin-bottom:8px">
    <button class="ghost" id="cloudCodeBtn" type="button" style="width:100%">Unlock my sections</button>
    <p class="note" id="cloudCodeStatus" style="margin:6px 0 0"></p>
  </div>`;
}
function skWireCodeCard(){
  const btn = document.getElementById('cloudCodeBtn');
  if(!btn) return;
  btn.onclick = async ()=>{
    const st = document.getElementById('cloudCodeStatus'), input = document.getElementById('cloudCodeInput');
    btn.disabled = true; if(st) st.textContent = '';
    const msg = await skJoinWithCode(input ? input.value : '');
    btn.disabled = false;
    if(msg){ if(st){ st.textContent = msg; st.style.color = 'var(--rust)'; } return; }
    if(input) input.value = '';
    if(st){ st.textContent = 'Done \u2014 syncing your sections\u2026'; st.style.color = 'inherit'; }
    try{ await cloudSyncCheckOnStart(); }catch(e){ console.error(e); }
    if(typeof switchTab === 'function') switchTab('settings');
  };
}
