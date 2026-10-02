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
// Puts the in-memory ledger back to how it was, redraws, and tells the person why.
function viewOnlyRevert(msg){
  if(VIEW_REVERTING) return;
  VIEW_REVERTING = true;
  (async ()=>{
    try{
      if(typeof showToast === 'function') showToast(msg, 3500);
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
}
// Called first thing by save(). Returns true when the save must not happen.
function viewOnlySaveBlocked(){
  if(VIEW_SAVE_ALLOWED) return false;
  if(!viewOnly()){
    // Release 3: someone who may edit some sections (not the owner) may only add / edit / delete what their
    // role allows. The change is compared with the ledger as it was before, section by section and action by
    // action; anything outside their permissions is refused and put back, whatever button caused it.
    if(!permsLimited()) return false;
    if(!VIEW_BASELINE) return false; // nothing to compare with yet (no page has been drawn): nothing has been changed by hand either
    const bad = permsViolation();
    if(!bad){ try{ VIEW_BASELINE = JSON.stringify(DATA); }catch(e){} return false; }
    if(VIEW_REVERTING) return true;
    viewOnlyRevert('Not allowed \u2014 your role can\u2019t ' + PERM_ACTION_WORDS[bad.letter] + ' in ' + PERM_SECTION_NAME(bad.sec) + '.');
    return true;
  }
  if(VIEW_REVERTING) return true; // a save attempted while putting the ledger back: just refuse, quietly
  viewOnlyRevert('View only \u2014 this phone can\u2019t change the ledger.');
  return true;
}

// Everything that adds, edits, deletes or saves ledger data. Hidden by CSS (body.view-only, index.html)
// and swallowed by the click guard below. Things that only read or filter (pagination, period chips,
// info buttons, PDFs and exports, device settings such as PIN lock, dark mode and the Cloud Sync card)
// are deliberately not listed.
const VIEW_ONLY_WRITE_SELECTOR = [
  '.form-actions',
  '[data-edit]', '[data-del]', '[data-finish]', '[data-add]', '[data-cancel]:not(#pinShowChange):not(#pinShowDisable)', '[data-toggle-active]',
  '[data-move]', '[data-cheque]', '[data-replace-cheque]', '[data-link-replacement]', '[data-rh-edit]', '[data-rh-del]',
  '[data-l-ok]', '[data-l-toggle]', '[data-l-return]', '[data-l-confirm]', '[data-l-cancel]', '[data-l-box]',
  '[data-toggle-form]', '[data-form-body]', '[data-snap-restore]', '[data-quick-add]', '[data-wage-add]', '[data-undo-id]',
  '#undoBtn', '#importProduction', '#restoreJsonBtn', '#saveBusinessInfo', '#saveOpening', '#saveOpeningBalances',
  '#saveRateCalc', '#saveRateChange', '#settleAllEmployees', '#la_apply', '#r_addChequeRow',
].join(',');

document.addEventListener('click', (e)=>{
  if(permsGuardClick(e)) return; // Release 3: a control this role may not use
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
    const scope = root || document.getElementById('panels');
    if(!scope || !scope.querySelectorAll) return;
    if(!VIEW_BASELINE && (on || permsLimited()) && scope.children && scope.children.length){ try{ VIEW_BASELINE = JSON.stringify(DATA); }catch(e){} } // first page drawn = the ledger is loaded
    permsApply(scope); // Release 3: hide what this account's role does not allow (works for view-only and for editing phones alike)
    if(!on) return;
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


/* ---------------------------------------------------------------------------------------------------------
 * Release 3: what a role allows, on screen.
 * An account that is not the owner's has, once its phone has been told (cloud-sync.js: cloudPermsKnown), a
 * letter string per section: v view, a add, e edit, d delete (edit letters only count while its edit switch
 * is on and the time has not run out - a phone that is view-only has just "v"). Here that becomes:
 *   - tabs the account cannot open are left out of the drawer, and opening one goes to the first tab it can;
 *   - sections it may not view are not kept on this phone at all (permsPurgeHidden);
 *   - Edit / Delete buttons, the "+ Add Sale / Recovery" shortcuts, add forms and the Settings controls are
 *     hidden when the matching letter is missing, and a click that slips through is stopped with a message;
 *   - as the last layer, save() compares the change with the ledger as it was and refuses anything the role
 *     does not allow (viewOnlySaveBlocked above), so a missed button can never change the wrong section.
 * The owner, and a phone that has never been told its permissions, are unaffected.
 * ------------------------------------------------------------------------------------------------------- */
const PERM_ACTION_WORDS = { a: 'add entries', e: 'change entries', d: 'delete entries', v: 'see' };
const PERM_ALL_TOTALS = ['production', 'reference', 'sales', 'recovery', 'expenses', 'wages', 'loans', 'family', 'materials']; // what Overview / Graphs add up
// Which section(s) a drawer tab needs to be seen. '*' = the whole-business pages.
const PERM_TAB_SECTIONS = {
  graphs: '*', // (overview is decided card by card: permsOverviewAllowed)
  production: ['production'], warpbeams: ['production'],
  sale: ['sales'], recovery: ['recovery'], expense: ['expenses'], wages: ['wages'], loans: ['loans'],
  family: ['family'], personal: ['family'], personalloans: ['family'],
  ownerloans: ['tools'], // owner's own money lent to the business: owner-only (tools is never in a preset role)
  warp: ['materials'], weft: ['materials'],
  ratecalc: ['tools'], checkpoints: ['tools'],
  // settings and backup are device pages: always shown (what is inside them is limited below)
};
// The Settings master lists (input id new_<key>) and the section each belongs to.
const PERM_LIST_SECTIONS = { qualities: 'reference', looms: 'reference', employees: 'reference', clients: 'sales', dyeingUnits: 'sales', banks: 'recovery', warpTypes: 'materials', weftTypes: 'materials', familyMembers: 'family' };
// Buttons that save one Settings card, and the section (and letter) they change.
const PERM_BUTTON_SECTIONS = { saveBusinessInfo: ['business', 'e'], saveOpening: ['tools', 'e'], saveOpeningBalances: ['tools', 'e'], saveRateCalc: ['tools', 'e'], saveRateChange: ['wages', 'e'], settleAllEmployees: ['wages', 'e'], la_apply: ['loans', 'e'] };
const PERM_QUICK_ADD = { sale: 'sales', recovery: 'recovery' };
// Overview: every card (and banner) is tagged with the sections whose data it shows, and a limited account sees it
// only when it may VIEW ALL of them. A card that reads a section the role cannot see would show wrong (zero) figures,
// so it is left out. `banner` cards do not count when deciding whether the Overview page opens at all, and
// `device: true` = about the phone itself, not the ledger (shown only on the owner's / an unlimited phone).
// Cards are named where overview.js and panels-daily.js draw them (ovCardOn('<id>')).
const PERM_MONEY_ALL = ['expenses', 'wages', 'loans', 'family', 'materials'];
const PERM_OVERVIEW_CARDS = {
  reminders_cheques: { needs: ['recovery'], banner: true },                    // the cheque rows of the Reminders banner
  reminders_clients: { needs: ['sales', 'recovery'], banner: true },           // "clients quiet 30+ days with a balance due"
  beams_ending:      { needs: ['production'], banner: true },
  backup_reminder:   { needs: [], banner: true, device: true },
  pending_l:         { needs: ['sales'] },                                     // sales sent to a dyeing unit, L (AIL) not yet logged
  pending_cheques:   { needs: ['recovery'] },
  bounced_cheques:   { needs: ['recovery'] },
  stock:             { needs: ['production', 'sales'] },                       // stock by quality, Produced / Sold / In Stock
  cash_position:     { needs: ['tools', 'recovery'].concat(PERM_MONEY_ALL) },  // the Cash Position tile and its checkpoint note
  client_statement:  { needs: ['sales', 'recovery'] },
  sales_receivables: { needs: ['sales', 'recovery'] },
  warp_usage:        { needs: ['production', 'materials'] },                   // warp purchases (Materials) against beams woven
  receivables_aging: { needs: ['sales', 'recovery'] },
  client_quality:    { needs: ['sales'] },
  owner_loans:       { needs: ['tools'] },                                     // money the owner lent the business, and what is still owed
  expenses_material: { needs: PERM_MONEY_ALL },                                // expenses, wages paid, family, personal, warp / weft cost, loans
  profit_loss:       { needs: ['sales'].concat(['expenses', 'wages', 'family', 'materials']) },
};
// May this account see the Overview card `id`? The owner and unlimited phones: always.
function permsCardAllowed(id){
  if(!permsLimited()) return true;
  const c = PERM_OVERVIEW_CARDS[id];
  if(!c) return false;                       // an untagged card is never shown to a limited account
  if(c.device) return false;
  return c.needs.every(sec=> permsCan(sec, 'v'));
}
// The Overview page opens for a limited account only if at least one real card (not just a banner) can be shown.
function permsOverviewAllowed(){
  if(!permsLimited()) return true;
  return Object.keys(PERM_OVERVIEW_CARDS).some(id=> !PERM_OVERVIEW_CARDS[id].banner && permsCardAllowed(id));
}
function PERM_SECTION_NAME(sec){ try{ return (CLOUD_SECTION_LABELS[sec] || sec); }catch(e){ return sec; } }

// True for a signed-in account that is not the owner and whose section permissions are known.
function permsLimited(){
  try{
    if(typeof cloudIsOwner !== 'function' || typeof cloudPermsKnown !== 'function') return false;
    return !cloudIsOwner() && cloudPermsKnown() !== null;
  }catch(e){ return false; }
}
// May this account do `letter` in section `sec` right now? The owner and un-limited phones: yes.
function permsCan(sec, letter){
  if(!permsLimited()) return true;
  if(letter !== 'v' && viewOnly()) return false; // switched off or expired since the note was read
  return cloudSectionPerm(sec).indexOf(letter) >= 0;
}
function permsTabAllowed(id){
  if(id === 'inbox') return typeof cloudIsOwner === 'function' && cloudIsOwner(); // the approvals inbox is the owner's alone
  if(id === 'audit') return typeof cloudIsOwner === 'function' && cloudIsOwner(); // the audit trail is the owner's alone, on every phone
  if(!permsLimited()) return true;
  if(id === 'overview') return permsOverviewAllowed();
  const need = PERM_TAB_SECTIONS[id];
  if(!need) return true;
  return (need === '*' ? PERM_ALL_TOTALS : need).every(sec=> permsCan(sec, 'v'));
}
function permsFirstTab(){
  const t = (typeof TABS !== 'undefined' ? TABS : []).find(x=> permsTabAllowed(x.id));
  return t ? t.id : 'settings';
}

// Whole-ledger key -> the section that keeps it (cloud-sync.js), for the data-edit / data-del "key:id" buttons.
function permsSectionOfKey(key){ try{ return cloudSectionOf(key); }catch(e){ return null; } }
// What a control needs: { sec, letter } (letter null = never for a limited account), or null when it is free to use.
function permsNeedOf(el){
  if(!el || !el.getAttribute) return null;
  const attr = n => el.getAttribute(n);
  const has = n => (el.hasAttribute ? el.hasAttribute(n) : attr(n) !== null && attr(n) !== undefined);
  if(has('data-edit')) return { sec: permsSectionOfKey(String(attr('data-edit')).split(':')[0]), letter: 'e' };
  if(has('data-del')) return { sec: permsSectionOfKey(String(attr('data-del')).split(':')[0]), letter: 'd' };
  if(has('data-wage-add')) return { sec: 'wages', letter: 'a' };
  if(has('data-quick-add')){ const sec = PERM_QUICK_ADD[attr('data-quick-add')]; return sec ? { sec, letter: 'a' } : null; }
  if(has('data-undo-id') || has('data-snap-restore')) return { sec: null, letter: null };
  const id = attr('id');
  if(id === 'undoBtn' || id === 'restoreJsonBtn' || id === 'importProduction') return { sec: null, letter: null }; // these can touch every section
  if(id && PERM_BUTTON_SECTIONS[id]) return { sec: PERM_BUTTON_SECTIONS[id][0], letter: PERM_BUTTON_SECTIONS[id][1] };
  return null;
}
function permsNeedMet(need){
  if(!need) return true;
  if(!permsLimited()) return true;
  if(!need.letter) return false;
  return permsCan(need.sec, need.letter);
}
function permsNeedMessage(need){
  if(!need || !need.letter) return 'Not allowed \u2014 your role can\u2019t use this.';
  return 'Not allowed \u2014 your role can\u2019t ' + PERM_ACTION_WORDS[need.letter] + ' in ' + PERM_SECTION_NAME(need.sec) + '.';
}
// The tab whose page is on screen (its section decides what the add form and the empty-state text do).
function permsPanelSection(){
  try{
    const need = PERM_TAB_SECTIONS[typeof CUR_PANEL !== 'undefined' ? CUR_PANEL : ''];
    return Array.isArray(need) ? need[0] : null;
  }catch(e){ return null; }
}
const PERM_HIDE_CLASS = 'perm-hide';
function permsApply(scope){
  if(!permsLimited() || !scope || !scope.querySelectorAll) return;
  try{
    scope.querySelectorAll('[data-edit],[data-del],[data-quick-add],[data-wage-add],[data-undo-id],[data-snap-restore],#undoBtn,#restoreJsonBtn,#importProduction,' + Object.keys(PERM_BUTTON_SECTIONS).map(i=> '#' + i).join(',')).forEach(el=>{
      if(!permsNeedMet(permsNeedOf(el))) el.classList.add(PERM_HIDE_CLASS);
    });
    const undo = document.getElementById && document.getElementById('undoBtn');
    if(undo && undo.classList && !permsNeedMet({ sec: null, letter: null })) undo.classList.add(PERM_HIDE_CLASS); // the header button sits outside the panel
    // The add form of a page: hidden when the role can neither add nor edit in that page's section.
    const psec = permsPanelSection();
    if(psec && !permsCan(psec, 'a') && !permsCan(psec, 'e')){
      scope.querySelectorAll('.form-actions').forEach(fa=>{
        const card = fa.closest && fa.closest('.card');
        if(card && !card.querySelector('table, [data-log], .log-cards, .logcard')) card.classList.add(PERM_HIDE_CLASS); else fa.classList.add(PERM_HIDE_CLASS);
      });
    }
    scope.querySelectorAll('[data-form-body],[data-toggle-form]').forEach(el=>{
      const key = el.getAttribute('data-form-body') || el.getAttribute('data-toggle-form');
      const sec = permsSectionOfKey(key);
      if(sec && !permsCan(sec, 'a') && !permsCan(sec, 'e')) el.classList.add(PERM_HIDE_CLASS);
    });
    // Settings master lists: the card of a list this role cannot change in is hidden, and its reorder / switch buttons with it.
    scope.querySelectorAll('[id^="new_"]').forEach(el=>{
      const sec = PERM_LIST_SECTIONS[String(el.id).slice(4)];
      if(!sec) return;
      const card = el.closest && el.closest('.card');
      if(!permsCan(sec, 'a') && !permsCan(sec, 'e') && !permsCan(sec, 'd')){ if(card) card.classList.add(PERM_HIDE_CLASS); return; }
      if(!permsCan(sec, 'a')) (el.closest('.grid') || el).classList.add(PERM_HIDE_CLASS);
      if(!permsCan(sec, 'e') && card) card.querySelectorAll('[data-toggle-active],[data-move]').forEach(b=> b.classList.add(PERM_HIDE_CLASS));
    });
  }catch(e){ console.error(e); }
}
// Capture-phase click guard: stops a control this role may not use, even if it was left visible.
function permsGuardClick(e){
  if(!permsLimited()) return false;
  try{
    const t = e.target && e.target.closest ? e.target : null;
    if(!t) return false;
    const hit = t.closest('[data-edit],[data-del],[data-quick-add],[data-wage-add],[data-undo-id],[data-snap-restore],#undoBtn,#restoreJsonBtn,#importProduction,' + Object.keys(PERM_BUTTON_SECTIONS).map(i=> '#' + i).join(','));
    let need = hit ? permsNeedOf(hit) : null;
    if(!need){
      // Add / Save buttons of a page's form.
      const fa = t.closest('.form-actions'), psec = permsPanelSection();
      if(fa && psec && !permsCan(psec, 'a') && !permsCan(psec, 'e')) need = { sec: psec, letter: 'a' };
    }
    if(!need || permsNeedMet(need)) return false;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if(typeof showToast === 'function') showToast(permsNeedMessage(need), 3000);
    return true;
  }catch(err){ console.error(err); return false; }
}

// The first change (in section order) that goes beyond what the role allows: { sec, letter } or null.
// Records are matched by id: a new id needs "a", a missing one "d", a changed one "e"; a value that is not a
// list (business info, opening balance ...) counts as an edit. An empty list or object appearing where nothing
// was stored before is only a default being filled in, not a change.
function permsViolation(){
  if(!permsLimited() || !VIEW_BASELINE) return null;
  let base;
  try{ base = cloudSplit(JSON.parse(VIEW_BASELINE)); }catch(e){ return null; }
  const cur = cloudSplit(DATA);
  const same = (x, y)=> JSON.stringify(x) === JSON.stringify(y);
  const empty = v => v === undefined || v === '' || v === 0 || (Array.isArray(v) && !v.length) || (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
  for(const sec of cloudSectionIds()){
    const b = base[sec] || {}, c = cur[sec] || {};
    if(same(b, c)) continue;
    const keys = Object.keys(Object.assign({}, b, c)).filter(k=> k !== 'deletedIds'); // deletion notes are worked out from the deletions themselves
    for(const k of keys){
      const x = b[k], y = c[k];
      if(same(x, y) || (empty(x) && empty(y))) continue;
      if(Array.isArray(x) || Array.isArray(y)){
        const xa = Array.isArray(x) ? x : [], ya = Array.isArray(y) ? y : [];
        const keyOf = r => (r && typeof r === 'object' && r.id !== undefined) ? 'id:' + r.id : 'raw:' + JSON.stringify(r);
        const xm = new Map(xa.map(r=> [keyOf(r), r])), ym = new Map(ya.map(r=> [keyOf(r), r]));
        let add = false, del = false, edit = false;
        ym.forEach((r, id)=>{ if(!xm.has(id)) add = true; else if(!same(xm.get(id), r)) edit = true; });
        xm.forEach((r, id)=>{ if(!ym.has(id)) del = true; });
        if(add && !permsCan(sec, 'a')) return { sec, letter: 'a' };
        if(edit && !permsCan(sec, 'e')) return { sec, letter: 'e' };
        if(del && !permsCan(sec, 'd')) return { sec, letter: 'd' };
        if(!add && !edit && !del && !permsCan(sec, 'e')) return { sec, letter: 'e' }; // e.g. only the order changed
      } else if(!permsCan(sec, 'e')) return { sec, letter: 'e' };
    }
  }
  return null;
}

// Renaming a quality, employee, loom, client ... in Settings also rewrites every record that used the old name,
// and for a quality that includes its wage rate history (kept in the Wages section). A limited account cannot
// see or change sections outside its role, so on its phone that rewrite would only be half done and the rates
// would be left under the old name in the cloud. So it may rename only when it may edit every section the
// rewrite reaches; the owner (and a phone with no limits) is unaffected. Returns null (fine) or { sec, letter }.
function permsRenameBlocked(key){
  if(!permsLimited()) return null;
  const secs = {};
  try{ ((typeof MASTER_REF_FIELDS !== 'undefined' && MASTER_REF_FIELDS[key]) || []).forEach(f=>{ secs[permsSectionOfKey(f[0])] = true; }); }catch(e){}
  if(key === 'qualities') secs.wages = true;   // the rate history is keyed by quality name
  if(key === 'banks') secs.recovery = true;    // bank names live inside each recovery's cheques
  const own = PERM_LIST_SECTIONS[key];
  if(own && !permsCan(own, 'e')) return { sec: own, letter: 'e' }; // the list itself first, so the message names the obvious section
  for(const sec of Object.keys(secs)){ if(sec && !permsCan(sec, 'e')) return { sec, letter: 'e' }; }
  return null;
}

// Sections this account may not view are not kept on the phone: whatever is stored for them (from an earlier,
// wider role) is emptied and the phone is saved. Never sent anywhere: only sections it may change are ever pushed.
async function permsPurgeHidden(){
  if(!permsLimited()) return false;
  let did = false;
  const hidden = cloudSectionIds().filter(sec=> !cloudCanViewSection(sec));
  for(const sec of hidden){
    const sc = (typeof CLOUD_SECTIONS !== 'undefined' ? CLOUD_SECTIONS : []).find(x=> x.id === sec);
    if(!sc) continue;
    let wiped = false;
    sc.keys.forEach(k=>{
      const v = DATA[k];
      if(Array.isArray(v) && v.length){ DATA[k] = []; did = true; wiped = true; }
      else if(typeof v === 'number' && v !== 0){ DATA[k] = 0; did = true; wiped = true; }
      else if(typeof v === 'string' && v !== ''){ DATA[k] = ''; did = true; wiped = true; }
      else if(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length){ DATA[k] = {}; did = true; wiped = true; }
    });
    // Remember it: the owner signing in on this same phone later must bring this section back from the cloud,
    // and must never send this emptied copy up over the real one (cloud-sync.js: cloudPurgedAdd / cloudPurgedList).
    if(wiped && typeof cloudPurgedAdd === 'function') cloudPurgedAdd(sec);
  }
  if(!did) return false;
  try{ if(typeof tombResetBaseline === 'function') tombResetBaseline(); }catch(e){}
  try{ if(typeof UNDO_STACK !== 'undefined'){ UNDO_SUPPRESS = true; UNDO_STACK.length = 0; if(typeof updateUndoButton === 'function') updateUndoButton(); } }catch(e){}
  await viewOnlyAllowSave(()=> save());
  return true;
}
