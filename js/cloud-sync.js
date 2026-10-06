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
 * Model: shared Firestore documents for the whole business (not one per device) - since Release 3
 * one document per SECTION in the "ledger" collection, see "Sections" below - together holding
 * exactly what the local ledger holds — the same encrypted blob as local storage if Settings >
 * Encrypt Data is on, plain JSON otherwise (see ledgerToStorage in encryption.js for the
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
// who may do what is DATA in config/access (below), so approving, expiring, or changing someone's role or
// sections never needs a rule change. An entry counts only while its expiresAt is in the future (a missing
// expiresAt means expired). Per section (Release 3): a person may read a section only if their `perms` for it
// contain v, and write it only if they contain a, e or d AND the entry has write:true (the edit switch).
// The owner's own vault and the people's key bundles (keys/...) are readable by the owner and, for a bundle,
// by that one person; only the owner writes them. The old whole-ledger document (sync/ledger) is the
// owner's alone: an approved person can read only their own small note (sync/grant-...).
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

    // config/access = { ownerEmail, approved: { "<lowercase email>": { expiresAt: <ms>, write: <true|false>,
    //                   perms: { "<section>": "<letters v a e d>" } } } }
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
    function grantPerms() {
      return grants()[me()].get('perms', {});
    }
    function canSee(sec) {
      return isApproved() && grantPerms().get(sec, '').matches('.*v.*');
    }
    function canChange(sec) {
      return mayWrite() && grantPerms().get(sec, '').matches('.*[aed].*');
    }
    // Version 3.17.29: a section the owner marked \"Needs my approval\" for this person can only change through the owner (who applies an accepted\n    // proposal with their own save), so the cloud now refuses the person's own direct write there, whatever their phone believes.
    function needsApproval(sec) {
      return grants()[me()].get('needsApproval', {}).get(sec, false) == true;
    }
    // A section that is encrypted in the cloud can never be sent back as plain text by an approved person.
    function keepsEncryption() {
      return resource == null
        || resource.data.get('encrypted', false) == false
        || request.resource.data.get('encrypted', false) == true;
    }

    // The ledger, one document per section (production, sales, wages ...). ledger/manifest and any section a
    // person has no letters for stay the owner's alone.
    match /ledger/{sec} {
      allow read: if isOwner() || canSee(sec);
      allow create, update: if isOwner() || (canChange(sec) && !needsApproval(sec) && keepsEncryption());
      allow delete: if isOwner();
    }

    // Encryption keys: the owner's vault (keys/<owner email>) and one bundle per approved person, holding
    // only the keys of the sections their role may view, sealed with their access code.
    match /keys/{email} {
      allow read: if isOwner() || (isApproved() && me() == email);
      allow write: if isOwner();
    }

    // The old whole-ledger copy and the small notes that tell a phone about its own edit access.
    match /sync/{doc} {
      allow read: if isOwner() || (isApproved() && doc.matches('grant-.*'));
      allow create, update, delete: if isOwner();
    }

    // The audit trail: one document per change, written by the person who made it (or by the owner). Only the owner
    // reads it. Nobody can edit an entry - sending the very same entry again (after a dropped connection) is the
    // only update allowed - and only the owner can delete one. Entries are accepted for a person who is on the
    // list even if their access has just ended (their phone may only be getting its queue out), but never dated
    // after that access ended, never in the future and never more than a year back.
    // Version 3.17.29: only someone who has a letter to ADD / EDIT / DELETE in that section (view alone is not enough) may send an entry or proposal,\n    // and the letter must fit the action.
    function mayLog(sec, action) {
      return signedIn() && me() in grants()
        && ((action == 'add' && grantPerms().get(sec, '').matches('.*a.*'))
         || (action == 'edit' && grantPerms().get(sec, '').matches('.*e.*'))
         || (action == 'delete' && grantPerms().get(sec, '').matches('.*d.*')));
    }
    function loggedBeforeEnd() {
      return request.resource.data.ct <= grants()[me()].get('expiresAt', 0) + 600000;
    }
    match /audit/{id} {
      allow read: if isOwner();
      allow create: if isOwner()
        || (mayLog(request.resource.data.section, request.resource.data.action)
            && request.resource.data.by == me()
            && loggedBeforeEnd()
            && request.resource.data.keys().hasOnly(['by','ct','section','action','list','recId','encrypted','kv','payload'])
            && request.resource.data.ct is number
            && request.resource.data.ct <= request.time.toMillis() + 300000
            && request.resource.data.ct > request.time.toMillis() - 31622400000
            && request.resource.data.action in ['add','edit','delete']
            && request.resource.data.list is string
            && request.resource.data.recId is string
            && request.resource.data.payload is string
            && request.resource.data.payload.size() < 200000);
      allow update: if isOwner()
        || (signedIn() && resource.data.by == me() && request.resource.data == resource.data);
      allow delete: if isOwner();
    }

    // The permissions record: only the owner reads or edits it, and it can never be deleted.
    match /config/access {
      allow read: if isOwner();
      allow create, update: if isOwner()
        && request.resource.data.ownerEmail == '${CLOUD_OWNER_EMAIL}';
      allow delete: if false;
    }

    // Proposals: a change by a person who needs the owner's approval, kept until the owner answers. The person who made it
    // sends it (status pending) and can read it back, and withdraw it while it is still pending. Only the owner answers
    // (sets the status and a note) or deletes one. Nobody else can read it.
    match /proposals/{id} {
      allow read: if isOwner() || (signedIn() && (resource == null || resource.data.by == me()));
      allow create: if isOwner()
        || (mayLog(request.resource.data.section, request.resource.data.action)
            && request.resource.data.by == me()
            && request.resource.data.status == 'pending'
            && loggedBeforeEnd()
            && request.resource.data.keys().hasOnly(['by','ct','section','action','list','recId','status','encrypted','kv','payload'])
            && request.resource.data.ct is number
            && request.resource.data.ct <= request.time.toMillis() + 300000
            && request.resource.data.ct > request.time.toMillis() - 31622400000
            && request.resource.data.action in ['add','edit','delete']
            && request.resource.data.list is string
            && request.resource.data.recId is string
            && request.resource.data.payload is string
            && request.resource.data.payload.size() < 200000);
      allow update: if isOwner()
        || (signedIn() && resource.data.by == me() && request.resource.data == resource.data);
      allow delete: if isOwner()
        || (signedIn() && (resource == null || (resource.data.by == me() && resource.data.status == 'pending')));
    }
  }
}`;



// True on a view-only phone (js/view-only.js, loaded after this file); false anywhere that file is absent.
function cloudViewOnly(){ try{ return typeof viewOnly === 'function' && viewOnly(); }catch(e){ return false; } }
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
  if(typeof viewOnlyNoteUser === 'function') viewOnlyNoteUser(u); // a verified non-owner account makes this phone view-only (view-only.js)
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
    if(typeof waOnPermissionDenied === 'function') waOnPermissionDenied(); // a phone that thought it could edit checks whether that grant is gone
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
// write (write:true). The owner approves, extends and removes people from Settings > Cloud Sync (the
// People card in Settings, cloudPeople* below); the Firebase console is never needed for that.
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

// ---- Approving people (owner only) ---------------------------------------------------------------
// Pure helpers first (they take a record and return a new one, touching nothing), then the read-change-save
// step, then the Settings block. Approve to view makes someone VIEW-ONLY (write:false); an entry that already
// says write:true keeps that when its date is changed. Edit access is given with "Approve to edit" or the Allow edit button (Release 2).
const CLOUD_EXTEND_DAYS = 30;
const CLOUD_DEFAULT_APPROVAL_DAYS = 30;
function cloudAccessNormEmail(raw){
  const e = String(raw || '').trim().toLowerCase();
  if(!e) throw new Error('Enter their email address.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("That email address doesn't look right.");
  if(e === CLOUD_OWNER_EMAIL) throw new Error('That is your own account - it never needs approving.');
  return e;
}
// "2027-01-12" -> the last moment of that day on this phone's clock, in ms. Must be in the future.
function cloudAccessParseDate(str, nowMs){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || '').trim());
  if(!m) throw new Error('Pick the date the approval ends.');
  const ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999).getTime();
  if(!(ms > (nowMs || Date.now()))) throw new Error('The end date must be after today.');
  return ms;
}
// yyyy-mm-dd for the date field: today + N days on this phone's clock.
function cloudAccessDefaultDate(nowMs, days){
  const d = new Date((nowMs || Date.now()) + (days || CLOUD_DEFAULT_APPROVAL_DAYS) * 86400000);
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
// yyyy-mm-ddThh:mm for the date-and-time field: now + N days on this phone's clock.
function cloudAccessDefaultDateTime(nowMs, days){
  const d = new Date((nowMs || Date.now()) + (days || CLOUD_DEFAULT_APPROVAL_DAYS) * 86400000);
  const p = n => (n < 10 ? '0' : '') + n;
  return cloudAccessDefaultDate(nowMs, days) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
// How long an approval may last at most (10 years) - a typo like 999999 days is refused, not saved.
const CLOUD_MAX_APPROVAL_DAYS = 3650;
const CLOUD_UNIT_MS = { minutes: 60000, hours: 3600000, days: 86400000 };
// "45", 'minutes' -> 2700000 (ms). Whole numbers of 1 or more only.
function cloudAccessDuration(unit, amount){
  const per = CLOUD_UNIT_MS[unit];
  if(!per) throw new Error('Choose minutes, hours or days.');
  const t = String(amount == null ? '' : amount).trim();
  if(!/^\d+$/.test(t) || Number(t) < 1) throw new Error('Enter a whole number of ' + unit + ' (1 or more).');
  return Number(t) * per;
}
// The owner's choice -> the moment the approval ends, in ms. unit is 'minutes' | 'hours' | 'days' (amount is
// a whole number of them, counted from now) or 'until' (a date and time picked on this phone's clock).
function cloudAccessExpiry(unit, amount, untilStr, nowMs){
  const now = nowMs || Date.now();
  const cap = now + CLOUD_MAX_APPROVAL_DAYS * 86400000;
  let ms;
  if(unit === 'until'){
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(untilStr || '').trim());
    if(!m) throw new Error('Pick the date and time the approval ends.');
    ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0).getTime();
    if(!(ms > now)) throw new Error('The end time must be in the future.');
  }else{
    ms = now + cloudAccessDuration(unit, amount);
  }
  if(!(ms <= cap)) throw new Error('That is more than 10 years - choose a shorter time.');
  return ms;
}
function cloudAccessApproved(rec){ return Object.assign({}, (rec && rec.approved) || {}); }
function cloudAccessTouch(rec, approved, nowMs){
  return Object.assign({}, rec, { ownerEmail: CLOUD_OWNER_EMAIL, approved, updatedAt: new Date(nowMs || Date.now()).toISOString() });
}
// Approve someone to view until expiresAt, or change the date of someone already on the list.
// write: true = may also edit until then (Approve to edit), false = view only, left out = keep what they had.
function cloudAccessApplyApprove(rec, email, expiresAt, nowMs, write, role){
  const e = cloudAccessNormEmail(email);
  const approved = cloudAccessApproved(rec);
  const old = approved[e];
  const w = write === undefined ? !!(old && old.write === true) : write === true;
  const roles = cloudRolesOf(rec);
  if(role !== undefined && !roles[role]) throw new Error('Choose a role for them.');
  const patch = { expiresAt, write: w, addedAt: (old && old.addedAt) || nowMs || Date.now() };
  if(role !== undefined && (!old || old.role !== role)){ patch.role = role; patch.overrides = null; } // a different role starts clean
  approved[e] = cloudAccessBuildEntry(old && { role: old.role, overrides: old.overrides, needsApproval: old.needsApproval, kc: old.kc }, patch, roles); // kc = version of their access code (js/section-keys.js), kept; needsApproval = the owner's per-section switches, kept
  return { record: cloudAccessTouch(rec, approved, nowMs), email: e, updated: !!old, write: w, role: approved[e].role };
}
// A new access code for someone (js/section-keys.js): the old code stops opening their keys. Nothing else changes.
function cloudAccessApplyNewCode(rec, email, nowMs){
  const e = String(email || '').trim().toLowerCase();
  const approved = cloudAccessApproved(rec);
  const old = approved[e];
  if(!old) throw new Error('That person is no longer on the list.');
  approved[e] = Object.assign({}, old, { kc: (Number(old.kc) > 0 ? Math.floor(Number(old.kc)) : 1) + 1 });
  return { record: cloudAccessTouch(rec, approved, nowMs), email: e };
}
// Change someone's role. Their overrides are cleared (the new role applies as it is); edit switch and end time stay.
function cloudAccessApplySetRole(rec, email, role, nowMs){
  const e = String(email || '').trim().toLowerCase();
  const roles = cloudRolesOf(rec);
  if(!roles[role]) throw new Error('Choose a role for them.');
  const approved = cloudAccessApproved(rec);
  const old = approved[e];
  if(!old) throw new Error('That person is no longer on the list.');
  approved[e] = cloudAccessBuildEntry(old, { role, overrides: null }, roles);
  return { record: cloudAccessTouch(rec, approved, nowMs), email: e, role, roleLabel: roles[role].label };
}
// Set what someone may do in each section (the full map from the screen). Only the differences from their
// role are kept as overrides, so later changes to the preset still reach everyone who hasn't been adjusted.
// `approval` (optional): the "Needs approval" switches from the same screen, {section: true/false}; left out = unchanged.
function cloudAccessApplySetPerms(rec, email, wanted, nowMs, approval){
  const e = String(email || '').trim().toLowerCase();
  const approved = cloudAccessApproved(rec);
  const old = approved[e];
  if(!old) throw new Error('That person is no longer on the list.');
  if(!old.role) throw new Error('Choose a role for them first.');
  Object.keys(wanted || {}).forEach(id=>{ if(cloudSectionIds().indexOf(id) < 0) throw new Error('Unknown section: ' + id); });
  const roles = cloudRolesOf(rec);
  const base = cloudPermsFor(old.role, null, roles), want = cloudPermsClean(wanted), overrides = {};
  cloudSectionIds().forEach(id=>{ if((want[id] || '') !== (base[id] || '')) overrides[id] = want[id] || ''; });
  const patch = { overrides };
  if(approval !== undefined){
    Object.keys(approval || {}).forEach(id=>{ if(cloudSectionIds().indexOf(id) < 0) throw new Error('Unknown section: ' + id); });
    patch.needsApproval = cloudNeedsApprovalClean(approval);
  }
  approved[e] = cloudAccessBuildEntry(old, patch, roles);
  return { record: cloudAccessTouch(rec, approved, nowMs), email: e, perms: approved[e].perms, overrides, needsApproval: approved[e].needsApproval || {} };
}
// ---- Creating, editing and deleting roles (owner) --------------------------------------------------------
// A role is a name plus what it allows in each section. Saving a role recomputes the stored permissions of
// everyone who has it (their overrides stay on top), and returns their emails so their notes are re-sent.
const CLOUD_ROLE_NAME_MAX = 40;
function cloudAccessRecompute(approved, roles, roleId){
  const emails = [];
  Object.keys(approved).forEach(e=>{
    if(approved[e] && approved[e].role === roleId){ approved[e] = cloudAccessBuildEntry(approved[e], {}, roles); emails.push(e); }
  });
  return emails;
}
function cloudRoleSlug(label){ return String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'role'; }
// id null = create a new role; otherwise edit that one (built-in presets too: the edit is kept in the record and can be reset).
function cloudAccessApplyRoleSave(rec, id, label, perms, nowMs){
  const name = String(label || '').trim();
  if(!name) throw new Error('Give the role a name.');
  if(name.length > CLOUD_ROLE_NAME_MAX) throw new Error('Keep the role name under ' + CLOUD_ROLE_NAME_MAX + ' letters.');
  Object.keys(perms || {}).forEach(k=>{ if(cloudSectionIds().indexOf(k) < 0) throw new Error('Unknown section: ' + k); });
  const roles = cloudRolesOf(rec);
  if(id === 'custom') throw new Error('That role cannot be changed.');
  if(id && !roles[id]) throw new Error('That role no longer exists.');
  Object.keys(roles).forEach(k=>{ if(k !== id && roles[k].label.toLowerCase() === name.toLowerCase()) throw new Error('There is already a role called ' + roles[k].label + '.'); });
  if(!id){
    const t = (nowMs || Date.now()).toString(36);
    id = 'r-' + cloudRoleSlug(name) + '-' + t;
    while(roles[id] || CLOUD_ROLES[id]) id += 'x';
  }
  const stored = Object.assign({}, (rec && rec.roles) || {});
  stored[id] = { label: name, perms: cloudPermsClean(perms) };
  const next = Object.assign({}, rec, { roles: stored });
  const newRoles = cloudRolesOf(next);
  const approved = cloudAccessApproved(next);
  const emails = cloudAccessRecompute(approved, newRoles, id);
  return { record: cloudAccessTouch(next, approved, nowMs), id, emails, email: emails[0] };
}
// Delete a role you made (refused while anyone has it), or reset an edited built-in preset to its original.
function cloudAccessApplyRoleDelete(rec, id, nowMs){
  const roles = cloudRolesOf(rec);
  if(id === 'custom') throw new Error('That role cannot be removed.');
  if(!roles[id]) throw new Error('That role no longer exists.');
  const approved = cloudAccessApproved(rec);
  const users = Object.keys(approved).filter(e=> approved[e] && approved[e].role === id);
  if(!roles[id].builtin && users.length) throw new Error(users.length + (users.length === 1 ? ' person has' : ' people have') + ' this role - give them another role first.');
  if(roles[id].builtin && !roles[id].modified) throw new Error('That is a built-in role and it has not been changed.');
  const stored = Object.assign({}, (rec && rec.roles) || {}); delete stored[id];
  const next = Object.assign({}, rec, { roles: stored });
  const emails = cloudAccessRecompute(approved, cloudRolesOf(next), id);
  return { record: cloudAccessTouch(next, approved, nowMs), id, emails, email: emails[0], reset: !!roles[id].builtin };
}
// Turn edit access on or off for someone already on the list; their end time is not touched, so edit access
// always ends with the approval. Refused if they are not on the list or their approval has already ended.
function cloudAccessApplySetWrite(rec, email, on, nowMs){
  const e = String(email || '').trim().toLowerCase();
  const now = nowMs || Date.now();
  const approved = cloudAccessApproved(rec);
  const old = approved[e];
  if(!old) throw new Error('That person is no longer on the list.');
  if(on && !(Number(old.expiresAt) > now)) throw new Error('Their approval has already ended - use Extend first, then allow editing.');
  approved[e] = cloudAccessBuildEntry(old, { write: on === true }, cloudRolesOf(rec));
  return { record: cloudAccessTouch(rec, approved, now), email: e, write: on === true, expiresAt: Number(old.expiresAt) || 0 };
}
// Move someone's end time. deltaMs > 0 extends (counted from the later of now and their end time, so an
// expired approval restarts from now); deltaMs < 0 shortens (must still leave the approval running - to cut
// access at once use Revoke). Their write flag and added-on time are kept.
function cloudAccessApplyShift(rec, email, deltaMs, nowMs){
  const e = String(email || '').trim().toLowerCase();
  const now = nowMs || Date.now();
  const approved = cloudAccessApproved(rec);
  const old = approved[e];
  if(!old) throw new Error('That person is no longer on the list.');
  const cur = Number(old.expiresAt) || 0;
  let next;
  if(deltaMs >= 0){
    next = Math.max(cur, now) + deltaMs;
    if(next > now + CLOUD_MAX_APPROVAL_DAYS * 86400000) throw new Error('That is more than 10 years - choose a shorter time.');
  }else{
    if(!(cur > now)) throw new Error('Their approval has already ended - there is nothing to shorten.');
    next = cur + deltaMs;
    if(!(next > now)) throw new Error('That would end it right now or sooner. Use Revoke to cut their access immediately.');
  }
  approved[e] = Object.assign({}, old, { expiresAt: next });
  return { record: cloudAccessTouch(rec, approved, now), email: e, expiresAt: next };
}
// Add days to someone's approval (kept for the +30 days style calls).
function cloudAccessApplyExtend(rec, email, nowMs, days){
  return cloudAccessApplyShift(rec, email, (days || CLOUD_EXTEND_DAYS) * 86400000, nowMs);
}
// Revoke: the person's entry is deleted, so Firebase's rules stop letting them in at their very next request.
function cloudAccessApplyRemove(rec, email, nowMs){
  const e = String(email || '').trim().toLowerCase();
  const approved = cloudAccessApproved(rec);
  if(!(e in approved)) throw new Error('That person is no longer on the list.');
  delete approved[e];
  return { record: cloudAccessTouch(rec, approved, nowMs), email: e };
}
// The list as the screen shows it: soonest-ending first, expired ones last.
function cloudAccessList(rec, nowMs){
  const now = nowMs || Date.now();
  return Object.keys((rec && rec.approved) || {}).map(email => {
    const a = rec.approved[email] || {};
    const expiresAt = Number(a.expiresAt) || 0;
    return { email, expiresAt, write: a.write === true, expired: !(expiresAt > now), role: cloudRolesOf(rec)[a.role] ? a.role : '', perms: cloudPermsFor(a.role, a.overrides, cloudRolesOf(rec)), overrides: a.overrides || null, needsApproval: cloudNeedsApprovalClean(a.needsApproval) };
  }).sort((a, b) => (a.expired - b.expired) || (a.expiresAt - b.expiresAt) || (a.email < b.email ? -1 : 1));
}
// Owner only: read the record, let `mutate` change it, save it. Nothing is written if `mutate` throws.
async function cloudAccessEdit(mutate){
  if(!cloudIsOwner()) throw new Error('Only the owner can change who is approved.');
  if(cloudOffline()) throw new Error('You are offline - connect to the internet and try again.');
  const db = await cloudSdkReady();
  const ref = cloudAccessRef(db);
  let out;
  if(typeof db.runTransaction === 'function'){ // read + write as one step, so two owner phones can't overwrite each other's change (or a revoke)
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      out = mutate(snap.exists ? snap.data() : cloudAccessNewRecord());
      tx.set(ref, out.record);
    });
  }else{
    const snap = await ref.get();
    out = mutate(snap.exists ? snap.data() : cloudAccessNewRecord());
    await ref.set(out.record);
  }
  try{ localStorage.setItem(CLOUD_ACCESS_OK_KEY, CLOUD_OWNER_EMAIL); }catch(e){}
  // Keep the small note that tells that person's phone about its own edit access in step (write-access.js).
  // The record above is the truth; if only the note fails, the caller is told (out.mirrorError).
  if(typeof waMirrorGrant === 'function'){
    for(const em of (out.emails && out.emails.length ? out.emails : (out.email ? [out.email] : []))){
      try{ await waMirrorGrant(db, em, (out.record.approved || {})[em] || null); }
      catch(e){ console.error(e); out.mirrorError = true; }
    }
  }
  // With encryption on, the keys follow the record (js/section-keys.js): each person's bundle holds only the
  // keys of sections they may view, and a section someone lost gets a new key. If that step fails the record
  // is still saved; the caller is warned and it is retried when the People card is opened again.
  if(typeof skReconcile === 'function' && typeof encEnabled === 'function' && encEnabled()){
    try{
      const r = await skReconcile(db, out.record);
      if(r && r.rotated && r.rotated.length) out.rotated = r.rotated;
    }catch(e){ console.error(e); out.mirrorError = true; }
  }
  return out;
}
async function cloudAccessRead(){
  if(!cloudIsOwner()) throw new Error('Only the owner can see who is approved.');
  if(cloudOffline()) throw new Error('You are offline - connect to the internet and try again.');
  const db = await cloudSdkReady();
  const snap = await cloudAccessRef(db).get();
  return snap.exists ? snap.data() : cloudAccessNewRecord();
}
function cloudPeopleErrorText(e){
  if(e && (e.code === 'permission-denied' || /insufficient permissions/i.test(e.message || ''))) return "Firebase refused this. Check the rules shown under the i button above are pasted in the Firebase console.";
  return e && e.message ? e.message : 'Something went wrong. Try again.';
}
function cloudPeopleDateText(ms){ return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
function cloudPeopleDateTimeText(ms){ return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
// "12 days left", "5 hours left", "Expires within the hour" - how long an approval still has to run.
function cloudPeopleTimeLeft(expiresAt, nowMs){
  const left = (Number(expiresAt) || 0) - (nowMs || Date.now());
  if(!(left > 0)) return 'Expired';
  const HOUR = 3600000, DAYMS = 86400000;
  if(left < HOUR) return 'Expires within the hour';
  if(left < DAYMS){ const h = Math.floor(left / HOUR); return h + (h === 1 ? ' hour' : ' hours') + ' left'; }
  const d = Math.floor(left / DAYMS);
  return d + (d === 1 ? ' day' : ' days') + ' left';
}
const em0 = x => escHtml(x);
function cloudPermGridHtml(attr, key, perms){
  return cloudSectionIds().map(id=>{
    const l = (perms && perms[id]) || '';
    return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0"><span style="flex:1;min-width:0;font-size:14px">${escHtml(CLOUD_SECTION_LABELS[id])}</span>` +
      CLOUD_LETTERS.split('').map(c=> `<label style="display:flex;flex-direction:column;align-items:center;font-size:11px;width:30px"><input type="checkbox" ${attr}="${escHtml(key)}|${id}|${c}"${l.indexOf(c) >= 0 ? ' checked' : ''}>${c.toUpperCase()}</label>`).join('') + '</div>';
  }).join('');
}
// One "Needs approval" box per section for one person (Release 3). Saved together with the V / A / E / D boxes.
function cloudApprovalGridHtml(email, on){
  return cloudSectionIds().map(id=>
    `<label style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:14px"><input type="checkbox" data-cp-appr="${escHtml(email)}|${id}"${on && on[id] === true ? ' checked' : ''}><span style="flex:1;min-width:0">${escHtml(CLOUD_SECTION_LABELS[id])}</span></label>`
  ).join('');
}
// Reads one person's Needs approval boxes back into {section: true/false} (every section listed).
function cloudApprovalRead(box, email){
  const out = {};
  cloudSectionIds().forEach(id=>{ out[id] = false; });
  box.querySelectorAll('[data-cp-appr]').forEach(c => {
    const [k, id] = String(c.getAttribute('data-cp-appr')).split('|');
    if(k === email && id in out) out[id] = !!c.checked;
  });
  return out;
}
function cloudApprovalSummary(on){
  const ids = cloudSectionIds().filter(id=> on && on[id] === true);
  return ids.length ? 'Needs your approval: ' + ids.map(id=> CLOUD_SECTION_LABELS[id]).join(', ') : '';
}
function cloudRoleOptionsHtml(roles, selected){
  return Object.keys(roles).map(k=> `<option value="${escHtml(k)}"${selected === k ? ' selected' : ''}>${escHtml(roles[k].label)}</option>`).join('');
}
// Reads one grid's boxes back into {section: letters}; a section whose V box is off counts as none.
function cloudGridRead(box, attr, key){
  const want = {};
  box.querySelectorAll('[' + attr + ']').forEach(c => {
    const [k, id, l] = String(c.getAttribute(attr)).split('|');
    if(k !== key || !c.checked) return;
    want[id] = (want[id] || '') + l;
  });
  Object.keys(want).forEach(id => { if(want[id].indexOf('v') < 0) delete want[id]; });
  return want;
}
function cloudPeopleListHtml(rec, nowMs){
  const roles = cloudRolesOf(rec);
  const rows = cloudAccessList(rec, nowMs);
  if(!rows.length) return '<p class="note" style="margin:0 0 8px">No one is approved yet.</p>';
  return rows.map(r => {
    const roleName = r.role ? roles[r.role].label : 'No role yet';
    const what = r.expired ? ('Expired ' + cloudPeopleDateText(r.expiresAt)) : (roleName + ' \u00B7 ' + (r.write ? 'Can edit' : 'View only') + ' \u00B7 ' + cloudPeopleTimeLeft(r.expiresAt, nowMs) + ' (until ' + cloudPeopleDateTimeText(r.expiresAt) + ')');
    const eff = r.perms;
    const grid = cloudPermGridHtml('data-cp-perm', r.email, eff);
    const roleOpts = '<option value=""' + (r.role ? '' : ' selected') + ' disabled>Choose a role</option>' + cloudRoleOptionsHtml(roles, r.role);
    const em = escHtml(r.email);
    return `<div data-cp-row="${em}" style="padding:8px 0;border-bottom:1px solid var(--field-border)">
      <div style="font-weight:500;overflow-wrap:anywhere">${em}</div>
      <div class="note" style="margin:0 0 6px${r.expired ? ';color:var(--rust)' : ''}">${what}</div>
      <div class="note" style="margin:0 0 6px">${escHtml(cloudPermsSummary(eff))}${r.overrides ? ' (adjusted)' : ''}</div>
      ${cloudApprovalSummary(r.needsApproval) ? `<div class="note" style="margin:0 0 6px">${escHtml(cloudApprovalSummary(r.needsApproval))}</div>` : ''}
      <select data-cp-role="${em}" aria-label="Role" style="width:100%;margin-bottom:8px">${roleOpts}</select>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <button class="ghost" type="button" data-cp-access="${em}"${r.role ? '' : ' disabled'}>Sections</button>
        <button class="ghost" type="button" data-cp-open="extend" data-cp-email="${em}">Extend</button>
        <button class="ghost" type="button" data-cp-open="shorten" data-cp-email="${em}"${r.expired ? ' disabled' : ''}>Shorten</button>
        <button class="ghost" type="button" data-cp-write="${em}" data-cp-write-to="${r.write ? 'off' : 'on'}"${(!r.write && r.expired) ? ' disabled' : ''}>${r.write ? 'Stop edit' : 'Allow edit'}</button>
        ${(typeof encEnabled === 'function' && encEnabled() && !r.expired && Object.keys(r.perms || {}).length) ? `<button class="ghost" type="button" data-cp-code="${em}">Access code</button>` : ''}
        <button class="ghost" type="button" data-cp-revoke="${em}">Revoke</button>
      </div>
      <div data-cp-codebox="${em}" style="display:none;margin-top:8px"></div>
      <div data-cp-accesspanel="${em}" style="display:none;margin-top:8px">
        <div class="note" style="margin:0 0 4px">V view, A add, E edit, D delete. Add / edit / delete only work while their edit switch is on.</div>${grid}
        <div style="font-weight:500;margin-top:10px">Needs my approval</div>
        <div class="note" style="margin:0 0 4px">Tick a section and every add, edit or delete they make there waits for your OK. Only matters where they can add, edit or delete. Saved with Save access; Reset to role leaves it as it is.</div>${cloudApprovalGridHtml(r.email, r.needsApproval)}
        <div style="display:flex;gap:8px;margin-top:8px"><button class="ghost" type="button" data-cp-saveperms="${em}" style="flex:1">Save access</button><button class="ghost" type="button" data-cp-resetperms="${em}" style="flex:1">Reset to role</button></div>
      </div>
      <div data-cp-panel="${em}" style="display:none;margin-top:8px">
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <input type="number" data-cp-amount="${em}" min="1" step="1" value="1" inputmode="numeric" aria-label="How much" style="flex:1;min-width:0">
          <select data-cp-unit="${em}" aria-label="Unit" style="flex:2;min-width:0"><option value="minutes">minutes</option><option value="hours">hours</option><option value="days" selected>days</option></select>
        </div>
        <div style="display:flex;gap:8px">
          <button class="ghost" type="button" data-cp-apply="${em}" style="flex:1">Apply</button>
          <button class="ghost" type="button" data-cp-cancel="${em}" style="flex:1">Cancel</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
// ---- The Roles card (Settings, owner only) ---------------------------------------------------------------
function cloudRolesHtml(rec){
  const roles = cloudRolesOf(rec), approved = cloudAccessApproved(rec);
  const used = id => Object.keys(approved).filter(e=> approved[e] && approved[e].role === id).length;
  const rows = Object.keys(roles).map(id=>{
    const r = roles[id], n = used(id), eid = escHtml(id), editable = id !== 'custom';
    const tail = r.builtin ? (r.modified ? ' \u00B7 edited' : ' \u00B7 built in') : '';
    return `<div data-rl-row="${eid}" style="padding:8px 0;border-bottom:1px solid var(--field-border)">
      <div style="font-weight:500">${escHtml(r.label)}<span class="note" style="margin:0 0 0 6px">${n} ${n === 1 ? 'person' : 'people'}${tail}</span></div>
      <div class="note" style="margin:0 0 6px">${id === 'custom' ? 'Starts with nothing; you choose sections for each person.' : escHtml(cloudPermsSummary(r.perms))}</div>` +
      (editable ? `<div style="display:flex;flex-wrap:wrap;gap:8px">
        <button class="ghost" type="button" data-rl-edit="${eid}">Edit</button>
        <button class="ghost" type="button" data-rl-delete="${eid}"${(r.builtin && !r.modified) ? ' disabled' : ''}>${r.builtin ? 'Reset' : 'Delete'}</button>
      </div>
      <div data-rl-panel="${eid}" style="display:none;margin-top:8px">
        <input type="text" data-rl-name="${eid}" value="${escHtml(r.label)}" maxlength="${CLOUD_ROLE_NAME_MAX}" aria-label="Role name" style="width:100%;margin-bottom:6px">
        ${cloudPermGridHtml('data-rl-perm', id, r.perms)}
        <div style="display:flex;gap:8px;margin-top:8px"><button class="ghost" type="button" data-rl-save="${eid}" style="flex:1">Save role</button><button class="ghost" type="button" data-rl-cancel="${eid}" style="flex:1">Cancel</button></div>
      </div>` : '') + '</div>';
  }).join('');
  return rows + `<div style="margin-top:10px"><button class="ghost" type="button" data-rl-new="1">New role</button>
    <div data-rl-panel="new" style="display:none;margin-top:8px">
      <input type="text" data-rl-name="new" value="" maxlength="${CLOUD_ROLE_NAME_MAX}" placeholder="Role name" aria-label="Role name" style="width:100%;margin-bottom:6px">
      ${cloudPermGridHtml('data-rl-perm', 'new', {})}
      <div style="display:flex;gap:8px;margin-top:8px"><button class="ghost" type="button" data-rl-save="new" style="flex:1">Create role</button><button class="ghost" type="button" data-rl-cancel="new" style="flex:1">Cancel</button></div>
    </div></div>`;
}
function cloudRolesCardHtml(){
  return `<div class="card"><div class="card-head"><h2>Roles</h2></div><div id="cloudRoles">
    <p class="note" style="margin:0 0 8px">A role says what a person may see and do in each part of the ledger (V view, A add, E edit, D delete). Give it to someone under People, for as long as you choose. Editing a role changes everyone who has it, except the sections you adjusted for them one by one. Add / edit / delete only work while a person's edit switch is on.</p>
    <div id="cloudRolesList"><p class="note" style="margin:0 0 8px">Loading\u2026</p></div>
    <p class="note" id="cloudRolesMsg" role="status" style="margin:8px 0 0;color:var(--rust)"></p></div></div>`;
}
function cloudRolesSay(text, ok){
  const el = document.getElementById('cloudRolesMsg');
  if(el){ el.textContent = text || ''; el.style.color = ok ? 'inherit' : 'var(--rust)'; }
}
function cloudRolesFind(box, attr, key){
  const all = box.querySelectorAll('[' + attr + ']');
  for(let i = 0; i < all.length; i++) if(all[i].getAttribute(attr) === key) return all[i];
  return null;
}
function cloudRolesDraw(rec){
  const box = document.getElementById('cloudRolesList');
  if(!box) return;
  box.innerHTML = cloudRolesHtml(rec);
  const each = (sel, fn) => box.querySelectorAll(sel).forEach(fn);
  each('[data-rl-edit]', b => { b.onclick = () => { const pn = cloudRolesFind(box, 'data-rl-panel', b.getAttribute('data-rl-edit')); if(pn) pn.style.display = pn.style.display === 'none' ? 'block' : 'none'; }; });
  each('[data-rl-new]', b => { b.onclick = () => { const pn = cloudRolesFind(box, 'data-rl-panel', 'new'); if(pn) pn.style.display = pn.style.display === 'none' ? 'block' : 'none'; }; });
  each('[data-rl-cancel]', b => { b.onclick = () => { const pn = cloudRolesFind(box, 'data-rl-panel', b.getAttribute('data-rl-cancel')); if(pn) pn.style.display = 'none'; }; });
  each('[data-rl-save]', b => { b.onclick = () => cloudRolesSave(box, b, b.getAttribute('data-rl-save')); });
  each('[data-rl-delete]', b => { b.onclick = () => cloudRolesDelete(b, b.getAttribute('data-rl-delete')); });
}
async function cloudRolesSave(box, btn, key){
  btn.disabled = true; cloudRolesSay('');
  try{
    const nameEl = cloudRolesFind(box, 'data-rl-name', key);
    const perms = cloudGridRead(box, 'data-rl-perm', key);
    const out = await cloudAccessEdit(rec => cloudAccessApplyRoleSave(rec, key === 'new' ? null : key, nameEl ? nameEl.value : '', perms, Date.now()));
    cloudRolesSay((key === 'new' ? 'Role created. ' : 'Role saved. ') + (out.emails.length ? out.emails.length + (out.emails.length === 1 ? ' person' : ' people') + ' with it will pick up the change on their next sync.' : 'Nobody has it yet.') + (out.mirrorError ? CLOUD_MIRROR_WARNING : ''), true);
  }catch(e){ console.error(e); cloudRolesSay(cloudPeopleErrorText(e)); }
  btn.disabled = false; await cloudPeopleRefresh();
}
// Delete / Reset: tap once to arm, again to do it.
async function cloudRolesDelete(btn, id){
  if(!btn.__armed){
    const label = btn.textContent;
    btn.__armed = setTimeout(() => { btn.__armed = null; btn.textContent = label; }, 4000);
    btn.textContent = 'Tap again';
    return;
  }
  clearTimeout(btn.__armed); btn.__armed = null;
  btn.disabled = true; cloudRolesSay('');
  try{
    const out = await cloudAccessEdit(rec => cloudAccessApplyRoleDelete(rec, id, Date.now()));
    cloudRolesSay(out.reset ? 'Role reset to its original.' : 'Role deleted.', true);
  }catch(e){ console.error(e); cloudRolesSay(cloudPeopleErrorText(e)); }
  await cloudPeopleRefresh();
}
// The owner-only block, drawn inside the People card (Settings > People).
function cloudPeopleHtml(){
  return `<div id="cloudPeople">
    <p class="note" style="margin:0 0 8px">They create their own account first (Settings &gt; Cloud Sync &gt; Create account) and verify their email. Then approve that email here until a date. "Approve to view" lets them look at the ledger only; "Approve to edit" also lets them change it, until the same end time. Edit access can be turned on or off later for each person, and it always ends with the approval.</p>
    <div id="cloudPeopleList"><p class="note" style="margin:0 0 8px">Loading\u2026</p></div>
    <input type="email" id="cloudPeopleEmail" placeholder="Their email" autocomplete="off" inputmode="email" autocapitalize="off" spellcheck="false" style="width:100%;margin-bottom:8px">
    <label class="note" for="cloudPeopleAmount" style="display:block;margin:0 0 4px">Approved for</label>
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <input type="number" id="cloudPeopleAmount" min="1" step="1" value="${CLOUD_DEFAULT_APPROVAL_DAYS}" inputmode="numeric" style="flex:1;min-width:0">
      <select id="cloudPeopleUnit" aria-label="Unit" style="flex:2;min-width:0">
        <option value="minutes">minutes</option><option value="hours">hours</option><option value="days" selected>days</option><option value="until">until a date and time</option>
      </select>
    </div>
    <div id="cloudPeopleUntilRow" style="display:none;margin-bottom:8px">
      <input type="datetime-local" id="cloudPeopleUntil" value="${cloudAccessDefaultDateTime()}" style="width:100%">
    </div>
    <label class="note" for="cloudPeopleRole" style="display:block;margin:0 0 4px">Role</label>
    <select id="cloudPeopleRole" style="width:100%;margin-bottom:8px">${cloudRoleOptionsHtml(cloudRolesOf(null), 'business_viewer')}</select>
    <div style="display:flex;gap:8px">
      <button class="ghost" id="cloudPeopleAddBtn" type="button" style="flex:1">Approve to view</button>
      <button class="ghost" id="cloudPeopleEditBtn" type="button" style="flex:1">Approve to edit</button>
    </div>
    <p class="note" id="cloudPeopleMsg" role="status" style="margin:8px 0 0;color:var(--rust)"></p>
  </div>`;
}
// Its own card in Settings, shown only to the signed-in, email-verified owner (nobody else gets even the heading).
function cloudPeopleSection(){
  if(!cloudIsOwner()) return '';
  const u = cloudUserNow();
  if(!u || !u.verified) return '';
  return `<div class="card"><div class="card-head"><h2>People</h2></div>${cloudPeopleHtml()}</div>` + cloudRolesCardHtml();
}
async function cloudPeopleRefresh(reconcile){
  const box = document.getElementById('cloudPeopleList');
  if(!box) return;
  try{
    const rec = await cloudAccessRead();
    if(reconcile === true && typeof waMirrorAll === 'function') waMirrorAll(rec); // quietly re-sends each person's edit-access note (also covers entries set by hand)
    if(reconcile === true && typeof skReconcile === 'function' && typeof encEnabled === 'function' && encEnabled()){ // quietly brings the keys in step (retry, expired approvals)
      cloudSdkReady().then(d => skReconcile(d, rec)).catch(e => console.error(e));
    }
    const roleSel = document.getElementById('cloudPeopleRole');
    if(roleSel){ const keep = roleSel.value; roleSel.innerHTML = cloudRoleOptionsHtml(cloudRolesOf(rec), keep || 'business_viewer'); }
    cloudRolesDraw(rec);
    box.innerHTML = cloudPeopleListHtml(rec);
    box.querySelectorAll('[data-cp-open]').forEach(b => { b.onclick = () => cloudPeopleOpenPanel(box, b.getAttribute('data-cp-email'), b.getAttribute('data-cp-open')); });
    box.querySelectorAll('[data-cp-cancel]').forEach(b => { b.onclick = () => cloudPeopleClosePanel(box, b.getAttribute('data-cp-cancel')); });
    box.querySelectorAll('[data-cp-apply]').forEach(b => { b.onclick = () => cloudPeopleApplyPanel(box, b, b.getAttribute('data-cp-apply')); });
    box.querySelectorAll('[data-cp-write]').forEach(b => { b.onclick = () => cloudPeopleSetWrite(b, b.getAttribute('data-cp-write'), b.getAttribute('data-cp-write-to') === 'on'); });
    box.querySelectorAll('[data-cp-revoke]').forEach(b => { b.onclick = () => cloudPeopleAct(b, 'revoke'); });
    box.querySelectorAll('[data-cp-code]').forEach(b => { b.onclick = () => { if(typeof skPeopleCode === 'function') skPeopleCode(box, b.getAttribute('data-cp-code')); }; });
    box.querySelectorAll('[data-cp-role]').forEach(b => { b.onchange = () => cloudPeopleSetRole(b.getAttribute('data-cp-role'), b.value); });
    box.querySelectorAll('[data-cp-access]').forEach(b => { b.onclick = () => { const pn = cloudPeopleFind(box, 'data-cp-accesspanel', b.getAttribute('data-cp-access')); if(pn) pn.style.display = pn.style.display === 'none' ? 'block' : 'none'; }; });
    box.querySelectorAll('[data-cp-saveperms]').forEach(b => { b.onclick = () => cloudPeopleSavePerms(box, b, b.getAttribute('data-cp-saveperms')); });
    box.querySelectorAll('[data-cp-resetperms]').forEach(b => { b.onclick = () => cloudPeopleResetPerms(b, b.getAttribute('data-cp-resetperms')); });
  }catch(e){ console.error(e); box.innerHTML = `<p class="note" style="margin:0 0 8px;color:var(--rust)">${escHtml(cloudPeopleErrorText(e))}</p>`; }
}
// Added to a message when the person's own phone could not be told (the record itself was saved).
const CLOUD_MIRROR_WARNING = ' Warning: their phone could not be sent the change yet - it will still be refused by Firebase, and you can open this card again to retry.';
function cloudPeopleSay(text, ok){
  const el = document.getElementById('cloudPeopleMsg');
  if(el){ el.textContent = text || ''; el.style.color = ok ? 'inherit' : 'var(--rust)'; }
}
// Revoke: tap once to arm, again to do it. The person's entry is deleted from the permissions record, and
// Firebase's rules check that record on every request, so they are locked out at their very next one.
// Afterwards the record is read back to make sure they really are gone.
async function cloudPeopleAct(btn, what){
  const email = btn.getAttribute('data-cp-revoke');
  if(!btn.__armed){ // native confirm() is blocked in places: tap once to arm, again to revoke
    btn.__armed = setTimeout(() => { btn.__armed = null; btn.textContent = 'Revoke'; }, 4000);
    btn.textContent = 'Tap again';
    return;
  }
  clearTimeout(btn.__armed); btn.__armed = null;
  btn.disabled = true; cloudPeopleSay('');
  try{
    const out = await cloudAccessEdit(rec => cloudAccessApplyRemove(rec, email, Date.now()));
    const again = await cloudAccessRead();
    if(again && again.approved && out.email in again.approved) throw new Error('Could not confirm the revoke - ' + out.email + ' still shows on the list. Check your signal and try again.');
    cloudPeopleSay(out.email + ' revoked. Firebase stops letting them in from their next request. Their phone drops to view only by itself (within a minute if the app is open), keeps the last copy it downloaded, and files anything not yet synced as a safety copy.' + (out.mirrorError ? CLOUD_MIRROR_WARNING : ''), true);
  }catch(e){ console.error(e); cloudPeopleSay(cloudPeopleErrorText(e)); }
  await cloudPeopleRefresh();
}
// Extend / Shorten: open the small panel under the person (number + unit), then Apply.
// Find the element carrying attr="<email>" (compared as text, so odd characters in an address can't break a selector).
function cloudPeopleFind(box, attr, email){
  const all = box.querySelectorAll('[' + attr + ']');
  for(let i = 0; i < all.length; i++) if(all[i].getAttribute(attr) === email) return all[i];
  return null;
}
function cloudPeopleOpenPanel(box, email, mode){
  const panel = cloudPeopleFind(box, 'data-cp-panel', email);
  if(!panel) return;
  panel.style.display = 'block'; panel.setAttribute('data-cp-mode', mode);
  const amt = cloudPeopleFind(box, 'data-cp-amount', email), unit = cloudPeopleFind(box, 'data-cp-unit', email);
  if(amt) amt.value = mode === 'extend' ? String(CLOUD_EXTEND_DAYS) : '1';
  if(unit) unit.value = 'days';
  const apply = cloudPeopleFind(box, 'data-cp-apply', email);
  if(apply) apply.textContent = mode === 'extend' ? 'Extend' : 'Shorten';
}
function cloudPeopleClosePanel(box, email){
  const panel = cloudPeopleFind(box, 'data-cp-panel', email);
  if(panel) panel.style.display = 'none';
}
async function cloudPeopleApplyPanel(box, btn, email){
  const panel = cloudPeopleFind(box, 'data-cp-panel', email);
  const amt = cloudPeopleFind(box, 'data-cp-amount', email), unit = cloudPeopleFind(box, 'data-cp-unit', email);
  btn.disabled = true;
  await cloudPeopleAdjust(email, panel && panel.getAttribute('data-cp-mode') === 'shorten' ? 'shorten' : 'extend', amt ? amt.value : '', unit ? unit.value : 'days');
  btn.disabled = false;
}
// mode 'extend' | 'shorten'; amount + unit as typed. Writes only if the change is valid.
async function cloudPeopleAdjust(email, mode, amount, unit){
  cloudPeopleSay('');
  try{
    const now = Date.now();
    const ms = cloudAccessDuration(unit, amount);
    const out = await cloudAccessEdit(rec => cloudAccessApplyShift(rec, email, mode === 'shorten' ? -ms : ms, now));
    cloudPeopleSay(out.email + (mode === 'shorten' ? ' shortened' : ' extended') + ' by ' + String(amount).trim() + ' ' + unit + '. Now ends ' + cloudPeopleDateTimeText(out.expiresAt) + '.' + (out.mirrorError ? CLOUD_MIRROR_WARNING : ''), true);
  }catch(e){ console.error(e); cloudPeopleSay(cloudPeopleErrorText(e)); }
  await cloudPeopleRefresh();
}
// Allow edit / Stop edit for one person (their end time stays as it is).
async function cloudPeopleSetWrite(btn, email, on){
  btn.disabled = true; cloudPeopleSay('');
  try{
    const out = await cloudAccessEdit(rec => cloudAccessApplySetWrite(rec, email, on, Date.now()));
    cloudPeopleSay(on
      ? out.email + ' can now edit until ' + cloudPeopleDateTimeText(out.expiresAt) + '. Their phone switches to editing within a minute if the app is open, or when they tap Sync Now.' + (out.mirrorError ? CLOUD_MIRROR_WARNING : '')
      : out.email + ' is view only again. Their phone drops back within a minute if the app is open, and anything not yet synced is kept as a safety copy.' + (out.mirrorError ? CLOUD_MIRROR_WARNING : ''), true);
  }catch(e){ console.error(e); cloudPeopleSay(cloudPeopleErrorText(e)); }
  await cloudPeopleRefresh();
}
async function cloudPeopleSetRole(email, role){
  cloudPeopleSay('');
  try{
    const out = await cloudAccessEdit(rec => cloudAccessApplySetRole(rec, email, role, Date.now()));
    cloudPeopleSay(out.email + ' is now a ' + out.roleLabel + '.' + (out.mirrorError ? CLOUD_MIRROR_WARNING : ' Their phone picks it up on its next sync.'), true);
  }catch(e){ console.error(e); cloudPeopleSay(cloudPeopleErrorText(e)); }
  await cloudPeopleRefresh();
}
// The screen's V / A / E / D boxes for one person, as a full map. A section whose V box is off counts as none.
function cloudPeopleReadPerms(box, email){ return cloudGridRead(box, 'data-cp-perm', email); }
async function cloudPeopleSavePerms(box, btn, email){
  btn.disabled = true; cloudPeopleSay('');
  try{
    const want = cloudPeopleReadPerms(box, email), appr = cloudApprovalRead(box, email);
    const out = await cloudAccessEdit(rec => cloudAccessApplySetPerms(rec, email, want, Date.now(), appr));
    cloudPeopleSay(out.email + ' saved: ' + cloudPermsSummary(out.perms) + '.' + (cloudApprovalSummary(out.needsApproval) ? ' ' + cloudApprovalSummary(out.needsApproval) + '.' : '') + (out.mirrorError ? CLOUD_MIRROR_WARNING : ''), true);
  }catch(e){ console.error(e); cloudPeopleSay(cloudPeopleErrorText(e)); }
  btn.disabled = false; await cloudPeopleRefresh();
}
async function cloudPeopleResetPerms(btn, email){
  btn.disabled = true; cloudPeopleSay('');
  try{
    const out = await cloudAccessEdit(rec => { const r0 = cloudAccessApproved(rec)[String(email).trim().toLowerCase()]; if(!r0) throw new Error('That person is no longer on the list.'); return cloudAccessApplySetRole(rec, email, r0.role, Date.now()); });
    cloudPeopleSay(out.email + ' reset to the ' + out.roleLabel + ' role.' + (out.mirrorError ? CLOUD_MIRROR_WARNING : ''), true);
  }catch(e){ console.error(e); cloudPeopleSay(cloudPeopleErrorText(e)); }
  btn.disabled = false; await cloudPeopleRefresh();
}
// write === true: "Approve to edit". Anything else (including no argument): "Approve to view", which keeps
// whatever edit access the person already had.
async function cloudPeopleAdd(write){
  const canEdit = write === true;
  const btn = document.getElementById(canEdit ? 'cloudPeopleEditBtn' : 'cloudPeopleAddBtn');
  const val = id => (document.getElementById(id) || {}).value || '';
  if(btn) btn.disabled = true; cloudPeopleSay('');
  try{
    const now = Date.now();
    const email = val('cloudPeopleEmail'), until = cloudAccessExpiry(val('cloudPeopleUnit') || 'days', val('cloudPeopleAmount'), val('cloudPeopleUntil'), now);
    const out = await cloudAccessEdit(rec => cloudAccessApplyApprove(rec, email, until, now, canEdit ? true : undefined, val('cloudPeopleRole') || undefined));
    const box = document.getElementById('cloudPeopleEmail'); if(box) box.value = '';
    cloudPeopleSay(out.email + (out.updated ? ' updated' : ' approved') + (canEdit ? ' to edit' : '') + ' until ' + cloudPeopleDateTimeText(until) + '.' + (!canEdit && out.write ? ' They can still edit (use Stop edit on their row to make them view only).' : '') + ' Ask them to tap Sync Now on their phone.' + (out.mirrorError ? CLOUD_MIRROR_WARNING : ''), true);
  }catch(e){ console.error(e); cloudPeopleSay(cloudPeopleErrorText(e)); }
  if(btn) btn.disabled = false;
  await cloudPeopleRefresh();
}
// "until a date and time" swaps the number box for a date-and-time box.
function cloudPeopleSyncUnit(){
  const unit = document.getElementById('cloudPeopleUnit'), amount = document.getElementById('cloudPeopleAmount'), row = document.getElementById('cloudPeopleUntilRow');
  if(!unit || !amount || !row) return;
  const until = unit.value === 'until';
  amount.style.display = until ? 'none' : ''; row.style.display = until ? 'block' : 'none';
}
function wireCloudPeople(){
  const add = document.getElementById('cloudPeopleAddBtn');
  if(add) add.onclick = () => cloudPeopleAdd();
  const addEdit = document.getElementById('cloudPeopleEditBtn');
  if(addEdit) addEdit.onclick = () => cloudPeopleAdd(true);
  const unit = document.getElementById('cloudPeopleUnit');
  if(unit){ unit.onchange = cloudPeopleSyncUnit; cloudPeopleSyncUnit(); }
  if(document.getElementById('cloudPeopleList')) cloudPeopleRefresh(true);
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
    // Header pill: short states ("☁ now", "☁ 5m") show in full; long ones ("⚠ Verify email") collapse to just their icon so the
    // header never grows a third row. Tap it to read the full status.
    el.dataset.icon = t.charAt(0); el.classList.toggle('compact', t.length > 8);
    el.classList.toggle('warn', warn);
    const tip = cloudStatusText();
    el.title = tip; el.setAttribute('aria-label', 'Cloud sync: ' + tip);
    el.onclick = ()=>{ if(typeof showToast === 'function') showToast(tip); };
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
  if(ok) return 'Synced ' + cloudAgoText(ok) + (cloudViewOnly() ? ' (view only)' : '');
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

// ---- Sections (Release 3) ----------------------------------------------------------------------
// In the cloud the ledger is not one document any more but one document per SECTION, in the "ledger"
// collection (ledger/production, ledger/sales, ledger/wages ...). A phone reads and writes only the
// sections its account may see, so what a person is not allowed to see is never downloaded to their phone
// (Firestore's rules refuse the read - see the rules step of Release 3). The owner's phone holds and
// syncs every section. Which ledger keys live in which section is decided here and nowhere else:
// a key that is not listed goes to 'tools', which is owner-only, so a new key can never leak by accident.
const CLOUD_SECTIONS = [
  { id:'production', keys:['production','loomAssignments','warpBeams'] },
  { id:'reference',  keys:['qualities','looms','employees'] },
  { id:'sales',      keys:['sale','clients','dyeingUnits'] },
  { id:'recovery',   keys:['recovery','banks'] },
  { id:'expenses',   keys:['expense'] },
  { id:'wages',      keys:['wageBonuses','wagePayments','wageSettlements','wageRateHistory','staffSalary','wageFrom','wageTo'] },
  { id:'loans',      keys:['loanPayments'] },
  { id:'family',     keys:['family','personal','personalLoans','familyMembers'] },
  { id:'materials',  keys:['warp','weft','warpTypes','weftTypes'] },
  { id:'business',   keys:['businessInfo'] },
  { id:'stock',      keys:['stockSummary'] },   // calculated total + per-quality stock, written by the owner's phone only, so a person can be given Stock alone
  { id:'tools',      keys:['checkpoints','openingBalance','rateCalcs','rateCalcDefaults','costSettings','ownerLoans','stockValuations','fiscalOpenings'] },
];
const CLOUD_SECTION_FALLBACK = 'tools';
const CLOUD_KEY_SECTION = (()=>{ const m = {}; CLOUD_SECTIONS.forEach(sec=> sec.keys.forEach(k=>{ m[k] = sec.id; })); return m; })();
const CLOUD_SEC_SEEN_KEY = 'khata-cloud-sec-seen';     // {section: savedAt of the cloud copy this phone last matched}
const CLOUD_SEC_HASH_KEY = 'khata-cloud-sec-hash';     // {section: sha256 of that section as of the same moment}
const CLOUD_PERMS_KEY = 'khata-cloud-perms';           // {section: 'vaed'} - what a non-owner account may do, once it has been told
const CLOUD_KEYSIG_KEY = 'khata-cloud-keysig';         // which encryption setup the cloud sections were last written with
const CLOUD_MANIFEST_ID = 'manifest';                  // ledger/manifest: owner-only marker that the section layout is in use
const CLOUD_MANIFEST_OK_KEY = 'khata-cloud-manifest';  // owner email this phone last saw the manifest for
const cloudSecRef = (db, sec) => db.collection('ledger').doc(sec);
function cloudSectionIds(){ return CLOUD_SECTIONS.map(x=> x.id); }
function cloudSectionOf(key){ return CLOUD_KEY_SECTION[key] || CLOUD_SECTION_FALLBACK; }
// ---- Roles and per-section permissions (Release 3) -----------------------------------------------------
// Each approved person has a ROLE (a preset: which sections, and what they may do in each) plus optional
// per-person OVERRIDES on top of it. What a section allows is a string of letters: v = view, a = add,
// e = edit, d = delete (any of a / e / d implies v - you cannot change what you cannot see). The effective
// map {section: letters} is stored in the person's entry as `perms`, which the Firestore rules read.
// The letters a / e / d only count while the person's edit switch is on (the same switch and the same end
// time as Release 2: "Approve to edit" / "Allow edit" / "Stop edit"); with it off they are view-only.
// A person with no role (an entry made before roles existed) has no access until one is chosen.
const CLOUD_ROLES = {
  business_viewer:     { label: 'Business viewer',     perms: { production: 'v', reference: 'v', sales: 'v', recovery: 'v', business: 'v' } },
  production_operator: { label: 'Production operator', perms: { production: 'vae', reference: 'v', business: 'v' } },
  custom:              { label: 'Custom',              perms: {} },
};
const CLOUD_SECTION_LABELS = { production:'Production', reference:'Employees, looms, qualities', sales:'Sales & clients', recovery:'Recovery & cheques', expenses:'Expenses', wages:'Wages', loans:'Employee loans', family:'Family & personal', materials:'Warp & weft', business:'Business info', stock:'Stock (totals only)', tools:'Tools & settings' };
const CLOUD_LETTERS = 'vaed';
function cloudPermsCleanLetters(x){
  const have = {}; String(x || '').toLowerCase().split('').forEach(c=>{ if(CLOUD_LETTERS.indexOf(c) >= 0) have[c] = true; });
  if(have.a || have.e || have.d) have.v = true;
  return CLOUD_LETTERS.split('').filter(c=> have[c]).join('');
}
function cloudPermsClean(map){
  const out = {};
  cloudSectionIds().forEach(id=>{ const l = cloudPermsCleanLetters(map && map[id]); if(l) out[id] = l; });
  return out;
}
// The roles in force for a record: the built-in presets, with any the owner edited or created (record.roles).
// `custom` (start from nothing) is fixed. Each entry: { label, perms, builtin, modified }.
function cloudRolesOf(rec){
  const out = {};
  Object.keys(CLOUD_ROLES).forEach(id=>{ out[id] = { label: CLOUD_ROLES[id].label, perms: cloudPermsClean(CLOUD_ROLES[id].perms), builtin: true, modified: false }; });
  const stored = rec && rec.roles && typeof rec.roles === 'object' ? rec.roles : {};
  Object.keys(stored).forEach(id=>{
    if(id === 'custom' || !stored[id] || typeof stored[id] !== 'object') return;
    const label = String(stored[id].label || '').trim() || (CLOUD_ROLES[id] && CLOUD_ROLES[id].label) || id;
    out[id] = { label, perms: cloudPermsClean(stored[id].perms), builtin: !!CLOUD_ROLES[id], modified: !!CLOUD_ROLES[id] };
  });
  return out;
}
function cloudRoleBase(role, roles){ const m = roles || CLOUD_ROLES; return (m[role] && m[role].perms) || {}; }
// A role's permissions with a person's overrides laid over them (an override replaces that section; '' removes it).
function cloudPermsFor(role, overrides, roles){
  const base = cloudRoleBase(role, roles), out = {};
  cloudSectionIds().forEach(id=>{ out[id] = (overrides && Object.prototype.hasOwnProperty.call(overrides, id)) ? overrides[id] : base[id]; });
  return cloudPermsClean(out);
}
// What the person may actually do right now: edit letters count only while their edit switch is on.
function cloudPermsEffective(entry, roles){
  const p = cloudPermsFor(entry && entry.role, entry && entry.overrides, roles);
  if(entry && entry.write === true) return p;
  const out = {}; Object.keys(p).forEach(id=>{ if(p[id].indexOf('v') >= 0) out[id] = 'v'; });
  return out;
}
function cloudPermsCanWrite(perms){ return Object.keys(perms || {}).some(id=> /[aed]/.test(String(perms[id]))); }
function cloudPermsSummary(perms){
  const ids = Object.keys(cloudPermsClean(perms));
  return ids.length ? ids.map(id=> CLOUD_SECTION_LABELS[id] + ' ' + perms[id].toUpperCase()).join(', ') : 'no sections';
}
// "Needs approval" (Release 3): per person, the sections where every change they make (add, edit, delete) is to wait
// for the owner's OK. Stored as {section: true}; a section that is off is simply not listed.
function cloudNeedsApprovalClean(map){
  const out = {};
  cloudSectionIds().forEach(id=>{ if(map && map[id] === true) out[id] = true; });
  return out;
}
function cloudAccessBuildEntry(old, patch, roles){
  const e = Object.assign({}, old || {}, patch || {});
  e.role = (roles || CLOUD_ROLES)[e.role] ? e.role : '';
  if(e.overrides && Object.keys(e.overrides).length) e.overrides = Object.assign({}, e.overrides); else delete e.overrides;
  const na = cloudNeedsApprovalClean(e.needsApproval);
  if(Object.keys(na).length) e.needsApproval = na; else delete e.needsApproval;
  e.perms = cloudPermsEffective(e, roles);
  return e;
}
function cloudIsDenied(e){ return !!(e && (e.code === 'permission-denied' || /insufficient permissions/i.test(e.message || ''))); }

// Splits a whole ledger into one object per section. Every section is always present (possibly empty).
// Key order inside a section is fixed (known keys in the order above, then any unknown keys sorted, then
// deletedIds), so the same data always gives the same text and therefore the same hash on every phone.
// deletedIds (the deletion notes, see tombRecordDeletions) is divided by list name, so each section
// carries only the notes for its own lists.
function cloudSplit(data){
  const src = data || {}, parts = {};
  CLOUD_SECTIONS.forEach(sec=>{ parts[sec.id] = {}; });
  CLOUD_SECTIONS.forEach(sec=> sec.keys.forEach(k=>{ if(src[k] !== undefined) parts[sec.id][k] = src[k]; }));
  Object.keys(src).filter(k=> k !== 'deletedIds' && !CLOUD_KEY_SECTION[k]).sort().forEach(k=>{ parts[CLOUD_SECTION_FALLBACK][k] = src[k]; });
  // Stock summary: worked out from the full ledger, so only the owner's (or an unlimited) phone writes it.
  try{
    if(data === DATA && typeof computeStats === 'function' && (cloudIsOwner() || !cloudPermsKnown())){
      const st = computeStats('');
      parts.stock.stockSummary = { total: Math.round(st.stock * 100) / 100,
        byQuality: (st.stockByQuality || []).map(r=>({ name: r.name, stock: Math.round(r.stock * 100) / 100 })) };
    }
  }catch(e){}
  const tomb = src.deletedIds;
  if(tomb && typeof tomb === 'object' && !Array.isArray(tomb)){
    Object.keys(tomb).forEach(list=>{
      const part = parts[cloudSectionOf(list)];
      (part.deletedIds = part.deletedIds || {})[list] = tomb[list];
    });
  }
  return parts;
}
// The reverse: sections back into one ledger object.
function cloudJoin(parts){
  const out = {}, tomb = {};
  cloudSectionIds().forEach(id=>{
    const p = parts && parts[id]; if(!p) return;
    Object.keys(p).forEach(k=>{ if(k === 'deletedIds') Object.assign(tomb, p[k]); else out[k] = p[k]; });
  });
  if(Object.keys(tomb).length) out.deletedIds = tomb;
  return out;
}
// Number of records in a section (used only as a note beside the document).
function cloudSectionCount(part){
  let n = 0;
  Object.keys(part || {}).forEach(k=>{ if(k !== 'deletedIds' && Array.isArray(part[k])) n += part[k].length; });
  return n;
}
// Puts one section's data into the live ledger, replacing that section's keys and deletion notes and
// leaving every other section exactly as it is.
function cloudSetSection(sec, part){
  part = part || {};
  Object.keys(DATA).forEach(k=>{ if(k !== 'deletedIds' && cloudSectionOf(k) === sec) delete DATA[k]; });
  Object.keys(part).forEach(k=>{ if(k !== 'deletedIds') DATA[k] = part[k]; });
  const tomb = (DATA.deletedIds && typeof DATA.deletedIds === 'object' && !Array.isArray(DATA.deletedIds)) ? DATA.deletedIds : {};
  Object.keys(tomb).forEach(list=>{ if(cloudSectionOf(list) === sec) delete tomb[list]; });
  const mine = part.deletedIds || {};
  Object.keys(mine).forEach(list=>{ tomb[list] = mine[list]; });
  if(Object.keys(tomb).length) DATA.deletedIds = tomb; else delete DATA.deletedIds;
}

// Small maps kept in the phone's storage (section -> value).
function cloudMapGet(key){
  try{ const m = JSON.parse(localStorage.getItem(key) || 'null'); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; }
  catch(e){ return {}; }
}
function cloudMapSet(key, m){ try{ localStorage.setItem(key, JSON.stringify(m)); }catch(e){} }

// What this account may do with each section. The owner: everything. Anyone else: what the owner allowed
// (letters v = view, a = add, e = edit, d = delete), once this phone has been told; until then a phone
// tries to read every section and simply skips the ones Firebase refuses, and it sends nothing.
function cloudPermsKnown(){
  try{ const p = JSON.parse(localStorage.getItem(CLOUD_PERMS_KEY) || 'null'); return p && typeof p === 'object' && !Array.isArray(p) ? p : null; }
  catch(e){ return null; }
}
// Saving or clearing what this account may do: when it really changed, the drawer and the buttons are redrawn,
// and sections the account may no longer view are removed from this phone (view-only.js: permsPurgeHidden).
function cloudPermsChanged(){
  try{
    if(typeof permsPurgeHidden === 'function') Promise.resolve(permsPurgeHidden()).catch(e=> console.error(e)).then(()=>{ if(typeof switchTab === 'function' && typeof CURRENT_TAB !== 'undefined') switchTab(CURRENT_TAB || 'overview'); });
    else if(typeof switchTab === 'function' && typeof CURRENT_TAB !== 'undefined') switchTab(CURRENT_TAB || 'overview');
  }catch(e){ console.error(e); }
}
function cloudPermsSave(perms){
  let before = null; try{ before = localStorage.getItem(CLOUD_PERMS_KEY); }catch(e){}
  const next = JSON.stringify(cloudPermsClean(perms));
  try{ localStorage.setItem(CLOUD_PERMS_KEY, next); }catch(e){}
  if(before !== next) cloudPermsChanged();
}
function cloudPermsClear(){
  let before = null; try{ before = localStorage.getItem(CLOUD_PERMS_KEY); }catch(e){}
  try{ localStorage.removeItem(CLOUD_PERMS_KEY); }catch(e){}
  cloudApprovalClear();
  if(before !== null) cloudPermsChanged();
}
// "Needs approval" on this phone (Release 3): the sections where the owner wants every change from this account
// to wait for their OK. Told by the owner's note, like the permissions. The owner is never asked.
const CLOUD_APPROVAL_KEY = 'khata-cloud-needs-approval';  // {section: true}
function cloudApprovalKnown(){
  try{ const p = JSON.parse(localStorage.getItem(CLOUD_APPROVAL_KEY) || 'null'); return p && typeof p === 'object' && !Array.isArray(p) ? cloudNeedsApprovalClean(p) : {}; }
  catch(e){ return {}; }
}
function cloudApprovalSave(map){ try{ localStorage.setItem(CLOUD_APPROVAL_KEY, JSON.stringify(cloudNeedsApprovalClean(map))); }catch(e){} }
function cloudApprovalClear(){ try{ localStorage.removeItem(CLOUD_APPROVAL_KEY); }catch(e){} }
function cloudNeedsApproval(sec){ return !cloudIsOwner() && cloudApprovalKnown()[sec] === true; }
// ---- Sections wiped from THIS phone because another (limited) account signed in on it ---------------------
// permsPurgeHidden (view-only.js) empties the sections a limited account may not see. If the owner then signs in
// on the same phone, those empty sections look like the owner's own changes - and would be sent up over the real
// data. So the wiped sections are remembered here: they are never sent while listed, and the owner's next check
// brings them back from the cloud (cloudSectionsCheck), which also takes them off the list.
const CLOUD_PURGED_KEY = 'khata-purged-sections';
function cloudPurgedList(){ try{ const a = JSON.parse(localStorage.getItem(CLOUD_PURGED_KEY) || '[]'); return Array.isArray(a) ? a.filter(x=> typeof x === 'string') : []; }catch(e){ return []; } }
function cloudPurgedSave(a){ try{ if(a.length) localStorage.setItem(CLOUD_PURGED_KEY, JSON.stringify(a)); else localStorage.removeItem(CLOUD_PURGED_KEY); }catch(e){} }
function cloudPurgedAdd(sec){ const a = cloudPurgedList(); if(a.indexOf(sec) < 0){ a.push(sec); cloudPurgedSave(a); } }
function cloudPurgedClear(secs){ cloudPurgedSave(cloudPurgedList().filter(s=> secs.indexOf(s) < 0)); }
function cloudSectionPerm(sec){
  if(cloudIsOwner()) return 'vaed';
  const p = cloudPermsKnown();
  return p && typeof p[sec] === 'string' ? p[sec] : '';
}
function cloudCanViewSection(sec){ return cloudSectionPerm(sec).indexOf('v') >= 0; }
function cloudCanWriteSection(sec){ return /[aed]/.test(cloudSectionPerm(sec)) && !cloudNeedsApproval(sec); } // a section that needs approval is never sent by the person's own phone (the cloud rule refuses it too)
function cloudReadSections(){
  if(cloudIsOwner() || !cloudPermsKnown()) return cloudSectionIds();
  return cloudSectionIds().filter(cloudCanViewSection);
}
function cloudWriteSections(){ return cloudSectionIds().filter(cloudCanWriteSection); }
// Sections this account may change whose local copy differs from what was last sent / received.
// With `conservative` (used before filing a wind-down safety copy) a phone that was never told its sections
// counts all of them, so nothing could be lost by under-counting.
async function cloudUnsyncedSections(conservative){
  const parts = cloudSplit(DATA), hashes = cloudMapGet(CLOUD_SEC_HASH_KEY), out = [];
  const list = conservative && !cloudIsOwner() && !cloudPermsKnown() ? cloudSectionIds() : cloudWriteSections();
  for(const sec of list){
    if(hashes[sec] !== await sha256Hex(JSON.stringify(parts[sec]))) out.push(sec);
  }
  return out;
}
// Records "this phone matches the cloud" for the older whole-ledger markers (Release 2 uses them to
// decide whether a wound-down grant left unsynced entries). Only when nothing here is waiting to be sent.
async function cloudMarkSynced(newestSavedAt){
  try{
    if((await cloudUnsyncedSections()).length) return;
    localStorage.setItem(CLOUD_LAST_HASH_KEY, await cloudCurrentHash());
    if(newestSavedAt) localStorage.setItem(CLOUD_LAST_SEEN_KEY, newestSavedAt);
  }catch(e){ /* storage unavailable: the next check simply compares again */ }
}

let CLOUD_PUSH_TIMER = null;
// Called from save() (core.js) after every change — debounced so a burst of edits sends one
// push a few seconds after the user stops, not one push per keystroke/field.
function cloudSyncSchedule(){
  if(!cloudSyncEnabled() || CLOUD_PENDING_PULL) return; // never auto-push over cloud data the person hasn't accepted yet
  if(cloudViewOnly()) return; // a view-only phone only ever pulls
  if(!cloudCanSync()) return; // signed out or email not verified: entries just stay on this phone until then
  clearTimeout(CLOUD_PUSH_TIMER);
  CLOUD_PUSH_TIMER = setTimeout(cloudPushNow, 4000);
}
// The cloud document for one section (see cloudPushNow / cloudMigrateToSections). With encryption on, the
// payload is sealed with that section's own key (js/section-keys.js) and `kv` says which version of the key.
// It carries no keyWrap any more: the PIN-locked key lives only in the owner's vault (keys/<owner>).
async function cloudBuildSectionDoc(sec, part, json, meta, who){
  const enc = !!encEnabled(); let payload = json, kv = 0;
  if(enc){
    if(typeof skSealSection === 'function'){ const sealed = await skSealSection(sec, json); payload = sealed.payload; kv = sealed.kv; }
    else payload = await encSeal(json);
  }else if(!cloudIsOwner() && typeof skMustEncrypt === 'function' && skMustEncrypt(sec)){
    throw new Error('the ' + sec + ' section is encrypted in the cloud \u2014 turn on Encrypt Data in Settings on this phone and enter your access code before changing it');
  }
  const doc = { section: sec, payload, encrypted: enc, savedAt: new Date().toISOString(), count: cloudSectionCount(part), by: who };
  if(kv) doc.kv = kv;
  return doc;
}
// What the cloud documents were last written with: plain or encrypted with section keys. Anything else
// (including the older single-key layout, stored as 'e:<key>') is sent again, once.
function cloudKeySig(){ return encEnabled() ? 'e2' : 'p'; }
// Sends the sections this account may change and that changed since the last send (or all of them when
// `force` is true, or when the encryption setup changed - the key bundle travels with every document).
// Each section is its own write, recorded as it succeeds, so a failure part-way loses nothing: the
// sections not yet sent still differ from their stored hash and go out on the next push. A phone that has
// never received a section does not send it (it would overwrite the real one with an empty copy) - only the
// owner's phone may seed a section.
async function cloudPushNow(force){
  if(!cloudSyncEnabled() || CLOUD_PENDING_PULL) return;
  if(typeof LEDGER_LOAD_FAILED !== 'undefined' && LEDGER_LOAD_FAILED) return; // the stored ledger could not be read: what is on screen is blank, never send it
  if(cloudViewOnly()) return; // a view-only phone never sends anything to the cloud
  // Encrypting the outgoing payload (encSeal) needs the vault unlocked - on a fresh install
  // this can be tapped (via Sync Now, or the debounced schedule below) before the person has
  // entered their PIN even once. Give a message that says what to do and stop here.
  if(encEnabled() && !ENC_DEK){ setCloudStatus('error', 'app is locked \u2014 unlock with your PIN first, then try Sync Now'); return; }
  if(navigator.onLine === false){ setCloudStatus('offline'); return; }
  const writable = cloudWriteSections();
  if(!writable.length) return; // this account may not change any section
  setCloudStatus('syncing');
  try{
    const db = await cloudSdkReady();
    const owner = cloudIsOwner();
    const parts = cloudSplit(DATA);
    const seen = cloudMapGet(CLOUD_SEC_SEEN_KEY), hashes = cloudMapGet(CLOUD_SEC_HASH_KEY);
    // Also push the PIN-wrapped key bundle (not the key itself) so another device can adopt this same key
    // via joinEncryptedSync (encryption.js) instead of generating its own.
    const meta = encEnabled() ? encMeta() : null;
    const sig = cloudKeySig();
    let lastSig = null; try{ lastSig = localStorage.getItem(CLOUD_KEYSIG_KEY); }catch(e){}
    const all = force === true || sig !== lastSig;
    if(owner && encEnabled() && typeof skOwnerPrepare === 'function') await skOwnerPrepare(db); // keys made and backed up in the vault BEFORE anything is sealed
    if(typeof auditFlush === 'function') await auditFlush(db); // the audit entries go first: a change never reaches the cloud ahead of its log entry (a connection failure stops the push here)
    const who = recEditorEmail();
    const denied = []; let newest = null;
    const purged = cloudPurgedList();
    for(const sec of writable){
      if(purged.indexOf(sec) >= 0) continue; // emptied on this phone by another account's sign-in: never send it, it would wipe the real data
      if(!owner && !seen[sec]) continue; // never received: don't overwrite the cloud copy with an empty one
      const json = JSON.stringify(parts[sec]);
      const hash = await sha256Hex(json);
      if(!all && seen[sec] && hashes[sec] === hash) continue; // unchanged since the last send / receive
      const doc = await cloudBuildSectionDoc(sec, parts[sec], json, meta, who);
      const savedAt = doc.savedAt;
      try{ await cloudSecRef(db, sec).set(doc); }
      catch(e){ if(cloudIsDenied(e)){ denied.push(sec); continue; } throw e; }
      seen[sec] = savedAt; hashes[sec] = hash; newest = savedAt;
      cloudMapSet(CLOUD_SEC_SEEN_KEY, seen); cloudMapSet(CLOUD_SEC_HASH_KEY, hashes);
    }
    // The owner marks the section layout as in use once every section has been written.
    if(owner && all && !denied.length){
      let ok = null; try{ ok = localStorage.getItem(CLOUD_MANIFEST_OK_KEY); }catch(e){}
      if(ok !== CLOUD_OWNER_EMAIL){
        await db.collection('ledger').doc(CLOUD_MANIFEST_ID).set({ version: 3, sections: cloudSectionIds(), migratedAt: new Date().toISOString(), by: who });
        try{ localStorage.setItem(CLOUD_MANIFEST_OK_KEY, CLOUD_OWNER_EMAIL); }catch(e){}
      }
    }
    CLOUD_PENDING_REMOTE = null;
    if(denied.length){
      if(typeof waOnPermissionDenied === 'function') waOnPermissionDenied(); // a phone that thought it could edit checks whether that is gone
      setCloudStatus('error', 'the cloud refused changes to: ' + denied.join(', ') + ' \u2014 ask the owner to allow editing there');
      return;
    }
    try{ localStorage.setItem(CLOUD_KEYSIG_KEY, sig); }catch(e){}
    await cloudMarkSynced(newest);
    setCloudStatus('synced');
  }catch(e){ cloudFail(e); }
}
// Decrypts (or passes through) a remote doc's payload; used by both cloudApplyRemote and the
// auto-merge path below. Returns {json} or {error} (never throws) so callers just check which.
async function cloudDecryptRemote(remote){
  if(remote.encrypted && remote.kv && typeof skOpenSection === 'function') return skOpenSection(remote); // sealed with a section key
  if(remote.encrypted && remote.section && typeof skNoteEncrypted === 'function') skNoteEncrypted(remote.section);
  if(remote.encrypted && !cloudIsOwner() && remote.section){
    return { error: 'the ' + remote.section + ' section is not ready for this phone yet \u2014 ask the owner to tap Sync Now once, then try again.' };
  }
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
// Every save stamps the records that changed since the previous save with _mt (edit time, ms) and
// _mb (who: the signed-in account's email). A record that is new since the previous save gets _ct
// (added time, ms) and _cb (added by) instead. Only _mt takes part in a merge; _ct / _cb / _mb are
// for display (the Info button on each row, see recStampText in panels-wages-receipts.js) and are
// never counted as an edit of the record itself.
// Records never edited since this feature arrived have no _mt; a stamped one beats an unstamped one,
// and when neither (or both with equal times) can be told apart this device's copy wins, as before.
// The email is left off when no account is known on this phone (the time is still stamped).
// A change the owner APPROVED (a person marked "Needs approval" proposed it, js/proposals.js) is stamped as the person's
// own work - _cb / _mb is the person who proposed it - plus _ca (added, approved by) / _ma (last edited, approved by) with
// the owner's email. The owner's Accept sets REC_APPROVAL just before the normal save(); the next recStampEdits takes it
// (once) so no other save can pick it up. A normal edit clears _ma (a later edit is no longer that approval).
const REC_STAMP_KEYS = ['_mt', '_mb', '_ct', '_cb', '_ca', '_ma'];
let REC_APPROVAL = null;     // { by: who proposed it, ab: who approved it, ct: when it was proposed } - waiting for the next save
let REC_APPROVAL_NOW = null; // the same, only while recStampEdits runs (audit.js reads it to log the entry in the person's name)
let REC_BASE = null; // {listName: {id: JSON of the record without its stamps}} as of the last save/load
function recEditorEmail(){
  try{ const u = typeof cloudUserNow === 'function' ? cloudUserNow() : null; return u && u.email ? String(u.email).trim().toLowerCase() : ''; }
  catch(e){ return ''; }
}
function recSigsNow(){
  const o = {};
  Object.keys(DATA).forEach(k=>{
    const a = DATA[k];
    if(k === 'deletedIds' || !Array.isArray(a)) return;
    if(!a.every(r=> r && typeof r === 'object' && r.id != null)) return;
    const m = o[k] = {};
    a.forEach(r=>{ const c = Object.assign({}, r); REC_STAMP_KEYS.forEach(x=>{ delete c[x]; }); m[String(r.id)] = JSON.stringify(c); });
  });
  return o;
}
function recStampEdits(){
  const ap = REC_APPROVAL; REC_APPROVAL = null;   // taken once: only the save that applies the approved change uses it
  REC_APPROVAL_NOW = (ap && ap.by && ap.ab) ? ap : null;
  try{
    const now = recSigsNow();
    if(REC_BASE){
      const t = Date.now(), who = REC_APPROVAL_NOW ? REC_APPROVAL_NOW.by : recEditorEmail();
      Object.keys(now).forEach(k=>{
        const base = REC_BASE[k];
        if(!base) return;
        DATA[k].forEach(r=>{
          const old = base[String(r.id)], cur = now[k][String(r.id)];
          if(old === undefined){ // new since the previous save
            if(r._ct == null){
              r._ct = REC_APPROVAL_NOW && Number(REC_APPROVAL_NOW.ct) > 0 ? Number(REC_APPROVAL_NOW.ct) : t;
              if(who) r._cb = who;
              if(REC_APPROVAL_NOW) r._ca = REC_APPROVAL_NOW.ab;
            }
            auditNoteSafe('add', k, null, r);
          }
          else if(old !== cur){ // existing record whose contents changed
            r._mt = t; if(who) r._mb = who; else delete r._mb;
            if(REC_APPROVAL_NOW) r._ma = REC_APPROVAL_NOW.ab; else delete r._ma;
            auditNoteSafe('edit', k, JSON.parse(old), r);
          }
        });
        Object.keys(base).forEach(id=>{ if(now[k][id] === undefined) auditNoteSafe('delete', k, JSON.parse(base[id]), null); }); // removed since the previous save
      });
    }
    if(typeof auditObjectsCompare === 'function'){ try{ auditObjectsCompare(); }catch(e){ /* the log must never block a save */ } }
    REC_BASE = now;
  }finally{ REC_APPROVAL_NOW = null; }
}
// Hands one change to the audit trail (js/audit.js) with the record's stamps left off; never throws.
function auditNoteSafe(action, list, before, after){
  try{ if(typeof auditNote === 'function') auditNote(action, list, before, after ? auditStripStamps(after) : null); }catch(e){ console.error(e); }
}
function tombRebaseline(){ try{ TOMB_BASE = tombIdsNow(); REC_BASE = recSigsNow(); }catch(e){ TOMB_BASE = null; REC_BASE = null; } if(typeof auditRebaseline === 'function') auditRebaseline(); }
// Call right BEFORE a save that replaces the whole ledger (restore, cloud pull, merge): the records
// that vanish then are not "deleted by the person", so they must not be noted as deletions.
function tombResetBaseline(){ TOMB_BASE = null; REC_BASE = null; if(typeof auditResetBaseline === 'function') auditResetBaseline(); }
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
const MERGE_LIST_NAMES = { sale:['sale','sales'], recovery:['payment','payments'], production:['production entry','production entries'], expense:['expense','expenses'], warp:['warp entry','warp entries'], weft:['weft entry','weft entries'], wagePayments:['wage payment','wage payments'], wageBonuses:['wage bonus','wage bonuses'], wageSettlements:['wage settlement','wage settlements'], loanPayments:['loan payment','loan payments'], ownerLoans:['owner loan entry','owner loan entries'], warpBeams:['warp beam','warp beams'], clients:['client','clients'], employees:['employee','employees'], qualities:['quality','qualities'], looms:['loom','looms'], banks:['bank','banks'], family:['family entry','family entries'], personal:['personal entry','personal entries'], personalLoans:['personal loan','personal loans'], familyMembers:['family member','family members'], checkpoints:['checkpoint','checkpoints'] };
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
  return { json, seen, hash, secSeen: cloudMapGet(CLOUD_SEC_SEEN_KEY), secHash: cloudMapGet(CLOUD_SEC_HASH_KEY) };
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
// Undo after a section apply: puts back ONLY the sections that apply changed (from the Safety copy taken just
// before), with their own sync markers, and leaves everything else - including edits made in other sections
// since - exactly as it is. The cloud data is left "waiting" (no automatic push until Sync Now / next start
// re-checks it), so undoing can never overwrite the other device's newer data.
async function cloudUndoSections(pt, items){
  try{
    CLOUD_PENDING_PULL = { items, mode: 'pull' }; // blocks automatic pushes until the cloud data is reviewed again
    const before = cloudSplit(JSON.parse(pt.json));
    const seen = cloudMapGet(CLOUD_SEC_SEEN_KEY), hashes = cloudMapGet(CLOUD_SEC_HASH_KEY);
    items.forEach(it=>{
      cloudSetSection(it.sec, before[it.sec]);
      const s0 = (pt.secSeen || {})[it.sec], h0 = (pt.secHash || {})[it.sec];
      if(s0 === undefined) delete seen[it.sec]; else seen[it.sec] = s0;
      if(h0 === undefined) delete hashes[it.sec]; else hashes[it.sec] = h0;
    });
    tombResetBaseline();
    UNDO_SUPPRESS = true; UNDO_STACK.length = 0; updateUndoButton(); // the ledger-wide Undo list no longer matches
    await save();
    cloudMapSet(CLOUD_SEC_SEEN_KEY, seen); cloudMapSet(CLOUD_SEC_HASH_KEY, hashes);
    try{
      if(pt.seen == null) localStorage.removeItem(CLOUD_LAST_SEEN_KEY); else localStorage.setItem(CLOUD_LAST_SEEN_KEY, pt.seen);
      if(pt.hash == null) localStorage.removeItem(CLOUD_LAST_HASH_KEY); else localStorage.setItem(CLOUD_LAST_HASH_KEY, pt.hash);
    }catch(e){}
    setCloudStatus('waiting');
    switchTab(CURRENT_TAB || 'overview');
    showSyncNotice('Undone. Cloud data is still waiting \u2014 tap Sync Now to review it.');
  }catch(e){ console.error(e); setCloudStatus('error', e && e.message ? e.message : 'unknown error'); }
}
// Brings the given cloud sections into the ledger. items = [{sec, remote, mode: 'pull' | 'merge'}]:
// 'pull' replaces that section with the cloud copy, 'merge' combines the two by record id (nothing either
// side added is dropped, see mergeLedgers). opts.viewer = sections this phone cannot change: just brought
// down, no Safety copy, no Undo, no push. Otherwise a Safety copy is filed first, the result is sent back
// (merged sections and anything else changed here) and the notice offers Undo.
// Everything is decrypted and read BEFORE the ledger is touched, so one unreadable section changes nothing.
async function cloudApplySections(items, opts){
  opts = opts || {};
  const dec = [];
  for(const it of items){
    const d = await cloudDecryptRemote(it.remote);
    if(d.error){ setCloudStatus('error', d.error); return false; }
    let part; try{ part = JSON.parse(d.json); }catch(e){ setCloudStatus('error', 'part of the cloud copy could not be read'); return false; }
    dec.push({ it, part });
  }
  const pt = opts.viewer ? null : await cloudTakeSafetyPoint();
  const merges = [];
  dec.forEach(({ it, part })=>{
    if(it.mode === 'merge'){
      const local = cloudSplit(DATA)[it.sec] || {};
      const merged = mergeLedgers(local, part);
      const text = mergeSummaryText(local, merged); if(text) merges.push(text);
      cloudSetSection(it.sec, merged);
    } else cloudSetSection(it.sec, part);
  });
  tombResetBaseline(); // sections were replaced or merged - records that vanished were deleted elsewhere, not here
  try{ if(typeof ensureDataDefaults === 'function') await ensureDataDefaults(); }catch(e){ console.error(e); }
  if(opts.viewer){
    UNDO_SUPPRESS = true; UNDO_STACK.length = 0; if(typeof updateUndoButton === 'function') updateUndoButton();
    await (typeof viewOnlyAllowSave === 'function' ? viewOnlyAllowSave(()=> save()) : save()); // the one save a view-only phone may make: storing the cloud copy
  } else await (typeof viewOnlyAllowSave === 'function' ? viewOnlyAllowSave(()=> save()) : save()); // the cloud copy arriving is always allowed to store (it is not something this person changed)
  const parts = cloudSplit(DATA), seen = cloudMapGet(CLOUD_SEC_SEEN_KEY), hashes = cloudMapGet(CLOUD_SEC_HASH_KEY);
  let newest = null;
  for(const { it } of dec){
    seen[it.sec] = it.remote.savedAt; newest = it.remote.savedAt;
    if(it.mode !== 'merge') hashes[it.sec] = await sha256Hex(JSON.stringify(parts[it.sec])); // a merged section stays "changed" so it is sent back
  }
  cloudMapSet(CLOUD_SEC_SEEN_KEY, seen); cloudMapSet(CLOUD_SEC_HASH_KEY, hashes);
  CLOUD_PENDING_REMOTE = null;
  if(opts.viewer){ await cloudMarkSynced(newest); setCloudStatus('synced'); }
  else await cloudPushNow(); // share merged sections (and anything else waiting) so the other device converges too
  switchTab(CURRENT_TAB || 'overview');
  if(opts.viewer) showSyncNotice('Updated from the cloud');
  else showSyncNotice(merges.length ? ('Merged from the other device: ' + merges.join('; ')) : (dec.some(x=> x.it.mode === 'merge') ? 'Merged \u2014 nothing new from the other device' : 'New data synced from the cloud'), ()=> cloudUndoSections(pt, items));
  return true;
}
// Sections this phone cannot change: brought down without asking.
async function cloudViewerApply(items){ return cloudApplySections(items, { viewer: true }); }
// ---- The one-time move from the single ledger document into sections (owner's phone only) -------
// Safe to run any number of times:
//  - a Safety copy ("Before moving the cloud copy into sections" in Backup & Restore) is filed first; if
//    it cannot be filed, nothing is sent;
//  - the old copy (sync/ledger) is only ever READ - never changed or deleted - so it stays as a backup;
//  - a section that already exists in the cloud is never overwritten (an interrupted earlier run, or
//    another of your phones, may have written it): only missing sections are written, and the ones that
//    exist are left for the normal per-section check to compare;
//  - every section written is read back and compared before the manifest is written, and the manifest
//    (ledger/manifest) is what marks the job done, so a run that stops half way simply continues next time.
// Returns 'done' | 'failed'.
async function cloudMigrateToSections(db){
  if(!cloudIsOwner()) return 'failed';
  if(encEnabled() && !ENC_DEK){ setCloudStatus('error', 'app is locked \u2014 unlock with your PIN first, then try Sync Now'); return 'failed'; }
  setCloudStatus('syncing');
  try{
    const man = await db.collection('ledger').doc(CLOUD_MANIFEST_ID).get();
    if(man.exists){ try{ localStorage.setItem(CLOUD_MANIFEST_OK_KEY, CLOUD_OWNER_EMAIL); }catch(e){} return 'done'; } // already moved
    try{ await snapAdd('before-sections', JSON.stringify(DATA)); }
    catch(e){ console.error(e); setCloudStatus('error', 'could not file the safety copy first, so nothing was moved \u2014 try again'); return 'failed'; }
    const parts = cloudSplit(DATA), meta = encEnabled() ? encMeta() : null, who = recEditorEmail();
    const seen = cloudMapGet(CLOUD_SEC_SEEN_KEY), hashes = cloudMapGet(CLOUD_SEC_HASH_KEY);
    if(encEnabled() && typeof skOwnerPrepare === 'function') await skOwnerPrepare(db); // keys first, backed up in the vault
    let wrote = 0;
    for(const sec of cloudSectionIds()){
      const there = await cloudSecRef(db, sec).get();
      if(there.exists) continue; // never overwrite a section that is already in the cloud
      const json = JSON.stringify(parts[sec]);
      const doc = await cloudBuildSectionDoc(sec, parts[sec], json, meta, who);
      await cloudSecRef(db, sec).set(doc);
      const back = await cloudSecRef(db, sec).get(); // verify before trusting it
      if(!back.exists || back.data().payload !== doc.payload) throw new Error('the ' + sec + ' section did not save correctly \u2014 nothing was marked as moved; try Sync Now again');
      seen[sec] = doc.savedAt; hashes[sec] = await sha256Hex(json); wrote++;
      cloudMapSet(CLOUD_SEC_SEEN_KEY, seen); cloudMapSet(CLOUD_SEC_HASH_KEY, hashes);
    }
    await db.collection('ledger').doc(CLOUD_MANIFEST_ID).set({ version: 3, sections: cloudSectionIds(), migratedAt: new Date().toISOString(), by: who, wrote });
    try{ localStorage.setItem(CLOUD_MANIFEST_OK_KEY, CLOUD_OWNER_EMAIL); localStorage.setItem(CLOUD_KEYSIG_KEY, cloudKeySig()); }catch(e){}
    return 'done';
  }catch(e){ cloudFail(e); return 'failed'; }
}
// First run on the section layout only: the old whole-ledger copy (sync/ledger) is applied the way it always
// was, then everything is split into sections and sent. The old copy is left untouched as a backup.
async function cloudFinishMigration(){
  const db = await cloudSdkReady();
  if(await cloudMigrateToSections(db) === 'done'){ await cloudSectionsCheck(db); }
}
async function cloudApplyLegacy(item){
  if(item.mode === 'merge'){
    const dec = await cloudDecryptRemote(item.remote);
    if(dec.error){ setCloudStatus('error', dec.error); return; }
    const pt = await cloudTakeSafetyPoint();
    const merged = mergeLedgers(DATA, JSON.parse(dec.json));
    const summary = mergeSummaryText(DATA, merged);
    Object.assign(DATA, merged);
    tombResetBaseline();
    await save();
    CLOUD_PENDING_REMOTE = null;
    await cloudFinishMigration();
    switchTab(CURRENT_TAB || 'overview');
    showSyncNotice(summary ? ('Merged from the other device: ' + summary) : 'Merged \u2014 nothing new from the other device', ()=> cloudUndoApply(pt, item.remote, 'merge'));
  } else {
    await cloudApplyRemote(item.remote);
    await cloudFinishMigration();
  }
}
// Asks before touching local data: a blue bar at the top (Update / X), the same idea as the
// "new version" bar. Nothing is applied and nothing is pushed until Update is tapped; X leaves
// the prompt for later (Settings > Cloud Sync > Sync Now brings it back).
// items = [{sec, remote, mode}] (or one {legacy: true, remote, mode} on the first run on sections);
// mode is 'merge' if any of them needs a merge, else 'pull'.
function cloudAskToApply(items, mode){
  CLOUD_PENDING_PULL = { items, mode };
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
      const list = pending.items || [];
      const legacy = list.find(i=> i.legacy);
      if(legacy) await cloudApplyLegacy(legacy);
      else await cloudApplySections(list, {});
    }catch(e){ console.error(e); setCloudStatus('error', e && e.message ? e.message : 'unknown error'); }
  };
}
// First run of the owner's phone on the section layout (no ledger/manifest yet). Returns true when it dealt
// with this check. If the old whole-ledger copy has newer changes, they are applied first (asking, as always);
// otherwise the one-time move (cloudMigrateToSections) runs.
async function cloudMigrationCheck(db){
  let flag = null; try{ flag = localStorage.getItem(CLOUD_MANIFEST_OK_KEY); }catch(e){}
  if(flag === CLOUD_OWNER_EMAIL) return false;
  const man = await db.collection('ledger').doc(CLOUD_MANIFEST_ID).get();
  if(man.exists){ try{ localStorage.setItem(CLOUD_MANIFEST_OK_KEY, CLOUD_OWNER_EMAIL); }catch(e){} return false; }
  const snap = await cloudDocRef(db).get();
  const remote = snap.exists ? snap.data() : null;
  let lastSeen = null, lastHash = null;
  try{ lastSeen = localStorage.getItem(CLOUD_LAST_SEEN_KEY); lastHash = localStorage.getItem(CLOUD_LAST_HASH_KEY); }catch(e){}
  if(remote && remote.savedAt && remote.savedAt !== lastSeen){ // the old copy has changes this phone hasn't seen: apply them first (asking, as always)
    const mode = lastHash !== await cloudCurrentHash() ? 'merge' : 'pull';
    cloudAskToApply([{ legacy: true, remote, mode }], mode);
    return true;
  }
  if(await cloudMigrateToSections(db) === 'done') return false; // then carry on with the normal per-section check
  return true;
}
// Every check after that: read only the sections this account may see, then per section decide whether to
// pull, push or merge. Sections this phone cannot change are brought down silently; the rest ask first
// (nothing is applied and no push runs while a prompt is waiting, so a dismissed prompt can never let this
// device overwrite newer data). Never guesses when both sides changed.
async function cloudSectionsCheck(db){
  const viewer = cloudViewOnly();
  const results = await Promise.all(cloudReadSections().map(async sec=>{
    try{ return { sec, snap: await cloudSecRef(db, sec).get() }; }
    catch(e){ if(cloudIsDenied(e)) return { sec, denied: e }; throw e; }
  }));
  const readable = results.filter(r=> !r.denied);
  if(!readable.length){
    if(results.length && results[0].denied) throw results[0].denied; // refused everywhere: the usual "not approved" message
    setCloudStatus('error', 'nothing to show yet \u2014 the owner has not synced the ledger'); return;
  }
  if(!cloudIsOwner() && !readable.some(r=> r.snap.exists)){ setCloudStatus('error', 'nothing to show yet \u2014 the owner has not synced the ledger'); return; }
  const seen = cloudMapGet(CLOUD_SEC_SEEN_KEY), hashes = cloudMapGet(CLOUD_SEC_HASH_KEY), parts = cloudSplit(DATA);
  const silent = [], ask = []; let push = false;
  const purged = cloudIsOwner() ? cloudPurgedList() : [];
  for(const r of readable){
    const sec = r.sec, mine = !viewer && cloudCanWriteSection(sec);
    if(purged.indexOf(sec) >= 0){ // emptied here while another account was signed in: bring the real copy back, never send this one
      if(r.snap.exists) silent.push({ sec, remote: r.snap.data(), mode: 'pull' });
      else cloudPurgedClear([sec]); // nothing in the cloud to bring back
      continue;
    }
    if(!r.snap.exists){ if(mine && cloudIsOwner()) push = true; continue; } // owner: seed a section the cloud does not have yet
    const remote = r.snap.data();
    const remoteChanged = !!remote.savedAt && remote.savedAt !== seen[sec];
    if(!mine){ if(remoteChanged) silent.push({ sec, remote, mode: 'pull' }); continue; }
    const localChanged = hashes[sec] !== await sha256Hex(JSON.stringify(parts[sec]));
    if(remoteChanged && !localChanged) ask.push({ sec, remote, mode: 'pull' });
    else if(remoteChanged && localChanged) ask.push({ sec, remote, mode: 'merge' });
    else if(localChanged) push = true;
  }
  if(silent.length){ const ok = await cloudViewerApply(silent); if(ok !== false) cloudPurgedClear(silent.map(x=> x.sec)); }
  if(ask.length){ cloudAskToApply(ask, ask.some(a=> a.mode === 'merge') ? 'merge' : 'pull'); return; }
  if(push){ await cloudPushNow(); return; }
  if(!silent.length) setCloudStatus('synced');
}
// App start/unlock, and "Sync Now": decide, section by section, whether to pull, push, or ask.
async function cloudSyncCheckOnStart(){
  if(!cloudSyncEnabled()) return;
  CLOUD_LAST_CHECK_AT = Date.now();
  CLOUD_PENDING_PULL = null; // re-evaluated from scratch on every check (also what "Sync Now" does)
  const oldBar = document.getElementById('cloudAskBar'); if(oldBar) oldBar.remove();
  if(encEnabled() && !ENC_DEK) return; // still locked - afterUnlockLoad() calls this again once unlocked
  if(navigator.onLine === false){ setCloudStatus('offline'); return; }
  setCloudStatus('syncing');
  try{
    const db = await cloudSdkReady();
    cloudEnsureAccessRecord(db); // owner only; runs alongside the sync check, never blocks it
    if(typeof skReconcileQuiet === 'function') skReconcileQuiet(db); // owner only, encryption on: keys follow who is approved (also re-keys after an approval ended)
    if(typeof waRefreshGrant === 'function') await waRefreshGrant(); // other phone: learn whether it may edit right now (may switch it to/from view-only)
    if(typeof auditFlush === 'function') auditFlush(db).catch(e => console.error(e)); // entries kept while offline go out now; never blocks the sync check
    if(typeof auditPurge === 'function') auditPurge(db).catch(e => console.error(e));  // owner only, once a day: entries older than a year are removed
    if(typeof proposalsSync === 'function') proposalsSync(db).catch(e => console.error(e)); // person: send proposals + learn the owner's answers; owner: refresh the inbox count (js/proposals.js)
    if(cloudIsOwner() && await cloudMigrationCheck(db)) return;
    await cloudSectionsCheck(db);
  }catch(e){ cloudFail(e); }
}
async function cloudResolveKeepDevice(){ CLOUD_PENDING_REMOTE = null; CLOUD_PENDING_PULL = null; await cloudPushNow(true); }
async function cloudResolveUseCloud(){
  try{
    CLOUD_PENDING_PULL = null;
    const db = await cloudSdkReady();
    const items = [];
    for(const sec of cloudReadSections()){
      try{ const snap = await cloudSecRef(db, sec).get(); if(snap.exists) items.push({ sec, remote: snap.data(), mode: 'pull' }); }
      catch(e){ if(!cloudIsDenied(e)) throw e; }
    }
    if(!items.length){ setCloudStatus('error', 'No cloud copy found yet.'); return; }
    await cloudApplySections(items, {});
  }catch(e){ cloudFail(e); }
}
// "Join Encrypted Sync" (owner's second phone) needs the PIN-locked key and the keyring, which live in the
// owner's vault (keys/<owner email>, js/section-keys.js). Only the owner can read it.
async function cloudJoinRemote(db){
  try{ const snap = await db.collection('keys').doc(CLOUD_OWNER_EMAIL).get(); if(snap.exists && snap.data() && snap.data().keyWrap && snap.data().vault) return snap.data(); }
  catch(e){ if(!cloudIsDenied(e)) throw e; }
  return null;
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
    const owner = cloudIsOwner() ? `<p class="note" style="margin:0 0 8px">Owner account.</p>` : (u.verified ? (typeof waAccountNoteHtml === 'function' ? waAccountNoteHtml() : `<p class="note" style="margin:0 0 8px"><b>View only</b> — this phone shows the ledger and keeps it up to date from the cloud, but can\u2019t change it.</p>`) : '');
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
// "Add a device" quick-start: a short checklist that shows where this phone is and what to do next.
function cloudAddDeviceHtml(){
  const on = cloudSyncEnabled(), u = typeof cloudUserNow === 'function' ? cloudUserNow() : null, owner = on && cloudIsOwner();
  const synced = CLOUD_STATUS === 'synced';
  const steps = [
    ['Turn on Cloud Sync', on],
    ['Sign in with your email', on && !!u],
    ['Open the link we email you to verify', !!(u && u.verified)]
  ];
  if(!owner) steps.push(['Type the access code from the owner (below)', synced]);
  steps.push(['Tap Sync Now \u2014 done', synced]);
  const cur = steps.findIndex(x => !x[1]);
  const li = steps.map((x, i) => `<li class="ad-step${x[1] ? ' done' : (i === cur ? ' now' : '')}"><span class="ad-n">${x[1] ? '\u2713' : i + 1}</span>${x[0]}</li>`).join('');
  return `<div class="adddev"><div class="ad-title">Add this device in ${steps.length} steps</div><ol>${li}</ol>${owner ? '<p class="note" style="margin:6px 0 0">Owner: to add someone, they create their account on their phone; then send them their access code.</p>' : ''}</div>`;
}
function cloudSyncSection(){
  const on = cloudSyncEnabled();
  const head = `<div class="card-head"><h2>Cloud Sync</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>Keeps this ledger in sync with other devices through a private Firebase project set up just for this business. Two one-time steps are needed in that project's own console before this will work: turn on <b>Email/Password</b> sign-in (Build → Authentication → Sign-in method), and set the Firestore security rule below (Build → Firestore Database → Rules), so only the owner, and people the owner has approved (until their expiry), can use the ledger, and only the owner can change the approvals. After that, approving, extending and removing people is done here in the app (the owner's People card, just below Cloud Sync).</p>
    <pre class="info-note" hidden style="white-space:pre-wrap;background:var(--paper-dim);padding:10px;border-radius:8px;font-size:12px;margin:-4px 0 0">${escHtml(CLOUD_FIRESTORE_RULE)}</pre>`;
  return `<div class="card">${head}
    <label style="display:flex;align-items:center;gap:10px;font-weight:500;cursor:pointer">
      <input type="checkbox" id="cloudSyncToggle" ${on?'checked':''} style="width:18px;height:18px">
      Enable Cloud Sync
    </label>
    <p class="note" id="cloudSyncStatus" style="margin-top:10px">${on ? cloudStatusText() : 'Off — this device only.'}</p>
    ${cloudAddDeviceHtml()}
    <div id="cloudAccount" style="${on?'':'display:none'};margin-top:10px">${cloudAccountHtml()}</div>
    <div id="cloudSyncActions" style="${on && cloudCanSync() ? '' : 'display:none'}">
      <button class="ghost" id="cloudSyncNowBtn" type="button" style="width:100%">Sync Now</button>
      <div id="cloudSyncConflict" style="${CLOUD_STATUS==='conflict'?'':'display:none'};margin-top:10px">
        <p class="note" style="margin:0 0 8px;color:var(--rust)">This device and another device both have changes the other hasn't seen. Pick which copy to keep — the other will be overwritten:</p>
        <button class="ghost" id="cloudKeepDeviceBtn" type="button" style="width:100%;margin-bottom:8px">Keep This Device's Data</button>
        <button class="ghost" id="cloudUseCloudBtn" type="button" style="width:100%;background:var(--rust-deep);color:#fff">Use Cloud's Data Instead</button>
      </div>
      ${typeof skCodeCardHtml === 'function' ? skCodeCardHtml() : ''}
      <details id="cloudJoinEnc" style="${cloudIsOwner() ? '' : 'display:none;'}margin-top:14px;border-top:1px solid var(--field-border);padding-top:12px">
        <summary style="cursor:pointer;font-weight:600;min-height:36px">Advanced: use another device\'s encryption key</summary><p class="note" style="display:none">${encEnabled() ? 'Adopt a different device\'s key' : 'Join an already-encrypted cloud copy'}</p>
        <p class="note" style="margin:0 0 8px">If the cloud copy is encrypted (saved by a device with Encrypt Data on), this device needs that same key before it can read it — enter the PIN used on that other device, plus this device's own current PIN and recovery answer:</p>
        <input type="password" id="cloudJoinSharedPin" placeholder="PIN used on the OTHER device" style="width:100%;margin-bottom:8px" inputmode="numeric">
        <input type="password" id="cloudJoinLocalPin" placeholder="This device's own PIN" style="width:100%;margin-bottom:8px" inputmode="numeric">
        <input type="text" id="cloudJoinLocalAnswer" placeholder="This device's recovery answer" style="width:100%;margin-bottom:8px">
        <button class="ghost" id="cloudJoinBtn" type="button" style="width:100%">Join Encrypted Sync</button>
        <p class="note" id="cloudJoinStatus" style="margin:6px 0 0"></p>
      </details>
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
  if(typeof waGrantEnd === 'function') await waGrantEnd('signedout'); // signing out ends edit access here; unsynced entries are filed as a safety copy first
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
  wireCloudPeople();
  if(typeof wireAuditCard === 'function') wireAuditCard();
  if(typeof proposalsWire === 'function') proposalsWire();
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
  if(typeof skWireCodeCard === 'function') skWireCodeCard();
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
      const remote = await cloudJoinRemote(db);
      const msg = await joinEncryptedSync(sharedPin, localPin, localAnswer, remote);
      if(msg){ if(statusEl) statusEl.textContent = msg; }
      else { await save(); switchTab('settings'); }
    }catch(e){ console.error(e); if(statusEl) statusEl.textContent = e && e.message ? e.message : 'unknown error'; }
    joinBtn.disabled = false;
  };
}
