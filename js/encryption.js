/* Encryption of the ledger stored on this phone (PIN-derived key), plus the Settings card for it.
 * Loaded after wiring.js and before lock-init.js (which holds the PIN screen and the startup
 * code). Functions here are used by core.js (save/load), shell.js (safety copies, Settings),
 * wiring.js (Settings buttons) and lock-init.js (unlocking) — all at run time, never while the
 * files are loading, so the load order doesn't matter beyond lock-init.js being last. */

/* ---------------- Encryption of the ledger stored on this phone ---------------- */
// Design: the ledger is encrypted with a random 256-bit data key (AES-GCM). That key is never
// stored as-is — only locked copies of it: one locked with the PIN, one with the recovery
// answer, and (optional) one with a random recovery KEY shown once when it is created (each through PBKDF2, so guessing is slow). So: the PIN unlocks the app, a forgotten PIN
// is still recoverable through the recovery answer (which re-locks the key under a new PIN), and
// changing the PIN never has to re-encrypt the ledger. While the app is unlocked the key lives in
// memory only. The fast PIN/answer hashes used when encryption is off are deleted when it is on
// (otherwise a 4-digit PIN could be guessed from them in milliseconds).
// Honest limit: strength is bounded by the PIN. 4 digits = 10,000 guesses, 6 = a million, 8 = a
// hundred million. The app slows guessing down, but it cannot stop someone who copies the
// phone's storage and guesses offline — a longer PIN is what makes that expensive.
const ENC_META_KEY = 'khata-enc-meta';        // JSON: {v, iter, pin:{salt,iv,wk}, rec:{salt,iv,wk}, key?:{salt,iv,wk}}
const ENC_DATA_KEY = 'khata-data-v3-enc';      // 'KHENC1:' + base64(iv | AES-GCM(flag | ledger))
const ENC_PREFIX = 'KHENC1:';
const ENC_ITER = 600000; // PBKDF2 rounds: each PIN guess costs this much work (stored in the meta, so it can be raised later)
const PIN_LENGTH_KEY = 'khata-pin-length';
let ENC_DEK = null;            // the unlocked data key (CryptoKey) — memory only, never stored
let ENC_LOAD_FAILED = false;   // set if the stored ciphertext could not be read: saving is blocked so it can't be overwritten
function encEnabled(){ try{ return !!localStorage.getItem(ENC_META_KEY); }catch(e){ return false; } }
function encMeta(){ try{ return JSON.parse(localStorage.getItem(ENC_META_KEY) || 'null'); }catch(e){ return null; } }
let ENC_PENDING_LOAD = encEnabled(); // true from page start until the ledger has been decrypted after unlocking
const encRandom = n => crypto.getRandomValues(new Uint8Array(n));

async function encKek(secret, salt, iter){
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:iter, hash:'SHA-256'}, km, {name:'AES-GCM', length:256}, false, ['wrapKey','unwrapKey']);
}
async function encWrap(dek, secret, iter){
  const salt = encRandom(16), iv = encRandom(12), kek = await encKek(secret, salt, iter);
  const wk = new Uint8Array(await crypto.subtle.wrapKey('raw', dek, kek, {name:'AES-GCM', iv}));
  return {salt:b64FromBytes(salt), iv:b64FromBytes(iv), wk:b64FromBytes(wk)};
}
// Throws if the secret is wrong (AES-GCM authentication fails).
async function encUnwrap(w, secret, iter){
  const kek = await encKek(secret, bytesFromB64(w.salt), iter);
  return crypto.subtle.unwrapKey('raw', bytesFromB64(w.wk), kek, {name:'AES-GCM', iv:bytesFromB64(w.iv)}, {name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
}
async function gzipBytes(bytes){
  try{
    if(typeof CompressionStream === 'undefined') return null;
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  }catch(e){ return null; }
}
async function gunzipBytes(bytes){
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
// Compresses first (the base64 wrapper would otherwise make the stored ledger ~33% bigger), then encrypts.
async function encSealWith(key, text){
  const raw = new TextEncoder().encode(text);
  const gz = await gzipBytes(raw);
  const flag = (gz && gz.length < raw.length) ? 1 : 0, body = flag ? gz : raw;
  const pt = new Uint8Array(1 + body.length); pt[0] = flag; pt.set(body, 1);
  const iv = encRandom(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, pt));
  const out = new Uint8Array(12 + ct.length); out.set(iv, 0); out.set(ct, 12);
  return ENC_PREFIX + b64FromBytes(out);
}
async function encOpenWith(key, blob){
  if(!String(blob).startsWith(ENC_PREFIX)) throw new Error('not an encrypted blob');
  const raw = bytesFromB64(String(blob).slice(ENC_PREFIX.length));
  const pt = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv:raw.slice(0,12)}, key, raw.slice(12)));
  const body = pt.slice(1);
  return new TextDecoder().decode(pt[0] === 1 ? await gunzipBytes(body) : body);
}
const encSeal = text => { if(!ENC_DEK) throw new Error('locked'); return encSealWith(ENC_DEK, text); };
const encOpen = blob => { if(!ENC_DEK) throw new Error('locked'); return encOpenWith(ENC_DEK, blob); };

// Where save() puts the ledger (the normal case): this phone's IndexedDB, via js/ledger-store.js.
async function ledgerToStorage(json){
  if(encEnabled()){
    if(!ENC_DEK || ENC_LOAD_FAILED) throw new Error('locked');
    await ledgerWrite(ENC_DATA_KEY, await encSeal(json));
  }else{
    await ledgerWrite(STORAGE_KEY, json);
  }
}
function showEncProblem(msg){
  let el = document.getElementById('encProblem');
  if(!el){
    el = document.createElement('div'); el.id = 'encProblem'; el.setAttribute('role','alert');
    el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:100001;background:#B3261E;color:#fff;padding:calc(10px + env(safe-area-inset-top,0px)) 14px 12px;font-size:14px;line-height:1.4';
    document.body.appendChild(el);
  }
  el.textContent = msg;
}
// After a correct PIN (or recovery answer) on a freshly opened app: decrypt the ledger and draw the app.
async function afterUnlockLoad(){
  if(!ENC_PENDING_LOAD || !ENC_DEK) return;
  ENC_PENDING_LOAD = false;
  await load();
  if(typeof cloudSyncCheckOnStart === 'function') setTimeout(cloudSyncCheckOnStart, 1500);
  autoBackupRefreshFabState(); // sets the FAB's "needs backup" badge to match reality on unlock
  try{ UNDO_PREV_PARTS = undoParts(); }catch(e){ /* best effort */ }
  if(typeof tombRebaseline === 'function') tombRebaseline();
  UNDO_STACK.length = 0; updateUndoButton();
  switchTab(CURRENT_TAB || 'overview');
  setTimeout(()=>{ maybeAutoSnapshot(); }, 1500);
}
async function purgePlaintextLedgerAndHashes(){
  try{
    Object.keys(localStorage).filter(k => k.startsWith('khata-data') && k !== ENC_DATA_KEY).forEach(k => localStorage.removeItem(k));
    [PIN_HASH_KEY, PIN_SALT_KEY, PIN_ANS_HASH_KEY, PIN_ANS_SALT_KEY].forEach(k => localStorage.removeItem(k));
  }catch(e){ /* best effort */ }
  try{ await ledgerRemove(STORAGE_KEY); }catch(e){ /* best effort: the plain ledger copy in IndexedDB goes too */ }
}
function setPinLength(n){
  try{ localStorage.setItem(PIN_LENGTH_KEY, String(n)); }catch(e){ /* best effort */ }
  PIN_LENGTH = n;
}

/* ---- Recovery key: a random code shown once, a third way to unlock (besides PIN and recovery answer) ---- */
// 20 characters from an alphabet with no look-alikes (no 0/O/1/I/L) = about 99 bits, written in
// groups of four: K7QM-2XNR-4TDA-9WHC-B3PF. Only a locked copy of the data key is stored (the
// code itself never is), so it can be shown exactly once.
const RECOVERY_KEY_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RECOVERY_KEY_LEN = 20;
function newRecoveryKey(){
  let out = '';
  const limit = 256 - (256 % RECOVERY_KEY_CHARS.length); // reject the few bytes that would bias the pick
  while(out.length < RECOVERY_KEY_LEN){
    for(const b of encRandom(32)){
      if(b < limit && out.length < RECOVERY_KEY_LEN) out += RECOVERY_KEY_CHARS[b % RECOVERY_KEY_CHARS.length];
    }
  }
  return out.match(/.{4}/g).join('-');
}
// Upper-case, drop spaces/dashes, so it can be typed or pasted in any layout.
function normalizeRecoveryKey(k){ return String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function hasRecoveryKey(){ const m = encMeta(); return !!(m && m.key); }
// Unlocks with the recovery key (like checkRecoveryAnswer does for the answer).
async function checkRecoveryKey(code){
  const meta = encMeta();
  if(!meta || !meta.key) return false;
  const k = normalizeRecoveryKey(code);
  if(k.length !== RECOVERY_KEY_LEN) return false;
  try{ const dek = await encUnwrap(meta.key, k, meta.iter); if(!ENC_DEK) ENC_DEK = dek; return true; }
  catch(e){ return false; }
}
// Creates (or replaces — the old key stops working) the recovery key for an unlocked, encrypted
// ledger. The caller shows `key` to the person once. Returns '' on success, otherwise the message.
async function setRecoveryKey(pin, key){
  if(!encEnabled()) return 'Turn on Encrypt Data first.';
  if(!ENC_DEK) return 'Unlock the app first.';
  if(!(await checkPin(pin))) return 'Current PIN is incorrect.';
  const meta = encMeta();
  meta.key = await encWrap(ENC_DEK, normalizeRecoveryKey(key), meta.iter);
  try{ localStorage.setItem(ENC_META_KEY, JSON.stringify(meta)); }
  catch(e){ return 'Not enough storage space — nothing was changed.'; }
  return '';
}

// Turn encryption on. Returns '' on success, otherwise the message to show (nothing is changed on failure).
async function enableEncryption(pin, answer, recoveryKey){
  if(encEnabled()) return 'Encryption is already on.';
  if(!(await checkPin(pin))) return 'Current PIN is incorrect.';
  if(!(await checkRecoveryAnswer(answer))) return 'Recovery answer is incorrect.';
  const dek = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
  const meta = {v:1, iter:ENC_ITER, pin: await encWrap(dek, pin, ENC_ITER), rec: await encWrap(dek, normalizeAnswer(answer), ENC_ITER)};
  if(recoveryKey) meta.key = await encWrap(dek, normalizeRecoveryKey(recoveryKey), ENC_ITER); // optional third way in
  const json = JSON.stringify(DATA);
  const blob = await encSealWith(dek, json);
  // Prove the copy can be opened with what will actually be stored, before touching the plain one.
  const back = await encOpenWith(await encUnwrap(meta.pin, pin, ENC_ITER), blob);
  if(back !== json) return 'Could not verify the encrypted copy — nothing was changed.';
  try{
    await ledgerWrite(ENC_DATA_KEY, blob);
    if(await ledgerRead(ENC_DATA_KEY) !== blob) throw new Error('verify failed'); // read back what was really stored
    localStorage.setItem(ENC_META_KEY, JSON.stringify(meta));
  }catch(e){
    try{ await ledgerRemove(ENC_DATA_KEY); localStorage.removeItem(ENC_META_KEY); }catch(_){ /* nothing more to do */ }
    return 'Not enough storage space to write the encrypted copy — nothing was changed.';
  }
  ENC_DEK = dek; ENC_PENDING_LOAD = false; ENC_LOAD_FAILED = false;
  await purgePlaintextLedgerAndHashes();
  try{ await snapConvertAll(true); }catch(e){ /* older safety copies are converted best-effort */ }
  return '';
}
// Owner's second phone: adopts the first phone's data key from the cloud instead of generating its own (a
// different key could never read what the first phone saved). `remote` is the owner's vault
// (keys/<owner email>, see js/section-keys.js): the PIN-locked copy of the data key (keyWrap) and the keyring
// sealed with that key (vault). sharedPin is the PIN used on the phone that first turned encryption on;
// localPin/localAnswer are THIS device's own already-set credentials, used to lock the same key locally
// exactly like enableEncryption does. This phone's own ledger is left as it is: the next sync compares it
// with the cloud and asks before changing anything. Returns '' on success, otherwise the message to show.
async function joinEncryptedSync(sharedPin, localPin, localAnswer, remote){
  if(!remote || !remote.keyWrap || !remote.vault) return 'No shared key found in the cloud yet. On the phone that first turned encryption on, open the app and tap Sync Now, then try again.';
  if(!(await checkPin(localPin))) return "This device's current PIN is incorrect.";
  if(!(await checkRecoveryAnswer(localAnswer))) return "This device's recovery answer is incorrect.";
  let dek;
  try{ dek = await encUnwrap(remote.keyWrap, sharedPin, remote.iter || ENC_ITER); }
  catch(e){
    // The cloud copy of the key is wrapped with the PIN of whichever phone synced last, which may be this one
    // (the PINs are allowed to differ in length, e.g. 4 digits on one phone and 6 on another). Both are PINs the
    // person typed themselves, so trying this phone's PIN as a second chance weakens nothing.
    try{ dek = await encUnwrap(remote.keyWrap, localPin, remote.iter || ENC_ITER); }
    catch(e2){ return "Couldn't unlock the shared key \u2014 check the PIN from the other device (its PIN can be a different length). If that PIN was changed recently, open the app on that device, tap Sync Now, then try again."; }
  }
  let vaultJson;
  try{ vaultJson = await encOpenWith(dek, remote.vault); JSON.parse(vaultJson); }
  catch(e){ return 'Shared key did not match the cloud keys.'; }
  const meta = {v:1, iter:ENC_ITER, pin: await encWrap(dek, localPin, ENC_ITER), rec: await encWrap(dek, normalizeAnswer(localAnswer), ENC_ITER)};
  const blob = await encSealWith(dek, JSON.stringify(DATA));
  try{
    await ledgerWrite(ENC_DATA_KEY, blob);
    if(await ledgerRead(ENC_DATA_KEY) !== blob) throw new Error('verify failed');
    localStorage.setItem(ENC_META_KEY, JSON.stringify(meta));
  }catch(e){ return 'Not enough storage space to write the encrypted copy — nothing was changed.'; }
  ENC_DEK = dek; ENC_PENDING_LOAD = false; ENC_LOAD_FAILED = false;
  await purgePlaintextLedgerAndHashes();
  try{ if(typeof skAdoptVault === 'function') await skAdoptVault(vaultJson); }catch(e){ console.error(e); }
  try{ await snapConvertAll(true); }catch(e){ /* best effort */ }
  return '';
}
// Turn encryption off (ledger and safety copies go back to plain storage). Returns '' or a message.
async function disableEncryption(pin, answer){
  if(!encEnabled()) return 'Encryption is already off.';
  if(!ENC_DEK) return 'Unlock the app first.';
  if(!(await checkPin(pin))) return 'Current PIN is incorrect.';
  if(!(await checkRecoveryAnswer(answer))) return 'Recovery answer is incorrect.';
  const json = JSON.stringify(DATA);
  try{
    await ledgerWrite(STORAGE_KEY, json);
    if(await ledgerRead(STORAGE_KEY) !== json) throw new Error('verify failed');
  }catch(e){
    try{ await ledgerRemove(STORAGE_KEY); }catch(_){ /* nothing more to do */ }
    return 'Not enough storage space to write the plain copy — nothing was changed.';
  }
  try{ if(typeof skOnEncryptionOff === 'function') await skOnEncryptionOff(); }catch(e){ /* best effort: the owner's cloud keys stay with the phone */ }
  await setPinPlain(pin);
  await setRecoveryPlain(getRecoveryQuestion(), answer);
  try{ await snapConvertAll(false); }catch(e){ /* best effort */ }
  try{ localStorage.removeItem(ENC_META_KEY); }catch(e){ /* best effort */ }
  try{ await ledgerRemove(ENC_DATA_KEY); }catch(e){ /* best effort */ }
  ENC_DEK = null;
  return '';
}

/* ---- Safety copies follow the ledger: encrypted while encryption is on ---- */
// A copy's text is stored either plain or as an encrypted blob (rec.enc says which), so copies
// taken before encryption was switched on/off can still be read afterwards.
async function snapText(rec){ return rec.enc ? encOpen(rec.json) : rec.json; }
async function snapPut(rec){ return snapTx('readwrite', s=>s.put(rec)); }
async function snapConvertAll(toEncrypted){
  for(const rec of await snapList()){
    if(!!rec.enc === toEncrypted) continue;
    const text = await snapText(rec);
    await snapPut(Object.assign({}, rec, {json: toEncrypted ? await encSeal(text) : text, enc: toEncrypted}));
  }
}

/* ---- Settings card ---- */
function encryptionSection(){
  const ans = 'autocomplete="off" autocapitalize="off" spellcheck="false"';
  const head = `<div class="card-head"><h2>Encrypt Data</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>Scrambles the ledger stored on this phone — and the app's safety copies — so it can't be read without your PIN, even by someone who copies the phone's storage. Backups you export are separate: tick the password option on the Backup tab for those. The PIN unlocks the app; the recovery answer, or the printable recovery key created when you turn this on, can still unlock it if the PIN is forgotten. If all are lost, the data cannot be recovered except from a backup. Strength depends on the PIN: 4 digits can be guessed by a determined attacker who has a copy of the storage, 6–8 digits is far stronger.</p>`;
  if(!isPinEnabled()){
    return `<div class="card">${head}<p class="note" style="margin:0">Turn on PIN Lock above first — the PIN is what unlocks the encryption.</p></div>`;
  }
  if(!encEnabled()){
    if(!hasRecovery()) return `<div class="card">${head}<p class="note" style="margin:0">Set a recovery question in PIN Lock above first, so a forgotten PIN can never lock you out of your own data.</p></div>`;
    return `<div class="card">${head}
      <p class="note" style="margin:0 0 12px">Off. ${PIN_LENGTH < 6 ? 'Your PIN is only ' + PIN_LENGTH + ' digits — change it to 6 or 8 digits first for much stronger protection.' : ''}</p>
      <button class="ghost" id="encShowOn" type="button" style="width:100%">Turn On Encryption…</button>
      <div id="encOnWrap" style="display:none;margin-top:14px">
        ${field('Current PIN','enc_pin','password',`inputmode="numeric" maxlength="8" placeholder="••••"`)}
        <div class="grid cols-1" style="margin-top:10px">${field('Recovery answer','enc_ans','password',ans)}</div>
        <p class="note" style="margin:8px 0 0">The recovery question is: <b>${escHtml(getRecoveryQuestion())}</b></p>
        <p class="note" style="margin:8px 0 0">A recovery key will be shown once when encryption turns on — print or save it right then.</p>
        <p class="note" id="encOnError" style="margin:8px 0;min-height:16px"></p>
        <button class="primary" id="encOnBtn" type="button">Encrypt Now</button>
      </div>
    </div>`;
  }
  return `<div class="card">${head}
    <p class="note" style="margin:0 0 12px"><b>On.</b> The ledger on this phone is encrypted. ${PIN_LENGTH < 6 ? '<span style="color:var(--rust)">Your PIN is only ' + PIN_LENGTH + ' digits — change it to 6 or 8 digits (Change PIN above) for much stronger protection.</span>' : ''}</p>
    <div style="margin:0 0 12px;padding-bottom:12px;border-bottom:1px solid var(--field-border)">
      <p class="note" style="margin:0 0 8px"><b>Recovery key:</b> ${hasRecoveryKey() ? 'created. Keep the printed or saved copy somewhere safe — it opens the app if the PIN is forgotten.' : '<span style="color:var(--rust)">not created yet.</span> A random code you print or save once, as a third way in if the PIN and recovery answer are both forgotten.'}</p>
      <button class="ghost" id="encShowKey" type="button" style="width:100%">${hasRecoveryKey() ? 'Replace Recovery Key…' : 'Create Recovery Key…'}</button>
      <div id="encKeyWrap" style="display:none;margin-top:14px">
        ${hasRecoveryKey() ? '<p class="note" style="margin:0 0 8px">A new key replaces the old one — the old key stops working.</p>' : ''}
        ${field('Current PIN','enc_key_pin','password',`inputmode="numeric" maxlength="8" placeholder="••••"`)}
        <p class="note" id="encKeyError" style="margin:8px 0;min-height:16px"></p>
        <button class="primary" id="encKeyBtn" type="button">Create Key</button>
      </div>
    </div>
    <button class="ghost" id="encShowOff" type="button" style="width:100%">Turn Off Encryption…</button>
    <div id="encOffWrap" style="display:none;margin-top:14px">
      ${field('Current PIN','enc_off_pin','password',`inputmode="numeric" maxlength="8" placeholder="••••"`)}
      <div class="grid cols-1" style="margin-top:10px">${field('Recovery answer','enc_off_ans','password',ans)}</div>
      <p class="note" id="encOffError" style="margin:8px 0;min-height:16px"></p>
      <button class="primary" id="encOffBtn" type="button" style="background:var(--rust-deep)">Turn Off Encryption</button>
    </div>
  </div>`;
}
function wireEncryptionCard(){
  const toggle = (btnId, wrapId)=>{
    const b = document.getElementById(btnId), w = document.getElementById(wrapId);
    if(b && w) b.onclick = ()=>{ w.style.display = w.style.display === 'none' ? 'block' : 'none'; };
  };
  toggle('encShowOn','encOnWrap'); toggle('encShowOff','encOffWrap'); toggle('encShowKey','encKeyWrap');
  const run = (btnId, errId, work, okMsg, after)=>{
    const btn = document.getElementById(btnId);
    if(!btn) return;
    btn.onclick = async ()=>{
      const err = document.getElementById(errId);
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Working…'; if(err) err.textContent = '';
      let msg;
      try{ msg = await work(); }catch(e){ msg = 'Something went wrong — nothing was changed.'; console.error(e); }
      btn.disabled = false; btn.textContent = label;
      if(msg){ if(err) err.textContent = msg; return; }
      switchTab('settings');
      showToast(okMsg, 5000);
      if(after) after();
    };
  };
  // Push right away when Cloud Sync is on — turning encryption on doesn't change DATA's
  // content (only how it's stored locally), so the debounced auto-push never fires for it on
  // its own, leaving another device's "Join Encrypted Sync" with no keyWrap to find until some
  // unrelated edit happened to trigger a push later.
  let freshKey = '';
  run('encOnBtn', 'encOnError', async ()=>{
    const key = newRecoveryKey();
    const msg = await enableEncryption(v('enc_pin'), v('enc_ans'), key);
    if(!msg){ freshKey = key; if(cloudSyncEnabled()) cloudPushNow(); }
    return msg;
  }, 'Encryption is on ✓', ()=> showRecoveryKeyDialog(freshKey));
  run('encKeyBtn', 'encKeyError', async ()=>{
    const key = newRecoveryKey();
    const msg = await setRecoveryKey(v('enc_key_pin'), key);
    if(!msg) freshKey = key;
    return msg;
  }, 'Recovery key created ✓', ()=> showRecoveryKeyDialog(freshKey));
  run('encOffBtn', 'encOffError', ()=> disableEncryption(v('enc_off_pin'), v('enc_off_ans')), 'Encryption is off');
}


/* ---- Recovery key: shown once, with Copy / Print / Save as text ---- */
function recoveryKeyText(key){
  return 'KHATA RECOVERY KEY\n\n' + key + '\n\nOpens the app if the PIN is forgotten: on the lock screen tap "Forgot PIN?", then "Use recovery key instead".\nAnyone with this key and access to the phone can open the ledger — keep it somewhere safe and private.\nCreating a new key later makes this one stop working.\n';
}
function showRecoveryKeyDialog(key){
  if(!key) return;
  const old = document.getElementById('recKeyDialog'); if(old) old.remove();
  const el = document.createElement('div');
  el.id = 'recKeyDialog'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px';
  el.innerHTML = `<div style="background:var(--paper,#fff);color:var(--ink,#222);border-radius:14px;padding:18px;max-width:420px;width:100%;max-height:92vh;overflow:auto">
    <h2 style="margin:0 0 8px;font-size:18px">Your recovery key</h2>
    <p class="note" style="margin:0 0 12px">This is the only time it is shown. Print it or save it now and keep it somewhere safe — it opens the app if the PIN is forgotten.</p>
    <div id="recKeyValue" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:20px;font-weight:700;letter-spacing:1px;text-align:center;padding:14px 8px;border:2px dashed var(--field-border,#bbb);border-radius:10px;user-select:all;word-break:break-all">${escHtml(key)}</div>
    <div style="display:flex;gap:8px;margin:12px 0"><button class="ghost" id="recKeyCopy" type="button" style="flex:1">Copy</button><button class="ghost" id="recKeyPrint" type="button" style="flex:1">Print</button><button class="ghost" id="recKeySave" type="button" style="flex:1">Save as text</button></div>
    <label style="display:flex;gap:8px;align-items:center;font-size:14px;margin-bottom:12px"><input type="checkbox" id="recKeyOk" style="width:18px;height:18px"> I have saved this key</label>
    <button class="primary" id="recKeyDone" type="button" style="width:100%" disabled>Done</button>
  </div>`;
  document.body.appendChild(el);
  const $ = id => el.querySelector('#' + id);
  $('recKeyOk').onchange = ()=>{ $('recKeyDone').disabled = !$('recKeyOk').checked; };
  $('recKeyDone').onclick = ()=> el.remove(); // no click-outside dismiss: it must not vanish by accident
  $('recKeyCopy').onclick = async ()=>{
    try{ await navigator.clipboard.writeText(key); showToast('Recovery key copied', 3000); }
    catch(e){ const r = document.createRange(); r.selectNodeContents($('recKeyValue')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); showToast('Select the key and copy it manually', 4000); }
  };
  $('recKeySave').onclick = ()=>{
    try{
      const url = URL.createObjectURL(new Blob([recoveryKeyText(key)], {type:'text/plain'}));
      const a = document.createElement('a'); a.href = url; a.download = 'khata-recovery-key.txt';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=> URL.revokeObjectURL(url), 5000);
    }catch(e){ showToast('Could not save the file — use Copy or Print instead', 5000); }
  };
  $('recKeyPrint').onclick = ()=>{
    try{
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
      f.srcdoc = '<!doctype html><meta charset="utf-8"><title>Khata recovery key</title><body style="font-family:sans-serif;padding:24px"><h2>Khata recovery key</h2><p style="font:700 24px monospace;letter-spacing:1px">' + escHtml(key) + '</p><p>Opens the app if the PIN is forgotten: on the lock screen tap "Forgot PIN?", then "Use recovery key instead".</p><p>Keep this page somewhere safe and private. Creating a new key later makes this one stop working.</p></body>';
      f.onload = ()=>{ try{ f.contentWindow.focus(); f.contentWindow.print(); }catch(e){ showToast('Printing did not start — use Save as text instead', 5000); } setTimeout(()=> f.remove(), 60000); };
      document.body.appendChild(f);
    }catch(e){ showToast('Printing did not start — use Save as text instead', 5000); }
  };
}
