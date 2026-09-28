/* Cloud Sync (optional, off by default) — keeps the ledger in sync across devices through a
 * private Firebase Firestore project. Loaded after encryption.js (uses encEnabled/encSeal/
 * encOpen) and before lock-init.js. The Firebase SDK itself is only fetched from Google's CDN
 * once Cloud Sync is actually turned on, so the app keeps working fully offline for everyone
 * who never uses this — see cloudSdkReady() below.
 *
 * SECURITY NOTE: like any client-side Firebase app, this file's apiKey is not a secret — real
 * protection comes only from the Firestore security rule shown in cloudSyncSection() below and
 * from Anonymous Authentication being turned on for this project. Anyone who obtains a copy of
 * this app's files could in principle sign in anonymously the same way it does and read/write
 * the same document, so treat this as "safe as long as the app itself isn't shared publicly" —
 * for stronger protection later, swap the anonymous sign-in below for real email/password auth
 * and tighten the rule to a specific account.
 *
 * Model: one shared Firestore document for the whole business (not one per device), holding
 * exactly what the local ledger holds — the same encrypted blob as local storage if Settings >
 * Encrypt Data is on, plain JSON otherwise (see ledgerToLocalStorage in encryption.js for the
 * matching local-storage logic). Every save() schedules a debounced push (cloudSyncSchedule);
 * app start/unlock calls cloudSyncCheckOnStart, which ASKS (blue bar with Update / ✕, like the
 * "new version" prompt) before pulling or merging another device's changes — nothing is applied
 * until the person taps Update, and while a prompt is waiting no automatic push runs, so a
 * dismissed prompt can never let this device overwrite the other device's newer data.
 */
const CLOUD_SYNC_ON_KEY = 'khata-cloud-sync-on';
const CLOUD_LAST_SEEN_KEY = 'khata-cloud-last-seen';   // remote `savedAt` this device last matched (via push or pull)
const CLOUD_LAST_HASH_KEY = 'khata-cloud-last-hash';   // sha256 of the ledger JSON as of that same moment
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC6eHrkICkII0cSQdFEFQuWlYG2zKDRhdc",
  authDomain: "ibrahim-weaving.firebaseapp.com",
  projectId: "ibrahim-weaving",
  storageBucket: "ibrahim-weaving.firebasestorage.app",
  messagingSenderId: "846261203838",
  appId: "1:846261203838:web:2dda6670f93f80832af92f"
};
const CLOUD_FIRESTORE_RULE = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sync/{doc} {
      allow read, write: if request.auth != null;
    }
  }
}`;

function cloudSyncEnabled(){ try{ return localStorage.getItem(CLOUD_SYNC_ON_KEY) === '1'; }catch(e){ return false; } }

let CLOUD_STATUS = 'idle';    // 'idle' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error'
let CLOUD_LAST_ERROR = '';
let CLOUD_PENDING_REMOTE = null; // set when a genuine conflict needs the user to pick a side
let CLOUD_PENDING_PULL = null;   // {remote, mode:'pull'|'merge'} — newer cloud data waiting for the person to approve
let CLOUD_SDK_READY = null;      // Promise, set once loading/signing-in has started

function loadScriptOnce(src){
  return new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = src; s.onload = ()=>resolve(); s.onerror = ()=>reject(new Error('Could not load '+src));
    document.head.appendChild(s);
  });
}
async function cloudSdkReady(){
  if(!CLOUD_SDK_READY){
    CLOUD_SDK_READY = (async ()=>{
      if(typeof firebase === 'undefined'){
        const v = '10.12.2';
        await loadScriptOnce(`https://www.gstatic.com/firebasejs/${v}/firebase-app-compat.js`);
        await loadScriptOnce(`https://www.gstatic.com/firebasejs/${v}/firebase-auth-compat.js`);
        await loadScriptOnce(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore-compat.js`);
      }
      if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      if(!firebase.auth().currentUser) await firebase.auth().signInAnonymously();
      return firebase.firestore();
    })();
  }
  return CLOUD_SDK_READY;
}
const cloudDocRef = db => db.collection('sync').doc('ledger');

function setCloudStatus(status, err){
  CLOUD_STATUS = status; CLOUD_LAST_ERROR = err || '';
  const el = document.getElementById('cloudSyncStatus');
  if(el) el.textContent = cloudStatusText();
  const conflictWrap = document.getElementById('cloudSyncConflict');
  if(conflictWrap) conflictWrap.style.display = status === 'conflict' ? 'block' : 'none';
}
function cloudStatusText(){
  if(CLOUD_STATUS === 'syncing') return 'Syncing…';
  if(CLOUD_STATUS === 'synced') return 'Synced just now';
  if(CLOUD_STATUS === 'offline') return 'Offline — will sync once back online';
  if(CLOUD_STATUS === 'waiting') return 'New data from another device is waiting — tap Sync Now to review it';
  if(CLOUD_STATUS === 'conflict') return "Another device has changes this device hasn't seen — pick which copy to keep below";
  if(CLOUD_STATUS === 'error') return 'Sync error: ' + CLOUD_LAST_ERROR;
  let t = null; try{ t = localStorage.getItem(CLOUD_LAST_SEEN_KEY); }catch(e){}
  return t ? ('Last synced ' + new Date(t).toLocaleString()) : 'Not synced yet';
}
async function cloudCurrentHash(){ return sha256Hex(JSON.stringify(DATA)); }

let CLOUD_PUSH_TIMER = null;
// Called from save() (core.js) after every change — debounced so a burst of edits sends one
// push a few seconds after the user stops, not one push per keystroke/field.
function cloudSyncSchedule(){
  if(!cloudSyncEnabled() || CLOUD_PENDING_PULL) return; // never auto-push over cloud data the person hasn't accepted yet
  clearTimeout(CLOUD_PUSH_TIMER);
  CLOUD_PUSH_TIMER = setTimeout(cloudPushNow, 4000);
}
async function cloudPushNow(){
  if(!cloudSyncEnabled() || CLOUD_PENDING_PULL) return;
  // Encrypting the outgoing payload (encSeal) needs the vault unlocked — on a fresh install
  // this can be tapped (via Sync Now, or the debounced schedule below) before the person has
  // entered their PIN even once, which used to surface as the raw "Sync error: locked" from
  // encSeal's own Error('locked'). Give a message that actually says what to do instead, and
  // stop here rather than letting that exception reach the catch block below.
  if(encEnabled() && !ENC_DEK){ setCloudStatus('error', 'app is locked — unlock with your PIN first, then try Sync Now'); return; }
  if(navigator.onLine === false){ setCloudStatus('offline'); return; }
  setCloudStatus('syncing');
  try{
    const db = await cloudSdkReady();
    const json = JSON.stringify(DATA);
    const payload = encEnabled() ? await encSeal(json) : json;
    const savedAt = new Date().toISOString();
    const doc = { payload, encrypted: !!encEnabled(), savedAt, entryCount: currentEntryCount() };
    // Also push the PIN-wrapped key bundle (not the key itself) so another device can adopt
    // this same key via joinEncryptedSync (encryption.js) instead of generating its own —
    // that mismatch was the actual cause of cross-device decrypt always failing before.
    const meta = encEnabled() ? encMeta() : null;
    if(meta){ doc.keyWrap = meta.pin; doc.iter = meta.iter; }
    await cloudDocRef(db).set(doc);
    const hash = await sha256Hex(json);
    try{ localStorage.setItem(CLOUD_LAST_SEEN_KEY, savedAt); localStorage.setItem(CLOUD_LAST_HASH_KEY, hash); }catch(e){}
    CLOUD_PENDING_REMOTE = null;
    setCloudStatus('synced');
  }catch(e){ console.error(e); setCloudStatus('error', e && e.message ? e.message : 'unknown error'); }
}
// Decrypts (or passes through) a remote doc's payload; used by both cloudApplyRemote and the
// auto-merge path below. Returns {json} or {error} (never throws) so callers just check which.
async function cloudDecryptRemote(remote){
  if(remote.encrypted && !ENC_DEK){
    return { error: encEnabled()
      ? 'app is locked — unlock with your PIN first, then try Sync Now'
      : 'the cloud copy is encrypted — use "Join Encrypted Sync" below to read it' };
  }
  if(!remote.encrypted) return { json: remote.payload };
  try{ return { json: await encOpen(remote.payload) }; }
  catch(e){ return { error: "could not decrypt this device's data — its encryption key doesn't match the device that saved it. Use \"Join Encrypted Sync\" below to adopt the same key." }; }
}
// Per-record merge: unions each array by id (never drops an entry either side added) instead of
// picking one whole device's copy wholesale — this is what lets both-sides-changed resolve
// automatically instead of asking. Same id present on both sides with different content (the
// same record edited on two devices) keeps the local edit; that's the only case this can't
// perfectly reconcile, but no entry is ever silently discarded, which was the real risk with
// whole-document last-write-wins.
function mergeLedgers(local, remote){
  const out = {};
  new Set([...Object.keys(local||{}), ...Object.keys(remote||{})]).forEach(k=>{
    const a = local[k], b = remote[k];
    if(Array.isArray(a) || Array.isArray(b)){
      const map = new Map();
      (b||[]).forEach(r=> r && r.id!=null && map.set(r.id, r));
      (a||[]).forEach(r=> r && r.id!=null && map.set(r.id, r)); // local wins on same-id edits
      out[k] = Array.from(map.values());
    } else if(a && typeof a==='object'){
      out[k] = Object.assign({}, b||{}, a); // local keys win on collision, union otherwise
    } else {
      out[k] = a!==undefined ? a : b;
    }
  });
  return out;
}
// Sync notice: deliberately looks nothing like the "App updated" bar (dark teal, bottom, full width)
// or the generic toast (dark grey pill, bottom) — it's a blue pill at the TOP of the screen with a
// sync icon, so "your data changed from another device" is never mistaken for a version update.
let _syncNoticeTimer = null;
function showSyncNotice(msg){
  let el = document.getElementById('syncNotice');
  if(!el){
    el = document.createElement('div');
    el.id = 'syncNotice';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:50%;top:calc(10px + env(safe-area-inset-top,0px));transform:translateX(-50%);max-width:min(92vw,420px);z-index:100000;background:#1F4E8C;color:#fff;border-radius:999px;padding:9px 16px;display:flex;align-items:center;gap:8px;box-shadow:0 6px 24px rgba(0,0,0,.3);font-size:13.5px;line-height:1.3;cursor:pointer';
    el.onclick = ()=> el.remove();
    document.body.appendChild(el);
  }
  el.textContent = '\u21BB  ' + msg;
  clearTimeout(_syncNoticeTimer);
  _syncNoticeTimer = setTimeout(()=>{ if(el.parentNode) el.remove(); }, 4000);
}
// Replaces DATA wholesale with a remote copy (mirrors load()'s own full-overwrite approach),
// saves it locally too, and updates the sync markers so this device now matches the cloud.
async function cloudApplyRemote(remote){
  const dec = await cloudDecryptRemote(remote);
  if(dec.error){ setCloudStatus('error', dec.error); return; }
  const json = dec.json;
  const parsed = JSON.parse(json);
  Object.keys(DATA).forEach(k=>{ delete DATA[k]; });
  Object.assign(DATA, parsed);
  await save();
  try{ localStorage.setItem(CLOUD_LAST_SEEN_KEY, remote.savedAt); localStorage.setItem(CLOUD_LAST_HASH_KEY, await sha256Hex(json)); }catch(e){}
  CLOUD_PENDING_REMOTE = null;
  switchTab(CURRENT_TAB || 'overview');
  showSyncNotice('New data synced from the cloud');
}
// Asks before touching local data: a blue bar at the top (Update / ✕), the same idea as the
// "new version" bar. Nothing is applied and nothing is pushed until Update is tapped; ✕ leaves
// the prompt for later (Settings > Cloud Sync > Sync Now brings it back).
function cloudAskToApply(remote, mode){
  CLOUD_PENDING_PULL = { remote, mode };
  setCloudStatus('waiting');
  const old = document.getElementById('cloudAskBar'); if(old) old.remove();
  const el = document.createElement('div');
  el.id = 'cloudAskBar';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(10px + env(safe-area-inset-top,0px));z-index:100000;background:#1F4E8C;color:#fff;border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);font-size:14px';
  const msg = mode === 'merge'
    ? 'Another device has new changes too. Merge them with this device?'
    : 'New data from another device is available.';
  el.innerHTML = '<span style="flex:1">' + msg + '</span><button type="button" id="cloudAskGo" style="background:#fff;color:#1F4E8C;border:0;border-radius:8px;padding:8px 14px;font-weight:700">' + (mode === 'merge' ? 'Merge' : 'Update') + '</button><button type="button" id="cloudAskLater" aria-label="Later" style="background:transparent;color:#fff;border:0;font-size:18px;padding:4px 8px">\u2715</button>';
  document.body.appendChild(el);
  el.querySelector('#cloudAskLater').onclick = ()=> el.remove();
  el.querySelector('#cloudAskGo').onclick = async ()=>{
    el.remove();
    const pending = CLOUD_PENDING_PULL;
    if(!pending) return;
    CLOUD_PENDING_PULL = null;
    try{
      if(pending.mode === 'merge'){
        const dec = await cloudDecryptRemote(pending.remote);
        if(dec.error){ setCloudStatus('error', dec.error); return; }
        Object.assign(DATA, mergeLedgers(DATA, JSON.parse(dec.json)));
        await save();
        CLOUD_PENDING_REMOTE = null;
        await cloudPushNow(); // share the merged result back so the other device converges too
        switchTab(CURRENT_TAB || 'overview');
        showSyncNotice('Changes from another device merged');
      } else {
        await cloudApplyRemote(pending.remote);
      }
    }catch(e){ console.error(e); setCloudStatus('error', e && e.message ? e.message : 'unknown error'); }
  };
}
// App start/unlock, and "Sync Now": decide whether to pull, push, or flag a real conflict.
// Never guesses when both sides have changed — see the file header note.
async function cloudSyncCheckOnStart(){
  if(!cloudSyncEnabled()) return;
  CLOUD_PENDING_PULL = null; // re-evaluated from scratch on every check (also what "Sync Now" does)
  const oldBar = document.getElementById('cloudAskBar'); if(oldBar) oldBar.remove();
  if(encEnabled() && !ENC_DEK) return; // still locked — afterUnlockLoad() calls this again once unlocked
  if(navigator.onLine === false){ setCloudStatus('offline'); return; }
  setCloudStatus('syncing');
  try{
    const db = await cloudSdkReady();
    const snap = await cloudDocRef(db).get();
    if(!snap.exists){ await cloudPushNow(); return; } // nothing in the cloud yet — seed it from this device
    const remote = snap.data();
    let lastSeen = null, lastHash = null;
    try{ lastSeen = localStorage.getItem(CLOUD_LAST_SEEN_KEY); lastHash = localStorage.getItem(CLOUD_LAST_HASH_KEY); }catch(e){}
    const remoteChanged = !!remote.savedAt && remote.savedAt !== lastSeen;
    const localChanged = lastHash !== await cloudCurrentHash();
    if(!remoteChanged && !localChanged){ setCloudStatus('synced'); return; }
    if(remoteChanged && !localChanged){ cloudAskToApply(remote, 'pull'); return; }
    if(!remoteChanged && localChanged){ await cloudPushNow(); return; }
    // Both sides changed — offer to merge by record id (nothing either device added is dropped,
    // see mergeLedgers above), but only once the person agrees.
    cloudAskToApply(remote, 'merge');
  }catch(e){ console.error(e); setCloudStatus('error', e && e.message ? e.message : 'unknown error'); }
}
async function cloudResolveKeepDevice(){ CLOUD_PENDING_REMOTE = null; CLOUD_PENDING_PULL = null; await cloudPushNow(); }
async function cloudResolveUseCloud(){
  try{
    CLOUD_PENDING_PULL = null;
    let remote = CLOUD_PENDING_REMOTE;
    if(!remote){ // conflict flag didn't survive a reload/relaunch — fetch fresh instead of doing nothing
      const db = await cloudSdkReady();
      const snap = await cloudDocRef(db).get();
      if(!snap.exists){ setCloudStatus('error', 'No cloud copy found yet.'); return; }
      remote = snap.data();
    }
    await cloudApplyRemote(remote);
  }catch(e){ console.error(e); setCloudStatus('error', e && e.message ? e.message : 'unknown error'); }
}

// --- Settings card ---
function cloudSyncSection(){
  const on = cloudSyncEnabled();
  const head = `<div class="card-head"><h2>Cloud Sync</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>Keeps this ledger in sync with other devices through a private Firebase project set up just for this business. Two one-time steps are needed in that project's own console before this will work: turn on <b>Anonymous</b> sign-in (Build → Authentication → Sign-in method), and set the Firestore security rule below (Build → Firestore Database → Rules) so only a signed-in request can read or write it.</p>
    <pre class="info-note" hidden style="white-space:pre-wrap;background:var(--paper-dim);padding:10px;border-radius:8px;font-size:12px;margin:-4px 0 0">${escHtml(CLOUD_FIRESTORE_RULE)}</pre>`;
  return `<div class="card">${head}
    <label style="display:flex;align-items:center;gap:10px;font-weight:500;cursor:pointer">
      <input type="checkbox" id="cloudSyncToggle" ${on?'checked':''} style="width:18px;height:18px">
      Enable Cloud Sync
    </label>
    <p class="note" id="cloudSyncStatus" style="margin-top:10px">${on ? cloudStatusText() : 'Off — this device only.'}</p>
    <div id="cloudSyncActions" style="${on?'':'display:none'}">
      <button class="ghost" id="cloudSyncNowBtn" type="button" style="width:100%">Sync Now</button>
      <div id="cloudSyncConflict" style="${CLOUD_STATUS==='conflict'?'':'display:none'};margin-top:10px">
        <p class="note" style="margin:0 0 8px;color:var(--rust)">This device and another device both have changes the other hasn't seen. Pick which copy to keep — the other will be overwritten:</p>
        <button class="ghost" id="cloudKeepDeviceBtn" type="button" style="width:100%;margin-bottom:8px">Keep This Device's Data</button>
        <button class="ghost" id="cloudUseCloudBtn" type="button" style="width:100%;background:var(--rust-deep);color:#fff">Use Cloud's Data Instead</button>
      </div>
      <div id="cloudJoinEnc" style="margin-top:14px;border-top:1px solid var(--field-border);padding-top:12px">
        <p class="note" style="margin:0 0 8px;font-weight:500">${encEnabled() ? 'Adopt a different device\'s key' : 'Join an already-encrypted cloud copy'}</p>
        <p class="note" style="margin:0 0 8px">If the cloud copy is encrypted (saved by a device with Encrypt Data on), this device needs that same key before it can read it — enter the PIN used on that other device, plus this device's own current PIN and recovery answer:</p>
        <input type="password" id="cloudJoinSharedPin" placeholder="PIN from the other device" style="width:100%;margin-bottom:8px" inputmode="numeric">
        <input type="password" id="cloudJoinLocalPin" placeholder="This device's current PIN" style="width:100%;margin-bottom:8px" inputmode="numeric">
        <input type="text" id="cloudJoinLocalAnswer" placeholder="This device's recovery answer" style="width:100%;margin-bottom:8px">
        <button class="ghost" id="cloudJoinBtn" type="button" style="width:100%">Join Encrypted Sync</button>
        <p class="note" id="cloudJoinStatus" style="margin:6px 0 0"></p>
      </div>
    </div>
  </div>`;
}
function wireCloudSyncCard(){
  const toggle = document.getElementById('cloudSyncToggle');
  if(toggle) toggle.onchange = async ()=>{
    try{ localStorage.setItem(CLOUD_SYNC_ON_KEY, toggle.checked ? '1' : '0'); }catch(e){}
    if(toggle.checked) await cloudSyncCheckOnStart(); else setCloudStatus('idle');
    switchTab('settings');
  };
  const nowBtn = document.getElementById('cloudSyncNowBtn');
  if(nowBtn) nowBtn.onclick = async ()=>{ nowBtn.disabled = true; await cloudSyncCheckOnStart(); nowBtn.disabled = false; switchTab('settings'); };
  const keepBtn = document.getElementById('cloudKeepDeviceBtn');
  if(keepBtn) keepBtn.onclick = async ()=>{ await cloudResolveKeepDevice(); switchTab('settings'); };
  const useCloudBtn = document.getElementById('cloudUseCloudBtn');
  if(useCloudBtn) useCloudBtn.onclick = async ()=>{ await cloudResolveUseCloud(); switchTab('settings'); };
  const joinBtn = document.getElementById('cloudJoinBtn');
  if(joinBtn) joinBtn.onclick = async ()=>{
    const statusEl = document.getElementById('cloudJoinStatus');
    const sharedPin = (document.getElementById('cloudJoinSharedPin')||{}).value || '';
    const localPin = (document.getElementById('cloudJoinLocalPin')||{}).value || '';
    const localAnswer = (document.getElementById('cloudJoinLocalAnswer')||{}).value || '';
    if(!sharedPin || !localPin || !localAnswer){ if(statusEl) statusEl.textContent = 'Fill in all three fields.'; return; }
    joinBtn.disabled = true;
    try{
      const db = await cloudSdkReady();
      const snap = await cloudDocRef(db).get();
      const remote = snap.exists ? snap.data() : null;
      const msg = await joinEncryptedSync(sharedPin, localPin, localAnswer, remote);
      if(msg){ if(statusEl) statusEl.textContent = msg; }
      else { await save(); switchTab('settings'); }
    }catch(e){ console.error(e); if(statusEl) statusEl.textContent = e && e.message ? e.message : 'unknown error'; }
    joinBtn.disabled = false;
  };
}
