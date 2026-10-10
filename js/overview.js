/* Overview page (stock, receivables, reminders) and the Graphs page. The Receivable / Cash
 * Position figures themselves are worked out in calc.js (computeStats). */

/* ---------------- Overview ---------------- */
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function allDataYears(){
  const years = new Set();
  ['production','sale','recovery','expense','family','personal','warp','weft','checkpoints'].forEach(key=>{
    (DATA[key]||[]).forEach(r=>{ if(r.date) years.add(Number(r.date.slice(0,4))); });
  });
  const nowYear = new Date().getFullYear();
  years.add(nowYear);
  if(!years.size) return [nowYear];
  return Array.from(years).sort((a,b)=>a-b);
}

// Dismissing a warning banner hides just that banner's current message, not the warning
// type forever — the dismissal is keyed to a snapshot ("signature") of the banner's own
// content, so once the underlying numbers change (another day passes, a new stale client
// shows up, a cheque clears) the signature no longer matches and the banner reappears with
// its new message. Best-effort: if localStorage throws, banners just stay non-dismissable.
const DISMISSED_BANNERS_KEY = 'khata-dismissed-banners';
function getDismissedBanners(){
  try{ return JSON.parse(localStorage.getItem(DISMISSED_BANNERS_KEY) || '{}'); }catch(e){ return {}; }
}
function isBannerDismissed(id, signature){
  return getDismissedBanners()[id] === signature;
}
function dismissBanner(id, signature){
  try{
    const dismissed = getDismissedBanners();
    dismissed[id] = signature;
    localStorage.setItem(DISMISSED_BANNERS_KEY, JSON.stringify(dismissed));
  }catch(e){ /* best effort only */ }
  const el = document.getElementById('banner-'+id);
  if(el) el.remove();
}
// Warns on Overview if a backup hasn't been taken recently — data lives only in this
// device's storage, so this is the one thing that can cause real, unrecoverable loss.
// Silent once a backup was taken within the last 7 days, or once dismissed for today's exact
// message (see dismissBanner above — a new day's message brings it right back).
// Release 3: is this Overview card allowed for the signed-in account? (tags: PERM_OVERVIEW_CARDS in view-only.js;
// the owner and a phone with no limits see every card)
function ovCardOn(id){ return typeof permsCardAllowed === 'function' ? permsCardAllowed(id) : true; }
function backupNagBanner(){
  if(!ovCardOn('backup_reminder')) return ''; // about this phone's own backup: shown on the owner's phone only
  const days = daysSinceLastBackup();
  if(days !== null && days < 7) return '';
  const msg = days === null
    ? "You haven't taken a backup on this device yet. If it's lost, reset, or the app data is cleared, everything goes with it."
    : `Last backup was ${days} day${days===1?'':'s'} ago. Take a fresh one so nothing is at risk.`;
  const signature = 'days:'+days;
  if(isBannerDismissed('backup', signature)) return '';
  return `<div class="card" id="banner-backup" style="background:var(--warn-bg-1)">
    <div class="card-head"><h2>⚠ Backup Reminder</h2><button type="button" class="dismiss-btn" onclick="dismissBanner('backup','${signature}')" aria-label="Dismiss" title="Dismiss">✕</button></div>
    <p class="note" style="margin:0 0 12px">${msg}</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      <button type="button" class="primary" onclick="quickBackup()" style="margin:0">Back up now</button>
      <button type="button" class="ghost" onclick="switchTab('backup')" style="margin:0">Options &amp; password</button>
    </div>
  </div>`;
}
// Adds `days` (may be negative) to a YYYY-MM-DD date string.
function dateAddDays(dateStr, days){
  const d = new Date(dateStr+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}
// Clients still owing money (all-time Receivable > 0) who've had no Sale AND no Payment in
// `thresholdDays` — a simple, no-invoice-aging proxy for "this balance has gone quiet and
// probably needs a follow-up call", rather than true per-invoice due dates.
function overdueClients(thresholdDays){
  const today = todayStr();
  const names = orderedGroupNames(DATA.clients.map(c=>c.name), [DATA.sale,'client']);
  const amtByClient = sumWhereBy(activeSaleRows(), 'client', 'amount', null, null);
  const receivedByClient = sumRecoveryByClient(DATA.recovery, recoveryReceivableAmount, null, null);
  const bouncedByClient = sumRecoveryByClient(DATA.recovery, recoveryBouncedAmount, null, null);
  return names.map(name=>{
    const receivable = (amtByClient[name]||0) - (receivedByClient[name]||0) - (bouncedByClient[name]||0);
    if(receivable <= 0.004) return null;
    const lastSale = DATA.sale.filter(s=>s.client===name).map(s=>s.date).sort().pop();
    const lastRecovery = DATA.recovery.filter(r=>r.client===name).map(r=>r.date).sort().pop();
    const lastActivity = [lastSale, lastRecovery].filter(Boolean).sort().pop();
    if(!lastActivity) return null;
    const daysSince = Math.floor((new Date(today+'T00:00:00Z') - new Date(lastActivity+'T00:00:00Z')) / 86400000);
    if(daysSince < thresholdDays) return null;
    return {name, receivable, daysSince};
  }).filter(Boolean).sort((a,b)=>b.receivable-a.receivable);
}
// Surfaces, on Overview without being asked, the things that otherwise only turn up if you
// happen to go looking on the Recovery or Sale tab: cheques already overdue, cheques due
// within a week, and clients sitting on an outstanding balance with no activity in 30+ days.
// Silent when none of those apply.
function remindersBanner(){
  const today = todayStr();
  const soonCutoff = dateAddDays(today, 7);
  const pendingCheques = [];
  DATA.recovery.forEach(r=> (r.cheques||[]).forEach(c=>{ if(c.status==='Pending' && c.chequeDate) pendingCheques.push(c); }));
  // Release 3: the cheque rows need Recovery; the "quiet clients" row needs Sales and Recovery. A row the account
  // may not see is left out (and not counted in the dismissal signature), and no rows at all means no banner.
  const chequesOn = ovCardOn('reminders_cheques'), clientsOn = ovCardOn('reminders_clients');
  const overdueCheques = chequesOn ? pendingCheques.filter(c=> c.chequeDate < today) : [];
  const dueSoonCheques = chequesOn ? pendingCheques.filter(c=> c.chequeDate >= today && c.chequeDate <= soonCutoff) : [];
  const staleClients = clientsOn ? overdueClients(30) : [];
  if(!overdueCheques.length && !dueSoonCheques.length && !staleClients.length) return '';
  const signature = `${overdueCheques.length}:${dueSoonCheques.length}:${staleClients.length}`;
  if(isBannerDismissed('reminders', signature)) return '';
  const rowStyle = 'display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid var(--line)';
  const rows = [];
  if(overdueCheques.length){
    const total = overdueCheques.reduce((s,c)=>s+(Number(c.amount)||0),0);
    rows.push(`<div style="${rowStyle}"><span>⚠ ${overdueCheques.length} cheque${overdueCheques.length>1?'s':''} overdue</span><b>${fmtRs(total)}</b></div>`);
  }
  if(dueSoonCheques.length){
    const total = dueSoonCheques.reduce((s,c)=>s+(Number(c.amount)||0),0);
    rows.push(`<div style="${rowStyle}"><span>⏰ ${dueSoonCheques.length} cheque${dueSoonCheques.length>1?'s':''} due within 7 days</span><b>${fmtRs(total)}</b></div>`);
  }
  if(staleClients.length){
    const total = staleClients.reduce((s,c)=>s+c.receivable,0);
    rows.push(`<div style="${rowStyle}"><span>👤 ${staleClients.length} client${staleClients.length>1?'s':''} quiet 30+ days with a balance due</span><b>${fmtRs(total)}</b></div>`);
  }
  return `<div class="card" id="banner-reminders" style="background:var(--warn-bg-1)">
    <div class="card-head"><h2>⚠ Reminders</h2><button type="button" class="dismiss-btn" onclick="dismissBanner('reminders','${signature}')" aria-label="Dismiss" title="Dismiss">✕</button></div>
    ${rows.join('')}
    <div class="grid cols-2" style="margin-top:12px">
      ${(overdueCheques.length||dueSoonCheques.length) ? `<button type="button" class="ghost" onclick="switchTab('recovery')">View Cheques</button>` : ''}
      ${staleClients.length ? `<button type="button" class="ghost" onclick="switchTab('sale')">View Clients</button>` : ''}
    </div>
  </div>`;
}
/* ---------------- Beam alerts: which beams are about to end ---------------- */
// The forecast itself is computeBeamForecasts() in calc.js. This is what the page does with it:
// an Overview card, a card and an "Est. Finish" column on the Warp Beam page, and a toast (on
// opening the app, and right after a Production entry) so a beam running out isn't a surprise.
const BEAM_ALERT_DAYS_KEY = 'khata-beam-alert-days';   // '0' = alerts off; otherwise alert when a beam has this many days left or fewer
const BEAM_ALERT_SEEN_KEY = 'khata-beam-alerts-seen';  // {beamId: 'YYYY-MM-DD:state'} — each beam is announced once a day per level
function beamAlertDays(){
  try{
    const raw = localStorage.getItem(BEAM_ALERT_DAYS_KEY);
    if(raw === null) return 3;
    const n = Number(raw);
    return [0,2,3,5,7].includes(n) ? n : 3;
  }catch(e){ return 3; }
}
function setBeamAlertDays(n){ try{ localStorage.setItem(BEAM_ALERT_DAYS_KEY, String(n)); }catch(e){ /* best effort */ } }
function beamAlertsSeen(){
  try{ return JSON.parse(localStorage.getItem(BEAM_ALERT_SEEN_KEY) || '{}') || {}; }catch(e){ return {}; }
}
// Text for the beams that are ending / fully woven and haven't been announced yet today at that level
// (marks them announced). onlyLoom limits it to one loom (used right after a Production entry).
function takeBeamAlert(onlyLoom){
  const days = beamAlertDays();
  if(!days) return '';
  const seen = beamAlertsSeen(), today = todayStr();
  const fresh = computeBeamForecasts(days).filter(f =>
    (f.state === 'ending' || f.state === 'full') &&
    (onlyLoom == null || (Array.isArray(onlyLoom) ? onlyLoom.map(String).includes(String(f.loom)) : String(f.loom) === String(onlyLoom))) &&
    seen[f.id] !== `${today}:${f.state}`);
  if(!fresh.length) return '';
  fresh.forEach(f => { seen[f.id] = `${today}:${f.state}`; });
  Object.keys(seen).forEach(k => { if(!String(seen[k]).startsWith(today)) delete seen[k]; });
  try{ localStorage.setItem(BEAM_ALERT_SEEN_KEY, JSON.stringify(seen)); }catch(e){ /* best effort */ }
  return beamAlertSummary(fresh);
}
function beamAlertToast(text){
  if(!text) return;
  haptic([30, 40, 30]);
  showActionToast(text, 'View', ()=> switchTab('warpbeams'), 9000);
}
// Called when the app opens, after unlocking, and when coming back to it.
function runBeamAlerts(){
  try{
    if(document.getElementById('pinLockOverlay')) return;                 // still locked — the unlock calls this again
    if(typeof encEnabled === 'function' && encEnabled() && !ENC_DEK) return; // ledger not decrypted yet
    beamAlertToast(takeBeamAlert());
  }catch(e){ /* an alert must never get in the way of the app */ }
}
function beamForecastRightCell(f){
  if(f.state === 'full') return {label:'Fully woven', sub:'chain the next beam', color:'var(--red)'};
  if(f.state === 'idle') return {label:'No recent weaving', sub: f.lastDay ? 'last output ' + fmtDate(f.lastDay) : '', color:'var(--ink-soft)'};
  if(f.state === 'nodata') return {label:'No output logged yet', sub:'', color:'var(--ink-soft)'};
  const when = beamWhenText(f).replace('in about ', '~');
  return {label: when, sub: fmtDate(f.finishDate), color: f.state === 'ending' ? 'var(--red)' : 'inherit'};
}
function beamForecastRows(list){
  const rowStyle = 'display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px';
  return list.map(f=>{
    const r = beamForecastRightCell(f);
    const detail = f.state === 'full'
      ? `${fmtNum(Math.round(f.woven))} of ${fmtNum(f.length)} m woven`
      : [`~${fmtNum(Math.round(f.expectedRemaining))} m left`, f.rate ? `${fmtNum(Math.round(f.rate))} m/day` : ''].filter(Boolean).join(' · ');
    return `<div style="${rowStyle}">
      <span><b>Loom ${escHtml(f.loom)}</b>${f.warpType ? ' · ' + escHtml(f.warpType) : ''}<br><span style="color:var(--ink-soft);font-size:12px">${detail}</span></span>
      <span style="text-align:right;color:${r.color}"><b>${r.label}</b>${r.sub ? `<br><span style="font-size:12px">${r.sub}</span>` : ''}</span>
    </div>`;
  }).join('');
}
function beamForecastBasisNote(f){
  const yieldPart = f && f.yieldBasis >= 2
    ? `beams ending at about ${Math.round(f.yieldRatio * 100)}% of their logged length (median of your last ${f.yieldBasis} finished beams)`
    : 'each beam being woven to its full logged length (until two beams have finished)';
  return `Estimate from each loom's output over its last ${BEAM_RATE_WINDOW_DAYS} days, with ${yieldPart}. Treat it as a guide — it moves as output changes.`;
}
// Overview: only shows when a beam is ending / fully woven / due within a week; silent otherwise.
// Dismissible like the other Overview warning banners — the signature is the exact set of
// beams and states being shown, so dismissing it lasts until that changes (a beam moves to a
// more urgent state, a new one joins the list, etc.), not just until tomorrow.
// Overview: estimated weft stock (calc.js weftStockEstimate) with a Count bags button that resets the estimate.
function weftStockCard(){
  if(!ovCardOn('weft_stock')) return '';
  const e = weftStockEstimate(); if(!e.hasData) return '';
  const r1 = n => (Math.round(n * 10) / 10).toLocaleString('en-IN'), canEdit = typeof permsCan !== 'function' || permsCan('tools', 'e');
  const when = e.counted ? 'Counted ' + String(e.counted.at).slice(0, 10) + ' at ' + r1(weftLbsToBags(e.counted.lbs)) + ' bags, then adjusted.' : 'No physical count yet, so this starts from your first purchase.';
  return `<div class="card" id="weftStockCard"${e.low ? ' style="background:var(--warn-bg-1)"' : ''}>
    <div class="card-head"><h2>🧵 Weft stock</h2></div>
    <div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:22px">${r1(Math.max(e.bags, 0))} bags</b><span class="note" style="margin:0">${r1(Math.max(e.lbs, 0))} lbs</span></div>
    <p class="note" style="margin:6px 0 0">${e.cover === null ? 'No recent production to measure the pace.' : 'About ' + r1(e.cover) + ' days left at ' + r1(e.perDay) + ' lbs per production day (last 7 days).'} Estimated from production. ${when}</p>
    ${canEdit ? `<div class="grid cols-2" style="margin-top:10px;align-items:end"><div class="field" style="margin:0"><label for="wf_count_bags">Bags on hand now</label><input id="wf_count_bags" type="number" inputmode="decimal" step="any" min="0"></div>
      <button type="button" class="primary" style="margin:0" onclick="weftCountSave()">Count bags</button></div>
      <div class="field" style="margin:10px 0 0"><label for="wf_alert_days">Alert when days left is</label><select id="wf_alert_days" onchange="weftAlertSave(this.value)">${[2, 3, 5, 7].map(n => `<option value="${n}"${n === e.limit ? ' selected' : ''}>${n} or fewer</option>`).join('')}</select></div>` : ''}
  </div>`;
}
async function weftCountSave(){
  const el = document.getElementById('wf_count_bags'), bags = parseFloat(el && el.value);
  if(!(bags >= 0)){ showToast('Enter the number of bags on hand'); return; }
  DATA.costSettings = Object.assign({}, DATA.costSettings || {}, {weftStockCount: {at: todayStr() + ' ' + nowStr(), lbs: Math.round(weftBagsToLbs(bags) * 100) / 100}});
  await save(); showToast('Weft stock set to ' + bags + ' bags'); SETTINGS_OPEN = 'stock'; switchTab('settings');
}
async function weftAlertSave(v){
  DATA.costSettings = Object.assign({}, DATA.costSettings || {}, {weftAlertDays: Number(v)});
  await save(); SETTINGS_OPEN = 'stock'; switchTab('settings');
}
function beamsEndingCard(){
  if(!ovCardOn('beams_ending')) return '';
  const list = computeBeamForecasts(beamAlertDays() || 3).filter(f => f.state === 'full' || f.state === 'ending' || f.state === 'soon');
  if(!list.length) return '';
  const signature = list.map(f=>`${f.id}:${f.state}`).sort().join(',');
  if(isBannerDismissed('beams', signature)) return '';
  return `<div class="card" id="banner-beams" style="background:var(--warn-bg-1)">
    <div class="card-head"><h2>⏳ Beams ending soon</h2><button type="button" class="dismiss-btn" onclick="dismissBanner('beams','${signature}')" aria-label="Dismiss" title="Dismiss">✕</button></div>
    ${beamForecastRows(list)}
    <p class="note" style="margin:8px 0 0">${beamForecastBasisNote(list[0])}</p>
    <button type="button" class="ghost" style="margin-top:10px" onclick="switchTab('warpbeams')">View Beams</button>
  </div>`;
}
// Warp Beam page: every beam currently on a loom, most urgent first.
function beamForecastCard(){
  const list = computeBeamForecasts(beamAlertDays() || 3);
  if(!list.length) return '';
  return `<div class="card">
    <div class="card-head"><h2>Beam Forecast</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>${beamForecastBasisNote(list[0])} A loom with no output in the last ${BEAM_RATE_STALE_DAYS} days shows "No recent weaving" instead of a guess. Alerts (a message when a beam is about to end) can be changed under Settings → Beam Alerts.</p>
    ${beamForecastRows(list)}
  </div>`;
}
// "Est. Finish" cell for the Active Beams log.
function estFinishCell(f){
  if(!f) return '—';
  const r = beamForecastRightCell(f);
  return `<span style="color:${r.color}"><b>${r.label}</b>${r.sub ? `<br><span style="font-size:11px">${r.sub}</span>` : ''}</span>`;
}
// Settings → Beam Alerts
function beamAlertSettingsCard(){
  const cur = beamAlertDays();
  const opt = (n, label) => `<option value="${n}"${cur === n ? ' selected' : ''}>${label}</option>`;
  return `<div class="card">
    <div class="card-head"><h2>Beam Alerts</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>Shows a message when you open the app, and right after a Production entry, if a loom's beam is about to end (based on the forecast on the Warp Beam page). Each beam is announced once a day. The Beams ending soon card on Overview and the forecast on the Warp Beam page stay visible either way.</p>
    <div class="field" style="max-width:360px"><label>Alert me when a beam has</label>
      <select id="beamAlertDays">${opt(0, 'Never alert me')}${opt(2, '2 days or less left')}${opt(3, '3 days or less left (recommended)')}${opt(5, '5 days or less left')}${opt(7, '7 days or less left')}</select>
    </div>
  </div>`;
}
function wireBeamAlertSettings(){
  const sel = document.getElementById('beamAlertDays');
  if(!sel) return;
  sel.addEventListener('change', ()=>{
    setBeamAlertDays(Number(sel.value));
    try{ localStorage.removeItem(BEAM_ALERT_SEEN_KEY); }catch(e){ /* best effort */ }  // so the new setting can speak up again today
    showToast(Number(sel.value) ? `Beam alerts: ${sel.value} days or less left` : 'Beam alerts are off', 3000);
  });
}

function overviewPanel(){
  const years = allDataYears();
  const monthOpts = MONTH_NAMES.map((m,i)=>`<option value="${String(i+1).padStart(2,'0')}">${m}</option>`).join('');
  const yearOpts = years.map(y=>`<option value="${y}">${y}</option>`).join('');
  return `<div class="ov-page">
    <div class="ov-sticky"><span>Period</span><select id="ov_sticky_sel" aria-label="Period"><option value="">All Time</option><option value="this-month">This Month</option><option value="last-month">Last Month</option><option value="this-year">This Year</option><option value="custom">Custom…</option></select></div>
    ${(typeof permsCan === 'function' && !permsCan('sales','a') && !permsCan('recovery','a')) ? '' : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <button type="button" class="primary" data-quick-add="sale" style="margin:0">+ Add Sale</button>
      <button type="button" class="ghost" data-quick-add="recovery" style="margin:0">+ Add Recovery</button>
    </div>`}
    ${remindersBanner()}
    ${beamsEndingCard()}
    ${backupNagBanner()}
    <div class="card ov-period-card">
      <div class="card-head"><h2>Period</h2><span id="monthBadge"></span></div>
      <div class="chip-row" id="ov_chips">
        <button type="button" class="chip" data-period="">All Time</button>
        <button type="button" class="chip" data-period="this-month">This Month</button>
        <button type="button" class="chip" data-period="last-month">Last Month</button>
        <button type="button" class="chip" data-period="this-year">This Year</button>
        <button type="button" class="chip" data-period="custom">Custom…</button>
      </div>
      <div id="ov_custom" hidden style="margin-top:14px">
        <div class="grid cols-2">
          <div class="field"><label>Month</label>
            <select id="ov_month_sel"><option value="">— Any month —</option>${monthOpts}</select>
          </div>
          <div class="field"><label>Year</label>
            <select id="ov_year_sel"><option value="">— Any year —</option>${yearOpts}</select>
          </div>
        </div>
        <div class="grid cols-2" style="margin-top:12px">
          <div class="field"><label>Or range — From</label>
            <input type="date" id="ov_from_sel">
          </div>
          <div class="field"><label>To</label>
            <input type="date" id="ov_to_sel">
          </div>
        </div>
        <p class="note" style="margin-top:8px">A From/To range overrides Month/Year above.</p>
      </div>
    </div>
    <div id="statsWrap"></div>
    </div>
  `;
}

function inRange(dateStr, start, end){
  if(!dateStr) return false;
  const d = new Date(dateStr+'T00:00:00Z');
  if(start && d < start) return false;
  if(end && d > end) return false;
  return true;
}
// Short, composite description of a payment's makeup for the Recovery Log — e.g.
// "Cash Rs 100,000 + 2 cheques (1 cleared, 1 pending)" for a genuinely mixed payment.
function recoveryMethodLabel(r){
  const {cashAmount, bankAmount, cheques} = recoveryParts(r);
  const parts = [];
  if(cashAmount > 0) parts.push(`Cash ${fmtRs(cashAmount)}`);
  if(bankAmount > 0) parts.push(`Bank Transfer ${fmtRs(bankAmount)}`);
  if(cheques.length){
    const cleared = cheques.filter(c=>c.status==='Cleared').length;
    const pending = cheques.filter(c=>c.status==='Pending').length;
    const bounced = cheques.filter(c=>c.status==='Bounced').length;
    const replaced = cheques.filter(c=>c.status==='Replaced').length;
    const bits = [];
    if(cleared) bits.push(`${cleared} cleared`);
    if(pending) bits.push(`${pending} pending`);
    if(bounced) bits.push(`${bounced} bounced`);
    if(replaced) bits.push(`${replaced} replaced`);
    parts.push(`${cheques.length} cheque${cheques.length===1?'':'s'} (${bits.join(', ')||'none'})`);
  }
  return parts.length ? parts.join(' + ') : 'Cash';
}

function periodLabel(monthVal){
  if(!monthVal) return 'Viewing overall (all time)';
  if(monthVal.startsWith('range:')){
    const [, from, to] = monthVal.split(':');
    if(from && to) return `Viewing ${fmtDate(from)} to ${fmtDate(to)}`;
    if(from) return `Viewing from ${fmtDate(from)} onwards`;
    return `Viewing up to ${fmtDate(to)}`;
  }
  if(monthVal.length === 4) return `Viewing year ${monthVal}`;
  const [y,m] = monthVal.split('-').map(Number);
  return `Viewing ${MONTH_NAMES[m-1]} ${y}`;
}

// Client Statement card — lives on Overview (it used to sit on the Sales page), tucked away
// collapsed until tapped. It is rendered inside renderStats(), which rebuilds this DOM on every
// period change, so renderStats snapshots/restores the three fields and the Download / Share
// buttons are handled by delegated listeners (see lock-init.js) rather than per-render wiring.
function clientStatementCardHtml(){
  const infoBtn = '<button type="button" class="info-btn" data-info-toggle data-info-target="info-clientstatement" title="Info">i</button>';
  return `${sumCardOpen('clientstatement','Client Statement', infoBtn)}
    <p class="note info-note" id="info-clientstatement" hidden>A printable/shareable running ledger for one client — every Sale and Payment in the range, in date order, with a running balance. Leave From/To blank for the client's full history; leaving only From set includes an Opening Balance line for everything before it.</p>
    <div class="grid cols-3">
      ${clientSelectField('Client','stmt_client')}
      ${field('From (optional)','stmt_from','date')}
      ${field('To (optional)','stmt_to','date',`value="${todayStr()}"`)}
    </div>
    <div id="stmtStatus" class="note" style="min-height:16px;margin:6px 0 12px"></div>
    <div class="grid cols-2">
      <button class="primary" id="downloadStatementBtn" type="button" style="margin-top:0">Download PDF</button>
      <button class="primary" id="shareStatementBtn" type="button" style="margin-top:0"><span style="display:inline-flex;width:1em;height:1em;vertical-align:-2px;margin-right:4px">${ICON_SHARE}</span> Share Statement</button>
    </div>
  ${sumCardClose()}`;
}
function renderStats(monthVal){
  LAST_STATS_MONTHVAL = monthVal;
  const s = computeStats(monthVal);
  const aging = computeReceivablesAging();
  const badge = document.getElementById('monthBadge');
  badge.innerHTML = `<span class="badge month">${periodLabel(monthVal)}</span>`;

  const wrap = document.getElementById('statsWrap');
  const card = (label, value, extra='', cls='') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value ${value<0?'neg':''}">${extra||value}</div></div>`;
  // Colour with meaning: a negative Receivable is an advance (amber, "Advance Rs X"), not a problem; positive cash is green.
  const recvCard = () => s.receivable < -0.0001
    ? `<div class="stat balance compact"><div class="label">Advance (received ahead)</div><div class="value adv">${fmtRs(-s.receivable)}</div></div>`
    : card('Receivable (Outstanding)', s.receivable, fmtRs(s.receivable), 'balance compact');
  const cashCard = () => `<div class="stat balance compact"><div class="label">Cash Position</div><div class="value ${s.cash<0?'neg':(s.cash>0?'pos':'')}">${fmtRs2(s.cash)}</div></div>`;

  // The statement form sits inside this re-rendered area: keep whatever was picked/typed.
  const keepStmt = {};
  ['stmt_client','stmt_from','stmt_to'].forEach(id=>{ const el = document.getElementById(id); if(el) keepStmt[id] = el.value; });

  wrap.innerHTML = `
    ${(()=>{ // "At a glance": the four numbers an owner checks first (each shown only if the role may see it)
      // Trend under Sales, Cash and Profit: this period vs the one before it (no trend for custom ranges).
      const trends = (()=>{
        if(monthVal && monthVal.startsWith('range:')) return {};
        const now = new Date(), pad = n=>String(n).padStart(2,'0');
        const ym = (y,m)=>{ const d = new Date(y, m, 1); return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; };
        let cur, prevKey, lbl;
        if(!monthVal){ cur = computeStats(ym(now.getFullYear(), now.getMonth())); prevKey = ym(now.getFullYear(), now.getMonth()-1); lbl = 'this month vs last month'; }
        else if(monthVal.length === 4){ cur = s; prevKey = String(Number(monthVal)-1); lbl = 'vs last year'; }
        else { const [y,m] = monthVal.split('-').map(Number); cur = s; prevKey = ym(y, m-2); lbl = 'vs last month'; }
        const p = computeStats(prevKey);
        const t = (a,b)=>{
          if(!b) return '';
          const pct = Math.round((a-b)/Math.abs(b)*100);
          if(!pct) return `<div class="ov-trend">▬ no change ${lbl}</div>`;
          return `<div class="ov-trend ${pct>0?'up':'down'}">${pct>0?'▲':'▼'} ${Math.abs(pct)}% ${lbl}</div>`;
        };
        return { 'k-sales': t(cur.salesAmtMonth, p.salesAmtMonth), 'k-profit': t(cur.profitMonth, p.profitMonth), 'k-cash': t(!monthVal ? s.cash : cur.cash, p.cash) };
      })();
      const fmtShort = typeof fmtRsShort === 'function' ? fmtRsShort : fmtRs;
      const kv = v => `data-s="${fmtShort(v)}" data-f="${fmtRs(v)}" title="Tap for full figure" onclick="var t=this.textContent;this.textContent=t===this.dataset.f?this.dataset.s:this.dataset.f" style="cursor:pointer"`;
      const k = (cls, label, val) => cls==='k-recv' && val<0
        ? `<div class="ov-kpi ${cls}"><div class="label">Advance (received ahead)</div><div class="value adv" ${kv(-val)}>${fmtShort(-val)}</div></div>`
        : `<div class="ov-kpi ${cls}"><div class="label">${label}</div><div class="value ${val<0?'neg':((cls==='k-profit'||cls==='k-cash')&&val>0?'pos':'')}" ${kv(val)}>${fmtShort(val)}</div>${trends[cls]||''}</div>`;
      const tiles = [
        ovCardOn('cash_position') ? k('k-cash','Cash Position', s.cash) : '',
        ovCardOn('sales_receivables') ? k('k-recv','Receivable (Outstanding)', s.receivable) : '',
        ovCardOn('sales_receivables') ? k('k-sales','Sales', monthVal ? s.salesAmtMonth : s.salesAmtCum) : '',
        ovCardOn('profit_loss') ? k('k-profit', monthVal ? 'Profit / Loss (Period)' : 'Profit / Loss', monthVal ? s.profitMonth : s.profitCum) : '',
      ].filter(Boolean);
      // In Stock by quality: only qualities that actually have stock left (zero or less is left out)
      const sv = (ovCardOn('stock') || ovCardOn('stock_glance')) ? stockViewFor() : null;
      const inStock = sv ? sv.rows.filter(r => Number(r.stock) > 0.0001) : [];
      const stockHtml = inStock.length ? `<div class="ov-stock"><div class="ov-stock-title">In Stock by Quality (mtr)</div><div class="ov-kpis ov-kpis-q">${inStock.map(r => `<div class="ov-kpi k-stock"><div class="label">${escHtml(r.name)}</div><div class="value">${fmtQtyMtr(r.stock)}</div></div>`).join('')}</div></div>` : '';
      if(!tiles.length && !stockHtml) return '';
      return `<div class="card ov-glance"><h2>At a Glance</h2>${tiles.length ? `<div class="ov-kpis">${tiles.join('')}</div>` : ''}${stockHtml}<div class="ov-sub">${periodLabel(monthVal)}</div></div>`;
    })()}
    ${ovCardOn('orders_progress') ? ordersOverviewCard() : ''}
    ${ovCardOn('pending_l') ? pendingLCardHtml() : ''}
    ${ovCardOn('pending_cheques') ? pendingChequesCardHtml() : ''}
    ${ovCardOn('bounced_cheques') ? bouncedChequesCardHtml() : ''}
    ${ovCardOn('stock') ? `<div class="card"><h2>Stock Position</h2>
      <div class="group-label" style="margin-top:0">Stock by Quality</div>
      <div class="table-lg log-scroll">${table(
        ['Quality','Produced (mtr)','Sold (mtr)','In Stock (mtr)'],
        s.stockByQuality.map(r=>[`<span class="name">${escHtml(r.name)}</span>`, fmtQtyMtr(r.produced), fmtQtyMtr(r.sold), `<b>${fmtQtyMtr(r.stock)}</b>`])
      )}</div>
      <div class="group-label">Overall</div>
      <div class="grid cols-4">
        ${card('Produced (mtr)', s.producedCum, fmtQtyMtr(monthVal?s.producedMonth:s.producedCum), 'compact')}
        ${card('Sold (mtr)', s.soldCum, fmtQtyMtr(monthVal?s.soldMonth:s.soldCum), 'compact')}
        ${card('In Stock (mtr)', s.stock, fmtQtyMtr(s.stock), 'balance compact')}
        ${ovCardOn('cash_position') ? cashCard() : ''}
      </div>
      <div class="legend">${monthVal ? `Produced/Sold shown for the selected period. In Stock${ovCardOn('cash_position') ? ' and Cash Position are' : ' is'} cumulative as of the end of that period.` : 'All figures shown are all-time totals.'}</div>
    </div>` : ''}
    ${ovCardOn('client_statement') ? clientStatementCardHtml() : ''}
    ${ovCardOn('sales_receivables') ? `<div class="card"><h2>Sales & Receivables</h2>
      <div class="group-label" style="margin-top:0;display:flex;align-items:center;justify-content:space-between;gap:10px">Breakdown by Client<button type="button" class="info-btn" data-info-toggle data-info-target="info-beforeLastSale" title="Info">i</button></div>
      <p class="note info-note" id="info-beforeLastSale" hidden>Before Last Sale is what a client owed right before their most recent sale was entered — handy for reconciling with them if a cheque bounces after being provisionally counted (it updates once the cheque is actually marked Bounced).</p>
      <button class="ghost" data-toggle="beforeLastSale" style="margin-bottom:10px">${SHOW_BEFORE_LAST_SALE ? 'Hide' : 'Show'} Before Last Sale</button>
      ${(()=>{
        // The Bounced column only earns a place in this table when it has something to show —
        // no client currently has a bounced cheque, no column, same as the Bounced Cheques
        // card above hiding itself entirely when the list is empty.
        const anyBounced = s.receivablesByClient.some(r=> Math.abs(r.bounced) > 0.004);
        const cols = ['Client','Sales','Received'];
        if(anyBounced) cols.push('Bounced');
        cols.push('Receivable');
        // Total = Receivable + Bounced, but only meaningful (and only shown) for clients who
        // actually have a bounced cheque — same gating as the Bounced column itself, and each
        // row only fills this in when that specific client has a bounced amount.
        if(anyBounced) cols.push('Total (Receivable + Bounced)');
        if(SHOW_BEFORE_LAST_SALE) cols.push('Before Last Sale');
        return `<div class="table-lg log-scroll">${table(
          cols,
          s.receivablesByClient.map(r=>{
            const row = [`<span class="name">${escHtml(r.name)}</span>`, fmtRs(r.sales), fmtRs(r.received)];
            if(anyBounced){
              row.push(r.bounced > 0.004 ? `<span style="color:var(--red)">${fmtRs(r.bounced)}</span>` : '—');
            }
            row.push(`<b>${fmtRs(r.receivable)}</b>`);
            if(anyBounced){
              row.push(r.bounced > 0.004 ? `<b>${fmtRs(r.receivable + r.bounced)}</b>` : '—');
            }
            if(SHOW_BEFORE_LAST_SALE){
              row.push(r.beforeLastSale ? (r.beforeLastSale.amount < 0 ? `${fmtRs(r.beforeLastSale.amount)} (advance)` : fmtRs(r.beforeLastSale.amount)) : '—');
            }
            return row;
          })
        )}</div>`;
      })()}
      <div class="group-label">Overall</div>
      <div class="grid cols-3">
        ${card('Sales Amount', s.salesAmtCum, fmtRs(monthVal?s.salesAmtMonth:s.salesAmtCum), 'compact')}
        ${card('Amount Received', s.receivedCum, fmtRs(monthVal?s.receivedMonth:s.receivedCum), 'compact')}
        ${recvCard()}
      </div>
    </div>` : ''}
    ${ovCardOn('warp_usage') ? `<div class="card" data-fold="warp_usage"><div class="card-head"><h2>Warp Usage (Last 2 Months)</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Warp purchases from the last 2 months — same cutoff used when logging a new beam. Woven comes straight from Production entries. For older purchases and the full per-beam breakdown, see the Warp (Tana) Beam tab.</p>
      ${(()=>{
        // Same "last 2 months" cutoff as warpPurchaseSelectField, so this card and the beam-log
        // form always agree on what counts as "recent" — except a purchase already linked to
        // some beam stays visible here too, matching that function's own exception, so a beam
        // still in progress never quietly drops off just because its purchase aged past 2 months.
        const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-2);
        const purchaseYield = computePurchaseYield()
          .filter(r=> new Date(r.purchase.date) >= cutoff || !r.complete);
        if(!purchaseYield.length) return `<div class="empty">No warp beams linked to a purchase in the last 2 months.</div>`;
        return `<div class="log-scroll">${table(
          ['Source Purchase','Warp Type','Length','Woven','Remaining','Yield %','Status'],
          purchaseYield.map(r=>[
            escHtml(purchaseText(r.purchase)), escHtml(r.purchase.type||'—'), fmtQtyMtr(r.totalLength), fmtQtyMtr(r.totalWoven),
            fmtQtyMtr(r.totalLength-r.totalWoven), r.yieldPct!=null?r.yieldPct.toFixed(1)+'%':'—',
            r.complete ? 'Complete' : '<b>In Progress</b>'
          ])
        )}</div>`;
      })()}
      <button type="button" class="ghost" style="margin-top:12px" onclick="switchTab('warpbeams')">View All Purchases</button>
    </div>` : ''}
    ${ovCardOn('receivables_aging') ? `<div class="card" data-fold="receivables_aging"><div class="card-head"><h2>Receivables Aging</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Always as of today, regardless of the period selected above — payments are applied against each client's oldest unpaid sale first, so this shows how old the outstanding money actually is, not just how much.</p>
      ${aging.rows.length ? `
      <div class="grid cols-4">
        ${card('0–30 Days', aging.totals.d0_30, fmtRs(aging.totals.d0_30))}
        ${card('31–60 Days', aging.totals.d31_60, fmtRs(aging.totals.d31_60))}
        ${card('61–90 Days', aging.totals.d61_90, fmtRs(aging.totals.d61_90))}
        ${`<div class="stat ${aging.totals.d90plus>0?'balance':''}"><div class="label">90+ Days (overdue)</div><div class="value ${aging.totals.d90plus>0?'neg':''}">${fmtRs(aging.totals.d90plus)}</div></div>`}
      </div>
      <div class="group-label">By Client (oldest first)</div>
      <div class="log-scroll">${table(
        ['Client','Receivable','Oldest Unpaid Since','Days Outstanding'],
        aging.rows.map(r=>{
          const dayColor = r.daysOutstanding > 90 ? 'var(--red)' : r.daysOutstanding > 60 ? 'var(--rust)' : r.daysOutstanding > 30 ? 'var(--gold)' : 'var(--ink)';
          return [`<span class="name">${escHtml(r.name)}</span>`, fmtRs(r.totalReceivable), fmtDate(r.oldestDate), `<b style="color:${dayColor}">${r.daysOutstanding}</b>`];
        })
      )}</div>
      ` : `<div class="empty">Nothing outstanding right now.</div>`}
    </div>` : ''}
    ${ovCardOn('client_quality') ? `<div class="card" data-fold="client_quality"><div class="card-head"><h2>Clients Breakdown by Quality</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Quantity (mtr) sold to each client, split by quality.</p>
      <div class="log-scroll">${(()=>{
        if(!s.clientQualityBreakdown.length) return `<div class="empty">No sales yet</div>`;
        const qHead = s.qualityNames.map(q=>`<th>${escHtml(q)}</th>`).join('');
        const rows = s.clientQualityBreakdown.map(r=>`<tr><td><span class="name">${escHtml(r.name)}</span></td>${r.byQuality.map(x=>`<td>${x.qty?fmtQtyMtr(x.qty):'—'}</td>`).join('')}<td class="mono"><b>${fmtQtyMtr(r.total)}</b></td></tr>`).join('');
        const totalsByQ = s.qualityNames.map((q,i)=> s.clientQualityBreakdown.reduce((sum,r)=>sum+r.byQuality[i].qty,0));
        const grandTotal = totalsByQ.reduce((a,b)=>a+b,0);
        return `<table><thead><tr><th>Client</th>${qHead}<th>Total</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td><b>Total</b></td>${totalsByQ.map(t=>`<td><b>${fmtQtyMtr(t)}</b></td>`).join('')}<td><b>${fmtQtyMtr(grandTotal)}</b></td></tr></tfoot>
        </table>`;
      })()}</div>
    </div>` : ''}
    ${ovCardOn('owner_loans') && (ownerLoanList().length) ? `<div class="card"><div class="card-head"><h2>Owner Loans (Owed to You)</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Your own money put into the business, and what is still owed back to you. Cash Position already includes it (it is cash in hand), so "Cash after repaying you" takes it back out: Cash Position minus what you are still owed. It is not income or an expense, so Profit / Loss does not change. Log entries in the Owner Loans tab.</p>
      <div class="grid cols-2">
        ${card(s.ownerLoanOwed < -0.004 ? 'You Owe the Company' : 'Owed to You', s.ownerLoanOwed, fmtRs(Math.abs(s.ownerLoanOwed)), 'balance compact')}
        ${card('Cash after repaying you', s.cash - Math.max(0, s.ownerLoanOwed), fmtRs(s.cash - Math.max(0, s.ownerLoanOwed)), 'balance compact')}
      </div>
      <div class="grid cols-2" style="margin-top:14px">
        ${card('Money In', s.ownerLoanInCum, fmtRs(monthVal?s.ownerLoanInMonth:s.ownerLoanInCum), 'compact')}
        ${card('Money Out', s.ownerLoanRepaidCum, fmtRs(monthVal?s.ownerLoanRepaidMonth:s.ownerLoanRepaidCum), 'compact')}
      </div>
      <div class="legend">${monthVal ? 'Money In / Money Out shown for the selected period; Owed to You and Cash are cumulative as of the end of that period.' : 'All figures shown are all-time totals.'}</div>
    </div>` : ''}
    ${ovCardOn('expenses_material') ? `<div class="card" data-fold="expenses_material"><h2>Expenses & Material Cost</h2>
      <div class="grid cols-4">
        ${card('Business Expenses', s.bizExpCum, `${fmtRs(monthVal?s.bizExpMonth:s.bizExpCum)} (incl. ${fmtRs(monthVal?s.wagesPaidMonth:s.wagesPaidCum)} wages)`)}
        ${card('Family Expenses', s.famExpCum, fmtRs(monthVal?s.famExpMonth:s.famExpCum))}
        ${card('Personal Expenses', s.personalExpCum, fmtRs(monthVal?s.personalExpMonth:s.personalExpCum))}
        ${card('Warp (Tana) Cost', s.warpCostCum, `${fmtRs(monthVal?s.warpCostMonth:s.warpCostCum)} (${fmtNum(monthVal?s.warpSetsMonth:s.warpSetsCum)} sets)`)}
        ${card('Weft (Bana) Cost', s.weftCostCum, `${fmtRs(monthVal?s.weftCostMonth:s.weftCostCum)} (${fmtNum(monthVal?s.weftBagsMonth:s.weftBagsCum)} bags)`)}
      </div>
      <div class="legend">"Wages" here is the total of Wage Payments logged (from 29 Aug onwards).</div>
      ${((monthVal?s.loanGivenMonth:s.loanGivenCum) || (monthVal?s.loanRepaidMonth:s.loanRepaidCum)) ? `<div class="grid cols-4" style="margin-top:14px">
        ${card('Loans Given (Employees)', s.loanGivenCum, fmtRs(monthVal?s.loanGivenMonth:s.loanGivenCum))}
        ${card('Loan Repayments Received', s.loanRepaidCum, fmtRs(monthVal?s.loanRepaidMonth:s.loanRepaidCum))}
      </div>
      <div class="legend">Cash given to / received back from employees as loans — affects Cash Position but kept separate from Business Expenses and Profit/Loss. See the Loans tab for balances per employee.</div>` : ''}
      ${((monthVal?s.personalLoanGivenMonth:s.personalLoanGivenCum) || (monthVal?s.personalLoanRepaidMonth:s.personalLoanRepaidCum)) ? `<div class="grid cols-4" style="margin-top:14px">
        ${card('Personal Loans Given', s.personalLoanGivenCum, fmtRs(monthVal?s.personalLoanGivenMonth:s.personalLoanGivenCum))}
        ${card('Personal Loan Repayments', s.personalLoanRepaidCum, fmtRs(monthVal?s.personalLoanRepaidMonth:s.personalLoanRepaidCum))}
      </div>
      <div class="legend">Cash given to / received back from family or friends as loans — affects Cash Position but kept separate from Business Expenses and Profit/Loss. See the Personal Loans (Given) tab for balances per person.</div>` : ''}
    </div>` : ''}
    ${ovCardOn('profit_loss') ? `<div class="card"><h2>Profit / Loss</h2>
      <div class="grid cols-2">
        ${card('Cumulative (all time to period end)', s.profitCum, fmtRs(s.profitCum))}
        ${card('Selected Period Only', s.profitMonth, monthVal?fmtRs(s.profitMonth):'—')}
      </div>
      <div class="legend">Sales − Business Expenses (incl. Wages Paid) − Family Expenses − Personal Expenses − Warp (Tana) Cost − Weft (Bana) Cost.</div>
    </div>` : ''}
    ${!ovCardOn('cash_position') ? '' : s.checkpoint ? `<div class="note">Cash Position uses checkpoint from ${fmtDate(s.checkpoint.date)}${s.checkpoint.time?' '+s.checkpoint.time:''} (${fmtRs(s.checkpoint.balance)}) plus everything logged since — on the checkpoint's own date, only entries with a later time count.</div>`
      : `<div class="note">No checkpoint found on or before this date — Cash Position uses Opening Balance instead. Add checkpoints in the Cash Checkpoints tab for more accuracy.</div>`}
  `;
  // Freshly rendered selects need the custom dropdown wrapper (switchTab only enhances once,
  // on first render), then put back the statement choices.
  enhanceSelects(wrap);
  Object.keys(keepStmt).forEach(id=>{ const el = document.getElementById(id); if(el && keepStmt[id] !== '') el.value = keepStmt[id]; });
  // Awaiting L (AIL) card now lives here (moved from Sale) — its inputs/buttons are wired
  // per-element (not delegated like the cheque status buttons), so re-wire on every rebuild
  // of this wrap, same as switchTab('sale') used to do for it.
  wireLConfirm();
  wireFoldCards(wrap);
}

// Warp Usage, Receivables Aging, Clients Breakdown and Expenses fold down; the choice is remembered.
/* Orders card (v3.18.28): every open order with how much is delivered, how fast, and which ones need a look. */
function ordersOverviewCard(){
  const all = DATA.orders || [], today = todayStr(); if(!all.length) return '';
  const open = all.filter(o => !o.closed && !o.revoked), doneN = all.filter(o => o.closed && !o.revoked).length, n = x => fmtNum(Math.round(x));
  const short = typeof fmtRsShort === 'function' ? fmtRsShort : fmtRs;
  const info = open.map(o => {
    const s = orderStats(o), p = orderPace(o), idle = s.got > 0 ? p.since : p.age;
    const lvl = s.pending > 0 && idle >= 7 ? 'stalled' : s.status === 'over' ? 'over' : s.status === 'within' ? 'within' : s.got > 0 ? 'run' : 'new';
    return {o, s, p, lvl, idle, rank: {stalled: 0, over: 1, within: 2, run: 3, new: 4}[lvl]};
  }).sort((a, b) => a.rank - b.rank || b.s.pending - a.s.pending);
  const tot = info.reduce((t, x) => ({q: t.q + x.s.qty, g: t.g + x.s.got, pend: t.pend + x.s.pending, val: t.val + x.s.pending * (Number(x.o.rate) || 0), wk: t.wk + x.s.weekGot}), {q: 0, g: 0, pend: 0, val: 0, wk: 0});
  const attn = info.filter(x => x.lvl === 'stalled' || x.lvl === 'over').length, pct = tot.q ? Math.min(100, Math.round(tot.g / tot.q * 100)) : 0;
  const chip = {stalled: 'Stalled', over: 'Over delivered', within: 'Within tolerance', run: 'In progress', new: 'Not started'};
  const row = x => {
    const {o, s, p, lvl} = x, top = Math.max(s.qty * (1 + s.tol / 100) * 1.03, s.got) || 1, w = v => (v / top * 100).toFixed(2) + '%', pc = s.qty ? Math.min(100, Math.round(s.got / s.qty * 100)) : 0;
    const last = s.got ? (p.since === 0 ? 'Last delivery today' : p.since === 1 ? 'Last delivery yesterday' : 'Last delivery ' + p.since + ' days ago') : 'No delivery yet';
    const pace = p.perWeek > 0 && p.weeks !== null ? 'About ' + n(p.perWeek) + ' m/week' + (p.weeks <= 1 ? ' · under a week to finish' : ' · ~' + Math.ceil(p.weeks) + ' weeks to finish') : '';
    const pills = [last, pace, Number(o.weekly) > 0 ? 'This week ' + n(s.weekGot) + ' of ' + n(o.weekly) + ' m' + (s.weekGot >= o.weekly ? ' (done)' : '') : '', s.pending && s.stock ? 'Stock covers ' + n(Math.min(s.stock, s.pending)) + ' m' : '', s.toWeave ? n(s.toWeave) + ' m still to weave' : '']
      .filter(Boolean).map(t => `<span class="ovo-pill">${t}</span>`).join('');
    const right = lvl === 'over' ? '+' + n(s.diff) + ' m extra' : s.pending ? n(s.pending) + ' m to go' : 'Delivered';
    return `<div class="ovo-row k-${lvl}" role="button" tabindex="0" data-go-orders="${o.id}"><div class="ovo-top"><b>${escHtml(o.client)}</b><span class="ovo-chip"><i></i>${chip[lvl]}</span></div>
      <small>${escHtml(o.no || '')} · ${escHtml(String(o.quality || '').split(' (')[0])} · Rs ${o.rate}/m</small>
      <div class="ovo-bar"><i style="width:${w(s.got)}"></i><u style="left:${w(s.qty * (1 - s.tol / 100))};width:${w(s.qty * s.tol / 50)}"></u><b style="left:${w(s.qty)}"></b></div>
      <div class="ovo-line"><span><b>${n(s.got)}</b> <small>of ${n(s.qty)} m (${pc}%)</small></span><span class="ovo-right">${right}</span></div>${pills ? `<div class="ovo-pills">${pills}</div>` : ''}</div>`;
  };
  const SHOW = 6, shown = info.slice(0, SHOW).map(row).join(''), more = info.slice(SHOW);
  const tile = (l, v, sub, cls) => `<div class="ovo-kpi ${cls || ''}"><div class="label">${l}</div><div class="value">${v}</div>${sub ? `<div class="ovo-sub">${sub}</div>` : ''}</div>`;
  const badge = open.length ? open.length + ' open · ' + pct + '% delivered' : 'No open orders';
  return `<div class="card ovo-card" data-fold="orders_progress"><div class="card-head"><h2>Orders</h2><span class="ovo-badge">${badge}</span></div>
    ${open.length ? `<div class="ovo-kpis">${tile('Open orders', open.length, attn ? attn + ' need attention' : 'All moving', attn ? 'warn' : '')}${tile('Delivered', n(tot.g) + ' m', 'of ' + n(tot.q) + ' m (' + pct + '%)')}${tile('Still to deliver', n(tot.pend) + ' m', tot.wk ? n(tot.wk) + ' m delivered this week' : '')}${tile('Value to bill', short(tot.val), 'at the agreed rates')}</div>
    <div class="ovo-bar ovo-all"><i style="width:${pct}%"></i></div>
    ${shown}${more.length ? `<div class="ovo-more" hidden>${more.map(row).join('')}</div><button type="button" class="ghost ovo-morebtn" data-ovo-more>Show ${more.length} more</button>` : ''}` : '<p class="note">Every order is completed or revoked.</p>'}
    ${LAST_STATS_MONTHVAL ? '<p class="note" style="margin:10px 0 0">Orders show their full progress, not just the selected period.</p>' : ''}
    <div class="ovo-foot"><span>${doneN ? 'Completed orders: ' + doneN : ''}</span><button type="button" class="ghost" data-go-orders="">All orders</button></div></div>`;
}
function wireOrdersCard(root){
  const go = el => { if(typeof switchTab === 'function') switchTab('orders'); };
  root.querySelectorAll('[data-go-orders]').forEach(el => { el.addEventListener('click', () => go(el)); el.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); go(el); } }); });
  const mb = root.querySelector('[data-ovo-more]'); if(mb) mb.addEventListener('click', () => { const m = root.querySelector('.ovo-more'); const h = m.hidden; m.hidden = !h; mb.textContent = h ? 'Show fewer' : 'Show ' + m.children.length + ' more'; });
}
/* Overview layout (v3.18.29): At a Glance, then a "Needs attention" strip, then the cards grouped under Business / Cash / Costs & Profit.
   The page is drawn as before; this only regroups the finished cards (nothing is removed). A card that is not listed below lands in "More", so no card can go missing. */
const OV_SECS = [
  ['business', 'Business', ['orders', 'awaiting-l-ail', 'stock-position', 'sales-receivables', 'receivables-aging', 'clients-breakdown-by-quality', 'client-statement']],
  ['cash', 'Cash', ['owner-loans-owed-to-you']],
  ['costs', 'Costs & Profit', ['expenses-material-cost', 'warp-usage-last-2-months', 'profit-loss']],
  ['more', 'More', []]
];
const OV_SEC_DEFAULT_FOLDED = {cash: 1, costs: 1};
// Pending and Bounced cheques always need a look: they sit right under the "Needs attention" strip, always open (no group header, no fold, not touched by Collapse all).
const OV_PINNED = ['pending-cheques', 'bounced-cheques'];
function ovGroupOf(slug){ if(slug === 'at-a-glance') return 'top'; if(OV_PINNED.includes(slug)) return 'pinned'; const s = OV_SECS.find(x => x[2].includes(slug)); return s ? s[0] : 'more'; }
// What needs a look right now: orders that are stalled or over delivered, bounced cheques, sales waiting for their L (AIL). Each count follows the card's own permission.
function ovAttention(){
  const out = [], today = todayStr();
  if(ovCardOn('orders_progress') && typeof orderStats === 'function'){
    const n = (DATA.orders || []).filter(o => { if(o.closed || o.revoked) return false; const s = orderStats(o), p = orderPace(o, today); return (s.pending > 0 && (s.got > 0 ? p.since : p.age) >= 7) || s.status === 'over'; }).length;
    if(n) out.push({key: 'orders', text: n + ' order' + (n > 1 ? 's' : '') + ' need' + (n > 1 ? '' : 's') + ' attention', tone: 'warn'});
  }
  if(ovCardOn('bounced_cheques') && typeof computeBouncedCheques === 'function'){
    const b = computeBouncedCheques(); if(b.length) out.push({key: 'bounced-cheques', text: b.length + ' bounced cheque' + (b.length > 1 ? 's' : '') + ' · ' + fmtRs(b.reduce((t, c) => t + (Number(c.amount) || 0), 0)), tone: 'warn'});
  }
  if(ovCardOn('pending_cheques') && typeof computePendingCheques === 'function'){
    const p = computePendingCheques(); if(p.length) out.push({key: 'pending-cheques', text: p.length + ' pending cheque' + (p.length > 1 ? 's' : '') + ' · ' + fmtRs(p.reduce((t, c) => t + (Number(c.amount) || 0), 0)), tone: p.some(c => typeof isChequeOverdue === 'function' && isChequeOverdue(c)) ? 'warn' : ''});
  }
  if(ovCardOn('pending_l')){
    const n = (DATA.sale || []).filter(r => r.lStatus === 'awaiting').length; if(n) out.push({key: 'awaiting-l-ail', text: n + ' sale' + (n > 1 ? 's' : '') + ' awaiting L (AIL)', tone: ''});
  }
  if(ovCardOn('weft_stock') && typeof weftStockEstimate === 'function'){
    const w = weftStockEstimate();
    if(w.low) out.push({key: 'weft-stock', text: '🧵 Weft low · ' + (w.lbs <= 0 ? 'count the bags' : 'about ' + (Math.round(w.cover * 10) / 10) + ' days left'), tone: 'warn'});
  }
  return out;
}
function wireFoldCards(root){
  if(!root || typeof root.querySelectorAll !== 'function') return;
  const load = k => { try{ return JSON.parse(localStorage.getItem(k) || '{}'); }catch(e){ return {}; } }, put = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  let st = load('ov_folded'), secSt = load('ov_secs');
  const slugOf = t => String(t).split(' — ')[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const cards = Array.from(root.children).filter(c => c.classList && c.classList.contains('card'));
  const anchor = Array.from(root.children).find(c => !(c.classList && c.classList.contains('card'))) || null;
  const info = [];
  cards.forEach(c => {
    const head = c.querySelector(':scope > .card-head') || c.querySelector(':scope > h2'), h2 = head && (head.tagName === 'H2' ? head : head.querySelector('h2'));
    if(!head || !h2){ info.push({c, g: 'more', slug: ''}); return; }
    const slug = slugOf(h2.childNodes[0] ? h2.childNodes[0].textContent : h2.textContent);
    info.push({c, head, slug, g: ovGroupOf(slug), key: c.dataset.fold || slug, own: c.classList.contains('summary-card')});
  });
  // 1. Regroup: top cards, attention strip, then one header per group that has cards (a group nobody may see simply has no header).
  cards.forEach(c => root.removeChild(c));
  const put2 = el => root.insertBefore(el, anchor);
  info.filter(x => x.g === 'top').forEach(x => put2(x.c));
  const att = ovAttention(), strip = document.createElement('div'); strip.className = 'ovo-attn';
  strip.innerHTML = `<div class="ovo-attn-t">Needs attention</div>` + (att.length ? att.map(a => `<button type="button" class="ghost ovo-ach ${a.tone}" data-jump="${a.key}">${a.text}</button>`).join('') : `<div class="ovo-clear">Nothing needs attention</div>`);
  if(info.length > 1) put2(strip);
  OV_PINNED.forEach(sl => info.filter(x => x.slug === sl).forEach(x => { x.c.hidden = false; put2(x.c); }));
  const tracked = [], secs = [];
  OV_SECS.forEach(([id, title]) => {
    const list = OV_SECS.find(x => x[0] === id)[2], mem = info.filter(x => x.g === id).sort((p, q) => list.indexOf(p.slug) - list.indexOf(q.slug)); if(!mem.length) return;
    const h = document.createElement('div'); h.className = 'ovo-sec'; h.setAttribute('role', 'button'); h.tabIndex = 0; h.dataset.sec = id;
    h.innerHTML = `<span class="ovo-sec-t">${title}</span><span class="ovo-sec-n">${mem.length} card${mem.length > 1 ? 's' : ''}</span><span class="ovo-sec-c">▾</span>`;
    put2(h); mem.forEach(x => put2(x.c));
    const sec = {id, h, mem}; secs.push(sec);
    const apply = () => { const f = !!(secSt[id] === undefined ? OV_SEC_DEFAULT_FOLDED[id] : secSt[id]); h.classList.toggle('folded', f); mem.forEach(x => { x.c.hidden = f; }); };
    sec.apply = apply; sec.set = f => { secSt[id] = f ? 1 : 0; put('ov_secs', secSt); apply(); label(); }; sec.isFolded = () => h.classList.contains('folded');
    const flip = () => sec.set(!sec.isFolded()); h.addEventListener('click', flip); h.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); flip(); } });
    apply();
  });
  // 2. Each card folds by tapping its heading (cards with their own Show/Hide, like Client Statement, keep that).
  info.forEach(x => {
    if(!x.head || x.own || x.g === 'pinned') return;
    x.c.classList.add('foldable'); x.c.classList.toggle('folded', !!st[x.key]); tracked.push(x); x.c.dataset.fkey = x.slug;
    x.head.addEventListener('click', e => { if(e.target.closest('button')) return; const f = x.c.classList.toggle('folded'); st[x.key] = f ? 1 : 0; put('ov_folded', st); label(); });
  });
  // 3. Collapse all / Expand all (groups and cards together).
  let btn = null;
  const anyOpen = () => secs.some(s => !s.isFolded()) || tracked.some(x => !x.c.classList.contains('folded'));
  function label(){ if(btn) btn.textContent = anyOpen() ? 'Collapse all' : 'Expand all'; }
  if(info.length > 1){
    const bar = document.createElement('div'); bar.className = 'ovo-foldbar'; btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ghost'; bar.appendChild(btn); root.insertBefore(bar, root.firstChild); label();
    btn.addEventListener('click', () => { const fold = anyOpen(); secs.forEach(s => { secSt[s.id] = fold ? 1 : 0; s.apply(); }); tracked.forEach(x => { x.c.classList.toggle('folded', fold); st[x.key] = fold ? 1 : 0; }); put('ov_secs', secSt); put('ov_folded', st); label(); });
  }
  // 4. Attention chips jump to their card, opening its group and the card first.
  strip.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
    if(b.dataset.jump === 'weft-stock'){ SETTINGS_OPEN = 'stock'; switchTab('settings'); return; }   // the weft card lives in Settings > Stock
    const x = info.find(i => i.slug === b.dataset.jump); if(!x) return;
    const s = secs.find(g => g.mem.includes(x)); if(s && s.isFolded()) s.set(false);
    if(x.c.classList.contains('folded')){ x.c.classList.remove('folded'); st[x.key] = 0; put('ov_folded', st); label(); }
    if(x.c.scrollIntoView) x.c.scrollIntoView({behavior: 'smooth', block: 'start'});
  }));
  wireOrdersCard(root);
}

/* ---------------- Graphs (trends over time) ----------------
   Overview only ever shows one selected period at a time, so it can't answer "is this
   getting better or worse". This page reuses computeStats() per calendar month to build
   real month-over-month trend charts instead — the thing a single-period view can't do. */
function lastNMonthKeys(n){
  // "today" comes from todayStr() (the phone's local date) so the charts and the "so far" month agree with the rest of the app
  const out = [], t = todayStr(), now = new Date(Number(t.slice(0,4)), Number(t.slice(5,7))-1, 1);
  for(let i=n-1;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  return out;
}
// Earliest dated entry anywhere in the ledger, as a plain date string — used to fill in an
// open-ended "From" when Graphs has a custom range with only a "To" date set.
function earliestLedgerDate(){
  const dates = [];
  [DATA.production,DATA.sale,DATA.expense,DATA.family,DATA.personal,DATA.warp,DATA.weft,DATA.recovery,DATA.wagePayments,DATA.loanPayments,DATA.personalLoans,DATA.ownerLoans]
    .forEach(arr=>{ if(arr) arr.forEach(r=>{ if(r.date) dates.push(r.date); }); });
  return dates.length ? dates.reduce((a,b)=> a<b?a:b) : todayStr();
}
// Every calendar month from the earliest dated entry anywhere in the ledger up to the
// current month — used for the "All available months" range option.
function allMonthKeysFromData(){
  const dates = [];
  [DATA.production,DATA.sale,DATA.expense,DATA.family,DATA.personal,DATA.warp,DATA.weft,DATA.recovery,DATA.wagePayments,DATA.loanPayments,DATA.personalLoans,DATA.ownerLoans]
    .forEach(arr=>{ if(arr) arr.forEach(r=>{ if(r.date) dates.push(r.date); }); });
  if(!dates.length) return lastNMonthKeys(12);
  const minDate = dates.reduce((a,b)=> a<b?a:b);
  const [y0,m0] = minDate.split('-').map(Number);
  const t = todayStr();
  let cur = new Date(Date.UTC(y0, m0-1, 1));
  const endMarker = new Date(Date.UTC(Number(t.slice(0,4)), Number(t.slice(5,7))-1, 1));
  const out = [];
  while(cur <= endMarker){
    out.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth()+1).padStart(2,'0')}`);
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth()+1, 1));
  }
  return out;
}
// Every calendar month from the month containing `from` up to the month containing `to`,
// inclusive — used when Graphs has a custom From/To date range instead of a preset Range.
function monthKeysBetween(from, to){
  const [y0,m0] = from.split('-').map(Number);
  const [y1,m1] = to.split('-').map(Number);
  let start = new Date(Date.UTC(y0, m0-1, 1));
  let end = new Date(Date.UTC(y1, m1-1, 1));
  if(start > end){ const t = start; start = end; end = t; }
  const out = [];
  let cur = start;
  while(cur <= end){
    out.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth()+1).padStart(2,'0')}`);
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth()+1, 1));
  }
  return out;
}
function monthShortLabel(key){
  const [y,m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m-1].slice(0,3)} ${String(y).slice(2)}`;
}
// Compact number for in-chart labels (lakh/crore, matching fmtRs' Indian-style grouping
// used everywhere else in this app) — a full fmtRs figure is too wide to sit over a bar.
function fmtCompactNum(n){
  const v = Number(n)||0, a = Math.abs(v), sign = v<0?'-':'';
  if(a>=10000000) return sign+(a/10000000).toFixed(2).replace(/\.00$/,'')+'Cr';
  if(a>=100000) return sign+(a/100000).toFixed(2).replace(/\.00$/,'')+'L';
  if(a>=1000) return sign+(a/1000).toFixed(1).replace(/\.0$/,'')+'k';
  return sign+String(Math.round(a));
}
const MONTH_LABEL_MIN_PITCH = 42;
const GX_PALETTE = ['var(--rust)','var(--gold)','var(--green)','#5B7DB1','#8E6BB0','#B8962E','#9AA3AA'];
const GX_ESC = s => (typeof escHtml === 'function' ? escHtml(String(s)) : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
const gxM = v => Math.round(Number(v)||0).toLocaleString('en-IN') + ' m';
const gxRs = v => (Number(v)<0?'-':'') + 'Rs ' + Math.abs(Math.round(Number(v)||0)).toLocaleString('en-IN');
const gxPct = v => (Math.round(v*10)/10) + '%';
// "+12%" / "-8%" change of cur against prev; null when there is nothing to compare with
function gxChange(cur, prev){
  if(prev == null || !(Math.abs(prev) > 0)) return null;
  return (cur-prev)/Math.abs(prev)*100;
}
function gxChangeText(pct){ return pct==null ? '' : (pct>=0?'+':'') + (Math.abs(pct)<10 ? pct.toFixed(1) : Math.round(pct)) + '%'; }
// Straight-line fit through the values (least squares); null with fewer than 3 points
function gxTrend(values){
  const n = values.length; if(n < 3) return null;
  let sx=0, sy=0, sxy=0, sxx=0;
  values.forEach((v,i)=>{ const y=Number(v)||0; sx+=i; sy+=y; sxy+=i*y; sxx+=i*i; });
  const den = n*sxx - sx*sx; if(!den) return null;
  const b = (n*sxy - sx*sy)/den, a = (sy - b*sx)/n;
  return values.map((_,i)=> a + b*i);
}
// Shared chart furniture: dashed average line (with label) and dashed trend line, clipped to the plot
function gxGuides(values, o){
  let out = '';
  const active = values.map(v=>Number(v)||0);
  if(o.avg && active.length > 1){
    const avg = active.reduce((s,v)=>s+v,0)/active.length, y = o.yOf(avg);
    out += `<line class="gx-avg" x1="0" y1="${y}" x2="${o.width}" y2="${y}"></line><text class="gx-avg-t" x="${o.width-2}" y="${y-3}" text-anchor="end">avg ${fmtCompactNum(avg)}</text>`;
  }
  const t = o.trend ? gxTrend(active) : null;
  if(t){
    const pts = t.map((v,i)=> `${o.xOf(i)},${Math.min(o.yMax, Math.max(o.yMin, o.yOf(v)))}`).join(' ');
    out += `<polyline class="gx-trend" points="${pts}"></polyline>`;
  }
  return out;
}
const gxSoFar = (mk, o) => !!(o && o.curKey && mk === o.curKey);
const gxLabel = (mk, i, o) => (o && o.labels) ? o.labels[i] : monthShortLabel(mk);
// Tooltip text for one month: values of every series, plus the change of the first one against the month before
function gxTipText(label, series, i, fmt, live){
  const parts = series.map(s=> (series.length>1 && s.name ? s.name+': ' : '') + fmt(Number(s.values[i])||0));
  let t = label + (live ? ' (so far)' : '') + ' — ' + parts.join(' · ');
  if(i > 0 && series[0]){
    const ch = gxChange(Number(series[0].values[i])||0, Number(series[0].values[i-1])||0);
    if(ch != null) t += ' · ' + gxChangeText(ch) + ' vs ' + (series[0].labelPrev ? series[0].labelPrev(i) : 'previous');
  }
  return t;
}
// Grouped vertical bar chart — one or more series (e.g. Produced vs Sold) side by side per month. Self-contained
// inline SVG, themed with the app's own CSS variables. Options: curKey (month still in progress), trend, avg,
// fmt (tooltip number format), labels (replaces month names), ghost on a series (previous-period values).
function svgGroupedBarChart(monthKeys, series, o){
  o = o || {};
  const barW=14, barGap=3, chartH=170, topPad=22, bottomPad = (o.curKey && monthKeys.includes(o.curKey)) ? 38 : 26;
  const groupW = series.length*barW + (series.length-1)*barGap;
  const groupGap = Math.max(16, MONTH_LABEL_MIN_PITCH - groupW);
  const pitch = groupW+groupGap;
  const width = Math.max(240, monthKeys.length*pitch);
  const height = chartH+topPad+bottomPad;
  const maxVal = Math.max(1, ...series.flatMap(s=>[...s.values, ...(o.ghost && s.ghost ? s.ghost : [])].map(v=>Number(v)||0)));
  const yOf = v => topPad + chartH - (v/maxVal)*chartH;
  const fmt = o.fmt || gxRs;
  let out = '', delay = 0;
  monthKeys.forEach((mk,gi)=>{
    const gx = gi*pitch, live = gxSoFar(mk,o), lbl = gxLabel(mk,gi,o);
    out += `<g class="gx-grp" data-tip="${GX_ESC(gxTipText(lbl, series, gi, fmt, live))}"><rect class="gx-selbg" x="${gx-groupGap/2}" y="0" width="${pitch}" height="${height}"></rect>`;
    series.forEach((s,si)=>{
      const v = Number(s.values[gi])||0;
      const h = Math.max(0,(v/maxVal)*chartH);
      const x = gx+si*(barW+barGap), y = topPad+(chartH-h);
      if(o.ghost && s.ghost){
        const gv = Number(s.ghost[gi])||0, gh = Math.max(0,(gv/maxVal)*chartH);
        if(gv > 0) out += `<rect class="gx-ghost" x="${x-1}" y="${topPad+chartH-gh}" width="${barW+2}" height="${gh}" rx="2"></rect>`;
      }
      out += `<rect class="gx-bar${live?' gx-live':''}" style="animation-delay:${delay}ms" x="${x}" y="${y}" width="${barW}" height="${h}" rx="2" fill="${s.color}"></rect>`;
      if(v>0) out += `<text x="${x+barW/2}" y="${y-3}" font-size="8.5" text-anchor="middle" fill="var(--ink-soft)">${fmtCompactNum(v)}</text>`;
    });
    delay += 25;
    out += `<text x="${gx+groupW/2}" y="${topPad+chartH+16}" font-size="10" text-anchor="middle" fill="var(--ink-soft)">${GX_ESC(lbl)}</text>`;
    if(live) out += `<text x="${gx+groupW/2}" y="${topPad+chartH+28}" font-size="8" text-anchor="middle" class="gx-sofar">so far</text>`;
    out += `</g>`;
  });
  out += `<line x1="0" y1="${topPad+chartH}" x2="${width}" y2="${topPad+chartH}" stroke="var(--line)" stroke-width="1"></line>`;
  out += gxGuides(series[0].values, {...o, width, yOf, xOf: i=> i*pitch+groupW/2, yMin: topPad, yMax: topPad+chartH});
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="display:block" role="img">${out}</svg>`;
}
// Stacked bars: one column per month, split by quality (or anything with name/color/values)
function svgStackedBarChart(monthKeys, stacks, o){
  o = o || {};
  const barW=26, chartH=170, topPad=22, bottomPad = (o.curKey && monthKeys.includes(o.curKey)) ? 38 : 26;
  const pitch = Math.max(MONTH_LABEL_MIN_PITCH, barW+12);
  const width = Math.max(240, monthKeys.length*pitch), height = chartH+topPad+bottomPad;
  const totals = monthKeys.map((_,i)=> stacks.reduce((s,k)=> s+(Number(k.values[i])||0), 0));
  const maxVal = Math.max(1, ...totals);
  let out = '', delay = 0;
  monthKeys.forEach((mk,i)=>{
    const x = i*pitch + (pitch-barW)/2, live = gxSoFar(mk,o), lbl = monthShortLabel(mk);
    const parts = stacks.filter(k=> (Number(k.values[i])||0) > 0).map(k=> `${k.name} ${gxM(k.values[i])}`);
    const tip = `${lbl}${live?' (so far)':''} — total ${gxM(totals[i])}` + (parts.length ? ' · ' + parts.join(' · ') : '');
    out += `<g class="gx-grp" data-tip="${GX_ESC(tip)}"><rect class="gx-selbg" x="${i*pitch}" y="0" width="${pitch}" height="${height}"></rect>`;
    let yy = topPad+chartH;
    stacks.forEach(k=>{
      const v = Number(k.values[i])||0; if(v <= 0) return;
      const h = (v/maxVal)*chartH; yy -= h;
      out += `<rect class="gx-bar${live?' gx-live':''}" style="animation-delay:${delay}ms" x="${x}" y="${yy}" width="${barW}" height="${h}" fill="${k.color}"></rect>`;
    });
    delay += 25;
    if(totals[i] > 0) out += `<text x="${x+barW/2}" y="${yy-3}" font-size="8.5" text-anchor="middle" fill="var(--ink-soft)">${fmtCompactNum(totals[i])}</text>`;
    out += `<text x="${x+barW/2}" y="${topPad+chartH+16}" font-size="10" text-anchor="middle" fill="var(--ink-soft)">${lbl}</text>`;
    if(live) out += `<text x="${x+barW/2}" y="${topPad+chartH+28}" font-size="8" text-anchor="middle" class="gx-sofar">so far</text>`;
    out += `</g>`;
  });
  out += `<line x1="0" y1="${topPad+chartH}" x2="${width}" y2="${topPad+chartH}" stroke="var(--line)" stroke-width="1"></line>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="display:block" role="img">${out}</svg>`;
}
// Diverging bar chart for a single series that can go negative (Profit/Loss) — bars grow
// up from a zero line when positive (green) and down when negative (red).
function svgDivergingBarChart(monthKeys, values, o){
  o = o || {};
  const barW=22, halfH=95, topPad=18, bottomPad = (o.curKey && monthKeys.includes(o.curKey)) ? 34 : 22;
  const gap = Math.max(10, MONTH_LABEL_MIN_PITCH - barW), pitch = barW+gap;
  const width = Math.max(240, monthKeys.length*pitch);
  const height = halfH*2+topPad+bottomPad;
  const midY = topPad+halfH;
  const maxAbs = Math.max(1, ...values.map(v=>Math.abs(Number(v)||0)), ...(o.ghost||[]).map(v=>Math.abs(Number(v)||0)));
  const yOf = v => midY - (v/maxAbs)*halfH;
  let out = '', delay = 0;
  monthKeys.forEach((mk,i)=>{
    const v = Number(values[i])||0, live = gxSoFar(mk,o), lbl = monthShortLabel(mk);
    const h = (Math.abs(v)/maxAbs)*halfH;
    const x = i*pitch;
    const color = v>=0 ? 'var(--green)' : 'var(--red)';
    const y = v>=0 ? midY-h : midY;
    const tip = gxTipText(lbl, [{values, name:''}], i, gxRs, live) + (v<0 ? ' (loss)' : '');
    out += `<g class="gx-grp" data-tip="${GX_ESC(tip)}"><rect class="gx-selbg" x="${x-gap/2}" y="0" width="${pitch}" height="${height}"></rect>`;
    if(o.ghost){
      const gv = Number(o.ghost[i])||0, gh = (Math.abs(gv)/maxAbs)*halfH;
      if(gv) out += `<rect class="gx-ghost" x="${x-1}" y="${gv>=0?midY-gh:midY}" width="${barW+2}" height="${gh}" rx="2"></rect>`;
    }
    out += `<rect class="gx-bar ${v>=0?'':'gx-neg'}${live?' gx-live':''}" style="animation-delay:${delay}ms" x="${x}" y="${y}" width="${barW}" height="${h}" rx="2" fill="${color}"></rect>`;
    delay += 25;
    const labelY = v>=0 ? y-4 : midY+h+12;
    out += `<text x="${x+barW/2}" y="${labelY}" font-size="8.5" text-anchor="middle" fill="var(--ink-soft)">${fmtCompactNum(v)}</text>`;
    out += `<text x="${x+barW/2}" y="${height-(live?16:4)}" font-size="10" text-anchor="middle" fill="var(--ink-soft)">${lbl}</text>`;
    if(live) out += `<text x="${x+barW/2}" y="${height-5}" font-size="8" text-anchor="middle" class="gx-sofar">so far</text>`;
    out += `</g>`;
  });
  out += `<line x1="0" y1="${midY}" x2="${width}" y2="${midY}" stroke="var(--line)" stroke-width="1"></line>`;
  out += gxGuides(values, {...o, width, yOf, xOf: i=> i*pitch+barW/2, yMin: topPad, yMax: topPad+halfH*2});
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="display:block" role="img">${out}</svg>`;
}
// Line chart for a figure that moves month to month (receivable, collection %, Rs per meter). A null value leaves a
// gap. o: color, fmt (tooltip), label (compact point label), ref/refLabel (dashed reference line), area, curKey.
function svgLineChart(monthKeys, values, o){
  o = o || {};
  const chartH=140, topPad=24, bottomPad = (o.curKey && monthKeys.includes(o.curKey)) ? 38 : 26;
  const pitch = MONTH_LABEL_MIN_PITCH, width = Math.max(240, monthKeys.length*pitch), height = chartH+topPad+bottomPad;
  const real = values.filter(v=> v != null).map(Number);
  const lo = Math.min(0, ...real, o.ref!=null?o.ref:0), hi = Math.max(1, ...real, o.ref!=null?o.ref:0);
  const span = (hi-lo) || 1;
  const yOf = v => topPad + chartH - ((v-lo)/span)*chartH;
  const xOf = i => i*pitch + pitch/2;
  const fmt = o.fmt || gxRs, lab = o.label || fmtCompactNum, color = o.color || 'var(--rust)';
  let out = '';
  if(o.ref != null) out += `<line class="gx-avg" x1="0" y1="${yOf(o.ref)}" x2="${width}" y2="${yOf(o.ref)}"></line><text class="gx-avg-t" x="${width-2}" y="${yOf(o.ref)-3}" text-anchor="end">${GX_ESC(o.refLabel||'')}</text>`;
  if(lo < 0) out += `<line x1="0" y1="${yOf(0)}" x2="${width}" y2="${yOf(0)}" stroke="var(--line)" stroke-width="1"></line>`;
  // split into runs of consecutive real values
  const runs = []; let run = [];
  values.forEach((v,i)=>{ if(v == null){ if(run.length) runs.push(run); run = []; } else run.push(i); });
  if(run.length) runs.push(run);
  const base = yOf(Math.max(lo, Math.min(0, hi)));
  runs.forEach(r=>{
    const pts = r.map(i=> `${xOf(i)},${yOf(Number(values[i]))}`).join(' ');
    if(o.area && r.length > 1) out += `<polygon class="gx-area" points="${xOf(r[0])},${base} ${pts} ${xOf(r[r.length-1])},${base}" fill="${color}"></polygon>`;
    if(r.length > 1) out += `<polyline class="gx-line" pathLength="1" points="${pts}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"></polyline>`;
  });
  monthKeys.forEach((mk,i)=>{
    const live = gxSoFar(mk,o), lbl = monthShortLabel(mk), v = values[i];
    let tip = v == null ? `${lbl} — no data` : `${lbl}${live?' (so far)':''} — ${fmt(Number(v))}`;
    if(v != null && i > 0 && values[i-1] != null){
      const ch = gxChange(Number(v), Number(values[i-1]));
      if(ch != null) tip += ' · ' + gxChangeText(ch) + ' vs previous';
    }
    out += `<g class="gx-grp" data-tip="${GX_ESC(tip)}"><rect class="gx-selbg" x="${i*pitch}" y="0" width="${pitch}" height="${height}"></rect>`;
    if(v != null){
      out += `<circle class="gx-dot${live?' gx-live':''}" style="animation-delay:${i*25}ms" cx="${xOf(i)}" cy="${yOf(Number(v))}" r="3.6" fill="${color}"></circle>`;
      out += `<text x="${xOf(i)}" y="${yOf(Number(v))-8}" font-size="8.5" text-anchor="middle" fill="var(--ink-soft)">${GX_ESC(lab(Number(v)))}</text>`;
    }
    out += `<text x="${xOf(i)}" y="${topPad+chartH+16}" font-size="10" text-anchor="middle" fill="var(--ink-soft)">${lbl}</text>`;
    if(live) out += `<text x="${xOf(i)}" y="${topPad+chartH+28}" font-size="8" text-anchor="middle" class="gx-sofar">so far</text>`;
    out += `</g>`;
  });
  out += `<line x1="0" y1="${topPad+chartH}" x2="${width}" y2="${topPad+chartH}" stroke="var(--line)" stroke-width="1"></line>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="display:block" role="img">${out}</svg>`;
}
// Tiny trend line inside a summary tile
function gxSpark(values, color, live){
  const n = values.length; if(n < 2) return '';
  const w=100, h=28, lo=Math.min(...values), hi=Math.max(...values), span=(hi-lo)||1;
  const pts = values.map((v,i)=> [i*(w-6)/(n-1)+3, h-3-((v-lo)/span)*(h-6)]);
  const last = pts[n-1], str = a => a.map(p=>p.join(',')).join(' ');
  if(live && n >= 3){
    // the month still in progress is drawn dashed with a hollow dot: it is not a real fall, it is not finished yet
    return `<svg class="gx-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline class="gx-line" pathLength="1" points="${str(pts.slice(0,n-1))}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline><polyline points="${str(pts.slice(n-2))}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="3 3" stroke-linecap="round" opacity=".7"></polyline><circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="var(--card)" stroke="${color}" stroke-width="1.6"></circle></svg>`;
  }
  return `<svg class="gx-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline class="gx-line" pathLength="1" points="${str(pts)}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline><circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="${color}"></circle></svg>`;
}
// Donut of where the money went; the legend underneath carries the figures
function gxDonut(split, total){
  const r=48, c=2*Math.PI*r; let off = 0;
  const segs = split.map((s,i)=>{
    const len = total>0 ? s.value/total*c : 0;
    const el = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${GX_PALETTE[i%GX_PALETTE.length]}" stroke-width="22" stroke-dasharray="${len} ${c-len}" stroke-dashoffset="${-off}"></circle>`;
    off += len; return el;
  }).join('');
  return `<svg class="gx-donut" viewBox="0 0 140 140" width="140" height="140" role="img"><g transform="rotate(-90 70 70)">${segs}</g><text x="70" y="66" text-anchor="middle" font-size="9" fill="var(--ink-soft)">Total</text><text x="70" y="82" text-anchor="middle" font-size="14" font-weight="800" fill="var(--ink)">${fmtCompactNum(total)}</text></svg>`;
}
// Counts the summary figures up from 0 and wires the Live dot; called after the Graphs page is drawn
function graphsAnimate(root){
  if(!root) return;
  let reduce = false;
  try{ reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }catch(e){}
  if(reduce) return;
  root.querySelectorAll('[data-to]').forEach(el=>{
    const to = Number(el.dataset.to), kind = el.dataset.kind, finalText = el.textContent;
    if(!isFinite(to)) return;
    const t0 = performance.now(), dur = 750;
    const show = v => { el.textContent = (kind==='m') ? gxM(v) : gxRs(v); };
    const step = now => {
      const k = Math.min(1, (now-t0)/dur), e = 1-Math.pow(1-k, 3);
      if(k < 1){ show(to*e); requestAnimationFrame(step); } else el.textContent = finalText;
    };
    requestAnimationFrame(step);
  });
}
// What a tap on a month column shows; also moves the highlight to the tapped column
function graphsTapHandler(e){
  const root = document.getElementById('graphs_root');
  const jump = e.target.closest ? e.target.closest('[data-jump]') : null;
  if(jump){
    const t = document.getElementById(jump.dataset.jump);
    if(t){ t.scrollIntoView({behavior:'smooth', block:'start'}); t.classList.remove('gx-flash'); void t.offsetWidth; t.classList.add('gx-flash'); }
    return;
  }
  const tile = e.target.closest ? e.target.closest('[data-tile]') : null;
  if(tile && root){
    const key = tile.dataset.tile, panel = root.querySelector(`.gx-dpanel[data-for="${key}"]`);
    const wasOpen = tile.classList.contains('open');
    root.querySelectorAll('.gx-tile.open').forEach(x=>{ x.classList.remove('open'); x.setAttribute('aria-expanded','false'); });
    root.querySelectorAll('.gx-dpanel').forEach(x=>{ x.hidden = true; });
    if(!wasOpen && panel){
      tile.classList.add('open'); tile.setAttribute('aria-expanded','true'); panel.hidden = false;
      panel.scrollIntoView({behavior:'smooth', block:'start'});
    }
    return;
  }
  const g = e.target.closest ? e.target.closest('.gx-grp') : null;
  if(!g) return;
  const card = g.closest('.gx-dpanel, .card'); if(!card) return;
  const tip = card.querySelector('.gx-tip');
  const was = g.classList.contains('sel');
  card.querySelectorAll('.gx-grp.sel').forEach(x=> x.classList.remove('sel'));
  if(!was) g.classList.add('sel');
  if(tip) tip.textContent = was ? (tip.dataset.hint || '') : g.dataset.tip;
  if(tip) tip.classList.toggle('on', !was);
}
function graphsPanel(){
  const fromVal = FILTER.graphsFrom || '';
  const toVal = FILTER.graphsTo || '';
  const rangeVal = FILTER.graphsRange || '12';
  const custom = !!(fromVal || toVal);
  // A custom range takes over from the Range preset whenever either date is set. If only one
  // side is given, the other defaults wide open — earliest ledger date, or today — rather than
  // collapsing to that single month, so picking just a "From" naturally means "from there on".
  const monthKeys = custom
    ? monthKeysBetween(fromVal || earliestLedgerDate(), toVal || todayStr())
    : (rangeVal==='all' ? allMonthKeysFromData() : (rangeVal==='q' || rangeVal==='ytd') ? graphsRangeKeys(rangeVal) : lastNMonthKeys(Number(rangeVal)));
  const canCompare = !(rangeVal==='all' && !custom);
  const compareOn = canCompare && !!FILTER.graphsCompare;
  const D = computeGraphsData(monthKeys, canCompare);
  const C = D.cur, n = monthKeys.length;
  const curKey = todayStr().slice(0,7);
  const hasLive = monthKeys.includes(curKey);
  const o = {curKey, trend:true, avg:true};
  const hint = 'Tap a bar for details';
  const tipBox = `<div class="gx-tip" data-hint="${hint}">${hint}</div>`;
  const legend = (items)=>`<div class="gx-legend">${items.map(([color,label])=>`<span><i style="background:${color}"></i>${GX_ESC(label)}</span>`).join('')}</div>`;
  const info = (text)=>`<button type="button" class="info-btn" data-info-toggle title="Info">i</button></div><p class="note info-note" hidden>${text}</p>`;
  const card = (title, text, body, i, id)=>`<div class="card gx-card"${id?` id="${id}"`:''} style="animation-delay:${Math.min(i*70,560)}ms"><div class="card-head"><h2>${title}</h2>${info(text)}${body}</div>`;
  const prevName = n===1 ? 'previous month' : `previous ${n} months`;
  const ghostOn = compareOn && D.prev;
  const sg = (name,color,values,prevValues)=>({name, color, values, ghost: ghostOn ? prevValues : null, labelPrev: i=> monthShortLabel(monthKeys[i-1])});

  // ---- summary tiles (tap one to open its details) ----
  const liveIdx = monthKeys.indexOf(curKey);              // the month still in progress, if it is on screen
  const lastFull = liveIdx === n-1 ? n-2 : n-1;           // newest finished month
  const dayNow = Number(todayStr().slice(8)), daysInMonth = new Date(Number(curKey.slice(0,4)), Number(curKey.slice(5,7)), 0).getDate();
  const mName = i => monthShortLabel(monthKeys[i]);
  const jumpFor = {produced:'gx_prod', sold:'gx_prod', sales:'gx_salesexp', expenses:'gx_salesexp', profit:'gx_profit', received:'gx_cash'};
  const defs = [
    ['Produced','produced','m','var(--rust)',false], ['Sold','sold','m','var(--gold)',false],
    ['Sales','sales','rs','var(--green)',false], ['Expenses','expenses','rs','var(--red)',true],
    ['Profit','profit','rs','var(--green)',false], ['Cash Received','received','rs','var(--rust)',false],
  ];
  const tiles = defs.map(([label,key,kind,color,invert])=>{
    const total = D.totals[key];
    let ch = D.prevTotals ? gxChange(total, D.prevTotals[key]) : null, vs = 'vs prev period';
    if(ch == null && lastFull >= 1){ ch = gxChange(C[key][lastFull], C[key][lastFull-1]); vs = `${mName(lastFull)} vs ${mName(lastFull-1)}`; }
    const good = ch==null ? '' : ((ch>=0) !== invert ? 'good' : 'bad');
    const arrow = ch==null ? '' : (Math.abs(ch)<0.05 ? '' : (ch>0 ? '▲ ' : '▼ '));
    const txt = kind==='m' ? gxM(total) : gxRs(total);
    return `<button type="button" class="gx-tile" data-tile="${key}" aria-expanded="false" style="--c:${color}"><span class="gx-t-more" aria-hidden="true">⌄</span><div class="gx-t-label">${label}</div>
      <div class="gx-t-val${(key==='profit'&&total<0)?' neg':''}" data-to="${Math.round(total)}" data-kind="${kind}">${txt}</div>
      <div class="gx-t-delta ${good}">${ch==null ? '<span class="gx-t-none">—</span>' : arrow+gxChangeText(ch)+' <span class="gx-t-vs">'+vs+'</span>'}</div>
      ${gxSpark(C[key], color, liveIdx === n-1)}</button>`;
  }).join('');
  // what opens under a tile: why the line looks the way it does, a bigger chart, and month-by-month figures
  const panels = defs.map(([label,key,kind,color,invert])=>{
    const vals = C[key], fmt = kind==='m' ? gxM : gxRs, lines = [];
    if(liveIdx >= 1 && liveIdx === n-1){
      const cur = vals[liveIdx], pv = vals[liveIdx-1];
      if(cur < pv) lines.push(`📅 <b>${mName(liveIdx)} is only ${dayNow} of ${daysInMonth} days in</b>, so its figure is still building. That is why the line dips at the end — it is not a real fall yet.`);
      else lines.push(`📅 ${mName(liveIdx)} is already ahead of all of ${mName(liveIdx-1)}, with ${daysInMonth-dayNow} days still to go.`);
      if(key !== 'profit' && dayNow >= 3) lines.push(`⏱ At this pace ${mName(liveIdx)} would finish near ${fmt(cur/dayNow*daysInMonth)} (last full month: ${fmt(pv)}).`);
    }
    const full = monthKeys.map((_,i)=>i).filter(i=> i !== liveIdx && C.active[i]);
    if(full.length >= 2){
      let hi = full[0], lo = full[0], fall = null, rise = null;
      full.forEach((i,k)=>{
        if(vals[i] > vals[hi]) hi = i; if(vals[i] < vals[lo]) lo = i;
        if(k > 0){ const d = vals[i]-vals[full[k-1]]; if(fall===null || d < fall.d) fall = {d, i, from: full[k-1]}; if(rise===null || d > rise.d) rise = {d, i, from: full[k-1]}; }
      });
      lines.push(`🔝 Highest: ${mName(hi)} (${fmt(vals[hi])}) · Lowest: ${mName(lo)} (${fmt(vals[lo])})`);
      if(fall && fall.d < 0 && vals[fall.from] > 0) lines.push(`🔻 Biggest drop: ${mName(fall.from)} → ${mName(fall.i)} (${fmt(vals[fall.from])} → ${fmt(vals[fall.i])}, ${gxChangeText(gxChange(vals[fall.i], vals[fall.from]))}).`);
      if(rise && rise.d > 0 && vals[rise.from] > 0) lines.push(`🔺 Biggest rise: ${mName(rise.from)} → ${mName(rise.i)} (${fmt(vals[rise.from])} → ${fmt(vals[rise.i])}, ${gxChangeText(gxChange(vals[rise.i], vals[rise.from]))}).`);
    }
    const rows = monthKeys.map((_,i)=>i).reverse().map(i=>{
      const ch = i > 0 ? gxChange(vals[i], vals[i-1]) : null;
      const good = ch==null || Math.abs(ch)<0.05 ? '' : ((ch>=0) !== invert ? 'good' : 'bad');
      return `<div class="gx-mrow"><span>${mName(i)}${i===liveIdx?' <em>so far</em>':''}</span><b class="${key==='profit'&&vals[i]<0?'neg':''}">${fmt(vals[i])}</b><i class="${good}">${ch==null?'':(ch>=0?'▲ ':'▼ ')+gxChangeText(ch)}</i></div>`;
    }).join('');
    const chart = key==='profit'
      ? svgDivergingBarChart(monthKeys, vals, {curKey, trend:true, avg:true})
      : svgGroupedBarChart(monthKeys, [{name:label, color, values:vals, labelPrev: i=> mName(i-1)}], {curKey, trend:true, avg:true, fmt});
    return `<div class="gx-dpanel" data-for="${key}" hidden>
      <div class="gx-d-head"><h3>${label} — ${kind==='m' ? gxM(D.totals[key]) : gxRs(D.totals[key])}</h3><button type="button" class="chip" data-jump="${jumpFor[key]}">See full chart ↓</button></div>
      <ul class="gx-insights">${lines.map(t=>`<li>${t}</li>`).join('')}</ul>
      <div class="gx-tip" data-hint="Tap a bar for details">Tap a bar for details</div><div class="gx-scroll">${chart}</div>
      <div class="gx-d-sub">Month by month</div><div class="gx-mlist">${rows}</div></div>`;
  }).join('');

  // ---- highlights ----
  const done = monthKeys.map((_,i)=> i).filter(i=> C.active[i] && !(hasLive && monthKeys[i]===curKey && monthKeys.length>1 && C.active.filter(Boolean).length>1));
  let best = null, worst = null;
  done.forEach(i=>{ if(best===null || C.profit[i]>C.profit[best]) best = i; if(worst===null || C.profit[i]<C.profit[worst]) worst = i; });
  const avgOf = a => done.length ? done.reduce((s,i)=>s+(Number(a[i])||0),0)/done.length : 0;
  const profitMonths = done.filter(i=> C.profit[i] > 0).length;
  const hRow = (label,val,cls)=>`<div class="gx-h-row"><span>${label}</span><b class="${cls||''}">${val}</b></div>`;
  const insights = [];
  if(n >= 2){
    const a = n-1, b = n-2, sc = gxChange(C.sales[a], C.sales[b]), ec = gxChange(C.expenses[a], C.expenses[b]);
    const nm = monthShortLabel(monthKeys[a]) + (monthKeys[a]===curKey ? ' so far' : ''), pm = monthShortLabel(monthKeys[b]);
    if(sc != null) insights.push(`${sc>=0?'📈':'📉'} Sales ${nm}: ${gxRs(C.sales[a])} — ${sc>=0?'up':'down'} ${Math.abs(Math.round(sc))}% from ${pm}.`);
    if(ec != null) insights.push(`${ec>0?'⚠️':'✅'} Expenses ${nm}: ${gxRs(C.expenses[a])} — ${ec>=0?'up':'down'} ${Math.abs(Math.round(ec))}% from ${pm}${(sc!=null && ec>0 && ec>sc)?', growing faster than sales':''}.`);
  }
  if(D.totals.sales > 0) insights.push(`💵 Cash received covered ${gxPct(D.totals.received/D.totals.sales*100)} of sales in this range.`);
  if(n >= 1){
    const diff = C.receivable[n-1] - D.startReceivable;
    insights.push(`🧾 Receivable ${diff>=0?'rose':'fell'} by ${gxRs(Math.abs(diff))} over this range (now ${gxRs(C.receivable[n-1])}).`);
  }
  const topC = D.clients.top[0];
  if(topC && D.clients.total > 0) insights.push(`🏆 Top client: ${GX_ESC(topC.name)} — ${gxPct(topC.amount/D.clients.total*100)} of sales.`);

  // ---- weekly production ----
  const lastDay = (()=>{ const t = todayStr(), e = D.bounds.end ? D.bounds.end.toISOString().slice(0,10) : t; return e < t ? e : t; })();
  const weeks = graphsWeeklyProduction(lastDay, 12);
  const weekLabels = weeks.map(w=>{ const [,m,d] = w.from.split('-').map(Number); return `${d} ${MONTH_NAMES[m-1].slice(0,3)}`; });
  const weekKeys = weeks.map(w=> w.from);
  const wo = {labels: weekLabels, trend:true, avg:true, fmt: v=> gxM(v)};

  // ---- cards ----
  const rangeChips = [['q','This Quarter'],['ytd','This Year'],['6','Last 6 months'],['12','Last 12 months'],['24','Last 24 months'],['all','All available']];
  const latest = graphsLatestEntryDate();
  let i = 0;
  const cards = [];
  cards.push(`<div class="card gx-card">
      <div class="card-head"><h2>Trends Over Time</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Each chart groups your entries by calendar month, so you can see whether things are trending up or down over time — something the single month/year filter on Overview can't show. Tap any bar or point to see its exact figures. Dashed lines show the average and the trend. A faded month is still in progress.</p>
      <div class="gx-live-row"><span class="gx-live-dot"></span><span>Live</span>${latest ? `<span class="gx-live-date">· latest entry ${GX_ESC(latest)}</span>` : ''}</div>
      <div class="chip-row" id="graphs_chips">
        ${rangeChips.map(([v,l])=>`<button type="button" class="chip${(!custom && rangeVal===v)?' active':''}" data-range="${v}">${l}</button>`).join('')}
        <button type="button" class="chip${custom?' active':''}" data-range="custom">Custom…</button>
      </div>
      <div id="graphs_custom" ${custom?'':'hidden'} style="margin-top:12px">
        <div class="grid cols-2">
          <div class="field"><label>From Date</label><input type="date" id="graphsFrom" value="${fromVal}"></div>
          <div class="field"><label>To Date</label><input type="date" id="graphsTo" value="${toVal}"></div>
        </div>
      </div>
      ${canCompare ? `<div class="chip-row" style="margin-top:10px"><button type="button" class="chip${compareOn?' active':''}" id="graphs_compare">◐ Compare with previous period</button></div>` : ''}
    </div>`);
  cards.push(`<div class="gx-tiles gx-card" style="animation-delay:70ms">${tiles}</div><div class="card gx-card gx-details">${panels}</div>`);
  if(done.length){
    cards.push(card('Highlights','Best and weakest month are judged by profit, and leave out a month that is still in progress. Averages are per completed month.',
      `<div class="gx-h">${best!==null ? hRow('Best month', `${monthShortLabel(monthKeys[best])} · ${gxRs(C.profit[best])}`, C.profit[best]>=0?'pos':'neg') : ''}
      ${worst!==null && worst!==best ? hRow('Weakest month', `${monthShortLabel(monthKeys[worst])} · ${gxRs(C.profit[worst])}`, C.profit[worst]>=0?'pos':'neg') : ''}
      ${hRow('Average monthly sales', gxRs(avgOf(C.sales)))}${hRow('Average monthly profit', gxRs(avgOf(C.profit)), avgOf(C.profit)>=0?'pos':'neg')}
      ${hRow('Months in profit', `${profitMonths} of ${done.length}`)}</div>
      ${insights.length ? `<ul class="gx-insights">${insights.map(t=>`<li>${t}</li>`).join('')}</ul>` : ''}`, ++i));
  }
  cards.push(card('Production vs Sales (Meters)','Meters produced vs meters sold, per month. Dashed lines: average and trend of Produced.',
    `${legend([['var(--rust)','Produced'],['var(--gold)','Sold']])}${tipBox}<div class="gx-scroll">${svgGroupedBarChart(monthKeys,[
      sg('Produced','var(--rust)',C.produced,D.prev&&D.prev.produced), sg('Sold','var(--gold)',C.sold,D.prev&&D.prev.sold)
    ], {...o, fmt:gxM, ghost:ghostOn})}</div>`, ++i, 'gx_prod'));
  if(D.qualities.length){
    cards.push(card('Production by Quality','Meters produced each month, split by fabric quality. The largest six qualities are shown; the rest are grouped as Other.',
      `${legend(D.qualities.map((q,k)=>[GX_PALETTE[k%GX_PALETTE.length],q.name]))}${tipBox}<div class="gx-scroll">${svgStackedBarChart(monthKeys, D.qualities.map((q,k)=>({...q, color: GX_PALETTE[k%GX_PALETTE.length]})), {curKey})}</div>`, ++i));
  }
  cards.push(card('Weekly Production (Last 12 Weeks)','Meters woven per week (Monday to Sunday), up to the end of the selected range. Weekly totals smooth out days when entries are logged in batches.',
    `${tipBox}<div class="gx-scroll">${svgGroupedBarChart(weekKeys,[{name:'Meters', color:'var(--rust)', values: weeks.map(w=>w.meters), labelPrev: k=> weekLabels[k-1]}], wo)}</div>`, ++i));
  cards.push(card('Profit / Loss (Rs)','Sales minus Business Expenses (incl. Wages Paid), Family Expenses, Personal Expenses, Warp (Tana) and Weft (Bana) cost, per month. Green is a profit, red is a loss.',
    `${tipBox}<div class="gx-scroll">${svgDivergingBarChart(monthKeys, C.profit, {...o, ghost: ghostOn ? D.prev.profit : null})}</div>`, ++i, 'gx_profit'));
  cards.push(card('Sales vs Total Expenses (Rs)','Sales amount vs combined Business + Family + Personal + Warp + Weft cost, per month.',
    `${legend([['var(--green)','Sales'],['var(--red)','Expenses']])}${tipBox}<div class="gx-scroll">${svgGroupedBarChart(monthKeys,[
      sg('Sales','var(--green)',C.sales,D.prev&&D.prev.sales), sg('Expenses','var(--red)',C.expenses,D.prev&&D.prev.expenses)
    ], {...o, ghost:ghostOn})}</div>`, ++i, 'gx_salesexp'));
  cards.push(card('Cash Received (Rs)','Cash + Bank Transfer + Cleared cheques counted toward Receivable, per month.',
    `${tipBox}<div class="gx-scroll">${svgGroupedBarChart(monthKeys,[sg('Received','var(--rust)',C.received,D.prev&&D.prev.received)], {...o, ghost:ghostOn})}</div>`, ++i, 'gx_cash'));
  cards.push(card('Receivable Trend (Rs)','What clients owe you at the end of each month. A rising line means sales are outrunning collections.',
    `${tipBox}<div class="gx-scroll">${svgLineChart(monthKeys, C.receivable, {color:'var(--gold)', area:true, curKey})}</div>`, ++i));
  cards.push(card('Collection Rate (%)','Cash received each month as a percentage of that month’s sales. Above the dashed 100% line means you collected more than you sold; months with no sales are left blank.',
    `${tipBox}<div class="gx-scroll">${svgLineChart(monthKeys, C.collection, {color:'var(--green)', ref:100, refLabel:'100%', fmt: v=> gxPct(v), label: v=> Math.round(v)+'%', curKey})}</div>`, ++i));
  cards.push(card('Average Selling Rate (Rs / m)','Sales amount divided by meters sold, per month.',
    `${tipBox}<div class="gx-scroll">${svgLineChart(monthKeys, C.avgRate, {color:'var(--rust)', fmt: v=> 'Rs '+(Math.round(v*100)/100).toLocaleString('en-IN')+' / m', label: v=> (Math.round(v*10)/10)+'', curKey})}</div>`, ++i));
  if(D.clients.top.length){
    const max = D.clients.top[0].amount || 1;
    const rows = D.clients.top.map((c,k)=>`<div class="gx-rank"><span class="gx-rank-n">${k+1}</span><div class="gx-rank-main"><div class="gx-rank-top"><b>${GX_ESC(c.name)}</b><span>${gxRs(c.amount)} · ${gxPct(c.amount/D.clients.total*100)}</span></div>
      <div class="gx-rank-track"><div class="gx-rank-bar" style="width:${Math.max(2,c.amount/max*100)}%;animation-delay:${k*70}ms;background:${GX_PALETTE[k%GX_PALETTE.length]}"></div></div><div class="gx-rank-sub">${gxM(c.qty)} sold</div></div></div>`).join('');
    cards.push(card('Top Clients','Clients ranked by sales amount over the selected range, with each one’s share of total sales.',
      `${rows}${D.clients.othersCount ? `<div class="gx-rank-others">+ ${D.clients.othersCount} other client${D.clients.othersCount>1?'s':''} · ${gxRs(D.clients.othersAmount)}</div>` : ''}`, ++i));
  }
  const expTotal = D.expenseSplit.reduce((s,x)=>s+x.value,0);
  if(expTotal > 0){
    cards.push(card('Where the Money Went','Total expenses over the selected range, split by type. Business excludes wages, which are shown separately.',
      `<div class="gx-donut-wrap">${gxDonut(D.expenseSplit, expTotal)}<div class="gx-donut-legend">${D.expenseSplit.map((s,k)=>`<div class="gx-dl"><i style="background:${GX_PALETTE[k%GX_PALETTE.length]}"></i><span>${s.key}</span><b>${gxRs(s.value)}</b><em>${gxPct(s.value/expTotal*100)}</em></div>`).join('')}</div></div>`, ++i));
  }
  return `<div id="graphs_root">${cards.join('')}</div>`;
}
