/* Money calculations and other pure logic: wages and rate history, shortfall shares, receivables,
 * cheques, client statement, Overview figures (Receivable, Cash Position), loans.
 *
 * Everything here only READS the global DATA object and returns numbers/lists. Nothing touches the
 * page, so the automated tests (tests/) load this exact file and run it in Node. Keep it that way:
 * no document/window/DOM code in this file. Page code in the other files calls these functions.
 * Needs from elsewhere (defined in core.js / panels): todayStr, fmtQtyMtr, recoveryDescription.
 */

// Combine a record's date + optional time into a comparable Date. Records saved
// before the time field existed have no r.time and default to 00:00, preserving
// their prior ordering relative to same-day entries that do have a time.
const dtOf = (r) => new Date(r.date+'T'+(r.time||'00:00')+':00Z');

// Every rate change for a quality is kept (effective-from date + rate) instead of
// overwriting a single flat value, so past wages stay locked to whatever rate actually
// applied back then — only production dated on/after a new entry's effective date sees it.
function sortedRateHistory(qualityName){
  const hist = (DATA.wageRateHistory && DATA.wageRateHistory[qualityName]) || [];
  return hist.slice().sort((a,b)=> a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

// The rate in effect for a quality on a given date: the most recent entry on or before that
// date, or the earliest entry if the date predates all of them (so old, pre-history
// production still gets a sane rate instead of 0). 0 if the quality has no rate set at all.
function rateForQualityOn(qualityName, dateStr){
  const sorted = sortedRateHistory(qualityName);
  if(!sorted.length) return 0;
  let applicable = sorted[0];
  for(const entry of sorted){ if(entry.date <= dateStr) applicable = entry; else break; }
  return Number(applicable.rate)||0;
}

// The latest (current, "as of today") rate for a quality — what the Wages page shows as the
// quality's rate right now.
function currentRateForQuality(qualityName){
  const sorted = sortedRateHistory(qualityName);
  return sorted.length ? Number(sorted[sorted.length-1].rate)||0 : 0;
}

// For each employee+quality: meters = their own logged meters, plus their equal share of
// the per-entry Difference (Qty Produced - sum of all logged employee meters on that
// entry) — split evenly across however many employees (1, 2, or 3) are logged on it.
// Wages are accumulated per production entry using the rate that was actually in effect on
// that entry's own date, rather than one flat rate applied to the whole period.
function computeWageMeters(empName, qualityName, fromDate, toDate){
  let own = 0, diffShare = 0, ownWages = 0, diffWages = 0;
  DATA.production.forEach(r=>{
    if(!r.date) return;
    if(fromDate && r.date < fromDate) return;
    if(toDate && r.date > toDate) return;
    if(r.quality !== qualityName) return;
    const rate = rateForQualityOn(qualityName, r.date);
    const diff = (r.qty||0) - ((r.e1m||0)+(r.e2m||0)+(r.e3m||0));
    const empCount = [r.e1,r.e2,r.e3].filter(Boolean).length || 1;
    const diffPortion = diff / empCount;
    if(r.e1 === empName){ own += (r.e1m||0); diffShare += diffPortion; ownWages += (r.e1m||0)*rate; diffWages += diffPortion*rate; }
    if(r.e2 === empName){ own += (r.e2m||0); diffShare += diffPortion; ownWages += (r.e2m||0)*rate; diffWages += diffPortion*rate; }
    if(r.e3 === empName){ own += (r.e3m||0); diffShare += diffPortion; ownWages += (r.e3m||0)*rate; diffWages += diffPortion*rate; }
  });
  return {own, diffShare, total: own+diffShare, wages: ownWages+diffWages, diffWages};
}

function computeWages(fromDate, toDate){
  // Inactive employees drop off this table once they have nothing left to show for the
  // selected period — but stay visible if they still have real meters/wages/bonus in it,
  // so past earnings never silently disappear just because someone's since left.
  const relevantEmployees = DATA.employees.filter(emp=>{
    if(emp.active !== false) return true;
    const hasMeters = DATA.qualities.some(q => computeWageMeters(emp.name, q.name, fromDate, toDate).total !== 0);
    const hasBonus = DATA.wageBonuses.some(b=>b.employee===emp.name && (!fromDate||b.date>=fromDate) && (!toDate||b.date<=toDate));
    return hasMeters || hasBonus;
  });
  return relevantEmployees.map(emp=>{
    const byQuality = DATA.qualities.map(q=>{
      const {diffShare, total, wages, diffWages} = computeWageMeters(emp.name, q.name, fromDate, toDate);
      return {quality:q.name, meters: total, diffMeters: diffShare, wages, diffWages};
    });
    const totalMeters = byQuality.reduce((s,x)=>s+x.meters,0);
    const totalDiffMeters = byQuality.reduce((s,x)=>s+x.diffMeters,0);
    const totalDiffWages = byQuality.reduce((s,x)=>s+x.diffWages,0);
    const totalWagesNoBonus = byQuality.reduce((s,x)=>s+x.wages,0);
    const bonus = DATA.wageBonuses
      .filter(b=>b.employee===emp.name && (!fromDate||b.date>=fromDate) && (!toDate||b.date<=toDate))
      .reduce((s,b)=>s+(Number(b.amount)||0),0);
    const totalWages = totalWagesNoBonus + bonus;
    return {employee:emp.name, byQuality, totalMeters, totalDiffMeters, totalDiffWages, bonus, totalWagesNoBonus, totalWages};
  });
}

// Returns the date string one day after the given YYYY-MM-DD date.
function nextDayStr(dateStr){
  const d = new Date(dateStr+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+1);
  return d.toISOString().slice(0,10);
}

// Running wage balance for one employee, since their last "settled" mark (or all-time if
// never settled). Owed = wages earned (meters×rate + diff share + dated bonuses) in that
// window. Paid = cash handed over via Wage Payments in that window. A settlement carries
// forward whatever balance was agreed at the time (0 for a full settlement, or a partial
// amount if some of it was deliberately left outstanding). Employee loans (money advanced
// to them separate from wages) live in their own ledger — see computeEmployeeLoanBalance.
function computeEmployeeWageBalance(empName){
  const settlements = DATA.wageSettlements.filter(s=>s.employee===empName).slice().sort((a,b)=> dtOf(b)-dtOf(a));
  const lastSettlement = settlements[0] || null;
  const sinceDate = lastSettlement ? lastSettlement.date : null;
  const carryForward = lastSettlement ? Number(lastSettlement.carryForward||0) : 0;
  const wageFromDate = sinceDate ? nextDayStr(sinceDate) : null;
  let earned = 0;
  DATA.qualities.forEach(q=>{
    earned += computeWageMeters(empName, q.name, wageFromDate, null).wages;
  });
  const bonus = DATA.wageBonuses
    .filter(b=>b.employee===empName && (!sinceDate || b.date > sinceDate))
    .reduce((s,b)=>s+(Number(b.amount)||0),0);
  const paymentsSince = DATA.wagePayments.filter(p=>p.employee===empName && (!sinceDate || p.date > sinceDate));
  const paid = paymentsSince.reduce((s,p)=>s+(Number(p.amount)||0),0);
  const owed = earned + bonus;
  return {owed, paid, carryForward, balance: carryForward + owed - paid, lastSettled: lastSettlement ? lastSettlement.date : null};
}

// Running loan balance for one employee — completely separate from wages/bonuses. Loan
// Given increases what they owe back; Loan Repaid reduces it. All-time running total, no
// settlement concept (that's specific to the wages ledger).
function computeEmployeeLoanBalance(empName){
  const entries = DATA.loanPayments.filter(p=>p.employee===empName);
  const given = entries.filter(p=>p.type !== 'Loan Repaid').reduce((s,p)=>s+(Number(p.amount)||0),0);
  const repaid = entries.filter(p=>p.type === 'Loan Repaid').reduce((s,p)=>s+(Number(p.amount)||0),0);
  return {given, repaid, balance: given - repaid};
}

// Wages+bonus earned by one employee within a specific date range — this is what the
// Wage Period filter at the top of the page shows, and what Log Wage Payment should
// suggest, as opposed to computeEmployeeWageBalance's "since last settlement" window.
function computeEmployeeWagesForPeriod(empName, fromDate, toDate){
  let earned = 0;
  DATA.qualities.forEach(q=>{
    earned += computeWageMeters(empName, q.name, fromDate, toDate).wages;
  });
  const bonus = DATA.wageBonuses
    .filter(b=>b.employee===empName && (!fromDate||b.date>=fromDate) && (!toDate||b.date<=toDate))
    .reduce((s,b)=>s+(Number(b.amount)||0),0);
  return earned + bonus;
}

// Inactive employees drop off Wages-page tables once fully settled (balance and carry
// forward both zero) — but stay visible as long as something's still unresolved, so a
// real outstanding balance never quietly disappears just because someone left.
function wageRelevantEmployees(){
  return DATA.employees.filter(emp=>{
    if(emp.active !== false) return true;
    const b = computeEmployeeWageBalance(emp.name);
    return Math.abs(b.balance) > 0.004 || Math.abs(b.carryForward) > 0.004;
  });
}

// Inactive employees drop off the Loans tab once their loan balance is fully cleared — but
// stay visible as long as something's still outstanding, mirroring wageRelevantEmployees.
function loanRelevantEmployees(){
  return DATA.employees.filter(emp=>{
    if(emp.active !== false) return true;
    const b = computeEmployeeLoanBalance(emp.name);
    return Math.abs(b.balance) > 0.004;
  });
}

// Normalizes a Recovery record into {cashAmount, bankAmount, cheques} regardless of shape —
// new entries store all three side by side (a single payment can genuinely be part cash,
// part bank transfer, part cheques, all at once); older entries only ever had one exclusive
// `method` field, so this maps those into the same shape for every calculation to share.
function recoveryParts(r){
  if(r.cashAmount != null || r.bankAmount != null){
    return {cashAmount: Number(r.cashAmount)||0, bankAmount: Number(r.bankAmount)||0, cheques: r.cheques||[]};
  }
  if(r.method === 'Cheque') return {cashAmount:0, bankAmount:0, cheques:r.cheques||[]};
  if(r.method === 'Bank Transfer') return {cashAmount:0, bankAmount:Number(r.amount)||0, cheques:[]};
  return {cashAmount:Number(r.amount)||0, bankAmount:0, cheques:[]}; // default: Cash, or no method at all
}

// A recovery record's amount that counts toward Cash Position: Cash + Bank Transfer
// portions count immediately; cheques only count individually once Cleared — other
// cheques from the same payment may still be Pending/Bounced independently.
function recoveryCashAmount(r){
  const {cashAmount, bankAmount, cheques} = recoveryParts(r);
  return cashAmount + bankAmount + cheques.filter(c=>c.status==='Cleared').reduce((s,c)=>s+(Number(c.amount)||0),0);
}

// A recovery record's amount that counts toward Receivable: everything except individual
// Bounced or Replaced cheques — a Pending cheque still counts as settling the debt (the
// client handed over a negotiable instrument), a Bounced one means they never actually
// paid, and Replaced means it bounced and was substituted with a different payment (logged
// as its own separate recovery entry), so it never turned into money either.
function recoveryReceivableAmount(r){
  const {cashAmount, bankAmount, cheques} = recoveryParts(r);
  return cashAmount + bankAmount + cheques.filter(c=>c.status!=='Bounced' && c.status!=='Replaced').reduce((s,c)=>s+(Number(c.amount)||0),0);
}

// A recovery record's amount tied up in cheques that have actually Bounced (not yet marked
// Replaced). This money was never received, but it's also being pulled out of the everyday
// Receivable figure — a bounced cheque is a collections problem, not a normal outstanding
// invoice — so it's tracked in its own bucket instead of quietly inflating Receivable.
function recoveryBouncedAmount(r){
  const {cheques} = recoveryParts(r);
  return cheques.filter(c=>c.status==='Bounced').reduce((s,c)=>s+(Number(c.amount)||0),0);
}

// Same as recoveryReceivableAmount but at face value — every cheque counts as paid the
// moment it's recorded, regardless of whether it later cleared or bounced. Used only for the
// "before last sale" checkpoint below, which is meant to stay frozen as of when that sale was
// entered rather than move around every time a cheque's status changes afterward.
function recoveryFaceAmount(r){
  const {cashAmount, bankAmount, cheques} = recoveryParts(r);
  return cashAmount + bankAmount + cheques.reduce((s,c)=>s+(Number(c.amount)||0),0);
}

// A client's receivable balance right before their most recent sale was entered — i.e. sum
// of all their earlier sales minus everything received from them up to that sale's date.
// Sale entries don't carry a time (only a date), so this compares by calendar date, not
// exact instant: a recovery dated the same day as the last sale still counts as prior — it's
// far more likely to represent money received before that sale than after it. Ties between
// several sales on the exact same date are broken by id so the "last" one is picked
// consistently. This is a frozen checkpoint at face value: cheques count as paid as of the
// date they were recorded, and a later bounce does NOT change this figure — it only affects
// the overall (live) Receivable total elsewhere, not this snapshot.
function receivableBeforeLastSale(clientName){
  const sales = DATA.sale.filter(s=>s.client===clientName).slice()
    .sort((a,b)=> a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  if(!sales.length) return null;
  const lastSale = sales[sales.length-1];
  const cutoffDate = lastSale.date;
  const priorSales = sales.slice(0,-1).reduce((s,x)=>s+(Number(x.amount)||0),0);
  const priorReceived = DATA.recovery.filter(r=>r.client===clientName && r.date <= cutoffDate)
    .reduce((s,r)=>s+recoveryFaceAmount(r),0);
  return {amount: priorSales - priorReceived, lastSaleDate: lastSale.date};
}

// Receivable aging, always as of today — not tied to the Overview's month/year filter, same
// as Pending Cheques on Recovery isn't. Payments aren't itemized against specific sales, so
// this allocates each client's cumulative received amount against their sales oldest-first
// (standard FIFO aging): the oldest sale is paid off first, then the next, and so on, until
// the payment pool runs out — whatever's left unpaid, sale by sale, is what's "outstanding"
// and gets aged from that sale's own date. This mirrors how trade credit actually gets settled.
function computeReceivablesAging(){
  const todayD = new Date(todayStr()+'T00:00:00Z');
  const clientNames = orderedGroupNames(DATA.clients.map(c=>c.name), [DATA.sale,'client'], [DATA.recovery,'client']);
  const rows = clientNames.map(name=>{
    const sales = DATA.sale.filter(s=>s.client===name).slice().sort((a,b)=> a.date.localeCompare(b.date));
    let pool = DATA.recovery.filter(r=>r.client===name).reduce((s,r)=>s+recoveryReceivableAmount(r),0);
    const outstanding = [];
    sales.forEach(s=>{
      const amt = Number(s.amount)||0;
      if(pool >= amt){ pool -= amt; return; }
      outstanding.push({date:s.date, amount: amt - pool});
      pool = 0;
    });
    const totalReceivable = outstanding.reduce((s,o)=>s+o.amount,0);
    const oldestDate = outstanding.length ? outstanding[0].date : null;
    const daysOutstanding = oldestDate ? Math.round((todayD - new Date(oldestDate+'T00:00:00Z'))/86400000) : 0;
    const buckets = {d0_30:0, d31_60:0, d61_90:0, d90plus:0};
    outstanding.forEach(o=>{
      const days = Math.round((todayD - new Date(o.date+'T00:00:00Z'))/86400000);
      if(days<=30) buckets.d0_30 += o.amount;
      else if(days<=60) buckets.d31_60 += o.amount;
      else if(days<=90) buckets.d61_90 += o.amount;
      else buckets.d90plus += o.amount;
    });
    return {name, totalReceivable, oldestDate, daysOutstanding, buckets};
  }).filter(r=> r.totalReceivable > 0.004);
  rows.sort((a,b)=> b.daysOutstanding - a.daysOutstanding);
  const totals = rows.reduce((acc,r)=>{
    acc.d0_30 += r.buckets.d0_30; acc.d31_60 += r.buckets.d31_60;
    acc.d61_90 += r.buckets.d61_90; acc.d90plus += r.buckets.d90plus;
    return acc;
  }, {d0_30:0, d31_60:0, d61_90:0, d90plus:0});
  return {rows, totals};
}

// Cheque cards moved to Overview (below Stock Position) — these compute the underlying
// data; renderStats() builds the actual card HTML. Kept as standalone functions so the
// same live-updating cheque data can be reused wherever it's needed.
function computePendingCheques(){
  const pendingCheques = [];
  DATA.recovery.forEach(r=>{
    (recoveryParts(r).cheques).forEach(c=>{
      if(c.status === 'Pending') pendingCheques.push({...c, date:r.date, client:r.client, recoveryId:r.id});
    });
  });
  pendingCheques.sort((a,b)=> new Date((a.chequeDate||a.date)+'T00:00:00Z') - new Date((b.chequeDate||b.date)+'T00:00:00Z'));
  return pendingCheques;
}

function computeBouncedCheques(){
  const bouncedCheques = [];
  DATA.recovery.forEach(r=>{
    (recoveryParts(r).cheques).forEach(c=>{
      if(c.status === 'Bounced') bouncedCheques.push({...c, date:r.date, client:r.client, recoveryId:r.id});
    });
  });
  bouncedCheques.sort((a,b)=> new Date(b.date+'T00:00:00Z') - new Date(a.date+'T00:00:00Z'));
  return bouncedCheques;
}

// "100-12 mtr @ Rs 350.00" — the quantity and rate of one Sale line on a Client Statement, so
// whoever reads the statement can check qty x rate = the Debit (the amount itself is rounded
// DOWN to whole rupees when a sale is saved, so it can sit up to Rs 1 under the exact product).
// Rate follows the Sales table / receipts: the stored rate, or amount / qty for old entries
// that never had one. A stored rate with more than 2 decimals (e.g. 87.125) is shown in full so
// the arithmetic still works; a derived rate is only an approximation, so it stays at 2.
function saleQtyRateText(s){
  const qty = Number(s.qty)||0;
  const parts = [];
  if(qty) parts.push(`${fmtQtyMtr(qty)} mtr`);
  let rateTxt = '';
  if(Number(s.rate)){
    const r = Number(s.rate);
    const needsMore = Math.abs(r*100 - Math.round(r*100)) > 1e-6;
    rateTxt = 'Rs ' + r.toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits: needsMore ? 4 : 2});
  } else if(qty){
    rateTxt = fmtRs2((Number(s.amount)||0)/qty);
  }
  // Non-breaking spaces keep "@ Rs 350.00" together when the Details column wraps.
  if(rateTxt) parts.push((qty ? `@ ${rateTxt}` : `Rate ${rateTxt}`).replace(/ /g, '\u00a0'));
  return parts.join(' ');
}

// Builds one client's running ledger (every Sale = debit, every Payment = credit, using
// recoveryReceivableAmount so bounced/replaced cheques don't count as paid) across an
// optional date range. Entries strictly before `fromDate` are folded into an Opening
// Balance instead of listed individually. Returns null for a client with no history at all.
function buildClientLedger(clientName, fromDate, toDate){
  if(!clientName) return null;
  const entries = [];
  DATA.sale.filter(s=>s.client===clientName).forEach(s=> entries.push({
    date:s.date, id:s.id, debit:Number(s.amount)||0, credit:0,
    detail:`Sale — ${[s.quality, saleQtyRateText(s)].filter(Boolean).join(', ')}`
  }));
  DATA.recovery.filter(r=>r.client===clientName).forEach(r=> entries.push({
    date:r.date, id:r.id, debit:0, credit:recoveryReceivableAmount(r),
    detail:`Payment — ${recoveryDescription(r)}`
  }));
  if(!entries.length) return null;
  entries.sort((a,b)=> a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  let openingBalance = 0;
  entries.filter(e=> fromDate && e.date < fromDate).forEach(e=> openingBalance += e.debit - e.credit);
  const inRange = entries.filter(e=> (!fromDate || e.date>=fromDate) && (!toDate || e.date<=toDate));
  let running = openingBalance;
  const rows = inRange.map(e=>{ running += e.debit - e.credit; return {...e, balance:running}; });
  // Business done with the client inside the chosen period: everything sold, everything paid.
  const totalSales = rows.reduce((t,r)=> t + r.debit, 0);
  const totalPayments = rows.reduce((t,r)=> t + r.credit, 0);
  return {rows, openingBalance, closingBalance:running, hasOpening: !!fromDate, totalSales, totalPayments};
}

// The loom that follows `loomName` in the Looms list (Settings order, which can be arranged to
// match the register), or null when it is the last loom, isn't in the list, or none is picked.
// Used by the "Add & next loom" button on Log Production.
function nextLoomAfter(loomName){
  const idx = DATA.looms.findIndex(l=>l.name===loomName);
  if(!loomName || idx === -1 || idx >= DATA.looms.length-1) return null;
  return DATA.looms[idx+1].name;
}

function periodBounds(monthVal){
  if(!monthVal) return {start:null, end:null};
  if(monthVal.startsWith('range:')){
    const [, from, to] = monthVal.split(':');
    return {
      start: from ? new Date(from+'T00:00:00Z') : null,
      end: to ? new Date(to+'T00:00:00Z') : null,
    };
  }
  if(monthVal.length === 4){ // year only, e.g. "2026"
    const y = Number(monthVal);
    const start = new Date(Date.UTC(y, 0, 1));
    const end = new Date(Date.UTC(y, 12, 0));
    return {start, end};
  }
  const [y,m] = monthVal.split('-').map(Number);
  const start = new Date(Date.UTC(y, m-1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return {start, end};
}

function sumWhere(arr, field, start, end, lowerExclusiveDate){
  return arr.reduce((s,r)=>{
    // Period boundaries (start/end) are whole-day cutoffs, so compare by date only.
    const d = new Date(r.date+'T00:00:00Z');
    // The checkpoint cutoff carries a time-of-day, so compare with the entry's own
    // date+time — same-day entries logged after the checkpoint's time are included,
    // ones logged before it are excluded.
    if(lowerExclusiveDate && !(dtOf(r) > lowerExclusiveDate)) return s;
    if(start && d < start) return s;
    if(end && d > end) return s;
    return s + (Number(r[field])||0);
  },0);
}

// Counts entries within a date range (used e.g. for "number of records" style stats).
function countWhere(arr, start, end){
  return arr.reduce((s,r)=>{
    const d = new Date(r.date+'T00:00:00Z');
    if(start && d < start) return s;
    if(end && d > end) return s;
    return s + 1;
  },0);
}

// Same shape as sumWhere/sumWhereBy but sums a per-record derived amount (via amountFn)
// instead of a flat field name — needed since a Recovery record's effective amount depends
// on its cheques' individual statuses, not just one field.
function sumRecoveryAmount(arr, amountFn, start, end, lowerExclusiveDate){
  return arr.reduce((s,r)=>{
    const d = new Date(r.date+'T00:00:00Z');
    if(lowerExclusiveDate && !(dtOf(r) > lowerExclusiveDate)) return s;
    if(start && d < start) return s;
    if(end && d > end) return s;
    return s + amountFn(r);
  },0);
}

function sumRecoveryByClient(arr, amountFn, start, end){
  const map = {};
  arr.forEach(r=>{
    const d = new Date(r.date+'T00:00:00Z');
    if(start && d < start) return;
    if(end && d > end) return;
    const g = r.client || '—';
    map[g] = (map[g]||0) + amountFn(r);
  });
  return map;
}

function sumWhereBy(arr, groupField, valueField, start, end, lowerExclusiveDate){
  const map = {};
  arr.forEach(r=>{
    const d = new Date(r.date+'T00:00:00Z');
    if(lowerExclusiveDate && !(d > lowerExclusiveDate)) return;
    if(start && d < start) return;
    if(end && d > end) return;
    const g = r[groupField] || '—';
    map[g] = (map[g]||0) + (Number(r[valueField])||0);
  });
  return map;
}

// Same as sumWhereBy but groups by two fields at once, e.g. client -> quality -> qty.
function sumWhereBy2(arr, group1Field, group2Field, valueField, start, end){
  const map = {};
  arr.forEach(r=>{
    const d = new Date(r.date+'T00:00:00Z');
    if(start && d < start) return;
    if(end && d > end) return;
    const g1 = r[group1Field] || '—', g2 = r[group2Field] || '—';
    map[g1] = map[g1] || {};
    map[g1][g2] = (map[g1][g2]||0) + (Number(r[valueField])||0);
  });
  return map;
}

function orderedGroupNames(listNames, ...arraysWithField){
  const seen = new Set();
  const ordered = [];
  listNames.forEach(n=>{ if(!seen.has(n)){ seen.add(n); ordered.push(n); } });
  arraysWithField.forEach(([arr,field])=>{
    arr.forEach(r=>{
      const n = r[field];
      if(n && !seen.has(n)){ seen.add(n); ordered.push(n); }
    });
  });
  return ordered;
}

function computeStats(monthVal){
  const {start,end} = periodBounds(monthVal); // end = cumulative cutoff; start/end together = this-month flow
  const cumEnd = end; // null means no cap -> all time

  const producedCum = sumWhere(DATA.production,'qty',null,cumEnd);
  const producedMonth = start ? sumWhere(DATA.production,'qty',start,end) : producedCum;

  const soldCum = sumWhere(DATA.sale,'qty',null,cumEnd);
  const soldMonth = start ? sumWhere(DATA.sale,'qty',start,end) : soldCum;

  const salesAmtCum = sumWhere(DATA.sale,'amount',null,cumEnd);
  const salesAmtMonth = start ? sumWhere(DATA.sale,'amount',start,end) : salesAmtCum;

  // Cheque handling: a Bounced cheque was never really paid, so it's excluded everywhere.
  // A Pending cheque counts toward what a client has settled (Receivable) since they've
  // handed over a negotiable instrument — but NOT toward actual Cash Position until it
  // clears. Cash/Bank Transfer count immediately in both. This works per-cheque, so a
  // payment with several cheques can have some cleared and others still pending at once.
  const receivedCum = sumRecoveryAmount(DATA.recovery, recoveryReceivableAmount, null, cumEnd);
  const receivedMonth = start ? sumRecoveryAmount(DATA.recovery, recoveryReceivableAmount, start, end) : receivedCum;
  const receivedCashCum = sumRecoveryAmount(DATA.recovery, recoveryCashAmount, null, cumEnd);
  // Bounced cheques are carved out of Receivable entirely (see recoveryBouncedAmount) rather
  // than left sitting inside it, so the headline Receivable figure only reflects normal
  // outstanding sales — not money stuck in a bounced-cheque dispute.
  const bouncedCum = sumRecoveryAmount(DATA.recovery, recoveryBouncedAmount, null, cumEnd);

  // Wage Payments are real cash out, so they fold directly into Business Expenses. Bonuses
  // alone never move cash — they're only realized once paid out via a Wage Payment, which
  // already includes them in its amount.
  const wagesPaidCum = sumWhere(DATA.wagePayments,'amount',null,cumEnd);
  const wagesPaidMonth = start ? sumWhere(DATA.wagePayments,'amount',start,end) : wagesPaidCum;

  // Employee loans are real cash movements too, but NOT a business expense — a loan given
  // converts cash into a receivable (an employee owes it back), it doesn't get spent, so
  // it's kept out of Business Expenses / Profit-Loss and only affects Cash Position.
  const loanGivenCum = sumWhere(DATA.loanPayments.filter(p=>p.type!=='Loan Repaid'),'amount',null,cumEnd);
  const loanGivenMonth = start ? sumWhere(DATA.loanPayments.filter(p=>p.type!=='Loan Repaid'),'amount',start,end) : loanGivenCum;
  const loanRepaidCum = sumWhere(DATA.loanPayments.filter(p=>p.type==='Loan Repaid'),'amount',null,cumEnd);
  const loanRepaidMonth = start ? sumWhere(DATA.loanPayments.filter(p=>p.type==='Loan Repaid'),'amount',start,end) : loanRepaidCum;

  const bizExpCum = sumWhere(DATA.expense,'amount',null,cumEnd) + wagesPaidCum;
  const bizExpMonth = (start ? sumWhere(DATA.expense,'amount',start,end) : sumWhere(DATA.expense,'amount',null,cumEnd)) + wagesPaidMonth;

  const famExpCum = sumWhere(DATA.family,'amount',null,cumEnd);
  const famExpMonth = start ? sumWhere(DATA.family,'amount',start,end) : famExpCum;

  const warpCostCum = sumWhere(DATA.warp,'amount',null,cumEnd);
  const warpCostMonth = start ? sumWhere(DATA.warp,'amount',start,end) : warpCostCum;
  const warpSetsCum = countWhere(DATA.warp,null,cumEnd);
  const warpSetsMonth = start ? countWhere(DATA.warp,start,end) : warpSetsCum;

  const weftCostCum = sumWhere(DATA.weft,'amount',null,cumEnd);
  const weftCostMonth = start ? sumWhere(DATA.weft,'amount',start,end) : weftCostCum;
  const weftBagsCum = sumWhere(DATA.weft,'bags',null,cumEnd);
  const weftBagsMonth = start ? sumWhere(DATA.weft,'bags',start,end) : weftBagsCum;

  const receivable = salesAmtCum - receivedCum - bouncedCum;
  const stock = producedCum - soldCum;
  const profitCum = salesAmtCum - (bizExpCum+famExpCum+warpCostCum+weftCostCum);
  const profitMonth = salesAmtMonth - (bizExpMonth+famExpMonth+warpCostMonth+weftCostMonth);

  // Stock breakdown by quality (always cumulative to period end, like overall stock)
  const producedByQ = sumWhereBy(DATA.production,'quality','qty',null,cumEnd);
  const soldByQ = sumWhereBy(DATA.sale,'quality','qty',null,cumEnd);
  const qualityNames = orderedGroupNames(DATA.qualities.map(q=>q.name), [DATA.production,'quality'], [DATA.sale,'quality']);
  const stockByQuality = qualityNames.map(name=>{
    const produced = producedByQ[name]||0, sold = soldByQ[name]||0;
    return {name, produced, sold, stock: produced-sold};
  }).filter(r=> r.produced || r.sold);

  // Sales & receivables breakdown by client
  const salesByC = sumWhereBy(DATA.sale,'client','amount',null,cumEnd);
  const salesByCMonth = start ? sumWhereBy(DATA.sale,'client','amount',start,end) : salesByC;
  const receivedByC = sumRecoveryByClient(DATA.recovery, recoveryReceivableAmount, null, cumEnd);
  const receivedByCMonth = start ? sumRecoveryByClient(DATA.recovery, recoveryReceivableAmount, start, end) : receivedByC;
  const bouncedByC = sumRecoveryByClient(DATA.recovery, recoveryBouncedAmount, null, cumEnd);
  const bouncedByCMonth = start ? sumRecoveryByClient(DATA.recovery, recoveryBouncedAmount, start, end) : bouncedByC;
  const clientNames = orderedGroupNames(DATA.clients.map(c=>c.name), [DATA.sale,'client'], [DATA.recovery,'client']);
  const receivablesByClient = clientNames.map(name=>{
    const sales = salesByC[name]||0, salesShown = monthVal ? (salesByCMonth[name]||0) : sales;
    const received = receivedByC[name]||0, receivedShown = monthVal ? (receivedByCMonth[name]||0) : received;
    const bounced = bouncedByC[name]||0, bouncedShown = monthVal ? (bouncedByCMonth[name]||0) : bounced;
    // Bounced amounts are pulled out here too, so a client's Receivable only reflects normal
    // outstanding sales — the bounced portion is reported in its own column instead. Like sales
    // and received above, this is the running balance up to the end of the period, so it uses
    // ALL bounced cheques so far (bounced), not just the ones from the selected period
    // (bouncedShown, which is only what the Bounced column displays). Using bouncedShown here
    // made these rows stop adding up to the headline Receivable whenever a cheque had bounced
    // before the selected month.
    const receivableC = sales - received - bounced;
    const beforeLastSale = receivableBeforeLastSale(name);
    return {name, sales: salesShown, received: receivedShown, bounced: bouncedShown, receivable: receivableC, beforeLastSale};
  }).filter(r=> r.sales || r.received || r.receivable || r.bounced);

  // Client x Quality breakdown — quantity (mtr) sold to each client, split by quality
  const salesByClientQtyCum = sumWhereBy2(DATA.sale,'client','quality','qty',null,cumEnd);
  const salesByClientQtyMonth = start ? sumWhereBy2(DATA.sale,'client','quality','qty',start,end) : salesByClientQtyCum;
  const clientQualityBreakdown = clientNames.map(name=>{
    const byQMap = (monthVal ? salesByClientQtyMonth : salesByClientQtyCum)[name] || {};
    const byQuality = qualityNames.map(q=>({quality:q, qty: byQMap[q]||0}));
    const total = byQuality.reduce((s,x)=>s+x.qty,0);
    return {name, byQuality, total};
  }).filter(r=> r.total > 0);

  // Cash position: find latest checkpoint on/before cumEnd (compared at day granularity,
  // since cumEnd itself has no time-of-day — a checkpoint dated on cumEnd's day still counts)
  let checkpoint = null;
  const eligible = DATA.checkpoints.filter(c => !cumEnd || new Date(c.date+'T00:00:00Z') <= cumEnd);
  if(eligible.length){
    checkpoint = eligible.reduce((a,b)=> dtOf(a) > dtOf(b) ? a : b);
  }
  let cash;
  if(checkpoint){
    // Compare with full date+time so same-day entries logged after the checkpoint's
    // time are correctly included, and ones logged before it are correctly excluded.
    const cpDateTime = dtOf(checkpoint);
    cash = Number(checkpoint.balance||0)
      + sumRecoveryAmount(DATA.recovery, recoveryCashAmount, null, cumEnd, cpDateTime)
      + sumWhere(DATA.loanPayments.filter(p=>p.type==='Loan Repaid'),'amount',null,cumEnd,cpDateTime)
      - sumWhere(DATA.expense,'amount',null,cumEnd,cpDateTime)
      - sumWhere(DATA.wagePayments,'amount',null,cumEnd,cpDateTime)
      - sumWhere(DATA.loanPayments.filter(p=>p.type!=='Loan Repaid'),'amount',null,cumEnd,cpDateTime)
      - sumWhere(DATA.family,'amount',null,cumEnd,cpDateTime)
      - sumWhere(DATA.warp,'amount',null,cumEnd,cpDateTime)
      - sumWhere(DATA.weft,'amount',null,cumEnd,cpDateTime);
  } else {
    cash = Number(DATA.openingBalance||0) + receivedCashCum + loanRepaidCum - loanGivenCum - bizExpCum - famExpCum - warpCostCum - weftCostCum;
  }

  return {producedCum,producedMonth,soldCum,soldMonth,salesAmtCum,salesAmtMonth,receivedCum,receivedMonth,
    bizExpCum,bizExpMonth,famExpCum,famExpMonth,warpCostCum,warpCostMonth,weftCostCum,weftCostMonth,
    warpSetsCum,warpSetsMonth,weftBagsCum,weftBagsMonth,wagesPaidCum,wagesPaidMonth,loanGivenCum,loanGivenMonth,loanRepaidCum,loanRepaidMonth,
    receivable,stock,profitCum,profitMonth,cash,checkpoint,stockByQuality,receivablesByClient,
    qualityNames,clientQualityBreakdown};
}

/* ---------------- Warp beams: woven meters per beam, and how long / when each beam ran ---------------- */
// For each loom, beams are ordered by when they were chained on. A Production entry is
// attributed to a beam via its own r.beam link when present (set explicitly on the form,
// including the Current/Previous toggle on changeover days) — this is exact, no guessing.
// Entries logged before this linking existed (r.beam empty) fall back to matching the
// entry's date against each beam's active window: from its own install date up to
// whichever comes first — the next beam's install date, or (if this beam was marked
// Finished by hand, with no newer beam logged yet) its finished date. An entry dated
// after a beam's window has closed, with no newer beam logged to cover it, is left
// unattributed rather than piling onto a beam that's already done — so Woven only ever
// reflects production from the date a beam was logged up to the date it was finished.
// A beam is "Finished" either because a newer beam has since been chained onto the same
// loom (hasNext), or because it was marked finished by hand via r.finished (for when a
// beam is done but its replacement hasn't been logged yet).
// Returns [{r, beam}] for every Production entry that belongs to a beam (entries that belong to
// no beam are left out). Used for the woven totals below and for the beam forecast.
function beamProductionLinks(){
  const byLoom = {};
  DATA.warpBeams.forEach(b=>{ (byLoom[b.loom] = byLoom[b.loom]||[]).push(b); });
  Object.values(byLoom).forEach(list=> list.sort((a,b)=> dtOf(a)-dtOf(b)));
  const links = [];
  DATA.production.forEach(r=>{
    if(!r.loom) return;
    const list = byLoom[r.loom];
    if(!list || !list.length) return;
    let beam = r.beam ? list.find(b=>b.id===r.beam) : null;
    if(!beam){
      for(let i=list.length-1;i>=0;i--){
        const cand = list[i];
        if(r.date < cand.date) continue;
        const next = list[i+1];
        const windowEnd = next ? next.date : (cand.finished ? (cand.finishedDate||cand.date) : null);
        if(windowEnd!=null && r.date > windowEnd) continue;
        beam = cand; break;
      }
      // Deliberately no fallback for entries dated before the loom's very first beam —
      // that production happened before beam tracking existed for this loom and belongs
      // to no beam at all. Attributing it to whichever beam gets logged first would wrongly
      // credit a brand-new beam with months of unrelated output.
    }
    if(!beam) return;
    links.push({r, beam});
  });
  return links;
}
// Woven meters, remaining meters and Active/Finished state for every beam (see the rules above).
function computeWarpBeamUsage(){
  const byLoom = {};
  DATA.warpBeams.forEach(b=>{ (byLoom[b.loom] = byLoom[b.loom]||[]).push(b); });
  Object.values(byLoom).forEach(list=> list.sort((a,b)=> dtOf(a)-dtOf(b)));
  const result = {};
  DATA.warpBeams.forEach(b=>{ result[b.id] = {woven:0}; });
  beamProductionLinks().forEach(({r, beam})=>{ result[beam.id].woven += Number(r.qty)||0; });
  Object.values(byLoom).forEach(list=>{
    list.forEach((b,i)=>{
      const next = list[i+1];
      result[b.id].remaining = (Number(b.length)||0) - result[b.id].woven;
      result[b.id].hasNext = !!next;
      result[b.id].isActive = !next && !b.finished;
    });
  });
  return result;
}
// Per-beam operating stats: how long each beam actually ran (from its own install
// date/time until it was replaced by the next beam on that loom — or "so far" if it's
// still the active one) and how its woven output compares to the length logged for it.
// This is what the per-purchase beam breakdown below is built from.
function computeBeamDetails(){
  const usage = computeWarpBeamUsage();
  const byLoom = {};
  DATA.warpBeams.forEach(b=>{ (byLoom[b.loom] = byLoom[b.loom]||[]).push(b); });
  Object.values(byLoom).forEach(list=> list.sort((a,b)=> dtOf(a)-dtOf(b)));
  // dtOf() reads a record's local date+time as if it were UTC, so "now" must be built the same way —
  // a real UTC instant would understate a running beam's days by the phone's UTC offset.
  const now = new Date(todayStr()+'T'+nowStr()+':00Z');
  const details = {};
  Object.values(byLoom).forEach(list=>{
    list.forEach((b,i)=>{
      const next = list[i+1];
      const startDt = dtOf(b);
      let endDt;
      if(next) endDt = dtOf(next);
      else if(b.finished) endDt = new Date((b.finishedDate||todayStr())+'T'+(b.finishedTime||'00:00')+':00Z');
      else endDt = now;
      const daysTaken = Math.max(0, (endDt-startDt)/86400000);
      // When the beam finished: the moment the next beam was chained onto the loom, or the date/time it
      // was marked Finished by hand. null while it is still the active beam.
      let finishedOn = null, finishedTime = '', finishedHow = null;
      if(next){ finishedOn = next.date; finishedTime = next.time || ''; finishedHow = 'replaced'; }
      else if(b.finished){ finishedOn = b.finishedDate || null; finishedTime = b.finishedTime || ''; finishedHow = 'manual'; }
      const u = usage[b.id] || {woven:0, isActive:true};
      const length = Number(b.length)||0;
      const shrinkage = length - u.woven; // positive = beam yielded less cloth than its logged length; negative = it yielded more ("over")
      const shrinkagePct = length>0 ? (shrinkage/length*100) : null;
      details[b.id] = {woven:u.woven, isActive:u.isActive, daysTaken, shrinkage, shrinkagePct, finishedOn, finishedTime, finishedHow};
    });
  });
  return details;
}

/* ---------------- Warp beams: forecast of which beam runs out next ---------------- */
// For every beam still on a loom, estimates when it will be finished so an order for warp (or the
// next beam) can be lined up in time. Two numbers drive it:
//   * how fast the loom is weaving the beam: meters woven on it over its most recent days
//     (up to BEAM_RATE_WINDOW_DAYS, counting days off as zero) divided by those days;
//   * how much is left: the beam's logged length, less what's been woven, scaled by how much of
//     their logged length your last finished beams actually ended up yielding (the shrinkage you
//     already see per beam) — so a beam that normally ends at ~96% is expected to end there.
// A loom with no output in the last few days gets no forecast ("idle") rather than a guess.
const BEAM_RATE_WINDOW_DAYS = 7;
const BEAM_RATE_STALE_DAYS = 3;   // no output for longer than this = idle, no forecast
const BEAM_SOON_DAYS = 7;         // beams due to end within this many days are listed as "soon"
const BEAM_LOW_METERS = 300;      // same "running low" line the beam logs already highlight
const beamDayNum = s => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);
const beamDayStr = n => new Date(n * 86400000).toISOString().slice(0, 10);

// Median share of its logged length that recently finished beams actually wove (clamped to a sane
// range); 1 (= the full logged length) until at least two beams have finished.
function beamYieldRatio(usage){
  const done = DATA.warpBeams.filter(b=>{
    const u = usage[b.id];
    return u && !u.isActive && (Number(b.length)||0) > 0 && u.woven > 0;
  }).sort((a,b)=> dtOf(b)-dtOf(a)).slice(0, 5);
  if(done.length < 2) return {value:1, basis:0};
  const ratios = done.map(b=> usage[b.id].woven / (Number(b.length)||0)).sort((a,b)=> a-b);
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid-1] + ratios[mid]) / 2;
  return {value: Math.min(1.1, Math.max(0.5, median)), basis: done.length};
}
// alertDays = "ending" threshold (a beam with this many days left or fewer). Returns one entry per
// active beam, most urgent first. state: full | ending | soon | ok | idle | nodata.
function computeBeamForecasts(alertDays){
  const alertAt = Number(alertDays) > 0 ? Number(alertDays) : 3;
  const usage = computeWarpBeamUsage();
  const links = beamProductionLinks();
  const yieldInfo = beamYieldRatio(usage);
  const today = todayStr(), todayN = beamDayNum(today);
  const out = [];
  DATA.warpBeams.forEach(b=>{
    const u = usage[b.id];
    if(!u || !u.isActive) return;
    const length = Number(b.length) || 0;
    if(length <= 0) return;
    const woven = u.woven;
    const remaining = Math.max(0, length - woven);
    const expectedRemaining = Math.max(0, length * yieldInfo.value - woven);
    const startN = beamDayNum(b.date);
    const mine = links.filter(l => l.beam.id === b.id)
      .map(l => ({n: beamDayNum(l.r.date), q: Number(l.r.qty) || 0}))
      .filter(x => x.n <= todayN);
    const lastN = mine.length ? Math.max(...mine.map(x => x.n)) : null;
    let rate = null, basisDays = 0;
    if(lastN !== null && todayN - lastN <= BEAM_RATE_STALE_DAYS){
      const fromN = Math.max(startN, lastN - (BEAM_RATE_WINDOW_DAYS - 1));
      basisDays = lastN - fromN + 1;
      const total = mine.filter(x => x.n >= fromN && x.n <= lastN).reduce((s, x) => s + x.q, 0);
      if(basisDays > 0 && total > 0) rate = total / basisDays;
    }
    let state, daysLeft = null, finishDate = null;
    if(expectedRemaining <= 0){ state = 'full'; daysLeft = 0; finishDate = today; }
    else if(rate){
      daysLeft = expectedRemaining / rate;
      finishDate = beamDayStr(todayN + Math.round(daysLeft));
      state = daysLeft <= alertAt ? 'ending' : (daysLeft <= BEAM_SOON_DAYS ? 'soon' : 'ok');
    }else{
      state = lastN === null ? 'nodata' : 'idle';
    }
    out.push({id:b.id, loom:b.loom, warpType:b.warpType || '', length, woven, remaining, expectedRemaining,
      rate, basisDays, lastDay: lastN === null ? null : beamDayStr(lastN), daysLeft, finishDate, state,
      low: remaining < BEAM_LOW_METERS && (state === 'idle' || state === 'nodata'),
      yieldRatio: yieldInfo.value, yieldBasis: yieldInfo.basis});
  });
  const rank = f => f.state === 'full' ? 0 : (f.daysLeft !== null ? 1 + f.daysLeft : (f.low ? 1000 : 2000));
  return out.sort((a, b) => rank(a) - rank(b));
}
function beamWhenText(f){
  if(f.state === 'full') return 'now';
  if(f.daysLeft <= 0.5) return 'today';
  if(f.daysLeft <= 1.5) return 'tomorrow';
  return `in about ${Math.round(f.daysLeft)} days`;
}
function beamAlertText(f){
  if(f.state === 'full') return `Loom ${f.loom} beam is fully woven — chain the next beam or mark it finished`;
  return `Loom ${f.loom} beam ends ${beamWhenText(f)} (~${Math.round(f.expectedRemaining)} m left)`;
}
// One line for the alert toast: a single beam in full, or a short list when several are due.
function beamAlertSummary(list){
  if(!list.length) return '';
  if(list.length === 1) return '⚠ ' + beamAlertText(list[0]);
  return `⚠ ${list.length} beams ending soon: ` + list.map(f =>
    `Loom ${f.loom} (${f.state === 'full' ? 'fully woven' : beamWhenText(f).replace('in about ', '~')})`).join(', ');
}
