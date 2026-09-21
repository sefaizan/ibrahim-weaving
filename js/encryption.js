/* Encryption of the ledger stored on this phone (PIN-derived key), plus the Settings card for it.
 * Loaded after wiring.js and before lock-init.js (which holds the PIN screen and the startup
 * code). Functions here are used by core.js (save/load), shell.js (safety copies, Settings),
 * wiring.js (Settings buttons) and lock-init.js (unlocking) — all at run time, never while the
 * files are loading, so the load order doesn't matter beyond lock-init.js being last. */

/* ---------------- Encryption of the ledger stored on this phone ---------------- */
// Design: the ledger is encrypted with a random 256-bit data key (AES-GCM). That key is never
// stored as-is — only two locked copies of it: one locked with the PIN, one with the recovery
// answer (each through PBKDF2, so guessing is slow). So: the PIN unlocks the app, a forgotten PIN
// is still recoverable through the recovery answer (which re-locks the key under a new PIN), and
// changing the PIN never has to re-encrypt the ledger. While the app is unlocked the key lives in
// memory only. The fast PIN/answer hashes used when encryption is off are deleted when it is on
// (otherwise a 4-digit PIN could be guessed from them in milliseconds).
// Honest limit: strength is bounded by the PIN. 4 digits = 10,000 guesses, 6 = a million, 8 = a
// hundred million. The app slows guessing down, but it cannot stop someone who copies the
// phone's storage and guesses offline — a longer PIN is what makes that expensive.
const ENC_META_KEY = 'khata-enc-meta';        // JSON: {v, iter, pin:{salt,iv,wk}, rec:{salt,iv,wk}}
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

// Where save() puts the ledger when it falls back to localStorage (the normal case).
async function ledgerToLocalStorage(json){
  if(encEnabled()){
    if(!ENC_DEK || ENC_LOAD_FAILED) throw new Error('locked');
    localStorage.setItem(ENC_DATA_KEY, await encSeal(json));
  }else{
    localStorage.setItem(STORAGE_KEY, json);
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
  try{ UNDO_PREV_PARTS = undoParts(); }catch(e){ /* best effort */ }
  UNDO_STACK.length = 0; updateUndoButton();
  switchTab(CURRENT_TAB || 'overview');
  setTimeout(()=>{ maybeAutoSnapshot(); }, 1500);
}
function purgePlaintextLedgerAndHashes(){
  try{
    Object.keys(localStorage).filter(k => k.startsWith('khata-data') && k !== ENC_DATA_KEY).forEach(k => localStorage.removeItem(k));
    [PIN_HASH_KEY, PIN_SALT_KEY, PIN_ANS_HASH_KEY, PIN_ANS_SALT_KEY].forEach(k => localStorage.removeItem(k));
  }catch(e){ /* best effort */ }
}
function setPinLength(n){
  try{ localStorage.setItem(PIN_LENGTH_KEY, String(n)); }catch(e){ /* best effort */ }
  PIN_LENGTH = n;
}

// Turn encryption on. Returns '' on success, otherwise the message to show (nothing is changed on failure).
async function enableEncryption(pin, answer){
  if(encEnabled()) return 'Encryption is already on.';
  if(!(await checkPin(pin))) return 'Current PIN is incorrect.';
  if(!(await checkRecoveryAnswer(answer))) return 'Recovery answer is incorrect.';
  const dek = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
  const meta = {v:1, iter:ENC_ITER, pin: await encWrap(dek, pin, ENC_ITER), rec: await encWrap(dek, normalizeAnswer(answer), ENC_ITER)};
  const json = JSON.stringify(DATA);
  const blob = await encSealWith(dek, json);
  // Prove the copy can be opened with what will actually be stored, before touching the plain one.
  const back = await encOpenWith(await encUnwrap(meta.pin, pin, ENC_ITER), blob);
  if(back !== json) return 'Could not verify the encrypted copy — nothing was changed.';
  try{
    localStorage.setItem(ENC_DATA_KEY, blob);
    localStorage.setItem(ENC_META_KEY, JSON.stringify(meta));
  }catch(e){
    try{ localStorage.removeItem(ENC_DATA_KEY); localStorage.removeItem(ENC_META_KEY); }catch(_){ /* nothing more to do */ }
    return 'Not enough storage space to write the encrypted copy — nothing was changed.';
  }
  ENC_DEK = dek; ENC_PENDING_LOAD = false; ENC_LOAD_FAILED = false;
  purgePlaintextLedgerAndHashes();
  try{ await snapConvertAll(true); }catch(e){ /* older safety copies are converted best-effort */ }
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
    localStorage.setItem(STORAGE_KEY, json);
    if(localStorage.getItem(STORAGE_KEY) !== json) throw new Error('verify failed');
  }catch(e){
    try{ localStorage.removeItem(STORAGE_KEY); }catch(_){ /* nothing more to do */ }
    return 'Not enough storage space to write the plain copy — nothing was changed.';
  }
  await setPinPlain(pin);
  await setRecoveryPlain(getRecoveryQuestion(), answer);
  try{ await snapConvertAll(false); }catch(e){ /* best effort */ }
  try{ localStorage.removeItem(ENC_META_KEY); localStorage.removeItem(ENC_DATA_KEY); }catch(e){ /* best effort */ }
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
    <p class="note info-note" hidden>Scrambles the ledger stored on this phone — and the app's safety copies — so it can't be read without your PIN, even by someone who copies the phone's storage. Backups you export are separate: tick the password option on the Backup tab for those. The PIN unlocks the app; the recovery answer can still unlock it if the PIN is forgotten. If both are lost, the data cannot be recovered except from a backup. Strength depends on the PIN: 4 digits can be guessed by a determined attacker who has a copy of the storage, 6–8 digits is far stronger.</p>`;
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
        <p class="note" id="encOnError" style="margin:8px 0;min-height:16px"></p>
        <button class="primary" id="encOnBtn" type="button">Encrypt Now</button>
      </div>
    </div>`;
  }
  return `<div class="card">${head}
    <p class="note" style="margin:0 0 12px"><b>On.</b> The ledger on this phone is encrypted. ${PIN_LENGTH < 6 ? '<span style="color:var(--rust)">Your PIN is only ' + PIN_LENGTH + ' digits — change it to 6 or 8 digits (Change PIN above) for much stronger protection.</span>' : ''}</p>
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
  toggle('encShowOn','encOnWrap'); toggle('encShowOff','encOffWrap');
  const run = (btnId, errId, work, okMsg)=>{
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
    };
  };
  run('encOnBtn', 'encOnError', ()=> enableEncryption(v('enc_pin'), v('enc_ans')), 'Encryption is on ✓');
  run('encOffBtn', 'encOffError', ()=> disableEncryption(v('enc_off_pin'), v('enc_off_ans')), 'Encryption is off');
}

