/* App shell: navigation drawer, custom dropdowns, switchTab, generic simple-list pages
 * (Qualities/Clients/Employees), name tidy-up, backup files + password, safety copies, storage
 * health, CSV export, quick add, new-version prompt, undo, Backup & Restore. */

/* ---------------- Nav ---------------- */
function renderNav(active){
  const nav = document.getElementById('tabs');
  const head = `<div class="drawer-head"><div class="mark"><img src="${APP_MARK_PNG}" alt=""></div><div class="appname">Ibrahim Weaving</div><div class="appsub">Power Loom Ledger</div></div>`;
  nav.innerHTML = head + TABS.map(t=>`<button data-tab="${t.id}" class="${t.id===active?'active':''}"><span class="icon">${ICONS[t.icon]||''}</span>${t.label}</button>`).join('');
  nav.querySelectorAll('button[data-tab]').forEach(b=> b.onclick = ()=> switchTab(b.dataset.tab));
  const current = TABS.find(t=>t.id===active);
  const titleEl = document.getElementById('appbarTitle');
  if(titleEl && current) titleEl.textContent = current.label;
}
function openDrawer(){
  document.getElementById('tabs').classList.add('open');
  document.getElementById('scrim').classList.add('open');
  // Without this, a scroll gesture that starts on the drawer list can "chain" past its own
  // top/bottom edge and scroll the page underneath once the drawer runs out of room to scroll
  // itself. overscroll-behavior:contain on nav.tabs handles most browsers; locking body scroll
  // here is the fallback for the ones that still let it leak through.
  document.body.style.overflow = 'hidden';
}
function closeDrawer(){
  document.getElementById('tabs').classList.remove('open');
  document.getElementById('scrim').classList.remove('open');
  document.body.style.overflow = '';
}
// Wraps every <select> under `root` with a custom tap-to-close dropdown (see .sel-wrap /
// .sel-fake / .sel-list in the stylesheet). The real <select> is kept in the DOM, fully hidden,
// as the source of truth — this only changes how a person picks an option, not how the rest of
// the app reads its value or listens for 'change'. Safe to call repeatedly: already-wrapped
// selects (data-enhanced) are skipped, so re-running it after a partial re-render is harmless.
function enhanceSelects(root){
  if(!root) return;
  root.querySelectorAll('select:not([data-enhanced])').forEach(sel=>{
    sel.dataset.enhanced = '1';
    const wrap = document.createElement('div');
    wrap.className = 'sel-wrap';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.setAttribute('aria-hidden','true');
    sel.tabIndex = -1;
    const fake = document.createElement('button');
    fake.type = 'button';
    fake.className = 'sel-fake';
    const list = document.createElement('div');
    list.className = 'sel-list';
    list.hidden = true;
    const syncFake = ()=>{
      const opt = sel.options[sel.selectedIndex];
      fake.textContent = opt ? opt.textContent : '';
      fake.disabled = sel.disabled;
    };
    const closeList = ()=>{ list.hidden = true; fake.setAttribute('aria-expanded','false'); };
    const makeItem = (opt)=>{
      const item = document.createElement('div');
      item.className = 'sel-item' + (opt.disabled?' disabled':'') + (opt.selected?' selected':'');
      item.textContent = opt.textContent;
      if(!opt.disabled){
        item.addEventListener('click', ()=>{
          sel.value = opt.value;
          syncFake();
          closeList();
          // Some wiring listens for 'change' (most selects), some for 'input' (the cheque-row
          // bank/status fields, wired identically to their sibling text inputs) — fire both so
          // a pick through the custom list behaves exactly like a real native selection.
          sel.dispatchEvent(new Event('input', {bubbles:true}));
          sel.dispatchEvent(new Event('change', {bubbles:true}));
        });
      }
      return item;
    };
    const buildList = ()=>{
      list.innerHTML = '';
      Array.from(sel.children).forEach(child=>{
        if(child.tagName === 'OPTGROUP'){
          const lbl = document.createElement('div');
          lbl.className = 'sel-group-label';
          lbl.textContent = child.label;
          list.appendChild(lbl);
          Array.from(child.children).forEach(opt=>list.appendChild(makeItem(opt)));
        } else if(child.tagName === 'OPTION'){
          list.appendChild(makeItem(child));
        }
      });
    };
    fake.addEventListener('click', ()=>{
      if(sel.disabled) return;
      if(!list.hidden){ closeList(); return; }
      buildList();
      list.hidden = false;
      fake.setAttribute('aria-expanded','true');
      const r = fake.getBoundingClientRect();
      if(window.innerHeight - r.bottom < 220 && r.top > 220){
        list.style.top = 'auto'; list.style.bottom = 'calc(100% + 4px)';
      } else {
        list.style.top = 'calc(100% + 4px)'; list.style.bottom = 'auto';
      }
    });
    wrap.appendChild(fake);
    wrap.appendChild(list);
    syncFake();
    // Code elsewhere sets `select.value = ...` directly (loom → employee auto-fill, Edit
    // pre-filling a row). Without this the real value changed but the visible label kept
    // showing the old choice ("—"), so keep the label in step with every assignment.
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(sel, 'value', {
      configurable: true,
      get(){ return nativeValue.get.call(this); },
      set(x){ nativeValue.set.call(this, x); syncFake(); },
    });
  });
}
let CURRENT_TAB = 'overview'; // tracked here (not read off the DOM) so the back-button handler knows where it is
// Remembers which tab was open so a mid-session reload — e.g. an accidental pull-to-refresh
// while scrolled down on a page — reopens that same page instead of always landing back on
// Overview. sessionStorage (not localStorage) on purpose: it survives a reload of the same
// browser/WebView tab but starts fresh — back at Overview — the next time the app is actually
// opened from the icon, which is the expected first screen for a new session.
const LAST_TAB_KEY = 'khata-last-tab';
function rememberTab(id){
  try{ sessionStorage.setItem(LAST_TAB_KEY, id); }catch(e){ /* best effort only */ }
}
function restoredTab(){
  try{
    const id = sessionStorage.getItem(LAST_TAB_KEY);
    return TABS.some(t=>t.id===id) ? id : 'overview';
  }catch(e){ return 'overview'; }
}
// Header pill above the version badge: total meters produced in the current wage week (Friday to
// Thursday), all qualities and looms together, worked out from today's date so it rolls over by
// itself each Friday. Refreshed on every tab render, after every save, and when the app comes
// back to the foreground.
function updateWeekBadge(){
  const el = document.getElementById('weekBadge');
  if(!el) return;
  try{
    if((typeof encEnabled === 'function' && encEnabled() && !ENC_DEK) || !DATA || !Array.isArray(DATA.production)){ el.hidden = true; return; }
    const w = weeklyProductionTotal(todayStr());
    el.textContent = 'Week ' + fmtQtyMtr(w.meters) + ' m';
    const tip = `Production this week, ${fmtDate(w.from)} (Fri) to ${fmtDate(w.to)} (Thu): ${fmtQtyMtr(w.meters)} m, all qualities together.`;
    el.title = tip; el.setAttribute('aria-label', tip);
    el.hidden = false;
  }catch(e){ el.hidden = true; }
}
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) updateWeekBadge(); });
function switchTab(id){
  CURRENT_TAB = id;
  rememberTab(id);
  renderNav(id);
  refreshBackupStrip();
  updateWeekBadge();
  closeDrawer();
  const scroller = document.getElementById('panels');
  document.getElementById('panels').innerHTML = renderPanel(id);
  if(scroller) scroller.scrollTop = 0;
  wirePanel(id);
  // Runs after wirePanel so it sees each select's truly final selected option — a few filters
  // (e.g. pf_quality, sf_client, rf_client) get their value set here in JS rather than via a
  // `selected` attribute in the template, and enhanceSelects needs that settled first.
  enhanceSelects(document.getElementById('panels'));
}

/* ---------------- Helpers for option lists ---------------- */
function opts(arr, valueKey='name'){ return arr.map(x=>`<option value="${escHtml(x[valueKey])}">${escHtml(x[valueKey])}</option>`).join(''); }

/* ---------------- Generic simple-list panel (Qualities/Clients/Employees) ---------------- */
function settingsPanel(){
  const section = (title, key, placeholder, isName, hasActiveToggle) => `
    <div class="card">
      <div class="card-head"><h2>${title}</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Use ↑/↓ to reorder — the order here is the order shown in every dropdown that lists these, so move the ones you use most to the top.${hasActiveToggle?(key==='clients'?' Deactivate a client you no longer deal with so they drop out of new-entry dropdowns and, once nothing is owed, out of the client-wise tables — their history stays intact and they can be reactivated anytime.':' Deactivate anyone no longer working so they drop out of new-entry dropdowns — their history stays intact and they can be reactivated anytime.'):''}</p>
      <div class="grid cols-2">
        <div class="field"><label>Name</label><input id="new_${key}" placeholder="${placeholder}"></div>
      </div>
      <button class="primary" id="add_${key}" data-add="${key}">Add ${title.slice(0,-1)}</button>
      <button class="ghost" id="cancel_${key}" data-cancel="${key}" style="display:none">Cancel Edit</button>
      <table style="margin-top:14px">
        <thead><tr><th>Name</th><th></th></tr></thead>
        <tbody>
          ${DATA[key].length ? DATA[key].map((x,idx)=>{
            const inactive = hasActiveToggle && x.active === false;
            const nameCell = isName ? `<span class="name">${escHtml(x.name)}</span>` : escHtml(x.name);
            return `<tr${inactive?' style="opacity:0.55"':''}><td>${nameCell}${inactive?' <span class="badge" style="background:var(--paper-dim);color:var(--ink-soft)">Inactive</span>':''}</td><td style="white-space:nowrap"><span class="row-actions">${moveBtns(key,idx,idx===0,idx===DATA[key].length-1)}${hasActiveToggle?`<button class="ghost rowbtn toggle" data-toggle-active="${key}:${x.id}"><span class="lbl">${inactive?'Activate':'Deactivate'}</span></button>`:''}${actionBtns(key,x.id)}</span></td></tr>`;
          }).join('')
            : `<tr><td colspan="2" class="empty">No entries yet</td></tr>`}
        </tbody>
      </table>
    </div>`;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return `<div class="card"><h2>Appearance</h2>
    <label style="display:flex;align-items:center;gap:10px;font-weight:500;cursor:pointer">
      <input type="checkbox" id="darkModeToggle" ${isDark?'checked':''} style="width:18px;height:18px">
      Dark Mode
    </label>
    <label style="display:flex;align-items:center;gap:10px;font-weight:500;cursor:pointer;margin-top:12px">
      <input type="checkbox" id="logCardsToggle" ${document.documentElement.getAttribute('data-logs')==='table'?'':'checked'} style="width:18px;height:18px">
      Show logs as cards on phones
    </label>
    <p class="note" style="margin-top:6px">Turn off to go back to the classic sideways-scrolling tables. Only affects small screens.</p>
  </div>
  ` + pinLockSection() + encryptionSection() + beamAlertSettingsCard() + `
  <div class="card"><div class="card-head"><h2>Business Info</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>Shown on the header of printed Sale receipts (Sales Log → Receipt). Leave any of these blank to leave that line off the receipt.</p>
    <div class="grid cols-1">
      ${field('Business Name','biz_name','text',`value="${(DATA.businessInfo?.name||'').replace(/"/g,'&quot;')}"`)}
    </div>
    <div class="grid cols-2" style="margin-top:12px">
      ${field('Address','biz_address','text',`value="${(DATA.businessInfo?.address||'').replace(/"/g,'&quot;')}"`)}
      ${field('Phone','biz_phone','text',`value="${(DATA.businessInfo?.phone||'').replace(/"/g,'&quot;')}"`)}
    </div>
    <button class="primary" id="saveBusinessInfo" style="margin-top:12px">Save</button></div>
  ` + section('Qualities','qualities','e.g. 44 Picks',false) + section('Clients','clients','e.g. Ali Textiles',true,true)
    + section('Employees','employees','e.g. Nasir Ahmed',true,true) + section('Looms','looms','e.g. 9',false)
    + loomAssignmentsSection()
    + section('Warp Types','warpTypes','e.g. 150.144 Micro',false) + section('Weft Types','weftTypes','e.g. 20/1 Carded',false)
    + section('Dyeing Units','dyeingUnits','e.g. Al-Karam Dyeing',false)
    + section('Banks','banks','e.g. Meezan Bank',false);
}
// Settings card for the PIN Lock feature — two states: not set up yet (just pick a PIN) vs.
// already enabled (status + two actions, each of which asks for the *current* PIN again
// before changing anything, since this is the one settings card where "already inside
// Settings" shouldn't be enough on its own).
function pinLockSection(){
  const infoNote = `Locks the whole app behind a numeric PIN (4, 6 or 8 digits — longer is harder to guess). Everything stays on this device — no email or online service. If you forget the PIN, "Forgot PIN?" on the lock screen asks the recovery question you set here; the right answer lets you choose a new PIN. Pick a question only you can answer, use an answer that's hard to guess (${PIN_ANSWER_MIN}+ characters — capitals and extra spaces are ignored), and keep backups current in case you forget both. <b>Note:</b> this is a screen lock, not encryption — it keeps people out of the app, but the ledger data itself isn't scrambled on the phone, and normal backups can be read by anyone who gets the file. Tick “Protect this backup with a password” in Backup &amp; Restore for backups you send anywhere.`;
  const ansAttrs = 'autocomplete="off" autocapitalize="off" spellcheck="false"';
  if(!isPinEnabled()){
    return `<div class="card">
      <div class="card-head"><h2>PIN Lock</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>${infoNote}</p>
      <div class="grid cols-2">
        <div class="field"><label>PIN length</label><select id="pin_len"><option value="4">4 digits</option><option value="6" selected>6 digits (recommended)</option><option value="8">8 digits</option></select></div>
        ${field('New PIN','pin_new1','password',`inputmode="numeric" maxlength="8" placeholder="••••••"`)}
        ${field('Confirm PIN','pin_new2','password',`inputmode="numeric" maxlength="8" placeholder="••••••"`)}
      </div>
      <p class="note" style="margin:14px 0 8px">Recovery question — asked if you ever forget the PIN.</p>
      <div class="grid cols-1">${field('Question','pin_q','text',`maxlength="120" placeholder="A question only you can answer" autocomplete="off"`)}</div>
      <div class="grid cols-2" style="margin-top:10px">
        ${field('Answer','pin_a1','password',ansAttrs)}
        ${field('Confirm answer','pin_a2','password',ansAttrs)}
      </div>
      <p class="note" id="pinSetupError" style="margin:10px 0 0;min-height:16px"></p>
      <button class="primary" id="pinEnableBtn" style="margin-top:4px">Enable PIN Lock</button>
    </div>`;
  }
  const hasRec = hasRecovery();
  return `<div class="card">
    <div class="card-head"><h2>PIN Lock</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>${infoNote}</p>
    <p class="note" style="margin:0 0 12px">Enabled. ${hasRec ? 'Recovery question is set.' : '<b>No recovery question yet</b> — set one below so a forgotten PIN can be recovered.'}</p>
    <button class="primary" id="pinLockNowBtn" type="button" style="margin:0 0 10px;width:100%">Lock now</button>
    <div class="grid cols-2">
      <button class="ghost" id="pinShowChange" data-cancel="pinChange">Change PIN</button>
      <button class="ghost" id="pinShowDisable" data-cancel="pinDisable">Disable PIN Lock</button>
    </div>
    <button class="ghost" id="pinShowRec" style="margin-top:10px;width:100%">${hasRec ? 'Change Recovery Question' : 'Set Recovery Question'}</button>
    <div id="pinChangeWrap" style="display:none;margin-top:14px">
      ${field('Current PIN','pin_cur','password',`inputmode="numeric" maxlength="${PIN_LENGTH}" placeholder="••••"`)}
      <div class="grid cols-2" style="margin-top:10px">
        <div class="field"><label>PIN length</label><select id="pin_change_len"><option value="4"${PIN_LENGTH===4?' selected':''}>4 digits</option><option value="6"${PIN_LENGTH===6?' selected':''}>6 digits (recommended)</option><option value="8"${PIN_LENGTH===8?' selected':''}>8 digits</option></select></div>
        ${field('New PIN','pin_change_new1','password',`inputmode="numeric" maxlength="8" placeholder="••••"`)}
        ${field('Confirm New PIN','pin_change_new2','password',`inputmode="numeric" maxlength="8" placeholder="••••"`)}
      </div>
      <p class="note" id="pinChangeError" style="margin:8px 0;min-height:16px"></p>
      <button class="primary" id="pinChangeSaveBtn">Save New PIN</button>
    </div>
    <div id="pinRecWrap" style="display:${hasRec ? 'none' : 'block'};margin-top:14px">
      ${hasRec ? `<p class="note" style="margin:0 0 10px">Current question: <b>${escHtml(getRecoveryQuestion())}</b></p>` : ''}
      ${field('Current PIN','pin_rec_cur','password',`inputmode="numeric" maxlength="${PIN_LENGTH}" placeholder="••••"`)}
      <div class="grid cols-1" style="margin-top:10px">${field('Question','pin_rec_q','text',`maxlength="120" placeholder="A question only you can answer" autocomplete="off"`)}</div>
      <div class="grid cols-2" style="margin-top:10px">
        ${field('Answer','pin_rec_a1','password',ansAttrs)}
        ${field('Confirm answer','pin_rec_a2','password',ansAttrs)}
      </div>
      <p class="note" id="pinRecError" style="margin:8px 0;min-height:16px"></p>
      <button class="primary" id="pinRecSaveBtn">Save Recovery Question</button>
    </div>
    <div id="pinDisableWrap" style="display:none;margin-top:14px">
      ${field('Current PIN to confirm','pin_disable_cur','password',`inputmode="numeric" maxlength="${PIN_LENGTH}" placeholder="••••"`)}
      <p class="note" id="pinDisableError" style="margin:8px 0;min-height:16px"></p>
      <button class="primary" id="pinDisableSaveBtn" style="background:var(--rust-deep)">Confirm Disable</button>
    </div>
  </div>`;
}
// Lets you say "Molvi Gafar and Riaz run looms 1-8" once, instead of picking them from the
// dropdown on every single Log Production entry. Quick Assign applies the same pair to
// several looms at once (for exactly this kind of "N employees run M looms" split); the table
// below it is for fixing up one loom at a time. Deliberately only Employee 1/2 — a 3rd
// employee is typically a one-off fill-in (covering for someone on leave, or an outside
// worker who may never work again), not tied to the loom, so it's left out of assignments
// entirely and keeps working the old way on the entry form. Either way this is only ever a
// starting point: every field it fills on the entry form stays editable, and a loom with
// nothing assigned just leaves the employee fields blank like before.
function loomAssignmentsSection(){
  if(!DATA.looms.length){
    return `<div class="card"><h2>Loom Assignments</h2><div class="empty">Add some Looms above first.</div></div>`;
  }
  const loomChecks = DATA.looms.map(l=>
    `<label style="display:inline-flex;align-items:center;gap:6px;margin:0 14px 8px 0;font-weight:400">
      <input type="checkbox" class="la_loom_pick" value="${escHtml(l.name)}"> ${escHtml(l.name)}
    </label>`).join('');
  const rows = DATA.looms.map(l=>{
    const a = loomAssignmentFor(l.name);
    return `<tr>
      <td><span class="name">${escHtml(l.name)}</span></td>
      <td>${employeeInlineSelect(`la_e1_${l.id}`, a?.e1)}</td>
      <td>${employeeInlineSelect(`la_e2_${l.id}`, a?.e2)}</td>
    </tr>`;
  }).join('');
  return `
    <div class="card">
      <div class="card-head"><h2>Loom Assignments</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Set which two employees usually run each loom. Picking a loom in Log Production will auto-fill these two — still fully editable there. A 3rd employee (a fill-in for someone on leave, or an outside worker) is handled separately on the entry form as before, and isn't part of this assignment.</p>
      <div class="group-label" style="margin-top:0">Quick Assign</div>
      <div style="margin-bottom:10px">${loomChecks}</div>
      <div class="grid cols-2">
        ${employeeSelectField('Employee 1','la_qa_e1')}
        ${employeeSelectField('Employee 2','la_qa_e2')}
      </div>
      <button class="primary" id="la_apply" type="button" style="margin-top:10px">Assign to Selected Looms</button>
      <div class="group-label">Per-Loom</div>
      <table>
        <thead><tr><th>Loom</th><th>Employee 1</th><th>Employee 2</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
// Same options as employeeSelectField but with a plain id (no wrapping .field/<label>) so it
// drops straight into a table cell, and pre-selects an existing assignment's employee if any.
function employeeInlineSelect(id, selected=''){
  const active = DATA.employees.filter(e=>e.active !== false);
  const inactive = DATA.employees.filter(e=>e.active === false);
  const opt = (e)=> `<option value="${escHtml(e.name)}"${e.name===selected?' selected':''}>${escHtml(e.name)}</option>`;
  const inactiveHtml = inactive.length ? `<optgroup label="Inactive">${inactive.map(opt).join('')}</optgroup>` : '';
  return `<select id="${id}" class="la_inline"><option value=""${!selected?' selected':''}>—</option>${active.map(opt).join('')}${inactiveHtml}</select>`;
}

/* ---------------- Master-list names: tidy-up, duplicate guard, rename cascade ---------------- */
// Sales, recoveries, production etc. store a client / quality / employee / loom / bank by its
// NAME (text), not by an id. So renaming an entry in Settings has to rewrite every record that
// used the old name — otherwise the old records would show up as a second, separate client and
// balances would split in two. Names are also compared ignoring case and extra spaces, so
// "Ali Textiles" and "ali  textiles " can't both exist.
const normalizeMasterName = s => String(s==null?'':s).replace(/\s+/g,' ').trim();
const masterNameKey = s => normalizeMasterName(s).toLowerCase();
const MASTER_REF_FIELDS = {
  clients:   [['sale','client'], ['recovery','client']],
  qualities: [['production','quality'], ['sale','quality']],
  employees: [['wageBonuses','employee'], ['wagePayments','employee'], ['wageSettlements','employee'], ['loanPayments','employee'],
              ['production','e1'], ['production','e2'], ['production','e3'], ['loomAssignments','e1'], ['loomAssignments','e2']],
  looms:     [['production','loom'], ['warpBeams','loom'], ['loomAssignments','loom']],
  warpTypes: [['warp','type'], ['warpBeams','warpType']],
  weftTypes: [['weft','type']],
  dyeingUnits: [['sale','dyeing']],
  banks:     [] // bank names live inside each recovery's cheques — handled below
};
// Rewrites every reference to oldName with newName; returns how many records/fields changed.
function cascadeMasterRename(key, oldName, newName){
  let n = 0;
  (MASTER_REF_FIELDS[key] || []).forEach(([coll, field])=>{
    (DATA[coll] || []).forEach(rec=>{ if(rec && rec[field] === oldName){ rec[field] = newName; n++; } });
  });
  if(key === 'banks'){
    (DATA.recovery || []).forEach(r=>{ (r.cheques || []).forEach(c=>{ if(c && c.bank === oldName){ c.bank = newName; n++; } }); });
  }
  if(key === 'qualities' && DATA.wageRateHistory && DATA.wageRateHistory[oldName]){
    const h = DATA.wageRateHistory, moved = h[oldName];
    delete h[oldName];
    if(!h[newName]) h[newName] = moved;
    else moved.forEach(e=>{ if(!h[newName].some(x=>x.date === e.date)) h[newName].push(e); });
    n++;
  }
  return n;
}

/* ---------------- Backup files: password protection, decoding, validation ---------------- */
const BACKUP_ENC_PREFIX = 'KHATA-ENC1:'; // marks a password-protected (AES-GCM) backup
const BACKUP_KNOWN_LISTS = ['sale','recovery','clients','qualities','employees','looms','production','expense','family','warp','weft',
  'wagePayments','wageBonuses','wageSettlements','loanPayments','warpBeams','checkpoints'];
function b64FromBytes(bytes){
  let s = '';
  for(let i=0; i<bytes.length; i+=0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i+0x8000));
  return btoa(s);
}
function bytesFromB64(b64){
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for(let i=0; i<bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function deriveBackupKey(password, salt){
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:250000, hash:'SHA-256'}, km, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
// Layout after the prefix (base64): 16-byte salt | 12-byte IV | AES-GCM ciphertext (includes its auth tag).
async function encryptBackupText(text, password){
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(password, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, new TextEncoder().encode(text)));
  const out = new Uint8Array(28 + ct.length);
  out.set(salt, 0); out.set(iv, 16); out.set(ct, 28);
  return BACKUP_ENC_PREFIX + b64FromBytes(out);
}
async function decryptBackupText(payload, password){
  const raw = bytesFromB64(payload.slice(BACKUP_ENC_PREFIX.length).replace(/\s+/g,''));
  const key = await deriveBackupKey(password, raw.slice(0,16));
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv: raw.slice(16,28)}, key, raw.slice(28));
  return new TextDecoder().decode(pt);
}
// Turns whatever was pasted/loaded (plain JSON, compressed, password-protected, or protected+compressed)
// into the parsed object. Throws an Error whose .code says what went wrong (see backupErrorMessage).
async function decodeBackupText(raw, password){
  const fail = code => { const e = new Error(code); e.code = code; return e; };
  let text = String(raw || '').trim();
  if(text.startsWith(BACKUP_ENC_PREFIX)){
    if(!password) throw fail('needs-password');
    try{ text = (await decryptBackupText(text, password)).trim(); }catch(e){ throw fail('bad-password'); }
  }
  if(text.startsWith(BACKUP_GZ_PREFIX)){
    try{ text = await base64ToGunzipped(text.slice(BACKUP_GZ_PREFIX.length)); }catch(e){ throw fail('bad-gz'); }
  }
  try{ return JSON.parse(text); }catch(e){ throw fail('bad-json'); }
}
function backupErrorMessage(err){
  switch(err && err.code){
    case 'needs-password': return 'This backup is password-protected — type its password in the box below, then press Restore again.';
    case 'bad-password':   return 'Wrong password (or the backup is damaged). Nothing was changed — try the password again.';
    case 'bad-gz':         return 'That compressed backup could not be decompressed — check it was copied in full. Nothing was changed.';
    default:               return 'That backup could not be read — check it was copied in full. Nothing was changed.';
  }
}
function backupCounts(o){
  const n = k => (o && Array.isArray(o[k])) ? o[k].length : 0;
  return {sales:n('sale'), recoveries:n('recovery'), production:n('production'), clients:n('clients'),
          other:n('expense')+n('family')+n('warp')+n('weft')+n('wagePayments')+n('wageBonuses')+n('wageSettlements')+n('loanPayments')+n('warpBeams')+n('checkpoints')};
}
const totalEntries = c => c.sales + c.recoveries + c.production + c.other;
function countsText(c){
  return `${c.sales.toLocaleString()} sales, ${c.recoveries.toLocaleString()} recoveries, ${c.production.toLocaleString()} production rows, ${c.clients.toLocaleString()} clients`;
}
// A backup must look like a ledger before it is allowed to replace anything.
function validateBackupData(obj){
  if(!obj || typeof obj !== 'object' || Array.isArray(obj))
    return {ok:false, problem:'That is not an Ibrahim Weaving backup (it does not contain ledger data). Nothing was changed.'};
  if(!BACKUP_KNOWN_LISTS.some(k => k in obj))
    return {ok:false, problem:'That does not look like an Ibrahim Weaving backup — none of the ledger lists were found. Nothing was changed.'};
  const bad = BACKUP_KNOWN_LISTS.find(k => (k in obj) && !Array.isArray(obj[k]));
  if(bad) return {ok:false, problem:`That backup looks damaged ("${bad}" should be a list). Nothing was changed.`};
  return {ok:true, counts: backupCounts(obj)};
}

/* ---------------- Safety copies (automatic snapshots kept inside the app) ---------------- */
// Separate from the ledger itself (own IndexedDB store, own quota), so a copy taken here can
// undo a mistaken restore or a bad afternoon of edits. It does NOT replace real backups: it
// lives on this phone and is wiped if the app's data is cleared or the phone is lost.
const SNAP_DB = 'khata-safety-copies', SNAP_STORE = 'copies', SNAP_LAST_KEY = 'khata-last-safety-copy-at';
const SNAP_KEEP = {auto:3, 'before-restore':3, manual:3};
const SNAP_LABEL = {auto:'Automatic', 'before-restore':'Before a restore', manual:'Taken by you'};
function snapDb(){
  return new Promise((resolve, reject)=>{
    if(!window.indexedDB){ reject(new Error('IndexedDB unavailable')); return; }
    const rq = indexedDB.open(SNAP_DB, 1);
    rq.onupgradeneeded = ()=>{ rq.result.createObjectStore(SNAP_STORE, {keyPath:'id', autoIncrement:true}); };
    rq.onsuccess = ()=> resolve(rq.result);
    rq.onerror = ()=> reject(rq.error || new Error('IndexedDB open failed'));
  });
}
// fn(store) must return an IDBRequest; resolves with that request's result once the transaction commits.
async function snapTx(mode, fn){
  const db = await snapDb();
  return new Promise((resolve, reject)=>{
    let req;
    const tx = db.transaction(SNAP_STORE, mode);
    try{ req = fn(tx.objectStore(SNAP_STORE)); }catch(e){ db.close(); reject(e); return; }
    tx.oncomplete = ()=>{ db.close(); resolve(req ? req.result : undefined); };
    tx.onerror = tx.onabort = ()=>{ db.close(); reject(tx.error || new Error('IndexedDB transaction failed')); };
  });
}
async function snapList(){ const all = await snapTx('readonly', s=>s.getAll()); return (all || []).sort((a,b)=> b.at - a.at); }
async function snapGet(id){ return snapTx('readonly', s=>s.get(id)); }
async function snapDelete(id){ return snapTx('readwrite', s=>s.delete(id)); }
async function snapAdd(reason, json){
  let counts = null;
  try{ counts = backupCounts(JSON.parse(json)); }catch(e){ /* counts are just a label */ }
  // While encryption is on the copy is stored encrypted too (h = fingerprint, to tell whether the ledger changed since).
  const enc = encEnabled();
  const stored = enc ? await encSeal(json) : json;
  const h = await sha256Hex(json);
  await snapTx('readwrite', s=>s.add({at:Date.now(), reason, json:stored, enc, h, counts}));
  try{ localStorage.setItem(SNAP_LAST_KEY, String(Date.now())); }catch(e){ /* best effort */ }
  const seen = {};
  for(const c of await snapList()){
    seen[c.reason] = (seen[c.reason] || 0) + 1;
    if(seen[c.reason] > (SNAP_KEEP[c.reason] || 3)) await snapDelete(c.id);
  }
}
// At most about once a day, and only if the ledger has changed since the last automatic copy.
async function maybeAutoSnapshot(){
  try{
    let last = 0;
    try{ last = Number(localStorage.getItem(SNAP_LAST_KEY)) || 0; }catch(e){ /* no storage */ }
    if(Date.now() - last < 20*3600*1000) return;
    if(encEnabled() && !ENC_DEK) return; // still locked — nothing readable to copy
    if(!totalEntries(backupCounts(DATA))) return;
    const json = JSON.stringify(DATA);
    const lastAuto = (await snapList()).find(c=>c.reason === 'auto');
    if(lastAuto && (lastAuto.h ? lastAuto.h === await sha256Hex(json) : lastAuto.json === json)){ try{ localStorage.setItem(SNAP_LAST_KEY, String(Date.now())); }catch(e){} return; }
    await snapAdd('auto', json);
  }catch(e){ /* best effort only — never bother the user */ }
}

/* ---------------- Storage health: loud save-failure alert + ledger size ---------------- */
const STORAGE_SOFT_LIMIT_CHARS = 5000000; // browsers give one app roughly 5 million characters of localStorage
let _sizeWarned = false;
function showSaveFailure(){
  haptic([80,60,80]);
  let el = document.getElementById('saveFailBanner');
  if(!el){
    el = document.createElement('div');
    el.id = 'saveFailBanner';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:100001;background:#B3261E;color:#fff;padding:calc(10px + env(safe-area-inset-top,0px)) 14px 12px;font-size:14px;line-height:1.4;box-shadow:0 2px 12px rgba(0,0,0,.4)';
    document.body.appendChild(el);
  }
  el.innerHTML = `<b>⚠ Your last change was NOT saved.</b> This phone's storage may be full. Take a backup right now so nothing is lost.
    <div style="display:flex;gap:8px;margin-top:8px">
      <button type="button" id="saveFailBackup" style="background:#fff;color:#B3261E;border:0;border-radius:8px;padding:8px 12px;font-weight:700">Open Backup</button>
      <button type="button" id="saveFailHide" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.7);border-radius:8px;padding:8px 12px">Hide</button>
    </div>`;
  el.querySelector('#saveFailBackup').onclick = ()=>{ el.remove(); switchTab('backup'); };
  el.querySelector('#saveFailHide').onclick = ()=> el.remove();
}
function clearSaveFailure(){ const el = document.getElementById('saveFailBanner'); if(el) el.remove(); }
function noteLedgerSize(chars){
  if(chars > STORAGE_SOFT_LIMIT_CHARS * 0.7 && !_sizeWarned){
    _sizeWarned = true;
    showToast('The ledger is getting large for this phone\'s storage — take a backup and plan a storage upgrade.', 8000);
  }
}
function ledgerSizeLineHtml(){
  let chars = 0;
  try{ chars = (localStorage.getItem(encEnabled() ? ENC_DATA_KEY : STORAGE_KEY) || '').length || JSON.stringify(DATA).length; }catch(e){ /* size is informational only */ }
  const pct = Math.min(999, Math.round(chars / STORAGE_SOFT_LIMIT_CHARS * 100));
  const kb = Math.max(1, Math.round(chars / 1024)).toLocaleString();
  const color = pct >= 85 ? 'var(--red)' : pct >= 60 ? 'var(--rust)' : 'inherit';
  const tail = pct >= 60 ? ' — getting full: keep taking backups and plan the storage upgrade.' : '';
  return `<p class="note" id="ledgerSizeLine" style="margin:6px 0 0;color:${color}">Ledger size: ${kb} KB — about ${pct}% of the roughly 5 MB this phone's browser allows for one app${tail}</p>`;
}

/* ---------------- Export a log table to CSV (opens in Excel / Google Sheets) ---------------- */
const EXPORT_SOURCES = {}; // pageKey -> () => ({headers, cells}) for the log table as last drawn (all filtered rows, not just the page shown)
const EXPORT_LABELS = {sale:'Sales', recovery:'Recovery', expense:'Expenses', family:'Family_Expenses', warp:'Warp', weft:'Weft', production:'Production',
  wageBonuses:'Wage_Bonuses', wagePayments:'Wage_Payments', wageSettlements:'Wage_Settlements', loanPayments:'Loans', rateCalcs:'Grey_Cloth_Rates',
  checkpoints:'Cash_Checkpoints', warpBeams:'Warp_Beams', warpBeamsFinished:'Warp_Beams_Finished', pendingCheques:'Pending_Cheques', bouncedCheques:'Bounced_Cheques', unlinkedReplaced:'Replaced_Cheques_Not_Linked'};
function exportBarHtml(pageKey, count){
  if(!count) return '';
  const share = canShareFiles() ? `<button type="button" class="ghost" data-export-share="${pageKey}" style="margin:0">Share CSV</button>` : '';
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button type="button" class="ghost" data-export-csv="${pageKey}" style="margin:0">Export CSV (${count})</button>${share}</div>`;
}
// Cells are HTML (spans, buttons…) — read them as inert text via DOMParser, so nothing in them can run.
function cellToText(c){
  const body = new DOMParser().parseFromString('<body>' + String(c==null?'':c) + '</body>', 'text/html').body;
  body.querySelectorAll('br').forEach(b=> b.replaceWith('\n'));
  return body.textContent.replace(/[ \t]+/g,' ').replace(/\s*\n\s*/g,'\n').trim();
}
function csvCell(text){
  let s = String(text);
  const dm = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if(s === '—') s = '';
  else if(dm) s = `${dm[3]}-${dm[2]}-${dm[1]}`;                                   // ISO date — reads the same on every phone/PC setting
  else if(/^0\d+$/.test(s)) s = `="${s}"`;                                         // keep leading zeros (invoice / cheque numbers)
  else if(/^Rs\s-?[\d,]+(\.\d+)?$/.test(s)) s = s.replace(/^Rs\s/,'').replace(/,/g,''); // amounts become real numbers
  else if(/^-?[\d,]*\d(\.\d+)?$/.test(s)) s = s.replace(/,/g,'');
  else if(/^\d+-\d{1,2}$/.test(s)) s = `="${s}"`;                                  // sixteenths like 100-12 — Excel would read it as a date
  else if(/^[=+\-@]/.test(s)) s = "'" + s;                                          // never let a cell be read as a formula
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}
function buildCsvFile(pageKey){
  const src = EXPORT_SOURCES[pageKey];
  if(!src) return null;
  const {headers, cells} = src();
  const keep = headers.map(h => cellToText(h) !== ''); // the blank-titled column is the Edit/Remove buttons
  const lines = [headers.filter((_,i)=>keep[i]).map(h=>csvCell(cellToText(h)))];
  cells.forEach(r=> lines.push(r.filter((_,i)=>keep[i]).map(c=>csvCell(cellToText(c)))));
  const csv = '\uFEFF' + lines.map(l=>l.join(',')).join('\r\n');
  return new File([csv], `Ibrahim_Weaving_${EXPORT_LABELS[pageKey] || pageKey}_${dateTimeStamp()}.csv`, {type:'text/csv'});
}
document.addEventListener('click', async (e)=>{
  const dl = e.target.closest('[data-export-csv]'), sh = e.target.closest('[data-export-share]');
  if(!dl && !sh) return;
  let file = null;
  try{ file = buildCsvFile((dl || sh).dataset.exportCsv || (dl || sh).dataset.exportShare); }catch(err){ file = null; }
  if(!file){ showToast('Could not build the export — try again.'); return; }
  if(dl){ downloadFileFallback(file) ? showToast('CSV saved to Downloads ✓') : showToast('Download was blocked here.'); return; }
  try{ await navigator.share({files:[file]}); }
  catch(err){ if(!(err && err.name === 'AbortError')) showToast('Could not open share — use Export CSV instead.'); }
});

/* ---------------- Quick add (Overview buttons + app-icon shortcuts) ---------------- */
let PENDING_QUICK = null;
let PENDING_REPLACE = null; // set by a Bounced-cheque row's "Log replacement": {recoveryId, chequeId} to pre-tick on the payment form
function quickAdd(kind){
  const recovery = kind === 'recovery';
  switchTab(recovery ? 'recovery' : 'sale');
  setTimeout(()=>{
    const el = document.getElementById(recovery ? 'r_client' : 's_client');
    const box = el && (el.closest('.card') || el.closest('.field') || el);
    if(box) box.scrollIntoView({block:'start', behavior:'smooth'});
  }, 80);
}
function runPendingQuickAdd(){ if(PENDING_QUICK){ const k = PENDING_QUICK; PENDING_QUICK = null; quickAdd(k); } }
document.addEventListener('click', (e)=>{
  const b = e.target.closest('[data-quick-add]');
  if(b) quickAdd(b.dataset.quickAdd);
});
// Sale form hint: quantities show in 1/16ths on receipts, but the amount uses the exact number typed.
document.addEventListener('input', (e)=>{
  if(!e.target || e.target.id !== 's_qty') return;
  const hint = document.getElementById('s_qtyHint');
  if(!hint) return;
  const n = Number(e.target.value);
  if(!(n > 0) || Math.abs(n*16 - Math.round(n*16)) < 1e-6){ hint.hidden = true; return; }
  hint.hidden = false;
  hint.textContent = `Receipts will show ${fmtQtyMtr(n)} (nearest 1/16), but the amount is calculated on exactly ${n} mtr.`;
});

/* ---------------- "New version available" prompt ---------------- */
// The app opens instantly from its saved copy and updates itself in the background, so a
// freshly deployed version is normally only seen on the launch AFTER the one that fetched it.
// This asks the server which build is live and, if it's newer than the one running, offers a reload.
const APP_BUILD = (document.querySelector('meta[name="app-build"]') || {}).content || '';
let _lastUpdateCheck = 0;
async function checkForNewVersion(){
  try{
    if(!APP_BUILD || !navigator.onLine || Date.now() - _lastUpdateCheck < 30*60*1000) return;
    _lastUpdateCheck = Date.now();
    const res = await fetch('./index.html?__ck=' + Date.now(), {cache:'no-store'});
    if(!res.ok) return;
    const m = (await res.text()).match(/<meta name="app-build" content="([^"]+)"/);
    if(m && m[1] !== APP_BUILD) showUpdateBar();
  }catch(e){ /* offline or blocked — just try again later */ }
}
function showUpdateBar(){
  if(document.getElementById('updateBar')) return;
  const el = document.createElement('div');
  el.id = 'updateBar';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:100000;background:#163B3D;color:#fff;border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);font-size:14px';
  el.innerHTML = '<span style="flex:1">A new version of the app is ready.</span><button type="button" id="updateReload" style="background:#fff;color:#163B3D;border:0;border-radius:8px;padding:8px 14px;font-weight:700">Reload</button><button type="button" id="updateLater" aria-label="Later" style="background:transparent;color:#fff;border:0;font-size:18px;padding:4px 8px">✕</button>';
  document.body.appendChild(el);
  el.querySelector('#updateReload').onclick = ()=> location.reload();
  el.querySelector('#updateLater').onclick = ()=> el.remove();
}
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible'){ checkForNewVersion(); maybeAutoSnapshot(); runBeamAlerts(); } });

// The service worker can finish updating in the background and take over (skipWaiting +
// clients.claim) between one launch and the next, so the very next open is already running
// the new build with no "Reload" prompt ever shown — the switch happened silently. This
// compares this launch's build against the last one we know the person actually saw and, if
// they differ, shows a brief dismissible notice so an update is never completely invisible.
// Nothing shows on the very first-ever launch (nothing to compare against yet).
const LAST_SEEN_BUILD_KEY = 'khata-last-seen-build';
function noteIfJustUpdated(){
  if(!APP_BUILD) return;
  let prevBuild = null;
  try{ prevBuild = localStorage.getItem(LAST_SEEN_BUILD_KEY); }catch(e){ /* best effort only */ }
  try{ localStorage.setItem(LAST_SEEN_BUILD_KEY, APP_BUILD); }catch(e){ /* best effort only */ }
  if(prevBuild === null || prevBuild === APP_BUILD) return;
  showJustUpdatedBar();
}
function showJustUpdatedBar(){
  if(document.getElementById('justUpdatedBar')) return;
  const el = document.createElement('div');
  el.id = 'justUpdatedBar';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:100000;background:#163B3D;color:#fff;border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);font-size:14px';
  el.innerHTML = '<span style="flex:1">App updated to the latest version.</span><button type="button" id="justUpdatedX" aria-label="Dismiss" title="Dismiss" style="background:transparent;color:#fff;border:0;font-size:18px;padding:4px 8px">✕</button>';
  document.body.appendChild(el);
  el.querySelector('#justUpdatedX').onclick = ()=> el.remove();
  setTimeout(()=>{ if(document.body.contains(el)) el.remove(); }, 8000); // clears itself so it never lingers as a stuck banner
}

/* ---------------- Undo for edits and deletes (header button + recent-changes list) ---------------- */
// Everything the app changes goes through save(), so save() compares each top-level part of the
// ledger with how it looked after the previous save. If a record was removed, or an existing one
// edited, it files an Undo entry describing exactly what to put back (the removed record and its
// position, or the record's previous version). Undo re-applies just those records by id, so it
// never wipes out other things you added or changed afterwards, and any entry can be undone on its
// own. Plain additions get no entry (Remove already covers those). History lives in memory only —
// it clears when the app is closed; Safety copies in Backup & Restore cover bigger mistakes.
const UNDO_STACK = [];                       // newest last: {id, label, kind, ops, at, size}
const UNDO_MAX = 25, UNDO_MAX_CHARS = 12000000;
let _undoSeq = 0;
const UNDO_KEY_LABEL = {sale:'Sale', recovery:'Recovery', production:'Production', expense:'Expense', family:'Family expense', warp:'Warp purchase',
  weft:'Weft purchase', clients:'Client', qualities:'Quality', employees:'Employee', looms:'Loom', warpTypes:'Warp type', weftTypes:'Weft type', dyeingUnits:'Dyeing unit', banks:'Bank',
  wagePayments:'Wage payment', wageBonuses:'Bonus', wageSettlements:'Settlement', loanPayments:'Loan entry', warpBeams:'Warp beam',
  checkpoints:'Checkpoint', rateCalcs:'Rate calculation', loomAssignments:'Loom assignment', wageRateHistory:'Wage rates', businessInfo:'Business info'};
const undoKeyLabel = k => UNDO_KEY_LABEL[k] || k;

function undoParts(){
  const o = {};
  for(const k of Object.keys(DATA)){ const s = JSON.stringify(DATA[k]); if(s !== undefined) o[k] = s; }
  return o;
}
function undoDescribeRec(rec){
  if(!rec || typeof rec !== 'object') return '';
  const who = rec.client || rec.name || rec.employee || rec.loom || rec.quality || rec.category || rec.type || rec.supplier || '';
  const amt = (rec.amount != null && rec.amount !== '') ? fmtRs(rec.amount) : (rec.qty ? fmtQtyMtr(rec.qty) + ' mtr' : '');
  return [rec.date ? fmtDate(rec.date) : '', who, amt].filter(Boolean).join(' · ');
}
// Works out what changed between two save-states and files an Undo entry if it was a removal or an edit.
// Returns 'removed' | 'updated' | null (null = nothing changed, or only additions).
function recordUndoEntry(prev, cur){
  const keys = Object.keys(Object.assign({}, prev, cur)).filter(k => prev[k] !== cur[k]);
  if(!keys.length) return null;
  const ops = [];
  let removed = false, added = false, updated = false;
  const hasIds = x => Array.isArray(x) && x.every(r => r && typeof r === 'object' && r.id != null);
  for(const k of keys){
    let a, b;
    try{
      a = prev[k] === undefined ? undefined : JSON.parse(prev[k]);
      b = cur[k] === undefined ? undefined : JSON.parse(cur[k]);
    }catch(e){ continue; }
    if(a === undefined){ added = true; continue; } // a brand-new top-level part (e.g. defaults filled in) — not an edit
    if(hasIds(a) && hasIds(b)){
      const aById = new Map(a.map(r => [r.id, r])), bById = new Map(b.map(r => [r.id, r]));
      let structural = false;
      a.forEach((r, i)=>{ if(!bById.has(r.id)){ ops.push({t:'ins', key:k, index:i, rec:r, desc:undoDescribeRec(r)}); removed = true; structural = true; } });
      b.forEach(r=>{ if(!aById.has(r.id)){ ops.push({t:'del', key:k, id:r.id}); added = true; structural = true; } });
      a.forEach(r=>{
        const nb = bById.get(r.id);
        if(nb && JSON.stringify(nb) !== JSON.stringify(r)){ ops.push({t:'rev', key:k, id:r.id, rec:r, desc:undoDescribeRec(nb)}); updated = true; }
      });
      if(!structural && !ops.some(o => o.key === k) && a.length === b.length){
        ops.push({t:'ord', key:k, ids:a.map(r => r.id)}); updated = true; // same records, different order (e.g. Settings ↑/↓)
      }
    }else{
      if(Array.isArray(a) && Array.isArray(b)){ if(b.length > a.length) added = true; else if(b.length < a.length) removed = true; else updated = true; }
      else updated = true;
      ops.push({t:'snap', key:k, prev: prev[k] === undefined ? null : prev[k]});
    }
  }
  const kind = removed ? 'removed' : (added ? null : (updated ? 'updated' : null));
  if(!kind) return null;
  const entry = {id: ++_undoSeq, kind, ops, at: Date.now(), label: undoEntryLabel(kind, ops)};
  try{ entry.size = JSON.stringify(ops).length; }catch(e){ entry.size = 0; }
  UNDO_STACK.push(entry);
  let total = UNDO_STACK.reduce((s,e)=> s + e.size, 0);
  while(UNDO_STACK.length > 1 && (UNDO_STACK.length > UNDO_MAX || total > UNDO_MAX_CHARS)){ total -= UNDO_STACK.shift().size; }
  updateUndoButton();
  showUndoToast(entry);
  return kind;
}
function undoEntryLabel(kind, ops){
  if(NEXT_UNDO_LABEL) return NEXT_UNDO_LABEL;
  if(kind === 'removed'){
    const ins = ops.filter(o => o.t === 'ins');
    if(ins.length === 1) return `Removed ${undoKeyLabel(ins[0].key)}${ins[0].desc ? ': ' + ins[0].desc : ''}`;
    return `Removed ${ins.length} entries`;
  }
  const revs = ops.filter(o => o.t === 'rev');
  if(revs.length === 1) return `Edited ${undoKeyLabel(revs[0].key)}${revs[0].desc ? ': ' + revs[0].desc : ''}`;
  if(revs.length > 1) return `Edited ${revs.length} entries`;
  const other = ops.find(o => o.t === 'ord' || o.t === 'snap');
  if(other) return other.t === 'ord' ? `Reordered ${undoKeyLabel(other.key)} list` : `Changed ${undoKeyLabel(other.key)}`;
  return 'Entry updated';
}
// Puts back what one entry took away; returns how many pieces could / could not be re-applied.
function applyUndoEntry(e){
  let applied = 0, skipped = 0;
  const idx = (arr, id) => Array.isArray(arr) ? arr.findIndex(r => r && r.id === id) : -1;
  for(const op of e.ops){ // ops were filed in ascending position order, so re-inserting in this order restores the original order
    const arr = DATA[op.key];
    if(op.t === 'ins'){
      if(Array.isArray(arr) && idx(arr, op.rec.id) < 0){ arr.splice(Math.min(op.index, arr.length), 0, JSON.parse(JSON.stringify(op.rec))); applied++; } else skipped++;
    }else if(op.t === 'del'){
      const i = idx(arr, op.id); if(i > -1){ arr.splice(i, 1); applied++; } else skipped++;
    }else if(op.t === 'rev'){
      const i = idx(arr, op.id); if(i > -1){ arr[i] = JSON.parse(JSON.stringify(op.rec)); applied++; } else skipped++;
    }else if(op.t === 'ord'){
      if(Array.isArray(arr)){ const pos = new Map(op.ids.map((id, i) => [id, i])); arr.sort((x, y)=> (pos.has(x.id) ? pos.get(x.id) : 1e9) - (pos.has(y.id) ? pos.get(y.id) : 1e9)); applied++; } else skipped++;
    }else if(op.t === 'snap'){
      if(op.prev === null) delete DATA[op.key]; else DATA[op.key] = JSON.parse(op.prev);
      applied++;
    }
  }
  return {applied, skipped};
}
async function undoEntry(id){
  const i = UNDO_STACK.findIndex(e => e.id === id);
  if(i < 0) return;
  const e = UNDO_STACK[i];
  const {applied, skipped} = applyUndoEntry(e);
  UNDO_STACK.splice(i, 1);
  if(!applied){
    updateUndoButton(); renderUndoSheet();
    showToast('Could not undo that — the entry was changed or removed again since.', 5000);
    return;
  }
  EDITING = null;
  UNDO_SUPPRESS = true; // this save is the undo itself — don't file it as a new change
  await save();
  updateUndoButton();
  renderUndoSheet();
  switchTab(CURRENT_TAB);
  showToast(skipped ? `Partly undone: ${e.label}` : `Undone: ${e.label}`);
}
function undoAgo(ts){
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
function updateUndoButton(){
  const btn = document.getElementById('undoBtn'), badge = document.getElementById('undoBadge');
  if(!btn) return;
  btn.style.display = UNDO_STACK.length ? 'flex' : 'none';
  if(badge) badge.textContent = UNDO_STACK.length > 9 ? '9+' : String(UNDO_STACK.length);
}
function closeUndoSheet(){ const el = document.getElementById('undoSheet'); if(el) el.remove(); }
function openUndoSheet(){
  if(document.getElementById('undoSheet')) return;
  const toast = document.getElementById('appToast'); if(toast) toast.classList.remove('show'); // don't let it sit on top of the list
  const el = document.createElement('div');
  el.id = 'undoSheet';
  el.innerHTML = '<div class="undo-scrim"></div><div class="undo-panel" role="dialog" aria-label="Recent changes"></div>';
  document.body.appendChild(el);
  el.querySelector('.undo-scrim').onclick = closeUndoSheet;
  renderUndoSheet();
}
function renderUndoSheet(){
  const panel = document.querySelector('#undoSheet .undo-panel');
  if(!panel) return;
  const rows = UNDO_STACK.slice().reverse().map(e => `
    <div class="undo-row">
      <div class="undo-text"><div class="undo-label">${escHtml(e.label)}</div><div class="undo-when">${undoAgo(e.at)}</div></div>
      <button type="button" class="ghost undo-do" data-undo-id="${e.id}">Undo</button>
    </div>`).join('');
  panel.innerHTML = `
    <div class="undo-head"><h2>Recent changes</h2><button type="button" class="undo-close" aria-label="Close">✕</button></div>
    <div class="undo-list">${rows || '<div class="empty">Nothing to undo yet — edits and removals show up here.</div>'}</div>
    <p class="note" style="margin:10px 0 0">Undo puts back only that change; anything you added or changed afterwards stays. This list clears when the app is closed — for bigger mistakes use Safety copies in Backup &amp; Restore.</p>`;
  panel.querySelector('.undo-close').onclick = closeUndoSheet;
  panel.querySelectorAll('[data-undo-id]').forEach(b => { b.onclick = ()=> undoEntry(Number(b.dataset.undoId)); });
}
// Toast shown right after a change, with a one-tap Undo for that specific entry.
function showUndoToast(entry){
  let el = document.getElementById('appToast');
  if(!el){ el = document.createElement('div'); el.id = 'appToast'; el.setAttribute('role','status'); document.body.appendChild(el); }
  el.innerHTML = `<span>${escHtml(entry.label)}</span> <button type="button" class="toast-undo">Undo</button>`;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(()=> el.classList.remove('show'), 8000);
  const btn = el.querySelector('.toast-undo');
  if(btn) btn.onclick = ()=>{ el.classList.remove('show'); clearTimeout(_toastTimer); undoEntry(entry.id); };
}
// Toast with one action button (e.g. "View" on a beam alert). Same look as the Undo toast.
function showActionToast(msg, label, onAction, ms){
  let el = document.getElementById('appToast');
  if(!el){ el = document.createElement('div'); el.id = 'appToast'; el.setAttribute('role','status'); document.body.appendChild(el); }
  el.innerHTML = `<span>${escHtml(msg)}</span> <button type="button" class="toast-undo">${escHtml(label)}</button>`;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(()=> el.classList.remove('show'), ms || 8000);
  const btn = el.querySelector('.toast-undo');
  if(btn) btn.onclick = ()=>{ el.classList.remove('show'); clearTimeout(_toastTimer); onAction(); };
}
(function(){ const b = document.getElementById('undoBtn'); if(b) b.onclick = openUndoSheet; })();

/* ---------------- Backup & Restore ---------------- */
function backupPanel(){
  return `
    <div class="card">
      <div class="card-head"><h2>Backup &amp; Restore</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Your data is saved automatically, but storage isn't always guaranteed depending on where this page is opened. Copy or download a JSON backup regularly and keep it somewhere safe. The compressed options shrink the text (roughly 5-10x smaller) so it's much quicker to paste into Notes, Gmail, WhatsApp, etc. on mobile, or to keep as a smaller file. The plain options are ordinary, uncompressed JSON — useful if you want to read or edit it, or paste it somewhere that mangles the compressed version. Any of them (pasted or loaded as a file) restores below — a password-protected one will ask for its password.</p>
      <div class="field" style="margin-bottom:8px"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="bk_encrypt" style="width:auto;margin:0"> Protect this backup with a password (optional)</label></div>
      <div id="bk_encFields" hidden>
        <div class="field" style="max-width:360px"><input type="password" id="bk_pw" placeholder="Backup password (at least 6 characters)" autocomplete="new-password"></div>
        <p class="note" style="margin-top:6px">Applies to Copy, Download and Share below. If you forget this password the backup can't be opened — there is no way to recover it. Backups without a password are readable by anyone who receives the file.</p>
      </div>
      <div class="grid cols-2">
        <button class="primary" id="copyJsonBtn" type="button" style="margin-top:0">Copy Compressed</button>
        <button class="primary" id="copyPlainJsonBtn" type="button" style="margin-top:0">Copy Plain JSON</button>
        <button class="primary" id="downloadJsonBtn" type="button" style="margin-top:0">Download Compressed JSON</button>
        <button class="primary" id="downloadPlainJsonBtn" type="button" style="margin-top:0">Download Plain JSON</button>
      </div>
      ${canShareFiles() ? `<button class="primary" id="shareBackupBtn" type="button" style="margin-top:12px;width:100%"><span style="display:inline-flex;width:1em;height:1em;vertical-align:-2px;margin-right:4px">${ICON_SHARE}</span> Share Backup (Drive, Gmail, WhatsApp…)</button>` : ''}
      <p class="note" id="lastBackupLine" style="margin:10px 0 0">${lastBackupStatusText()}</p>
      ${ledgerSizeLineHtml()}
      <div id="backupStatus" class="note" style="min-height:16px"></div>
      <div class="group-label">Restore from a backup</div>
      <div class="field" style="max-width:360px;margin-bottom:12px">
        <label>Choose a backup file</label>
        <input type="file" id="restoreJsonFile" accept=".json,.txt,application/json,text/plain">
      </div>
      <p class="note" style="margin-top:0">Picking a file above loads it into the box below — or just paste a backup directly instead.</p>
      <div class="field"><textarea id="restoreJsonInput" rows="4" placeholder="Paste a previously copied/downloaded JSON backup here, or choose a file above"></textarea></div>
      <div class="field" id="restorePwWrap" hidden style="max-width:360px"><label>This backup is password-protected — enter its password</label><input type="password" id="restorePw" autocomplete="off"></div>
      <button class="ghost" id="restoreJsonBtn" type="button">Restore from Backup</button>
      <div class="note">Restoring replaces ALL current data in this app with the pasted/loaded backup. You'll see what the backup contains before anything changes, and a safety copy of your current data is kept first (see below).</div>
    </div>
    ${autoBackupCardHtml()}
    <div class="card">
      <div class="card-head"><h2>Safety copies on this phone</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>The app quietly keeps its last few copies of your ledger (about one a day, plus one right before any restore) in a separate place inside the app. If a restore or a bad edit goes wrong, restore one of these. They live on this phone only — they are wiped if the app's data is cleared or the phone is lost, so they don't replace the real backups above.</p>
      <div id="snapList" class="note">Loading…</div>
      <button class="ghost" id="snapNowBtn" type="button">Take a safety copy now</button>
      <div id="snapStatus" class="note" style="min-height:16px"></div>
    </div>`;
}
