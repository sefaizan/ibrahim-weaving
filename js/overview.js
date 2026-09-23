/* Overview page (stock, receivables, reminders) and the Graphs page. The Receivable / Cash
 * Position figures themselves are worked out in calc.js (computeStats). */

/* ---------------- Overview ---------------- */
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function allDataYears(){
  const years = new Set();
  ['production','sale','recovery','expense','family','warp','weft','checkpoints'].forEach(key=>{
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
function backupNagBanner(){
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
  const amtByClient = sumWhereBy(DATA.sale, 'client', 'amount', null, null);
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
  const overdueCheques = pendingCheques.filter(c=> c.chequeDate < today);
  const dueSoonCheques = pendingCheques.filter(c=> c.chequeDate >= today && c.chequeDate <= soonCutoff);
  const staleClients = overdueClients(30);
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
    (onlyLoom == null || String(f.loom) === String(onlyLoom)) &&
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
function beamsEndingCard(){
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
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <button type="button" class="primary" data-quick-add="sale" style="margin:0">+ Add Sale</button>
      <button type="button" class="ghost" data-quick-add="recovery" style="margin:0">+ Add Recovery</button>
    </div>
    ${remindersBanner()}
    ${beamsEndingCard()}
    ${backupNagBanner()}
    <div class="card">
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

  // The statement form sits inside this re-rendered area: keep whatever was picked/typed.
  const keepStmt = {};
  ['stmt_client','stmt_from','stmt_to'].forEach(id=>{ const el = document.getElementById(id); if(el) keepStmt[id] = el.value; });

  wrap.innerHTML = `
    <div class="card"><h2>Stock Position</h2>
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
        ${card('Cash Position', s.cash, fmtRs2(s.cash), 'balance compact')}
      </div>
      <div class="legend">${monthVal ? 'Produced/Sold shown for the selected period. In Stock and Cash Position are cumulative as of the end of that period.' : 'All figures shown are all-time totals.'}</div>
    </div>
    ${pendingChequesCardHtml()}
    ${bouncedChequesCardHtml()}
    ${clientStatementCardHtml()}
    <div class="card"><h2>Sales & Receivables</h2>
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
        ${card('Receivable (Outstanding)', s.receivable, fmtRs(s.receivable), 'balance compact')}
      </div>
    </div>
    <div class="card"><div class="card-head"><h2>Warp Usage (Last 2 Months)</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
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
          ['Purchase Date','Warp Type','Length','Woven','Remaining','Yield %','Status'],
          purchaseYield.map(r=>[
            fmtDate(r.purchase.date), escHtml(r.purchase.type||'—'), fmtQtyMtr(r.totalLength), fmtQtyMtr(r.totalWoven),
            fmtQtyMtr(r.totalLength-r.totalWoven), r.yieldPct!=null?r.yieldPct.toFixed(1)+'%':'—',
            r.complete ? 'Complete' : '<b>In Progress</b>'
          ])
        )}</div>`;
      })()}
      <button type="button" class="ghost" style="margin-top:12px" onclick="switchTab('warpbeams')">View All Purchases</button>
    </div>
    <div class="card"><div class="card-head"><h2>Receivables Aging</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Always as of today, regardless of the period selected above — payments are applied against each client's oldest unpaid sale first, so this shows how old the outstanding money actually is, not just how much.</p>
      ${aging.rows.length ? `
      <div class="grid cols-4">
        ${card('0–30 Days', aging.totals.d0_30, fmtRs(aging.totals.d0_30))}
        ${card('31–60 Days', aging.totals.d31_60, fmtRs(aging.totals.d31_60))}
        ${card('61–90 Days', aging.totals.d61_90, fmtRs(aging.totals.d61_90))}
        ${card('90+ Days', aging.totals.d90plus, fmtRs(aging.totals.d90plus), aging.totals.d90plus>0?'balance':'')}
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
    </div>
    <div class="card"><div class="card-head"><h2>Clients Breakdown by Quality</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
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
    </div>
    <div class="card"><h2>Expenses & Material Cost</h2>
      <div class="grid cols-4">
        ${card('Business Expenses', s.bizExpCum, `${fmtRs(monthVal?s.bizExpMonth:s.bizExpCum)} (incl. ${fmtRs(monthVal?s.wagesPaidMonth:s.wagesPaidCum)} wages)`)}
        ${card('Family Expenses', s.famExpCum, fmtRs(monthVal?s.famExpMonth:s.famExpCum))}
        ${card('Warp (Tana) Cost', s.warpCostCum, `${fmtRs(monthVal?s.warpCostMonth:s.warpCostCum)} (${fmtNum(monthVal?s.warpSetsMonth:s.warpSetsCum)} sets)`)}
        ${card('Weft (Bana) Cost', s.weftCostCum, `${fmtRs(monthVal?s.weftCostMonth:s.weftCostCum)} (${fmtNum(monthVal?s.weftBagsMonth:s.weftBagsCum)} bags)`)}
      </div>
      <div class="legend">"Wages" here is the total of Wage Payments logged (from 29 Aug onwards).</div>
      ${((monthVal?s.loanGivenMonth:s.loanGivenCum) || (monthVal?s.loanRepaidMonth:s.loanRepaidCum)) ? `<div class="grid cols-4" style="margin-top:14px">
        ${card('Loans Given (Employees)', s.loanGivenCum, fmtRs(monthVal?s.loanGivenMonth:s.loanGivenCum))}
        ${card('Loan Repayments Received', s.loanRepaidCum, fmtRs(monthVal?s.loanRepaidMonth:s.loanRepaidCum))}
      </div>
      <div class="legend">Cash given to / received back from employees as loans — affects Cash Position but kept separate from Business Expenses and Profit/Loss. See the Loans tab for balances per employee.</div>` : ''}
    </div>
    <div class="card"><h2>Profit / Loss</h2>
      <div class="grid cols-2">
        ${card('Cumulative (all time to period end)', s.profitCum, fmtRs(s.profitCum))}
        ${card('Selected Period Only', s.profitMonth, monthVal?fmtRs(s.profitMonth):'—')}
      </div>
      <div class="legend">Sales − Business Expenses (incl. Wages Paid) − Family Expenses − Warp (Tana) Cost − Weft (Bana) Cost.</div>
    </div>
    ${s.checkpoint ? `<div class="note">Cash Position uses checkpoint from ${fmtDate(s.checkpoint.date)}${s.checkpoint.time?' '+s.checkpoint.time:''} (${fmtRs(s.checkpoint.balance)}) plus everything logged since — on the checkpoint's own date, only entries with a later time count.</div>`
      : `<div class="note">No checkpoint found on or before this date — Cash Position uses Opening Balance instead. Add checkpoints in the Cash Checkpoints tab for more accuracy.</div>`}
  `;
  // Freshly rendered selects need the custom dropdown wrapper (switchTab only enhances once,
  // on first render), then put back the statement choices.
  enhanceSelects(wrap);
  Object.keys(keepStmt).forEach(id=>{ const el = document.getElementById(id); if(el && keepStmt[id] !== '') el.value = keepStmt[id]; });
}

/* ---------------- Graphs (trends over time) ----------------
   Overview only ever shows one selected period at a time, so it can't answer "is this
   getting better or worse". This page reuses computeStats() per calendar month to build
   real month-over-month trend charts instead — the thing a single-period view can't do. */
function lastNMonthKeys(n){
  const out = [], now = new Date();
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
  [DATA.production,DATA.sale,DATA.expense,DATA.family,DATA.warp,DATA.weft,DATA.recovery,DATA.wagePayments,DATA.loanPayments]
    .forEach(arr=>{ if(arr) arr.forEach(r=>{ if(r.date) dates.push(r.date); }); });
  return dates.length ? dates.reduce((a,b)=> a<b?a:b) : todayStr();
}
// Every calendar month from the earliest dated entry anywhere in the ledger up to the
// current month — used for the "All available months" range option.
function allMonthKeysFromData(){
  const dates = [];
  [DATA.production,DATA.sale,DATA.expense,DATA.family,DATA.warp,DATA.weft,DATA.recovery,DATA.wagePayments,DATA.loanPayments]
    .forEach(arr=>{ if(arr) arr.forEach(r=>{ if(r.date) dates.push(r.date); }); });
  if(!dates.length) return lastNMonthKeys(12);
  const minDate = dates.reduce((a,b)=> a<b?a:b);
  const [y0,m0] = minDate.split('-').map(Number);
  const now = new Date();
  let cur = new Date(Date.UTC(y0, m0-1, 1));
  const endMarker = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
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
// Minimum horizontal space a "Mon YY" month label needs at font-size 10 so consecutive
// labels never touch or overlap, no matter how many bars sit in a group — the charts below
// widen their gap to guarantee at least this much room per month, and the chart's own width
// grows to fit (the card scrolls sideways if that's wider than the screen).
const MONTH_LABEL_MIN_PITCH = 42;
// Grouped vertical bar chart — one or more series (e.g. Produced vs Sold) side by side
// per month. Self-contained inline SVG, no charting library, themed with the app's own
// CSS variables so it matches light/whatever palette is active.
function svgGroupedBarChart(monthKeys, series){
  const barW=14, barGap=3, chartH=170, topPad=22, bottomPad=26;
  const groupW = series.length*barW + (series.length-1)*barGap;
  const groupGap = Math.max(16, MONTH_LABEL_MIN_PITCH - groupW);
  const width = Math.max(240, monthKeys.length*(groupW+groupGap));
  const height = chartH+topPad+bottomPad;
  const maxVal = Math.max(1, ...series.flatMap(s=>s.values.map(v=>Number(v)||0)));
  let out = '';
  monthKeys.forEach((mk,gi)=>{
    const gx = gi*(groupW+groupGap);
    series.forEach((s,si)=>{
      const v = Number(s.values[gi])||0;
      const h = Math.max(0,(v/maxVal)*chartH);
      const x = gx+si*(barW+barGap), y = topPad+(chartH-h);
      out += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="2" fill="${s.color}"></rect>`;
      if(v>0) out += `<text x="${x+barW/2}" y="${y-3}" font-size="8.5" text-anchor="middle" fill="var(--ink-soft)">${fmtCompactNum(v)}</text>`;
    });
    out += `<text x="${gx+groupW/2}" y="${topPad+chartH+16}" font-size="10" text-anchor="middle" fill="var(--ink-soft)">${monthShortLabel(mk)}</text>`;
  });
  out += `<line x1="0" y1="${topPad+chartH}" x2="${width}" y2="${topPad+chartH}" stroke="var(--line)" stroke-width="1"></line>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="display:block">${out}</svg>`;
}
// Diverging bar chart for a single series that can go negative (Profit/Loss) — bars grow
// up from a zero line when positive (green) and down when negative (red).
function svgDivergingBarChart(monthKeys, values){
  const barW=22, halfH=95, topPad=18, bottomPad=22;
  const gap = Math.max(10, MONTH_LABEL_MIN_PITCH - barW);
  const width = Math.max(240, monthKeys.length*(barW+gap));
  const height = halfH*2+topPad+bottomPad;
  const midY = topPad+halfH;
  const maxAbs = Math.max(1, ...values.map(v=>Math.abs(Number(v)||0)));
  let out = '';
  monthKeys.forEach((mk,i)=>{
    const v = Number(values[i])||0;
    const h = (Math.abs(v)/maxAbs)*halfH;
    const x = i*(barW+gap);
    const color = v>=0 ? 'var(--green)' : 'var(--red)';
    const y = v>=0 ? midY-h : midY;
    out += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="2" fill="${color}"></rect>`;
    const labelY = v>=0 ? y-4 : midY+h+12;
    out += `<text x="${x+barW/2}" y="${labelY}" font-size="8.5" text-anchor="middle" fill="var(--ink-soft)">${fmtCompactNum(v)}</text>`;
    out += `<text x="${x+barW/2}" y="${height-4}" font-size="10" text-anchor="middle" fill="var(--ink-soft)">${monthShortLabel(mk)}</text>`;
  });
  out += `<line x1="0" y1="${midY}" x2="${width}" y2="${midY}" stroke="var(--line)" stroke-width="1"></line>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="display:block">${out}</svg>`;
}
function graphsPanel(){
  const fromVal = FILTER.graphsFrom || '';
  const toVal = FILTER.graphsTo || '';
  const rangeVal = FILTER.graphsRange || '12';
  // A custom range takes over from the Range preset whenever either date is set. If only one
  // side is given, the other defaults wide open — earliest ledger date, or today — rather than
  // collapsing to that single month, so picking just a "From" naturally means "from there on".
  const monthKeys = (fromVal || toVal)
    ? monthKeysBetween(fromVal || earliestLedgerDate(), toVal || todayStr())
    : (rangeVal==='all' ? allMonthKeysFromData() : lastNMonthKeys(Number(rangeVal)));
  const perMonth = monthKeys.map(mk=>computeStats(mk));
  const produced = perMonth.map(s=>s.producedMonth);
  const sold = perMonth.map(s=>s.soldMonth);
  const salesAmt = perMonth.map(s=>s.salesAmtMonth);
  const totalExp = perMonth.map(s=>s.bizExpMonth+s.famExpMonth+s.warpCostMonth+s.weftCostMonth);
  const profit = perMonth.map(s=>s.profitMonth);
  const received = perMonth.map(s=>s.receivedMonth);
  const legend = (items)=>`<div style="display:flex;gap:16px;margin-bottom:8px;font-size:12px;color:var(--ink-soft)">${
    items.map(([color,label])=>`<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${color};margin-right:5px;vertical-align:-1px"></span>${label}</span>`).join('')
  }</div>`;
  const rangeChips = [['6','Last 6 months'],['12','Last 12 months'],['24','Last 24 months'],['all','All available']];
  return `
    <div class="card">
      <div class="card-head"><h2>Trends Over Time</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Each chart groups your entries by calendar month, so you can see whether things are trending up or down over time — something the single month/year filter on Overview can't show, since it only ever looks at one period at once. Pick a custom From/To date range instead of a preset — it takes over from Range whenever either date is set. Swipe a chart sideways if it doesn't fit the screen.</p>
      <div class="chip-row" id="graphs_chips">
        ${rangeChips.map(([v,l])=>`<button type="button" class="chip${(!(fromVal||toVal) && rangeVal===v)?' active':''}" data-range="${v}">${l}</button>`).join('')}
        <button type="button" class="chip${(fromVal||toVal)?' active':''}" data-range="custom">Custom…</button>
      </div>
      <div id="graphs_custom" ${(fromVal||toVal)?'':'hidden'} style="margin-top:12px">
        <div class="grid cols-2">
          <div class="field"><label>From Date</label><input type="date" id="graphsFrom" value="${fromVal}"></div>
          <div class="field"><label>To Date</label><input type="date" id="graphsTo" value="${toVal}"></div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Production vs Sales (Meters)</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Meters produced vs meters sold, per month.</p>
      ${legend([['var(--rust)','Produced'],['var(--gold)','Sold']])}
      <div style="overflow-x:auto">${svgGroupedBarChart(monthKeys,[
        {color:'var(--rust)', values:produced}, {color:'var(--gold)', values:sold}
      ])}</div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Profit / Loss (Rs)</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Sales minus Business Expenses (incl. Wages Paid), Family Expenses, Warp (Tana) and Weft (Bana) cost, per month. Green is a profit, red is a loss.</p>
      <div style="overflow-x:auto">${svgDivergingBarChart(monthKeys, profit)}</div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Sales vs Total Expenses (Rs)</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Sales amount vs combined Business + Family + Warp + Weft cost, per month.</p>
      ${legend([['var(--green)','Sales'],['var(--red)','Expenses']])}
      <div style="overflow-x:auto">${svgGroupedBarChart(monthKeys,[
        {color:'var(--green)', values:salesAmt}, {color:'var(--red)', values:totalExp}
      ])}</div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Cash Received (Rs)</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Cash + Bank Transfer + Cleared cheques counted toward Receivable, per month.</p>
      <div style="overflow-x:auto">${svgGroupedBarChart(monthKeys,[{color:'var(--rust)', values:received}])}</div>
    </div>
  `;
}
