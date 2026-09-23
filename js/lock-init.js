/* PIN lock, Android back button, keyboard-safe scrolling and startup (init). Loaded last:
 * init runs once everything above has been defined. */

/* ---------------- PIN Lock ---------------- */
// Everything here is device-local: the PIN itself is never stored in plain text (only a
// salted SHA-256 hash, via the browser's own Web Crypto API), and none of these keys are
// part of DATA — so a Backup/Restore export never carries the PIN or the recovery answer
// along with it. There's no third-party service: a forgotten PIN is recovered by answering
// the recovery question chosen at setup (the answer is stored only as a slow salted hash).
const PIN_HASH_KEY = 'khata-pin-hash';
const PIN_SALT_KEY = 'khata-pin-salt';
const PIN_FAIL_KEY = 'khata-pin-fail-state';          // {count, until}
const PIN_QUESTION_KEY = 'khata-pin-question';         // plain text — it's shown on the lock screen
const PIN_ANS_HASH_KEY = 'khata-pin-answer-hash';
const PIN_ANS_SALT_KEY = 'khata-pin-answer-salt';
const PIN_RECOVER_FAIL_KEY = 'khata-pin-recover-fail-state'; // {count, until}
// 4, 6 or 8 digits — chosen when the PIN is set (a longer PIN makes the encryption much harder to guess). Stored so it survives reloads.
let PIN_LENGTH = (()=>{ try{ const n = Number(localStorage.getItem('khata-pin-length')); return [4,6,8].includes(n) ? n : 4; }catch(e){ return 4; } })();
const PIN_ANSWER_MIN = 6;        // shortest recovery answer accepted (after normalizing)
const PIN_ANSWER_ITER = 150000;  // PBKDF2 rounds — makes guessing an answer from a copied hash slow
// Keys written by an earlier version that offered email recovery (EmailJS). Removed on
// startup so a stored recovery email / EmailJS credentials don't linger on the device.
const PIN_LEGACY_KEYS = ['khata-pin-recovery-email','khata-pin-emailjs-config','khata-pin-reset-code'];
function purgeLegacyPinKeys(){
  try{ PIN_LEGACY_KEYS.forEach(k=>localStorage.removeItem(k)); }catch(e){ /* best effort only */ }
}
purgeLegacyPinKeys();

function escHtml(str){
  return String(str==null?'':str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function sha256Hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function randomHex(bytes){
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function hashWithSalt(value, salt){ return sha256Hex(salt+':'+value); }

function isPinEnabled(){
  try{ return !!localStorage.getItem(PIN_HASH_KEY) || encEnabled(); }catch(e){ return false; }
}
// With encryption on, the PIN is not stored in any checkable form at all — it only locks a copy of
// the data key — so "setting" it means re-locking the key under the new PIN.
async function setPin(pin){
  if(encEnabled()){
    if(!ENC_DEK) throw new Error('locked');
    const meta = encMeta();
    meta.pin = await encWrap(ENC_DEK, pin, meta.iter);
    localStorage.setItem(ENC_META_KEY, JSON.stringify(meta));
  }else{
    await setPinPlain(pin);
  }
  setPinLength(pin.length);
}
async function setPinPlain(pin){
  const salt = randomHex(16);
  const hash = await hashWithSalt(pin, salt);
  try{
    localStorage.setItem(PIN_SALT_KEY, salt);
    localStorage.setItem(PIN_HASH_KEY, hash);
  }catch(e){ /* best effort only */ }
}
async function checkPin(pin){
  if(encEnabled()){
    // Encrypted: the only way to check a PIN is to try opening the data key with it (slow on purpose).
    const meta = encMeta();
    if(!meta) return false;
    try{ const dek = await encUnwrap(meta.pin, pin, meta.iter); if(!ENC_DEK) ENC_DEK = dek; return true; }
    catch(e){ return false; }
  }
  let salt, hash;
  try{ salt = localStorage.getItem(PIN_SALT_KEY); hash = localStorage.getItem(PIN_HASH_KEY); }catch(e){ return false; }
  if(!salt || !hash) return false;
  return (await hashWithSalt(pin, salt)) === hash;
}
function disablePin(){
  try{
    [PIN_HASH_KEY, PIN_SALT_KEY, PIN_FAIL_KEY, PIN_QUESTION_KEY, PIN_ANS_HASH_KEY, PIN_ANS_SALT_KEY, PIN_RECOVER_FAIL_KEY, PIN_LENGTH_KEY]
      .forEach(k=>localStorage.removeItem(k));
  PIN_LENGTH = 4;
  }catch(e){ /* best effort only */ }
}

// Recovery question. The answer is normalized first (case, accents' compatibility forms and
// runs of spaces don't matter) so "  Blue  Door " and "blue door" count as the same answer,
// then stored only as a salted PBKDF2 hash — never in plain text.
function normalizeAnswer(a){
  return String(a==null?'':a).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
}
async function deriveAnswerHash(answer, saltHex){
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(normalizeAnswer(answer)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {name:'PBKDF2', hash:'SHA-256', salt: enc.encode(saltHex), iterations: PIN_ANSWER_ITER}, keyMat, 256);
  return Array.from(new Uint8Array(bits)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function hasRecovery(){
  try{ if(encEnabled()){ const m = encMeta(); return !!(localStorage.getItem(PIN_QUESTION_KEY) && m && m.rec); } }catch(e){ return false; }
  try{ return !!(localStorage.getItem(PIN_QUESTION_KEY) && localStorage.getItem(PIN_ANS_HASH_KEY) && localStorage.getItem(PIN_ANS_SALT_KEY)); }
  catch(e){ return false; }
}
function getRecoveryQuestion(){
  try{ return localStorage.getItem(PIN_QUESTION_KEY) || ''; }catch(e){ return ''; }
}
// Returns '' if fine, otherwise the message to show the user.
function validateRecoveryInput(question, answer1, answer2){
  if(String(question||'').trim().length < 3) return 'Enter a recovery question.';
  const n = normalizeAnswer(answer1);
  if(n.length < PIN_ANSWER_MIN) return `Answer must be at least ${PIN_ANSWER_MIN} characters.`;
  if(normalizeAnswer(answer2) !== n) return 'Answers do not match.';
  return '';
}
async function setRecovery(question, answer){
  if(encEnabled()){
    if(!ENC_DEK) throw new Error('locked');
    const meta = encMeta();
    meta.rec = await encWrap(ENC_DEK, normalizeAnswer(answer), meta.iter);
    localStorage.setItem(ENC_META_KEY, JSON.stringify(meta));
    localStorage.setItem(PIN_QUESTION_KEY, String(question).trim());
  }else{
    await setRecoveryPlain(question, answer);
  }
}
async function setRecoveryPlain(question, answer){
  const salt = randomHex(16);
  const hash = await deriveAnswerHash(answer, salt);
  try{
    localStorage.setItem(PIN_QUESTION_KEY, String(question).trim());
    localStorage.setItem(PIN_ANS_SALT_KEY, salt);
    localStorage.setItem(PIN_ANS_HASH_KEY, hash);
  }catch(e){ /* best effort only */ }
}
async function checkRecoveryAnswer(answer){
  if(encEnabled()){
    const meta = encMeta();
    if(!meta || !meta.rec) return false;
    try{ const dek = await encUnwrap(meta.rec, normalizeAnswer(answer), meta.iter); if(!ENC_DEK) ENC_DEK = dek; return true; }
    catch(e){ return false; }
  }
  let salt, hash;
  try{ salt = localStorage.getItem(PIN_ANS_SALT_KEY); hash = localStorage.getItem(PIN_ANS_HASH_KEY); }catch(e){ return false; }
  if(!salt || !hash) return false;
  return (await deriveAnswerHash(answer, salt)) === hash;
}

// Five wrong tries in a row triggers a cooldown before another attempt is allowed — slows
// down someone guessing by hand without needing anything server-side to enforce it. The PIN
// keypad and the recovery-answer box each keep their own counter.
function getPinFailState(key=PIN_FAIL_KEY){
  try{ return JSON.parse(localStorage.getItem(key) || 'null') || {count:0, until:0}; }catch(e){ return {count:0, until:0}; }
}
function setPinFailState(state, key=PIN_FAIL_KEY){
  try{ localStorage.setItem(key, JSON.stringify(state)); }catch(e){ /* best effort only */ }
}
function recordPinFailure(key=PIN_FAIL_KEY, lockMs=30000){
  const state = getPinFailState(key);
  state.count = (state.count||0) + 1;
  if(state.count >= 5){ state.until = Date.now() + lockMs; state.count = 0; }
  setPinFailState(state, key);
  return state;
}
function clearPinFailState(key=PIN_FAIL_KEY){ setPinFailState({count:0, until:0}, key); }

let PIN_ENTRY = ''; // digits typed so far on whichever keypad screen is showing
let PIN_STAGE = 'unlock'; // unlock | recover-answer | recover-newpin-1 | recover-newpin-2
let PIN_NEW_FIRST = null; // first entry of a new PIN, while awaiting the confirmation entry

function mountLockScreen(){
  if(document.getElementById('pinLockOverlay')) return;
  const el = document.createElement('div');
  el.id = 'pinLockOverlay';
  el.className = 'pin-lock-overlay';
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  PIN_ENTRY = ''; PIN_STAGE = 'unlock'; PIN_NEW_FIRST = null;
  renderLockStage();
}
function unmountLockScreen(){
  const el = document.getElementById('pinLockOverlay');
  if(el) el.remove();
  document.body.style.overflow = '';
  markPinActive(); // start the idle clock fresh from the moment of unlock
  runPendingQuickAdd(); // an app-icon shortcut (Add Sale / Add Recovery) that was waiting behind the PIN
  setTimeout(runBeamAlerts, 900); // beams about to end (the startup check skips while the lock screen is up)
}
// Grace period so a refresh, a quick app-switch, or a moment of inactivity shorter than this
// doesn't force the PIN screen back up — only re-lock once the app has genuinely been left
// alone (backgrounded or untouched) for this long. Persisted in localStorage (not just a JS
// variable) so it survives a full page reload, since that's one of the cases it has to cover.
const PIN_LAST_ACTIVE_KEY = 'khata-pin-last-active';
const PIN_LOCK_GRACE_MS = 2.5 * 60 * 1000; // 2.5 minutes
let _pinActiveThrottle = 0;
function markPinActive(){
  if(!isPinEnabled()) return; // nothing to protect — skip the write entirely
  // While the lock screen is up, taps/backgrounding must NOT count as "the owner is here" —
  // otherwise anyone could tap the lock screen once, reload/reopen within the grace period, and
  // walk straight in without the PIN. The clock only restarts on a real unlock (unmountLockScreen).
  if(document.getElementById('pinLockOverlay')) return;
  const now = Date.now();
  if(now - _pinActiveThrottle < 5000) return; // avoid hammering localStorage on rapid taps/keys
  _pinActiveThrottle = now;
  try{ localStorage.setItem(PIN_LAST_ACTIVE_KEY, String(now)); }catch(e){ /* best effort only */ }
}
function pinIdleTooLong(){
  let last = 0;
  try{ last = Number(localStorage.getItem(PIN_LAST_ACTIVE_KEY)) || 0; }catch(e){ /* no storage available */ }
  return !last || (Date.now() - last) >= PIN_LOCK_GRACE_MS;
}
function pinDotsHtml(len, filled){
  return `<div class="pin-dots" id="pinDots">${Array.from({length:len}).map((_,i)=>`<span class="${i<filled?'filled':''}"></span>`).join('')}</div>`;
}
function pinKeypadHtml(){
  const keys = ['1','2','3','4','5','6','7','8','9','','0','back'];
  return `<div class="pin-keypad">${keys.map(k=>{
    if(k==='') return `<div></div>`;
    if(k==='back') return `<button type="button" class="pin-key ghost-key" data-pinkey="back">⌫</button>`;
    return `<button type="button" class="pin-key" data-pinkey="${k}">${k}</button>`;
  }).join('')}</div>`;
}
function renderLockStage(){
  const el = document.getElementById('pinLockOverlay');
  if(!el) return;
  if(PIN_STAGE === 'unlock'){
    const failState = getPinFailState();
    const cooldownLeft = Math.max(0, Math.ceil((failState.until - Date.now())/1000));
    el.innerHTML = `
      <div class="mark"><img src="${APP_MARK_PNG}" alt=""></div>
      <h1>Enter PIN</h1>
      ${pinDotsHtml(PIN_LENGTH, PIN_ENTRY.length)}
      <div class="error-text" id="pinError">${cooldownLeft>0?`Too many attempts — try again in ${cooldownLeft}s`:''}</div>
      ${pinKeypadHtml()}
      <button type="button" class="link-btn" id="pinForgotBtn">Forgot PIN?</button>
    `;
    if(cooldownLeft>0) setTimeout(renderLockStage, 1000);
  } else if(PIN_STAGE === 'recover-answer'){
    if(!hasRecovery()){
      el.innerHTML = `
        <div class="mark">🔑</div>
        <h1>Recover PIN</h1>
        <p class="hint">No recovery question was set on this device, so the PIN can't be recovered here. To get back in, clear this app's data and Restore from your latest backup.</p>
        <button type="button" class="link-btn" id="pinBackBtn">Back to PIN entry</button>
      `;
    } else {
      const rf = getPinFailState(PIN_RECOVER_FAIL_KEY);
      const rCool = Math.max(0, Math.ceil((rf.until - Date.now())/1000));
      el.innerHTML = `
        <div class="mark">🔑</div>
        <h1>Recover PIN</h1>
        <p class="hint">${escHtml(getRecoveryQuestion())}</p>
        <div class="field"><input id="pinAnswerInput" type="password" placeholder="Your answer" autocomplete="off" autocapitalize="off" spellcheck="false" ${rCool>0?'disabled':''}></div>
        <div class="error-text" id="pinError">${rCool>0?`Too many attempts — try again in ${rCool}s`:''}</div>
        <button type="button" class="primary" id="pinVerifyBtn" ${rCool>0?'disabled':''}>Verify</button>
        <button type="button" class="link-btn" id="pinBackBtn">Back to PIN entry</button>
      `;
      if(rCool>0) setTimeout(renderLockStage, 1000);
    }
  } else if(PIN_STAGE === 'recover-newpin-1'){
    el.innerHTML = `
      <div class="mark">🔒</div>
      <h1>Set a New PIN</h1>
      ${pinDotsHtml(PIN_LENGTH, PIN_ENTRY.length)}
      <div class="error-text" id="pinError"></div>
      ${pinKeypadHtml()}
    `;
  } else if(PIN_STAGE === 'recover-newpin-2'){
    el.innerHTML = `
      <div class="mark">🔒</div>
      <h1>Confirm New PIN</h1>
      ${pinDotsHtml(PIN_LENGTH, PIN_ENTRY.length)}
      <div class="error-text" id="pinError"></div>
      ${pinKeypadHtml()}
    `;
  }
  wireLockStage();
}
function pinShakeAndError(msg){
  const dots = document.getElementById('pinDots');
  if(dots) dots.classList.add('shake');
  const err = document.getElementById('pinError');
  if(err) err.textContent = msg;
  setTimeout(()=>{ if(dots) dots.classList.remove('shake'); }, 400);
}
async function submitRecoveryAnswer(){
  const input = document.getElementById('pinAnswerInput');
  const btn = document.getElementById('pinVerifyBtn');
  if(!input) return;
  if(getPinFailState(PIN_RECOVER_FAIL_KEY).until > Date.now()) return;
  const answer = input.value;
  if(!normalizeAnswer(answer)){ pinShakeAndError('Enter your answer.'); return; }
  if(btn){ btn.disabled = true; btn.textContent = 'Checking…'; }
  const ok = await checkRecoveryAnswer(answer);
  if(ok){
    clearPinFailState(PIN_RECOVER_FAIL_KEY);
    PIN_STAGE = 'recover-newpin-1'; PIN_ENTRY = ''; PIN_NEW_FIRST = null;
    renderLockStage();
  } else {
    const state = recordPinFailure(PIN_RECOVER_FAIL_KEY, 60000);
    renderLockStage();
    // A 5th miss puts the countdown message up — don't stomp on it with the generic text.
    if(state.until <= Date.now()) pinShakeAndError('Incorrect answer');
  }
}
function wireLockStage(){
  document.querySelectorAll('[data-pinkey]').forEach(btn=>{
    btn.onclick = ()=> handlePinKey(btn.dataset.pinkey);
  });
  const forgotBtn = document.getElementById('pinForgotBtn');
  if(forgotBtn) forgotBtn.onclick = ()=>{ PIN_STAGE='recover-answer'; PIN_ENTRY=''; renderLockStage(); };
  const backBtn = document.getElementById('pinBackBtn');
  if(backBtn) backBtn.onclick = ()=>{ PIN_STAGE='unlock'; PIN_ENTRY=''; renderLockStage(); };
  const verifyBtn = document.getElementById('pinVerifyBtn');
  if(verifyBtn) verifyBtn.onclick = submitRecoveryAnswer;
  const answerInput = document.getElementById('pinAnswerInput');
  if(answerInput) answerInput.onkeydown = (e)=>{ if(e.key==='Enter'){ e.preventDefault(); submitRecoveryAnswer(); } };
}
async function handlePinKey(key){
  if(PIN_STAGE==='unlock' && getPinFailState().until > Date.now()) return;
  if(key==='back'){ PIN_ENTRY = PIN_ENTRY.slice(0,-1); renderLockStage(); return; }
  if(PIN_ENTRY.length >= PIN_LENGTH) return;
  PIN_ENTRY += key;
  renderLockStage();
  if(PIN_ENTRY.length < PIN_LENGTH) return;

  if(PIN_STAGE==='unlock'){
    const ok = await checkPin(PIN_ENTRY);
    if(ok){ clearPinFailState(); PIN_ENTRY=''; await afterUnlockLoad(); unmountLockScreen(); }
    else{
      const state = recordPinFailure();
      PIN_ENTRY='';
      renderLockStage();
      // If that 5th failure just triggered the cooldown, renderLockStage already put the
      // countdown message up — don't stomp on it with the generic "Incorrect PIN" text.
      if(state.until <= Date.now()) pinShakeAndError('Incorrect PIN');
    }
  } else if(PIN_STAGE==='recover-newpin-1'){
    PIN_NEW_FIRST = PIN_ENTRY; PIN_ENTRY='';
    PIN_STAGE='recover-newpin-2'; renderLockStage();
  } else if(PIN_STAGE==='recover-newpin-2'){
    if(PIN_ENTRY === PIN_NEW_FIRST){
      await setPin(PIN_ENTRY); // recovery question/answer stay as they were
      clearPinFailState(); clearPinFailState(PIN_RECOVER_FAIL_KEY);
      PIN_ENTRY=''; PIN_NEW_FIRST=null; PIN_STAGE='unlock';
      await afterUnlockLoad();
      unmountLockScreen();
    } else {
      PIN_ENTRY=''; PIN_NEW_FIRST=null;
      PIN_STAGE='recover-newpin-1'; renderLockStage();
      pinShakeAndError('PINs did not match — start over');
    }
  }
}
// Re-lock once the app has genuinely been away/idle for PIN_LOCK_GRACE_MS — not instantly on
// every backgrounding, so briefly switching apps or a page refresh doesn't force a re-login.
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden){
    markPinActive(); // stamp the moment it was left, so the gap can be measured on return
  } else if(isPinEnabled() && pinIdleTooLong()){
    mountLockScreen();
  } else {
    markPinActive(); // resumed within the grace period — extend the session
  }
});
// Covers the app being left open and untouched (never backgrounded) for the same grace period.
document.addEventListener('pointerdown', markPinActive, {passive:true});
document.addEventListener('keydown', markPinActive);
setInterval(()=>{
  if(!document.hidden && isPinEnabled() && pinIdleTooLong()) mountLockScreen();
}, 30000);

/* ---------------- Back button (Android hardware/gesture key) ----------------
   Installed as a standalone PWA/TWA with no browser chrome, so without this the back key has
   nothing of ours to act on and just exits the app straight away — even from an open drawer
   or a sub-tab. Standard SPA fix: keep one extra history entry pushed at all times as a
   "guard". Every back press pops it (firing popstate) — we react to that by closing whatever's
   open / returning to the Overview tab, then immediately push a fresh guard entry so the next
   press is caught the same way. Only when there's truly nothing left to close (already on
   Overview, drawer closed) do we let a press through, after one "press again to exit" warning,
   by simply not re-arming the guard — the following press then exits the app for real. */
let BACK_EXIT_ARMED_AT = 0;
function armBackGuard(){
  try{ history.pushState({khataBackGuard:true}, ''); }catch(e){ /* best effort only */ }
}
window.addEventListener('popstate', ()=>{
  const drawerOpen = document.getElementById('tabs')?.classList.contains('open');
  if(drawerOpen){ closeDrawer(); armBackGuard(); return; }
  // The lock screen is intentionally never closable via back — re-arm and stay put.
  if(document.getElementById('pinLockOverlay')){ armBackGuard(); return; }
  if(CURRENT_TAB !== 'overview'){ switchTab('overview'); armBackGuard(); return; }
  const now = Date.now();
  if(now - BACK_EXIT_ARMED_AT < 2000) return; // second press within the window — let it exit
  BACK_EXIT_ARMED_AT = now;
  showToast('Press back again to exit', 2000);
  armBackGuard();
});
armBackGuard();

/* ---------------- Keyboard-safe scrolling ----------------
   The viewport meta's interactive-widget=resizes-content (above, in <head>) tells the browser
   to actually shrink the layout viewport for the on-screen keyboard rather than overlay it —
   installed/standalone apps like this one default to the overlay behavior otherwise, which is
   exactly what would let the keyboard cover whatever field someone's typing into. That alone
   covers most cases; this listener is the fallback/nudge for the rest, since #panels is our
   own scrollable container (not the page body) and a freshly-focused field further down a long
   form can still land right at the keyboard's edge without an explicit scroll. */
function scrollFocusedFieldIntoView(){
  const el = document.activeElement;
  if(!el || !el.matches || !el.matches('input, textarea, select')) return;
  // rAF, not immediate: run after the keyboard/viewport has actually finished resizing, else
  // this measures against the pre-resize layout and scrolls to the wrong spot.
  requestAnimationFrame(()=> el.scrollIntoView({block:'center', behavior:'smooth'}));
}
document.addEventListener('focusin', (e)=>{
  if(e.target && e.target.matches && e.target.matches('input, textarea, select')) scrollFocusedFieldIntoView();
});
if(window.visualViewport) window.visualViewport.addEventListener('resize', scrollFocusedFieldIntoView);

/* ---------------- Init ---------------- */
const SEARCH_DEBOUNCE_TIMERS = {};
// Hides the floating Backup & Restore button while the page is actively scrolling, and brings it
// back a moment after scrolling stops — see the .fab-scroll-hide rule in index.html for why.
// Listens on document with capture:true, not on #panels: scroll events don't bubble, but a
// capture-phase listener on an ancestor still fires for them, so this one listener covers both
// how the app actually scrolls on a phone (the whole page/body scrolls) and how it scrolls in the
// desktop preview frame (only #panels scrolls, inside a fixed-size shell) without caring which.
function wireScrollAwareFab(fabBackup){
  let hideTimer = null;
  document.addEventListener('scroll', ()=>{
    fabBackup.classList.add('fab-scroll-hide');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(()=> fabBackup.classList.remove('fab-scroll-hide'), 500);
  }, {passive:true, capture:true});
}

(async function init(){
  const fabBackup = document.getElementById('fabBackup');
  if(fabBackup){ fabBackup.onclick = ()=> switchTab('backup'); wireScrollAwareFab(fabBackup); }
  const menuBtn = document.getElementById('menuBtn');
  if(menuBtn) menuBtn.onclick = openDrawer;
  const scrim = document.getElementById('scrim');
  if(scrim) scrim.onclick = closeDrawer;
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeDrawer(); });
  // A static "9:41" mock clock in the status bar (the classic device-mockup time) is replaced
  // with the real local time once the page is live, then kept current.
  const sbClock = document.getElementById('sbClock');
  if(sbClock){
    const tick = ()=>{ sbClock.textContent = new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}); };
    tick(); setInterval(tick, 30000);
  }
  // Material ripple: one delegated listener spawns a ripple span inside whichever
  // button/row/drawer-item was pressed. Purely visual — never touches app state or wiring.
  document.addEventListener('pointerdown', (e)=>{
    const el = e.target.closest('button.primary, button.ghost, button.rowbtn, .icon-btn, .fab-backup, nav.tabs button, .sel-item, .sel-fake, .info-btn');
    if(!el || el.disabled) return;
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 1.4;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - r.left - size/2) + 'px';
    ripple.style.top = (e.clientY - r.top - size/2) + 'px';
    el.appendChild(ripple);
    ripple.addEventListener('animationend', ()=> ripple.remove());
    // Fallback: some actions (Print/Save-as-PDF, Share) hand off to a native OS dialog that
    // suspends the page while it's open, which can stop the CSS animation before it ever
    // fires 'animationend' — leaving this ripple stuck on top of the button's icon forever.
    // Force it gone shortly after the animation should have finished either way.
    setTimeout(()=> ripple.remove(), 600);
  });
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-pg]');
    if(!btn || btn.disabled) return;
    const [key, dir] = btn.dataset.pg.split(':');
    PAGE[key] = (PAGE[key] || 1) + (dir === 'next' ? 1 : -1);
    switchTab(tabForKey(key));
  });
  // Delegated (not wired per-panel) since these cards live inside Overview's renderStats(),
  // which re-renders on every month/year filter change — a per-panel listener would go
  // stale the moment that happens. Re-renders whichever panel is currently active so the
  // updated status shows immediately, whether that's Overview or (for older cached views)
  // anywhere else these buttons might still appear.
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-cheque]');
    if(!btn) return;
    const [recoveryId, chequeId, status] = btn.dataset.cheque.split(':');
    const rec = DATA.recovery.find(r=>r.id===recoveryId);
    const cheque = rec && (rec.cheques||[]).find(c=>c.id===chequeId);
    if(!cheque) return;
    cheque.status = status;
    save();
    const activeTab = document.querySelector('nav.tabs button.active');
    switchTab(activeTab ? activeTab.dataset.tab : 'overview');
    if((status === 'Pending' || status === 'Cleared') && replacementLinks().some(l=>l.recoveryId===recoveryId && l.chequeId===chequeId)){
      showToast('A payment is still linked as replacing this cheque — edit that payment to remove the link.', 6000);
    }
  });
  // Bounced cheque -> "Log replacement": open the payment form for that client with the cheque ticked.
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-replace-cheque]');
    if(!btn) return;
    const [recoveryId, chequeId] = btn.dataset.replaceCheque.split(':');
    if(!findCheque(recoveryId, chequeId)) return;
    PENDING_REPLACE = {recoveryId, chequeId};
    EDITING = null;
    switchTab('recovery');
  });
  // "Replaced cheques not linked to a payment" -> tap the payment that replaced it.
  document.addEventListener('click', async (e)=>{
    const btn = e.target.closest('[data-link-replacement]');
    if(!btn) return;
    const [paymentId, recoveryId, chequeId, amount] = btn.dataset.linkReplacement.split('|');
    const r = linkReplacement(paymentId, recoveryId, chequeId, Number(amount));
    if(!r.ok){ showToast(r.error, 6000); return; }
    await save();
    switchTab('recovery');
    showToast('Linked ✓ — the payment now shows which cheque it replaced.');
  });
  // Toggles the "Before Last Sale" column on Overview's client breakdown table. Re-renders
  // just the stats card (not the whole panel) using the filter that was last applied, so
  // flipping this doesn't reset whatever Month/Year/range the user had selected.
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-toggle="beforeLastSale"]');
    if(!btn) return;
    SHOW_BEFORE_LAST_SALE = !SHOW_BEFORE_LAST_SALE;
    renderStats(LAST_STATS_MONTHVAL);
  });
  // Toggles the Bulk Import card on Production. Off by default since most days it's just one
  // or two entries typed by hand — this is only for the occasional register-photo catch-up,
  // so it stays out of the way until asked for. Full re-render since, unlike the Overview
  // toggle above, this shows/hides an entire card rather than a column in an existing table.
  // Collapsible forms (used on Production's Bulk Import and the Wages page): flips whether a
  // given form's key is open, then re-renders whichever tab is active so the toggled form's
  // display style picks up the new state. A lightweight full re-render rather than direct DOM
  // toggling because these forms sit inside conditionally-rendered cards (e.g. Set Opening
  // Balances only exists when there are never-settled employees) that need the same
  // string-template logic to run again anyway.
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-toggle-form]');
    if(!btn) return;
    const key = btn.dataset.toggleForm;
    if(OPEN_FORMS.has(key)) OPEN_FORMS.delete(key); else OPEN_FORMS.add(key);
    const activeTab = document.querySelector('nav.tabs button.active');
    const keepY = window.scrollY; // re-render must not throw the reader back to the top
    switchTab(activeTab ? activeTab.dataset.tab : 'wages');
    window.scrollTo(0, keepY);
  });
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-receipt]');
    if(!btn) return;
    printSaleReceipt(btn.dataset.receipt);
  });
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-share-receipt]');
    if(!btn) return;
    shareSaleReceipt(btn.dataset.shareReceipt);
  });
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-recovery-receipt]');
    if(!btn) return;
    printRecoveryReceipt(btn.dataset.recoveryReceipt);
  });
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-share-recovery-receipt]');
    if(!btn) return;
    shareRecoveryReceipt(btn.dataset.shareRecoveryReceipt);
  });
  // Debounced so a full-panel re-render only happens after a short pause in typing, not on
  // every keystroke — then focus and cursor position are restored on the freshly-rendered
  // search box, since the whole panel HTML (including that input) gets replaced each time.
  document.addEventListener('input', (e)=>{
    const inp = e.target.closest('[data-search]');
    if(!inp) return;
    const key = inp.dataset.search;
    const val = inp.value;
    const cursorPos = inp.selectionStart;
    clearTimeout(SEARCH_DEBOUNCE_TIMERS[key]);
    SEARCH_DEBOUNCE_TIMERS[key] = setTimeout(()=>{
      SEARCH[key] = val;
      PAGE[key] = 1;
      switchTab(tabForKey(key));
      const freshInp = document.querySelector(`[data-search="${key}"]`);
      if(freshInp){ freshInp.focus(); freshInp.setSelectionRange(cursorPos, cursorPos); }
    }, 350);
  });
  // Client Statement (Overview): Download PDF / Share Statement. Delegated because the card is
  // rebuilt inside renderStats() every time the period changes. Share reuses shareClientStatement().
  document.addEventListener('click', async (e)=>{
    const dl = e.target.closest('#downloadStatementBtn');
    const sh = e.target.closest('#shareStatementBtn');
    if(!dl && !sh) return;
    const client = v('stmt_client'), from = v('stmt_from') || null, to = v('stmt_to') || null;
    if(sh){ await shareClientStatement(client, from, to); return; }
    const say = (msg)=>{ const el=document.getElementById('stmtStatus'); if(el) el.textContent = msg; };
    if(!client){ say('Pick a client first.'); return; }
    if(typeof window.jspdf === 'undefined'){ say('PDF library is still loading — try again in a moment.'); return; }
    const built = renderClientStatementPdf(client, from, to);
    if(!built){ say(`No sales or payments found for ${client} in this range.`); return; }
    built.doc.save(built.filename);
    say(`Downloaded ✓ — ` + new Date().toLocaleString());
  });
  // Summary / Breakdown cards: tap the title row to show or hide the card's contents.
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-summary-toggle]');
    if(!btn) return;
    setSummaryOpen(btn.dataset.summaryToggle, !OPEN_SUMMARIES.has(btn.dataset.summaryToggle));
  });
  // Card-heading info toggles (see .card-head / .info-btn in the stylesheet): delegated
  // since these get re-rendered constantly across every panel. Most buttons toggle the
  // [hidden] note immediately following the .card-head they sit in; a button can instead
  // carry data-info-target="someId" to point at a note elsewhere on the panel (used where
  // the explanatory note sits under a sub-heading rather than right under the card's own h2).
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-info-toggle]');
    if(!btn) return;
    let note;
    const targetId = btn.getAttribute('data-info-target');
    if(targetId){
      note = document.getElementById(targetId);
    } else {
      const head = btn.closest('.card-head');
      note = head && head.nextElementSibling;
    }
    if(!note || !note.classList.contains('info-note')) return;
    const inSummary = note.closest('.summary-card');
    if(inSummary && !OPEN_SUMMARIES.has(inSummary.dataset.summaryCard)) setSummaryOpen(inSummary.dataset.summaryCard, true);
    if(note.hasAttribute('hidden')){ note.removeAttribute('hidden'); btn.classList.add('active'); }
    else { note.setAttribute('hidden',''); btn.classList.remove('active'); }
  });
  // Closes any open custom dropdown (see enhanceSelects) when a tap lands outside it. One
  // delegated listener for all of them, so it doesn't grow with every select the app renders.
  document.addEventListener('click', (e)=>{
    document.querySelectorAll('.sel-list:not([hidden])').forEach(list=>{
      const wrap = list.closest('.sel-wrap');
      if(wrap && !wrap.contains(e.target)) list.hidden = true;
    });
  });
  await load();
  try{ UNDO_PREV_PARTS = undoParts(); }catch(e){ /* best effort only */ } // Undo baseline for this session
  switchTab(restoredTab());
  try{
    const act = new URLSearchParams(location.search).get('action');
    if(act === 'addsale' || act === 'addrecovery'){ PENDING_QUICK = act === 'addrecovery' ? 'recovery' : 'sale'; history.replaceState(null, '', location.pathname); }
  }catch(e){ /* shortcuts are optional */ }
  if(encEnabled()) purgePlaintextLedgerAndHashes(); // safety net: nothing plain may linger next to an encrypted ledger
  // A freshly opened app with an encrypted ledger always asks for the PIN (the key only ever lives in memory).
  if(isPinEnabled() && (pinIdleTooLong() || (encEnabled() && !ENC_DEK))) mountLockScreen();
  else { markPinActive(); runPendingQuickAdd(); } // within the grace period (or PIN off) — resume unlocked and reset the clock
  setTimeout(runBeamAlerts, 2500);
  setTimeout(noteIfJustUpdated, 1200);
  setTimeout(()=>{ maybeAutoSnapshot(); checkForNewVersion(); }, 4000);
  setTimeout(autoBackupOnWake, 8000); // emails a backup if one is due (Backup & Restore > Automatic email backup)
  // All data lives in this browser's storage, so ask it not to clear that under storage
  // pressure. Best effort: granted automatically for installed apps on most browsers, ignored
  // (or refused) elsewhere, and nothing here depends on the answer.
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(()=>{}); }catch(e){ /* not supported */ }
})();
