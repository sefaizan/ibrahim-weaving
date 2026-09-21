/* Automatic email backup. Sends a full backup of the ledger to the owner's own email, through the
 * owner's own Netlify function + Resend account (see backup-service/), so an off-phone copy exists
 * without anyone having to remember to share one.
 *
 * When it sends: once a day. If the app is open at midnight (the phone's own 00:00) it sends then;
 * otherwise it sends the first time the app is opened, comes back to the screen, or the phone gets
 * internet after midnight (that backup holds everything entered up to the end of the day before).
 * It only sends when something changed since the last emailed backup, and never more than once per
 * calendar day. If a send fails (e.g. no signal) it tries again the next time the app wakes up.
 * The address and key are typed into Backup & Restore on the phone and kept in this browser's own
 * storage: they are NOT in the app's files, which are public.
 *
 * The file is the same text Backup & Restore produces (compressed, and password-protected when a
 * password is set), so restoring an emailed backup is the normal "Restore from a backup" step.
 * Needs (from other files): DATA, backupCounts, totalEntries, currentEntryCount, gzipToBase64,
 * BACKUP_GZ_PREFIX, encryptBackupText, backupFileName, LAST_BACKUP_KEY, LAST_BACKUP_COUNT_KEY,
 * lastBackupStatusText, refreshBackupStrip, encEnabled, ENC_DEK.
 */

const AUTO_BACKUP_CFG_KEY = 'khata-autobackup';
const AUTO_BACKUP_STATE_KEY = 'khata-autobackup-state';
// The daily check is remembered per calendar day of the phone's own clock (state.lastCheckDay).
let AUTO_BACKUP_TIMER = null;
let AUTO_BACKUP_BUSY = false;

function autoBackupConfig(){
  try{
    const c = JSON.parse(localStorage.getItem(AUTO_BACKUP_CFG_KEY) || 'null');
    if(c && typeof c === 'object') return {on: !!c.on, url: String(c.url || ''), key: String(c.key || ''), pw: String(c.pw || '')};
  }catch(e){ /* unreadable settings = off */ }
  return {on: false, url: '', key: '', pw: ''};
}
function autoBackupSetConfig(cfg){
  try{ localStorage.setItem(AUTO_BACKUP_CFG_KEY, JSON.stringify(cfg)); return true; }catch(e){ return false; }
}
function autoBackupState(){
  try{
    const s = JSON.parse(localStorage.getItem(AUTO_BACKUP_STATE_KEY) || 'null');
    if(s && typeof s === 'object') return s;
  }catch(e){ /* start fresh */ }
  return {};
}
function autoBackupSetState(patch){
  try{ localStorage.setItem(AUTO_BACKUP_STATE_KEY, JSON.stringify(Object.assign(autoBackupState(), patch))); }catch(e){ /* best effort */ }
}
function autoBackupReady(){
  const c = autoBackupConfig();
  return c.on && /^https:\/\//i.test(c.url) && c.key.length > 0;
}

// The phone's local calendar day as text (2026-09-21), and how long until its next 00:00.
function autoBackupDayKey(d){
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function autoBackupMsToMidnight(){
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime() - n.getTime();
}

// A fingerprint of the ledger, to tell "changed since the last emailed backup" from "same as before".
async function autoBackupHash(text){
  try{
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }catch(e){
    let h = 5381;
    for(let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return 'x' + text.length + ':' + h;
  }
}

// The JSON envelope the Netlify function expects (see backup-service/netlify/functions/backup.mjs).
async function autoBackupBuild(cfg){
  const rawJson = JSON.stringify(DATA);
  let payload = rawJson, suffix = '';
  const gz = await gzipToBase64(rawJson);
  if(gz && gz.length < rawJson.length){ payload = BACKUP_GZ_PREFIX + gz; suffix = '-compressed'; }
  let isProtected = false;
  if(cfg.pw && cfg.pw.length >= 6){
    payload = await encryptBackupText(payload, cfg.pw);
    suffix += '-protected'; isProtected = true;
  }
  const envelope = JSON.stringify({
    app: 'IbrahimWeavingWeb',
    filename: backupFileName(suffix),
    createdAt: new Date().toISOString(),
    counts: backupCounts(DATA),
    protected: isProtected,
    payload,
  });
  return {rawJson, envelope};
}

// Sends one backup. force = true (the "Send now" button, or just after saving the settings) skips
// the "nothing changed" and "too soon" checks. Resolves to {ok, skipped, message, waitMs}.
async function autoBackupSend(force){
  if(AUTO_BACKUP_BUSY) return {ok: false, skipped: true, message: 'A backup is already being sent.'};
  if(!autoBackupReady()) return {ok: false, skipped: true, message: 'Automatic email backup is not set up.'};
  if(encEnabled() && !ENC_DEK) return {ok: false, skipped: true, message: 'Unlock the app first.'};
  if(!totalEntries(backupCounts(DATA))) return {ok: false, skipped: true, message: 'There is nothing to back up yet.'};
  const cfg = autoBackupConfig(), st = autoBackupState();
  const today = autoBackupDayKey();
  if(!force && st.lastCheckDay === today){
    return {ok: false, skipped: true, tooSoon: true, waitMs: autoBackupMsToMidnight(), message: 'Already checked today; the next automatic backup is after midnight.'};
  }
  AUTO_BACKUP_BUSY = true;
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 45000);
  try{
    let built, hash;
    try{
      built = await autoBackupBuild(cfg);
      hash = await autoBackupHash(built.rawJson);
    }catch(e){
      // Not a network problem: this phone could not build the file (e.g. it cannot encrypt here).
      const message = 'Could not prepare the backup on this phone' + (cfg.pw ? ' (try removing the password)' : '') + '.';
      autoBackupSetState({lastError: message});
      return {ok: false, message};
    }
    if(!force && st.lastHash === hash){
      autoBackupSetState({lastCheckDay: today});
      return {ok: false, skipped: true, message: 'No changes since the last emailed backup.'};
    }
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + cfg.key, 'Content-Type': 'application/json'},
      body: built.envelope,
      signal: ctl.signal,
    });
    if(res.ok){
      const nowIso = new Date().toISOString();
      autoBackupSetState({lastOkAt: nowIso, lastHash: hash, lastError: '', lastCheckDay: today});
      // An emailed backup is a real off-phone backup: quiet the "take a backup" reminders too.
      try{
        localStorage.setItem(LAST_BACKUP_KEY, nowIso);
        localStorage.setItem(LAST_BACKUP_COUNT_KEY, String(currentEntryCount()));
      }catch(e){ /* best effort */ }
      if(typeof refreshBackupStrip === 'function') refreshBackupStrip();
      const line = document.getElementById('lastBackupLine');
      if(line) line.textContent = lastBackupStatusText();
      return {ok: true, message: 'Backup emailed ✓'};
    }
    let message;
    if(res.status === 401) message = 'The backup key is wrong.';
    else if(res.status === 404) message = 'The backup service address is wrong (page not found).';
    else if(res.status === 413) message = 'The backup is too large for the service.';
    else message = 'The backup service returned an error (' + res.status + ').';
    autoBackupSetState({lastError: message});
    return {ok: false, message};
  }catch(e){
    const message = 'Could not reach the backup service (no internet, or the address is wrong).';
    autoBackupSetState({lastError: message});
    return {ok: false, message};
  }finally{
    clearTimeout(timeout);
    AUTO_BACKUP_BUSY = false;
  }
}

// Makes sure a check will run just after the next midnight, if the app is still open then
// (otherwise the first wake-up after midnight does it).
function autoBackupArmMidnight(){
  clearTimeout(AUTO_BACKUP_TIMER);
  if(!autoBackupReady()) return;
  AUTO_BACKUP_TIMER = setTimeout(autoBackupRun, Math.min(autoBackupMsToMidnight() + 2000, 2147000000));
}
// One automatic attempt (a no-op if today's check is already done), then waits for the next midnight.
async function autoBackupRun(){
  const r = await autoBackupSend(false);
  autoBackupArmMidnight();
  autoBackupRefreshStatus();
  return r;
}
// Called after every save(). Saving no longer sends anything by itself: the daily backup picks the change up.
function autoBackupSchedule(){
  if(!autoBackupReady()) return;
  autoBackupArmMidnight();
}
// Called when the app opens, returns to the screen, or the phone comes back online.
function autoBackupOnWake(){
  if(autoBackupReady()) autoBackupRun();
}
if(typeof document !== 'undefined' && document.addEventListener){
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') setTimeout(autoBackupOnWake, 3000); });
}
if(typeof window !== 'undefined' && window.addEventListener){
  window.addEventListener('online', () => setTimeout(autoBackupOnWake, 3000));
}

/* ---------------- Backup & Restore card ---------------- */
function autoBackupEsc(s){
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function autoBackupStatusText(){
  const cfg = autoBackupConfig(), st = autoBackupState();
  if(!cfg.on) return 'Automatic email backup is off.';
  const parts = [];
  if(st.lastOkAt){
    const d = new Date(st.lastOkAt);
    parts.push('Last emailed: ' + d.toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'})
      + ' at ' + d.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}) + '.');
  }else parts.push('No backup has been emailed yet.');
  if(st.lastError) parts.push('⚠ Last attempt failed: ' + st.lastError);
  return parts.join(' ');
}
function autoBackupRefreshStatus(){
  const el = document.getElementById('ab_status');
  if(el) el.textContent = autoBackupStatusText();
}
function autoBackupCardHtml(){
  const c = autoBackupConfig();
  const keyHint = c.key ? 'Saved — leave empty to keep it' : 'Paste the backup key';
  const pwHint = c.pw ? 'Saved — leave empty to keep it' : 'Optional, at least 6 characters';
  return `
    <div class="card">
      <div class="card-head"><h2>Automatic email backup</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>The app emails a full backup to your own address once a day: at midnight if the app happens to be open, otherwise the first time you open it after midnight (so it holds everything entered up to the end of the day before). It only sends if something changed, and never more than once a day. It goes through your own Netlify backup service and Resend account; nothing else receives it. It can only send while the app is open and the phone is online. Entries made today go out after midnight; for anything you can't lose sooner, tap Send a backup now. Set a password below to lock the emailed file: without one, anyone who can read that mailbox can read your ledger. If you forget the password the emailed backups cannot be opened.</p>
      <div class="field" style="margin-bottom:8px"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="ab_on" style="width:auto;margin:0"${c.on ? ' checked' : ''}> Email me a backup automatically</label></div>
      <div class="field" style="max-width:420px"><label>Backup service address</label><input type="url" id="ab_url" value="${autoBackupEsc(c.url)}" placeholder="https://your-site.netlify.app/api/backup" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <div class="field" style="max-width:420px"><label>Backup key</label><input type="password" id="ab_key" placeholder="${keyHint}" autocomplete="off"></div>
      <div class="field" style="max-width:420px"><label>Password for the emailed file</label><input type="password" id="ab_pw" placeholder="${pwHint}" autocomplete="new-password"></div>
      ${c.pw ? `<div class="field"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="ab_pwclear" style="width:auto;margin:0"> Remove the password (emailed files will not be protected)</label></div>` : ''}
      <div class="grid cols-2">
        <button class="primary" id="ab_save" type="button" style="margin-top:0">Save &amp; send a test backup</button>
        <button class="ghost" id="ab_now" type="button" style="margin-top:0">Send a backup now</button>
      </div>
      <p class="note" id="ab_status" style="margin:10px 0 0">${autoBackupEsc(autoBackupStatusText())}</p>
    </div>`;
}
function autoBackupWire(){
  const $ = id => document.getElementById(id);
  const saveBtn = $('ab_save'), nowBtn = $('ab_now'), status = $('ab_status');
  if(!saveBtn || !nowBtn) return;
  const say = t => { if(status) status.textContent = t; };
  const busy = on => { saveBtn.disabled = on; nowBtn.disabled = on; };
  saveBtn.onclick = async () => {
    const old = autoBackupConfig();
    const on = $('ab_on').checked;
    const url = $('ab_url').value.trim();
    const key = $('ab_key').value.trim() || old.key;
    let pw = $('ab_pw').value;
    if(pw) pw = pw.trim();
    else if(!($('ab_pwclear') && $('ab_pwclear').checked)) pw = old.pw;
    if(on){
      if(!/^https:\/\//i.test(url)){ say('The backup service address must start with https://'); return; }
      if(!key){ say('Paste the backup key first.'); return; }
    }
    if(pw && pw.length < 6){ say('The password must be at least 6 characters (or leave it empty).'); return; }
    if(!autoBackupSetConfig({on, url, key, pw})){ say('Could not save these settings on this phone.'); return; }
    if(!on){ autoBackupArmMidnight(); say('Automatic email backup turned off.'); return; }
    busy(true); say('Saved. Sending a first backup…');
    const r = await autoBackupSend(true);
    autoBackupArmMidnight();
    busy(false);
    say(r.ok ? 'Saved. ' + r.message + ' Check your inbox (and spam) in a minute.' : 'Settings saved, but: ' + r.message);
    if($('ab_key')) $('ab_key').value = '';
    if($('ab_pw')) $('ab_pw').value = '';
  };
  nowBtn.onclick = async () => {
    if(!autoBackupReady()){ say('Fill in and save the settings above first.'); return; }
    busy(true); say('Sending…');
    const r = await autoBackupSend(true);
    busy(false);
    say(r.ok ? r.message + ' Check your inbox (and spam) in a minute.' : r.message);
  };
}
