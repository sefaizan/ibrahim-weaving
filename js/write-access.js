/* Time-limited write access (Release 2). Loaded after view-only.js and before lock-init.js.
 *
 * THE IDEA: the owner can approve a person with write:true and an end time (config/access, which only the
 * owner can read). That person's phone cannot read config/access, so it learns about its own grant from a
 * small note the owner's phone keeps in sync with the record:  sync/grant-<hash of the email>  =
 * { write: true, expiresAt: <ms>, updatedAt }.  The id is a hash (not the email), so the ledger's other
 * viewers do not get a list of addresses. The note lives in the existing "sync" collection, which the current
 * Firestore rules already cover - no rule change and nothing to do in the Firebase console.
 *
 * WHAT THE OTHER PHONE DOES:
 *   - Editing is unlocked only while it holds an unexpired grant (cloudWriteGrantActive, used by viewOnly()).
 *   - It shows the time left in the header (#writeBadge) and in Settings > Cloud Sync.
 *   - It drops back to view-only by itself when the end time passes (checked every minute and whenever the app
 *     comes back to the front), when the owner shortens/revokes it (learned on the next sync check, once a
 *     minute while the app is open, or when Firebase refuses a push), or when the person signs out.
 *   - On the way down, anything not yet synced is filed FIRST as a Safety copy (Backup & Restore, type
 *     "Unsynced entries (access ended)"), then the phone goes view-only and says so.
 *
 * THE SERVER IS THE REAL LOCK: Firestore's rules read config/access on every request, so a phone that keeps
 * showing edit controls after its grant ended (offline, clock set back, this note edited) simply has its
 * pushes refused - and that refusal drops it to view-only too. The note and the local clock only decide what
 * the screen shows; they never grant anything.
 */
const WA_GRANT_KEY = 'khata-write-grant';         // {email, expiresAt, ended?} - what this phone last learned about its own grant
const WA_LOCAL_COPY_KEY = 'khata-unsynced-copy';  // last-resort copy of unsynced entries (only when the ledger is not encrypted)
const WA_TICK_MS = 60000;
let WA_FINISHING = false;                          // one wind-down at a time
let WA_TICK_TIMER = null;

// ---- The note (owner's phone writes it, the other phone reads it) -------------------------------
async function waGrantDocId(email){
  return 'grant-' + await sha256Hex('write-grant:' + String(email || '').trim().toLowerCase());
}
// Owner only: make the note match one person's entry in the record (null = they were revoked / not on the list).
async function waMirrorGrant(db, email, entry){
  const ref = db.collection('sync').doc(await waGrantDocId(email));
  // Release 3: every approved person gets a note (not only editors): it carries their role and what they may do
  // in each section, which is how their phone learns it. Revoked / not on the list = the note is deleted.
  const live = entry && Number(entry.expiresAt) > 0;
  if(live) await ref.set({ write: entry.write === true, expiresAt: Number(entry.expiresAt), role: entry.role || '', perms: (entry.perms && typeof entry.perms === 'object') ? entry.perms : {}, needsApproval: cloudNeedsApprovalClean(entry.needsApproval), updatedAt: new Date().toISOString() });
  else await ref.delete();
}
// Owner only: bring every note in line with the record (also covers entries set by hand in the console).
async function waMirrorAll(rec){
  if(!cloudIsOwner() || cloudOffline()) return;
  try{
    const db = await cloudSdkReady();
    const approved = (rec && rec.approved) || {};
    for(const email of Object.keys(approved)) await waMirrorGrant(db, email, approved[email]);
  }catch(e){ console.error(e); }
}

// ---- What this phone knows about its own grant ---------------------------------------------------
function waGrantLocal(){
  try{ const g = JSON.parse(localStorage.getItem(WA_GRANT_KEY) || 'null'); return g && g.email ? g : null; }catch(e){ return null; }
}
function waGrantSave(g){ try{ if(g) localStorage.setItem(WA_GRANT_KEY, JSON.stringify(g)); else localStorage.removeItem(WA_GRANT_KEY); }catch(e){} }
// True while this phone may edit: signed in (verified) as the account the grant is for, not ended, not past its end time.
function cloudWriteGrantActive(nowMs){
  const g = waGrantLocal();
  if(!g || g.ended) return false;
  const u = typeof cloudUserNow === 'function' ? cloudUserNow() : null;
  if(!u || !u.verified || String(u.email || '').trim().toLowerCase() !== g.email) return false;
  return Number(g.expiresAt) > (nowMs || Date.now());
}
function waLeftMs(nowMs){ const g = waGrantLocal(); return g ? Number(g.expiresAt) - (nowMs || Date.now()) : 0; }
// "3 days", "2h 15m", "40m", "under a minute"
function waLeftText(ms){
  if(!(ms > 0)) return 'ended';
  const M = 60000, H = 60 * M, D = 24 * H;
  if(ms >= 2 * D) return Math.floor(ms / D) + ' days';
  if(ms >= H) { const h = Math.floor(ms / H), m = Math.floor((ms % H) / M); return h + 'h' + (m ? ' ' + m + 'm' : ''); }
  if(ms >= M) return Math.floor(ms / M) + 'm';
  return 'under a minute';
}
function waBadgeUpdate(){
  try{
    const el = document.getElementById('writeBadge');
    if(!el) return;
    const on = cloudWriteGrantActive();
    el.hidden = !on;
    if(on) el.textContent = 'Can edit \u00B7 ' + waLeftText(waLeftMs()) + ' left';
  }catch(e){}
  try{ if(typeof proposalsBadgeUpdate === 'function') proposalsBadgeUpdate(); }catch(e){}
}
// The line in Settings > Cloud Sync for a signed-in non-owner account.
// Changes kept as proposals on this phone (js/proposals.js), shown under the account note while any are waiting.
function waProposalsNoteHtml(){
  try{
    const n = typeof proposalsCount === 'function' ? proposalsCount() : 0;
    return n ? '<p class=\"note\" style=\"margin:0 0 8px\"><b>' + n + (n === 1 ? ' change is' : ' changes are') + ' waiting for the owner\u2019s approval.</b> The ledger on this phone does not include ' + (n === 1 ? 'it' : 'them') + ' yet.</p>' : '';
  }catch(e){ return ''; }
}
function waAccountNoteHtml(){
  return waAccountNoteMainHtml() + waProposalsNoteHtml() + (typeof proposalsBoxHtml === 'function' ? proposalsBoxHtml() : '');
}
function waAccountNoteMainHtml(){
  if(cloudWriteGrantActive()){
    const g = waGrantLocal();
    return '<p class="note" style="margin:0 0 8px"><b>Can edit</b> until ' + escHtml(cloudPeopleDateTimeText(g.expiresAt)) + ' (' + escHtml(waLeftText(waLeftMs())) + ' left). When it ends this phone goes back to view only, and anything not yet synced is kept as a safety copy.</p>';
  }
  return '<p class="note" style="margin:0 0 8px"><b>View only</b> \u2014 this phone shows the ledger and keeps it up to date from the cloud, but can\u2019t change it.</p>';
}
function waRedraw(){
  try{ if(typeof viewOnlyApply === 'function') viewOnlyApply(); }catch(e){}
  try{ if(typeof switchTab === 'function') switchTab((typeof CURRENT_TAB !== 'undefined' && CURRENT_TAB) || 'overview'); }catch(e){}
  waBadgeUpdate();
}

// ---- Learning the grant (each sync check, and once a minute while a grant is held) ---------------
// Returns 'active' | 'none' | 'denied' | 'skipped' | 'error'. Never throws.
async function waRefreshGrant(){
  try{
    if(cloudIsOwner()) return 'skipped';
    const u = cloudUserNow();
    if(!u || !u.verified || cloudOffline()) return 'skipped';
    const held = !!waGrantLocal();
    let d = null;
    try{
      const db = await cloudSdkReady();
      const snap = await db.collection('sync').doc(await waGrantDocId(u.email)).get();
      d = snap.exists ? snap.data() : null;
    }catch(e){
      if(e && (e.code === 'permission-denied' || /insufficient permissions/i.test(e.message || ''))){
        // Not approved (any more) at all: the note can't even be read.
        if(held) await waGrantEnd('revoked');
        cloudPermsClear();
        return 'denied';
      }
      return 'error'; // no signal etc.: keep things as they are
    }
    if(d && Number(d.expiresAt) > Date.now()){ cloudPermsSave(d.perms || {}); cloudApprovalSave(d.needsApproval || {}); } else if(!d || Number(d.expiresAt) <= Date.now()) cloudPermsClear(); // what this account may do, per section
    if(d && d.write === true && Number(d.expiresAt) > Date.now() && cloudPermsCanWrite(d.perms)){
      const was = cloudWriteGrantActive();
      waGrantSave({ email: String(u.email).trim().toLowerCase(), expiresAt: Number(d.expiresAt) });
      waTickStart();
      if(!was){
        waRedraw();
        if(typeof showToast === 'function') showToast('You can edit until ' + cloudPeopleDateTimeText(Number(d.expiresAt)) + '.', 4500);
      } else waBadgeUpdate();
      return 'active';
    }
    if(held) await waGrantEnd(d && d.write === true ? 'expired' : 'removed');
    return 'none';
  }catch(e){ console.error(e); return 'error'; }
}
// Firebase refused a push/pull: if this phone thought it could edit, find out whether the grant is really gone.
function waOnPermissionDenied(){ if(waGrantLocal()) waRefreshGrant(); }

// ---- Ending a grant -----------------------------------------------------------------------------
// Step 1 (instant): mark it ended, so viewOnly() is true from this moment and no push is started.
// Step 2 (waFinishDrop): file the safety copy, tell the person, redraw as view-only.
async function waGrantEnd(reason){
  const g = waGrantLocal();
  if(!g) return;
  if(!g.ended){ g.ended = reason || 'expired'; waGrantSave(g); }
  try{ if(typeof CLOUD_PUSH_TIMER !== 'undefined') clearTimeout(CLOUD_PUSH_TIMER); }catch(e){}
  await waFinishDrop();
}
async function waHasUnsynced(){
  // Per section (Release 3): only sections this account may change count, so entries that merely arrived
  // from the cloud in a view-only section are never mistaken for unsynced work.
  return (await cloudUnsyncedSections(true)).length > 0;
}
async function waFinishDrop(){
  const g = waGrantLocal();
  if(!g || WA_FINISHING) return;
  if(!g.ended && cloudWriteGrantActive()) return;                  // still running
  if(typeof encEnabled === 'function' && encEnabled() && !ENC_DEK) return; // locked: nothing readable to copy yet - retried by the next tick
  WA_FINISHING = true;
  try{
    const reason = g.ended || 'expired';
    let copy = 'none';
    if(await waHasUnsynced()){
      const json = JSON.stringify(DATA);
      try{ await snapAdd('access-ended', json); copy = 'safety'; }
      catch(e){
        console.error(e);
        // Never write plain ledger data next to an encrypted ledger.
        if(!(typeof encEnabled === 'function' && encEnabled())){
          try{ localStorage.setItem(WA_LOCAL_COPY_KEY, json); copy = 'local'; }catch(e2){ copy = 'failed'; }
        } else copy = 'failed';
      }
    }
    waGrantSave(null);
    waRedraw();
    waShowEnded(reason, copy);
  }finally{ WA_FINISHING = false; }
}
const WA_ENDED_TEXT = {
  expired: 'Your edit access has ended.',
  revoked: 'Your access was removed by the owner.',
  removed: 'The owner turned off your edit access.',
  signedout: 'You signed out.',
};
function waEndedMessage(reason, copy){
  let m = (WA_ENDED_TEXT[reason] || WA_ENDED_TEXT.expired) + ' This phone is now view only.';
  if(copy === 'safety') m += ' Changes that had not synced were saved as a safety copy (Settings > Backup & Restore).';
  else if(copy === 'local') m += ' Changes that had not synced were saved as a copy on this phone.';
  else if(copy === 'failed') m += ' Warning: changes that had not synced could not be saved as a copy.';
  try{
    const k = typeof proposalsUnsentCount === 'function' ? proposalsUnsentCount() : 0;
    if(k) m += ' ' + k + (k === 1 ? ' proposed change that has' : ' proposed changes that have') + ' not reached the owner ' + (k === 1 ? 'is' : 'are') + ' kept on this phone (Settings > Cloud Sync).';
  }catch(e){}
  return m;
}
function waShowEnded(reason, copy){
  try{
    const old = document.getElementById('writeEndedBar'); if(old) old.remove();
    const el = document.createElement('div');
    el.id = 'writeEndedBar';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(10px + env(safe-area-inset-top,0px));z-index:100000;background:#B5541E;color:#fff;border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:10px;box-shadow:0 8px 28px rgba(0,0,0,.45);border:2px solid #fff;font-size:14px;font-weight:600';
    el.innerHTML = '<span style="flex:1"></span><button type="button" id="writeEndedX" aria-label="Dismiss" style="background:transparent;color:#fff;border:0;font-size:18px;padding:4px 8px">\u2715</button>';
    el.firstChild.textContent = waEndedMessage(reason, copy);
    document.body.appendChild(el);
    const x = el.querySelector('#writeEndedX'); if(x) x.onclick = () => el.remove();
  }catch(e){ console.error(e); }
}

// ---- The minute tick ----------------------------------------------------------------------------
async function waTick(){
  try{
    const g = waGrantLocal();
    if(!g){ waBadgeUpdate(); return; }
    if(typeof DATA !== 'object' || !DATA || !Object.keys(DATA).length) return; // app not loaded yet
    if(g.ended || !cloudWriteGrantActive()){ await waGrantEnd(g.ended || 'expired'); return; }
    waBadgeUpdate();
    await waRefreshGrant(); // picks up an extension, a shortening or a revoke made on the owner's phone
  }catch(e){ console.error(e); }
}
function waTickStart(){
  if(WA_TICK_TIMER || typeof setInterval !== 'function') return;
  WA_TICK_TIMER = setInterval(waTick, WA_TICK_MS);
}
if(typeof document !== 'undefined' && document.addEventListener){
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') waTick(); });
}
if(waGrantLocal()) waTickStart();
