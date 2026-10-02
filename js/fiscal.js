/* Year Report (fiscal years and quarterly reports). Loaded after proposals.js and before autobackup.js / lock-init.js.
 *
 * PERIODS: the FIRST period runs from the very first entry (December 2025) to 31 Dec 2026 and has no opening position.
 * From 2027 every year is January-December. Each period has quarters (Q1 Jan-Mar ... Q4 Oct-Dec; the first period
 * also has a Q4 2025 stub for the first weeks), and every report can be shown on screen and as a PDF.
 *
 * WHAT IS ENTERED (both kept in the "tools" section, so permissions and sync work as for Cash Checkpoints):
 *   - DATA.fiscalOpenings[<year>] - the position management gives on 1 January: cash and bank, what each client owes,
 *     yarn (one value, warp and weft together, at purchase price), grey cloth (meters and rate per quality, at the
 *     rate of the last deal), what employees owe, and bills due. The total is the OPENING CAPITAL of that year.
 *     Fixed assets are never included, and personal loans stay out.
 *   - DATA.stockValuations - a stock valuation on a date: yarn value, bills due and the grey cloth rate per quality.
 *     Grey cloth meters come from the app (produced less sold); only the rate is typed. A period's closing stock is
 *     the latest valuation on or before its last day; its opening stock is the previous one (or the opening position).
 *
 * THE MATHS (everything else comes from the existing calculation, computeStats):
 *   profit before drawings = sales - (business expenses incl. wages + warp + weft) + closing stock - opening stock
 *   drawings               = family + personal expenses (always its own prominent line)
 *   profit after drawings  = profit before drawings - drawings
 *   closing capital        = opening capital + profit after drawings
 *   closing position       = cash + receivables + employee loans + yarn + grey cloth - bills due
 *   check                  = closing position - closing capital (should be about 0; a gap means something is not entered)
 * A cheque counts as received when it is received (existing behaviour). Personal loans are shown apart, never counted.
 */
const FISCAL_FIRST_END = '2026-12-31';        // the first period ends here; yearly from the next day
let FISCAL_SEL = { period: null, q: 'full' }; // what the page is showing
let FISCAL_OPEN_YEAR = null;                  // the year the opening position card is editing

// ---- dates and periods --------------------------------------------------------------------------
function fiscalDayBefore(d){ const t = new Date(d + 'T00:00:00Z'); return new Date(t.getTime() - 86400000).toISOString().slice(0, 10); }
function fiscalYearOf(d){ return Number(String(d).slice(0, 4)); }
function fiscalQuarters(year, firstFrom){
  const q = [['Q1', '01-01', '03-31'], ['Q2', '04-01', '06-30'], ['Q3', '07-01', '09-30'], ['Q4', '10-01', '12-31']];
  return q.map(x=> ({ id: 'q' + year + x[0], label: x[0] + ' ' + year, from: (year === 2025 ? firstFrom : year + '-' + x[1]), to: year + '-' + x[2] }));
}
// The list the page offers: the first period (with its quarters), then each year from 2027 up to the current year.
function fiscalPeriods(todayYear){
  const ty = Math.max(2027, Number(todayYear) || 2027);
  const out = [{ id: 'first', label: 'First period (Dec 2025 \u2013 Dec 2026)', from: null, to: FISCAL_FIRST_END,
    quarters: [{ id: 'q2025Q4', label: 'Q4 2025', from: null, to: '2025-12-31' }].concat(fiscalQuarters(2026)) }];
  for(let y = 2027; y <= ty; y++) out.push({ id: String(y), label: String(y), from: y + '-01-01', to: y + '-12-31', quarters: fiscalQuarters(y) });
  return out;
}

// ---- stock and position at a date ---------------------------------------------------------------
function fiscalGreyValue(stockByQuality, rates){
  let value = 0; const missing = [];
  (stockByQuality || []).forEach(r=>{
    if(!(r.stock > 0)) return;
    const rate = Number((rates || {})[r.name]);
    if(rate > 0) value += r.stock * rate; else missing.push(r.name);
  });
  return { value, missing };
}
function fiscalLatestValuation(date){
  const rows = (DATA.stockValuations || []).filter(v=> v && v.date && v.date <= date);
  if(!rows.length) return null;
  return rows.reduce((a, b)=> (b.date > a.date || (b.date === a.date && String(b.id) > String(a.id))) ? b : a);
}
// Stock and bills due as at the end of `date`: { yarn, grey, bills, known, missing, on }
function fiscalStockAt(date){
  const v = fiscalLatestValuation(date);
  if(!v) return { yarn: 0, grey: 0, bills: 0, known: false, missing: [], on: null };
  const s = computeStats('range::' + date);
  const g = fiscalGreyValue(s.stockByQuality, v.greyRates);
  return { yarn: Number(v.yarn) || 0, grey: g.value, bills: Number(v.bills) || 0, known: true, missing: g.missing, on: v.date };
}
function fiscalOpeningTotals(op){
  const sum = o => Object.keys(o || {}).reduce((s, k)=> s + (Number(o[k]) || 0), 0);
  const grey = (op.grey || []).reduce((s, g)=> s + (Number(g.meters) || 0) * (Number(g.rate) || 0), 0);
  const parts = { cash: Number(op.cash) || 0, receivables: sum(op.receivables), yarn: Number(op.yarn) || 0, grey, empLoans: sum(op.empLoans), bills: Number(op.bills) || 0 };
  parts.total = parts.cash + parts.receivables + parts.yarn + parts.grey + parts.empLoans - parts.bills;
  return parts;
}
function fiscalOpeningFor(year){ const o = DATA.fiscalOpenings; return o && typeof o === 'object' && !Array.isArray(o) ? (o[String(year)] || null) : null; }
// Opening stock of a period starting on `from` (null = very first): the opening position of that year when `from` is its
// opening date, otherwise the latest valuation before `from`.
function fiscalOpeningStock(from){
  if(!from) return { yarn: 0, grey: 0, bills: 0, known: true, missing: [], on: null };
  const op = fiscalOpeningFor(fiscalYearOf(from));
  if(op && op.date === from){ const t = fiscalOpeningTotals(op); return { yarn: t.yarn, grey: t.grey, bills: t.bills, known: true, missing: [], on: from }; }
  return fiscalStockAt(fiscalDayBefore(from));
}
// The position as at the end of `date`, from the entries and the latest valuation.
function fiscalPositionAt(date){
  const s = computeStats('range::' + date), st = fiscalStockAt(date);
  const empLoans = (s.loanGivenCum || 0) - (s.loanRepaidCum || 0);
  const p = { date, cash: s.cash, receivables: s.receivable, empLoans, yarn: st.yarn, grey: st.grey, bills: st.bills, stock: st, personalLoans: (s.personalLoanGivenCum || 0) - (s.personalLoanRepaidCum || 0) };
  p.total = p.cash + p.receivables + p.empLoans + p.yarn + p.grey - p.bills;
  return p;
}
function fiscalOpeningCapital(from){
  if(!from) return null;
  const y = fiscalYearOf(from), op = fiscalOpeningFor(y);
  if(!op) return null;
  const base = fiscalOpeningTotals(op).total;
  if(from === y + '-01-01' || from <= op.date) return base;
  return base + fiscalReport(op.date, fiscalDayBefore(from)).profitAfter;
}

// ---- the report ----------------------------------------------------------------------------------
function fiscalReport(from, to){
  const s = computeStats('range:' + (from || '') + ':' + to);
  const open = fiscalOpeningStock(from), close = fiscalStockAt(to);
  const costs = (s.bizExpMonth || 0) + (s.warpCostMonth || 0) + (s.weftCostMonth || 0);
  const r = {
    from, to, produced: s.producedMonth, sold: s.soldMonth, sales: s.salesAmtMonth, received: s.receivedMonth,
    bizExp: s.bizExpMonth, wages: s.wagesPaidMonth, warp: s.warpCostMonth, weft: s.weftCostMonth, costs,
    openStock: open, closeStock: close, stockChange: (close.yarn + close.grey) - (open.yarn + open.grey),
    drawingsFamily: s.famExpMonth || 0, drawingsPersonal: s.personalExpMonth || 0,
  };
  r.drawings = r.drawingsFamily + r.drawingsPersonal;
  r.profitBefore = r.sales - costs + r.stockChange;
  r.profitAfter = r.profitBefore - r.drawings;
  r.openingCapital = fiscalOpeningCapital(from);
  r.closingCapital = r.openingCapital === null ? null : r.openingCapital + r.profitAfter;
  r.position = fiscalPositionAt(to);
  r.check = r.closingCapital === null ? null : r.position.total - r.closingCapital;
  return r;
}

// ---- the page ------------------------------------------------------------------------------------
function fiscalSelected(){
  const ps = fiscalPeriods(new Date().getFullYear());
  const p = ps.find(x=> x.id === FISCAL_SEL.period) || ps[0];
  const q = p.quarters.find(x=> x.id === FISCAL_SEL.q);
  return { ps, p, q, from: q ? q.from : p.from, to: q ? q.to : p.to, label: q ? q.label : p.label };
}
function fiscalLine(label, value, cls){
  return `<div class="row${cls ? ' ' + cls : ''}" style="display:flex;justify-content:space-between;gap:12px;padding:5px 0"><span>${escHtml(label)}</span><span class="num">${value}</span></div>`;
}
function fiscalReportHtml(sel){
  const r = fiscalReport(sel.from, sel.to), today = new Date().toISOString().slice(0, 10);
  const money = fmtRs, notes = [];
  if(!r.closeStock.known) notes.push('No stock valuation on or before ' + fmtDate(sel.to) + ': yarn and grey cloth are counted as 0 here. Add one below.');
  else if(r.closeStock.missing.length) notes.push('No grey cloth rate for ' + r.closeStock.missing.join(', ') + ' in the valuation of ' + fmtDate(r.closeStock.on) + ': that cloth is counted as 0.');
  if(sel.from && !r.openStock.known) notes.push('No stock valuation before ' + fmtDate(sel.from) + ': opening stock is counted as 0.');
  if(sel.to > today) notes.push('This period has not ended: figures are up to today.');
  const ocap = r.openingCapital === null ? '\u2014' : money(r.openingCapital);
  return `<div class="card"><h2>${escHtml(sel.label)}</h2>
    ${fiscalLine('Opening capital', ocap, '')}
    ${sel.from ? '' : '<p class="note" style="margin:0 0 6px">The first period has no opening position: it runs from the very first entry.</p>'}
    ${fiscalLine('Sales', money(r.sales))}
    ${fiscalLine('Business expenses (incl. wages ' + money(r.wages) + ')', '\u2212 ' + money(r.bizExp))}
    ${fiscalLine('Warp (tana) bought', '\u2212 ' + money(r.warp))}
    ${fiscalLine('Weft (bana) bought', '\u2212 ' + money(r.weft))}
    ${fiscalLine('Stock change (closing ' + money(r.closeStock.yarn + r.closeStock.grey) + ' \u2212 opening ' + money(r.openStock.yarn + r.openStock.grey) + ')', money(r.stockChange))}
    ${fiscalLine('Profit before drawings', '<b>' + money(r.profitBefore) + '</b>')}
    <div style="margin:8px 0;padding:10px;border:2px solid var(--primary, #1565c0);border-radius:8px">
      <b>Drawings (owner\u2019s family and personal expenses)</b>
      ${fiscalLine('Family expenses', '\u2212 ' + money(r.drawingsFamily))}
      ${fiscalLine('Personal expenses', '\u2212 ' + money(r.drawingsPersonal))}
      ${fiscalLine('Total drawings', '<b>\u2212 ' + money(r.drawings) + '</b>')}
    </div>
    ${fiscalLine('Profit after drawings', '<b>' + money(r.profitAfter) + '</b>')}
    ${fiscalLine('Closing capital (opening + profit after drawings)', r.closingCapital === null ? '\u2014' : '<b>' + money(r.closingCapital) + '</b>')}
    <h3 style="margin:14px 0 4px">Position at ${escHtml(fmtDate(sel.to > today ? today : sel.to))}</h3>
    ${fiscalLine('Cash and bank', money(r.position.cash))}
    ${fiscalLine('Receivables', money(r.position.receivables))}
    ${fiscalLine('Employee loans', money(r.position.empLoans))}
    ${fiscalLine('Yarn in hand', money(r.position.yarn))}
    ${fiscalLine('Grey cloth in hand', money(r.position.grey))}
    ${fiscalLine('Bills due', '\u2212 ' + money(r.position.bills))}
    ${fiscalLine('Total position', '<b>' + money(r.position.total) + '</b>')}
    ${r.check === null ? '' : fiscalLine('Check: position \u2212 closing capital', money(r.check))}
    <p class="note" style="margin:8px 0 0">Personal loans given (${money(r.position.personalLoans)}) are kept apart and not counted. Fixed assets are never included.</p>
    ${notes.map(n=> `<p class="note" style="margin:6px 0 0"><b>Note:</b> ${escHtml(n)}</p>`).join('')}
    <div class="form-actions fy-static" style="margin-top:10px"><button class="ghost" type="button" id="fiscalPdf">Download PDF</button></div></div>`;
}
// v3.17.63 — the app's own figures as at the day before an opening date, used to pre-fill the opening position (all editable).
function fiscalAutoOpening(openDate){
  const prev = fiscalDayBefore(openDate), s = computeStats('range::' + prev), r4 = x => Math.round((Number(x) || 0) * 10000) / 10000;
  const rc = {}, el = {}, gm = {};
  (s.receivablesByClient || []).forEach(c=>{ const x = Math.round((Number(c.receivable) || 0) * 100) / 100; if(Math.abs(x) > 0.004) rc[c.name] = x; });
  (DATA.employees || []).forEach(e=>{
    if(!e || !e.name) return;
    const rows = (DATA.loanPayments || []).filter(p=> p.employee === e.name && p.date && p.date <= prev);
    const given = rows.filter(p=> p.type !== 'Loan Repaid').reduce((a, p)=> a + (Number(p.amount) || 0), 0), back = rows.filter(p=> p.type === 'Loan Repaid').reduce((a, p)=> a + (Number(p.amount) || 0), 0);
    const x = Math.round((given - back) * 100) / 100; if(Math.abs(x) > 0.004) el[e.name] = x;
  });
  (s.stockByQuality || []).forEach(q=>{ if(q.stock > 0) gm[q.name] = r4(q.stock); });
  const v = fiscalLatestValuation(prev), rates = (v && v.greyRates) || {};
  return { prev, rc, el, gm, rates };
}
// v3.17.69 — year-end carry-over: the previous period's closing position / capital against this year's opening position.
function fiscalPrevPeriod(date){
  const prev = fiscalDayBefore(date);
  return { prev, period: fiscalPeriods(new Date().getFullYear()).find(p=> p.to === prev) || null };
}
function fiscalCarryCheckHtml(year, op){
  const date = (op && op.date) || year + '-01-01', pp = fiscalPrevPeriod(date), prev = pp.prev;
  const pos = fiscalPositionAt(prev), prevClose = pp.period ? fiscalReport(pp.period.from, pp.period.to).closingCapital : null;
  const label = pp.period ? pp.period.label : 'Previous year', open = op ? fiscalOpeningTotals(op).total : null;
  const ref = prevClose !== null ? prevClose : pos.total, diff = open === null ? null : open - ref;
  const st = diff === null ? `<span class="note">Not saved yet \u2014 tap \u201cCarry over\u201d, check the figures, then save.</span>`
    : Math.abs(diff) < 1 ? `<b style="color:#1b7846">\u2714 Matches \u2014 ${escHtml(String(year))} opens exactly where ${escHtml(label)} closed.</b>`
    : `<b style="color:#b02a2a">Differs by ${fmtRs(diff)}</b> <span class="note">\u2014 compare cash, receivables per client, stock and bills with the closing figures above.</span>`;
  return `<div style="border-top:1px solid var(--line);margin-top:12px;padding-top:8px"><h3 style="margin:0 0 4px">Year-end carry-over</h3>
    ${fiscalLine(label + ' \u2014 closing position at ' + fmtDate(prev), fmtRs(pos.total))}
    ${prevClose !== null ? fiscalLine(label + ' \u2014 closing capital (its report)', fmtRs(prevClose)) : ''}
    ${fiscalLine('Opening capital ' + year, open === null ? '\u2014' : fmtRs(open))}
    <p style="margin:6px 0 0">${st}</p>
    <div class="form-actions fy-static"><button class="ghost vo-hide" type="button" id="fiscalCarry">Carry over ${escHtml(label)} closing</button></div></div>`;
}
// Fill every figure of the opening form from the app's closing position at the end of the day before `date`.
function fiscalApplyAuto(date, force){
  const a = fiscalAutoOpening(date), put = (el, val)=>{ el.value = val ? val : ''; };
  if(force){
    const pos = fiscalPositionAt(a.prev), set = (id, val)=>{ const el = document.getElementById(id); if(el) put(el, val); };
    set('fo_cash', pos.cash); set('fo_yarn', pos.yarn); set('fo_bills', pos.bills);
  }
  document.querySelectorAll('[data-fo]').forEach(el=>{
    if(el.dataset.man && !force) return;
    if(force) delete el.dataset.man;
    const k = el.dataset.key, kind = el.dataset.fo;
    put(el, kind === 'rc' ? a.rc[k] : kind === 'el' ? a.el[k] : kind === 'gm' ? a.gm[k] : a.rates[k]);
  });
  let any = false;
  document.querySelectorAll('.fo-gq').forEach(row=>{
    const k = row.getAttribute('data-gq'), has = !!(a.gm[k] || row.querySelector('[data-fo="gm"]').value || row.querySelector('[data-fo="gr"]').value);
    row.style.display = has ? 'flex' : 'none'; if(has) any = true;
  });
  const none = document.getElementById('fo_greyNone'); if(none) none.style.display = any ? 'none' : 'block';
}
function fiscalOpeningCardHtml(year){
  const op = fiscalOpeningFor(year) || {}, t = fiscalOpeningTotals(op), money = fmtRs;
  const saved = !!fiscalOpeningFor(year), auto = fiscalAutoOpening(op.date || year + '-01-01');
  const dp = saved ? null : fiscalPositionAt(auto.prev), dv = (k, x)=> saved ? (op[k] || '') : (dp[x] || '');
  const inp = (id, val, kind, key)=> `<input type="number" inputmode="decimal" id="${id}" data-fo="${kind}" placeholder="${({gm:'Meters',gr:'Rate per meter'})[kind] || 'Amount (Rs)'}" data-key="${escHtml(key || '')}"${saved ? ' data-man="1"' : ''} value="${val === undefined || val === null || val === 0 ? '' : val}" style="width:100%">`;
  const names = a => (a || []).map(x=> (x && x.name) ? x.name : '').filter(Boolean);
  const rows = (title, list, prefix, map, kind, autoMap)=> list.length ? `<h3 style="margin:12px 0 4px">${title}</h3>` + list.map((n, i)=>
    `<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="flex:1;min-width:0">${escHtml(n)}</span><span style="width:40%">${inp(prefix + i, saved ? map[n] : autoMap[n], kind, n)}</span></div>`).join('') : '';
  const anyGrey = names(DATA.qualities).some(n=> auto.gm[n] || (op.grey || []).some(x=> x.quality === n && (x.meters || x.rate)));
  const greyRows = names(DATA.qualities).length ? '<h3 style="margin:12px 0 4px">Grey cloth in hand (meters and rate per meter)</h3><div id="fo_greyNone" class="note" style="display:' + (anyGrey ? 'none' : 'block') + '">No grey cloth in stock on this date.</div>' + names(DATA.qualities).map((n, i)=>{
    const g = (op.grey || []).find(x=> x.quality === n) || {}, m = saved ? g.meters : auto.gm[n], r = saved ? g.rate : auto.rates[n];
    const show = !!(m || r || auto.gm[n]);
    return `<div class="fo-gq" data-gq="${escHtml(n)}" style="display:${show ? 'flex' : 'none'};gap:8px;align-items:center;margin:4px 0"><span style="flex:1;min-width:0">${escHtml(n)}</span><span style="width:26%">${inp('fo_gm' + i, m, 'gm', n)}</span><span style="width:26%">${inp('fo_gr' + i, r, 'gr', n)}</span></div>`;
  }).join('') : '';
  return `<div class="card"><div class="card-head"><h2>Opening position ${escHtml(String(year))}</h2></div>
    <p class="note" style="margin:0 0 8px">The position management gives you on 1 January ${escHtml(String(year))}. Fixed assets and personal loans are left out. The total is that year\u2019s opening capital.</p>
    <div class="grid cols-2">${field('Date', 'fo_date', 'date', `value="${op.date || year + '-01-01'}"`)}${field('Cash and bank (Rs)', 'fo_cash', 'number', `value="${dv('cash', 'cash')}"`)}</div>
    <div class="grid cols-2">${field('Yarn in hand, warp + weft (Rs)', 'fo_yarn', 'number', `value="${dv('yarn', 'yarn')}"`)}${field('Bills due (Rs)', 'fo_bills', 'number', `value="${dv('bills', 'bills')}"`)}</div>
    <p class="note" style="margin:0 0 4px">Receivables, grey cloth and employee loans are filled in from the app\u2019s own figures at the end of the day before the date above. Change any figure that differs.</p>
    ${rows('Receivables per client (Rs)', names(DATA.clients), 'fo_rc', op.receivables || {}, 'rc', auto.rc)}
    ${greyRows}
    ${rows('Employee loans per employee (Rs)', names(DATA.employees), 'fo_el', op.empLoans || {}, 'el', auto.el)}
    <p style="margin:12px 0 4px"><b>Opening capital: ${money(t.total)}</b> <span class="note">(cash ${money(t.cash)} + receivables ${money(t.receivables)} + yarn ${money(t.yarn)} + grey cloth ${money(t.grey)} + employee loans ${money(t.empLoans)} \u2212 bills ${money(t.bills)})</span></p>
    ${fiscalCarryCheckHtml(year, saved ? op : null)}
    <div class="form-actions fy-static"><button class="primary" type="button" id="fiscalSaveOpening">Save opening position</button></div>
    <div id="fiscalOpeningCheck"></div></div>`;
}
function fiscalValuationCardHtml(){
  const quals = (DATA.qualities || []).map(x=> x && x.name).filter(Boolean);
  const rows = (DATA.stockValuations || []).slice().sort((a, b)=> a.date < b.date ? 1 : -1).map(v=>
    `<tr><td>${escHtml(fmtDate(v.date))}</td><td class="num">${fmtRs(v.yarn)}</td><td class="num">${fmtRs(v.bills)}</td><td>${escHtml(Object.keys(v.greyRates || {}).map(k=> k + ' ' + v.greyRates[k]).join(', '))}</td><td><button class="ghost" type="button" data-del="stockValuations:${escHtml(String(v.id))}">Delete</button></td></tr>`).join('');
  return `<div class="card"><div class="card-head"><h2>Quarterly Stock Valuation</h2></div>
    <p class="note" style="margin:0 0 8px">Do this at the end of each quarter (and on 31 Dec). Yarn is the value at purchase price, warp and weft together. Grey cloth meters come from the app; type the rate per meter you value each quality at (the last deal rate).</p>
    <div class="grid cols-2">${field('Date', 'sv_date', 'date', `value="${todayStr()}"`)}${field('Yarn in hand (Rs)', 'sv_yarn', 'number')}</div>
    <div class="grid cols-2">${field('Bills due (Rs)', 'sv_bills', 'number')}</div>
    ${quals.map((n, i)=> `<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="flex:1;min-width:0">Rate per meter \u2014 ${escHtml(n)}</span><span style="width:34%"><input type="number" inputmode="decimal" id="sv_r${i}" placeholder="Rate per meter" style="width:100%"></span></div>`).join('')}
    <div class="form-actions fy-static"><button class="primary" type="button" id="fiscalAddValuation">Add valuation</button></div>
    ${rows ? `<div style="overflow-x:auto;margin-top:10px"><table><thead><tr><th>Date</th><th>Yarn</th><th>Bills</th><th>Grey rates</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}</div>`;
}
function fiscalPanel(){
  const sel = fiscalSelected();
  if(!FISCAL_SEL.period) FISCAL_SEL.period = sel.p.id;
  if(!FISCAL_OPEN_YEAR) FISCAL_OPEN_YEAR = 2027;
  const chip = (attr, id, label, on)=> `<button type="button" class="${on ? 'primary' : 'ghost'}" ${attr}="${id}" style="margin:2px">${escHtml(label)}</button>`;
  const years = sel.ps.filter(p=> p.id !== 'first').map(p=> Number(p.id));
  return `<div class="card"><h2>Year Report</h2>
    <div>${sel.ps.map(p=> chip('data-fy-period', p.id, p.label, p.id === sel.p.id)).join('')}</div>
    <div style="margin-top:6px">${chip('data-fy-q', 'full', 'Full period', !sel.q)}${sel.p.quarters.map(q=> chip('data-fy-q', q.id, q.label, sel.q && q.id === sel.q.id)).join('')}</div></div>
    ${fiscalReportHtml(sel)}
    ${fiscalValuationCardHtml()}
    ${years.length > 1 ? `<div class="card"><div>${years.map(y=> chip('data-fy-open', y, 'Opening ' + y, y === FISCAL_OPEN_YEAR)).join('')}</div></div>` : ''}
    ${fiscalOpeningCardHtml(FISCAL_OPEN_YEAR)}`;
}

// ---- wiring --------------------------------------------------------------------------------------
function fiscalReadOpening(year){
  const vv = id=> Number(v(id) || 0);
  const names = a => (a || []).map(x=> (x && x.name) ? x.name : '').filter(Boolean);
  const op = { date: v('fo_date') || year + '-01-01', cash: vv('fo_cash'), yarn: vv('fo_yarn'), bills: vv('fo_bills'), receivables: {}, empLoans: {}, grey: [] };
  names(DATA.clients).forEach((n, i)=>{ const x = vv('fo_rc' + i); if(x) op.receivables[n] = x; });
  names(DATA.employees).forEach((n, i)=>{ const x = vv('fo_el' + i); if(x) op.empLoans[n] = x; });
  names(DATA.qualities).forEach((n, i)=>{ const m = vv('fo_gm' + i), r = vv('fo_gr' + i); if(m || r) op.grey.push({ quality: n, meters: m, rate: r }); });
  return op;
}
function fiscalWire(){
  document.querySelectorAll('[data-fy-period]').forEach(b=>{ b.onclick = ()=>{ FISCAL_SEL = { period: b.getAttribute('data-fy-period'), q: 'full' }; switchTab('fiscal'); }; });
  document.querySelectorAll('[data-fy-q]').forEach(b=>{ b.onclick = ()=>{ FISCAL_SEL.q = b.getAttribute('data-fy-q'); switchTab('fiscal'); }; });
  document.querySelectorAll('[data-fy-open]').forEach(b=>{ b.onclick = ()=>{ FISCAL_OPEN_YEAR = Number(b.getAttribute('data-fy-open')); switchTab('fiscal'); }; });
  const pdf = document.getElementById('fiscalPdf'); if(pdf) pdf.onclick = ()=> fiscalPdf();
  const add = document.getElementById('fiscalAddValuation');
  if(add) add.onclick = async ()=>{
    const date = v('sv_date'); if(!date){ showToast('Pick a date'); return; }
    const rates = {};
    (DATA.qualities || []).map(x=> x && x.name).filter(Boolean).forEach((n, i)=>{ const r = Number(v('sv_r' + i) || 0); if(r > 0) rates[n] = r; });
    DATA.stockValuations.push({ id: uid(), date, yarn: Number(v('sv_yarn') || 0), bills: Number(v('sv_bills') || 0), greyRates: rates });
    await save(); switchTab('fiscal');
  };
  const so = document.getElementById('fiscalSaveOpening');
  if(so) so.onclick = async ()=>{
    const op = fiscalReadOpening(FISCAL_OPEN_YEAR);
    if(!DATA.fiscalOpenings || Array.isArray(DATA.fiscalOpenings)) DATA.fiscalOpenings = {};
    DATA.fiscalOpenings[String(FISCAL_OPEN_YEAR)] = op;
    await save(); switchTab('fiscal');
  };
  // Opening position: typing marks a figure as yours; changing the date refreshes only the figures you have not touched.
  document.querySelectorAll('[data-fo]').forEach(el=>{ el.addEventListener('input', ()=>{ el.dataset.man = '1'; }); });
  const fod = document.getElementById('fo_date');
  if(fod) fod.addEventListener('change', ()=>{ if(fod.value) fiscalApplyAuto(fod.value, false); });
  const cb = document.getElementById('fiscalCarry');
  if(cb) cb.onclick = ()=>{
    const d = (fod && fod.value) || FISCAL_OPEN_YEAR + '-01-01';
    fiscalApplyAuto(d, true);
    showToast('Carried over the closing position at ' + fmtDate(fiscalDayBefore(d)) + '. Check the figures, then tap Save.');
  };
  wireDelete('stockValuations');
}
// v3.17.68 — one row per calendar month of the selected period (for the charts and table in the PDF).
function fiscalMonthly(sel){
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], p2 = n=> (n < 10 ? '0' : '') + n;
  const todayIso = new Date().toISOString().slice(0, 10), last = sel.to > todayIso ? todayIso : sel.to;
  let first = sel.from;
  if(!first){
    let mn = '';
    Object.keys(DATA).forEach(k=>{ const a = DATA[k]; if(Array.isArray(a)) a.forEach(e=>{ const d = e && e.date; if(typeof d === 'string' && /^20\d\d-\d\d-\d\d$/.test(d) && (!mn || d < mn)) mn = d; }); });
    first = mn || last;
  }
  if(first > last) return [];
  const out = []; let y = +first.slice(0, 4), mo = +first.slice(5, 7); const ey = +last.slice(0, 4), em = +last.slice(5, 7);
  while((y < ey || (y === ey && mo <= em)) && out.length < 36){
    const ms = y + '-' + p2(mo) + '-01', me = y + '-' + p2(mo) + '-' + p2(new Date(y, mo, 0).getDate());
    const from = ms < first ? first : ms, to = me > last ? last : me;
    const s = computeStats('range:' + from + ':' + to), c = computeStats('range::' + to);
    out.push({ label: MON[mo - 1] + ' ' + String(y).slice(2), sales: s.salesAmtMonth || 0, received: s.receivedMonth || 0,
      purchases: (s.warpCostMonth || 0) + (s.weftCostMonth || 0), expenses: s.bizExpMonth || 0,
      family: s.famExpMonth || 0, personal: s.personalExpMonth || 0, receivables: c.receivable || 0 });
    mo++; if(mo > 12){ mo = 1; y++; }
  }
  out.forEach(r=>{ r.result = r.sales - r.purchases - r.expenses; });
  return out;
}
function fiscalPdf(){
  if(typeof window.jspdf === 'undefined'){ showToast('PDF library is still loading \u2014 try again in a moment.'); return; }
  const sel = fiscalSelected(), r = fiscalReport(sel.from, sel.to), biz = DATA.businessInfo || {};
  const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), m = 48, X2 = W - m;
  const NAVY = [24, 52, 94], INK = [30, 30, 30], SOFT = [110, 110, 110], RED = [176, 42, 42], GREEN = [27, 120, 70], LINE = [200, 205, 215], ZEBRA = [246, 248, 251];
  const R = n => (n < 0 ? '-' : '') + 'Rs ' + Math.abs(Math.round(n || 0)).toLocaleString('en-IN');
  const D = n => (Math.round(n || 0) ? '-' : '') + 'Rs ' + Math.abs(Math.round(n || 0)).toLocaleString('en-IN');   // a deduction, always shown with a minus
  const todayIso = new Date().toISOString().slice(0, 10), pos = sel.to > todayIso ? todayIso : sel.to;
  let y = 46;
  // ---- letterhead (same look as the receipts) ----
  if(typeof BIZ_LOGO_PNG !== 'undefined' && typeof BIZ_LOGO_RATIO !== 'undefined'){
    const lh = 44, lw = lh * BIZ_LOGO_RATIO; doc.addImage(BIZ_LOGO_PNG, 'PNG', (W - lw) / 2, y - 24, lw, lh); y += lh - 4;
  } else { doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...NAVY); doc.text(biz.name || 'Ibrahim Weaving', W / 2, y + 4, { align: 'center' }); y += 22; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...SOFT);
  if(biz.address){ doc.text(biz.address, W / 2, y, { align: 'center' }); y += 13; }
  if(biz.phone){ doc.text('Phone: ' + biz.phone, W / 2, y, { align: 'center' }); y += 13; }
  y += 6; doc.setDrawColor(...NAVY); doc.setLineWidth(1.6); doc.line(m, y, X2, y); doc.setLineWidth(0.4); doc.line(m, y + 3, X2, y + 3); y += 30;
  // ---- title ----
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...NAVY); doc.text('YEAR REPORT', W / 2, y, { align: 'center' }); y += 20;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11.5); doc.setTextColor(...INK); doc.text(sel.label, W / 2, y, { align: 'center' }); y += 15;
  doc.setFontSize(9); doc.setTextColor(...SOFT); doc.text('Prepared on ' + fmtDate(new Date().toISOString().slice(0, 10)), W / 2, y, { align: 'center' }); y += 28;
  // ---- key figures ----
  const kp = [['SALES', R(r.sales), INK], ['PROFIT AFTER DRAWINGS', R(r.profitAfter), r.profitAfter < 0 ? RED : GREEN], ['CLOSING CAPITAL', r.closingCapital === null ? '-' : R(r.closingCapital), NAVY]];
  const cw = (X2 - m) / 3;
  kp.forEach((k, i)=>{
    const cx = m + cw * i + cw / 2;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...SOFT); doc.text(k[0], cx, y, { align: 'center' });
    doc.setFontSize(14); doc.setTextColor(...k[2]); doc.text(k[1], cx, y + 20, { align: 'center' });
    if(i){ doc.setDrawColor(...LINE); doc.line(m + cw * i, y - 8, m + cw * i, y + 28); }
  });
  y += 50;
  // ---- helpers ----
  const heading = t=>{ doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...NAVY); doc.text(t.toUpperCase(), m, y); y += 5; doc.setDrawColor(...NAVY); doc.setLineWidth(0.8); doc.line(m, y, X2, y); doc.setLineWidth(0.4); y += 4; };
  let zi = 0;
  const row = (label, val, o = {})=>{
    const h = o.big ? 24 : 19;
    if(o.rule){ doc.setDrawColor(...INK); doc.setLineWidth(0.8); doc.line(m, y + 2, X2, y + 2); doc.setLineWidth(0.4); y += 2; zi = 0; }
    if(!o.big && !o.rule && zi++ % 2 === 0){ doc.setFillColor(...ZEBRA); doc.rect(m, y, X2 - m, h, 'F'); }
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.big ? 12.5 : 10.5);
    doc.setTextColor(...(o.labelColor || INK)); doc.text(label, m + 8, y + h / 2 + 3.5);
    doc.setTextColor(...(o.color || INK)); doc.text(val, X2 - 8, y + h / 2 + 3.5, { align: 'right' });
    y += h;
  };
  const gap = n=>{ y += n; zi = 0; };
  // ---- profit for the period ----
  heading('Profit for the period');
  row('Sales', R(r.sales), { bold: true });
  row('Business expenses (including wages)', D(r.bizExp), { color: RED });
  row('Warp bought', D(r.warp), { color: RED });
  row('Weft bought', D(r.weft), { color: RED });
  row('Stock change', R(r.stockChange), { color: r.stockChange < 0 ? RED : INK });
  row('Profit before drawings', R(r.profitBefore), { bold: true, rule: true, color: r.profitBefore < 0 ? RED : GREEN });
  gap(8);
  row('Drawings \u2014 family expenses', D(r.drawingsFamily), { color: RED });
  row('Drawings \u2014 personal expenses', D(r.drawingsPersonal), { color: RED });
  row('Total drawings', D(r.drawings), { bold: true, rule: true, color: RED });
  gap(8);
  row('Profit after drawings', R(r.profitAfter), { bold: true, big: true, rule: true, color: r.profitAfter < 0 ? RED : GREEN });
  gap(16);
  // ---- capital ----
  heading('Capital');
  row('Opening capital', r.openingCapital === null ? '-' : R(r.openingCapital));
  row('Add: profit after drawings', R(r.profitAfter), { color: r.profitAfter < 0 ? RED : INK });
  row('Closing capital', r.closingCapital === null ? '-' : R(r.closingCapital), { bold: true, big: true, rule: true, color: NAVY });
  gap(16);
  // ---- position ----
  heading('Financial position as at ' + fmtDate(pos));
  row('Cash and bank', R(r.position.cash));
  row('Receivables (money to receive)', R(r.position.receivables));
  row('Employee loans', R(r.position.empLoans));
  row('Yarn in hand', R(r.position.yarn));
  row('Grey cloth in hand', R(r.position.grey));
  row('Bills due', D(r.position.bills), { color: RED });
  row('Total position', R(r.position.total), { bold: true, big: true, rule: true, color: NAVY });
  gap(14);
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...SOFT);
  doc.text('Personal loans given (' + R(r.position.personalLoans) + ') and fixed assets are not counted in the position.', m, y);
  if(r.notes && r.notes.length){ y += 12; r.notes.forEach(n=>{ doc.text('Note: ' + n, m, y, { maxWidth: X2 - m }); y += 11; }); }
  // ---- monthly comparison (pages 2 and 3) ----
  const months = fiscalMonthly(sel);
  if(months.length >= 2){
    const CH = { sales: NAVY, purchases: [214, 120, 40], expenses: [32, 140, 140], family: [130, 80, 160], personal: [150, 155, 175], received: GREEN };
    const compact = n=>{ const a = Math.abs(n), sg = n < 0 ? '-' : '', t = (v, d)=> String(+v.toFixed(d)); return a >= 1e7 ? sg + t(a / 1e7, 1) + ' Cr' : a >= 1e5 ? sg + t(a / 1e5, 1) + ' L' : a >= 1e3 ? sg + Math.round(a / 1e3) + 'k' : sg + Math.round(a); };
    const nice = v=>{ if(v <= 0) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; };
    const newPage = (title)=>{
      doc.addPage(); y = 48;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...NAVY); doc.text(title, m, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...SOFT); doc.text(sel.label, X2, y, { align: 'right' });
      y += 8; doc.setDrawColor(...NAVY); doc.setLineWidth(1.2); doc.line(m, y, X2, y); doc.setLineWidth(0.4); y += 22;
    };
    // kind: 'bar' (clustered, negatives allowed) or 'line'. series: [{ name, color, vals, colorFn? }]
    const chart = (title, kind, series, plotH)=>{
      const n = months.length, x0 = m + 38, pw = X2 - x0 - 4;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...INK); doc.text(title, m, y);
      let lx = X2; doc.setFontSize(8);
      series.slice().reverse().forEach(se=>{ if(!se.name) return; const tw = doc.getTextWidth(se.name); doc.setFont('helvetica', 'normal'); doc.setTextColor(...SOFT); doc.text(se.name, lx, y, { align: 'right' }); doc.setFillColor(...se.color); doc.rect(lx - tw - 11, y - 6, 7, 7, 'F'); lx -= tw + 22; });
      y += 10;
      const all = [].concat(...series.map(se=> se.vals)), mx = Math.max(0, ...all), mn = Math.min(0, ...all);
      const top = nice(mx || 1), bot = mn < 0 ? -nice(-mn) : 0, span = top - bot, py = v=> y + plotH * (1 - (v - bot) / span);
      const ticks = 4;
      for(let i = 0; i <= ticks; i++){
        const v = bot + span * i / ticks, gy = py(v);
        doc.setDrawColor(...(Math.abs(v) < 1e-9 ? SOFT : [225, 228, 235])); doc.setLineWidth(Math.abs(v) < 1e-9 ? 0.7 : 0.4); doc.line(x0, gy, X2, gy);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...SOFT); doc.text(compact(v), x0 - 4, gy + 2.4, { align: 'right' });
      }
      doc.setLineWidth(0.4);
      const gw = pw / n, step = Math.max(1, Math.ceil(26 / gw));
      if(kind === 'bar'){
        const ns = series.length, bw = Math.min(16, gw * 0.78 / ns), zero = py(0);
        months.forEach((_, i)=>{
          const cx = x0 + gw * (i + 0.5), start = cx - bw * ns / 2;
          series.forEach((se, k)=>{
            const v = se.vals[i]; if(!v) return;
            const c = se.colorFn ? se.colorFn(v) : se.color, yy = py(v);
            doc.setFillColor(...c); doc.rect(start + bw * k, Math.min(yy, zero), bw - 0.6, Math.max(0.6, Math.abs(zero - yy)), 'F');
          });
        });
      } else {
        const se = series[0], pts = se.vals.map((v, i)=> [x0 + gw * (i + 0.5), py(v)]);
        doc.setDrawColor(...se.color); doc.setLineWidth(1.6);
        for(let i = 1; i < pts.length; i++) doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
        doc.setLineWidth(0.4); doc.setFillColor(...se.color);
        pts.forEach((pt, i)=>{
          doc.circle(pt[0], pt[1], 2.1, 'F');
          if(n <= 14 || i % step === 0){ doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); doc.setTextColor(...INK); doc.text(compact(se.vals[i]), pt[0], pt[1] - 5, { align: 'center' }); }
        });
      }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...SOFT);
      months.forEach((mo, i)=>{ if(i % step === 0) doc.text(mo.label, x0 + gw * (i + 0.5), y + plotH + 11, { align: 'center' }); });
      y += plotH + 30;
    };
    const col = k=> months.map(r=> r[k]);
    newPage('Monthly comparison');
    chart('Sales vs purchases (warp + weft)', 'bar', [{ name: 'Sales', color: CH.sales, vals: col('sales') }, { name: 'Purchases', color: CH.purchases, vals: col('purchases') }], 120);
    chart('Where the money went: business expenses, family and personal', 'bar', [{ name: 'Business expenses', color: CH.expenses, vals: col('expenses') }, { name: 'Family', color: CH.family, vals: col('family') }, { name: 'Personal', color: CH.personal, vals: col('personal') }], 120);
    chart('Monthly result (sales less purchases and business expenses)', 'bar', [{ name: '', color: GREEN, vals: col('result'), colorFn: v=> v < 0 ? RED : GREEN }], 120);
    chart('Receivables at month end (money still to receive)', 'line', [{ name: 'Receivables', color: NAVY, vals: col('receivables') }], 120);
    // table
    newPage('Month by month');
    const cols = [['Month', 'l', 0.10], ['Sales', 'r', 0.14], ['Received', 'r', 0.14], ['Purchases', 'r', 0.14], ['Expenses', 'r', 0.13], ['Family', 'r', 0.11], ['Personal', 'r', 0.10], ['Receivables', 'r', 0.14]];
    const tw = X2 - m; let cx = m; const cpos = cols.map(c=>{ const o = { x: cx, w: tw * c[2], a: c[1] }; cx += o.w; return o; });
    const cell = (i, t, bold)=>{ const c = cpos[i]; doc.setFont('helvetica', bold ? 'bold' : 'normal'); if(c.a === 'r') doc.text(t, c.x + c.w - 6, y, { align: 'right' }); else doc.text(t, c.x + 6, y); };
    const head = ()=>{ doc.setFillColor(...NAVY); doc.rect(m, y - 12, tw, 19, 'F'); doc.setFontSize(8); doc.setTextColor(255, 255, 255); cols.forEach((c, i)=> cell(i, c[0], true)); y += 20; };
    const num = n=> Math.round(n || 0).toLocaleString('en-IN');
    head(); doc.setFontSize(8);
    months.forEach((r, i)=>{
      if(y > H - 80){ doc.addPage(); y = 56; head(); }
      if(i % 2 === 0){ doc.setFillColor(...ZEBRA); doc.rect(m, y - 11, tw, 17, 'F'); }
      doc.setFontSize(8); doc.setTextColor(...INK);
      cell(0, r.label, true); cell(1, num(r.sales)); cell(2, num(r.received)); cell(3, num(r.purchases)); cell(4, num(r.expenses)); cell(5, num(r.family)); cell(6, num(r.personal)); cell(7, num(r.receivables));
      y += 17;
    });
    const sum = k=> months.reduce((t, r)=> t + (r[k] || 0), 0);
    y += 3; doc.setDrawColor(...INK); doc.setLineWidth(0.8); doc.line(m, y - 11, X2, y - 11); doc.setLineWidth(0.4);
    doc.setFontSize(8.5); doc.setTextColor(...NAVY);
    cell(0, 'Total', true); cell(1, num(sum('sales')), true); cell(2, num(sum('received')), true); cell(3, num(sum('purchases')), true); cell(4, num(sum('expenses')), true); cell(5, num(sum('family')), true); cell(6, num(sum('personal')), true); cell(7, num(months[months.length - 1].receivables), true);
    y += 16; doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...SOFT);
    doc.text('All amounts in Rs. Purchases = warp + weft bought. Receivables = closing balance of the last month. Expenses include wages.', m, y);
  }
  // ---- footer on every page ----
  const pages = doc.getNumberOfPages();
  for(let i = 1; i <= pages; i++){
    doc.setPage(i); doc.setDrawColor(...LINE); doc.line(m, H - 40, X2, H - 40);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...SOFT);
    doc.text((biz.name || 'Ibrahim Weaving') + ' \u2014 Year Report \u2014 ' + sel.label, m, H - 27); doc.text('Page ' + i + ' of ' + pages, X2, H - 27, { align: 'right' });
  }
  doc.save('Year-Report-' + sel.label.replace(/[^A-Za-z0-9]+/g, '-') + '.pdf');
}
