/* Audit trail. Loaded after write-access.js and before autobackup.js / lock-init.js.
 *
 * WHAT IT DOES: every add, edit and delete of a record (and every change to a single setting such as the
 * business info) is written as ONE log entry: who (email), when, section, list, record id, action, and the
 * values before and after. Entries are only ever added. In the cloud they live in the "audit" collection
 * (one document per entry); only the owner can read them, nobody can edit one, and only the owner can delete
 * one (see CLOUD_FIRESTORE_RULE in cloud-sync.js).
 *
 * HOW NOTHING IS LOST:
 *   1. recStampEdits (cloud-sync.js) already compares the ledger with its state at the previous save. It now
 *      hands every difference to auditNote(), and save() (core.js) calls auditCommit() BEFORE the ledger itself
 *      is stored, so a change can never be stored on the phone without its log entry being on the phone too.
 *   2. auditCommit() seals each entry (with the section's key when Encrypt Data is on, so what is in the log is
 *      as private as the ledger) and appends it to a queue kept in this phone's storage (AUDIT_QUEUE_KEY).
 *   3. The queue is sent in order by auditFlush(): before every section push, at every Sync check, and when the
 *      app returns to the front. An entry leaves the queue only after Firebase has accepted it. Each entry has a
 *      fixed id, so sending it again after a dropped connection is harmless (the rule allows an identical repeat).
 *   4. A phone that is offline simply keeps the queue. A section push is never sent ahead of its entries: if the
 *      queue cannot be sent because of the connection, the push waits too.
 * If the cloud refuses the entries (the updated rule has not been pasted yet, or the access ended) they stay in
 * the queue, and nothing else about syncing changes; they go out as soon as the cloud accepts them.
 *
 * WHAT IS NOT LOGGED: a whole-ledger replace (restore from backup, pulling another phone's copy, a merge,
 * Undo of a cloud pull) - those are not edits by the person; the edits themselves were logged on the phone that
 * made them. An Undo inside the app is an ordinary change and is logged like one.
 */
const AUDIT_QUEUE_KEY = 'khata-audit-queue';        // [{ uid, doc, local? }] entries waiting to be sent
const AUDIT_PURGE_KEY = 'khata-audit-purge-day';    // the day (UTC) the owner's phone last removed year-old entries
const AUDIT_KEEP_MS = 365 * 86400000;               // entries and their records are kept one year
const AUDIT_SEND_TIMEOUT_MS = 15000;
const AUDIT_BATCH = 100;                            // entries sent per flush
let AUDIT_PENDING = [];                             // captured during a save, not yet sealed and queued
let AUDIT_OBJ_BASE = null;                          // {key: JSON} of the non-list values as of the last save/load
let AUDIT_STATUS = { state: 'idle', text: '' };     // what the owner's card says about sending
let AUDIT_FLUSHING = false;

// ---- Which changes are logged -------------------------------------------------------------------
function auditActive(){
  try{ return typeof cloudSyncEnabled === 'function' && cloudSyncEnabled() && !!recEditorEmail(); }
  catch(e){ return false; }
}
function auditStripStamps(rec){
  const c = Object.assign({}, rec);
  ['_mt', '_mb', '_ct', '_cb', '_ca', '_ma'].forEach(k=>{ delete c[k]; });
  return c;
}
// A short human name for a record, shown in the list ("12 Sep · Javed Ashraf").
function auditLabel(list, rec){
  const r = rec || {};
  const who = r.client || r.name || r.employee || r.person || r.quality || r.loom || r.bank || r.category || '';
  const what = r.date || r.from || r.day || '';
  const extra = r.description || r.note || r.desc || '';
  const s = [what, who, extra].filter(x=> x !== '' && x != null).map(String).join(' \u00b7 ');
  return s.length > 70 ? s.slice(0, 67) + '...' : s;
}
// Called by recStampEdits for every record that was added, changed or removed since the previous save.
function auditNote(action, list, before, after){
  if(!auditActive()) return;
  const ref = after || before || {};
  // A change the owner approved (proposals.js) is logged in the name of the person who proposed it, with the owner as the
  // approver (ab); everything else is logged in the name of whoever is signed in on this phone.
  const ap = (typeof REC_APPROVAL_NOW !== 'undefined' && REC_APPROVAL_NOW) ? REC_APPROVAL_NOW : null;
  const entry = {
    by: ap ? ap.by : recEditorEmail(), ct: Date.now(), action, list,
    recId: ref.id != null ? String(ref.id) : '',
    body: { label: auditLabel(list, ref), before: before || null, after: after || null },
  };
  if(ap) entry.ab = ap.ab;
  AUDIT_PENDING.push(entry);
}
// Owner's phone: a proposal the owner REJECTED is kept in the log too (action 'reject'): in the name of the person who proposed it,\n// with the owner as the one who rejected it, what they proposed (before / after) and the owner's note. The ledger is not touched.
async function auditNoteRejected(doc, body, note){
  try{
    const me = recEditorEmail();
    if(!me || !doc || !doc.by || !(typeof cloudIsOwner === 'function' && cloudIsOwner())) return;
    const b = body || {}, ref = b.after || b.before || {};
    AUDIT_PENDING.push({ by: String(doc.by), ab: me, ct: Date.now(), action: 'reject', list: doc.list, recId: doc.recId != null ? String(doc.recId) : '',
      body: { label: 'proposed ' + (doc.action || 'change') + (auditLabel(doc.list, ref) ? ': ' + auditLabel(doc.list, ref) : ''), before: b.before || null, after: b.after || null, proposed: doc.action || '', note: String(note == null ? '' : note).trim().slice(0, 500) } });
    await auditCommit();
  }catch(e){ console.error(e); }
}
// Single values and objects (business info, opening balance, wage period, rate defaults ...): not lists of
// records, so they are compared here. One entry per key that changed, logged as an edit of that setting.
function auditObjectsNow(){
  const o = {};
  Object.keys(DATA).forEach(k=>{
    if(k === 'deletedIds') return;
    const v = DATA[k];
    if(Array.isArray(v)) return;
    o[k] = JSON.stringify(v === undefined ? null : v);
  });
  return o;
}
function auditObjectsCompare(){
  const now = auditObjectsNow();
  if(AUDIT_OBJ_BASE){
    Object.keys(now).forEach(k=>{
      if(AUDIT_OBJ_BASE[k] === undefined || AUDIT_OBJ_BASE[k] === now[k]) return;
      let before = null, after = null;
      try{ before = JSON.parse(AUDIT_OBJ_BASE[k]); after = JSON.parse(now[k]); }catch(e){ return; }
      auditNote('edit', k, before, after); // recId stays '' for a setting (neither side has an id)
    });
  }
  AUDIT_OBJ_BASE = now;
}
function auditRebaseline(){ try{ AUDIT_OBJ_BASE = auditObjectsNow(); }catch(e){ AUDIT_OBJ_BASE = null; } }
function auditResetBaseline(){ AUDIT_OBJ_BASE = null; }

// ---- The queue on this phone --------------------------------------------------------------------
function auditQueueRead(){
  try{ const a = JSON.parse(localStorage.getItem(AUDIT_QUEUE_KEY) || '[]'); return Array.isArray(a) ? a : []; }
  catch(e){ return []; }
}
// Throws when the phone's storage refuses the write - callers keep the entries in memory and say so.
function auditQueueWrite(list){
  if(list.length) localStorage.setItem(AUDIT_QUEUE_KEY, JSON.stringify(list));
  else localStorage.removeItem(AUDIT_QUEUE_KEY);
}
function auditQueueCount(){ return auditQueueRead().length; }
function auditUid(ct){
  let r = '';
  try{ const b = new Uint8Array(6); crypto.getRandomValues(b); r = Array.from(b).map(x=> x.toString(16).padStart(2, '0')).join(''); }
  catch(e){ r = Math.random().toString(16).slice(2, 14); }
  return 'a' + String(ct).padStart(13, '0') + '-' + r;
}
// Turns one captured change into the document that will be stored in the cloud (sealed when needed).
async function auditBuildEntry(p){
  const section = cloudSectionOf(p.list);
  const json = JSON.stringify(p.body);
  const doc = { by: p.by, ct: p.ct, section, action: p.action, list: p.list, recId: p.recId, encrypted: false, payload: json };
  if(p.ab) doc.ab = p.ab; // approved by (the owner's own phone sends these; the rule lets the owner write any entry)
  let local = false;
  if(encEnabled()){
    doc.encrypted = true;
    try{
      if(typeof skSealSection !== 'function') throw new Error('no section keys');
      const sealed = await skSealSection(section, json);
      doc.payload = sealed.payload; doc.kv = sealed.kv;
    }catch(e){
      // The section key is not on this phone (yet): keep the entry sealed with this phone's own key and
      // seal it for the cloud when the key is there. It is never stored as readable text.
      doc.payload = await encSeal(json); local = true;
    }
  }
  return { uid: auditUid(p.ct), doc, local };
}
// Called by save() right after the changes were noted and before the ledger is stored.
async function auditCommit(){
  if(!AUDIT_PENDING.length) return;
  const batch = AUDIT_PENDING; AUDIT_PENDING = [];
  const built = [];
  try{
    for(const p of batch) built.push(await auditBuildEntry(p));
    const q = auditQueueRead();
    auditQueueWrite(q.concat(built));
  }catch(e){
    AUDIT_PENDING = batch.concat(AUDIT_PENDING); // nothing is dropped: tried again at the next save / flush
    console.error(e);
    AUDIT_STATUS = { state: 'error', text: 'could not keep the audit log on this phone (storage full?) - free some space, the entries are still waiting' };
    if(typeof showToast === 'function') try{ showToast('Audit log could not be saved on this phone - free up storage', 6000); }catch(_){}
    return;
  }
  auditRefreshCard();
}

// ---- Sending ------------------------------------------------------------------------------------
function auditWithTimeout(promise){
  return new Promise((resolve, reject)=>{
    const t = setTimeout(()=>{ const e = new Error('the connection is too slow'); e.auditTimeout = true; reject(e); }, AUDIT_SEND_TIMEOUT_MS);
    promise.then(v=>{ clearTimeout(t); resolve(v); }, e=>{ clearTimeout(t); reject(e); });
  });
}
// Brings a local-only entry up to date: opens it with this phone's key and seals it for the section.
async function auditResealLocal(item){
  if(!item.local) return true;
  try{
    const json = await encOpen(item.doc.payload);
    const sealed = await skSealSection(item.doc.section, json);
    item.doc.payload = sealed.payload; item.doc.kv = sealed.kv; item.local = false;
    return true;
  }catch(e){ return false; }
}
// Sends what is waiting (this account's own entries only). Returns { sent, left }. Throws only when the
// connection failed - the caller (a section push) then waits, so a change never gets ahead of its entry.
// A refusal by the cloud rule does not throw: the entries stay queued and the status says why.
async function auditFlush(db){
  if(AUDIT_FLUSHING) return { sent: 0, left: auditQueueCount() };
  const me = recEditorEmail();
  if(!me) return { sent: 0, left: auditQueueCount() };
  AUDIT_FLUSHING = true;
  let sent = 0;
  try{
    if(AUDIT_PENDING.length) await auditCommit();
    let q = auditQueueRead();
    const mine = q.filter(e=> e && e.doc && (e.doc.by === me || e.doc.ab === me)).sort((a, b)=> (a.deniedAt ? 1 : 0) - (b.deniedAt ? 1 : 0)).slice(0, AUDIT_BATCH); // entries the cloud refused earlier go last, so they never hold the others back
    const refused = []; // an approved change is logged in the proposer's name but sent by the approver (the owner)
    for(const item of mine){
      if(item.local && !(await auditResealLocal(item))) continue; // key not on this phone yet: stays queued
      if(!item.doc.encrypted && typeof skMustEncrypt === 'function' && skMustEncrypt(item.doc.section)) continue; // that section is sealed in the cloud: wait until Encrypt Data is on
      try{
        await auditWithTimeout(db.collection('audit').doc(item.uid).set(item.doc));
      }catch(e){
        if(cloudIsDenied(e)){ refused.push(item.uid); continue; } // kept on this phone; the others still go
        AUDIT_STATUS = { state: 'offline', text: 'waiting for a connection' };
        auditRefreshCard();
        throw e;
      }
      sent++;
      q = auditQueueRead().filter(x=> x && x.uid !== item.uid); // read again: entries may have been added meanwhile
      auditQueueWrite(q);
    }
    if(refused.length){
      try{ const stamp = Date.now(); auditQueueWrite(auditQueueRead().map(x=> (x && refused.indexOf(x.uid) >= 0) ? Object.assign({}, x, { deniedAt: stamp }) : x)); }catch(e){ /* the entries are still queued */ }
      AUDIT_STATUS = { state: 'denied', text: 'the cloud has not accepted ' + (refused.length === 1 ? 'one audit entry' : refused.length + ' audit entries') + ' yet (the updated Firebase rule is needed, or access has ended) - they are kept on this phone and will be sent later' };
      auditRefreshCard();
      return { sent, left: auditQueueCount() };
    }
    const left = auditQueueCount();
    AUDIT_STATUS = left ? { state: 'waiting', text: left + ' waiting to be sent' } : { state: 'idle', text: '' };
    auditRefreshCard();
    return { sent, left };
  }finally{ AUDIT_FLUSHING = false; }
}

// Owner's phone, once a day: removes entries older than a year so the log does not grow for ever.
async function auditPurge(db){
  if(!cloudIsOwner()) return;
  const day = new Date().toISOString().slice(0, 10);
  let last = null; try{ last = localStorage.getItem(AUDIT_PURGE_KEY); }catch(e){}
  if(last === day) return;
  const cutoff = Date.now() - AUDIT_KEEP_MS;
  for(let i = 0; i < 10; i++){
    const snap = await db.collection('audit').where('ct', '<', cutoff).limit(200).get();
    if(snap.empty) break;
    const batch = db.batch();
    snap.forEach(d=> batch.delete(d.ref));
    await batch.commit();
    if(snap.size < 200) break;
  }
  try{ localStorage.setItem(AUDIT_PURGE_KEY, day); }catch(e){}
}

// ---- The Audit screen (owner only) ----------------------------------------------------------------
// A page of its own in the drawer (Tools > Audit). Entries are read from the cloud newest first, 100 at a time.
// Only the date range is asked of the cloud (it is the one sort field, so no Firebase index is needed); person,
// section and action narrow the entries already loaded, instantly. "Load older" goes further back.
const AUDIT_PAGE = 100;
const AUDIT_SECTION_LABELS = { production: 'Production', reference: 'Qualities, looms, employees', sales: 'Sales', recovery: 'Recovery', expenses: 'Expenses', wages: 'Wages', loans: 'Employee loans', family: 'Family and personal', materials: 'Warp and weft', business: 'Business info', tools: 'Tools and settings' };
const AUDIT_ACTION_LABELS = { add: 'Added', edit: 'Edited', delete: 'Deleted', reject: 'Rejected' };
const AUDIT_FIELD_LABELS = { desc: 'Description', qty: 'Quantity', amt: 'Amount', invoice: 'Invoice no.', dyeing: 'Dyeing unit', paidTo: 'Paid to', kgPerCarton: 'Kg per carton', lbsPerBag: 'Lbs per bag', lbs: 'Lbs', warpType: 'Warp type', purchaseId: 'Purchase', carryForward: 'Carry forward', remarks: 'Remarks', cartons: 'Cartons', bags: 'Bags', supplier: 'Supplier', employee: 'Employee', loom: 'Loom', client: 'Client', quality: 'Quality', category: 'Category', person: 'Person', balance: 'Balance', length: 'Length', date: 'Date', time: 'Time', type: 'Type', rate: 'Rate', amount: 'Amount', name: 'Name' };
const AUDIT_MONEY_FIELDS = { amount: 1, amt: 1, balance: 1, carryForward: 1 };
let AUDIT_ROWS = [];        // loaded entries, newest first: { id, doc, body?, error? }
let AUDIT_LAST = null;      // the last document loaded, for "Load older"
let AUDIT_MORE = false;
let AUDIT_LOADING = false;
let AUDIT_LOADED_ONCE = false;
let AUDIT_FILTER = { who: '', section: '', action: '', from: '', to: '' };

function auditOwnerReady(){
  if(!cloudIsOwner()) return false;
  const u = cloudUserNow();
  return !!(u && u.verified);
}
function auditHuman(key){
  if(AUDIT_FIELD_LABELS[key]) return AUDIT_FIELD_LABELS[key];
  const t = String(key).replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function auditListLabel(list){
  if(typeof MERGE_LIST_NAMES !== 'undefined' && MERGE_LIST_NAMES[list]) return MERGE_LIST_NAMES[list][0].replace(/^./, c => c.toUpperCase());
  return auditHuman(list);
}
function auditSectionLabel(id){ return AUDIT_SECTION_LABELS[id] || auditHuman(id); }
function auditWhen(ms){
  try{ return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch(e){ return String(ms); }
}
function auditCsvWhen(ms){
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
// One value as a person would read it: dates as dates, amounts with separators, yes/no, empty as a dash.
function auditValue(key, v){
  if(v === null || v === undefined || v === '') return '\u2014';
  if(typeof v === 'boolean') return v ? 'Yes' : 'No';
  if(typeof v === 'number'){
    const s = Number.isInteger(v) ? v.toLocaleString('en-US') : String(v);
    return AUDIT_MONEY_FIELDS[key] ? 'Rs ' + s : s;
  }
  const s = String(v);
  if(/^\d{4}-\d{2}-\d{2}$/.test(s) && typeof fmtDate === 'function'){ try{ return fmtDate(s); }catch(e){ /* shown as stored */ } }
  return s.length > 200 ? s.slice(0, 197) + '...' : s;
}
// A record (or a nested value) as a flat list of [readable field name, leaf value], e.g. ['Cheques 1 \u203a Amount', 500].
function auditFlatten(v, prefix, key, out){
  out = out || [];
  if(v !== null && typeof v === 'object'){
    const isArr = Array.isArray(v);
    const keys = isArr ? v.map((_, i) => i) : Object.keys(v);
    if(!keys.length){ out.push([prefix, isArr ? '(none)' : '(empty)', key]); return out; }
    keys.forEach(k=>{
      if(!prefix && k === 'id') return;
      const name = isArr ? String(k + 1) : auditHuman(k);
      auditFlatten(v[k], prefix ? prefix + (isArr ? ' ' : ' \u203a ') + name : name, isArr ? key : k, out);
    });
    return out;
  }
  out.push([prefix, v, key]);
  return out;
}
// Rows of {field, before, after, changed} for one entry. An add or delete lists every field of that record; an
// edit marks the ones that differ and lists the rest as unchanged. A single setting (no id) shows its values.
function auditDiffRows(before, after){
  const b = new Map(), a = new Map(), order = [];
  const take = (v, m)=> { if(v === null || v === undefined) return; auditFlatten(v, typeof v === 'object' ? '' : 'Value', '', []).forEach(x=>{ const name = x[0] || 'Value'; if(!m.has(name) && order.indexOf(name) < 0) order.push(name); m.set(name, x); }); };
  take(before, b); take(after, a);
  const rows = order.map(name=>{
    const x = b.get(name), y = a.get(name);
    const xv = x ? x[1] : undefined, yv = y ? y[1] : undefined;
    const key = (x && x[2]) || (y && y[2]) || '';
    return { field: name, before: x ? auditValue(key, xv) : '\u2014', after: y ? auditValue(key, yv) : '\u2014', changed: !(x && y && JSON.stringify(xv) === JSON.stringify(yv)) };
  });
  return rows.slice(0, 120);
}
function auditFiltered(){
  const f = AUDIT_FILTER;
  return AUDIT_ROWS.filter(r=> (!f.who || r.doc.by === f.who) && (!f.section || r.doc.section === f.section) && (!f.action || r.doc.action === f.action));
}

// The small card that stays in Settings: sending status and the way in.
function auditCardHtml(){
  if(!auditOwnerReady()) return '';
  return `<div class="card" id="auditCard"><div class="card-head"><h2>Audit trail</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>Every add, edit and delete, by you and by other people. Only you can read it; it cannot be edited, and entries older than a year are removed automatically. Entries made on a phone without signal are sent when it is back online.</p>
    <p class="note" id="auditStatus" style="margin:0 0 8px"></p>
    <button class="ghost" id="auditOpenBtn" type="button" style="width:100%">Open Audit screen</button>
  </div>`;
}
function auditStatusLine(){
  const n = auditQueueCount() + AUDIT_PENDING.length;
  const parts = [];
  if(n) parts.push(n + ' of your own entries waiting to be sent');
  if(AUDIT_STATUS.state === 'denied' || AUDIT_STATUS.state === 'error') parts.push(AUDIT_STATUS.text);
  return parts.join(' - ');
}
function auditRefreshCard(){
  if(typeof document === 'undefined' || !document.getElementById) return;
  ['auditStatus', 'auditPanelStatus'].forEach(id=>{ const el = document.getElementById(id); if(el && !(id === 'auditPanelStatus' && AUDIT_LOADING)) el.textContent = auditStatusLine(); });
}

// The screen itself.
function auditPanel(){
  if(!auditOwnerReady()) return `<div class="card"><div class="card-head"><h2>Audit</h2></div><p class="note">Only the owner can open the audit trail.</p></div>`;
  const f = AUDIT_FILTER;
  const secOpts = '<option value="">All sections</option>' + cloudSectionIds().map(id => `<option value="${id}" ${f.section === id ? 'selected' : ''}>${escHtml(auditSectionLabel(id))}</option>`).join('');
  const actOpts = '<option value="">All actions</option>' + ['add', 'edit', 'delete', 'reject'].map(k => `<option value="${k}" ${f.action === k ? 'selected' : ''}>${AUDIT_ACTION_LABELS[k]}</option>`).join('');
  return `<div class="card"><div class="card-head"><h2>Audit</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>Every add, edit and delete, newest first: who, when, which record, and what it was before and after. Tap an entry to see the details. The dates narrow what is fetched from the cloud; person, section and action narrow what is already on screen (use Load older to go further back). Export CSV saves what you see, one line per changed field.</p>
    <p class="note" id="auditPanelStatus" style="margin:0 0 8px">${escHtml(auditStatusLine())}</p>
    <div class="grid cols-2">
      <div class="field"><label>From date</label><input type="date" id="auditFrom" value="${escHtml(f.from)}"></div>
      <div class="field"><label>To date</label><input type="date" id="auditTo" value="${escHtml(f.to)}"></div>
      <div class="field"><label>Person</label><select id="auditWho"><option value="">Everyone</option></select></div>
      <div class="field"><label>Section</label><select id="auditSection">${secOpts}</select></div>
      <div class="field"><label>Action</label><select id="auditAction">${actOpts}</select></div>
    </div>
    <div class="form-actions"><button class="primary" id="auditLoadBtn" type="button">Load</button><button class="ghost" id="auditClearBtn" type="button">Clear filters</button></div>
    <p class="note" id="auditCount" style="margin:10px 0 0"></p>
    <div id="auditList"></div>
    <button class="ghost" id="auditMoreBtn" type="button" style="width:100%;margin-top:8px;display:none">Load older</button>
    <div id="auditExport"></div>
  </div>`;
}
function auditRowHtml(r, i){
  const d = r.doc;
  const col = d.action === 'delete' ? 'var(--rust)' : 'inherit';
  const what = r.body ? (r.body.label || '') : '';
  const head = `<div style="display:flex;justify-content:space-between;gap:8px"><b style="color:${col}">${AUDIT_ACTION_LABELS[d.action] || escHtml(d.action)} \u00b7 ${escHtml(auditListLabel(d.list))}</b><span class="note" style="margin:0;white-space:nowrap">${escHtml(auditWhen(d.ct))}</span></div>
    <div class="note" style="margin:2px 0 0">${escHtml(d.by)}${d.ab ? (d.action === 'reject' ? ' (rejected by ' : ' (approved by ') + escHtml(d.ab) + ')' : ''} \u00b7 ${escHtml(auditSectionLabel(d.section))}${what ? ' \u00b7 ' + escHtml(what) : ''}</div>`;
  let detail = '';
  if(r.error) detail = `<p class="note" style="color:var(--rust);margin:6px 0 0">${escHtml(r.error)}</p>`;
  else if(r.body){
    const rows = auditDiffRows(r.body.before, r.body.after);
    const edit = d.action === 'edit' || d.action === 'reject';
    const shown = edit ? rows.filter(x => x.changed) : rows, rest = edit ? rows.length - shown.length : 0;
    const cell = 'padding:3px 6px 3px 0;vertical-align:top;font-size:13px';
    const tr = x => edit
      ? `<tr><td style="${cell};color:var(--ink-soft,#666)">${escHtml(x.field)}</td><td style="${cell}"><s>${escHtml(x.before)}</s></td><td style="${cell};font-weight:500">${escHtml(x.after)}</td></tr>`
      : `<tr><td style="${cell};color:var(--ink-soft,#666)">${escHtml(x.field)}</td><td style="${cell}">${escHtml(d.action === 'add' ? x.after : x.before)}</td></tr>`;
    const headRow = edit ? '<tr><th style="text-align:left;font-size:12px">Field</th><th style="text-align:left;font-size:12px">Before</th><th style="text-align:left;font-size:12px">After</th></tr>' : `<tr><th style="text-align:left;font-size:12px">Field</th><th style="text-align:left;font-size:12px">${d.action === 'add' ? 'Value added' : 'Value when deleted'}</th></tr>`;
    detail = `<div style="margin-top:6px;overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead>${headRow}</thead><tbody>${shown.map(tr).join('') || '<tr><td class="note">No field differences.</td></tr>'}</tbody></table>${rest ? `<p class="note" style="margin:4px 0 0">${rest} other field${rest === 1 ? '' : 's'} unchanged.</p>` : ''}</div>`;
  }
  return `<div class="audit-row" data-audit-i="${i}" style="border-top:1px solid var(--field-border);padding:8px 0;cursor:pointer">${head}<div class="audit-detail" hidden>${detail}</div></div>`;
}
function auditDrawList(){
  if(typeof document === 'undefined') return;
  const box = document.getElementById('auditList'); if(!box) return;
  const sel = document.getElementById('auditWho');
  if(sel){
    const people = Array.from(new Set(AUDIT_ROWS.map(r => r.doc.by).concat(AUDIT_FILTER.who ? [AUDIT_FILTER.who] : []))).sort();
    sel.innerHTML = '<option value="">Everyone</option>' + people.map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join('');
    sel.value = AUDIT_FILTER.who;
  }
  const rows = auditFiltered();
  const idx = new Map(AUDIT_ROWS.map((r, i) => [r, i]));
  box.innerHTML = rows.length ? rows.map(r => auditRowHtml(r, idx.get(r))).join('') : `<p class="note" style="margin:10px 0 0">${AUDIT_LOADED_ONCE ? 'No entries match.' : 'Tap Load to see the latest entries.'}</p>`;
  box.querySelectorAll('.audit-row').forEach(el=>{ el.onclick = ()=>{ const d = el.querySelector('.audit-detail'); if(d) d.hidden = !d.hidden; }; });
  const count = document.getElementById('auditCount');
  if(count) count.textContent = AUDIT_LOADED_ONCE ? `Showing ${rows.length} of ${AUDIT_ROWS.length} loaded${AUDIT_MORE ? ' - there are older entries' : ''}.` : '';
  const more = document.getElementById('auditMoreBtn'); if(more) more.style.display = AUDIT_MORE ? '' : 'none';
  const ex = document.getElementById('auditExport');
  if(ex) ex.innerHTML = typeof exportBarHtml === 'function' ? exportBarHtml('audit', rows.length) : '';
}
async function auditOpenDoc(doc){
  try{
    const res = await cloudDecryptRemote({ section: doc.section, encrypted: doc.encrypted === true, kv: doc.kv, payload: doc.payload });
    if(res.error) return { error: res.error };
    return { body: JSON.parse(res.json) };
  }catch(e){ return { error: 'this entry could not be read' }; }
}
function auditDayStart(str){ const d = new Date(str + 'T00:00:00'); return d.getTime(); }
function auditDayEnd(str){ const d = new Date(str + 'T23:59:59.999'); return d.getTime(); }
async function auditLoad(more){
  if(AUDIT_LOADING) return;
  AUDIT_LOADING = true;
  const st = typeof document !== 'undefined' ? document.getElementById('auditPanelStatus') : null;
  if(st) st.textContent = 'Loading...';
  try{
    if(typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('no connection - the audit log is read from the cloud');
    const db = await cloudSdkReady();
    let qy = db.collection('audit');
    if(AUDIT_FILTER.from) qy = qy.where('ct', '>=', auditDayStart(AUDIT_FILTER.from));
    if(AUDIT_FILTER.to) qy = qy.where('ct', '<=', auditDayEnd(AUDIT_FILTER.to));
    qy = qy.orderBy('ct', 'desc');
    if(more && AUDIT_LAST) qy = qy.startAfter(AUDIT_LAST);
    const snap = await qy.limit(AUDIT_PAGE).get();
    if(!more) AUDIT_ROWS = [];
    for(const d of snap.docs){
      const doc = d.data();
      AUDIT_ROWS.push(Object.assign({ id: d.id, doc }, await auditOpenDoc(doc)));
    }
    AUDIT_LAST = snap.docs.length ? snap.docs[snap.docs.length - 1] : (more ? AUDIT_LAST : null);
    AUDIT_MORE = snap.docs.length === AUDIT_PAGE;
    AUDIT_LOADED_ONCE = true;
    AUDIT_LOADING = false;
    auditDrawList(); auditRefreshCard();
  }catch(e){
    console.error(e);
    AUDIT_LOADING = false;
    const msg = cloudIsDenied(e) ? 'the cloud does not allow reading the audit log yet - paste the updated Firebase rule first' : (e && e.message ? e.message : 'could not load');
    if(st) st.textContent = msg;
  }
}
function wireAuditPanel(){
  if(!document.getElementById('auditLoadBtn')) return;
  const $ = id => document.getElementById(id);
  $('auditLoadBtn').onclick = ()=> auditLoad(false);
  $('auditMoreBtn').onclick = ()=> auditLoad(true);
  $('auditClearBtn').onclick = ()=>{
    const dateChanged = AUDIT_FILTER.from || AUDIT_FILTER.to;
    AUDIT_FILTER = { who: '', section: '', action: '', from: '', to: '' };
    $('auditFrom').value = ''; $('auditTo').value = ''; $('auditSection').value = ''; $('auditAction').value = '';
    if(dateChanged) auditLoad(false); else auditDrawList();
  };
  const dateChange = ()=>{ AUDIT_FILTER.from = $('auditFrom').value; AUDIT_FILTER.to = $('auditTo').value; auditLoad(false); };
  $('auditFrom').onchange = dateChange; $('auditTo').onchange = dateChange;
  $('auditWho').onchange = ()=>{ AUDIT_FILTER.who = $('auditWho').value; auditDrawList(); };
  $('auditSection').onchange = ()=>{ AUDIT_FILTER.section = $('auditSection').value; auditDrawList(); };
  $('auditAction').onchange = ()=>{ AUDIT_FILTER.action = $('auditAction').value; auditDrawList(); };
  auditDrawList();
  if(!AUDIT_LOADED_ONCE) auditLoad(false); // first visit: show the latest entries straight away
}
function wireAuditCard(){
  const btn = document.getElementById('auditOpenBtn');
  if(!btn) return;
  auditRefreshCard();
  btn.onclick = ()=> switchTab('audit');
}

// CSV: what is on screen (the filters applied), one line per changed field. Uses the app's common export button.
function auditCsvSource(){
  const headers = ['When', 'Person', 'Section', 'List', 'Action', 'Record', 'Field', 'Before', 'After'];
  const cells = [];
  auditFiltered().forEach(r=>{
    const d = r.doc;
    const base = [auditCsvWhen(d.ct), d.by + (d.ab ? (d.action === 'reject' ? ' (rejected by ' : ' (approved by ') + d.ab + ')' : ''), auditSectionLabel(d.section), auditListLabel(d.list), AUDIT_ACTION_LABELS[d.action] || d.action, (r.body && r.body.label) || d.recId];
    if(r.error || !r.body){ cells.push(base.concat(['(could not be read)', '', ''])); return; }
    const rows = auditDiffRows(r.body.before, r.body.after).filter(x => d.action === 'edit' ? x.changed : true);
    const dash = v => v === '\u2014' ? '' : v;
    if(!rows.length) cells.push(base.concat(['', '', '']));
    rows.forEach(x => cells.push(base.concat([x.field, d.action === 'add' ? '' : dash(x.before), d.action === 'delete' ? '' : dash(x.after)])));
  });
  const safe = t => escHtml(String(t == null ? '' : t)); // cells are read back as inert text by the common exporter
  return { headers, cells: cells.map(row => row.map(safe)) };
}
if(typeof EXPORT_SOURCES !== 'undefined'){ EXPORT_SOURCES.audit = auditCsvSource; }
if(typeof EXPORT_LABELS !== 'undefined'){ EXPORT_LABELS.audit = 'Audit'; }
