function escHtml(str){
  return String(str==null?'':str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
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

// The wage week the workers are paid by: Friday through Thursday. Returns the Friday-to-Thursday
// range (YYYY-MM-DD, both ends included) that contains the given date — so on a Friday it is that
// day through next Thursday, and on a Thursday it is last Friday through that same day.
function currentWageWeek(dateStr){
  const WEEK_START_DAY = 5; // Friday (0 = Sunday)
  const d = new Date(dateStr+'T00:00:00Z');
  const back = (d.getUTCDay() - WEEK_START_DAY + 7) % 7;
  const start = new Date(d.getTime() - back*86400000);
  const end = new Date(start.getTime() + 6*86400000);
  return {from: start.toISOString().slice(0,10), to: end.toISOString().slice(0,10)};
}

// Total meters produced in the current wage week (Friday to Thursday), all qualities and looms
// added together — the plain "Qty Produced" of every Production entry dated in the week.
function weeklyProductionTotal(dateStr){
  const week = currentWageWeek(dateStr);
  const meters = DATA.production.reduce((t, r)=>
    (r.date && r.date >= week.from && r.date <= week.to) ? t + (Number(r.qty) || 0) : t, 0);
  return {from: week.from, to: week.to, meters};
}

// This wage week's production and wages per employee, split by quality, for the Overview card.
// Uses exactly the Wages page's own figures (computeWages: own meters + Difference share, each
// entry paid at the rate in effect on ITS date), without bonuses. Only employees / qualities with
// meters that week are listed. rate = the quality's current rate; rateChanged = true when the
// week's wages weren't all at that rate (a rate change fell inside the week).
function weeklyWageSummary(dateStr){
  const week = currentWageWeek(dateStr);
  const rows = [];
  computeWages(week.from, week.to).forEach(e=>{
    const byQuality = e.byQuality.filter(x=>Math.abs(x.meters) > 1e-9).map(x=>{
      const rate = rateForQualityOn(x.quality, dateStr);
      return {quality:x.quality, meters:x.meters, wages:x.wages, rate,
              rateChanged: Math.abs(x.wages - x.meters*rate) > 0.005};
    });
    if(!byQuality.length) return;
    rows.push({employee:e.employee, byQuality,
      totalMeters: byQuality.reduce((t,x)=>t+x.meters,0),
      totalWages: byQuality.reduce((t,x)=>t+x.wages,0)});
  });
  return {from:week.from, to:week.to, rows,
    totalMeters: rows.reduce((t,r)=>t+r.totalMeters,0),
    totalWages: rows.reduce((t,r)=>t+r.totalWages,0)};
}

// Adds, or (when replaceDate is given) edits, one Rate History entry. A quality holds one entry per
// effective-from date, so saving a date that already exists overwrites that entry's rate — also when
// an edit moves an entry onto another entry's date (the edited one replaces it, no duplicate left).
// Editing an entry that no longer exists just adds it. This CHANGES the ledger (like
// settleReplacementLinks below); the page code saves afterwards.
function saveRateHistoryEntry(quality, rate, date, replaceDate){
  if(!DATA.wageRateHistory) DATA.wageRateHistory = {};
  const list = DATA.wageRateHistory[quality] = DATA.wageRateHistory[quality] || [];
  if(replaceDate){
    const i = list.findIndex(e=>e.date===replaceDate);
    if(i >= 0) list.splice(i, 1);
  }
  const existing = list.find(e=>e.date===date);
  if(existing) existing.rate = rate; else list.push({date, rate});
}
// Which production days a Rate History entry decides, for the "this will change past records" notes
// on the Wages page: from = its own effective date (null for a quality's earliest entry, which also
// pays every earlier day), to = the next entry's date (null = no later entry, so it runs onward),
// and rateAfterRemoval = the rate those days would get if the entry were deleted. null if not found.
function rateHistorySpan(quality, date){
  const sorted = sortedRateHistory(quality);
  const i = sorted.findIndex(e=>e.date===date);
  if(i < 0) return null;
  const rest = sorted.filter((_, k)=>k !== i);
  let after = rest.length ? rest[0] : null;
  for(const e of rest){ if(e.date <= date) after = e; else break; }
  return {
    from: i === 0 ? null : date,
    to: i < sorted.length - 1 ? sorted[i+1].date : null,
    rate: Number(sorted[i].rate) || 0,
    rateAfterRemoval: after ? Number(after.rate) || 0 : 0,
  };
}
// Removes one Rate History entry. A quality's ONLY entry is kept (returns 'last'): without any rate
// its wages would silently drop to 0. Returns 'ok', 'last' or 'missing'.
function removeRateHistoryEntry(quality, date){
  const list = (DATA.wageRateHistory && DATA.wageRateHistory[quality]) || [];
  const i = list.findIndex(e=>e.date===date);
  if(i < 0) return 'missing';
  if(list.length < 2) return 'last';
  list.splice(i, 1);
  return 'ok';
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

// Salaried staff (paid weekly): DATA.staffSalary[name] = {rates:[{date, weekly}], to}. It lives in the Wages
// section (like rate history), so phones that cannot view Wages never hold it. Salary accrues per day
// (weekly / 7) from each rate's effective date up to the period end (or today) or the last working day, so a
// full week is exactly the weekly amount and any wage period or settlement date still adds up.
function staffSalaryOf(name){ return (DATA.staffSalary && DATA.staffSalary[name]) || null; }
function salaryDayBefore(d){ return new Date(Date.parse(d + 'T00:00:00Z') - 86400000).toISOString().slice(0,10); }
function salaryAccrued(name, fromDate, toDate){
  const s = staffSalaryOf(name);
  if(!s || !Array.isArray(s.rates) || !s.rates.length) return 0;
  const rates = s.rates.filter(r=>r && r.date).slice().sort((a,b)=> a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  let cap = toDate || todayStr();
  if(s.to && s.to < cap) cap = s.to;
  let total = 0;
  rates.forEach((r, i)=>{
    let a = r.date, b = rates[i+1] ? salaryDayBefore(rates[i+1].date) : cap;
    if(b > cap) b = cap;
    if(fromDate && a < fromDate) a = fromDate;
    if(a > b) return;
    total += ((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000 + 1) * (Number(r.weekly) || 0) / 7;
  });
  return Math.round(total * 100) / 100;
}
function isSalariedEmp(name){ const e = (DATA.employees || []).find(x=>x.name === name); return !!(e && e.salaried); }
// The weekly salary in force on a date (0 before it starts or after the last working day).
function salaryWeeklyOn(name, date){
  const s = staffSalaryOf(name); if(!s || !Array.isArray(s.rates)) return 0;
  const d = date || todayStr(); if(s.to && d > s.to) return 0;
  let w = 0;
  s.rates.slice().sort((a,b)=> a.date < b.date ? -1 : a.date > b.date ? 1 : 0).forEach(r=>{ if(r.date <= d) w = Number(r.weekly) || 0; });
  return w;
}
function salaryFirstDate(name){
  const s = staffSalaryOf(name); const d = s && Array.isArray(s.rates) ? s.rates.filter(r=>Number(r.weekly) > 0).map(r=>r.date).sort() : [];
  return d[0] || null;
}
// Ends a salary (the person goes back to per-meter wages): a zero-rate entry from the day after `lastDay`,
// so a later salary can start again without the gap being paid.
function endStaffSalary(name, lastDay){
  const s = staffSalaryOf(name); if(!s) return;
  saveStaffSalary(name, 0, nextDayStr(lastDay), '');
}
// Adds or corrects one salary rate (one per effective-from date) and sets the last working day.
function saveStaffSalary(name, weekly, from, to){
  if(!DATA.staffSalary) DATA.staffSalary = {};
  const s = DATA.staffSalary[name] = DATA.staffSalary[name] || {rates:[]};
  const e = s.rates.find(r=>r.date === from);
  if(e) e.weekly = weekly; else s.rates.push({date:from, weekly});
  s.rates.sort((a,b)=> a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  if(to) s.to = to; else delete s.to;
}

// Adds a new bonus; with paidNow it also logs the matching wage payment (cash given, or a bill paid for the
// person), so the bonus is earned and paid in one step and leaves no balance. Returns the new bonus.
function addWageBonusEntry(rec, paidNow, newId){
  const bonus = {id:newId(), ...rec};
  DATA.wageBonuses.push(bonus);
  if(paidNow) DATA.wagePayments.push({id:newId(), date:rec.date, employee:rec.employee, amount:rec.amount,
    remarks:'Paid with bonus' + (rec.remarks ? ': ' + rec.remarks : '')});
  return bonus;
}

function computeWages(fromDate, toDate){
  // Inactive employees drop off this table once they have nothing left to show for the
  // selected period — but stay visible if they still have real meters/wages/bonus in it,
  // so past earnings never silently disappear just because someone's since left.
  const relevantEmployees = DATA.employees.filter(emp=>{
    if(emp.active !== false) return true;
    const hasMeters = DATA.qualities.some(q => computeWageMeters(emp.name, q.name, fromDate, toDate).total !== 0);
    const hasBonus = DATA.wageBonuses.some(b=>b.employee===emp.name && (!fromDate||b.date>=fromDate) && (!toDate||b.date<=toDate));
    return hasMeters || hasBonus || salaryAccrued(emp.name, fromDate, toDate) > 0;
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
    const salary = salaryAccrued(emp.name, fromDate, toDate);
    const totalWages = totalWagesNoBonus + bonus + salary;
    return {employee:emp.name, byQuality, totalMeters, totalDiffMeters, totalDiffWages, bonus, salary, totalWagesNoBonus, totalWages};
  });
}

// Returns the date string one day after the given YYYY-MM-DD date.
function nextDayStr(dateStr){
  const d = new Date(dateStr+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+1);
  return d.toISOString().slice(0,10);
}

// Wage amounts are shown to 2 decimals, so differences are taken on whole paisa. Otherwise a hidden
// fraction (e.g. earned 9533.3249 vs paid 9533.32) leaves "Rs 0.00" flagged as owed/credit, or "-0.00".
function paisaDiff(a, b){ return (Math.round(a * 100) - Math.round(b * 100)) / 100 || 0; }
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
  const salary = salaryAccrued(empName, wageFromDate, null);
  const owed = earned + bonus + salary;
  return {owed, paid, salary, carryForward, balance: paisaDiff(carryForward + owed, paid), lastSettled: lastSettlement ? lastSettlement.date : null};
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
  return earned + bonus + salaryAccrued(empName, fromDate, toDate);
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

// Running loan balance for one person under Personal Loans (Given) — money lent to family
// or friends, entirely separate from the business/employee ledgers. Same shape as
// computeEmployeeLoanBalance: every Loan Given entry for that person adds to what they owe
// back, every Loan Repaid entry reduces it. Multiple loans to the same person are logged as
// separate entries (so each one keeps its own date/remarks) but all roll up into one running
// balance per person here.
function computePersonLoanBalance(person){
  const entries = DATA.personalLoans.filter(p=>p.person===person);
  const given = entries.filter(p=>p.type !== 'Loan Repaid').reduce((s,p)=>s+(Number(p.amount)||0),0);
  const repaid = entries.filter(p=>p.type === 'Loan Repaid').reduce((s,p)=>s+(Number(p.amount)||0),0);
  return {given, repaid, balance: given - repaid};
}
// Owner Loans (to Company): money the owner puts into the business (e.g. to buy yarn or spare parts)
// that the business owes back. 'Loan In' adds to what is owed; 'Loan Repaid' (paid back to the owner,
// usually out of recoveries) reduces it. The cash effect is the OPPOSITE of the loans given out
// above: a Loan In raises Cash Position, a repayment lowers it. Never income, never an expense, so
// Profit/Loss is untouched. DATA.ownerLoans may be missing on an old ledger, so it is always read
// through ownerLoanList().
function ownerLoanList(){ return (typeof DATA !== 'undefined' && Array.isArray(DATA.ownerLoans)) ? DATA.ownerLoans : []; }
function ownerLoanIsRepaid(p){ return p && p.type === 'Loan Repaid'; }
function computeOwnerLoanBalance(){
  const list = ownerLoanList();
  const given = list.filter(p=>!ownerLoanIsRepaid(p)).reduce((s,p)=>s+(Number(p.amount)||0),0);
  const repaid = list.filter(p=>ownerLoanIsRepaid(p)).reduce((s,p)=>s+(Number(p.amount)||0),0);
  return {given, repaid, balance: given - repaid};
}
// Money put in, split by what it was for (Yarn, Spare parts, ...), so the owner can see what the
// outstanding balance was spent on. Repayments are not tied to a purpose, so they are shown as one total.
function ownerLoanByPurpose(){
  const m = {};
  ownerLoanList().filter(p=>!ownerLoanIsRepaid(p)).forEach(p=>{ const k = p.purpose || 'Other'; m[k] = (m[k]||0) + (Number(p.amount)||0); });
  return Object.keys(m).map(k=>({purpose:k, amount:m[k]}));
}
// Distinct people who appear anywhere in Personal Loans, in first-seen order — there's no
// separate master list of family/friends (unlike employees), so the Personal Loans page
// builds its per-person rows straight from whoever has been logged.
function personalLoanPeople(){
  const seen = new Set(), out = [];
  DATA.personalLoans.forEach(p=>{ if(p.person && !seen.has(p.person)){ seen.add(p.person); out.push(p.person); } });
  return out;
}
// People to actually show on the Personal Loans page: everyone in Settings > Family Members
// (active ones always, inactive ones only while they still have a nonzero balance — same
// rule as loanRelevantEmployees), plus — just in case — any name that shows up in the
// Personal Loans log but isn't in that list at all (e.g. entries logged before the list
// existed, or a member since removed), so a balance never silently disappears.
function personalLoanRelevantPeople(){
  const rows = DATA.familyMembers.filter(m=>{
    if(m.active !== false) return true;
    const b = computePersonLoanBalance(m.name);
    return Math.abs(b.balance) > 0.004;
  }).map(m=>m.name);
  const known = new Set(DATA.familyMembers.map(m=>m.name));
  personalLoanPeople().forEach(name=>{ if(!known.has(name) && !rows.includes(name)) rows.push(name); });
  return rows;
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

// Same as recoveryReceivableAmount but every cheque counts as paid the moment it's recorded,
// whether it later cleared or bounced (a Bounced cheque still counts here). The one exception is
// a Replaced cheque: it bounced and the client then paid again through a separate payment entry,
// so counting it too would credit the same money twice. Used only for the "before last sale"
// checkpoint below, which is meant to stay frozen as of when that sale was entered rather than
// move around every time a cheque's status changes afterward.
function recoveryFaceAmount(r){
  const {cashAmount, bankAmount, cheques} = recoveryParts(r);
  return cashAmount + bankAmount + cheques.filter(c=>c.status!=='Replaced').reduce((s,c)=>s+(Number(c.amount)||0),0);
}

// A dyeing unit's "L (AIL)" shortage check on a dispatched lot: they measure a few random
// rolls and, per the settled market-convention formula, treat every 400 meters sold as
// worth 1 meter of shortage per reported L. The fractional part of that is neglected —
// a shortage is only ever stated/settled in whole meters, so this floors rather than
// rounds. Kept as a plain function (not inlined) so the UI preview and the actual
// apply-on-confirm step can never drift apart. This is only ever the starting figure:
// panels-daily.js lets it be overridden with a specific mutually-agreed meter amount
// (e.g. when both sides settle on compensating more than the formula implies) before
// Confirm is pressed — see the shortage-mtr input wired in wireLConfirm (wiring.js).
function lShortageMeters(qty, lCount){ return Math.floor((Number(qty)||0) / 400 * (Number(lCount)||0) + 1e-6); }
// An L (AIL) count is always read against the market tolerance of 5 (past which the
// double-L formula would apply — see wireLConfirm in wiring.js) — shown everywhere as
// "count/5" rather than a bare number, so it's clear at a glance how close to that ceiling
// a given shortage call is (e.g. 2 L reads as "2/5", 5 L as "5/5"). Zero reads as "OK"
// instead of "0/5" — callers that also append a trailing " L"/"L (AIL)" word handle that
// case themselves so the sentence still reads naturally (see saleStatementLNote below and
// the "applied" badge in panels-daily.js).
const L_TOLERANCE = 5;
function fmtLCount(n){ n = Number(n)||0; return n===0 ? 'OK' : `${n}/${L_TOLERANCE}`; }
// PKR value of that shortage at the lot's own rate — matches the flooring addSale already
// uses for a normal sale's Amount, so an L-adjusted amount is never off by a paisa rounding.
function lDeductionAmount(shortageQty, rate){ return Math.floor((Number(shortageQty)||0) * (Number(rate)||0) + 1e-6); }
// A Sale entry that's been fully superseded by its L (AIL) adjustment, or returned outright
// after L exceeded the tolerance, no longer represents real outstanding quantity/money —
// only the adjusted entry (or nothing, if returned) should count anywhere balances, totals,
// or breakdowns are computed. The original stays in DATA.sale (and the Sales Log) purely as
// an audit trail — see lSupersededBy / lAdjustedFromId on the records themselves.
function activeSaleRows(){ return DATA.sale.filter(s=> s.lStatus!=='applied' && s.lStatus!=='returned'); }
// Short " (...)" suffix noting a Sale's L (AIL) status on the Client Statement — so the
// client sees the same check result there as on the Sales Log and the receipt, not just a
// plain figure that quietly differs from what was originally dispatched.
function saleStatementLNote(s){
  if(s.lStatus==='awaiting') return ' (L (AIL) pending)';
  if(s.lStatus==='ok') return ' (L (AIL): OK)';
  if(s.lAdjustedFromId){
    const orig = DATA.sale.find(o=>o.id===s.lAdjustedFromId);
    return ` (adjusted for L (AIL)${orig?` — ${orig.lCount ? `${fmtLCount(orig.lCount)} L` : 'OK'}`:''})`;
  }
  return '';
}

// A client's receivable balance right before their most recent sale was entered — i.e. sum
// of all their earlier sales minus everything received from them up to that sale's date.
// Sale entries don't carry a time (only a date), so this compares by calendar date, not
// exact instant: a recovery dated the same day as the last sale still counts as prior — it's
// far more likely to represent money received before that sale than after it. Ties between
// several sales on the exact same date are broken by id so the "last" one is picked
// consistently. This is a frozen checkpoint at face value: cheques count as paid as of the
// date they were recorded, and a later bounce does NOT change this figure — it only affects
// the overall (live) Receivable total elsewhere, not this snapshot. Cheques marked Replaced are
// left out (see recoveryFaceAmount), since their replacement payment is counted on its own.
function receivableBeforeLastSale(clientName){
  const sales = activeSaleRows().filter(s=>s.client===clientName).slice()
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
    const sales = activeSaleRows().filter(s=>s.client===name).slice().sort((a,b)=> a.date.localeCompare(b.date));
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

// Cheque cards moved to Overview (above Stock Position) — these compute the underlying
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

// ---------------------------------------------------------------------------------------------
// Replacing a bounced cheque
//
// When a client makes good on a bounced cheque, the money comes in as its own new payment. To keep
// the two connected, that payment carries  replaces: [{recoveryId, chequeId, amount}]  — "this much
// of this payment replaces that bounced cheque". The link lives ONLY on the replacing payment; the
// other direction ("this cheque was replaced by ...") is always worked out from the links, so the two
// sides can never disagree. None of the money figures (Receivable, Cash, statements) read these
// links — a Replaced cheque still simply isn't credited and the replacing payment still credits in
// full. The links exist so the app can show what replaced what, and warn when something is missing.
// ---------------------------------------------------------------------------------------------
const REPLACE_TOLERANCE = 0.005;
const plainRs = n => 'Rs ' + Math.round(Number(n)||0).toLocaleString('en-IN'); // same digit grouping as fmtRs, so messages read like the rest of the app

// A payment's full value, before Bounced/Replaced cheques are left out.
function paymentTotal(r){
  const {cashAmount, bankAmount, cheques} = recoveryParts(r);
  return cashAmount + bankAmount + cheques.reduce((sum,c)=>sum+(Number(c.amount)||0),0);
}
// Every link from every payment, one flat list: {paymentId, recoveryId, chequeId, amount}.
function replacementLinks(){
  const out = [];
  DATA.recovery.forEach(p=>{
    (Array.isArray(p.replaces) ? p.replaces : []).forEach(l=>{
      if(l && l.recoveryId && l.chequeId) out.push({paymentId:p.id, recoveryId:l.recoveryId, chequeId:l.chequeId, amount:Number(l.amount)||0});
    });
  });
  return out;
}
function findCheque(recoveryId, chequeId){
  const rec = DATA.recovery.find(x=>x.id===recoveryId);
  if(!rec) return null;
  const cheque = recoveryParts(rec).cheques.find(x=>x.id===chequeId);
  return cheque ? {rec, cheque} : null;
}
// How much of a cheque has been made good by linked payments (optionally ignoring one payment,
// e.g. the one being edited, so its own earlier link isn't counted against it).
function chequeReplacedAmount(recoveryId, chequeId, exceptPaymentId){
  return replacementLinks()
    .filter(l=> l.recoveryId===recoveryId && l.chequeId===chequeId && l.paymentId!==exceptPaymentId)
    .reduce((sum,l)=>sum+l.amount, 0);
}
function chequeStillOwed(recoveryId, chequeId, exceptPaymentId){
  const f = findCheque(recoveryId, chequeId);
  if(!f) return 0;
  return Math.max(0, (Number(f.cheque.amount)||0) - chequeReplacedAmount(recoveryId, chequeId, exceptPaymentId));
}
// The cheques a payment from this client could replace: their Bounced cheques that are still (partly)
// owed, plus any cheque this same payment already replaces (so editing it keeps its ticks). A cheque
// that is part of the payment itself is never offered.
function replaceableCheques(client, editingPaymentId){
  const out = [];
  const mine = editingPaymentId ? replacementLinks().filter(l=>l.paymentId===editingPaymentId) : [];
  DATA.recovery.forEach(r=>{
    if(r.client !== client || r.id === editingPaymentId) return;
    recoveryParts(r).cheques.forEach(c=>{
      const linkedHere = mine.some(l=> l.recoveryId===r.id && l.chequeId===c.id);
      if(c.status !== 'Bounced' && !linkedHere) return;
      const owed = chequeStillOwed(r.id, c.id, editingPaymentId);
      if(owed <= REPLACE_TOLERANCE && !linkedHere) return;
      out.push({recoveryId:r.id, chequeId:c.id, date:r.date, chequeNo:c.chequeNo||'', bank:c.bank||'', owner:c.owner||'',
        chequeDate:c.chequeDate||'', amount:Number(c.amount)||0, owed});
    });
  });
  out.sort((a,b)=> a.date.localeCompare(b.date));
  return out;
}
// Returns a plain-English problem with a set of links a payment is about to save, or null if fine.
// `links` = [{recoveryId, chequeId, amount}], `total` = the payment's full value.
function checkReplacementLinks(paymentId, client, total, links){
  let sum = 0;
  for(const l of (links||[])){
    const f = findCheque(l.recoveryId, l.chequeId);
    const name = f ? `cheque ${f.cheque.chequeNo ? 'No. '+f.cheque.chequeNo+' ' : ''}(${plainRs(f.cheque.amount)})` : 'a cheque';
    if(!f) return 'One of the cheques this payment replaces no longer exists — untick it.';
    if(f.rec.client !== client) return `The ${name} belongs to a different client.`;
    if(f.rec.id === paymentId) return `A payment can't replace its own cheque (${name}).`;
    const amt = Number(l.amount)||0;
    if(!(amt > 0)) return `Enter how much of this payment replaces the ${name}.`;
    const owed = chequeStillOwed(l.recoveryId, l.chequeId, paymentId);
    if(amt > owed + REPLACE_TOLERANCE) return `Only ${plainRs(owed)} of the ${name} is still owed — the amount replacing it is ${plainRs(amt)}.`;
    sum += amt;
  }
  if(sum > (Number(total)||0) + REPLACE_TOLERANCE) return `The amounts replacing cheques add up to ${plainRs(sum)}, which is more than this payment (${plainRs(total)}).`;
  return null;
}
// After links change, brings the affected cheques' status in line: fully made good -> Replaced,
// and a Replaced cheque that is no longer fully covered -> back to Bounced. Only touches the
// cheques it is told about (a cheque marked Replaced by hand is left alone unless it is listed).
function applyReplacementLinks(refs){
  const changes = [], seen = new Set();
  (refs||[]).forEach(ref=>{
    const key = ref.recoveryId+':'+ref.chequeId;
    if(seen.has(key)) return;
    seen.add(key);
    const f = findCheque(ref.recoveryId, ref.chequeId);
    if(!f) return;
    const full = chequeReplacedAmount(ref.recoveryId, ref.chequeId) >= (Number(f.cheque.amount)||0) - REPLACE_TOLERANCE;
    if(full && f.cheque.status === 'Bounced'){ f.cheque.status = 'Replaced'; changes.push({recoveryId:ref.recoveryId, chequeId:ref.chequeId, to:'Replaced'}); }
    else if(!full && f.cheque.status === 'Replaced'){ f.cheque.status = 'Bounced'; changes.push({recoveryId:ref.recoveryId, chequeId:ref.chequeId, to:'Bounced'}); }
  });
  return changes;
}
// Removes links whose cheque has been deleted (the cheque row was removed from its payment).
function pruneReplacementLinks(){
  let removed = 0;
  DATA.recovery.forEach(p=>{
    if(!Array.isArray(p.replaces)) return;
    const keep = p.replaces.filter(l=> l && findCheque(l.recoveryId, l.chequeId));
    removed += p.replaces.length - keep.length;
    if(keep.length) p.replaces = keep; else delete p.replaces;
  });
  return removed;
}
// The one call the Save / Delete buttons use: given a payment's links from before and after a change
// (either may be empty), updates statuses and drops dead links. `ownChequeIds` are the payment's own
// cheques — included so a cheque whose amount changed is re-checked, but only if something links to it.
function settleReplacementLinks(oldLinks, newLinks, ownRecoveryId){
  const refs = [].concat(oldLinks||[], newLinks||[]).map(l=>({recoveryId:l.recoveryId, chequeId:l.chequeId}));
  if(ownRecoveryId){
    const own = DATA.recovery.find(x=>x.id===ownRecoveryId);
    if(own) recoveryParts(own).cheques.forEach(c=>{ if(chequeReplacedAmount(ownRecoveryId, c.id) > 0) refs.push({recoveryId:ownRecoveryId, chequeId:c.id}); });
  }
  pruneReplacementLinks();
  return applyReplacementLinks(refs);
}
// Ties `amount` of an existing payment to a cheque (used by "Link" on the check list). Returns
// {ok:true} or {ok:false, error}.
function linkReplacement(paymentId, recoveryId, chequeId, amount){
  const p = DATA.recovery.find(x=>x.id===paymentId);
  if(!p) return {ok:false, error:'That payment no longer exists.'};
  const old = (Array.isArray(p.replaces) ? p.replaces : []).map(l=>({...l}));
  const next = old.filter(l=> !(l.recoveryId===recoveryId && l.chequeId===chequeId)).concat([{recoveryId, chequeId, amount:Number(amount)||0}]);
  const problem = checkReplacementLinks(paymentId, p.client, paymentTotal(p), next);
  if(problem) return {ok:false, error:problem};
  p.replaces = next;
  settleReplacementLinks(old, next, null);
  return {ok:true};
}
// Bounced/Replaced cheques as the check list sees them: {recoveryId, chequeId, client, date, chequeNo, bank, owner,
// amount, linked, missing}. `missing` is how much of a Replaced cheque no linked payment accounts for.
function uncoveredReplacedCheques(){
  const out = [];
  DATA.recovery.forEach(r=>{
    recoveryParts(r).cheques.forEach(c=>{
      if(c.status !== 'Replaced') return;
      const amount = Number(c.amount)||0, linked = chequeReplacedAmount(r.id, c.id);
      if(linked < amount - REPLACE_TOLERANCE) out.push({recoveryId:r.id, chequeId:c.id, client:r.client, date:r.date, chequeNo:c.chequeNo||'',
        bank:c.bank||'', owner:c.owner||'', amount, linked, missing: amount - linked});
    });
  });
  out.sort((a,b)=> b.date.localeCompare(a.date));
  return out;
}
// Payments that could plausibly be the one that made good on a cheque: same client, dated on or after
// the payment holding the cheque, with enough of its value not already assigned to other cheques.
// Nearest date first, at most 3. The person confirms one; nothing is linked automatically.
function suggestReplacementPayments(recoveryId, chequeId){
  const f = findCheque(recoveryId, chequeId);
  if(!f) return [];
  const missing = Math.max(0, (Number(f.cheque.amount)||0) - chequeReplacedAmount(recoveryId, chequeId));
  if(missing <= REPLACE_TOLERANCE) return [];
  const out = [];
  DATA.recovery.forEach(p=>{
    if(p.client !== f.rec.client || p.id === recoveryId || p.date < f.rec.date) return;
    const assigned = (Array.isArray(p.replaces) ? p.replaces : []).filter(l=>!(l.recoveryId===recoveryId && l.chequeId===chequeId)).reduce((sum,l)=>sum+(Number(l.amount)||0),0);
    const room = paymentTotal(p) - assigned;
    if(room + REPLACE_TOLERANCE >= missing) out.push({paymentId:p.id, date:p.date, total:paymentTotal(p), room, missing});
  });
  out.sort((a,b)=> a.date.localeCompare(b.date));
  return out.slice(0,3);
}
// Everything one payment says about replacements, resolved to readable pieces:
//   replaces:   the cheques this payment makes good  [{recoveryId, chequeId, amount, chequeNo, bank, owner, chequeAmount, date}]
//   replacedBy: for each of this payment's own cheques, the payments that made it good
//               [{chequeId, chequeNo, chequeAmount, by:[{paymentId, date, amount}]}]
function replacementNotes(paymentId){
  const p = DATA.recovery.find(x=>x.id===paymentId);
  const notes = {replaces:[], replacedBy:[]};
  if(!p) return notes;
  (Array.isArray(p.replaces) ? p.replaces : []).forEach(l=>{
    const f = findCheque(l.recoveryId, l.chequeId);
    if(f) notes.replaces.push({recoveryId:l.recoveryId, chequeId:l.chequeId, amount:Number(l.amount)||0, chequeNo:f.cheque.chequeNo||'',
      bank:f.cheque.bank||'', owner:f.cheque.owner||'', chequeAmount:Number(f.cheque.amount)||0, date:f.rec.date});
  });
  const links = replacementLinks();
  recoveryParts(p).cheques.forEach(c=>{
    const by = links.filter(l=>l.recoveryId===p.id && l.chequeId===c.id).map(l=>{
      const q = DATA.recovery.find(x=>x.id===l.paymentId);
      return {paymentId:l.paymentId, date:q ? q.date : '', amount:l.amount};
    }).sort((a,b)=>a.date.localeCompare(b.date));
    if(by.length) notes.replacedBy.push({chequeId:c.id, chequeNo:c.chequeNo||'', chequeAmount:Number(c.amount)||0, by});
  });
  return notes;
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
  activeSaleRows().filter(s=>s.client===clientName).forEach(s=> entries.push({
    date:s.date, id:s.id, debit:Number(s.amount)||0, credit:0,
    detail:`Sale — ${[s.quality, saleQtyRateText(s)].filter(Boolean).join(', ')}${saleStatementLNote(s)}`
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

  const soldCum = sumWhere(activeSaleRows(),'qty',null,cumEnd);
  const soldMonth = start ? sumWhere(activeSaleRows(),'qty',start,end) : soldCum;

  const salesAmtCum = sumWhere(activeSaleRows(),'amount',null,cumEnd);
  const salesAmtMonth = start ? sumWhere(activeSaleRows(),'amount',start,end) : salesAmtCum;

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

  // Personal Loans (Given) work exactly like employee loans: real cash out/in, but not a
  // business expense — money lent to family/friends is expected back, so it only moves Cash
  // Position and is kept out of Business Expenses / Profit-Loss (see computePersonLoanBalance
  // for the per-person running balance).
  const personalLoanGivenCum = sumWhere(DATA.personalLoans.filter(p=>p.type!=='Loan Repaid'),'amount',null,cumEnd);
  const personalLoanGivenMonth = start ? sumWhere(DATA.personalLoans.filter(p=>p.type!=='Loan Repaid'),'amount',start,end) : personalLoanGivenCum;
  const personalLoanRepaidCum = sumWhere(DATA.personalLoans.filter(p=>p.type==='Loan Repaid'),'amount',null,cumEnd);
  const personalLoanRepaidMonth = start ? sumWhere(DATA.personalLoans.filter(p=>p.type==='Loan Repaid'),'amount',start,end) : personalLoanRepaidCum;

  // Owner Loans (to Company): the owner's own money put into the business, and paid back out of
  // recoveries. Raises cash when put in, lowers it when repaid; never an expense or income (see
  // computeOwnerLoanBalance). 'Owed' is as of the period end, like Cash Position.
  const ownerIn = ownerLoanList().filter(p=>!ownerLoanIsRepaid(p));
  const ownerRepaid = ownerLoanList().filter(p=>ownerLoanIsRepaid(p));
  const ownerLoanInCum = sumWhere(ownerIn,'amount',null,cumEnd);
  const ownerLoanInMonth = start ? sumWhere(ownerIn,'amount',start,end) : ownerLoanInCum;
  const ownerLoanRepaidCum = sumWhere(ownerRepaid,'amount',null,cumEnd);
  const ownerLoanRepaidMonth = start ? sumWhere(ownerRepaid,'amount',start,end) : ownerLoanRepaidCum;
  const ownerLoanOwed = ownerLoanInCum - ownerLoanRepaidCum;

  const bizExpCum = sumWhere(DATA.expense,'amount',null,cumEnd) + wagesPaidCum;
  const bizExpMonth = (start ? sumWhere(DATA.expense,'amount',start,end) : sumWhere(DATA.expense,'amount',null,cumEnd)) + wagesPaidMonth;

  const famExpCum = sumWhere(DATA.family,'amount',null,cumEnd);
  const famExpMonth = start ? sumWhere(DATA.family,'amount',start,end) : famExpCum;

  // Personal Expense mirrors Family Expense exactly (real household/personal spending drawn
  // from business cash) — tracked in its own ledger so the two totals stay visible
  // separately, but treated the same way in Cash Position and Profit/Loss below.
  const personalExpCum = sumWhere(DATA.personal,'amount',null,cumEnd);
  const personalExpMonth = start ? sumWhere(DATA.personal,'amount',start,end) : personalExpCum;

  const warpCostCum = sumWhere(DATA.warp,'amount',null,cumEnd);
  const warpCostMonth = start ? sumWhere(DATA.warp,'amount',start,end) : warpCostCum;
  const warpSetsCum = countWhere(DATA.warp,null,cumEnd);
  const warpSetsMonth = start ? countWhere(DATA.warp,start,end) : warpSetsCum;

  const weftCostCum = sumWhere(DATA.weft,'amount',null,cumEnd);
  const weftCostMonth = start ? sumWhere(DATA.weft,'amount',start,end) : weftCostCum;
  const weftBagsCum = sumWhere(DATA.weft,'bags',null,cumEnd);
  const weftBagsMonth = start ? sumWhere(DATA.weft,'bags',start,end) : weftBagsCum;

  const receivable = salesAmtCum - receivedCum - bouncedCum;
  // L (AIL) shortage meterage is cloth that measured short once checked (dyeing shrinkage) —
  // it isn't sitting anywhere as stock once an L is confirmed, so it must come off stock too,
  // not just off the adjusted Sale's billed qty (which is what soldCum already reflects).
  const lShortageCum = sumWhere(DATA.sale.filter(s=>s.lStatus==='applied'),'lShortageQty',null,cumEnd);
  const stock = producedCum - soldCum - lShortageCum;
  const profitCum = salesAmtCum - (bizExpCum+famExpCum+personalExpCum+warpCostCum+weftCostCum);
  const profitMonth = salesAmtMonth - (bizExpMonth+famExpMonth+personalExpMonth+warpCostMonth+weftCostMonth);

  // Stock breakdown by quality (always cumulative to period end, like overall stock)
  const producedByQ = sumWhereBy(DATA.production,'quality','qty',null,cumEnd);
  const soldByQ = sumWhereBy(activeSaleRows(),'quality','qty',null,cumEnd);
  const lShortageByQ = sumWhereBy(DATA.sale.filter(s=>s.lStatus==='applied'),'quality','lShortageQty',null,cumEnd);
  const qualityNames = orderedGroupNames(DATA.qualities.map(q=>q.name), [DATA.production,'quality'], [DATA.sale,'quality']);
  const stockByQuality = qualityNames.map(name=>{
    const produced = producedByQ[name]||0, sold = soldByQ[name]||0, lShort = lShortageByQ[name]||0;
    return {name, produced, sold, stock: produced-sold-lShort};
  }).filter(r=> r.produced || r.sold);

  // Sales & receivables breakdown by client
  const salesByC = sumWhereBy(activeSaleRows(),'client','amount',null,cumEnd);
  const salesByCMonth = start ? sumWhereBy(activeSaleRows(),'client','amount',start,end) : salesByC;
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
  const salesByClientQtyCum = sumWhereBy2(activeSaleRows(),'client','quality','qty',null,cumEnd);
  const salesByClientQtyMonth = start ? sumWhereBy2(activeSaleRows(),'client','quality','qty',start,end) : salesByClientQtyCum;
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
      + sumWhere(DATA.personalLoans.filter(p=>p.type==='Loan Repaid'),'amount',null,cumEnd,cpDateTime)
      + sumWhere(ownerIn,'amount',null,cumEnd,cpDateTime)
      - sumWhere(ownerRepaid,'amount',null,cumEnd,cpDateTime)
      - sumWhere(DATA.expense,'amount',null,cumEnd,cpDateTime)
      - sumWhere(DATA.wagePayments,'amount',null,cumEnd,cpDateTime)
      - sumWhere(DATA.loanPayments.filter(p=>p.type!=='Loan Repaid'),'amount',null,cumEnd,cpDateTime)
      - sumWhere(DATA.personalLoans.filter(p=>p.type!=='Loan Repaid'),'amount',null,cumEnd,cpDateTime)
      - sumWhere(DATA.family,'amount',null,cumEnd,cpDateTime)
      - sumWhere(DATA.personal,'amount',null,cumEnd,cpDateTime)
      - sumWhere(DATA.warp,'amount',null,cumEnd,cpDateTime)
      - sumWhere(DATA.weft,'amount',null,cumEnd,cpDateTime);
  } else {
    cash = Number(DATA.openingBalance||0) + receivedCashCum + loanRepaidCum - loanGivenCum
      + personalLoanRepaidCum - personalLoanGivenCum + ownerLoanInCum - ownerLoanRepaidCum - bizExpCum - famExpCum - personalExpCum - warpCostCum - weftCostCum;
  }

  return {producedCum,producedMonth,soldCum,soldMonth,salesAmtCum,salesAmtMonth,receivedCum,receivedMonth,
    bizExpCum,bizExpMonth,famExpCum,famExpMonth,personalExpCum,personalExpMonth,warpCostCum,warpCostMonth,weftCostCum,weftCostMonth,
    warpSetsCum,warpSetsMonth,weftBagsCum,weftBagsMonth,wagesPaidCum,wagesPaidMonth,loanGivenCum,loanGivenMonth,loanRepaidCum,loanRepaidMonth,
    personalLoanGivenCum,personalLoanGivenMonth,personalLoanRepaidCum,personalLoanRepaidMonth,
    ownerLoanInCum,ownerLoanInMonth,ownerLoanRepaidCum,ownerLoanRepaidMonth,ownerLoanOwed,
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

// Wage payments recorded for one employee with a date inside [fromDate, toDate] (inclusive on
// both ends; either end can be left null to leave that side open). Used to work out how much of
// a specific Wage Period's earnings have already been paid — independent of the Settle Employee
// feature, which tracks a single running balance rather than per-period amounts.
function sumWagePaymentsInRange(empName, fromDate, toDate){
  return DATA.wagePayments
    .filter(p=>p.employee===empName && (!fromDate||p.date>=fromDate) && (!toDate||p.date<=toDate))
    .reduce((s,p)=>s+(Number(p.amount)||0),0);
}

// Net amount still owed for one Wage Period: what was earned in it (wages + bonus) minus
// whatever has already been paid for that same period. Paying the suggested amount in Log Wage
// Payment (see fillWageAmount) brings this to exactly 0. If a rate is later changed for a date
// inside this period, the earned figure recomputes with the new rate while the paid figure is
// untouched (payments don't move when rates change), so this correctly comes out to just the
// extra amount now due — not the full new total, and not 0.
function computeEmployeeWageNetForPeriod(empName, fromDate, toDate){
  const earned = computeEmployeeWagesForPeriod(empName, fromDate, toDate);
  const paid = sumWagePaymentsInRange(empName, fromDate, toDate);
  return {earned, paid, net: paisaDiff(earned, paid)};
}

// Production entry forms: Employee 2's automatic meters. Whole meters only — whatever is left after
// Employee 1 (and Employee 3, if typed) minus this, including any 1/16ths, stays in the entry's
// Difference, which wages split equally between all employees named on the entry.
// Returns 0 when nothing is left; null when Employee 1 + 3 already exceed the total (fix by hand).
function entryEmployee2Meters(total, e1m, e3m){
  const left = (Number(total)||0) - (Number(e1m)||0) - (Number(e3m)||0);
  if(left < -1e-6) return null;
  return Math.max(0, Math.floor(left + 1e-9));
}

// Weft types: the same yarn name can come in different counts, so a type is shown (and stored on each weft
// purchase) as "Nishat (count 36)". A type with no count — all the older ones — is just its name.
function weftTypeLabel(t){
  const name = String((t && t.name) || '').trim();
  const n = Number(t && t.count);
  return n > 0 ? name + ' (count ' + n + ')' : name;
}

// Quality name: Kangi/Picks (Warp Type) -> "62/44 (Micro 150.144)".
// Without Kangi it falls back to the old "44 - 150.144"; '' until picks and warp type are given.
function qualityAutoName(warpType, picks, kangi){
  const p = Number(picks), k = Number(kangi), w = String(warpType || '').trim();
  if(!(p > 0 && w)) return '';
  return k > 0 ? k + '/' + p + ' (' + w + ')' : p + ' - ' + w;
}

// Client details: a client's current receivable (sales - received - bounced), all time, for the credit-limit warning.
function clientReceivableNow(name){
  const sales = activeSaleRows().filter(s=>s.client===name).reduce((t,s)=>t+(Number(s.amount)||0),0);
  const recd = DATA.recovery.filter(r=>r.client===name).reduce((t,r)=>t+(recoveryReceivableAmount(r)||0),0);
  const bnc = DATA.recovery.filter(r=>r.client===name).reduce((t,r)=>t+(recoveryBouncedAmount(r)||0),0);
  return sales - recd - bnc;
}

/* ---------------- Graphs page figures ----------------
   Everything the Graphs page shows is worked out here (no page code), so it can be tested. Each month
   comes from computeStats(), so Graphs always agrees with Overview. */
function graphsShiftMonthKey(mk, delta){
  const [y,m] = mk.split('-').map(Number);
  const d = new Date(Date.UTC(y, m-1+delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
}
// Same number of months, immediately before the shown ones (index-aligned, for ghost bars and % change).
function graphsPrevMonthKeys(monthKeys){ return monthKeys.map(k=> graphsShiftMonthKey(k, -monthKeys.length)); }
// 'q' = this calendar quarter so far, 'ytd' = January up to this month.
function graphsRangeKeys(kind){
  const t = todayStr(), y = Number(t.slice(0,4)), m = Number(t.slice(5,7));
  const first = kind==='q' ? Math.floor((m-1)/3)*3+1 : 1;
  const out = [];
  for(let i=first;i<=m;i++) out.push(`${y}-${String(i).padStart(2,'0')}`);
  return out;
}
function graphsWeekStart(dateStr){
  const d = new Date(dateStr+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay()+6)%7)); // Monday
  return d.toISOString().slice(0,10);
}
// Meters woven per Monday-to-Sunday week, for the n weeks up to the week containing endDate.
function graphsWeeklyProduction(endDate, n){
  const last = new Date(graphsWeekStart(endDate)+'T00:00:00Z');
  const weeks = [];
  for(let i=n-1;i>=0;i--){
    const d = new Date(last.getTime() - i*7*86400000);
    weeks.push({from: d.toISOString().slice(0,10), meters: 0});
  }
  const idx = {}; weeks.forEach((w,i)=>{ idx[w.from] = i; });
  DATA.production.forEach(r=>{
    if(!r.date) return;
    const i = idx[graphsWeekStart(r.date)];
    if(i !== undefined) weeks[i].meters += Number(r.qty)||0;
  });
  return weeks;
}
function graphsLatestEntryDate(){
  let best = '';
  [DATA.production, DATA.sale, DATA.recovery, DATA.expense].forEach(arr=>{ (arr||[]).forEach(r=>{ if(r.date && r.date > best) best = r.date; }); });
  return best;
}
const GRAPHS_TOP_QUALITIES = 6, GRAPHS_TOP_CLIENTS = 6;
function computeGraphsData(monthKeys, withPrev){
  const expOf = s => s.bizExpMonth+s.famExpMonth+s.personalExpMonth+s.warpCostMonth+s.weftCostMonth;
  const series = arr => ({
    produced: arr.map(s=>s.producedMonth), sold: arr.map(s=>s.soldMonth), sales: arr.map(s=>s.salesAmtMonth),
    expenses: arr.map(expOf), profit: arr.map(s=>s.profitMonth), received: arr.map(s=>s.receivedMonth),
    receivable: arr.map(s=>s.receivable),
  });
  const per = monthKeys.map(k=> computeStats(k));
  const cur = series(per);
  const prev = withPrev ? series(monthKeys.length ? graphsPrevMonthKeys(monthKeys).map(k=> computeStats(k)) : []) : null;
  const sum = a => a.reduce((s,v)=>s+(Number(v)||0),0);
  const totals = {}, prevTotals = prev ? {} : null;
  ['produced','sold','sales','expenses','profit','received'].forEach(k=>{ totals[k] = sum(cur[k]); if(prev) prevTotals[k] = sum(prev[k]); });
  // Rs per meter sold, and share of the month's sales that came in as cash (null when nothing was sold)
  cur.avgRate = cur.sales.map((v,i)=> cur.sold[i] > 0 ? v/cur.sold[i] : null);
  cur.collection = cur.sales.map((v,i)=> v > 0 ? cur.received[i]/v*100 : null);
  // which months have any activity at all (the in-progress month is judged separately by the page)
  cur.active = monthKeys.map((k,i)=> !!(cur.produced[i] || cur.sold[i] || cur.sales[i] || cur.expenses[i] || cur.received[i]));

  const bounds = monthKeys.length ? {start: periodBounds(monthKeys[0]).start, end: periodBounds(monthKeys[monthKeys.length-1]).end} : {start:null, end:null};
  // Production by quality, per month (top qualities, the rest folded into "Other")
  const qByMonth = monthKeys.map(k=>{ const b = periodBounds(k); return sumWhereBy(DATA.production,'quality','qty',b.start,b.end); });
  const qTot = {};
  qByMonth.forEach(m=> Object.keys(m).forEach(q=>{ qTot[q] = (qTot[q]||0) + m[q]; }));
  const qNames = Object.keys(qTot).filter(q=> qTot[q] > 0).sort((a,b)=> qTot[b]-qTot[a]);
  const qualities = qNames.slice(0, GRAPHS_TOP_QUALITIES).map(q=>({name:q, values: qByMonth.map(m=> m[q]||0)}));
  const rest = qNames.slice(GRAPHS_TOP_QUALITIES);
  if(rest.length) qualities.push({name:'Other', values: qByMonth.map(m=> rest.reduce((s,q)=>s+(m[q]||0),0))});
  // Top clients by sales amount over the whole shown range
  const cAmt = sumWhereBy(activeSaleRows(),'client','amount',bounds.start,bounds.end);
  const cQty = sumWhereBy(activeSaleRows(),'client','qty',bounds.start,bounds.end);
  const cAll = Object.keys(cAmt).filter(c=> cAmt[c] > 0).sort((a,b)=> cAmt[b]-cAmt[a]).map(c=>({name:c, amount:cAmt[c], qty:cQty[c]||0}));
  const clientsTotal = sum(cAll.map(c=>c.amount));
  const topClients = cAll.slice(0, GRAPHS_TOP_CLIENTS);
  const others = cAll.slice(GRAPHS_TOP_CLIENTS);
  const clients = {top: topClients, total: clientsTotal, othersAmount: sum(others.map(c=>c.amount)), othersCount: others.length};
  // Where the money went over the shown range
  const wages = sum(per.map(s=>s.wagesPaidMonth));
  const expenseSplit = [
    {key:'Wages', value: wages},
    {key:'Business', value: sum(per.map(s=>s.bizExpMonth)) - wages},
    {key:'Family', value: sum(per.map(s=>s.famExpMonth))},
    {key:'Personal', value: sum(per.map(s=>s.personalExpMonth))},
    {key:'Warp (Tana)', value: sum(per.map(s=>s.warpCostMonth))},
    {key:'Weft (Bana)', value: sum(per.map(s=>s.weftCostMonth))},
  ].filter(x=> x.value > 0);
  // what clients owed just before the first shown month, so the page can say how receivable moved over the range
  const startReceivable = monthKeys.length ? computeStats(graphsShiftMonthKey(monthKeys[0], -1)).receivable : 0;
  return {monthKeys, cur, prev, totals, prevTotals, qualities, clients, expenseSplit, bounds, startReceivable};
}

/* ---------------- Cost & Margin per meter (v3.18.9) ----------------
 * Estimates, not accounts: yarn use per meter comes from two rules fitted to the ledger (Nov 2025 - Oct 2026):
 *   warp lbs/m = warpK x reed x (width + widthAdd) / count      weft lbs/m = weftK x picks x width
 * Rent, "staff + other" per meter and the rest live in DATA.costSettings (edited on the Cost & Margin page). */
const COST_DEFAULTS = {
  warpK: 0.00145, weftK: 0.0000364, widthAdd: 2, width: 64, widthByReed: {72: 65},
  otherPerM: 4, elecPerM: 4.3, startMonth: '2026-09', weftCount: 36,
  rent: [{from: '2026-01', amount: 58500}, {from: '2026-11', amount: 64350}],
  warpCount: {'150.144 Micro': 36, '100.144 Micro': 52}, bills: {},
};
function costCfg(){ return Object.assign({}, COST_DEFAULTS, DATA.costSettings || {}); }
function costWarpLbs(reed, width, count, cfg){ cfg = cfg || costCfg(); return count > 0 ? cfg.warpK * reed * (width + cfg.widthAdd) / count : 0; }
function costWeftLbs(picks, width, cfg){ cfg = cfg || costCfg(); return cfg.weftK * picks * width; }
function costRent(month, cfg){ cfg = cfg || costCfg(); let r = 0; cfg.rent.slice().sort((a, b) => a.from < b.from ? -1 : 1).forEach(e => { if(e.from <= month) r = Number(e.amount) || 0; }); return r; }
// Newest purchase rate on or before `date` (any date when null), optionally for one yarn type.
function costLastRate(list, date, type){
  let best = null;
  (list || []).forEach(x => {
    if(type && x.type !== type) return;
    if(date && x.date > date) return;
    if(!best || (x.date + (x.time || '')) >= (best.date + (best.time || ''))) best = x;
  });
  return best ? Number(best.rate) || 0 : 0;
}
function costWageRate(quality, date){
  let r = 0;
  ((DATA.wageRateHistory || {})[quality] || []).slice().sort((a, b) => a.date < b.date ? -1 : 1).forEach(e => { if(e.date <= date) r = Number(e.rate) || 0; });
  return r;
}
// One quality, one set of rates -> cost per meter by line. i: reed,width,picks,count,warpRate,weftRate,wage,power,rent,other
function costBreakdown(i){
  const cfg = costCfg(), wl = costWarpLbs(i.reed, i.width, i.count, cfg), fl = costWeftLbs(i.picks, i.width, cfg);
  const lines = {warp: wl * i.warpRate, weft: fl * i.weftRate, wage: i.wage || 0, power: i.power || 0, rent: i.rent || 0, other: i.other != null ? i.other : cfg.otherPerM};
  const total = Object.keys(lines).reduce((s, k) => s + lines[k], 0);
  return {lines, total, warpLbs: wl, weftLbs: fl};
}
function costSaleRate(month, quality){
  const rows = (DATA.sale || []).filter(s => s.date.slice(0, 7) === month && (!quality || s.quality === quality));
  const q = rows.reduce((s, x) => s + x.qty, 0);
  return q ? rows.reduce((s, x) => s + x.amount, 0) / q : 0;
}
// A whole month (v3.18.30): yarn from the use rules at the lot rates in force; wages = what that month's production earned
// (computeWages, paid or not); electricity = the whole bill you type; every other expense recorded in the month. All of it is
// spread over the month's meters; the current month only counts wages up to today. Salary/Wages expense entries are skipped when the Wages page already holds staff salaries.
function costMonth(month, bill){
  const cfg = costCfg(), today = todayStr(), partial = month === today.slice(0, 7), from = month + '-01', to = partial ? today : month + '-31', by = {};
  let M = 0, linked = 0;
  (DATA.production || []).filter(r => r.date.slice(0, 7) === month).forEach(r => {
    const q = (DATA.qualities || []).find(x => x.name === r.quality); if(!q) return;
    const width = cfg.widthByReed[q.kangi] || cfg.width, count = cfg.warpCount[q.warpType] || 36;
    const b = (DATA.warpBeams || []).find(x => x.id === r.beam), p = b && (DATA.warp || []).find(x => x.id === b.purchaseId);
    if(p) linked += r.qty;
    const wr = p ? Number(p.rate) : costLastRate(DATA.warp, r.date, q.warpType), fr = costLastRate(DATA.weft, r.date);
    const o = by[r.quality] || (by[r.quality] = {quality: r.quality, m: 0, warp: 0, weft: 0});
    o.m += r.qty; M += r.qty;
    o.warp += r.qty * costWarpLbs(q.kangi, width, count, cfg) * wr;
    o.weft += r.qty * costWeftLbs(q.picks, width, cfg) * fr;
  });
  const est = partial || !(bill > 0), power = est ? cfg.elecPerM * M : Number(bill);   // a running month has no bill yet: never spread a bill over part of a month
  const wr = M ? computeWages(from, to) : [], wages = wr.reduce((s, x) => s + x.totalWages, 0), staff = wr.reduce((s, x) => s + x.salary, 0);
  const inMonth = (DATA.expense || []).filter(e => e.date.slice(0, 7) === month && e.category !== 'Electricity');
  const skip = e => e.category === 'Salary/Wages' && staff > 0, exp = inMonth.filter(e => !skip(e)).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const skipped = inMonth.filter(skip).reduce((s, e) => s + (Number(e.amount) || 0), 0), all = costSaleRate(month, null);
  const shared = M ? {wage: wages / M, power: power / M, other: exp / M} : {wage: 0, power: 0, other: 0};
  const rows = Object.keys(by).map(k => {
    const o = by[k], sale = costSaleRate(month, k) || all, lines = Object.assign({warp: o.warp / o.m, weft: o.weft / o.m}, shared);
    const cost = Object.keys(lines).reduce((s, x) => s + lines[x], 0);
    return {quality: k, m: o.m, lines, cost, sale, margin: sale - cost, profit: (sale - cost) * o.m};
  });
  const sum = f => rows.reduce((s, r) => s + f(r), 0), tot = {};
  ['warp', 'weft', 'wage', 'power', 'other'].forEach(k => { tot[k] = M ? sum(r => r.lines[k] * r.m) / M : 0; });
  return {month, M, linked, est, partial, rows, lines: tot, cost: M ? sum(r => r.cost * r.m) / M : 0, sale: M ? sum(r => r.sale * r.m) / M : 0, profit: sum(r => r.profit), totals: {wages, power, exp, skipped}};
}
// Overheads per meter for a quote: the latest month that has a saved electricity bill (else last month, bill estimated).
function costRefOverhead(){
  const bills = costCfg().bills || {}, d = new Date(todayStr().slice(0, 7) + '-01T00:00:00'); d.setMonth(d.getMonth() - 1);
  const prev = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  for(const m of Object.keys(bills).filter(k => bills[k] > 0).sort().reverse().concat([prev])){
    const r = costMonth(m, bills[m]); if(r.M) return {month: m, est: !(bills[m] > 0), wage: r.lines.wage, power: r.lines.power, other: r.lines.other};
  }
  return {month: prev, est: true, wage: 0, power: 0, other: 0};
}
// Live profit at a negotiated rate. inp = the Grey Cloth Rate inputs; yarn from the real use rules, overheads from the reference month.
function costQuote(inp, agreed){
  const cfg = costCfg(), ref = costRefOverhead(), wl = costWarpLbs(inp.thread, inp.width, inp.warpCount, cfg), fl = costWeftLbs(inp.picks, inp.width, cfg);
  const lines = {warp: wl * inp.warpRate, weft: fl * inp.weftRate, wage: ref.wage, power: ref.power, other: ref.other};
  const cost = Object.keys(lines).reduce((s, k) => s + lines[k], 0);
  return {lines, cost, margin: agreed - cost, ref, warpLbs: wl, weftLbs: fl};
}

/* ---------------- Client orders (v3.18.12) ----------------
 * An order is one client + one quality + an agreed rate. Sales point at it with sale.order; the order never
 * closes by itself because deliveries never land on the exact meters (closed = the owner's call). */
function orderStats(o, today){
  const live = s => s.lStatus !== 'applied' && s.lStatus !== 'returned', sum = (a, f) => a.reduce((t, r) => t + (Number(f(r)) || 0), 0);
  const rows = (DATA.sale || []).filter(s => s.order === o.id && live(s));
  const got = sum(rows, r => r.qty), val = sum(rows, r => r.amount), qty = Number(o.qty) || 0;
  const tol = o.tolerance !== undefined && o.tolerance !== '' && o.tolerance !== null ? Number(o.tolerance) : 5;
  const diff = got - qty, pct = qty ? diff / qty * 100 : 0;
  const d = new Date((today || todayStr()) + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const mon = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const stock = Math.max(0, sum((DATA.production || []).filter(p => p.quality === o.quality), r => r.qty) - sum((DATA.sale || []).filter(s => s.quality === o.quality && live(s)), r => r.qty));
  const pending = Math.max(0, qty - got);
  return {got, val, qty, avg: got ? val / got : 0, diff, pct, tol, pending, stock, toWeave: Math.max(0, pending - stock), batches: rows.length,
    last: rows.reduce((m, r) => r.date > m ? r.date : m, ''), weekGot: sum(rows.filter(r => r.date >= mon), r => r.qty),
    offRate: rows.filter(r => Number(r.rate) !== Number(o.rate)).length,
    status: o.revoked ? 'revoked' : o.closed ? 'closed' : pct > tol ? 'over' : got > 0 && pct >= -tol ? 'within' : got > 0 ? 'open' : 'new'};
}
/* How fast an order is being delivered (v3.18.28): meters per week over the last 28 days, the weeks left at that pace, and days since the last delivery. */
function orderPace(o, today){
  today = today || todayStr();
  const live = s => s.lStatus !== 'applied' && s.lStatus !== 'returned', rows = (DATA.sale || []).filter(s => s.order === o.id && live(s));
  const day = x => Math.round(new Date(x + 'T00:00:00').getTime() / 86400000), t = day(today);
  const recent = rows.filter(r => r.date && t - day(r.date) >= 0 && t - day(r.date) < 28).reduce((m, r) => m + (Number(r.qty) || 0), 0);
  const last = rows.reduce((m, r) => r.date > m ? r.date : m, ''), pending = Math.max(0, (Number(o.qty) || 0) - rows.reduce((m, r) => m + (Number(r.qty) || 0), 0));
  const perWeek = recent / 4;
  return {perWeek, weeks: perWeek > 0 && pending > 0 ? pending / perWeek : null, last, since: last ? t - day(last) : null, age: o.date ? t - day(o.date) : 0};
}
/* Revoking an order (v3.18.17): both parties cancel the rest of an order on agreed terms. Deliveries already made stay on it. */
function orderDeliveries(id){ return (DATA.sale || []).filter(s => s.order === id).length; }
function orderRevoke(id, date, terms){
  const o = (DATA.orders || []).find(x => x.id === id); if(!o || o.revoked) return null;
  o.revoked = {date, terms: terms || '', delivered: Math.round(orderStats(o).got), rate: o.rate}; // frozen now: later sale edits must not change the notice
  o.closed = true; return o;
}
// Undo: refused when the replacement made for it already has deliveries; a replacement made with the revoke and still empty goes with it; a linked pre-existing order is only unlinked.
function orderUndoRevoke(id){
  const o = (DATA.orders || []).find(x => x.id === id); if(!o || !o.revoked) return {ok: false, reason: 'notRevoked'};
  const nx = o.revoked.newId ? DATA.orders.find(x => x.id === o.revoked.newId) : null; let removed = '';
  if(nx && o.revoked.newMade){
    if(orderDeliveries(nx.id)) return {ok: false, reason: 'replacementHasDeliveries', no: nx.no};
    DATA.orders = DATA.orders.filter(x => x.id !== nx.id); removed = nx.no || '';
  } else if(nx) delete nx.replaces;
  delete o.revoked; o.closed = false; return {ok: true, removed};
}
function orderLinkReplacement(oldId, newId){
  const os = DATA.orders || [], o = os.find(x => x.id === oldId), n = os.find(x => x.id === newId);
  if(!o || !o.revoked || o.revoked.newId) return {ok: false, reason: 'notLinkable'};
  if(!n || n.id === o.id || n.revoked || n.closed || n.replaces || n.client !== o.client) return {ok: false, reason: 'badTarget'};
  o.revoked.newId = n.id; o.revoked.newMade = false; n.replaces = o.id; return {ok: true};
}
// What an edit changes, as short lines for the order's history.
function orderChanges(o, rec){
  const f = [['qty', 'Meters', v => fmtNum(v)], ['rate', 'Rate Rs', v => v], ['tolerance', 'Tolerance %', v => v === '' || v === undefined ? 'default' : v], ['minBatch', 'Minimum batch', v => v || 'none'], ['weekly', 'Per week', v => v || 'none'], ['date', 'Date', v => v], ['client', 'Client', v => v], ['quality', 'Quality', v => v], ['width', 'Width', v => v]];
  return f.filter(([k]) => (k !== 'width' || (o.width !== undefined && o.width !== '')) && rec[k] !== undefined && String(rec[k] === undefined ? '' : rec[k]) !== String(o[k] === undefined ? '' : o[k])).map(([k, l, fm]) => l + ' ' + fm(o[k]) + ' to ' + fm(rec[k]));
}
// Everything the completion statement of an order shows (v3.18.21). The balance is the client's whole account (all orders), as of today.
function orderCompletion(o, today){
  const st = orderStats(o, today), live = s => s.lStatus !== 'applied' && s.lStatus !== 'returned';
  const rows = (DATA.sale || []).filter(s => s.order === o.id && live(s)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const within = Math.abs(st.pct) <= st.tol;
  return {rows, got: st.got, val: st.val, avg: st.avg, qty: st.qty, diff: st.diff, pct: st.pct, tol: st.tol, within, offRate: st.offRate,
    completedOn: o.completedOn || st.last || o.date || '', balance: clientReceivableNow(o.client)};
}
function orderSaleWarn(rec){
  const o = (DATA.orders || []).find(x => x.id === rec.order); if(!o) return '';
  const w = []; if(o.revoked) w.push('This order was revoked.'); else if(o.closed) w.push('This order is already marked complete.');
  if(Number(o.minBatch) > 0 && Number(rec.qty) < Number(o.minBatch)) w.push('This batch is below the order minimum of ' + o.minBatch + ' m.');
  return w.join(' ');
}
