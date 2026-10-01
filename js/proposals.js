/* Proposals (Release 3, "Needs approval"). Loaded after audit.js and before autobackup.js / lock-init.js.
 *
 * WHAT IT DOES: when a person the owner marked "Needs approval" for a section (People > Sections > Needs my approval,
 * cloud-sync.js: cloudNeedsApproval) adds, edits or deletes something, the ledger is NOT changed. Instead every
 * change in that save is kept as a PROPOSAL: action (add / edit / delete), section, list, record id, a short label,
 * the values before and after, who, and when. The screen is put back to the ledger as it was and the person is told
 * the change is waiting for the owner.
 *
 *   add     before = null,          after = the new record
 *   edit    before = the old value, after = the new value (a whole record, or one setting such as the business info)
 *   delete  before = the record,    after = null            (deletes are proposals too)
 *
 * ONE SAVE IS ONE ACTION: if a save touches a section that needs approval, everything in that save waits, even a
 * part in a section that does not. (A rename of a quality or employee rewrites records in several sections; letting
 * half of it through would leave the ledger inconsistent.) A save that touches only sections that do not need
 * approval is stored as always.
 *
 * WHERE THEY ARE KEPT: in a queue on this phone (PROPOSALS_KEY), never inside the ledger, so they are not synced as
 * ledger data, not part of a backup of the ledger and not seen by anyone else. Each entry has the same shape as an
 * audit entry (plain: who, when, section, action, list, record id; sealed: label + before + after, sealed with this
 * phone's key when Encrypt Data is on, so nothing readable is ever kept next to an encrypted ledger). A proposal is
 * written BEFORE the ledger is put back; if it cannot be kept (storage full, locked, too many waiting) nothing is
 * proposed and nothing is changed, and the person is told. Sending them to the owner and applying them after approval
 * are separate steps; this file only captures them.
 *
 * WHAT THE PERSON SEES (Settings > Cloud Sync, their own account only): every proposal of theirs with a tag - \"Waiting for
 * approval\" while it is pending, \"Accepted\" or \"Rejected\" (with the owner's note) once decided. A pending one can be
 * WITHDRAWN (tap twice): it is removed from the queue, nothing else changes (the ledger never had it). A decided one can be
 * dismissed to clear it from the list. The decision itself is recorded by proposalsDecide(id, status, note), which the step
 * that brings the owner's answer to this phone calls; the note is kept sealed with the rest when Encrypt Data is on.
 *
 * WHO IS AFFECTED: never the owner, never a phone that has not been told its permissions, never a view-only phone
 * (it cannot change anything anyway), and never a change the role does not allow at all - that is refused first, by
 * the existing check (view-only.js: permsViolation), exactly as before.
 */
const PROPOSALS_KEY = 'khata-proposals';     // [{ id, by, ct, section, action, list, recId, status, local, payload }]
const PROPOSALS_MAX = 500;                    // most waiting at once on one phone
let PROPOSALS_BUSY = false;                   // one hold at a time (a second save waits its turn)

// ---- The queue on this phone -------------------------------------------------------------------
function proposalsRead(){
  try{ const a = JSON.parse(localStorage.getItem(PROPOSALS_KEY) || '[]'); return Array.isArray(a) ? a : []; }
  catch(e){ return []; }
}
// Throws when the phone's storage refuses the write.
function proposalsWrite(list){
  if(list.length) localStorage.setItem(PROPOSALS_KEY, JSON.stringify(list));
  else localStorage.removeItem(PROPOSALS_KEY);
}
// How many proposals are waiting for the owner (this phone's account only).
function proposalsCount(){
  const me = typeof recEditorEmail === 'function' ? recEditorEmail() : '';
  return proposalsRead().filter(p=> p && p.status === 'pending' && (!me || p.by === me)).length;
}
function proposalsUid(ct){
  let r = '';
  try{ const b = new Uint8Array(6); crypto.getRandomValues(b); r = Array.from(b).map(x=> x.toString(16).padStart(2, '0')).join(''); }
  catch(e){ r = Math.random().toString(16).slice(2, 14); }
  return 'p' + String(ct).padStart(13, '0') + '-' + r;
}
// The entries with their sealed part opened, newest last: [{ id, by, ct, section, action, list, recId, status, label, before, after }].
async function proposalsList(){
  const out = [];
  for(const p of proposalsRead()){
    if(!p) continue;
    let body = null;
    try{ body = JSON.parse(p.local ? await encOpen(p.payload) : p.payload); }catch(e){ body = null; }
    out.push({ id: p.id, by: p.by, ct: p.ct, section: p.section, action: p.action, list: p.list, recId: p.recId, status: p.status, sent: p.sent === true, blocked: p.blocked || '',
      label: body ? body.label : '', before: body ? body.before : null, after: body ? body.after : null, unreadable: !body,
      note: body && body.note ? String(body.note) : '', decidedAt: body && body.decidedAt ? body.decidedAt : 0 });
  }
  return out.sort((a, b)=> a.ct - b.ct || (a.id < b.id ? -1 : 1));
}

// ---- Working out what a save changed ------------------------------------------------------------
// Compares the ledger now with the ledger as it was (view-only.js: VIEW_BASELINE), record by record, and returns one
// change per record: { section, list, action, recId, label, before, after }. Records are matched by id (a record
// without an id by its whole value, so changing it reads as delete + add); a value that is not a list (business
// info, opening balance ...) is one edit of that setting; a list whose members are the same but in another order is
// one edit of the list. An empty value appearing where nothing was stored is only a default being filled in.
function proposalsChanges(){
  if(typeof VIEW_BASELINE === 'undefined' || !VIEW_BASELINE) return [];
  const base = cloudSplit(JSON.parse(VIEW_BASELINE)); // not caught here: if the comparison cannot be made, proposalsWouldHold answers 'fail' (the change is not stored)
  const cur = cloudSplit(DATA);
  const same = proposalsSame;
  const empty = v => v === undefined || v === '' || v === 0 || (Array.isArray(v) && !v.length) || (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
  const strip = r => (r && typeof r === 'object' && !Array.isArray(r) && typeof auditStripStamps === 'function') ? auditStripStamps(r) : r;
  const out = [];
  for(const sec of cloudSectionIds()){
    const b = base[sec] || {}, c = cur[sec] || {};
    if(same(b, c)) continue;
    const keys = Object.keys(Object.assign({}, b, c)).filter(k=> k !== 'deletedIds'); // deletion notes follow from the deletions themselves
    for(const k of keys){
      const x = b[k], y = c[k];
      if(same(x, y) || (empty(x) && empty(y))) continue;
      if(Array.isArray(x) || Array.isArray(y)){
        const xa = Array.isArray(x) ? x : [], ya = Array.isArray(y) ? y : [];
        const keyOf = r => (r && typeof r === 'object' && r.id !== undefined) ? 'id:' + r.id : 'raw:' + JSON.stringify(r);
        const xm = new Map(xa.map(r=> [keyOf(r), r])), ym = new Map(ya.map(r=> [keyOf(r), r]));
        const before = out.length;
        const item = (action, r0, r1)=>{
          const ref = r1 != null ? r1 : r0;
          const recId = (ref && typeof ref === 'object' && ref.id !== undefined) ? String(ref.id) : '';
          const label = typeof auditLabel === 'function' && ref && typeof ref === 'object' ? auditLabel(k, ref) : String(ref == null ? '' : ref);
          out.push({ section: sec, list: k, action, recId, label, before: r0 == null ? null : strip(r0), after: r1 == null ? null : strip(r1) });
        };
        ym.forEach((r, id)=>{ if(!xm.has(id)) item('add', null, r); else if(!same(xm.get(id), r)) item('edit', xm.get(id), r); });
        xm.forEach((r, id)=>{ if(!ym.has(id)) item('delete', r, null); });
        if(out.length === before){ // same members, different order
          out.push({ section: sec, list: k, action: 'edit', recId: '', label: 'Order changed', before: xa.map(strip), after: ya.map(strip) });
        }
      } else {
        out.push({ section: sec, list: k, action: 'edit', recId: '', label: k, before: x === undefined ? null : x, after: y === undefined ? null : y });
      }
    }
  }
  return out;
}

// ---- Holding a save -----------------------------------------------------------------------------
// Step 1 (instant, no waiting): does this save have to be held? Returns null (no: store it as usual), or the
// list of changes to keep as proposals. Runs first thing in save() (core.js), so a normal save is not delayed at
// all. If anything goes wrong while deciding, for an account that has sections needing approval, the answer is
// 'fail' (the change is NOT stored): an approval check that breaks must never let a change through.
function proposalsWouldHold(){
  try{
    if(typeof VIEW_SAVE_ALLOWED !== 'undefined' && VIEW_SAVE_ALLOWED) return null;           // the cloud copy arriving
    if(typeof permsLimited !== 'function' || !permsLimited()) return null;                     // the owner, or a phone not told its permissions
    if(typeof viewOnly === 'function' && viewOnly()) return null;                              // view-only: refused by the usual layer
    if(typeof VIEW_BASELINE === 'undefined' || !VIEW_BASELINE) return null;                   // nothing to compare with yet
    if(typeof VIEW_REVERTING !== 'undefined' && VIEW_REVERTING) return null;
    if(!cloudSectionIds().some(sec=> cloudNeedsApproval(sec))) return null;                    // nothing needs approval for this account
    try{
      if(permsViolation()) return null;                                                        // not allowed at all: refused by the usual layer
      const changes = proposalsChanges();
      if(!changes.length) return null;
      if(!changes.some(ch=> cloudNeedsApproval(ch.section))) return null;                     // only sections that do not need approval: store as always
      return changes;
    }catch(e){ console.error(e); return 'fail'; }
  }catch(e){
    console.error(e);
    try{ if(cloudSectionIds().some(sec=> cloudNeedsApproval(sec))) return 'fail'; }catch(e2){}
    return null;
  }
}
// Step 2: keep the changes as proposals, then put the ledger back and tell the person. Resolves true (the caller
// must stop: nothing is stored). Never resolves false: once a save has been held it is not stored, whatever happens.
async function proposalsHold(changes){
  if(changes === 'fail' || !Array.isArray(changes)){
    viewOnlyRevert('Nothing was changed \u2014 this change needs the owner\u2019s approval and could not be checked. Try again.');
    return true;
  }
  if(PROPOSALS_BUSY){ viewOnlyRevert('Wait a moment, then try again.'); return true; }
  PROPOSALS_BUSY = true;
  try{
    const me = typeof recEditorEmail === 'function' ? recEditorEmail() : '';
    const queue = proposalsRead();
    if(queue.filter(p=> p && p.status === 'pending').length + changes.length > PROPOSALS_MAX){
      viewOnlyRevert('Nothing was changed \u2014 too many changes are already waiting for the owner (' + PROPOSALS_MAX + ' at most). Ask the owner to deal with them first.');
      return true;
    }
    const t = Date.now(), built = [];
    for(const ch of changes){
      const json = JSON.stringify({ label: ch.label, before: ch.before, after: ch.after });
      let payload = json, local = false;
      if(typeof encEnabled === 'function' && encEnabled()){ payload = await encSeal(json); local = true; } // never readable next to an encrypted ledger
      built.push({ id: proposalsUid(t), by: me, ct: t, section: ch.section, action: ch.action, list: ch.list, recId: ch.recId, status: 'pending', local, payload });
    }
    proposalsWrite(queue.concat(built)); // kept BEFORE the ledger is put back
    proposalsKick(); // then sent to the owner right away when there is a connection (otherwise at the next Sync check)
    const n = built.length;
    viewOnlyRevert(n === 1 ? 'Saved as a proposal \u2014 the ledger is unchanged until the owner approves it.' : n + ' changes saved as proposals \u2014 the ledger is unchanged until the owner approves them.');
    return true;
  }catch(e){
    console.error(e);
    viewOnlyRevert('Nothing was changed \u2014 the change could not be kept as a proposal on this phone (storage full or locked).');
    return true;
  }finally{ PROPOSALS_BUSY = false; }
}

// ---- This person's own proposals: withdraw, decision, list ----------------------------------------------
function proposalsMe(){ return typeof recEditorEmail === 'function' ? recEditorEmail() : ''; }
// The signed-in account's proposals, oldest first (same filter as proposalsCount).
async function proposalsMine(){
  const me = proposalsMe();
  return (await proposalsList()).filter(p=> !me || p.by === me);
}
// Withdraw one that is still waiting. Returns 'ok', 'missing', 'decided' (already accepted / rejected: it cannot be withdrawn any
// more), 'offline' (it has already been sent to the owner, so it has to be taken back from the cloud, which needs a connection) or
// 'fail'. Only the account's own proposals can be withdrawn. One that was never sent is simply removed from this phone.
async function proposalsWithdraw(id){
  try{
    const me = proposalsMe();
    let p = proposalsRead().find(x=> x && x.id === id && (!me || x.by === me));
    if(!p) return 'missing';
    if(p.status !== 'pending') return 'decided';
    if(p.sent === true){
      if(typeof cloudSdkReady !== 'function' || (typeof cloudOffline === 'function' && cloudOffline())) return 'offline';
      let db = null;
      try{ db = await cloudSdkReady(); await db.collection('proposals').doc(id).delete(); }
      catch(e){
        if(typeof cloudIsDenied === 'function' && cloudIsDenied(e)){ // the rules only let it go while it is pending: the owner has answered meanwhile
          try{ if(db) await proposalsFetchDecisions(db); }catch(e2){ /* shown as it is at the next check */ }
          return 'decided';
        }
        return 'offline';
      }
    }
    const queue = proposalsRead();
    proposalsWrite(queue.filter(x=> !(x && x.id === id)));
    return 'ok';
  }catch(e){ console.error(e); return 'fail'; }
}
// Clear an ACCEPTED proposal from the list once it has been read. A rejected one is never cleared: it stays in the log ('kept').
function proposalsDismiss(id){
  try{
    const me = proposalsMe();
    const queue = proposalsRead();
    const p = queue.find(x=> x && x.id === id && (!me || x.by === me));
    if(!p) return 'missing';
    if(p.status === 'pending') return 'pending';
    if(p.status === 'rejected') return 'kept'; // a rejected proposal stays in the log: what was typed is never thrown away
    proposalsWrite(queue.filter(x=> x !== p));
    return 'ok';
  }catch(e){ console.error(e); return 'fail'; }
}
// Record the owner's answer on a pending proposal: status 'accepted' or 'rejected' plus the owner's note. Returns 'ok', 'missing',
// 'decided' (already answered: the first answer stands), 'bad-status' or 'fail'. The note is sealed with the rest when Encrypt Data is on.
async function proposalsDecide(id, status, note){
  if(status !== 'accepted' && status !== 'rejected') return 'bad-status';
  try{
    const queue = proposalsRead();
    const p = queue.find(x=> x && x.id === id);
    if(!p) return 'missing';
    if(p.status !== 'pending') return 'decided';
    let body = {};
    try{ body = JSON.parse(p.local ? await encOpen(p.payload) : p.payload) || {}; }catch(e){ return 'fail'; } // locked: cannot keep the note safely
    body.note = String(note == null ? '' : note).trim().slice(0, 500);
    body.decidedAt = Date.now();
    const json = JSON.stringify(body);
    p.payload = p.local ? await encSeal(json) : json;
    p.status = status;
    proposalsWrite(queue);
    return 'ok';
  }catch(e){ console.error(e); return 'fail'; }
}

// What the person typed, field by field, so a change that is not (or no longer) going anywhere can be read and typed again.
// Shown for waiting and rejected proposals (an accepted one is in the ledger). Stamps and ids are left out.
function proposalsTypedHtml(p){
  try{
    if(p.unreadable) return '<div class="note" style="font-size:12px;margin-top:4px">What you typed is sealed and cannot be shown until this phone is unlocked.</div>';
    const skip = k => k === 'id' || ['_mt', '_mb', '_ct', '_cb', '_ca', '_ma'].indexOf(k) >= 0;
    const src = p.action === 'delete' ? p.before : p.after;
    const same = proposalsSame;
    let lines = [];
    if(proposalsIsObj(src)){
      const b = proposalsIsObj(p.before) ? p.before : {};
      lines = Object.keys(src).filter(k=> !skip(k) && (p.action !== 'edit' || !same(b[k], src[k]))).map(k=> proposalsHuman(k) + ': ' + proposalsShow(k, src[k]));
    } else if(src !== null && src !== undefined && !Array.isArray(src)) lines = [proposalsShow('', src)];
    if(!lines.length) return '';
    return '<div style="font-size:12px;margin-top:4px;overflow-wrap:anywhere"><b>' + (p.action === 'delete' ? 'Record you deleted' : 'What you typed') + ':</b> ' + lines.map(escHtml).join(' \u00b7 ') + '</div>';
  }catch(e){ return ''; }
}
// The list shown in Settings > Cloud Sync. One row per proposal: what it was, then a tag.
const PROPOSAL_ACTION_WORDS = { add: 'Added', edit: 'Edited', delete: 'Deleted' };
function proposalsRowHtml(p){
  const sec = (typeof CLOUD_SECTION_LABELS !== 'undefined' && CLOUD_SECTION_LABELS[p.section]) || p.section;
  const what = [PROPOSAL_ACTION_WORDS[p.action] || p.action, sec, p.unreadable ? '' : p.label].filter(x=> x).join(' \u00b7 ');
  const tag = p.status === 'accepted' ? ['Accepted', 'var(--ok, #2f7d32)']
    : p.status === 'rejected' ? ['Rejected \u2014 kept here for your records', 'var(--rust)']
    : p.sent ? ['Sent \u2014 waiting for the owner\u2019s approval', 'var(--ink-soft, #8a6d1d)']
    : p.blocked === 'access' ? ['Not sent \u2014 your access has ended. Kept on this phone; it goes to the owner if they give you access again.', 'var(--rust)']
    : ['Not sent yet \u2014 kept on this phone, goes to the owner when there is a connection', 'var(--ink-soft, #8a6d1d)'];
  const note = p.status !== 'pending' && p.note ? '<div style="font-size:13px;margin-top:4px"><b>Owner\u2019s note:</b> ' + escHtml(p.note) + '</div>' : '';
  const typed = p.status === 'accepted' ? '' : proposalsTypedHtml(p);
  const btn = p.status === 'pending'
    ? '<button type="button" class="ghost" data-prop-withdraw="' + escHtml(p.id) + '" style="margin-top:6px;padding:6px 10px">Withdraw</button>'
    : p.status === 'rejected' ? ''
    : '<button type="button" class="ghost" data-prop-dismiss="' + escHtml(p.id) + '" style="margin-top:6px;padding:6px 10px">Clear</button>';
  return '<div style="padding:8px 0;border-top:1px solid var(--field-border)"><div style="font-size:14px">' + escHtml(what) + '</div>'
    + '<div style="font-size:12px;font-weight:600;color:' + tag[1] + '">' + tag[0] + '</div>' + note + typed + btn + '</div>';
}
// The empty box the account note carries; proposalsWire fills it (the labels may be sealed, so it cannot be built at once).
function proposalsBoxHtml(){
  try{
    const me = proposalsMe();
    const any = proposalsRead().some(p=> p && (!me || p.by === me));
    return any ? '<div id="proposalsBox" style="margin:0 0 8px"></div>' : '';
  }catch(e){ return ''; }
}
async function proposalsWire(){
  const box = document.getElementById('proposalsBox');
  if(!box) return;
  try{
    const mine = await proposalsMine();
    box.innerHTML = '<p class="note" style="margin:0 0 4px;font-weight:500">Your changes</p>' + mine.map(proposalsRowHtml).join('');
    const again = ()=>{ if(typeof switchTab === 'function') switchTab('settings'); };
    box.querySelectorAll('[data-prop-withdraw]').forEach(b=>{
      let armed = null; // tap once to arm, tap again to withdraw (same as Sign out)
      b.onclick = ()=>{
        if(!armed){
          b.textContent = 'Tap again to withdraw';
          armed = setTimeout(()=>{ armed = null; b.textContent = 'Withdraw'; }, 4000);
          return;
        }
        clearTimeout(armed); armed = null;
        b.disabled = true;
        proposalsWithdraw(b.getAttribute('data-prop-withdraw')).then(r=>{
          if(typeof showToast === 'function') showToast(r === 'ok' ? 'Withdrawn \u2014 the owner will not see it.' : r === 'decided' ? 'The owner has already answered this one.' : r === 'offline' ? 'No connection \u2014 it was already sent to the owner, so it can only be withdrawn online.' : 'Could not withdraw it.', 3500);
          again();
        });
      };
    });
    box.querySelectorAll('[data-prop-dismiss]').forEach(b=>{
      b.onclick = ()=>{ proposalsDismiss(b.getAttribute('data-prop-dismiss')); again(); };
    });
  }catch(e){ console.error(e); }
}

// ---- Sending to the owner, and learning the answer (the person's phone) -----------------------------------
// Same idea as the audit log (audit.js): each proposal is kept on this phone first, then sent to the cloud collection
// "proposals" (one document per proposal, the same id). What it holds is sealed with the section's key when Encrypt Data is
// on, so the cloud never holds readable text next to an encrypted ledger. A phone without signal keeps them and sends them
// at the next Sync check. Only the owner reads them all; the person reads their own back to learn the answer.
function proposalsTimeout(promise){ return typeof auditWithTimeout === 'function' ? auditWithTimeout(promise) : promise; }
// Changes one entry in the queue (read fresh, so a proposal added meanwhile is never lost).
function proposalsMark(id, patch){
  const q = proposalsRead(), p = q.find(x=> x && x.id === id);
  if(!p) return false;
  Object.assign(p, patch); proposalsWrite(q);
  return true;
}
// How many of this account's proposals are kept on this phone but have not reached the owner (offline, or access ended).
function proposalsUnsentCount(){
  try{ const me = proposalsMe(); return proposalsRead().filter(p=> p && p.status === 'pending' && p.sent !== true && (!me || p.by === me)).length; }
  catch(e){ return 0; }
}
// Try to send right now (after a change was held). Never throws, never waits.
function proposalsKick(){
  try{
    if(typeof cloudSyncEnabled === 'function' && cloudSyncEnabled() && typeof cloudSdkReady === 'function' && !(typeof cloudOffline === 'function' && cloudOffline())){
      cloudSdkReady().then(db=> proposalsSync(db)).catch(e=> console.error(e));
    }
  }catch(e){ /* sent at the next Sync check */ }
}
// Equal as data, whatever order the keys of an object were written in (a record saved by another phone or version can list the same\n// fields in another order; that is not a change).
function proposalsStable(v){ return JSON.stringify(v, (k, val)=> (val && typeof val === 'object' && !Array.isArray(val)) ? Object.keys(val).sort().reduce((o, kk)=>{ o[kk] = val[kk]; return o; }, {}) : val); }
function proposalsSame(x, y){ return proposalsStable(x) === proposalsStable(y); }
// The cloud document for one queued proposal; null when it cannot be sent yet. Throws when the section key is not on this phone yet.
async function proposalsDocFor(p){
  const json = p.local ? await encOpen(p.payload) : p.payload;
  const doc = { by: p.by, ct: p.ct, section: p.section, action: p.action, list: p.list, recId: p.recId, status: 'pending', encrypted: false, payload: json };
  if(typeof encEnabled === 'function' && encEnabled()){
    if(typeof skSealSection !== 'function') return null;
    const sealed = await skSealSection(p.section, json);
    doc.encrypted = true; doc.payload = sealed.payload; doc.kv = sealed.kv;
  } else if(typeof skMustEncrypt === 'function' && skMustEncrypt(p.section)) return null; // that section is sealed in the cloud: wait until Encrypt Data is on
  return doc;
}
// Sends this account's waiting proposals that have not gone yet. Returns how many were sent. A refusal by the cloud rule (the
// updated rule has not been pasted yet) leaves them queued; a dropped connection throws so the caller can say so.
async function proposalsSend(db){
  const me = proposalsMe();
  if(!me) return 0;
  let sent = 0;
  for(const p of proposalsRead().filter(x=> x && x.by === me && x.status === 'pending' && x.sent !== true)){
    let doc = null;
    try{ doc = await proposalsDocFor(p); }catch(e){ continue; } // locked, or the key is not here yet: stays queued
    if(!doc) continue;
    try{ await proposalsTimeout(db.collection('proposals').doc(p.id).set(doc)); }
    catch(e){
      if(typeof cloudIsDenied === 'function' && cloudIsDenied(e)){
        // The connection may have dropped AFTER the cloud took this one: sending it again is then refused (it was answered since), which is
        // not an ended access. If it is there, it counts as sent and its answer is read back below.
        let there = false;
        try{ const g = await proposalsTimeout(db.collection('proposals').doc(p.id).get()); there = !!(g && g.exists); }catch(e2){ there = false; }
        if(there){ proposalsMark(p.id, { sent: true, blocked: '' }); sent++; continue; }
        // access ended / removed (or the rule is not pasted yet): everything unsent stays on this phone, and says so
        for(const q of proposalsRead().filter(x=> x && x.by === me && x.status === 'pending' && x.sent !== true)) proposalsMark(q.id, { blocked: 'access' });
        return sent;
      }
      throw e;
    }
    proposalsMark(p.id, { sent: true, blocked: '' }); sent++;
  }
  return sent;
}
// Reads this account's proposals back and records each answer the owner has given (status + note). Returns how many were new.
async function proposalsFetchDecisions(db){
  const me = proposalsMe();
  if(!me) return 0;
  const waiting = proposalsRead().filter(x=> x && x.by === me && x.status === 'pending' && x.sent === true);
  if(!waiting.length) return 0;
  const snap = await proposalsTimeout(db.collection('proposals').where('by', '==', me).get());
  const byId = new Map(); snap.forEach(d=> byId.set(d.id, d.data()));
  let n = 0;
  for(const p of waiting){
    const d = byId.get(p.id);
    if(!d || (d.status !== 'accepted' && d.status !== 'rejected')) continue;
    let note = '';
    if(d.notePayload){
      try{
        const res = await cloudDecryptRemote({ section: p.section, encrypted: d.noteEncrypted === true, kv: d.noteKv, payload: d.notePayload });
        note = res && !res.error ? String(res.json || '') : 'The note could not be opened on this phone.';
      }catch(e){ note = 'The note could not be opened on this phone.'; }
    }
    if(await proposalsDecide(p.id, d.status, note) === 'ok') n++;
  }
  if(n){
    try{
      if(typeof showToast === 'function') showToast(n === 1 ? 'The owner has answered one of your changes.' : 'The owner has answered ' + n + ' of your changes.', 4000);
      if(typeof CURRENT_TAB !== 'undefined' && CURRENT_TAB === 'settings' && typeof switchTab === 'function') switchTab('settings');
    }catch(e){ /* the list is correct at the next draw */ }
  }
  return n;
}
// Runs at every Sync check (cloud-sync.js). Person: learn the answers, then send what is waiting. Owner: refresh the inbox count.
async function proposalsSync(db){
  if(typeof cloudIsOwner === 'function' && cloudIsOwner()){ await proposalsInboxCount(db); return; }
  await proposalsSend(db);            // first send, so a proposal the cloud already holds is marked sent ...
  await proposalsFetchDecisions(db);  // ... and its answer is read back in the same check
}

// ---- The owner's inbox ------------------------------------------------------------------------------------------
const INBOX_COUNT_KEY = 'khata-inbox-count';   // how many were waiting at the last look, so the badge shows before the cloud answers
let INBOX_ROWS = [];        // waiting proposals, oldest first: { id, doc, body?, error? }
let INBOX_LOADED = false;
let INBOX_LOADING = false;
let INBOX_ACTING = false;   // one answer at a time
let INBOX_MSG = '';
function proposalsOwnerReady(){ try{ return typeof auditOwnerReady === 'function' && auditOwnerReady(); }catch(e){ return false; } }
function proposalsSetCount(n){
  try{ localStorage.setItem(INBOX_COUNT_KEY, String(n)); }catch(e){}
  proposalsBadgeUpdate();
}
// The small pill next to the title: owner only, hidden at 0. Tapping it opens the inbox.
function proposalsBadgeUpdate(){
  try{
    const el = document.getElementById('inboxBadge');
    if(!el) return;
    let n = 0;
    if(proposalsOwnerReady()) n = INBOX_LOADED ? INBOX_ROWS.length : (Number(localStorage.getItem(INBOX_COUNT_KEY)) || 0);
    el.hidden = !(n > 0);
    if(n > 0) el.textContent = (n > 99 ? '99+' : n) + ' to approve';
  }catch(e){}
}
async function proposalsInboxCount(db){
  if(!proposalsOwnerReady()) return;
  const snap = await db.collection('proposals').where('status', '==', 'pending').limit(200).get();
  if(!INBOX_LOADED) proposalsSetCount(snap.size); // an opened inbox keeps its own, more exact, list
}
async function proposalsInboxLoad(){
  if(INBOX_LOADING) return;
  INBOX_LOADING = true;
  try{
    if(typeof cloudOffline === 'function' && cloudOffline()) throw new Error('no connection - approvals are read from the cloud');
    const db = await cloudSdkReady();
    await proposalsReopenRetry(db);
    const snap = await db.collection('proposals').where('status', '==', 'pending').limit(200).get();
    const rows = [];
    for(const d of snap.docs){ const doc = d.data(); rows.push(Object.assign({ id: d.id, doc }, await auditOpenDoc(doc))); }
    rows.sort((a, b)=> a.doc.ct - b.doc.ct || (a.id < b.id ? -1 : 1));
    INBOX_ROWS = rows; INBOX_LOADED = true; INBOX_MSG = '';
    proposalsSetCount(rows.length);
  }catch(e){
    console.error(e);
    INBOX_MSG = (typeof cloudIsDenied === 'function' && cloudIsDenied(e)) ? 'the cloud does not allow reading approvals yet - paste the updated Firebase rule first' : (e && e.message ? e.message : 'could not load');
  }finally{ INBOX_LOADING = false; }
  proposalsInboxDraw();
}

// Can this change be applied to the ledger as it is now? { error } (and why) or { apply } (a function that does it).
// An edit or delete is only applied when the record is still exactly as the person saw it. When the record has been changed
// since, the answer is { error, canForce: true }: the owner is shown both versions (proposalsCompareRows) and may apply it anyway.
//   opts.force  - apply although the record changed since. An EDIT then puts only the fields the person changed on top of the
//                 record as it is now (a field both changed: the person's value wins; fields only the owner changed stay), so two
//                 proposals for one record never wipe each other out. A DELETE removes the record as it is now.
//   opts.result - the owner's own edited version of the record / setting (proposalsOwnerAct passes it with force); it replaces
//                 the proposed one. The record keeps its id and its added stamps.
function proposalsIsObj(v){ return !!v && typeof v === 'object' && !Array.isArray(v); }
function proposalsMerge(cur, ch){
  const same = proposalsSame;
  if(!(proposalsIsObj(cur) && proposalsIsObj(ch.after))) return ch.after;
  const m = Object.assign({}, cur), b = proposalsIsObj(ch.before) ? ch.before : {};
  new Set(Object.keys(b).concat(Object.keys(ch.after))).forEach(k=>{
    if(same(b[k], ch.after[k])) return;                       // the person did not change this field: leave it as it is now
    if(ch.after[k] === undefined) delete m[k]; else m[k] = ch.after[k];
  });
  return m;
}
function proposalsApplyPlan(ch, opts){
  const o = opts || {}, force = o.force === true, hasResult = o.result !== undefined;
  const same = proposalsSame;
  const strip = r => (r && typeof r === 'object' && !Array.isArray(r) && typeof auditStripStamps === 'function') ? auditStripStamps(r) : r;
  const keep = (nr, old)=>{ if(proposalsIsObj(nr) && proposalsIsObj(old)) ['_ct', '_cb', '_ca'].forEach(f=>{ if(old[f] !== undefined) nr[f] = old[f]; }); return nr; };
  if(hasResult && ch.action === 'delete') return { error: 'a delete cannot be edited' };
  if(hasResult && ch.recId !== '' && !(proposalsIsObj(o.result) && String(o.result.id) === ch.recId)) return { error: 'the edited record is not valid' };
  const list = DATA[ch.list];
  if(!Array.isArray(list)){ // a single setting (business info, opening balance ...)
    if(ch.action !== 'edit') return { error: 'this setting cannot be applied' };
    const cur = list === undefined ? null : list, changed = !same(cur, ch.before);
    if(changed && !force) return { error: 'the setting has been changed since', canForce: true };
    return { apply: ()=>{ DATA[ch.list] = hasResult ? o.result : (changed ? proposalsMerge(cur, ch) : ch.after); } };
  }
  if(ch.action === 'edit' && ch.recId === '' && Array.isArray(ch.before) && Array.isArray(ch.after)){ // same members, another order
    if(hasResult) return { error: 'an order change cannot be edited' };
    if(!same(list.map(strip), ch.before)) return { error: 'the list has been changed since' };
    const key = r => (r && typeof r === 'object' && r.id !== undefined) ? 'id:' + r.id : 'raw:' + JSON.stringify(r);
    return { apply: ()=>{ const m = new Map(list.map(r=> [key(r), r])); DATA[ch.list] = ch.after.map(r=> m.get(key(r)) || r); } };
  }
  const find = ()=> ch.recId !== '' ? list.findIndex(r=> r && typeof r === 'object' && String(r.id) === ch.recId) : -1;
  if(ch.action === 'add'){
    if(ch.recId !== ''){ if(find() >= 0) return { error: 'a record with this id is already there' }; }
    else if(list.some(r=> same(strip(r), ch.after))) return { error: 'it is already there' };
    return { apply: ()=>{ list.push(hasResult ? o.result : ch.after); } };
  }
  if(ch.recId !== ''){
    const i = find();
    if(i < 0) return { error: 'the record is no longer there' };
    const changed = !same(strip(list[i]), ch.before);
    if(changed && !force) return { error: 'the record has been changed since', canForce: true };
    if(ch.action === 'delete') return { apply: ()=>{ list.splice(find(), 1); } };
    return { apply: ()=>{ const k = find(), old = list[k]; list[k] = keep(Object.assign({}, hasResult ? o.result : (changed ? proposalsMerge(old, ch) : ch.after)), old); } };
  }
  if(ch.action === 'delete'){ // a value without an id (an edit of one is stored as delete + add)
    if(list.findIndex(r=> same(strip(r), ch.before)) < 0) return { error: 'the entry is no longer there' };
    return { apply: ()=>{ list.splice(list.findIndex(r=> same(strip(r), ch.before)), 1); } };
  }
  return { error: 'this change cannot be applied' };
}
// Both versions for the owner: one row per field that matters - a field the person changed, or one that changed since they
// looked. { key, field, saw (the person's starting point), now (the ledger as it is), want (what they proposed), mine, since, clash }.
function proposalsCompareRows(ch){
  const same = proposalsSame;
  const strip = r => proposalsIsObj(r) && typeof auditStripStamps === 'function' ? auditStripStamps(r) : r;
  const list = DATA[ch.list];
  let cur = null;
  if(Array.isArray(list)){ const r = ch.recId !== '' ? list.find(x=> x && typeof x === 'object' && String(x.id) === ch.recId) : null; cur = r ? strip(r) : null; }
  else cur = list === undefined ? null : strip(list);
  const g = (o, k)=> proposalsIsObj(o) ? o[k] : undefined;
  const row = (key, field, saw, now, want)=>({ key, field, saw, now, want, mine: !same(saw, want), since: !same(saw, now), clash: !same(saw, want) && !same(saw, now) && !same(now, want) });
  if(!proposalsIsObj(ch.before) && !proposalsIsObj(ch.after) && !proposalsIsObj(cur)) return [row('', 'Value', ch.before, cur, ch.after)].filter(r=> r.mine || r.since);
  const keys = new Set([].concat(Object.keys(proposalsIsObj(ch.before) ? ch.before : {}), Object.keys(proposalsIsObj(ch.after) ? ch.after : {}), Object.keys(proposalsIsObj(cur) ? cur : {})));
  keys.delete('id');
  return Array.from(keys).map(k=> row(k, typeof auditHuman === 'function' ? auditHuman(k) : k, g(ch.before, k), g(cur, k), g(ch.after, k))).filter(r=> r.mine || r.since);
}
// The version the owner starts from when editing: the record as it is now with the person's changes on top (a plain proposal with
// nothing changed since: exactly what was proposed). null when this kind of change cannot be edited.
function proposalsEditBase(ch){
  if(ch.action === 'delete') return null;
  if(Array.isArray(ch.before) || Array.isArray(ch.after)) return null;
  const list = DATA[ch.list];
  if(Array.isArray(list) && ch.action === 'edit'){
    const r = ch.recId !== '' ? list.find(x=> x && typeof x === 'object' && String(x.id) === ch.recId) : null;
    if(!r) return null;
    return proposalsMerge(typeof auditStripStamps === 'function' ? auditStripStamps(r) : r, ch);
  }
  if(!Array.isArray(list) && ch.action === 'edit') return proposalsMerge(list === undefined ? null : list, ch);
  return ch.after;
}
// The owner's note as the fields stored on the proposal; sealed with the section's key when Encrypt Data is on. Always all three
// fields, so a note left by an earlier answer can never show through.
async function proposalsSealNote(section, note){
  const n = String(note == null ? '' : note).trim().slice(0, 500);
  if(!n) return { notePayload: '', noteKv: null, noteEncrypted: false };
  if(typeof encEnabled === 'function' && encEnabled()){
    const s = await skSealSection(section, n);
    return { notePayload: s.payload, noteKv: s.kv, noteEncrypted: true };
  }
  return { notePayload: n, noteKv: null, noteEncrypted: false };
}
// A proposal the owner accepted but whose change could not be stored on this phone goes back to waiting. When the cloud cannot be\n// reached at that moment the id is kept here and put back at the next inbox load, so an accepted-but-not-applied proposal never stays lost.
const INBOX_REOPEN_KEY = 'khata-inbox-reopen';
async function proposalsReopen(db, id){
  try{ await db.collection('proposals').doc(id).update({ status: 'pending' }); return true; }
  catch(e){
    try{ const a = JSON.parse(localStorage.getItem(INBOX_REOPEN_KEY) || '[]'); const l = Array.isArray(a) ? a : []; if(l.indexOf(id) < 0) l.push(id); localStorage.setItem(INBOX_REOPEN_KEY, JSON.stringify(l)); }catch(e2){ /* storage refused: the owner is told */ }
    return false;
  }
}
async function proposalsReopenRetry(db){
  let l = []; try{ const a = JSON.parse(localStorage.getItem(INBOX_REOPEN_KEY) || '[]'); l = Array.isArray(a) ? a : []; }catch(e){ l = []; }
  if(!l.length) return;
  const left = [];
  for(const id of l){
    try{
      const ref = db.collection('proposals').doc(id);
      await db.runTransaction(async tx=>{ const s = await tx.get(ref); if(s.exists && s.data().status === 'accepted') tx.update(ref, { status: 'pending' }); });
    }catch(e){ left.push(id); }
  }
  try{ if(left.length) localStorage.setItem(INBOX_REOPEN_KEY, JSON.stringify(left)); else localStorage.removeItem(INBOX_REOPEN_KEY); }catch(e){}
}
// Answers one proposal in the inbox. Accept: checks it still fits the ledger, marks it accepted in the cloud (only if it is still
// pending - that is what stops two phones answering the same one), then changes the ledger and saves. Reject: marks it only.
// Resolves { result }: 'ok' | 'conflict' (+ why) | 'unreadable' | 'decided' | 'gone' | 'denied' | 'offline' | 'fail'.
async function proposalsOwnerAct(id, status, note, opts){
  const row = INBOX_ROWS.find(r=> r.id === id);
  if(!row) return { result: 'gone' };
  if(status !== 'accepted' && status !== 'rejected') return { result: 'fail', why: 'unknown answer' };
  const d = row.doc;
  const ch = row.body ? { section: d.section, list: d.list, action: d.action, recId: d.recId, before: row.body.before, after: row.body.after } : null;
  if(status === 'accepted'){
    if(!ch) return { result: 'unreadable' };
    // A locked phone cannot store anything: say so BEFORE the cloud is told it was accepted.
    try{ if(typeof encEnabled === 'function' && encEnabled() && typeof ENC_DEK !== 'undefined' && !ENC_DEK) return { result: 'fail', why: 'this phone is locked - unlock it with your PIN first, then accept again' }; }catch(e){ /* the save below still checks */ }
    const plan = proposalsApplyPlan(ch, opts);
    if(plan.error) return { result: 'conflict', why: plan.error, canForce: plan.canForce === true };
  }
  // A note is what the person reads: when the owner changed the values or applied it on top of a newer version and wrote nothing,
  // say so, so the person is not surprised by what ended up in the ledger.
  if(status === 'accepted' && !String(note == null ? '' : note).trim() && opts){
    if(opts.result !== undefined) note = 'Accepted with changes by the owner';
    else if(opts.force) note = 'Accepted on top of a newer version of the record';
  }
  let nf;
  try{ nf = await proposalsSealNote(d.section, note); }catch(e){ return { result: 'fail', why: 'the note could not be sealed with this section\u2019s key' }; }
  let db, r;
  try{
    db = await cloudSdkReady();
    const ref = db.collection('proposals').doc(id);
    r = await db.runTransaction(async tx=>{
      const s = await tx.get(ref);
      if(!s.exists) return 'gone';
      if(s.data().status !== 'pending') return 'decided';
      tx.update(ref, Object.assign({ status, decidedAt: Date.now() }, nf));
      return 'ok';
    });
  }catch(e){ return { result: (typeof cloudIsDenied === 'function' && cloudIsDenied(e)) ? 'denied' : 'offline' }; }
  if(r !== 'ok') return { result: r };
  if(status === 'accepted'){
    const plan = proposalsApplyPlan(ch, opts); // again, now that the answer is recorded (the ledger could have moved meanwhile)
    if(plan.error){
      await proposalsReopen(db, id);
      return { result: 'conflict', why: plan.error, canForce: plan.canForce === true };
    }
    // The normal save path, stamped as the person's change that the owner approved: edit stamps show the person (_cb / _mb) and
    // the owner as approver (_ca / _ma), the audit entry is in the person's name with the owner as approver, and sync, merge,
    // tombstones and Undo work exactly as for any other change. A phone whose stamps have no baseline yet takes one first, so
    // the change is seen as a change.
    try{ if(typeof REC_BASE !== 'undefined' && !REC_BASE && typeof tombRebaseline === 'function') tombRebaseline(); }catch(e){ /* best effort */ }
    // What the ledger, the audit queue and the Undo list looked like just before, so that a change that could NOT be stored on this
    // phone (storage full, locked, an error) is taken back completely and the proposal goes back to waiting - never accepted in the
    // cloud while missing from the ledger.
    const snapJson = JSON.stringify(DATA);
    const auditSeen = new Set(typeof auditQueueRead === 'function' ? auditQueueRead().map(x=> x && x.uid) : []);
    const undoLen = typeof UNDO_STACK !== 'undefined' ? UNDO_STACK.length : 0;
    let stored = false, failWhy = '';
    plan.apply();
    try{ NEXT_UNDO_LABEL = 'Approved change by ' + d.by; }catch(e){}
    try{
      const me = typeof recEditorEmail === 'function' ? recEditorEmail() : '';
      REC_APPROVAL = (me && d.by) ? { by: String(d.by), ab: me, ct: Number(d.ct) } : null;
      stored = (await save()) !== false; // save() answers false when nothing reached this phone's storage
    }catch(e){ console.error(e); stored = false; failWhy = e && e.message ? e.message : ''; }
    finally{ REC_APPROVAL = null; }
    if(!stored){
      try{ Object.keys(DATA).forEach(k=>{ delete DATA[k]; }); Object.assign(DATA, JSON.parse(snapJson)); }catch(e){ console.error(e); }
      try{ if(typeof AUDIT_PENDING !== 'undefined') AUDIT_PENDING = []; if(typeof auditQueueRead === 'function') auditQueueWrite(auditQueueRead().filter(x=> x && auditSeen.has(x.uid))); }catch(e){ /* best effort */ }
      try{ if(typeof UNDO_STACK !== 'undefined') while(UNDO_STACK.length > undoLen) UNDO_STACK.pop(); if(typeof updateUndoButton === 'function') updateUndoButton(); }catch(e){}
      try{ if(typeof tombRebaseline === 'function') tombRebaseline(); if(typeof undoParts === 'function') UNDO_PREV_PARTS = undoParts(); }catch(e){}
      try{ if(typeof updateWeekBadge === 'function') updateWeekBadge(); }catch(e){}
      const back = await proposalsReopen(db, id);
      return { result: 'fail', why: 'the change could not be stored on this phone' + (failWhy ? ' (' + failWhy + ')' : ' (storage full or locked)') + ' - nothing was changed' + (back ? ' and it is waiting again' : '; it will be put back in the list when there is a connection') };
    }
  } else {
    // A rejected proposal stays in the audit log (who proposed it, what, before and after, your note); the ledger is not touched.
    try{ if(typeof auditNoteRejected === 'function') await auditNoteRejected(d, row.body || {}, note); }catch(e){ console.error(e); }
  }
  INBOX_ROWS = INBOX_ROWS.filter(x=> x.id !== id);
  proposalsSetCount(INBOX_ROWS.length);
  return { result: 'ok' };
}
// Accepts everything waiting from one person, oldest first, each one checked against the ledger as the ones before it left it.
async function proposalsOwnerAcceptAll(who){
  const ids = INBOX_ROWS.filter(r=> r.doc.by === who).map(r=> r.id);
  let ok = 0; const stuck = [];
  for(const id of ids){
    const x = await proposalsOwnerAct(id, 'accepted', '');
    if(x.result === 'ok'){ ok++; continue; }
    stuck.push(x);
    if(x.result === 'offline' || x.result === 'denied') break; // the rest would fail the same way
  }
  return { ok, stuck, total: ids.length };
}
function proposalsWhy(x){
  return x.result === 'conflict' ? 'it no longer fits the ledger (' + x.why + ')'
    : x.result === 'unreadable' ? 'it could not be read (the section key may be missing)'
    : x.result === 'decided' ? 'it was already answered on another phone'
    : x.result === 'gone' ? 'it was withdrawn by the person'
    : x.result === 'denied' ? 'the cloud did not allow it (paste the updated Firebase rule)'
    : x.result === 'offline' ? 'there is no connection'
    : (x.why || 'something went wrong');
}

// The screen (Tools > Approvals).
function proposalsInboxPanel(){
  if(!proposalsOwnerReady()) return '<div class="card"><div class="card-head"><h2>Approvals</h2></div><p class="note">Only the owner can open approvals.</p></div>';
  return '<div class="card"><div class="card-head"><h2>Approvals</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>'
    + '<p class="note info-note" hidden>Changes made by people you marked \u201cNeeds my approval\u201d wait here; the ledger does not change until you accept. Accept puts the change into the ledger (an edit or delete is only applied if the record is still as the person saw it; otherwise it stays here and you can reject it). Reject leaves the ledger as it is. Either way the person sees your answer and your note on their phone. Accept all takes everything waiting from one person, oldest first.</p>'
    + '<p class="note" id="inboxMsg" role="status" style="margin:0 0 8px"></p>'
    + '<button class="ghost" id="inboxReloadBtn" type="button" style="width:100%">Refresh</button>'
    + '<div id="inboxList"></div></div>';
}
// Other proposals waiting for the same record (or the same setting): accepting one makes the others ask again.
function proposalsSiblings(r){
  if(!r || !r.doc) return [];
  const same = x => x.id !== r.id && x.doc.list === r.doc.list && (r.doc.recId !== '' ? x.doc.recId === r.doc.recId : (x.doc.recId === '' && !Array.isArray(DATA[r.doc.list])));
  return INBOX_ROWS.filter(same);
}
// The owner's edited version from the edit form's fields [{ k: field, t: 'n' | 's' | 'b', raw: what was typed }]. { result } or { bad }.
function proposalsBuildResult(base, fields){
  let result = proposalsIsObj(base) ? Object.assign({}, base) : base, bad = '';
  (fields || []).forEach(f=>{
    const raw = String(f.raw == null ? '' : f.raw).trim();
    let v;
    if(f.t === 'n'){ v = raw === '' ? '' : Number(raw.replace(/,/g, '')); if(raw !== '' && !Number.isFinite(v) && !bad) bad = (f.k ? proposalsHuman(f.k) : 'Value') + ' must be a number'; }
    else if(f.t === 'b') v = raw === 'true';
    else v = String(f.raw == null ? '' : f.raw);
    if(f.k === '') result = v; else result[f.k] = v;
  });
  return bad ? { bad } : { result };
}
function proposalsHuman(k){ return typeof auditHuman === 'function' ? auditHuman(k) : k; }
function proposalsShow(key, v){
  if(v === undefined || v === null || v === '') return '\u2014';
  if(typeof v === 'object') return JSON.stringify(v);
  return typeof auditValue === 'function' ? auditValue(key, v) : String(v);
}
// Both versions, field by field, for a record that changed after the proposal was made.
function proposalsConflictHtml(r, ch){
  const rows = proposalsCompareRows(ch);
  const line = (lbl, v, bold)=> '<div style="display:flex;gap:6px;font-size:13px"><span style="min-width:74px;color:var(--ink-soft,#666)">' + lbl + '</span><span style="min-width:0;overflow-wrap:anywhere' + (bold ? ';font-weight:600' : '') + '">' + escHtml(v) + '</span></div>';
  const body = rows.map(x=> '<div style="padding:6px 0;border-top:1px solid var(--field-border)"><div style="font-size:13px"><b>' + escHtml(x.field) + '</b>'
    + (x.clash ? ' <span style="color:var(--rust)">\u00b7 you both changed this</span>' : (x.since && !x.mine ? ' <span class="note" style="margin:0">\u00b7 changed since, not part of the proposal</span>' : ''))
    + '</div>' + line('They saw', proposalsShow(x.key, x.saw)) + line('Now', proposalsShow(x.key, x.now), x.since) + line('They want', proposalsShow(x.key, x.want), x.mine)).join('</div>') + (rows.length ? '</div>' : '');
  return '<div data-inb-conflict="' + escHtml(r.id) + '" style="margin:8px 0;padding:8px;border:1px solid var(--rust);border-radius:8px">'
    + '<div style="color:var(--rust);font-weight:600">Changed since ' + escHtml(r.doc.by) + ' made this proposal</div>'
    + '<p class="note" style="margin:4px 0 0">Nothing is applied until you choose. Accept anyway puts only what they changed on top of the record as it is now (where you both changed the same field, theirs wins). Edit lets you pick the final values. Reject leaves the ledger as it is.</p>'
    + (body || '<p class="note" style="margin:6px 0 0">No field differences to show.</p>') + '</div>';
}
function proposalsEditHtml(r, base){
  const id = escHtml(r.id), cell = 'width:100%;margin:0 0 6px';
  let html = '';
  if(proposalsIsObj(base)){
    Object.keys(base).forEach(k=>{
      if(k === 'id' || (typeof auditStripStamps === 'function' && ['_mt', '_mb', '_ct', '_cb', '_ca', '_ma'].indexOf(k) >= 0)) return;
      const v = base[k], label = escHtml(typeof auditHuman === 'function' ? auditHuman(k) : k);
      if(v !== null && typeof v === 'object'){ html += '<label class="note" style="display:block;margin:4px 0 2px">' + label + ' (kept as it is)</label><div class="note" style="margin:0 0 6px;overflow-wrap:anywhere">' + escHtml(JSON.stringify(v)) + '</div>'; return; }
      const t = typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : 's';
      html += '<label class="note" style="display:block;margin:4px 0 2px">' + label + '</label>' + (t === 'b'
        ? '<select data-inb-f="' + id + '" data-k="' + escHtml(k) + '" data-t="b" style="' + cell + '"><option value="true"' + (v ? ' selected' : '') + '>Yes</option><option value="false"' + (v ? '' : ' selected') + '>No</option></select>'
        : '<input type="text" ' + (t === 'n' ? 'inputmode="decimal" ' : '') + 'data-inb-f="' + id + '" data-k="' + escHtml(k) + '" data-t="' + t + '" value="' + escHtml(v === undefined || v === null ? '' : v) + '" style="' + cell + '">');
    });
  }else{
    const t = typeof base === 'number' ? 'n' : 's';
    html = '<label class="note" style="display:block;margin:4px 0 2px">Value</label><input type="text" ' + (t === 'n' ? 'inputmode="decimal" ' : '') + 'data-inb-f="' + id + '" data-k="" data-t="' + t + '" value="' + escHtml(base === undefined || base === null ? '' : base) + '" style="' + cell + '">';
  }
  return '<div data-inb-editbox="' + id + '" hidden style="margin:8px 0;padding:8px;border:1px solid var(--field-border);border-radius:8px"><p class="note" style="margin:0 0 6px">Starts from the record as it is now with ' + escHtml(r.doc.by) + '\u2019s changes on top. Values are shown as stored.</p>' + html
    + '<button class="primary" type="button" data-inb-saveedit="' + id + '" style="width:100%">Save my version and accept</button></div>';
}
function proposalsInboxRowHtml(r){
  const id = escHtml(r.id);
  const row = auditRowHtml({ doc: r.doc, body: r.body, error: r.error }, 0).replace('class="audit-detail" hidden', 'class="audit-detail"'); // before and after shown straight away
  const ch = r.body ? { section: r.doc.section, list: r.doc.list, action: r.doc.action, recId: r.doc.recId, before: r.body.before, after: r.body.after } : null;
  const plan = ch ? proposalsApplyPlan(ch) : null;
  const conflict = !!(plan && plan.error && plan.canForce);
  const blocked = !!(plan && plan.error && !plan.canForce);       // cannot be applied at all: only Reject makes sense
  const sib = proposalsSiblings(r);
  const base = ch && !blocked ? proposalsEditBase(ch) : null;
  const btn = (attr, cls, text)=> '<button class="' + cls + '" type="button" ' + attr + '="' + id + '" style="flex:1">' + text + '</button>';
  let buttons = '';
  if(conflict) buttons += btn('data-inb-force', 'primary', 'Accept anyway');
  else if(!blocked) buttons += btn('data-inb-accept', 'primary', 'Accept');
  if(base !== null && base !== undefined) buttons += btn('data-inb-edit', 'ghost', 'Edit');
  buttons += btn('data-inb-reject', 'ghost', 'Reject');
  return '<div data-inb-row="' + id + '">' + row
    + (conflict ? proposalsConflictHtml(r, ch) : '')
    + (blocked ? '<p class="note" style="color:var(--rust);margin:6px 0 0">This cannot be applied: ' + escHtml(plan.error) + '. You can reject it.</p>' : '')
    + (sib.length ? '<p class="note" data-inb-sibling="' + id + '" style="margin:6px 0 0">Another proposal for this same ' + (r.doc.recId !== '' ? 'record' : 'setting') + ' is waiting (' + sib.map(x=> escHtml(x.doc.by) + ', ' + escHtml(x.doc.action)).join('; ') + '). Accepting one makes the other ask you again; nothing is overwritten without you seeing both.</p>' : '')
    + ((base !== null && base !== undefined) ? proposalsEditHtml(r, base) : '')
    + '<input type="text" data-inb-note="' + id + '" placeholder="Note to ' + escHtml(r.doc.by) + ' (optional)" maxlength="500" style="width:100%;margin:6px 0">'
    + '<div style="display:flex;gap:8px;padding-bottom:8px">' + buttons + '</div></div>';
}
function proposalsInboxDraw(){
  if(typeof document === 'undefined' || !document.getElementById) return;
  const box = document.getElementById('inboxList'), msg = document.getElementById('inboxMsg');
  if(msg) msg.textContent = INBOX_MSG;
  if(!box) return;
  if(!INBOX_LOADED){ box.innerHTML = INBOX_MSG ? '' : '<p class="note" style="margin:10px 0 0">Loading\u2026</p>'; return; }
  if(!INBOX_ROWS.length){ box.innerHTML = '<p class="note" style="margin:10px 0 0">Nothing is waiting for your approval.</p>'; return; }
  const groups = new Map();
  INBOX_ROWS.forEach(r=>{ if(!groups.has(r.doc.by)) groups.set(r.doc.by, []); groups.get(r.doc.by).push(r); });
  let html = '';
  groups.forEach((rows, who)=>{
    html += '<div style="margin-top:14px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="min-width:0;overflow-wrap:anywhere">' + escHtml(who) + ' \u00b7 ' + rows.length + ' waiting</b>'
      + '<button class="ghost" type="button" data-inb-all="' + escHtml(who) + '" style="white-space:nowrap">Accept all (' + rows.length + ')</button></div>' + rows.map(proposalsInboxRowHtml).join('') + '</div>';
  });
  if(INBOX_ROWS.length >= 200) html = '<p class="note" style="margin:10px 0 0">Showing the first 200 waiting. Answer some, then tap Refresh to bring in the rest. \u201cAccept all\u201d counts only what is shown here.</p>' + html;
  box.innerHTML = html;
  const after = async (text)=>{ await proposalsInboxLoad(); INBOX_MSG = text; proposalsInboxDraw(); if(typeof showToast === 'function') showToast(text, 4000); };
  const busy = on => box.querySelectorAll('button').forEach(b=>{ b.disabled = on; });
  const noteOf = id => { const el = box.querySelector('[data-inb-note="' + id + '"]'); return el ? el.value : ''; };
  const answer = (id, status, opts)=> async ()=>{
    if(INBOX_ACTING) return;
    let o = opts;
    if(typeof opts === 'function'){ o = opts(); if(o === null) return; } // the edit form: null = a value is not valid, already told
    INBOX_ACTING = true; busy(true);
    let text;
    try{
      const x = await proposalsOwnerAct(id, status, noteOf(id), o);
      text = x.result === 'ok' ? (status === 'accepted' ? 'Accepted \u2014 the ledger has been changed.' : 'Rejected \u2014 the ledger is unchanged.') : 'Not ' + status + ': ' + proposalsWhy(x) + '.';
    }catch(e){ console.error(e); text = 'Something went wrong; nothing was changed.'; }
    INBOX_ACTING = false;
    await after(text);
  };
  // The owner's own version from the edit form (proposalsBuildResult): numbers stay numbers, nothing half-typed is accepted.
  const editedOf = id => ()=>{
    const row = INBOX_ROWS.find(x=> x.id === id); if(!row || !row.body) return null;
    const ch = { section: row.doc.section, list: row.doc.list, action: row.doc.action, recId: row.doc.recId, before: row.body.before, after: row.body.after };
    const base = proposalsEditBase(ch); if(base === null || base === undefined) return null;
    const fields = Array.from(box.querySelectorAll('[data-inb-f="' + id + '"]')).map(el=> ({ k: el.getAttribute('data-k'), t: el.getAttribute('data-t'), raw: el.value }));
    const x = proposalsBuildResult(base, fields);
    if(x.bad){ if(typeof showToast === 'function') showToast(x.bad, 4000); return null; }
    return { force: true, result: x.result };
  };
  box.querySelectorAll('[data-inb-accept]').forEach(b=>{ b.onclick = answer(b.getAttribute('data-inb-accept'), 'accepted'); });
  box.querySelectorAll('[data-inb-force]').forEach(b=>{ b.onclick = answer(b.getAttribute('data-inb-force'), 'accepted', { force: true }); });
  box.querySelectorAll('[data-inb-edit]').forEach(b=>{ b.onclick = ()=>{ const el = box.querySelector('[data-inb-editbox="' + b.getAttribute('data-inb-edit') + '"]'); if(el) el.hidden = !el.hidden; }; });
  box.querySelectorAll('[data-inb-saveedit]').forEach(b=>{ const id = b.getAttribute('data-inb-saveedit'); b.onclick = answer(id, 'accepted', editedOf(id)); });
  box.querySelectorAll('[data-inb-reject]').forEach(b=>{ b.onclick = answer(b.getAttribute('data-inb-reject'), 'rejected'); });
  box.querySelectorAll('[data-inb-all]').forEach(b=>{
    let armed = null; // tap once to arm, tap again to accept everything from this person (same as Sign out)
    const who = b.getAttribute('data-inb-all'), label = b.textContent;
    b.onclick = async ()=>{
      if(INBOX_ACTING) return;
      if(!armed){ b.textContent = 'Tap again to accept all'; armed = setTimeout(()=>{ armed = null; b.textContent = label; }, 4000); return; }
      clearTimeout(armed); armed = null;
      INBOX_ACTING = true; busy(true);
      let text;
      try{
        const x = await proposalsOwnerAcceptAll(who);
        text = 'Accepted ' + x.ok + ' of ' + x.total + ' from ' + who + '.' + (x.stuck.length ? ' ' + x.stuck.length + ' left waiting: ' + proposalsWhy(x.stuck[0]) + (x.stuck.length > 1 ? ' (and others)' : '') + '. Open each to see both versions.' : '');
      }catch(e){ console.error(e); text = 'Something went wrong; check the list.'; }
      INBOX_ACTING = false;
      await after(text);
    };
  });
}
function wireProposalsInbox(){
  const btn = document.getElementById('inboxReloadBtn');
  if(btn) btn.onclick = ()=> proposalsInboxLoad();
  proposalsInboxDraw();
  proposalsInboxLoad(); // always the latest when the screen is opened
}
if(typeof document !== 'undefined' && document.addEventListener){
  document.addEventListener('click', e=>{
    try{ if(e.target && e.target.closest && e.target.closest('#inboxBadge') && typeof switchTab === 'function') switchTab('inbox'); }catch(_){}
  });
}
try{ proposalsBadgeUpdate(); }catch(e){}
// Back online: send what was kept while there was no connection (no need to wait for the next Sync check).
try{ if(typeof window !== 'undefined' && window.addEventListener) window.addEventListener('online', ()=> setTimeout(proposalsKick, 2000)); }catch(e){}
