/* View-only mode. A phone signed in with an account that is not the owner's can look at the ledger
 * and keep it up to date from the cloud, but cannot change anything. Loaded after cloud-sync.js
 * (uses cloudIsOwner / cloudUserNow) and before lock-init.js.
 *
 * WHO IS VIEW-ONLY: viewOnly() is true when this phone's verified account is not the owner, and it
 * stays true after that account signs out (the flag below is kept until the owner signs in on this
 * phone), so signing out can never be used to unlock editing. A phone that has never signed in to a
 * non-owner account, and the owner's own phone, are never view-only: nothing changes for them.
 * (Every non-owner account is view-only, except while it holds a live time-limited write grant - js/write-access.js.)
 *
 * HOW IT IS ENFORCED, in three layers, so a missed button can never change the ledger:
 *   1. save() (core.js) refuses to run - see viewOnlySaveBlocked() - and puts the ledger back to what
 *      is stored on the phone, so nothing changed on screen can linger or be written.
 *   2. Cloud Sync never pushes from a view-only phone (cloud-sync.js), and Firestore's own rules
 *      refuse a write from an account that has no write access anyway.
 *   3. The screen: every Add / Edit / Delete / Save control is hidden (CSS below in index.html +
 *      viewOnlyApply here), and a click guard swallows any that is missed.
 * The only thing allowed to save on a view-only phone is the cloud copy arriving (cloudViewerApply).
 */
const VIEW_ONLY_KEY = 'khata-view-only';   // '1' once a non-owner account has signed in on this phone
let VIEW_SAVE_ALLOWED = false;             // true only while the cloud copy is being stored (see viewOnlyAllowSave)
let VIEW_REVERTING = false;
let VIEW_BASELINE = null;                  // the ledger (JSON) as last drawn / last stored from the cloud: what a refused save puts back

function viewOnly(){
  try{
    if(typeof cloudIsOwner === 'function' && cloudIsOwner()) return false;
    if(typeof cloudWriteGrantActive === 'function' && cloudWriteGrantActive()) return false; // a live, time-limited write grant (write-access.js)
    const u = typeof cloudUserNow === 'function' ? cloudUserNow() : null;
    if(u && u.verified) return true;
    return localStorage.getItem(VIEW_ONLY_KEY) === '1';
  }catch(e){ return false; }
}
// Called whenever the signed-in account changes (cloudSetUser): a verified non-owner makes this phone
// view-only, the verified owner clears it, signing out leaves it as it was.
function viewOnlyNoteUser(u){
  try{
    if(!u || !u.emailVerified) return;
    const isOwner = String(u.email || '').trim().toLowerCase() === CLOUD_OWNER_EMAIL;
    if(isOwner) localStorage.removeItem(VIEW_ONLY_KEY); else localStorage.setItem(VIEW_ONLY_KEY, '1');
  }catch(e){ /* storage unavailable: viewOnly() still follows the signed-in account */ }
  viewOnlyApply();
}

// The one way a view-only phone may store anything: the ledger copy that just came down from the cloud.
async function viewOnlyAllowSave(fn){
  VIEW_SAVE_ALLOWED = true;
  try{ const r = await fn(); try{ VIEW_BASELINE = JSON.stringify(DATA); }catch(e){} return r; } finally { VIEW_SAVE_ALLOWED = false; }
}
// Called first thing by save(). Returns true when the save must not happen.
function viewOnlySaveBlocked(){
  if(VIEW_SAVE_ALLOWED || !viewOnly()) return false;
  if(VIEW_REVERTING) return true; // a save attempted while putting the ledger back: just refuse, quietly
  VIEW_REVERTING = true;
  (async ()=>{
    try{
      if(typeof showToast === 'function') showToast('View only \u2014 this phone can\u2019t change the ledger.', 3500);
      // Put the in-memory ledger back to how it was, then redraw, so a change that slipped through
      // to the screen can't stay visible or be saved later by something else.
      if(VIEW_BASELINE){
        Object.keys(DATA).forEach(k=>{ delete DATA[k]; });
        Object.assign(DATA, JSON.parse(VIEW_BASELINE));
      } else if(typeof load === 'function') await load();
      if(typeof switchTab === 'function' && typeof CURRENT_TAB !== 'undefined' && CURRENT_TAB) switchTab(CURRENT_TAB);
    }catch(e){ console.error(e); }
    finally { VIEW_REVERTING = false; }
  })();
  return true;
}

// Everything that adds, edits, deletes or saves ledger data. Hidden by CSS (body.view-only, index.html)
// and swallowed by the click guard below. Things that only read or filter (pagination, period chips,
// info buttons, PDFs and exports, device settings such as PIN lock, dark mode and the Cloud Sync card)
// are deliberately not listed.
const VIEW_ONLY_WRITE_SELECTOR = [
  '.form-actions',
  '[data-edit]', '[data-del]', '[data-finish]', '[data-add]', '[data-cancel]', '[data-toggle-active]',
  '[data-move]', '[data-cheque]', '[data-replace-cheque]', '[data-link-replacement]', '[data-rh-edit]', '[data-rh-del]',
  '[data-l-ok]', '[data-l-toggle]', '[data-l-return]', '[data-l-confirm]', '[data-l-cancel]', '[data-l-box]',
  '[data-toggle-form]', '[data-form-body]', '[data-snap-restore]', '[data-quick-add]', '[data-undo-id]',
  '#undoBtn', '#importProduction', '#restoreJsonBtn', '#saveBusinessInfo', '#saveOpening', '#saveOpeningBalances',
  '#saveRateCalc', '#saveRateChange', '#settleAllEmployees', '#la_apply', '#r_addChequeRow',
].join(',');

document.addEventListener('click', (e)=>{
  if(!viewOnly()) return;
  const hit = e.target && e.target.closest ? e.target.closest(VIEW_ONLY_WRITE_SELECTOR) : null;
  if(!hit) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  if(typeof showToast === 'function') showToast('View only \u2014 this phone can\u2019t change the ledger.', 3000);
}, true);

function viewOnlyLockField(el){
  el.disabled = true;
  const fake = el.parentNode && el.parentNode.querySelector ? el.parentNode.querySelector('.sel-fake') : null; // the custom dropdown button that stands in for a select
  if(fake) fake.disabled = true;
}
// Marks the phone as view-only on screen: the header label, the body class the CSS keys off, and hides
// any card that exists only to enter data (its title and empty fields would otherwise be left behind).
// Runs after every page is drawn (switchTab) and whenever the signed-in account changes.
function viewOnlyApply(root){
  const on = viewOnly();
  try{
    if(document.body) document.body.classList.toggle('view-only', on);
    const badge = document.getElementById('viewOnlyBadge');
    if(badge) badge.hidden = !on;
    if(!on) return;
    const scope = root || document.getElementById('panels');
    if(!scope || !scope.querySelectorAll) return;
    if(!VIEW_BASELINE && scope.children && scope.children.length){ try{ VIEW_BASELINE = JSON.stringify(DATA); }catch(e){} } // first page drawn = the ledger is loaded
    // Fields that show a saved value and are saved by a button (hidden above): keep the value visible, but locked.
    scope.querySelectorAll('#ob, #biz_name, #biz_address, #biz_phone, select[id^="la_e"], [data-ob-emp], [data-sa-emp]').forEach(viewOnlyLockField);
    // The "add a new ..." box at the top of each Settings list.
    scope.querySelectorAll('[id^="new_"]').forEach(el=>{ (el.closest('.grid') || el).classList.add('vo-hide'); });
    // Bulk Import is a card whose only purpose is its (hidden) button.
    scope.querySelectorAll('#importProduction').forEach(el=>{ const c = el.closest('.card'); if(c) c.classList.add('vo-hide'); });
    // "No entries yet - add one above" would point at a form that isn't there.
    scope.querySelectorAll('.empty').forEach(el=>{ if(/add one above/i.test(el.textContent)) el.textContent = 'No entries yet'; });
    scope.querySelectorAll('.form-actions').forEach(fa=>{
      const card = fa.closest('.card');
      if(card && !card.querySelector('table, [data-log], .log-cards, .logcard')) card.classList.add('vo-hide');
    });
  }catch(e){ console.error(e); }
}
