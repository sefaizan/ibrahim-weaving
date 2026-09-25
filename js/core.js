/* Core: icons, tab list, the DATA object, number/date formatting, share + receipt helpers,
 * one-tap backup, save() and load(). Loaded first so everything after it can use these. */

/* ---------------- Data model ---------------- */
/* Self-contained line-icon set for the nav drawer — plain inline SVG, so the drawer never
   depends on an external icon font loading (Material Symbols was tried first and proved
   unreliable on real devices/networks; these are baked into the page itself). */
const APP_MARK_PNG = "data:image/png;base64,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";
const ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="14" width="8" height="7" rx="1.5"/></svg>',
  precision_manufacturing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V10l5 3.5V10l5 3.5V10l5 3.5V21z"/><line x1="2" y1="21" x2="22" y2="21"/><line x1="7" y1="6" x2="7" y2="3"/></svg>',
  point_of_sale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 12.9 12.9 20.6a2 2 0 0 1-2.8 0l-7-7a2 2 0 0 1 0-2.8L10.8 3H19a2 2 0 0 1 2 2v8.2Z"/><circle cx="15" cy="9" r="1.5" fill="currentColor" stroke="none"/></svg>',
  payments: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 15.5c.6.6 1.5 1 2.5 1 1.7 0 3-1 3-2.3 0-1.4-1.3-1.9-3-2.2-1.7-.3-3-.8-3-2.2C9 8.5 10.3 7.5 12 7.5c1 0 1.9.4 2.5 1"/><line x1="12" y1="6" x2="12" y2="18"/></svg>',
  receipt_long: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12v19l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V2Z"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="13" y2="15"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
  linear_scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/><circle cx="7" cy="6" r="1.6" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="10" cy="18" r="1.6" fill="currentColor" stroke="none"/></svg>',
  texture: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
  groups: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17.5" cy="8.5" r="2.6"/><path d="M15.8 14.7c2.6.4 4.2 2.3 4.2 5.3"/></svg>',
  account_balance_wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3"/><path d="M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H6a2 2 0 0 1-2-2Z"/><circle cx="16.5" cy="13.5" r="1.4" fill="currentColor" stroke="none"/></svg>',
  calculate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="7.5" y1="11" x2="10" y2="11"/><line x1="8.75" y1="9.75" x2="8.75" y2="12.25"/><line x1="14" y1="11" x2="16.5" y2="11"/><line x1="7.5" y1="16" x2="10" y2="16"/><line x1="14" y1="16" x2="16.5" y2="16"/></svg>',
  savings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12c0-3.5 3.1-6 7.5-6 3 0 5.2 1.1 6.5 3h2l1 2.5-2 1V15l-2 2v3h-3v-2H10v2H7v-3.3C5.2 15.6 4 13.9 4 12Z"/><circle cx="9.5" cy="11" r="1" fill="currentColor" stroke="none"/></svg>',
  monitoring: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="10" y1="21" x2="10" y2="9"/><line x1="16" y1="21" x2="16" y2="12"/><polyline points="3 8 9 4 14 7 21 3"/></svg>',
  inventory_2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z"/><path d="M3 8.5V17l9 4.5 9-4.5V8.5"/><line x1="12" y1="13" x2="12" y2="21.5"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-1.8-1L15 3h-4l-.3 2.9a7.6 7.6 0 0 0-1.8 1l-2.3-.9-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9a7.6 7.6 0 0 0 1.8 1l.3 2.9h4l.3-2.9a7.6 7.6 0 0 0 1.8-1l2.3.9 2-3.4Z"/></svg>',
  backup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
};
// group: which drawer section this tab is filed under (see NAV_GROUPS below) — purely a
// display grouping in renderNav; tabForKey/switchTab/every other lookup still works by id alone.
const TABS = [
  {id:'overview', label:'Overview', icon:'dashboard', group:'Daily'},
  {id:'production', label:'Production', icon:'precision_manufacturing', group:'Daily'},
  {id:'sale', label:'Sale', icon:'point_of_sale', group:'Money'},
  {id:'recovery', label:'Recovery', icon:'payments', group:'Money'},
  {id:'expense', label:'Expense', icon:'receipt_long', group:'Money'},
  {id:'wages', label:'Wages', icon:'groups', group:'Money'},
  {id:'loans', label:'Loans (Employee)', icon:'account_balance_wallet', group:'Money'},
  {id:'ratecalc', label:'Grey Cloth Rate', icon:'calculate', group:'Money'},
  {id:'family', label:'Family Expense', icon:'home', group:'Family'},
  {id:'personal', label:'Personal Expense', icon:'receipt_long', group:'Family'},
  {id:'personalloans', label:'Personal Loans (Given)', icon:'account_balance_wallet', group:'Family'},
  {id:'warp', label:'Warp (Tana)', icon:'linear_scale', group:'Materials'},
  {id:'weft', label:'Weft (Bana)', icon:'texture', group:'Materials'},
  {id:'warpbeams', label:'Warp (Tana) Beam', icon:'inventory_2', group:'Materials'},
  {id:'checkpoints', label:'Cash Checkpoints', icon:'savings', group:'Tools'},
  {id:'graphs', label:'Graphs', icon:'monitoring', group:'Tools'},
  {id:'settings', label:'Settings', icon:'settings', group:'Tools'},
  {id:'backup', label:'Backup & Restore', icon:'backup', group:'Tools'},
];
// Order the groups appear in the drawer, top to bottom.
const NAV_GROUPS = ['Daily','Money','Family','Materials','Tools'];

let DATA = {
  "qualities": [],
  "clients": [],
  "employees": [],
  "looms": [],
  "warpTypes": [],
  "weftTypes": [],
  "dyeingUnits": [],
  "banks": [],
  "warpBeams": [],
  "wageBonuses": [],
  "wagePayments": [],
  "wageSettlements": [],
  "loanPayments": [],
  "personal": [],
  "personalLoans": [],
  "familyMembers": [],
  "production": [],
  "warp": [],
  "weft": [],
  "sale": [],
  "recovery": [],
  "expense": [],
  "family": [],
  "checkpoints": [],
  "openingBalance": 0,
  "wageRateHistory": {},
  "businessInfo": {"name": "Ibrahim Weaving"},
  "wageFrom": "",
  "wageTo": "",
  "rateCalcs": [],
  "rateCalcDefaults": {}
};

const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,7);
let EDITING = null; // { key, id } — tracks which row is currently being edited, if any
let PRODUCTION_PREFILL = null; // {date, quality, loom} — set by "Add & next loom", applied once when Production re-renders
// Collapsible forms: keys of forms currently expanded. A form stays collapsed by default so
// long entry pages aren't a wall of inputs — click its toggle to open it, add entries, then
// collapse it again. Using the same key as EDITING.key (e.g. 'wagePayments') lets clicking
// Edit on a log row auto-open that form even if it was collapsed — see wireEditGeneric.
let OPEN_FORMS = new Set();
function formToggleBtn(key, label, inHead){
  const open = OPEN_FORMS.has(key);
  // inHead: the button sits in a log card's header row (next to the log's title), not above a form.
  return `<button class="ghost" type="button" data-toggle-form="${key}" style="${inHead?'margin:0;flex:none':'margin-bottom:12px'}">${open?'Hide':'Show'} ${label}</button>`;
}
// Collapsible summaries: every page's Summary / Breakdown card starts collapsed and opens on
// tap. Open state is remembered per page (OPEN_SUMMARIES) so it survives the re-renders that
// follow saving an entry, but a fresh launch always starts collapsed. Toggling edits the DOM in
// place — no re-render — so nothing typed into a form on the same page is lost.
let OPEN_SUMMARIES = new Set();
let CUR_PANEL = '';
const ICON_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
function sumCardOpen(slug, title, headExtra){
  const key = CUR_PANEL + ':' + slug, open = OPEN_SUMMARIES.has(key);
  return `<div class="card summary-card${open?' open':''}" data-summary-card="${key}">
    <div class="card-head summary-head"><button type="button" class="summary-toggle" data-summary-toggle="${key}" aria-expanded="${open}"><h2>${title}</h2><span class="summary-chev" aria-hidden="true">${ICON_CHEV}</span></button>${headExtra||''}</div>
    <div class="summary-body"${open?'':' hidden'}>`;
}
function sumCardClose(){ return `</div></div>`; }
function setSummaryOpen(key, open){
  if(open) OPEN_SUMMARIES.add(key); else OPEN_SUMMARIES.delete(key);
  document.querySelectorAll('[data-summary-card]').forEach(card=>{
    if(card.dataset.summaryCard !== key) return;
    card.classList.toggle('open', open);
    const t = card.querySelector('[data-summary-toggle]'); if(t) t.setAttribute('aria-expanded', String(open));
    const body = card.querySelector('.summary-body'); if(body) body.hidden = !open;
  });
}
function formBodyOpen(key){ return `data-form-body="${key}" style="display:${OPEN_FORMS.has(key)?'block':'none'}"`; }
const fmtRs = n => 'Rs ' + (Math.round((n||0))).toLocaleString('en-IN');
const fmtRs2 = n => 'Rs ' + (n||0).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
const fmtNum = n => (Math.round((n||0)*100)/100).toLocaleString('en-IN');
// Receipt-only quantity format: the trade convention here is quarters expressed as
// sixteenths after a dash — .25 -> -4, .5 -> -8, .75 -> -12 (e.g. 100.75 becomes "100-12").
// A whole number with no fractional part prints with no dash at all.
const fmtQtyMtr = n => {
  n = Number(n) || 0;
  const neg = n < 0; n = Math.abs(n);
  let whole = Math.trunc(n);
  let sixteenths = Math.round((n - whole) * 16);
  if (sixteenths >= 16) { whole += 1; sixteenths -= 16; }
  const t = sixteenths ? `${whole}-${sixteenths}` : `${whole}`;
  return neg && (whole || sixteenths) ? '-' + t : t;
};
// L (AIL) shortage meters are a computed result, not a physically measured piece of cloth,
// so they're shown as a plain decimal (up to 2dp, trailing zeros trimmed) rather than run
// through fmtQtyMtr's sixteenths rounding, which would misrepresent the exact figure.
const fmtQtyPlain = n => {
  n = Number(n) || 0;
  return (Math.round(n*100)/100).toString();
};
// Same whole/sixteenths split as fmtQtyMtr above, but returned as numbers rather than a
// formatted string — used to populate the two-box (Meters / 16ths) production entry fields
// when editing an existing entry.
function splitMtr16(n){
  n = Number(n) || 0;
  const neg = n < 0; n = Math.abs(n);
  let whole = Math.trunc(n);
  let sixteenths = Math.round((n - whole) * 16);
  if (sixteenths >= 16) { whole += 1; sixteenths -= 16; }
  return { whole: neg ? -whole : whole, sixteenths };
}
// Inverse of splitMtr16 — combines the Meters box and the 16ths box back into one decimal
// value for storage (the record itself still holds a single decimal number, same as before).
function combineMtr16(whole, sixteenths){
  const w = Number(whole) || 0, s = Number(sixteenths) || 0;
  return w + (w < 0 ? -s : s) / 16;
}
// Dates are always STORED as YYYY-MM-DD internally (required for <input type="date"> and
// for chronological string comparisons throughout the app) — this only reformats a date
// for on-screen display, as DD-MM-YYYY. Anything that isn't a clean YYYY-MM-DD string
// (blank, "—", a malformed value) is returned unchanged rather than breaking the display.
const fmtDate = d => {
  if(!d || typeof d !== 'string') return d || '—';
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
};
// Today's date as YYYY-MM-DD in the phone's LOCAL time. (toISOString() is UTC, which gave yesterday's
// date between midnight and the UTC offset — 5 hours in UTC+5 — and clashed with nowStr(), which is local.)
const todayStr = () => { const d = new Date(), p = n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; };
// Returns {from, to} as ISO date strings (YYYY-MM-DD) for a named quick period — shared by
// every page's period quick-chips (Production, Overview via its own month/year combine(),
// Graphs) so "This Month" / "Last Month" / "This Year" always mean the same window everywhere.
// '' for either side means open-ended (All Time returns both blank).
function quickPeriodRange(period){
  const pad = n => String(n).padStart(2,'0');
  const ymd = (y,m,d) => `${y}-${pad(m)}-${pad(d)}`;
  const now = new Date();
  if(period === 'this-month'){
    const y = now.getFullYear(), m = now.getMonth()+1;
    return {from: ymd(y,m,1), to: ymd(y,m,new Date(y,m,0).getDate())};
  }
  if(period === 'last-month'){
    const d = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const y = d.getFullYear(), m = d.getMonth()+1;
    return {from: ymd(y,m,1), to: ymd(y,m,new Date(y,m,0).getDate())};
  }
  if(period === 'this-year'){
    const y = now.getFullYear();
    return {from: ymd(y,1,1), to: ymd(y,12,31)};
  }
  return {from:'', to:''};
}
// Shared building blocks for the always-visible per-page money Summary cards — so a page
// like Warp or Expense can show its own totals right at the top, without needing a trip to
// Overview just to see "how much have I spent on this so far".
const thisMonthKey = () => todayStr().slice(0,7); // "YYYY-MM"
const isThisMonth = d => (d||'').startsWith(thisMonthKey());
// Sums a field across records, split into {all: all-time total, month: this-calendar-month
// total}. Works for any array of records with a .date and the given numeric field name.
function sumAllAndMonth(arr, field){
  let all=0, month=0;
  (arr||[]).forEach(r=>{
    const n = Number(r[field])||0;
    all += n;
    if(isThisMonth(r.date)) month += n;
  });
  return {all, month};
}
// Same as sumAllAndMonth but for a derived per-record amount (amountFn) instead of a flat
// field — needed for Recovery, where the effective received amount depends on cheque status.
function sumAllAndMonthBy(arr, amountFn){
  let all=0, month=0;
  (arr||[]).forEach(r=>{
    const n = amountFn(r)||0;
    all += n;
    if(isThisMonth(r.date)) month += n;
  });
  return {all, month};
}
// Totals a numeric field grouped by category/quality/etc, sorted highest-first — used for
// the small "by category" breakdown table on the Expense/Family Summary cards.
function sumByGroup(arr, groupField, valueField){
  const map = {};
  (arr||[]).forEach(r=>{
    const g = r[groupField] || '—';
    map[g] = (map[g]||0) + (Number(r[valueField])||0);
  });
  return Object.entries(map).sort((a,b)=>b[1]-a[1]);
}
// Renders one "Summary" card: a row of at-a-glance stats, plus an optional small table
// underneath (e.g. a by-category breakdown). stats is an array of {label, value} where
// value is already formatted for display (e.g. via fmtRs). extraHtml is raw HTML appended
// below the stat row (e.g. a breakdown table) — omit for a plain stat-only summary.
function summaryCard(title, stats, extraHtml){
  return `${sumCardOpen('summary', title)}
    <div class="grid cols-${Math.min(stats.length,4)}">
      ${stats.map(s=>`<div class="stat compact"><div class="label">${s.label}</div><div class="value">${s.value}</div></div>`).join('')}
    </div>
    ${extraHtml||''}
  ${sumCardClose()}`;
}
// Local (not UTC) hours-minutes-seconds, filename-safe (no colons) — appended to backup
// filenames so multiple backups made on the same day are still distinguishable.
const timeStr = () => {
  const d = new Date(), p = n=>String(n).padStart(2,'0');
  return `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};
// Backup filename: Ibrahim_Weaving_YYYY-MM-DD_HH-MM-SS[-suffix].txt (local date/time, not UTC).
// Fixed to "Ibrahim Weaving" regardless of the editable Business Name in Settings, and uses
// the same dateTimeStamp() as every shareable receipt/statement for a consistent naming
// convention across the whole app.
function backupFileName(suffix){
  return `Ibrahim_Weaving_${dateTimeStamp()}${suffix||''}.txt`;
}
const nowStr = () => { const d=new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };

const STORAGE_KEY = 'khata-data-v3'; // bumped so this file's seeded data always loads fresh, instead of being silently overridden by any older saved snapshot under a previous key

// Small vibration on key moments (delete confirm, save, backup complete) — mostly-cosmetic
// tactile feedback so the app feels a bit more native and less like a website in a wrapper.
// navigator.vibrate is widely supported on Android/Chrome (including inside a TWA); iOS
// Safari has never supported it, so this always no-ops safely there instead of erroring.
function haptic(pattern){
  try{ if(navigator.vibrate) navigator.vibrate(pattern); }catch(e){ /* not supported — no-op */ }
}
// Small on-screen message (bottom of the screen) so Share buttons always show what happened.
let _toastTimer = null;
function showToast(msg, ms){
  let el = document.getElementById('appToast');
  if(!el){ el = document.createElement('div'); el.id = 'appToast'; el.setAttribute('role','status'); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(()=> el.classList.remove('show'), ms || 4500);
}
// Last resort when the share sheet can't open: save the PDF so it can be attached manually.
function downloadFileFallback(file){
  try{
    const url = URL.createObjectURL(file);
    const a = document.createElement('a'); a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=> URL.revokeObjectURL(url), 5000);
    return true;
  }catch(e){ return false; }
}

// Plain A–Z/0–9 file names only — some Android share targets reject unusual characters.
function asciiFileBase(s){
  const t = String(s||'').normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g,'_').replace(/^_+|_+$/g,'').replace(/\.+$/,'');
  return t || 'Receipt';
}

// Some Android setups refuse to share PDF files ("Permission denied") but accept images, so
// the receipt is now shared as a PNG picture by default. The same receipt HTML used for
// printing is drawn to a canvas (SVG foreignObject), then shared as a normal image file.
// Draws receipt HTML in an isolated SVG document (only the .receipt CSS rules travel with it) and
// gives back helpers to load it at a chosen canvas height and to find its last inked row.
// The app's global reset (`*{box-sizing:border-box}`) has the selector "*", so it is added by
// hand — otherwise padded boxes render content-box and widen.
function receiptRenderer(html){
  const W = 640;
  let css = '*,*::before,*::after{box-sizing:border-box;}\n';
  for(const ss of Array.from(document.styleSheets)){
    try{ for(const rule of Array.from(ss.cssRules)){ if(rule.type === 1 && rule.cssText.indexOf('.receipt') !== -1) css += rule.cssText + '\n'; } }catch(e){ /* cross-origin sheet */ }
  }
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const xhtml = new XMLSerializer().serializeToString(holder.firstElementChild);
  const load = (H)=> new Promise((res, rej)=>{
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="${W}" height="${H}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${W}px;background:#fff"><style>${css.replace(/&/g,'&amp;')}</style>${xhtml}</div></foreignObject></svg>`;
    const im = new Image();
    im.onload = ()=> res(im);
    im.onerror = ()=> rej(new Error('receipt image could not be drawn'));
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  // Bottom-most row (in CSS px, 1x) containing any non-white pixel, scanning up in bands.
  const lastInkRow = (img, H)=>{
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', {willReadFrequently:true});
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(img, 0, 0);
    const BAND = 160;
    for(let y1 = H; y1 > 0; y1 -= BAND){
      const y0 = Math.max(0, y1 - BAND), d = x.getImageData(0, y0, W, y1 - y0).data, rows = y1 - y0;
      for(let r = rows - 1; r >= 0; r--){
        for(let col = 0; col < W; col++){
          const i = (r * W + col) * 4;
          if(d[i] < 250 || d[i+1] < 250 || d[i+2] < 250) return y0 + r + 1;
        }
      }
    }
    return 0;
  };
  return {W, load, lastInkRow};
}
// Height (CSS px) the receipt really occupies once drawn, or Infinity if it does not fit within
// `limit`. Used to decide how many statement rows fit on one picture.
async function receiptInkHeight(html, limit){
  const R = receiptRenderer(html), H = limit + 200;
  const ink = R.lastInkRow(await R.load(H), H);
  return ink >= H - 60 ? Infinity : ink;
}
// opts.scale: pixels per CSS px (default 2; a 640px-wide receipt becomes 1280px wide).
async function receiptHtmlToPngFile(html, filename, opts){
  opts = opts || {};
  const R = receiptRenderer(html), W = R.W;
  // Why the height is found by looking at the picture instead of measuring the page first:
  // the image is drawn from an isolated SVG that does NOT get the app's page-wide CSS (only
  // the .receipt rules), so its rows can wrap onto more lines than they do in the live
  // page — on a phone-sized screen a long client statement came out ~40% taller, and
  // measuring the live page cut the bottom rows and totals off. So: draw it on a generously
  // tall canvas, find the last inked row, and crop there plus a band of white space. If the
  // first attempt reaches its bottom edge the content may not have fit, so it is retried taller.
  const PAD = 40;                      // white space kept below the last row, in CSS px
  let H = 4000, img, ink;
  for(;;){
    img = await R.load(H);
    ink = R.lastInkRow(img, H);
    if(ink < H - 60 || H >= 24000) break;   // fits with room to spare (or we've hit the limit)
    H = Math.min(24000, H * 2);
  }
  // Still touching the bottom at the maximum height: the content really is longer than one
  // picture can hold. Say so rather than hand back an image with the end silently cut off.
  if(ink >= H - 60){
    const err = new Error('too long for one image'); err.name = 'TooLongForImage'; throw err;
  }
  const finalH = Math.max(120, Math.min(H, ink + PAD));
  // Keep the bitmap inside the ~16-megapixel canvas limit some phones enforce.
  let scale = opts.scale || 2;
  while(scale > 1 && (W * scale) * (finalH * scale) > 14e6) scale -= 0.25;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale); canvas.height = Math.round(finalH * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, W, finalH, 0, 0, canvas.width, canvas.height);
  // No separate canvas watermark step here — the .receipt-watermark div (see
  // receiptWatermarkDiv) is already part of the HTML being rendered above, so it's baked into
  // img. Drawing another one here would double it up.
  const blob = await new Promise(res=> canvas.toBlob(res, 'image/png'));
  if(!blob) throw new Error('image export blocked');
  return new File([blob], filename, {type:'image/png'});
}
// Builds the image and hands it straight to navigator.share so the OS share sheet (WhatsApp,
// Gmail, etc.) opens directly — no in-app dialog in between. On failure this just toasts,
// since a second tap on Share is a fresh user gesture and usually succeeds (see note below).
async function shareReceiptAsImage(kind, id){
  try{
    const html = kind === 'sale' ? printSaleReceipt(id, {htmlOnly:true}) : printRecoveryReceipt(id, {htmlOnly:true});
    if(!html){ showToast('That receipt could not be found.'); return; }
    const f = kind === 'sale' ? buildReceiptFields(id) : buildRecoveryReceiptFields(id);
    const file = await receiptHtmlToPngFile(html, asciiFileBase(f.fileBase) + '.png');
    await navigator.share({files:[file]});
    showToast('Receipt shared ✓');
  }catch(e){
    if(e && e.name === 'AbortError') return;
    if(e && e.name === 'TooLongForImage'){ showToast('This receipt is too long for one picture — use Print / Save as PDF instead.', 6000); return; }
    showToast('Could not open share — tap Share again.', 5000);
  }
}
// Second chance for Share: Android only opens the share sheet from a *fresh* tap, and some
// setups reject the first attempt (NotAllowedError). This shows the already-built file with a
// new Share button — a new tap always counts — plus a Download fallback, the real error, and
// (when the caller passes altFn/altLabel) a button to try a different file format instead.
function shareRetryDialog(file, reason, text, altFn, altLabel){
  const old = document.getElementById('shareRetry'); if(old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = 'shareRetry';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px;';
  wrap.innerHTML = `<div style="background:#fff;color:#222;border-radius:16px;padding:20px;max-width:340px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.35);font-family:inherit">
    <div style="font-weight:700;font-size:16px;margin-bottom:6px">Ready to share</div>
    <div style="font-size:13.5px;line-height:1.4;margin-bottom:4px" id="shareRetryMsg">Choose how to send this receipt.</div>
    <div style="font-size:11.5px;color:#777;margin-bottom:14px;word-break:break-word">${file ? file.name : ''}</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${altFn ? `<button id="shareRetryAlt" type="button" class="primary" style="margin:0;width:100%">${altLabel||'Try another way'}</button>` : ''}
      ${file ? '<button id="shareRetryGo" type="button" class="ghost" style="width:100%">Try sharing again</button>' : ''}
      ${text ? '<button id="shareRetryTxt" type="button" class="ghost" style="width:100%">Share as text instead</button>' : ''}
      ${file ? '<button id="shareRetryDl" type="button" class="ghost" style="width:100%">Download instead</button>' : ''}
      <button id="shareRetryX" type="button" class="ghost" style="width:100%">Cancel</button>
    </div></div>`;
  document.body.appendChild(wrap);
  const msg = wrap.querySelector('#shareRetryMsg');
  if(reason && reason.name) msg.textContent = 'First try was blocked (' + reason.name + (reason.message ? ': ' + reason.message : '') + ').' + (altFn ? ' Tap “' + (altLabel||'Try another way') + '” instead.' : '');
  const close = ()=> wrap.remove();
  wrap.querySelector('#shareRetryX').onclick = close;
  const dlBtn = wrap.querySelector('#shareRetryDl');
  if(dlBtn) dlBtn.onclick = ()=>{
    const ok = downloadFileFallback(file);
    msg.textContent = ok ? 'Download started — check your Downloads / notifications.' : 'Download was blocked here.';
  };
  const altBtn = wrap.querySelector('#shareRetryAlt');
  if(altBtn) altBtn.onclick = ()=>{ close(); altFn(); };
  const txtBtn = wrap.querySelector('#shareRetryTxt');
  if(txtBtn) txtBtn.onclick = async ()=>{
    try{ await navigator.share({title:'Receipt', text}); close(); }
    catch(e){
      if(e && e.name === 'AbortError'){ close(); return; }
      msg.textContent = 'Could not share text: ' + (e && (e.name + (e.message ? ' — ' + e.message : '')) || 'unknown error');
    }
  };
  const goBtn = wrap.querySelector('#shareRetryGo');
  if(goBtn) goBtn.onclick = async ()=>{
    try{
      await navigator.share({files:[file]});   // bare file only — no title/text — for max compatibility
      close();
    }catch(e){
      if(e && e.name === 'AbortError'){ close(); return; }
      msg.textContent = 'Could not open share: ' + (e && (e.name + (e.message ? ' — ' + e.message : '')) || 'unknown error') + '. Try Download instead.';
    }
  };
}
// True only when the browser can share actual files (not just text/links) — this is what
// lets "Share" hand a file straight to Drive, Gmail, WhatsApp, etc. via the native share
// sheet. Most desktop browsers lack this even if navigator.share exists, so we feature-test
// with a throwaway file rather than just checking navigator.share is truthy.
function canShareFiles(){
  try{
    if(!navigator.share || !navigator.canShare) return false;
    const probe = new File(['x'], 'probe.txt', {type:'text/plain'});
    return navigator.canShare({files:[probe]});
  }catch(e){ return false; }
}
// Tracks when the user last took an explicit backup (copy or download from the Backup &
// Restore tab), separate from DATA itself — used to nag on Overview if it's been a while.
// Stored under its own localStorage key so it survives even a full DATA restore.
const LAST_BACKUP_KEY = 'khata-last-backup-at';
const LAST_BACKUP_COUNT_KEY = 'khata-last-backup-count';
// Number of ledger entries (sales, recoveries, production, expenses, ...) right now — stored at
// backup time so the reminder can say how many new entries a backup wouldn't yet contain.
function currentEntryCount(){
  try{ return totalEntries(backupCounts(DATA)); }catch(e){ return 0; }
}
function entriesSinceLastBackup(){
  let raw = null;
  try{ raw = localStorage.getItem(LAST_BACKUP_COUNT_KEY); }catch(e){}
  if(raw === null || raw === '' || isNaN(Number(raw))) return null; // backup predates this counter
  return Math.max(0, currentEntryCount() - Number(raw));
}
function recordBackupTaken(){
  try{
    localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
    localStorage.setItem(LAST_BACKUP_COUNT_KEY, String(currentEntryCount()));
  }catch(e){ /* best effort only */ }
  if(typeof refreshBackupStrip === 'function') refreshBackupStrip();
  haptic([15,60,15]); // distinct double-pulse — a bigger "done" moment than a routine save
  const line = document.getElementById('lastBackupLine');
  if(line) line.textContent = lastBackupStatusText(); // reflects instantly, whichever backup action was just taken
}
// Whole days since the last recorded backup, or null if none has ever been taken on this device.
function daysSinceLastBackup(){
  let raw = null;
  try{ raw = localStorage.getItem(LAST_BACKUP_KEY); }catch(e){ /* no storage available */ }
  if(!raw) return null;
  const then = new Date(raw);
  if(isNaN(then.getTime())) return null;
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}
// Friendly, always-visible status line for the Backup tab (not just the dismissible Overview
// reminder banner, which goes silent once a backup is recent) — shows exactly when the last
// one was taken right under the buttons, so it's never out of sight.
function lastBackupStatusText(){
  let raw = null;
  try{ raw = localStorage.getItem(LAST_BACKUP_KEY); }catch(e){ /* no storage available */ }
  const then = raw ? new Date(raw) : null;
  if(!then || isNaN(then.getTime())) return 'No backup taken yet on this device.';
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  const ago = days<=0 ? 'today' : days===1 ? 'yesterday' : `${days} days ago`;
  const whenStr = then.toLocaleDateString(undefined, {day:'numeric', month:'short', year:'numeric'})
    + ' at ' + then.toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'});
  return `Last backup: ${whenStr} (${ago})`;
}
// ---- One-tap backup from anywhere (reminder strip / Overview banner) ----
// Builds the same compressed (no password) file as Backup & Restore → Share, and opens the phone's
// share sheet (Drive, WhatsApp, Gmail...). The file is pre-built in the background while the
// reminder is showing so the share sheet opens straight from the tap; if sharing files isn't
// supported (e.g. desktop) it downloads the file instead. Use the Backup tab for a password.
let _quickBackupCache = null; // {raw, payload, suffix}
async function prepareQuickBackup(){
  try{
    const raw = JSON.stringify(DATA);
    if(_quickBackupCache && _quickBackupCache.raw === raw) return _quickBackupCache;
    let payload = raw, suffix = '';
    const gz = await gzipToBase64(raw);
    if(gz && gz.length < raw.length){ payload = BACKUP_GZ_PREFIX + gz; suffix = '-compressed'; }
    _quickBackupCache = {raw, payload, suffix};
    return _quickBackupCache;
  }catch(e){ return null; }
}
async function quickBackup(){
  const msgEl = document.getElementById('backupStripMsg');
  const say = t=>{ const el = msgEl || document.getElementById('statusLine'); if(el) el.textContent = t; };
  let c = _quickBackupCache;
  if(!c || c.raw !== JSON.stringify(DATA)){ say('Preparing backup…'); c = await prepareQuickBackup(); }
  if(!c){ say('Could not prepare the backup — open Backup & Restore and use Copy or Download.'); return; }
  const file = new File([c.payload], backupFileName(c.suffix), {type:'text/plain'});
  if(canShareFiles()){
    try{
      await navigator.share({files:[file], title:'Ibrahim Weaving Backup', text:`Ibrahim Weaving backup — ${fmtDate(todayStr())}`});
      recordBackupTaken();
      return;
    }catch(e){
      if(e && e.name === 'AbortError') return; // closed the share sheet — not an error
      // any other failure: fall through to a plain download
    }
  }
  const url = URL.createObjectURL(new Blob([c.payload], {type:'text/plain'}));
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 5000);
  recordBackupTaken();
}
// Reminder strip under the app bar. Appears once the last backup is 7+ days old (or there has
// never been one and there's data worth protecting). Dismissible for the day until it turns
// red at 14+ days, after which it stays until a backup is taken.
function backupStripHtml(tabId){
  if(tabId === 'overview' || tabId === 'backup') return '';
  const total = currentEntryCount();
  if(!total) return '';
  const days = daysSinceLastBackup();
  if(days !== null && days < 7) return '';
  const urgent = (days !== null && days >= 14) || (days === null && total >= 20);
  const signature = 'strip:' + days;
  if(!urgent && isBannerDismissed('backupstrip', signature)) return '';
  const since = entriesSinceLastBackup();
  const msg = days === null
    ? `No backup yet — ${total.toLocaleString()} entries live only on this phone.`
    : `Last backup ${days} day${days===1?'':'s'} ago${since ? ` · ${since.toLocaleString()} new entr${since===1?'y':'ies'} not backed up` : ''}.`;
  return `<div class="backup-strip${urgent?' urgent':''}" id="banner-backupstrip">
    <span class="bs-msg" id="backupStripMsg">⚠ ${msg}</span>
    <button type="button" class="primary bs-btn" onclick="quickBackup()">Back up now</button>
    ${urgent ? '' : `<button type="button" class="dismiss-btn" onclick="dismissBanner('backupstrip','${signature}')" aria-label="Dismiss" title="Dismiss">✕</button>`}
  </div>`;
}
function refreshBackupStrip(){
  const el = document.getElementById('backupStrip');
  if(!el) return;
  const html = backupStripHtml(CURRENT_TAB);
  el.innerHTML = html;
  if(html) setTimeout(prepareQuickBackup, 400); // pre-build so the share sheet opens instantly on tap
}
const BACKUP_GZ_PREFIX = 'KHATA-GZ1:'; // marks a gzip+base64-compressed backup, vs a plain JSON one
// Compresses a string with gzip and returns it as base64 text — used so a copy/pasted backup
// is far shorter to paste into Notes/Gmail/etc. Returns null if the browser doesn't support
// CompressionStream, so the caller can fall back to plain JSON.
async function gzipToBase64(str){
  if(!window.CompressionStream) return null;
  try{
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for(let i=0;i<bytes.length;i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }catch(e){ return null; }
}
async function base64ToGunzipped(b64){
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(buf);
}

// Undo support: rather than instrumenting every one of the app's many Add/Update/Delete
// handlers individually, everything funnels through save() already — so save() itself diffs
// the DATA it's about to persist against the snapshot from just before the *previous* save
// (i.e. the state right before whatever mutation is being saved now). An array that shrank
// means something was removed; same length but different contents means something was edited.
// A plain addition (arrays only grow, nothing else changes) is left alone — no Undo offered.
let UNDO_PREV_PARTS = null; // each top-level part of the ledger (as JSON text) right after the previous save
let UNDO_SUPPRESS = false; // set while an Undo's own save (or a restore) is running, so it isn't filed as a new change
let NEXT_UNDO_LABEL = null; // a caller can set this just before save() to give the resulting Undo entry a friendly name
async function save(){
  document.getElementById('statusLine').textContent = 'Saving…';
  const json = JSON.stringify(DATA);
  let changed = null; // 'removed' | 'updated' | null — also read below to decide the save haptic
  let curParts = null;
  try{ curParts = undoParts(); }catch(e){ curParts = null; }
  if(UNDO_PREV_PARTS && curParts && !UNDO_SUPPRESS){
    try{ changed = recordUndoEntry(UNDO_PREV_PARTS, curParts); }catch(e){ /* best effort only — never let this block an actual save */ }
  }
  NEXT_UNDO_LABEL = null;
  // Light "saved" buzz for everything except deletes, which already got their own firmer one
  // right when the delete was confirmed (see wireDelete) — avoids buzzing twice for one action.
  if(changed !== 'removed') haptic(10);
  UNDO_SUPPRESS = false;
  try{
    if(!window.storage || encEnabled()) throw new Error('window.storage unavailable');
    await window.storage.set(STORAGE_KEY, json);
    document.getElementById('statusLine').textContent = 'Saved';
    clearSaveFailure(); noteLedgerSize(json.length);
  }catch(e){
    // Fall back to the browser's own localStorage so data still persists even
    // when this file is opened outside a Claude artifact (window.storage missing).
    try{
      await ledgerToLocalStorage(json); // plain or encrypted, depending on Settings > Encrypt Data
      document.getElementById('statusLine').textContent = 'Saved (local backup)';
      clearSaveFailure(); noteLedgerSize(json.length);
    }catch(e2){
      if(e2 && e2.message === 'locked'){
        // Encrypted and not unlocked (or its stored copy couldn't be read): refuse to write, so nothing is ever overwritten.
        document.getElementById('statusLine').textContent = 'Locked';
      }else{
        document.getElementById('statusLine').textContent = 'Save failed — take a backup now';
        showSaveFailure();
        console.error(e, e2);
      }
    }
  }
  UNDO_PREV_PARTS = curParts; // baseline for detecting whatever gets saved *next*
  if(typeof updateWeekBadge === 'function') updateWeekBadge(); // header "Week Rs …" pill follows every change
  if(typeof autoBackupSchedule === 'function') autoBackupSchedule(); // emails a backup shortly after changes (Backup & Restore > Automatic email backup)
}
async function load(){
  if(encEnabled()){
    // Encrypted ledger: nothing can be read until the PIN (or recovery answer) has unlocked the key.
    // After that, afterUnlockLoad() calls this again.
    if(!ENC_DEK){ document.getElementById('statusLine').textContent = 'Locked'; return; }
    let stored = null;
    try{ stored = localStorage.getItem(ENC_DATA_KEY); }catch(e){ /* treated as empty below */ }
    if(stored){
      try{ Object.assign(DATA, JSON.parse(await encOpen(stored))); }
      catch(e){
        // Never carry on with a blank ledger here: the next save would overwrite the (unreadable) stored copy.
        ENC_LOAD_FAILED = true;
        showEncProblem('The encrypted data on this phone could not be read, so nothing was changed or overwritten. Restore a backup (clear the app data first if needed), or reinstall and restore.');
        return;
      }
    }
    if(await ensureDataDefaults()) await save();
    document.getElementById('statusLine').textContent = '';
    return;
  }
  let raw = null;
  try{
    if(!window.storage) throw new Error('window.storage unavailable');
    const r = await window.storage.get(STORAGE_KEY);
    if(r && r.value) raw = r.value;
  }catch(e){
    try{ raw = localStorage.getItem(STORAGE_KEY); }catch(e2){ /* no storage at all available */ }
  }
  if(raw){
    try{
      const saved = JSON.parse(raw);
      // A save has actually happened under this key before — trust it completely,
      // including any list a user has deliberately emptied out (e.g. deleted every
      // production record). Previously this only overwrote non-empty lists, which
      // meant a fully-emptied category silently reverted to the old seed data.
      Object.assign(DATA, saved);
    }catch(e){ /* corrupted snapshot, keep seed data */ }
  }
  if(await ensureDataDefaults()) await save();
  document.getElementById('statusLine').textContent = '';
}
// Fills in any array/field a loaded DATA object might be missing (a brand-new install,
// or a JSON backup restored from before a feature existed) and runs one-time migrations.
// Called on startup AND right after a Restore, since restoring swaps DATA wholesale and
// would otherwise skip all of this — which is what caused missing arrays (e.g. loanPayments
// from an older backup) to crash pages that read them. Returns true if anything changed.
async function ensureDataDefaults(){
  // One-time migration: seed Looms / Warp Types from whatever's already in
  // Production / Warp history, so existing users don't start from a blank list.
  let migrated = false;
  if(!DATA.looms) DATA.looms = [];
  if(!DATA.warpTypes) DATA.warpTypes = [];
  if(!DATA.weftTypes) DATA.weftTypes = [];
  if(!DATA.dyeingUnits) DATA.dyeingUnits = [];
  if(!DATA.banks) DATA.banks = [];
  if(!DATA.warpBeams) DATA.warpBeams = [];
  if(!DATA.wageBonuses) DATA.wageBonuses = [];
  if(!DATA.wagePayments) DATA.wagePayments = [];
  if(!DATA.wageSettlements) DATA.wageSettlements = [];
  if(!DATA.loanPayments) DATA.loanPayments = [];
  if(!DATA.loomAssignments) DATA.loomAssignments = [];
  if(!DATA.wageRateHistory) DATA.wageRateHistory = {};
  if(!DATA.businessInfo) DATA.businessInfo = {};
  // One-time migration: wage rates used to be a single flat "current rate" per quality
  // (DATA.wageRates), applied to ALL historical production regardless of date — so updating
  // a rate today silently rewrote already-settled wages for past months. Rates now have a
  // history (effective-from date + rate) per quality; seed each quality's history with its
  // old flat rate effective from the very start, so existing wage figures don't shift on
  // migration — only rate changes made from now on will be date-scoped correctly.
  if(DATA.wageRates && Object.keys(DATA.wageRates).length){
    Object.keys(DATA.wageRates).forEach(q=>{
      const r = Number(DATA.wageRates[q]) || 0;
      if(r && !(DATA.wageRateHistory[q] && DATA.wageRateHistory[q].length)){
        DATA.wageRateHistory[q] = [{date:'2000-01-01', rate:r}];
        migrated = true;
      }
    });
    delete DATA.wageRates;
    migrated = true;
  }
  // One-time migration: Advance / Advance Repayment used to live inside Wage Payments —
  // they're now tracked separately as employee Loans, since an advance to an employee
  // isn't really a wage. Move any legacy entries over (renaming the type) and strip them
  // out of Wage Payments so nothing is double-counted.
  const legacyAdvances = DATA.wagePayments.filter(p=>p.type==='Advance'||p.type==='Advance Repayment');
  if(legacyAdvances.length){
    legacyAdvances.forEach(p=>{
      DATA.loanPayments.push({...p, type: p.type==='Advance' ? 'Loan Given' : 'Loan Repaid'});
    });
    DATA.wagePayments = DATA.wagePayments.filter(p=>p.type!=='Advance'&&p.type!=='Advance Repayment');
    migrated = true;
  }
  if(!DATA.looms.length && DATA.production.some(r=>r.loom)){
    const names = [...new Set(DATA.production.map(r=>r.loom).filter(Boolean))]
      .sort((a,b)=> (Number(a)-Number(b)) || String(a).localeCompare(String(b)));
    DATA.looms = names.map(name=>({id:uid(), name}));
    migrated = true;
  }
  if(!DATA.warpTypes.length && DATA.warp.some(r=>r.type)){
    const names = [...new Set(DATA.warp.map(r=>r.type).filter(Boolean))];
    DATA.warpTypes = names.map(name=>({id:uid(), name}));
    migrated = true;
  }
  if(!DATA.weftTypes.length && DATA.weft.some(r=>r.type)){
    const names = [...new Set(DATA.weft.map(r=>r.type).filter(Boolean))];
    DATA.weftTypes = names.map(name=>({id:uid(), name}));
    migrated = true;
  }
  return migrated;
}
