/* Cloud Sync (optional, off by default) — keeps the ledger in sync across devices through a
 * private Firebase Firestore project. Loaded after encryption.js (uses encEnabled/encSeal/
 * encOpen) and before lock-init.js. The Firebase SDK itself is only fetched from Google's CDN
 * once Cloud Sync is actually turned on, so the app keeps working fully offline for everyone
 * who never uses this — see cloudSdkReady() below.
 *
 * SIGN-IN: the person signs in with an email address and password (Firebase Authentication,
 * Email/Password provider — see the account block in cloudSyncSection() below). Anonymous sign-in
 * is gone: an old anonymous session found on a device is signed out and never used. Sign-up sends a
 * verification email, and nothing syncs until the address is verified, because the Firestore rule
 * (CLOUD_FIRESTORE_RULE) matches on the verified email — without that check anyone could register
 * somebody else's address first. The Firebase login is kept by the SDK in the browser's own storage,
 * so a phone that is signed in stays signed in offline; the ledger itself never depends on it and
 * the whole app keeps working with no signal. The apiKey below is not a secret; the real protection
 * is the Firestore rule plus who holds an account.
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
const CLOUD_LAST_OK_KEY = 'khata-cloud-last-ok';       // ms time of the last check/push that finished fine (drives "Synced 2 min ago")
const CLOUD_CHECK_COOLDOWN_MS = 60000;                 // returning to the app re-checks the cloud at most this often
const CLOUD_LAST_HASH_KEY = 'khata-cloud-last-hash';   // sha256 of the ledger JSON as of that same moment
const CLOUD_USER_KEY = 'khata-cloud-user';             // {email, verified} of the signed-in account, so Settings can show it with no signal
const CLOUD_MIN_PASSWORD = 8;
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC6eHrkICkII0cSQdFEFQuWlYG2zKDRhdc",
  authDomain: "ibrahim-weaving.firebaseapp.com",
  projectId: "ibrahim-weaving",
  storageBucket: "ibrahim-weaving.firebasestorage.app",
  messagingSenderId: "846261203838",
  appId: "1:846261203838:web:2dda6670f93f80832af92f"
};
// The one account that owns this ledger: the only one that can read/write it and the only one that can edit the
// access record below. The Firestore rule matches on this same address, so keep the two in step.
const CLOUD_OWNER_EMAIL = 'se.muhammadfaizan@gmail.com';
const CLOUD_ACCESS_OK_KEY = 'khata-cloud-access-ok';   // owner email the access record was last confirmed to exist for
// Firestore rules to paste in the console (Build > Firestore Database > Rules). This is the final rule:
// who may do what is DATA in config/access (below), so approving, expiring, or upgrading someone to
// write access never needs a rule change. An entry counts only while its expiresAt is in the future
// (a missing expiresAt means expired), and only entries with write:true may write.
const CLOUD_FIRESTORE_RULE = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null && request.auth.token.email_verified == true;
    }
    function me() {
      return request.auth.token.email.lower();
    }
    function isOwner() {
      return signedIn() && me() == '${CLOUD_OWNER_EMAIL}';
    }

    // config/access = { ownerEmail, approved: { "<lowercase email>": { expiresAt: <ms>, write: <true|false> } } }
    function grants() {
      return get(/databases/$(database)/documents/config/access).data.approved;
    }
    function isApproved() {
      return signedIn() && me() in grants()
        && grants()[me()].get('expiresAt', 0) > request.time.toMillis();
    }
    function mayWrite() {
      return isApproved() && grants()[me()].get('write', false) == true;
    }

    // The ledger: the owner, and approved people while unexpired (view-only unless write is true).
    match /sync/{doc} {
      allow read: if isOwner() || isApproved();
      allow create, update: if isOwner() || mayWrite();
      allow delete: if isOwner();
    }

    // The permissions record: only the owner reads or edits it, and it can never be deleted.
    match /config/access {
      allow read: if isOwner();
      allow create, update: if isOwner()
        && request.resource.data.ownerEmail == '${CLOUD_OWNER_EMAIL}';
      allow delete: if false;
    }
  }
}`;



function cloudSyncEnabled(){ try{ return localStorage.getItem(CLOUD_SYNC_ON_KEY) === '1'; }catch(e){ return false; } }

let CLOUD_STATUS = 'idle';    // 'idle' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error'
let CLOUD_LAST_ERROR = '';
let CLOUD_PENDING_REMOTE = null; // set when a genuine conflict needs the user to pick a side
let CLOUD_PENDING_PULL = null;   // {remote, mode:'pull'|'merge'} — newer cloud data waiting for the person to approve
let CLOUD_SDK_LOAD = null;       // Promise, set once the Firebase scripts have started loading
let CLOUD_USER = null;           // {email, verified} of the signed-in account, once known this session
let CLOUD_AUTH_KNOWN = false;    // true once Firebase has restored (or failed to restore) the saved login
let CLOUD_AUTH_MODE = 'signin';  // Settings account form: 'signin' | 'signup' | 'reset'
let CLOUD_AUTH_DRAFT = '';       // the email typed so far, kept when the form switches mode

function loadScriptOnce(src){
  return new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = src; s.onload = ()=>resolve(); s.onerror = ()=>reject(new Error('Could not load '+src));
    document.head.appendChild(s);
  });
}
function cloudErr(code, msg){ const e = new Error(msg); e.cloudCode = code; return e; }
function cloudOffline(){ return typeof navigator !== 'undefined' && navigator.onLine === false; }
function cloudStoredUser(){ try{ const u = JSON.parse(localStorage.getItem(CLOUD_USER_KEY) || 'null'); return u && u.email ? u : null; }catch(e){ return null; } }
// The account this device is signed in as: this session's answer, else the one saved last time (works with no signal).
function cloudUserNow(){ return CLOUD_USER || cloudStoredUser(); }
function cloudSetUser(u){
  CLOUD_USER = u ? { email: u.email || '', verified: !!u.emailVerified } : null;
  try{ if(CLOUD_USER) localStorage.setItem(CLOUD_USER_KEY, JSON.stringify(CLOUD_USER)); else localStorage.removeItem(CLOUD_USER_KEY); }catch(e){}
}
function cloudCanSync(){ const u = cloudUserNow(); return !!(u && u.verified); }
function cloudLoadSdk(){
  if(!CLOUD_SDK_LOAD){
    CLOUD_SDK_LOAD = (async ()=>{
      if(typeof firebase === 'undefined'){
        const v = '10.12.2';
        await loadScriptOnce(`https://www.gstatic.com/firebasejs/${v}/firebase-app-compat.js`);
        await loadScriptOnce(`https://www.gstatic.com/firebasejs/${v}/firebase-auth-compat.js`);
        await loadScriptOnce(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore-compat.js`);
      }
      if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      // Keeps the saved account note in step if the login ends elsewhere (password changed, account removed).
      firebase.auth().onAuthStateChanged(u=>{
        if(!CLOUD_AUTH_KNOWN) return; // the first answer is handled by cloudAuthRestore
        cloudSetUser(u && !u.isAnonymous ? u : null);
        updateSyncBadge();
      });
    })().catch(e=>{ CLOUD_SDK_LOAD = null; throw e; }); // a failed load (no signal) is retried next time, not remembered
  }
  return CLOUD_SDK_LOAD;
}
// Waits for Firebase to restore the saved login from the phone's storage (no network needed), then
// hands back that user or null. An old anonymous session is signed out here and treated as signed out.
async function cloudAuthRestore(){
  await cloudLoadSdk();
  const auth = firebase.auth();
  if(!CLOUD_AUTH_KNOWN){
    await new Promise(resolve=>{
      let off = null, done = false;
      const finish = ()=>{ if(done) return; done = true; try{ if(off) off(); }catch(e){} resolve(); };
      off = auth.onAuthStateChanged(finish);
      setTimeout(finish, 8000);
    });
    CLOUD_AUTH_KNOWN = true;
  }
  let user = auth.currentUser;
  if(user && user.isAnonymous){ try{ await auth.signOut(); }catch(e){} user = null; }
  return user;
}
// The Firestore handle for a signed-in, email-verified account — otherwise throws an error carrying
// cloudCode 'signedout' or 'unverified', which cloudFail() turns into the matching status.
async function cloudSdkReady(){
  let user = await cloudAuthRestore();
  if(user && !user.emailVerified && !cloudOffline()){
    // The person may have just tapped the link in their email — pick that up (and a fresh token) now.
    try{ await user.reload(); await user.getIdToken(true); user = firebase.auth().currentUser; }catch(e){}
  }
  cloudSetUser(user);
  if(!user) throw cloudErr('signedout', 'not signed in — sign in under Settings > Cloud Sync');
  if(!user.emailVerified) throw cloudErr('unverified', 'email not verified yet');
  return firebase.firestore();
}
// One place that turns a failed cloud call into a status the person can act on.
function cloudFail(e){
  console.error(e);
  if(e && e.cloudCode === 'signedout'){ setCloudStatus('signedout'); return; }
  if(e && e.cloudCode === 'unverified'){ setCloudStatus('unverified'); return; }
  if(e && (e.code === 'permission-denied' || /insufficient permissions/i.test(e.message || ''))){
    setCloudStatus('error', "this account isn't approved for this ledger — ask the owner to approve your email"); return;
  }
  setCloudStatus('error', e && e.message ? e.message : 'unknown error');
}
const cloudDocRef = db => db.collection('sync').doc('ledger');

// ---- Cloud permissions record ------------------------------------------------------------------
// One Firestore document, config/access, that says who owns the ledger and who has been approved.
//   { ownerEmail, approved: { "<lowercase email>": { expiresAt: <ms since 1970>, write: <true|false>, addedAt: <ms> } }, updatedAt }
// `approved` is a map keyed by email (not an array) because Firestore rules can look a key up but cannot
// search an array. It starts empty. Only the owner's verified account can read or change it (see
// CLOUD_FIRESTORE_RULE). The rule reads it to decide who may view (an unexpired entry) and who may also
// write (write:true); the app's own screens for approving people come in a later step.
const cloudAccessRef = db => db.collection('config').doc('access');
function cloudAccessNewRecord(nowMs){
  return { ownerEmail: CLOUD_OWNER_EMAIL, approved: {}, updatedAt: new Date(nowMs || Date.now()).toISOString() };
}
// True only for the signed-in, email-verified owner account.
function cloudIsOwner(){
  const u = cloudUserNow();
  return !!(u && u.verified && String(u.email || '').trim().toLowerCase() === CLOUD_OWNER_EMAIL);
}
// Owner only: makes sure the record exists (creates it empty the first time). Best effort and quiet — a
// failure (rules not updated yet, no signal) never disturbs syncing and is simply tried again next start.
async function cloudEnsureAccessRecord(db){
  try{
    if(!cloudIsOwner() || cloudOffline()) return;
    if(localStorage.getItem(CLOUD_ACCESS_OK_KEY) === CLOUD_OWNER_EMAIL) return;
    const ref = cloudAccessRef(db);
    const snap = await ref.get();
    if(!snap.exists) await ref.set(cloudAccessNewRecord());
    localStorage.setItem(CLOUD_ACCESS_OK_KEY, CLOUD_OWNER_EMAIL);
  }catch(e){ console.error(e); }
}

let CLOUD_LAST_CHECK_AT = 0;     // when a cloud check last started (start-up, Sync Now, or coming back to the app)
function cloudLastOkMs(){ try{ const n = Number(localStorage.getItem(CLOUD_LAST_OK_KEY)); return n > 0 ? n : 0; }catch(e){ return 0; } }
// "just now" / "5 min ago" / "3 h ago" / a date once it is over a day old.
function cloudAgoText(ms, now){
  const m = Math.floor(((now || Date.now()) - ms) / 60000);
  if(m < 1) return 'just now';
  if(m < 60) return m + ' min ago';
  if(m < 1440) return Math.floor(m / 60) + ' h ago';
  return new Date(ms).toLocaleDateString();
}
// Same thing squeezed for the header pill: "now", "5m", "3h", "2d".
function cloudAgoShort(ms, now){
  const m = Math.floor(((now || Date.now()) - ms) / 60000);
  if(m < 1) return 'now';
  if(m < 60) return m + 'm';
  if(m < 1440) return Math.floor(m / 60) + 'h';
  return Math.floor(m / 1440) + 'd';
}
// Small pill in the header (above the version): sync state at a glance. Hidden when Cloud Sync is
// off or the app is still locked.
function updateSyncBadge(){
  const el = document.getElementById('syncBadge');
  if(!el) return;
  try{
    if(!cloudSyncEnabled() || (typeof encEnabled === 'function' && encEnabled() && !ENC_DEK)){ el.hidden = true; return; }
    const ok = cloudLastOkMs();
    let t, warn = false;
    if(CLOUD_STATUS === 'syncing') t = '\u21BB Syncing';
    else if(CLOUD_STATUS === 'offline'){ t = '\u26A0 Offline'; warn = true; }
    else if(CLOUD_STATUS === 'error'){ t = '\u26A0 Sync error'; warn = true; }
    else if(CLOUD_STATUS === 'conflict'){ t = '\u26A0 Conflict'; warn = true; }
    else if(CLOUD_STATUS === 'waiting'){ t = '\u25CF New data'; warn = true; }
    else if(CLOUD_STATUS === 'signedout'){ t = '\u26A0 Sign in'; warn = true; }
    else if(CLOUD_STATUS === 'unverified'){ t = '\u26A0 Verify email'; warn = true; }
    else if(!cloudUserNow()){ t = '\u26A0 Sign in'; warn = true; }
    else t = ok ? ('\u2601 ' + cloudAgoShort(ok)) : '\u2601 Not synced';
    el.textContent = t;
    el.classList.toggle('warn', warn);
    const tip = cloudStatusText();
    el.title = tip; el.setAttribute('aria-label', 'Cloud sync: ' + tip);
    el.hidden = false;
  }catch(e){ el.hidden = true; }
}
function setCloudStatus(status, err){
  CLOUD_STATUS = status; CLOUD_LAST_ERROR = err || '';
  if(status === 'synced'){ try{ localStorage.setItem(CLOUD_LAST_OK_KEY, String(Date.now())); }catch(e){} }
  const el = document.getElementById('cloudSyncStatus');
  if(el) el.textContent = cloudStatusText();
  updateSyncBadge();
  const conflictWrap = document.getElementById('cloudSyncConflict');
  if(conflictWrap) conflictWrap.style.display = status === 'conflict' ? 'block' : 'none';
}
function cloudStatusText(){
  if(CLOUD_STATUS === 'syncing') return 'Syncing…';
  if(CLOUD_STATUS === 'offline') return 'Offline — will sync once back online';
  if(CLOUD_STATUS === 'waiting') return 'New data from another device is waiting — tap Sync Now to review it';
  if(CLOUD_STATUS === 'conflict') return "Another device has changes this device hasn't seen — pick which copy to keep below";
  if(CLOUD_STATUS === 'error') return 'Sync error: ' + CLOUD_LAST_ERROR;
  if(CLOUD_STATUS === 'signedout') return 'Not signed in — sign in below to sync. The ledger on this phone works as usual.';
  if(CLOUD_STATUS === 'unverified') return 'Email not verified yet — open the link we emailed you, then tap "I\'ve verified" below.';
  const ok = cloudLastOkMs();
  if(ok) return 'Synced ' + cloudAgoText(ok);
  let t = null; try{ t = localStorage.getItem(CLOUD_LAST_SEEN_KEY); }catch(e){}
  return t ? ('Last synced ' + new Date(t).toLocaleString()) : 'Not synced yet';
}
// Keeps \"Synced 2 min ago\" (Settings card) and the header pill ticking while the app is open.
function cloudRefreshAgo(){
  if(CLOUD_STATUS === 'synced' || CLOUD_STATUS === 'idle'){
    const el = document.getElementById('cloudSyncStatus');
    if(el && cloudSyncEnabled()) el.textContent = cloudStatusText();
  }
  updateSyncBadge();
}
if(typeof setInterval === 'function') setInterval(cloudRefreshAgo, 30000);
// Coming back to the app (switching from another app, unlocking the phone): check the cloud again,
// at most once a minute so flicking between apps doesn't spam reads. Skips while locked, while a
// check is running, while an \"Update / Merge\" prompt or a conflict is waiting for the person.
function cloudSyncOnForeground(){
  if(!cloudSyncEnabled() || CLOUD_PENDING_PULL || CLOUD_STATUS === 'syncing' || CLOUD_STATUS === 'conflict' || CLOUD_STATUS === 'signedout') return; // signed out: nothing to check until the person signs in
  if(typeof encEnabled === 'function' && encEnabled() && !ENC_DEK) return;
  if(Date.now() - CLOUD_LAST_CHECK_AT < CLOUD_CHECK_COOLDOWN_MS) return;
  cloudSyncCheckOnStart();
}
if(typeof document !== 'undefined' && document.addEventListener){
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible') cloudSyncOnForeground(); });
}
async function cloudCurrentHash(){ return sha256Hex(JSON.stringify(DATA)); }

let CLOUD_PUSH_TIMER = null;
// Called from save() (core.js) after every change — debounced so a burst of edits sends one
// push a few seconds after the user stops, not one push per keystroke/field.
function cloudSyncSchedule(){
  if(!cloudSyncEnabled() || CLOUD_PENDING_PULL) return; // never auto-push over cloud data the person hasn't accepted yet
  if(!cloudCanSync()) return; // signed out or email not verified: entries just stay on this phone until then
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
  }catch(e){ cloudFail(e); }
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
// same record edited on two devices) keeps the more recently edited copy (see Edit stamps below);
// when that can't be told, this device's copy wins. Additions are never discarded, which was the
// real risk with whole-document last-write-wins.
// ---- Deletion tracking -------------------------------------------------------------------------
// A merge keeps every record either device has, so on its own a record you DELETED on one device
// would come straight back from the other. So every save notes which records disappeared since the
// previous save: DATA.deletedIds = { listName: { recordId: deletedAtMs } }. That note travels with
// the ledger (cloud copy, backups) and mergeLedgers applies it — a deletion made on either device
// stays deleted after a merge. Notes older than a year are dropped (a device left offline longer
// than that could bring an old record back). Only lists whose records all carry an id are tracked.
const TOMB_KEEP_MS = 365 * 86400000;
let TOMB_BASE = null; // {listName: [ids]} as of the last save/load; null = just re-baseline on the next save
function tombIdsNow(){
  const o = {};
  Object.keys(DATA).forEach(k=>{
    const a = DATA[k];
    if(k === 'deletedIds' || !Array.isArray(a)) return;
    if(!a.every(r=> r && typeof r === 'object' && r.id != null)) return;
    o[k] = a.map(r=> String(r.id));
  });
  return o;
}
// ---- Edit stamps -------------------------------------------------------------------------------
// When the SAME record was edited on both devices, a merge keeps the more recently edited one.
// Every save stamps the records that changed since the previous save with _mt (edit time, ms).
// Records never edited since this feature arrived have no _mt; a stamped one beats an unstamped one,
// and when neither (or both with equal times) can be told apart this device's copy wins, as before.
let REC_BASE = null; // {listName: {id: JSON of the record without _mt}} as of the last save/load
function recSigsNow(){
  const o = {};
  Object.keys(DATA).forEach(k=>{
    const a = DATA[k];
    if(k === 'deletedIds' || !Array.isArray(a)) return;
    if(!a.every(r=> r && typeof r === 'object' && r.id != null)) return;
    const m = o[k] = {};
    a.forEach(r=>{ const c = Object.assign({}, r); delete c._mt; m[String(r.id)] = JSON.stringify(c); });
  });
  return o;
}
function recStampEdits(){
  const now = recSigsNow();
  if(REC_BASE){
    const t = Date.now();
    Object.keys(now).forEach(k=>{
      const base = REC_BASE[k];
      if(!base) return;
      DATA[k].forEach(r=>{
        const old = base[String(r.id)], cur = now[k][String(r.id)];
        if(old !== undefined && old !== cur) r._mt = t; // existing record whose contents changed
      });
    });
  }
  REC_BASE = now;
}
function tombRebaseline(){ try{ TOMB_BASE = tombIdsNow(); REC_BASE = recSigsNow(); }catch(e){ TOMB_BASE = null; REC_BASE = null; } }
// Call right BEFORE a save that replaces the whole ledger (restore, cloud pull, merge): the records
// that vanish then are not "deleted by the person", so they must not be noted as deletions.
function tombResetBaseline(){ TOMB_BASE = null; REC_BASE = null; }
function tombRecordDeletions(){
  try{ recStampEdits(); }catch(e){ /* best effort */ }
  const now = tombIdsNow();
  const t = (DATA.deletedIds && typeof DATA.deletedIds === 'object' && !Array.isArray(DATA.deletedIds)) ? DATA.deletedIds : null;
  let tomb = t;
  if(TOMB_BASE){
    Object.keys(TOMB_BASE).forEach(k=>{
      if(!now[k]) return;
      const cur = new Set(now[k]);
      TOMB_BASE[k].forEach(id=>{
        if(!cur.has(id)){
          if(!tomb) tomb = {};
          (tomb[k] = tomb[k] || {})[id] = Date.now();
        }
      });
    });
  }
  if(tomb){
    const cutoff = Date.now() - TOMB_KEEP_MS;
    Object.keys(tomb).forEach(k=>{
      const cur = now[k] ? new Set(now[k]) : null;
      Object.keys(tomb[k] || {}).forEach(id=>{
        if(cur && cur.has(id)) delete tomb[k][id];       // the record is back (Undo) — no longer deleted
        else if(!(tomb[k][id] > cutoff)) delete tomb[k][id]; // old enough to forget
      });
      if(!Object.keys(tomb[k] || {}).length) delete tomb[k];
    });
    if(Object.keys(tomb).length) DATA.deletedIds = tomb; else delete DATA.deletedIds; // no empty leftovers
  }
  TOMB_BASE = now;
}
function mergeTombstones(a, b){
  const out = {};
  [a, b].forEach(src=>{
    if(!src || typeof src !== 'object') return;
    Object.keys(src).forEach(k=>{
      Object.keys(src[k] || {}).forEach(id=>{
        (out[k] = out[k] || {})[id] = Math.max(Number((out[k] || {})[id]) || 0, Number(src[k][id]) || 0);
      });
    });
  });
  return out;
}

function mergeLedgers(local, remote){
  const out = {};
  const tomb = mergeTombstones(local && local.deletedIds, remote && remote.deletedIds);
  new Set([...Object.keys(local||{}), ...Object.keys(remote||{})]).forEach(k=>{
    if(k === 'deletedIds') return;
    const a = local[k], b = remote[k];
    if(Array.isArray(a) || Array.isArray(b)){
      const map = new Map();
      (b||[]).forEach(r=> r && r.id!=null && map.set(r.id, r));
      (a||[]).forEach(r=>{
        if(!r || r.id==null) return;
        const o = map.get(r.id);
        if(o && (Number(o._mt) || 0) > (Number(r._mt) || 0)) return; // the other device edited it more recently
        map.set(r.id, r); // otherwise (newer here, or can't tell) this device's copy wins
      });
      let list = Array.from(map.values());
      if(tomb[k]) list = list.filter(r=> !Object.prototype.hasOwnProperty.call(tomb[k], String(r.id))); // deleted on either device
      out[k] = list;
    } else if(a && typeof a==='object'){
      out[k] = Object.assign({}, b||{}, a); // local keys win on collision, union otherwise
    } else {
      out[k] = a!==undefined ? a : b;
    }
  });
  if(Object.keys(tomb).length) out.deletedIds = tomb;
  return out;
}
// What a merge brought in, for the confirmation notice: compares this device's ledger with the merged
// result by record id — new records per list (\"+3 sales\"), records that changed, and records removed
// because the other device deleted them. Returns '' when nothing differs.
const MERGE_LIST_NAMES = { sale:['sale','sales'], recovery:['payment','payments'], production:['production entry','production entries'], expense:['expense','expenses'], warp:['warp entry','warp entries'], weft:['weft entry','weft entries'], wagePayments:['wage payment','wage payments'], wageBonuses:['wage bonus','wage bonuses'], wageSettlements:['wage settlement','wage settlements'], loanPayments:['loan payment','loan payments'], warpBeams:['warp beam','warp beams'], clients:['client','clients'], employees:['employee','employees'], qualities:['quality','qualities'], looms:['loom','looms'], banks:['bank','banks'], family:['family entry','family entries'], personal:['personal entry','personal entries'], personalLoans:['personal loan','personal loans'], familyMembers:['family member','family members'], checkpoints:['checkpoint','checkpoints'] };
function mergeSummaryText(before, merged){
  const added = [], changed = [], removed = [];
  Object.keys(merged || {}).forEach(k=>{
    const m = merged[k], b = before && before[k];
    if(k === 'deletedIds' || !Array.isArray(m) || !Array.isArray(b)) return;
    if(!m.every(r=> r && typeof r === 'object' && r.id != null) || !b.every(r=> r && typeof r === 'object' && r.id != null)) return;
    const old = new Map(b.map(r=> [String(r.id), r]));
    const now = new Set(m.map(r=> String(r.id)));
    let a = 0, c = 0, d = 0;
    m.forEach(r=>{
      const o = old.get(String(r.id));
      if(!o) a++;
      else if(JSON.stringify(o) !== JSON.stringify(r)) c++;
    });
    b.forEach(r=>{ if(!now.has(String(r.id))) d++; });
    const name = n => { const p = MERGE_LIST_NAMES[k] || [k, k]; return n === 1 ? p[0] : p[1]; };
    if(a) added.push('+' + a + ' ' + name(a));
    if(c) changed.push(c + ' ' + name(c));
    if(d) removed.push(d + ' ' + name(d));
  });
  const parts = [];
  if(added.length) parts.push(added.slice(0, 4).join(', ') + (added.length > 4 ? ' and ' + (added.length - 4) + ' more kinds' : ''));
  if(changed.length) parts.push('updated: ' + changed.slice(0, 3).join(', ') + (changed.length > 3 ? ' …' : ''));
  if(removed.length) parts.push('removed (deleted on the other device): ' + removed.slice(0, 3).join(', ') + (removed.length > 3 ? ' …' : ''));
  return parts.join(' · ');
}
// Sync notice: deliberately looks nothing like the "App updated" bar (dark teal, bottom, full width)
// or the generic toast (dark grey pill, bottom) — it's a blue pill at the TOP of the screen with a
// sync icon, so "your data changed from another device" is never mistaken for a version update.
let _syncNoticeTimer = null;
// onUndo (optional) adds an Undo button and keeps the notice up longer.
function showSyncNotice(msg, onUndo){
  let el = document.getElementById('syncNotice');
  if(!el){
    el = document.createElement('div');
    el.id = 'syncNotice';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:50%;top:calc(10px + env(safe-area-inset-top,0px));transform:translateX(-50%);max-width:min(92vw,420px);z-index:100000;background:#2F6F52;color:#fff;border-radius:18px;padding:9px 16px;display:flex;align-items:center;gap:10px;box-shadow:0 6px 24px rgba(0,0,0,.3);font-size:13.5px;line-height:1.3;cursor:pointer';
    el.onclick = ()=> el.remove();
    document.body.appendChild(el);
  }
  el.textContent = '\u21BB  ' + msg;
  if(onUndo){
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Undo';
    b.style.cssText = 'background:#fff;color:#2F6F52;border:0;border-radius:999px;padding:5px 12px;font-weight:800;font-size:13.5px';
    b.onclick = (ev)=>{ ev.stopPropagation(); el.remove(); onUndo(); };
    el.appendChild(b);
  }
  clearTimeout(_syncNoticeTimer);
  _syncNoticeTimer = setTimeout(()=>{ if(el.parentNode) el.remove(); }, onUndo ? 10000 : 4000);
}
// ---- Safety point + Undo for applying cloud data -----------------------------------------------
// Before cloud data replaces or merges into this device's ledger, a copy of the current ledger is
// filed as a Safety copy ("Before a cloud sync" in Backup & Restore, survives closing the app) and
// kept in memory for the Undo button on the confirmation notice. Undo puts the ledger back and
// leaves the cloud data "waiting" (no automatic push until Sync Now / next start re-checks it), so
// undoing can never overwrite the other device's newer data.
async function cloudTakeSafetyPoint(){
  const json = JSON.stringify(DATA);
  try{ if(typeof snapAdd === 'function') await snapAdd('before-sync', json); }catch(e){ /* best effort — Undo still works from memory */ }
  let seen = null, hash = null;
  try{ seen = localStorage.getItem(CLOUD_LAST_SEEN_KEY); hash = localStorage.getItem(CLOUD_LAST_HASH_KEY); }catch(e){}
  return { json, seen, hash };
}
async function cloudUndoApply(pt, remote, mode){
  try{
    CLOUD_PENDING_PULL = { remote, mode }; // blocks automatic pushes until the cloud data is reviewed again
    Object.keys(DATA).forEach(k=>{ delete DATA[k]; });
    Object.assign(DATA, JSON.parse(pt.json));
    tombResetBaseline();
    UNDO_SUPPRESS = true; UNDO_STACK.length = 0; updateUndoButton(); // the ledger-wide Undo list no longer matches
    await save();
    try{
      if(pt.seen == null) localStorage.removeItem(CLOUD_LAST_SEEN_KEY); else localStorage.setItem(CLOUD_LAST_SEEN_KEY, pt.seen);
      if(pt.hash == null) localStorage.removeItem(CLOUD_LAST_HASH_KEY); else localStorage.setItem(CLOUD_LAST_HASH_KEY, pt.hash);
    }catch(e){}
    setCloudStatus('waiting');
    switchTab(CURRENT_TAB || 'overview');
    showSyncNotice('Undone. Cloud data is still waiting — tap Sync Now to review it.');
  }catch(e){ console.error(e); setCloudStatus('error', e && e.message ? e.message : 'unknown error'); }
}
// Replaces DATA wholesale with a remote copy (mirrors load()'s own full-overwrite approach),
// saves it locally too, and updates the sync markers so this device now matches the cloud.
async function cloudApplyRemote(remote){
  const dec = await cloudDecryptRemote(remote);
  if(dec.error){ setCloudStatus('error', dec.error); return; }
  const json = dec.json;
  const parsed = JSON.parse(json);
  const pt = await cloudTakeSafetyPoint();
  Object.keys(DATA).forEach(k=>{ delete DATA[k]; });
  Object.assign(DATA, parsed);
  tombResetBaseline(); // whole ledger replaced — don't read the swap as deletions
  await save();
  try{ localStorage.setItem(CLOUD_LAST_SEEN_KEY, remote.savedAt); localStorage.setItem(CLOUD_LAST_HASH_KEY, await sha256Hex(json)); }catch(e){}
  CLOUD_PENDING_REMOTE = null;
  switchTab(CURRENT_TAB || 'overview');
  showSyncNotice('New data synced from the cloud', ()=> cloudUndoApply(pt, remote, 'pull'));
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
  el.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(10px + env(safe-area-inset-top,0px));z-index:100000;background:#B5541E;color:#fff;border-radius:12px;padding:16px 16px;display:flex;align-items:center;gap:10px;box-shadow:0 8px 28px rgba(0,0,0,.45);border:2px solid #fff;font-size:15px;font-weight:600';
  const msg = mode === 'merge'
    ? 'Another device has new changes too. Merge them with this device?'
    : 'New data from another device is available.';
  el.innerHTML = '<span style="flex:1">' + msg + '</span><button type="button" id="cloudAskGo" style="background:#fff;color:#B5541E;border:0;border-radius:8px;padding:10px 18px;font-weight:800;font-size:15px">' + (mode === 'merge' ? 'Merge' : 'Update') + '</button><button type="button" id="cloudAskLater" aria-label="Later" style="background:transparent;color:#fff;border:0;font-size:18px;padding:4px 8px">\u2715</button>';
  document.body.appendChild(el);
  try{ el.animate([{transform:'translateY(-120%)',opacity:0},{transform:'translateY(0)',opacity:1}], {duration:280, easing:'ease-out'}); }catch(_){}
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
        const pt = await cloudTakeSafetyPoint();
        const merged = mergeLedgers(DATA, JSON.parse(dec.json));
        const summary = mergeSummaryText(DATA, merged);
        Object.assign(DATA, merged);
        tombResetBaseline(); // records the merge dropped were deleted elsewhere — not new deletions here
        await save();
        CLOUD_PENDING_REMOTE = null;
        await cloudPushNow(); // share the merged result back so the other device converges too
        switchTab(CURRENT_TAB || 'overview');
        showSyncNotice(summary ? ('Merged from the other device: ' + summary) : 'Merged — nothing new from the other device', ()=> cloudUndoApply(pt, pending.remote, 'merge'));
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
  CLOUD_LAST_CHECK_AT = Date.now();
  CLOUD_PENDING_PULL = null; // re-evaluated from scratch on every check (also what "Sync Now" does)
  const oldBar = document.getElementById('cloudAskBar'); if(oldBar) oldBar.remove();
  if(encEnabled() && !ENC_DEK) return; // still locked — afterUnlockLoad() calls this again once unlocked
  if(navigator.onLine === false){ setCloudStatus('offline'); return; }
  setCloudStatus('syncing');
  try{
    const db = await cloudSdkReady();
    cloudEnsureAccessRecord(db); // owner only; runs alongside the sync check, never blocks it
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
  }catch(e){ cloudFail(e); }
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
  }catch(e){ cloudFail(e); }
}

// --- Settings card ---
function cloudAccountHtml(){
  const u = cloudUserNow();
  const link = 'background:none;border:0;padding:8px 0;color:inherit;text-decoration:underline;font-size:13px;cursor:pointer';
  const msg = '<p class="note" id="cloudAuthMsg" role="status" style="margin:8px 0 0;color:var(--rust)"></p>';
  const wrap = inner => `<div style="border-top:1px solid var(--field-border);padding-top:12px">${inner}</div>`;
  const draft = escHtml(CLOUD_AUTH_DRAFT || '');
  const emailField = `<input type="email" id="cloudAuthEmail" placeholder="Email" value="${draft}" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" style="width:100%;margin-bottom:8px">`;
  if(u){
    const verify = u.verified ? '' : `<p class="note" style="margin:0 0 8px">We emailed a verification link to this address. Open it, then tap below.</p>
      <button class="ghost" id="cloudVerifiedBtn" type="button" style="width:100%;margin-bottom:8px">I've verified — continue</button>
      <button class="ghost" id="cloudResendBtn" type="button" style="width:100%;margin-bottom:8px">Resend verification email</button>`;
    const owner = cloudIsOwner() ? `<p class="note" style="margin:0 0 8px">Owner account${localStorage.getItem(CLOUD_ACCESS_OK_KEY) === CLOUD_OWNER_EMAIL ? ' — access list set up (no one approved yet).' : '.'}</p>` : '';
    return wrap(`<p class="note" style="margin:0 0 8px;font-weight:500">Signed in as ${escHtml(u.email)}</p>${owner}${verify}
      <button class="ghost" id="cloudSignOutBtn" type="button" style="width:100%">Sign out</button>${msg}`);
  }
  if(CLOUD_AUTH_MODE === 'signup'){
    return wrap(`<p class="note" style="margin:0 0 8px;font-weight:500">Create an account</p>${emailField}
      <input type="password" id="cloudAuthPw" placeholder="Password (at least ${CLOUD_MIN_PASSWORD} characters)" autocomplete="new-password" style="width:100%;margin-bottom:8px">
      <input type="password" id="cloudAuthPw2" placeholder="Repeat password" autocomplete="new-password" style="width:100%;margin-bottom:8px">
      <button class="ghost" id="cloudSignUpBtn" type="button" style="width:100%">Create account</button>
      <button type="button" id="cloudToSignInBtn" style="${link}">I already have an account</button>${msg}`);
  }
  if(CLOUD_AUTH_MODE === 'reset'){
    return wrap(`<p class="note" style="margin:0 0 8px;font-weight:500">Reset password</p>${emailField}
      <button class="ghost" id="cloudResetBtn" type="button" style="width:100%">Email me a reset link</button>
      <button type="button" id="cloudToSignInBtn" style="${link}">Back to sign in</button>${msg}`);
  }
  return wrap(`<p class="note" style="margin:0 0 8px;font-weight:500">Sign in to sync</p>${emailField}
    <input type="password" id="cloudAuthPw" placeholder="Password" autocomplete="current-password" style="width:100%;margin-bottom:8px">
    <button class="ghost" id="cloudSignInBtn" type="button" style="width:100%">Sign in</button>
    <div style="display:flex;justify-content:space-between;gap:12px">
      <button type="button" id="cloudToSignUpBtn" style="${link}">Create account</button>
      <button type="button" id="cloudToResetBtn" style="${link}">Forgot password?</button>
    </div>${msg}`);
}
function cloudSyncSection(){
  const on = cloudSyncEnabled();
  const head = `<div class="card-head"><h2>Cloud Sync</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>Keeps this ledger in sync with other devices through a private Firebase project set up just for this business. Two one-time steps are needed in that project's own console before this will work: turn on <b>Email/Password</b> sign-in (Build → Authentication → Sign-in method), and set the Firestore security rule below (Build → Firestore Database → Rules), so only the owner, and people the owner has approved (until their expiry), can use the ledger, and only the owner can change the approvals.</p>
    <pre class="info-note" hidden style="white-space:pre-wrap;background:var(--paper-dim);padding:10px;border-radius:8px;font-size:12px;margin:-4px 0 0">${escHtml(CLOUD_FIRESTORE_RULE)}</pre>`;
  return `<div class="card">${head}
    <label style="display:flex;align-items:center;gap:10px;font-weight:500;cursor:pointer">
      <input type="checkbox" id="cloudSyncToggle" ${on?'checked':''} style="width:18px;height:18px">
      Enable Cloud Sync
    </label>
    <p class="note" id="cloudSyncStatus" style="margin-top:10px">${on ? cloudStatusText() : 'Off — this device only.'}</p>
    <div id="cloudAccount" style="${on?'':'display:none'};margin-top:10px">${cloudAccountHtml()}</div>
    <div id="cloudSyncActions" style="${on && cloudCanSync() ? '' : 'display:none'}">
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
// ---- Account actions (email + password) -----------------------------------------------------------
function cloudAuthErrorText(e){
  const c = e && e.code ? String(e.code) : '';
  const map = {
    'auth/invalid-email': 'That email address doesn\'t look right.',
    'auth/missing-email': 'Enter your email address.',
    'auth/user-not-found': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/invalid-login-credentials': 'Email or password is incorrect.',
    'auth/email-already-in-use': 'An account with this email already exists — sign in instead, or use Forgot password.',
    'auth/weak-password': 'Choose a longer password (at least ' + CLOUD_MIN_PASSWORD + ' characters).',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection and try again.',
    'auth/operation-not-allowed': 'Email/Password sign-in is not switched on in the Firebase console yet (Authentication > Sign-in method).',
  };
  if(map[c]) return map[c];
  if(e && /^Could not load /.test(e.message || '')) return 'Could not reach the sign-in service. Connect to the internet and try again.';
  return e && e.message ? e.message : 'Something went wrong. Try again.';
}
async function cloudAuthSdk(){
  if(cloudOffline()) throw cloudErr('offline', 'You are offline — connect to the internet and try again.');
  await cloudAuthRestore();
  return firebase.auth();
}
// A new login replaces whatever the last sync state was; the next check decides what to pull or push.
function cloudAfterAuth(user){ cloudSetUser(user); CLOUD_AUTH_DRAFT = ''; CLOUD_AUTH_MODE = 'signin'; setCloudStatus('idle'); }
async function cloudSignIn(email, password){
  const auth = await cloudAuthSdk();
  const cred = await auth.signInWithEmailAndPassword(email, password);
  cloudAfterAuth(cred.user);
}
async function cloudSignUp(email, password){
  const auth = await cloudAuthSdk();
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  try{ await cred.user.sendEmailVerification(); }catch(e){ console.error(e); } // "Resend" is on the screen if this one fails
  cloudAfterAuth(cred.user);
}
async function cloudResetPassword(email){
  const auth = await cloudAuthSdk();
  await auth.sendPasswordResetEmail(email);
}
async function cloudResendVerification(){
  const auth = await cloudAuthSdk();
  if(!auth.currentUser) throw cloudErr('signedout', 'Sign in first.');
  await auth.currentUser.sendEmailVerification();
}
// Signing out only stops syncing on this phone: the ledger stays here, nothing is deleted anywhere.
async function cloudSignOut(){
  clearTimeout(CLOUD_PUSH_TIMER);
  CLOUD_PENDING_PULL = null; CLOUD_PENDING_REMOTE = null;
  const bar = document.getElementById('cloudAskBar'); if(bar) bar.remove();
  await cloudAuthRestore(); // signing out is local, so it needs no signal once the SDK is on the phone's cache
  await firebase.auth().signOut();
  cloudSetUser(null);
  setCloudStatus('signedout');
}
function wireCloudAccountCard(){
  const $ = id => document.getElementById(id);
  const val = id => ($(id) || {}).value || '';
  const say = (t, ok)=>{ const el = $('cloudAuthMsg'); if(el){ el.textContent = t || ''; el.style.color = ok ? 'inherit' : 'var(--rust)'; } };
  const run = async (btn, fn)=>{
    if(btn) btn.disabled = true; say('');
    try{ await fn(); }catch(e){ console.error(e); say(cloudAuthErrorText(e)); }
    if(btn) btn.disabled = false;
  };
  const mode = m => ()=>{ CLOUD_AUTH_DRAFT = val('cloudAuthEmail').trim(); CLOUD_AUTH_MODE = m; switchTab('settings'); };
  if($('cloudToSignUpBtn')) $('cloudToSignUpBtn').onclick = mode('signup');
  if($('cloudToResetBtn')) $('cloudToResetBtn').onclick = mode('reset');
  if($('cloudToSignInBtn')) $('cloudToSignInBtn').onclick = mode('signin');
  const inBtn = $('cloudSignInBtn');
  if(inBtn) inBtn.onclick = ()=> run(inBtn, async ()=>{
    const email = val('cloudAuthEmail').trim(), pw = val('cloudAuthPw');
    if(!email || !pw){ say('Enter your email and password.'); return; }
    await cloudSignIn(email, pw);
    await cloudSyncCheckOnStart();
    switchTab('settings');
  });
  const upBtn = $('cloudSignUpBtn');
  if(upBtn) upBtn.onclick = ()=> run(upBtn, async ()=>{
    const email = val('cloudAuthEmail').trim(), pw = val('cloudAuthPw'), pw2 = val('cloudAuthPw2');
    if(!email){ say('Enter your email address.'); return; }
    if(pw.length < CLOUD_MIN_PASSWORD){ say('Choose a password of at least ' + CLOUD_MIN_PASSWORD + ' characters.'); return; }
    if(pw !== pw2){ say("The two passwords don't match."); return; }
    await cloudSignUp(email, pw);
    await cloudSyncCheckOnStart();
    switchTab('settings');
  });
  const resetBtn = $('cloudResetBtn');
  if(resetBtn) resetBtn.onclick = ()=> run(resetBtn, async ()=>{
    const email = val('cloudAuthEmail').trim();
    if(!email){ say('Enter your email address.'); return; }
    await cloudResetPassword(email);
    say('If an account exists for that address, a reset link is on its way. Check your inbox (and spam).', true);
  });
  const verifiedBtn = $('cloudVerifiedBtn');
  if(verifiedBtn) verifiedBtn.onclick = ()=> run(verifiedBtn, async ()=>{
    await cloudSyncCheckOnStart(); // reloads the account and its token, then syncs if the address is now verified
    if(CLOUD_STATUS === 'unverified'){ say("Not verified yet. Open the link in the email first, then tap again."); return; }
    switchTab('settings');
  });
  const resendBtn = $('cloudResendBtn');
  if(resendBtn) resendBtn.onclick = ()=> run(resendBtn, async ()=>{ await cloudResendVerification(); say('Verification email sent again.', true); });
  const outBtn = $('cloudSignOutBtn');
  if(outBtn){
    let armed = null; // native confirm() is blocked in places, so: tap once to arm, tap again to sign out
    outBtn.onclick = ()=>{
      if(!armed){
        outBtn.textContent = 'Tap again to sign out';
        armed = setTimeout(()=>{ armed = null; outBtn.textContent = 'Sign out'; }, 4000);
        return;
      }
      clearTimeout(armed); armed = null;
      run(outBtn, async ()=>{ await cloudSignOut(); switchTab('settings'); });
    };
  }
}
function wireCloudSyncCard(){
  wireCloudAccountCard();
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
