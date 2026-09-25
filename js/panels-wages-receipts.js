/* Wages, Loans, Grey Cloth Rate calculator, Cash Checkpoints, the shared log table
 * (search / pages), row buttons, and receipts / client statements (print, PDF, share). */

/* ---------------- Wages (mirrors the Wages sheet logic exactly) ---------------- */

// The Quality Rates table on the Wages card, scoped to the selected Wage Period: shows the
// rate in effect as of the period's own To date (falling back to today if To is blank) rather
// than always "today's current rate" — so picking a past period shows what actually applied
// back then. "Effective" reflects THAT specific rate entry's own effective-from date, with a
// note when the rate changed partway through the selected period (production earlier in the
// period still used the earlier rate — see rateForQualityOn/computeWageMeters for the actual
// per-entry math; this row is just a summary, not a claim that one flat rate covered the
// whole range). Re-run on every Wage Period date change (see recalc in wiring.js) as well as
// on initial panel render.
function qualityRateRowsHtml(from, to){
  if(!DATA.qualities.length) return '';
  const asOf = to || todayStr();
  return DATA.qualities.map(q=>{
    const hist = sortedRateHistory(q.name);
    if(!hist.length) return `<tr><td>${escHtml(q.name)}</td><td class="mono"><b>${fmtRs2(0)}</b></td><td class="note" style="margin:0">—</td></tr>`;
    const rate = rateForQualityOn(q.name, asOf);
    let applicable = hist[0];
    for(const entry of hist){ if(entry.date <= asOf) applicable = entry; else break; }
    const changedWithin = from && applicable.date > from && applicable.date <= asOf;
    const since = `since ${fmtDate(applicable.date)}${changedWithin ? ' · changed during this period' : ''}`;
    return `<tr><td>${escHtml(q.name)}</td><td class="mono"><b>${fmtRs2(rate)}</b></td><td class="note" style="margin:0">${since}</td></tr>`;
  }).join('');
}
// The Rate History list under "Change a Rate" — every effective-from/rate pair ever entered,
// newest first per quality. Not period-scoped (it's a log, not a period summary), but does
// need to be regenerated after adding a new rate change (see saveRateChange in wiring.js),
// since that card lives outside the auto-refreshing #wagesWrap.
function rateHistoryRowsHtml(){
  return DATA.qualities.flatMap(q=>
    sortedRateHistory(q.name).slice().reverse().map(entry=>
      `<tr><td>${escHtml(q.name)}</td><td>${fmtDate(entry.date)}</td><td class="mono">${fmtRs2(entry.rate)}</td><td>${rateHistoryBtns(q.name, entry.date)}</td></tr>`)
  ).join('');
}
// Rate History entries have no id of their own — a quality can only have one entry per
// effective-from date (saving the same date again overwrites it), so quality + date identify one.
// "from 1 Jun 2026 up to the day before 1 Sep 2026" — the production days a rate entry decides.
function rateSpanText(span){
  return (span.from ? `from ${fmtDate(span.from)}` : 'from the earliest entries')
    + (span.to ? ` up to the day before ${fmtDate(span.to)}` : ' onward');
}
function rateHistoryBtns(quality, date){
  const a = `data-rh-q="${escHtml(quality)}" data-rh-d="${escHtml(date)}"`;
  return `<span class="row-actions"><button class="ghost rowbtn edit" data-rh-edit ${a} aria-label="Edit" title="Edit"><span class="ic">${ICON_EDIT}</span><span class="lbl">Edit</span></button><button class="ghost rowbtn del" data-rh-del ${a} aria-label="Remove" title="Remove"><span class="ic">${ICON_TRASH}</span><span class="lbl">Remove</span></button></span>`;
}
// The whole Rate History block (heading + table), or '' when no rate was ever entered. Used for
// both the first render and the refresh after add / edit / delete.
function rateHistoryBlockHtml(){
  const rows = rateHistoryRowsHtml();
  return rows ? `<table style="margin-top:6px"><thead><tr><th>Quality</th><th>Effective From</th><th>Rate (Rs/m)</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>` : '';
}
function wagesPanel(){
  const dates = DATA.production.map(r=>r.date).filter(Boolean).sort();
  const from = DATA.wageFrom || dates[0] || todayStr();
  const to = DATA.wageTo || dates[dates.length-1] || todayStr();
  const rateRows = qualityRateRowsHtml(from, to);
  // Inactive employees drop off every table on this page once fully settled (balance and
  // carry-forward both zero) — but stay visible as long as something's still unresolved,
  // so a real outstanding balance never quietly disappears just because someone left.
  const relevantEmps = wageRelevantEmployees();
  const neverSettled = relevantEmps.filter(emp=>!DATA.wageSettlements.some(s=>s.employee===emp.name));
  const openingBalanceCard = neverSettled.length ? `
    <div class="card"><div class="card-head"><h2>Set Opening Balances</h2><button type="button" class="info-btn" data-info-toggle data-info-target="info-openingbalances" title="Info">i</button></div>
      ${formToggleBtn('openingBalances','Form')}
      <div ${formBodyOpen('openingBalances')}>
      <p class="note info-note" id="info-openingbalances" hidden>These employees have never been settled, so their Balance currently counts ALL historical production as unpaid — misleading if they were already paid the old way before you started logging payments here. Set a starting figure below (0 if they were already square, or a specific amount if not) to draw a clean line as of the date you choose. This card disappears once an employee has a starting balance.</p>
      <div class="grid cols-2">
        ${field('As Of Date','ob_date','date',`value="${todayStr()}"`)}
      </div>
      <table style="margin-top:14px">
        <thead><tr><th>Employee</th><th>Carry Forward (Rs)</th></tr></thead>
        <tbody>${neverSettled.map(emp=>`<tr><td><span class="name">${escHtml(emp.name)}</span></td><td><input type="number" step="0.01" value="0" data-ob-emp="${escHtml(emp.name)}" style="max-width:150px"></td></tr>`).join('')}</tbody>
      </table>
      <button class="primary" id="saveOpeningBalances" style="margin-top:14px">Save Opening Balances</button>
      </div>
    </div>
  ` : '';
  const settleAllRows = relevantEmps.map(emp=>{
    const b = computeEmployeeWageBalance(emp.name);
    return `<tr><td><span class="name">${escHtml(emp.name)}</span></td><td>${fmtRs2(b.balance)}</td><td><input type="number" step="0.01" value="${Math.round(b.balance*100)/100}" data-sa-emp="${escHtml(emp.name)}" style="max-width:150px"></td></tr>`;
  }).join('');
  const settleAllCard = relevantEmps.length ? `
    <div class="card"><div class="card-head"><h2>Settle All Employees</h2><button type="button" class="info-btn" data-info-toggle data-info-target="info-settleall" title="Info">i</button></div>
      ${formToggleBtn('settleAll','Form')}
      <div ${formBodyOpen('settleAll')}>
      <p class="note info-note" id="info-settleall" hidden>Marks every employee as settled as of one date in a single click — for when you've paid everyone up to a certain point (e.g. "paid all employees through 27 Aug"). Carry Forward is pre-filled with each employee's current computed balance (0 if you've genuinely paid them in full); adjust any row before saving if one of them still has something outstanding.</p>
      <div class="grid cols-2">
        ${field('Settled As Of','sa_date','date',`value="${todayStr()}"`)}
      </div>
      <table style="margin-top:14px">
        <thead><tr><th>Employee</th><th>Current Balance</th><th>Carry Forward (Rs)</th></tr></thead>
        <tbody>${settleAllRows}</tbody>
      </table>
      <button class="primary" id="settleAllEmployees" style="margin-top:14px">Settle All Employees</button>
      </div>
    </div>
  ` : '';
  return `
    <div class="card"><h2>Wage Period & Quality Rates</h2>
      <div class="grid cols-2">
        ${field('From Date','wg_from','date',`value="${from}"`)}
        ${field('To Date','wg_to','date',`value="${to}"`)}
      </div>
      <table style="margin-top:14px">
        <thead><tr><th>Quality</th><th>Current Rate (Rs/m)</th><th>Effective</th></tr></thead>
        <tbody id="wg_rateRowsBody">${rateRows || '<tr><td colspan="3" class="empty">Add qualities in the settings tab first</td></tr>'}</tbody>
      </table>
      <div class="note">Wages = meters produced (own logged meters + their share of any unassigned Difference) × the rate in effect on that production's own date — so changing a rate below only affects entries from its effective date onward; already-settled wages stay locked in. Bonuses are logged per employee below instead of a flat period amount.</div>
      <div class="card-head rate-head"><div class="group-label" style="margin:0;padding:0;border:0">Rate History</div>${formToggleBtn('rateChange','Change a Rate',true)}</div>
      <div class="form-above-log" ${formBodyOpen('rateChange')}>
      <div class="grid cols-3" style="margin-top:2px">
        <div class="field"><label>Quality</label><select id="rc_quality">${opts(DATA.qualities)}</select></div>
        <div class="field"><label>New Rate (Rs/m)</label><input type="number" step="0.01" id="rc_rate"></div>
        <div class="field"><label>Effective From</label><input type="date" id="rc_date" value="${todayStr()}"></div>
      </div>
      <div class="form-actions">
        <button class="primary" id="saveRateChange">Save New Rate</button>
        <button class="ghost" id="cancelRateChange" style="display:none">Cancel Edit</button>
      </div>
      <div class="rate-warn" id="rc_editNote" role="alert" hidden></div>
      </div>
      <div class="rate-warn" id="rh_delNote" role="alert" hidden></div>
      <div id="wg_rateHistoryWrap">${rateHistoryBlockHtml()}</div>
    </div>
    <div id="wagesWrap"></div>
    <div class="card"><div class="card-head"><h2>Wage Payments Log</h2><span class="head-actions"><button type="button" class="info-btn" data-info-toggle data-info-target="info-wagepayment" title="Info">i</button>${formToggleBtn('wagePayments','Form',true)}</span></div>
      <div class="form-above-log" ${formBodyOpen('wagePayments')}>
      <p class="note info-note" id="info-wagepayment" hidden>Picking an Employee auto-fills the Amount with wages + bonus owed for this period only. For money advanced to an employee separate from wages, use the Loans tab instead.</p>
      <div class="grid cols-2">
        ${field('Date','wp_date','date',`value="${todayStr()}"`)}
        ${employeeSelectField('Employee','wp_emp')}
      </div>
      <div class="grid cols-2" style="margin-top:12px">
        ${field('Amount Paid (Rs)','wp_amt','number')}
      </div>
      <div class="note" id="wp_helper" style="margin-top:8px"></div>
      <div class="grid cols-1" style="margin-top:12px">
        ${textareaField('Remarks (optional)','wp_rem')}
      </div>
      <div class="form-actions">
        <button class="primary" id="addWagePayment">Add Payment</button>
        <button class="ghost" id="cancelWagePayments" style="display:none">Cancel Edit</button>
      </div>
      </div>
      ${logTable('wagePayments',
        ['Date','Employee','Amount','Remarks',''],
        DATA.wagePayments.slice().reverse(),
        r=>[fmtDate(r.date), `<span class="name">${escHtml(r.employee)}</span>`, fmtRs2(r.amount), escHtml(r.remarks||'—'), actionBtns('wagePayments',r.id)]
      )}</div>
    <div class="card"><div class="card-head"><h2>Bonus Log</h2>${formToggleBtn('wageBonuses','Form',true)}</div>
      <div class="form-above-log" ${formBodyOpen('wageBonuses')}>
      <div class="grid cols-3">
        ${field('Date','wb_date','date',`value="${todayStr()}"`)}
        ${employeeSelectField('Employee','wb_emp')}
        ${field('Bonus Amount (Rs)','wb_amt','number')}
      </div>
      <div class="grid cols-1" style="margin-top:12px">
        ${textareaField('Remarks (optional)','wb_rem')}
      </div>
      <div class="form-actions">
        <button class="primary" id="addWageBonus">Add Bonus</button>
        <button class="ghost" id="cancelWageBonuses" style="display:none">Cancel Edit</button>
      </div>
      </div>
      ${logTable('wageBonuses',
        ['Date','Employee','Amount','Remarks',''],
        DATA.wageBonuses.slice().reverse(),
        r=>[fmtDate(r.date), `<span class="name">${escHtml(r.employee)}</span>`, fmtRs2(r.amount), escHtml(r.remarks||'—'), actionBtns('wageBonuses',r.id)]
      )}</div>
    ${openingBalanceCard}
    ${settleAllCard}
    <div class="card"><div class="card-head"><h2>Settlements Log</h2><span class="head-actions"><button type="button" class="info-btn" data-info-toggle data-info-target="info-settlement" title="Info">i</button>${formToggleBtn('wageSettlements','Form',true)}</span></div>
      <div class="form-above-log" ${formBodyOpen('wageSettlements')}>
      <p class="note info-note" id="info-settlement" hidden>Mark an employee as settled as of a date. Carry Forward auto-fills with their current balance — leave it as-is if nothing changed, or edit it if you and the employee agreed on a different figure. Positive = you still owe them; negative = they've been paid ahead and owe a credit back; 0 = fully settled.</p>
      <div class="grid cols-2">
        ${employeeSelectField('Employee','ws_emp')}
        ${field('Settled As Of','ws_date','date',`value="${todayStr()}"`)}
      </div>
      <div class="grid cols-2" style="margin-top:12px">
        ${field('Carry Forward (Rs)','ws_carry','number','step="0.01" value="0"')}
        <div></div>
      </div>
      <div class="grid cols-1" style="margin-top:12px">
        ${textareaField('Remarks (optional)','ws_rem')}
      </div>
      <div class="form-actions">
        <button class="primary" id="addWageSettlement">Mark Settled</button>
        <button class="ghost" id="cancelWageSettlements" style="display:none">Cancel Edit</button>
      </div>
      </div>
      ${logTable('wageSettlements',
        ['Date','Employee','Carried Forward','Remarks',''],
        DATA.wageSettlements.slice().reverse(),
        r=>[fmtDate(r.date), `<span class="name">${escHtml(r.employee)}</span>`, r.carryForward?fmtRs2(r.carryForward):'0.00', escHtml(r.remarks||'—'), actionBtns('wageSettlements',r.id)]
      )}</div>
  `;
}
function renderWages(){
  const from = v('wg_from'), to = v('wg_to');
  const rows = computeWages(from, to);
  const qualities = DATA.qualities;
  const wrap = document.getElementById('wagesWrap');
  if(!qualities.length || !DATA.employees.length){
    wrap.innerHTML = `<div class="card"><div class="empty">Add employees and qualities in the settings tab to see wages.</div></div>`;
    return;
  }
  const showNum = n => n ? fmtQtyMtr(n) : '';
  const showRs2 = n => n ? fmtRs2(n) : '';
  const totalMeters = qualities.map((q,i)=>rows.reduce((s,r)=>s+r.byQuality[i].meters,0));
  const totalWages = qualities.map((q,i)=>rows.reduce((s,r)=>s+r.byQuality[i].wages,0));
  // Only show a quality's column on each table if someone actually has meters/wages
  // logged against it in this period — an all-zero quality just clutters the table.
  const meterIdx = qualities.map((q,i)=>i).filter(i=>totalMeters[i] !== 0);
  const wageIdx = qualities.map((q,i)=>i).filter(i=>totalWages[i] !== 0);
  const meterHead = meterIdx.map(i=>`<th>${escHtml(qualities[i].name)}</th>`).join('');
  const wageHead = wageIdx.map(i=>`<th>${escHtml(qualities[i].name)} (Rs)</th>`).join('');
  // Diff, broken out per quality (each quality's own rate applies to its own diff share —
  // see computeWageMeters/computeWages — this just surfaces that per-quality split in the
  // table instead of folding it into one combined figure).
  const diffMetersByQ = qualities.map((q,i)=>rows.reduce((s,r)=>s+r.byQuality[i].diffMeters,0));
  const diffWagesByQ = qualities.map((q,i)=>rows.reduce((s,r)=>s+r.byQuality[i].diffWages,0));
  const meterDiffHead = meterIdx.map(i=>`<th>${escHtml(qualities[i].name)} Diff</th>`).join('');
  const wageDiffHead = wageIdx.map(i=>`<th>${escHtml(qualities[i].name)} Diff (Rs)</th>`).join('');
  const meterRows = rows.map(r=>`<tr><td><span class="name">${escHtml(r.employee)}</span></td>${meterIdx.map(i=>`<td>${showNum(r.byQuality[i].meters)}</td>`).join('')}${meterIdx.map(i=>`<td class="mono">${showNum(r.byQuality[i].diffMeters)}</td>`).join('')}<td class="mono">${showNum(r.totalMeters - r.totalDiffMeters)}</td><td class="mono"><b>${showNum(r.totalMeters)}</b></td></tr>`).join('');
  const wageRows = rows.map(r=>`<tr><td><span class="name">${escHtml(r.employee)}</span></td>${wageIdx.map(i=>`<td>${showRs2(r.byQuality[i].wages)}</td>`).join('')}${wageIdx.map(i=>`<td class="mono">${showRs2(r.byQuality[i].diffWages)}</td>`).join('')}<td class="mono">${showRs2(r.totalWagesNoBonus - r.totalDiffWages)}</td><td class="mono"><b>${showRs2(r.totalWagesNoBonus)}</b></td><td>${showRs2(r.bonus)}</td><td class="mono"><b>${showRs2(r.totalWages)}</b></td></tr>`).join('');
  const grandMeters = totalMeters.reduce((a,b)=>a+b,0);
  const grandDiffMeters = rows.reduce((s,r)=>s+r.totalDiffMeters,0);
  const grandBonus = rows.reduce((s,r)=>s+r.bonus,0);
  const grandDiffWages = rows.reduce((s,r)=>s+r.totalDiffWages,0);
  const grandWagesNoBonus = totalWages.reduce((a,b)=>a+b,0);
  const grandWages = grandWagesNoBonus + grandBonus;
  // A signed amount rendered the same way everywhere on this page: positive still owed
  // (rust), negative paid ahead / a credit (green), exactly zero in plain bold.
  const signedCell = (amount, owedWord, creditWord)=> amount > 0.004
    ? `<span style="color:var(--rust)"><b>${fmtRs(amount)}</b>${owedWord?' '+owedWord:''}</span>`
    : amount < -0.004
      ? `<span style="color:var(--green)"><b>${fmtRs(Math.abs(amount))}</b>${creditWord?' '+creditWord:''}</span>`
      : `<b>${fmtRs(0)}</b>`;
  const balanceRows = wageRelevantEmployees().map(emp=>{
    const b = computeEmployeeWageBalance(emp.name);
    const n = computeEmployeeWageNetForPeriod(emp.name, from, to);
    const carryCell = b.carryForward
      ? (b.carryForward > 0 ? `${fmtRs2(b.carryForward)} owed` : `${fmtRs2(Math.abs(b.carryForward))} credit`)
      : '—';
    return `<tr><td><span class="name">${escHtml(emp.name)}</span></td><td>${carryCell}</td>`
      + `<td>${fmtRs2(n.earned)}</td><td>${n.paid?fmtRs2(n.paid):'—'}</td><td>${signedCell(n.net,'still due','paid ahead')}</td>`
      + `<td>${signedCell(b.balance,'owed','credit')}</td><td>${b.lastSettled?fmtDate(b.lastSettled):'Never'}</td></tr>`;
  }).join('');
  wrap.innerHTML = `
    <div class="card"><div class="card-head"><h2>Meters by Quality (${fmtDate(from)} to ${fmtDate(to)})</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Diff = each employee's share of unassigned loom output (Qty − logged employee meters) on that quality's entries, already folded into their totals — shown per quality here so you can verify it, and so it carries that quality's own rate in the wages table below.</p>
      <table><thead><tr><th>Employee</th>${meterHead}${meterDiffHead}<th>Total (Excl. Diff)</th><th>Total Meters</th></tr></thead>
      <tbody>${meterRows || '<tr><td class="empty" colspan="99">No employees yet</td></tr>'}</tbody>
      <tfoot><tr><td><b>Total</b></td>${meterIdx.map(i=>`<td><b>${showNum(totalMeters[i])}</b></td>`).join('')}${meterIdx.map(i=>`<td><b>${showNum(diffMetersByQ[i])}</b></td>`).join('')}<td><b>${showNum(grandMeters - grandDiffMeters)}</b></td><td><b>${showNum(grandMeters)}</b></td></tr></tfoot>
      </table>
    </div>
    <div class="card"><h2>Wages by Quality (Rs)</h2>
      <table><thead><tr><th>Employee</th>${wageHead}${wageDiffHead}<th>Total (Excl. Diff)</th><th>Total (No Bonus)</th><th>Bonus (Rs)</th><th>Total Wages</th></tr></thead>
      <tbody>${wageRows || '<tr><td class="empty" colspan="99">No employees yet</td></tr>'}</tbody>
      <tfoot><tr><td><b>Total</b></td>${wageIdx.map(i=>`<td><b>${showRs2(totalWages[i])}</b></td>`).join('')}${wageIdx.map(i=>`<td><b>${showRs2(diffWagesByQ[i])}</b></td>`).join('')}<td><b>${showRs2(grandWagesNoBonus - grandDiffWages)}</b></td><td><b>${showRs2(grandWagesNoBonus)}</b></td><td><b>${showRs2(grandBonus)}</b></td><td><b>${showRs2(grandWages)}</b></td></tr></tfoot>
      </table>
    </div>
    <div class="card"><div class="card-head"><h2>Employee Wage Balances</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>"Earned" and "Paid" are scoped to the Wage Period selected above only — "Paid (This Period)" is payments dated inside that same range, so "Net (This Period)" reaches exactly 0 once you've paid what was earned there. If you later change a rate for a date inside that period, Earned (and Net) recompute — Paid does not, so Net shows exactly what's newly due. "Balance" is the separate running total since the employee's last settlement (or all-time if never settled), regardless of which period is selected — use that one to see everything currently owed. "Credit" means paid ahead of wages earned. Employee loans are tracked separately in the Loans tab.</p>
      <div class="log-scroll"><table><thead><tr><th>Employee</th><th>Carried Forward</th><th>Earned (This Period)</th><th>Paid (This Period)</th><th>Net (This Period)</th><th>Balance</th><th>Last Settled</th></tr></thead>
      <tbody>${balanceRows || '<tr><td class="empty" colspan="7">No employees yet</td></tr>'}</tbody>
      </table></div>
    </div>
  `;
}

/* ---------------- Loans (Employee) ---------------- */
// A simple, dedicated ledger for cash advanced to employees outside of wages — separate
// from the Wages tab entirely. Running balance since the beginning, no settlement concept
// (that's specific to wages, where balances reset against a wage rate).
function loansPanel(){
  const relevantEmps = loanRelevantEmployees();
  const givenTotals = sumAllAndMonth(DATA.loanPayments.filter(p=>p.type!=='Loan Repaid'), 'amount');
  const repaidTotals = sumAllAndMonth(DATA.loanPayments.filter(p=>p.type==='Loan Repaid'), 'amount');
  const totalOutstandingAll = relevantEmps.reduce((s,emp)=>{
    const b = computeEmployeeLoanBalance(emp.name);
    return s + Math.max(0, b.balance);
  }, 0);
  // Always-visible, at-a-glance outstanding status per employee — so "how much do you
  // still owe" can be answered instantly without reading the fuller balances table below.
  const outstandingRows = relevantEmps
    .map(emp=>({emp, b: computeEmployeeLoanBalance(emp.name)}))
    .filter(({b}) => b.balance > 0.004);
  const outstandingCard = outstandingRows.length ? `
    <div class="card"><div class="card-head"><h2 style="color:var(--red)">Loans Outstanding</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Live figures, always up to date — this is exactly what to tell an employee if they ask how much of their loan is still outstanding.</p>
      <table><thead><tr><th>Employee</th><th>Loan Outstanding</th></tr></thead>
      <tbody>${outstandingRows.map(({emp,b})=>`<tr><td><span class="name">${escHtml(emp.name)}</span></td><td><b style="color:var(--red);font-size:15px">${fmtRs(b.balance)}</b></td></tr>`).join('')}</tbody>
      </table>
    </div>
  ` : '';
  // Employee-wise breakdown: Given/Repaid/Balance since the beginning, plus this month's
  // net movement per employee — everything you'd otherwise need Overview for, right here.
  const empRows = relevantEmps.map(emp=>{
    const b = computeEmployeeLoanBalance(emp.name);
    const empPayments = DATA.loanPayments.filter(p=>p.employee===emp.name);
    const givenMonth = empPayments.filter(p=>p.type!=='Loan Repaid' && isThisMonth(p.date)).reduce((s,p)=>s+(Number(p.amount)||0),0);
    const repaidMonth = empPayments.filter(p=>p.type==='Loan Repaid' && isThisMonth(p.date)).reduce((s,p)=>s+(Number(p.amount)||0),0);
    return {name: emp.name, given: b.given, repaid: b.repaid, monthNet: givenMonth - repaidMonth, balance: b.balance};
  });
  const balanceRows = empRows.map(r=>{
    const balCell = r.balance > 0.004
      ? `<span style="color:var(--red)"><b>${fmtRs(r.balance)}</b> outstanding</span>`
      : r.balance < -0.004
        ? `<span style="color:var(--green)"><b>${fmtRs(Math.abs(r.balance))}</b> overpaid back</span>`
        : `<b>${fmtRs(0)}</b>`;
    return `<tr><td><span class="name">${escHtml(r.name)}</span></td><td>${fmtRs2(r.given)}</td><td>${fmtRs2(r.repaid)}</td><td>${fmtRs2(r.monthNet)}</td><td>${balCell}</td></tr>`;
  }).join('');
  const summary = `${sumCardOpen('breakdown','Employee-wise Breakdown')}
    <div class="grid cols-2" style="margin-bottom:14px">
      <div class="stat compact"><div class="label">Total Outstanding (All Employees)</div><div class="value">${fmtRs(totalOutstandingAll)}</div></div>
      <div class="stat compact"><div class="label">This Month (Given − Repaid)</div><div class="value">${fmtRs(givenTotals.month - repaidTotals.month)}</div></div>
    </div>
    <div class="log-scroll"><table><thead><tr><th>Employee</th><th>Total Given</th><th>Total Repaid</th><th>This Month</th><th>Balance</th></tr></thead>
    <tbody>${balanceRows || '<tr><td class="empty" colspan="5">No employees yet</td></tr>'}</tbody>
    <tfoot><tr><td><b>Total</b></td><td><b>${fmtRs2(givenTotals.all)}</b></td><td><b>${fmtRs2(repaidTotals.all)}</b></td><td><b>${fmtRs2(givenTotals.month-repaidTotals.month)}</b></td><td><b>${fmtRs(totalOutstandingAll)}</b></td></tr></tfoot>
    </table></div>
  ${sumCardClose()}`;
  return `
    ${summary}
    ${outstandingCard}
    <div class="card"><div class="card-head"><h2>Log Loan Payment</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Loan Given = cash handed to the employee as a loan (reduces Cash Position; doesn't affect Business Expenses or Profit/Loss, since it's not a real expense). Loan Repaid = cash they hand back against an outstanding loan (increases Cash Position).</p>
      <div class="grid cols-3">
        ${field('Date','lp_date','date',`value="${todayStr()}"`)}
        ${employeeSelectField('Employee','lp_emp')}
        <div class="field"><label>Type</label><select id="lp_type"><option>Loan Given</option><option>Loan Repaid</option></select></div>
      </div>
      <div class="grid cols-2" style="margin-top:12px">
        ${field('Amount (Rs)','lp_amt','number')}
      </div>
      <div class="note" id="lp_helper" style="margin-top:8px"></div>
      <div class="grid cols-1" style="margin-top:12px">
        ${textareaField('Remarks (optional)','lp_rem')}
      </div>
      <div class="form-actions">
        <button class="primary" id="addLoanPayment">Add Loan Entry</button>
        <button class="ghost" id="cancelLoanPayments" style="display:none">Cancel Edit</button>
      </div></div>
      <div class="card"><h2>Loan Payments Log</h2>${logTable('loanPayments',
        ['Date','Employee','Type','Amount','Remarks',''],
        DATA.loanPayments.slice().reverse(),
        r=>[fmtDate(r.date), `<span class="name">${escHtml(r.employee)}</span>`, escHtml(r.type||'—'), fmtRs2(r.amount), escHtml(r.remarks||'—'), actionBtns('loanPayments',r.id)]
      )}</div>
  `;
}

/* ---------------- Personal Loans (Given) ---------------- */
// Money lent to family or friends — a completely separate ledger from Loans (Employee).
// There's no fixed master list of people (unlike employees), so every name typed into the
// Person field is remembered as a suggestion; multiple loans to the same person are logged
// as separate entries (so each keeps its own date and remarks) but computePersonLoanBalance
// rolls them all up into one running total for that person. Same cash treatment as employee
// loans: Loan Given/Repaid moves Cash Position only, never Business Expenses or Profit/Loss.
function personalLoansPanel(){
  const people = personalLoanRelevantPeople();
  const givenTotals = sumAllAndMonth(DATA.personalLoans.filter(p=>p.type!=='Loan Repaid'), 'amount');
  const repaidTotals = sumAllAndMonth(DATA.personalLoans.filter(p=>p.type==='Loan Repaid'), 'amount');
  const totalOutstandingAll = people.reduce((s,name)=> s + Math.max(0, computePersonLoanBalance(name).balance), 0);
  const outstandingRows = people
    .map(name=>({name, b: computePersonLoanBalance(name)}))
    .filter(({b}) => b.balance > 0.004);
  const outstandingCard = outstandingRows.length ? `
    <div class="card"><div class="card-head"><h2 style="color:var(--red)">Loans Outstanding</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Live figures, always up to date — this is exactly what to tell someone if they ask how much of their loan is still outstanding.</p>
      <table><thead><tr><th>Person</th><th>Loan Outstanding</th></tr></thead>
      <tbody>${outstandingRows.map(({name,b})=>`<tr><td><span class="name">${escHtml(name)}</span></td><td><b style="color:var(--red);font-size:15px">${fmtRs(b.balance)}</b></td></tr>`).join('')}</tbody>
      </table>
    </div>
  ` : '';
  const personRows = people.map(name=>{
    const b = computePersonLoanBalance(name);
    const entries = DATA.personalLoans.filter(p=>p.person===name);
    const givenMonth = entries.filter(p=>p.type!=='Loan Repaid' && isThisMonth(p.date)).reduce((s,p)=>s+(Number(p.amount)||0),0);
    const repaidMonth = entries.filter(p=>p.type==='Loan Repaid' && isThisMonth(p.date)).reduce((s,p)=>s+(Number(p.amount)||0),0);
    return {name, given: b.given, repaid: b.repaid, monthNet: givenMonth - repaidMonth, balance: b.balance};
  });
  const balanceRows = personRows.map(r=>{
    const balCell = r.balance > 0.004
      ? `<span style="color:var(--red)"><b>${fmtRs(r.balance)}</b> outstanding</span>`
      : r.balance < -0.004
        ? `<span style="color:var(--green)"><b>${fmtRs(Math.abs(r.balance))}</b> overpaid back</span>`
        : `<b>${fmtRs(0)}</b>`;
    return `<tr><td><span class="name">${escHtml(r.name)}</span></td><td>${fmtRs2(r.given)}</td><td>${fmtRs2(r.repaid)}</td><td>${fmtRs2(r.monthNet)}</td><td>${balCell}</td></tr>`;
  }).join('');
  const summary = `${sumCardOpen('breakdown','Person-wise Breakdown')}
    <div class="grid cols-2" style="margin-bottom:14px">
      <div class="stat compact"><div class="label">Total Outstanding (All People)</div><div class="value">${fmtRs(totalOutstandingAll)}</div></div>
      <div class="stat compact"><div class="label">This Month (Given − Repaid)</div><div class="value">${fmtRs(givenTotals.month - repaidTotals.month)}</div></div>
    </div>
    <div class="log-scroll"><table><thead><tr><th>Person</th><th>Total Given</th><th>Total Repaid</th><th>This Month</th><th>Balance</th></tr></thead>
    <tbody>${balanceRows || '<tr><td class="empty" colspan="5">No loans logged yet</td></tr>'}</tbody>
    <tfoot><tr><td><b>Total</b></td><td><b>${fmtRs2(givenTotals.all)}</b></td><td><b>${fmtRs2(repaidTotals.all)}</b></td><td><b>${fmtRs2(givenTotals.month-repaidTotals.month)}</b></td><td><b>${fmtRs(totalOutstandingAll)}</b></td></tr></tfoot>
    </table></div>
  ${sumCardClose()}`;
  return `
    ${summary}
    ${outstandingCard}
    <div class="card"><div class="card-head"><h2>Log Loan Payment</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Loan Given = cash handed over as a loan (reduces Cash Position; doesn't affect Business Expenses or Profit/Loss, since it's expected back). Loan Repaid = cash they hand back against an outstanding loan (increases Cash Position). People are managed in Settings → Family Members, so the same person is always matched exactly — no typo ever splits their balance in two.</p>
      ${!DATA.familyMembers.length ? '<p class="note">No one added yet — add people to lend to in Settings → Family Members first.</p>' : ''}
      <div class="grid cols-3">
        ${field('Date','pl_date','date',`value="${todayStr()}"`)}
        ${familyMemberSelectField('Person','pl_person')}
        <div class="field"><label>Type</label><select id="pl_type"><option>Loan Given</option><option>Loan Repaid</option></select></div>
      </div>
      <div class="grid cols-2" style="margin-top:12px">
        ${field('Amount (Rs)','pl_amt','number')}
      </div>
      <div class="note" id="pl_helper" style="margin-top:8px"></div>
      <div class="grid cols-1" style="margin-top:12px">
        ${textareaField('Remarks (optional)','pl_rem')}
      </div>
      <div class="form-actions">
        <button class="primary" id="addPersonalLoan">Add Loan Entry</button>
        <button class="ghost" id="cancelPersonalLoans" style="display:none">Cancel Edit</button>
      </div></div>
      <div class="card"><h2>Loan Payments Log</h2>${logTable('personalLoans',
        ['Date','Person','Type','Amount','Remarks',''],
        DATA.personalLoans.slice().reverse(),
        r=>[fmtDate(r.date), `<span class="name">${escHtml(r.person)}</span>`, escHtml(r.type||'—'), fmtRs2(r.amount), escHtml(r.remarks||'—'), actionBtns('personalLoans',r.id)]
      )}</div>
  `;
}

/* ---------------- Grey Cloth Rate Calculator ---------------- */
// Formula (per the mill's costing sheet):
//   total threads   = thread count * (width + width addition)     [addition is usually 2, sometimes 2.5 — editable]
//   warp cost / m   = total threads / 800 / warp count * 1.0936 * warp rate per lb
//   weft cost / m   = picks * width / 800 / weft count  * 1.0936 * weft rate per lb
//   final rate / m  = warp cost + weft cost + (picks * rate per pick) + extra addition
function computeGreyRate(inp){
  const hasThreadWidth = inp.thread > 0 && inp.width > 0;   // both Kangi & Arz needed for total threads
  const totalThreads = hasThreadWidth ? (inp.thread * (inp.width + inp.widthAdd)) : 0;
  const warpValid = hasThreadWidth && inp.warpCount > 0;
  const warpCost = warpValid ? (totalThreads / 800 / inp.warpCount * 1.0936 * inp.warpRate) : 0;
  const weftValid = inp.picks > 0 && inp.width > 0 && inp.weftCount > 0;
  const weftCost = weftValid ? (inp.picks * inp.width / 800 / inp.weftCount * 1.0936 * inp.weftRate) : 0;
  const picksAddition = inp.picks * inp.pickRate;
  const finalRate = warpCost + weftCost + picksAddition + inp.extra;
  return { totalThreads, warpCost, weftCost, picksAddition, finalRate, hasThreadWidth, warpValid, weftValid };
}
function readRateCalcInputs(){
  return {
    label: v('rc_label'),
    thread: Number(v('rc_thread')||0),
    width: Number(v('rc_width')||0),
    widthAdd: Number(v('rc_widthAdd')||0),
    warpCount: Number(v('rc_warpCount')||0),
    warpRate: Number(v('rc_warpRate')||0),
    picks: Number(v('rc_picks')||0),
    weftCount: Number(v('rc_weftCount')||0),
    weftRate: Number(v('rc_weftRate')||0),
    pickRate: Number(v('rc_pickRate')||0),
    extra: Number(v('rc_extra')||0),
  };
}
function ratecalcPanel(){
  const d = DATA.rateCalcDefaults || {};
  return `
    <div class="card"><h2>Grey Cloth Rate Calculator</h2>
      <div class="grid cols-3">
        ${field('Label / Quality (optional)','rc_label','text','placeholder="e.g. 46 Picks 64 inch"')}
        ${field('Thread Count (ends/inch) <span style="color:var(--rust);font-weight:800;text-transform:none;letter-spacing:0">(Kangi)</span>','rc_thread','number')}
        ${field('Width (inches) <span style="color:var(--rust);font-weight:800;text-transform:none;letter-spacing:0">(Arz)</span>','rc_width','number')}
      </div>
      <div class="grid cols-2" style="margin-top:12px">
        ${field('Width Addition','rc_widthAdd','number',`value="${d.widthAdd!=null?d.widthAdd:2}" step="0.01" placeholder="usually 2, sometimes 2.5"`)}
        <div></div>
      </div>
      <div class="group-label">Warp (Tana)</div>
      <div class="grid cols-2">
        ${field('Warp (Tana) Count','rc_warpCount','number')}
        ${field('Warp (Tana) Rate per lb (Rs)','rc_warpRate','number')}
      </div>
      <div class="group-label">Weft (Bana)</div>
      <div class="grid cols-2">
        ${field('Weft (Bana) Count','rc_weftCount','number')}
        ${field('Weft (Bana) Rate per lb (Rs)','rc_weftRate','number')}
      </div>
      <div class="grid cols-2" style="margin-top:12px">
        ${field('No. of Picks (per inch)','rc_picks','number')}
        <div></div>
      </div>
      <div class="group-label">Additions</div>
      <div class="grid cols-2">
        ${field('Rate per Pick (Rs)','rc_pickRate','number',`value="${d.pickRate!=null?d.pickRate:0.50}" step="0.01"`)}
        ${field('Extra Addition (Rs)','rc_extra','number','step="0.01" placeholder="e.g. 1"')}
      </div>
    </div>
    <div id="rateCalcResult"></div>
    <div class="card"><h2>Saved Rate Calculations</h2>${logTable('rateCalcs',
      ['Date','Label','Kangi','Arz','Width +','Warp Count','Warp Rate','Weft Count','Weft Rate','Picks','Pick Rate','Extra','Rate / Meter',''],
      DATA.rateCalcs.slice().reverse(),
      r=>[
        fmtDate(r.date), r.label||'—',
        r.thread?fmtNum(r.thread):'—', r.width?fmtNum(r.width):'—', r.widthAdd!=null?fmtNum(r.widthAdd):'—',
        r.warpCount?fmtNum(r.warpCount):'—', r.warpRate?fmtRs2(r.warpRate):'—',
        r.weftCount?fmtNum(r.weftCount):'—', r.weftRate?fmtRs2(r.weftRate):'—',
        r.picks?fmtNum(r.picks):'—', r.pickRate?fmtRs2(r.pickRate):'—',
        r.extra?fmtRs2(r.extra):'—',
        fmtRs2(r.finalRate), actionBtns('rateCalcs',r.id)
      ]
    )}</div>`;
}
function renderRateCalcResult(){
  const wrap = document.getElementById('rateCalcResult');
  if(!wrap) return;
  const inp = readRateCalcInputs();
  const r = computeGreyRate(inp);
  const yarnCostValid = r.warpValid && r.weftValid;
  const yarnCost = r.warpCost + r.weftCost;
  wrap.innerHTML = `
    <div class="card">
      <h2>Result</h2>
      <div class="grid cols-3">
        <div class="stat"><div class="label">Total Threads</div><div class="value">${r.hasThreadWidth ? fmtNum(r.totalThreads) : '—'}</div></div>
        <div class="stat"><div class="label">Warp (Tana) Cost / Meter</div><div class="value">${r.warpValid ? fmtRs2(r.warpCost) : '—'}</div></div>
        <div class="stat"><div class="label">Weft (Bana) Cost / Meter</div><div class="value">${r.weftValid ? fmtRs2(r.weftCost) : '—'}</div></div>
        <div class="stat"><div class="label">Yarn Cost (Warp + Weft)</div><div class="value">${yarnCostValid ? fmtRs2(yarnCost) : '—'}</div></div>
        <div class="stat"><div class="label">Picks Addition</div><div class="value">${fmtRs(r.picksAddition)}</div></div>
        <div class="stat"><div class="label">Extra Addition</div><div class="value">${fmtRs2(inp.extra)}</div></div>
      </div>
      <div class="stat balance" style="margin-top:14px">
        <div class="label">Final Rate per Meter</div>
        <div class="value pos" style="font-size:34px">${(r.warpValid && r.weftValid) ? fmtRs2(r.finalRate) : '—'}</div>
        <div class="legend">Yarn Cost (${yarnCostValid?fmtRs2(yarnCost):'—'}) + Picks Addition (${fmtRs(r.picksAddition)}) + Extra Addition (${fmtRs2(inp.extra)})</div>
      </div>
      <div class="form-actions">
        <button class="primary" id="saveRateCalc">Save This Calculation</button>
        <button class="ghost" id="cancelRateCalc" style="display:none">Cancel Edit</button>
      </div>
    </div>`;
}

function checkpointsPanel(){
  return `<div class="card"><h2>Opening Balance</h2>
    <div class="grid cols-2">
      ${field('Opening Balance (Rs) — starting point if no checkpoint applies','ob','number', `value="${DATA.openingBalance||0}"`)}
    </div>
    <button class="primary" id="saveOpening">Save</button></div>
    <div class="card"><div class="card-head"><h2>Log a Cash Checkpoint</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>Enter your actual known cash balance at a specific date &amp; time (from a physical count or bank statement). The Overview will use your most recent checkpoint plus everything logged since — entries on the same day are counted as "since" only if their time is after this checkpoint's time.</p>
    <div class="grid cols-3">
      ${field('Date','cp_date','date',`value="${todayStr()}"`)}
      ${field('Time','cp_time','time',`value="${nowStr()}"`)}
      ${field('Cash Balance (Rs)','cp_bal','number')}
    </div>
    <div class="grid cols-1" style="margin-top:12px">
      ${textareaField('Remarks','cp_rem')}
    </div>
    <div class="form-actions">
      <button class="primary" id="addCheckpoint">Add Checkpoint</button>
      <button class="ghost" id="cancelCheckpoints" style="display:none">Cancel Edit</button>
    </div></div>
    <div class="card"><h2>Checkpoint Log</h2>${logTable('checkpoints',
      ['Date','Time','Balance','Remarks',''],
      DATA.checkpoints.slice().reverse(),
      r=>[fmtDate(r.date), r.time||'—', fmtRs(r.balance), escHtml(r.remarks||'—'), actionBtns('checkpoints',r.id)]
    )}</div>`;
}

function table(headers, rows, cardable=false){
  if(!rows.length) return `<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead></table><div class="empty">No entries yet — add one above</div>`;
  // cardable: also stamp each cell with its column label so the phone card layout (CSS) can show
  // "label over value" tiles. Desktop/tablet and the classic-table option ignore these attributes.
  const plain = h=> String(h==null?'':h).replace(/<[^>]*>/g,'').trim();
  const cell = (c,i)=>{
    if(!cardable) return `<td>${c}</td>`;
    const label = plain(headers[i]);
    const html = String(c==null?'':c);
    if(!label || /<button|<input|<select|<textarea/.test(html)) return `<td class="act">${html}</td>`;
    const empty = plain(html) === '' || plain(html) === '—';
    return `<td data-label="${escHtml(label)}"${empty?' data-empty':''}>${html}</td>`;
  };
  return `<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(r=>`<tr${r.rowStyle?` style="${r.rowStyle}"`:''}>${r.map(cell).join('')}</tr>`).join('')}</tbody></table>`;
}
const PAGE_SIZE = 20;
const PAGE = {}; // pageKey -> current page number (1-indexed)
const FILTER = {}; // filterKey -> currently selected filter value (e.g. FILTER.recovery = client name)
const SEARCH = {}; // pageKey -> current free-text search term for that log table
let SHOW_BEFORE_LAST_SALE = false; // Overview: whether the "Before Last Sale" column is visible
let LAST_STATS_MONTHVAL = ''; // last month/year/range filter renderStats was called with, so toggling a column doesn't reset the filter
function paginateRows(pageKey, allRows){
  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  let page = PAGE[pageKey] || 1;
  if(page > totalPages) page = totalPages;
  if(page < 1) page = 1;
  PAGE[pageKey] = page;
  const startIdx = (page-1)*PAGE_SIZE;
  return {pageRows: allRows.slice(startIdx, startIdx+PAGE_SIZE), page, totalPages};
}
function paginationControls(pageKey, page, totalPages, totalCount){
  if(totalCount <= PAGE_SIZE) return '';
  // Plain, evenly centered row — no side padding here. Clearing the fixed Backup & Restore
  // fab (bottom-right of the screen, see .fab-backup in index.html) is handled by reserving
  // space below this whole block (see the wrapping margin-bottom in logTable() below)
  // instead of nudging this row sideways, which used to throw Prev/label/Next off-center.
  return `<div class="pagination" style="display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:10px 14px;margin-top:12px">
    <button class="ghost" data-pg="${pageKey}:prev" ${page<=1?'disabled':''} type="button">‹ Prev</button>
    <span class="note" style="margin:0">Page ${page} of ${totalPages} (${totalCount} records)</span>
    <button class="ghost" data-pg="${pageKey}:next" ${page>=totalPages?'disabled':''} type="button">Next ›</button>
  </div>`;
}
// True if any value on the record contains the search term (case-insensitive). Matches
// against the raw record fields (not the rendered HTML cells), so it works generically
// across every log table without needing a per-table field list — searching "javed" finds
// it in a client name, "1500" finds it in an amount, etc. Nested values (e.g. a Recovery's
// cheques array) are searched too via their stringified form.
function recordMatchesSearch(rec, term){
  if(!term) return true;
  const t = term.toLowerCase();
  return Object.values(rec).some(val=>{
    if(val == null || val === '') return false;
    if(typeof val === 'object') return JSON.stringify(val).toLowerCase().includes(t);
    return String(val).toLowerCase().includes(t);
  });
}
// Renders a paginated, searchable log table: pageKey identifies the table for PAGE/SEARCH
// tracking, sortedRecords is the full record list (already sorted newest-first, and already
// passed through any page-specific filter like Recovery's client filter), mapFn turns a
// record into the array of display cells that table() expects for one row. The search box
// only appears once a table actually has enough records to need it (or a search is already
// active), so short lists stay uncluttered.
function logTable(pageKey, headers, sortedRecords, mapFn){
  const term = SEARCH[pageKey] || '';
  const filtered = term ? sortedRecords.filter(r=>recordMatchesSearch(r, term)) : sortedRecords;
  const {pageRows, page, totalPages} = paginateRows(pageKey, filtered);
  const showSearch = sortedRecords.length > PAGE_SIZE || term;
  const searchBox = showSearch ? `<div class="field" style="margin-bottom:12px;max-width:320px">
    <label>Search</label>
    <input type="text" data-search="${pageKey}" value="${(term||'').replace(/"/g,'&quot;')}" placeholder="Search this list…">
  </div>` : '';
  const noResults = term && !filtered.length ? `<div class="empty">No entries match "${escHtml(term)}"</div>` : '';
  // Only the table rows scroll — search box above and pagination controls below stay put,
  // same as every card's own heading/intro/filters above this. Keeps a 20-row page from
  // pushing the whole card (and page) taller than it needs to be.
  EXPORT_SOURCES[pageKey] = () => ({headers, cells: filtered.map(mapFn)});
  // Bottom margin here (not side padding on the row above) keeps the pagination/export
  // buttons clear of the fixed Backup & Restore fab (bottom-right of the screen) when this
  // block lands at the bottom of the visible page — without shifting either row off-center.
  const footer = paginationControls(pageKey, page, totalPages, filtered.length) + exportBarHtml(pageKey, filtered.length);
  return searchBox + (noResults || `<div class="log-scroll log-cards">${table(headers, pageRows.map(mapFn), true)}</div>` + (footer ? `<div style="margin-bottom:80px">${footer}</div>` : ''));
}
const ICON_PRINT = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/></svg>';
const ICON_SHARE = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><line x1="8.3" y1="10.7" x2="15.7" y2="6.3"/><line x1="8.3" y1="13.3" x2="15.7" y2="17.7"/></svg>';
const BIZ_LOGO_PNG = "data:image/png;base64,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";
const BIZ_LOGO_RATIO = 1145/360; // width/height, used to size the logo on the printed receipt and in PDFs
// Local date+time stamp, filename-safe (no colons/slashes) — the single naming convention
// shared by every shareable receipt/statement image or PDF AND the backup file, so all
// downloadable output follows the same pattern: <Name>_<YYYY-MM-DD>_<HH-MM-SS>.<ext>
function dateTimeStamp(){
  const d = new Date(), p = n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
// Stamps every page of a jsPDF document with a large, faint, centered copy of the business
// logo — a visual watermark so a shared/downloaded PDF is traceable back to this business
// even if the header logo is cropped out. Call right before doc.output()/doc.save().
function addPdfWatermark(doc){
  const pageCount = doc.internal.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const wmW = pageW * 0.7, wmH = wmW / BIZ_LOGO_RATIO;
  for(let i=1; i<=pageCount; i++){
    doc.setPage(i);
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({opacity: 0.08}));
    doc.addImage(BIZ_LOGO_PNG, 'PNG', (pageW-wmW)/2, (pageH-wmH)/2, wmW, wmH);
    doc.restoreGraphicsState();
  }
}
// Inline watermark element for the printed/HTML receipt views — CSS alone can't reference
// this JS constant, so the background-image is set inline. Shared by printSaleReceipt,
// printRecoveryReceipt, and buildClientStatementHtml, and (via receiptHtmlToPngFile, which
// renders that same HTML to a canvas) by the shared PNG images too — so Print/Save-as-PDF,
// Share-as-image, and the jsPDF-generated Share PDFs (addPdfWatermark) all carry the logo.
const receiptWatermarkDiv = `<div class="receipt-watermark" style="background-image:url('${BIZ_LOGO_PNG}')"></div>`;
const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
function delBtn(key,id){ return `<button class="ghost rowbtn del" data-del="${key}:${id}" aria-label="Remove" title="Remove"><span class="ic">${ICON_TRASH}</span><span class="lbl">Remove</span></button>`; }
function editBtn(key,id){ return `<button class="ghost rowbtn edit" data-edit="${key}:${id}" aria-label="Edit" title="Edit"><span class="ic">${ICON_EDIT}</span><span class="lbl">Edit</span></button>`; }
// Was called from every transaction table's row renderer (Sale, Recovery, Expense, Family,
// Warp, Weft, Wages, Loans, Rate Calc, Checkpoints, Warp Beams, Production) but was never
// defined, so any panel render that hit a real row threw "actionBtns is not defined" and
// aborted mid-render — leaving the old panel's HTML on screen while the nav still flipped to
// the new tab as active (exactly what made "View Clients" look like it did nothing).
function actionBtns(key,id){ return `<span class="row-actions">${editBtn(key,id)}${delBtn(key,id)}</span>`; }
function receiptBtn(id){ return `<button class="ghost rowbtn receipt" data-receipt="${id}" aria-label="Print receipt" title="Print receipt"><span class="ic">${ICON_PRINT}</span><span class="lbl">Receipt</span></button>`; }
function shareReceiptBtn(id){ return `<button class="ghost rowbtn share" data-share-receipt="${id}" aria-label="Share receipt" title="Share receipt"><span class="ic">${ICON_SHARE}</span><span class="lbl">Share</span></button>`; }
function recoveryReceiptBtn(id){ return `<button class="ghost rowbtn receipt" data-recovery-receipt="${id}" aria-label="Print receipt" title="Print receipt"><span class="ic">${ICON_PRINT}</span><span class="lbl">Receipt</span></button>`; }
function shareRecoveryReceiptBtn(id){ return `<button class="ghost rowbtn share" data-share-recovery-receipt="${id}" aria-label="Share receipt" title="Share receipt"><span class="ic">${ICON_SHARE}</span><span class="lbl">Share</span></button>`; }
// Item-table rows for a Sale receipt. A plain sale is one row; an L (AIL) adjusted or
// superseded entry needs the shortage math spelled out as its own rows in the SAME table a
// client already knows how to read — a footnote sentence is easy to miss or misread,
// especially for a client who isn't literate, so "dispatched qty, L count, shortage
// deducted, final qty" each get their own row instead. Shared by printSaleReceipt (HTML) and
// the PDF builder so the two can never show different numbers.
function saleReceiptRows(r, rate){
  const plainRow = ()=> [{label:r.quality||'—', qty:fmtQtyMtr(r.qty), rate:fmtRs2(rate), amount:fmtRs(r.amount)}];
  if(r.lAdjustedFromId){
    const orig = DATA.sale.find(s=>s.id===r.lAdjustedFromId);
    if(orig) return {
      rows: [
        {label:`${orig.quality||'—'} — Dispatched`, qty:fmtQtyMtr(orig.qty), rate:fmtRs2(rate), amount:fmtRs(orig.amount)},
        {label:`Less: L (AIL) Shortage (${orig.lCount} L)`, qty:`-${fmtQtyPlain(orig.lShortageQty)}`, rate:'', amount:`-${fmtRs(orig.lDeduction)}`},
      ],
      totalLabel:'Net Total (after L (AIL))', totalAmount: fmtRs(r.amount),
    };
    return {rows: plainRow(), totalLabel:'Total', totalAmount: fmtRs(r.amount)};
  }
  if(r.lStatus==='applied') return {
    rows: [
      {label:`${r.quality||'—'} — Dispatched`, qty:fmtQtyMtr(r.qty), rate:fmtRs2(rate), amount:fmtRs(r.amount)},
      {label:`Less: L (AIL) Shortage (${r.lCount} L)`, qty:`-${fmtQtyPlain(r.lShortageQty)}`, rate:'', amount:`-${fmtRs(r.lDeduction)}`},
    ],
    totalLabel:'Net Total (see adjusted invoice)', totalAmount: fmtRs((Number(r.amount)||0) - (Number(r.lDeduction)||0)),
  };
  if(r.lStatus==='returned') return {rows: plainRow(), totalLabel:'Total (Lot Returned)', totalAmount: fmtRs(0)};
  return {rows: plainRow(), totalLabel:'Total', totalAmount: fmtRs(r.amount)};
}
// Short status line kept below the table for context (which dyeing unit, cross-reference)
// once the money/qty breakdown itself has already been shown as table rows above.
function saleLBlockHtml(r){
  if(r.lStatus==='returned') return `<div class="meta-row" style="margin-top:6px;color:var(--red)"><span>L (AIL)</span><b>Lot returned${r.lCount?` — ${r.lCount} L`:''}</b></div>`;
  if(r.lStatus==='ok') return `<div class="meta-row" style="margin-top:6px"><span>L (AIL)</span><b>OK — no shortage</b></div>`;
  return '';
}
// Shared by printSaleReceipt (HTML for window.print()) and shareSaleReceipt (PDF for the
// native share sheet) so the two never drift apart. Returns null if the sale no longer exists.
function buildReceiptFields(saleId){
  const r = DATA.sale.find(s=>s.id===saleId);
  if(!r) return null;
  const biz = DATA.businessInfo || {};
  const bizName = biz.name || 'Ibrahim Weaving';
  const rate = r.rate ? Number(r.rate) : (r.qty ? (Number(r.amount)||0)/r.qty : 0);
  // Reuses the same "before last sale" snapshot as the Overview tab (see
  // receivableBeforeLastSale): face value, so a cheque counts as paid the moment it's
  // recorded even if it's later marked Bounced (a Replaced cheque is not counted, because the
  // payment that replaced it is its own entry). Only meaningful for a client's most recent
  // sale, which is what this figure has always represented elsewhere in the app.
  const beforeLastSale = receivableBeforeLastSale(r.client);
  const previousBalance = beforeLastSale ? beforeLastSale.amount : 0;
  // Matches saleReceiptRows' Net Total exactly: a superseded original nets out its own
  // deduction, a returned lot counts for nothing, and everything else (including an
  // adjustment entry, whose stored amount is already net) is its stored amount as-is.
  const currentSale = r.lStatus==='applied' ? (Number(r.amount)||0) - (Number(r.lDeduction)||0)
    : r.lStatus==='returned' ? 0
    : Number(r.amount)||0;
  const currentBalance = previousBalance + currentSale;
  const safe = s => String(s||'').trim().replace(/[\\/:*?"<>|]+/g,'').replace(/\s+/g,'_');
  // Naming convention for every shareable file: <ClientName>_<Date>_<Time> (see dateTimeStamp).
  const fileBase = `${safe(r.client)||'Sale'}_${dateTimeStamp()}`;
  return {r, biz, bizName, rate, previousBalance, currentSale, currentBalance, fileBase};
}
// Builds a printable receipt for one Sale entry and prints it. #receiptPrintArea sits
// outside #appShell (see body markup near Init) and is hidden at all times except under
// @media print, which also hides #appShell — so calling window.print() here shows only the
// receipt, on plain paper styling, regardless of the app's own theme.
function printSaleReceipt(saleId, opts){
  const f = buildReceiptFields(saleId);
  if(!f) return;
  const {r, bizName, biz, rate, previousBalance, currentSale, currentBalance, fileBase} = f;
  const bizLines = [`<img class="receipt-logo" src="${BIZ_LOGO_PNG}" alt="${escHtml(bizName)}">`,
    biz.address ? `<div class="biz-line">${escHtml(biz.address)}</div>` : '',
    biz.phone ? `<div class="biz-line">Phone: ${escHtml(biz.phone)}</div>` : ''].join('');
  const balanceHtml = `
    <div class="balance-summary">
      <div class="row"><span>Previous Balance</span><span>${fmtRs(previousBalance)}</span></div>
      <div class="row"><span>Current Sale</span><span>${fmtRs(currentSale)}</span></div>
      <div class="row total"><span>Current Balance</span><span>${fmtRs(currentBalance)}</span></div>
    </div>`;
  const rowset = saleReceiptRows(r, rate);
  const html = `<div class="receipt">
    ${receiptWatermarkDiv}
    ${bizLines}
    <div class="receipt-title">Sale Receipt</div>
    <div class="meta-row"><span>Date</span><b>${fmtDate(r.date)}</b></div>
    <div class="meta-row"><span>Invoice No</span><b>${escHtml(r.invoice||'—')}</b></div>
    <div class="meta-row"><span>Client</span><b>${escHtml(r.client||'—')}</b></div>
    <table>
      <thead><tr><th>Quality</th><th class="num">Quantity (mtr)</th><th class="num">Rate (Rs)</th><th class="num">Amount (Rs)</th></tr></thead>
      <tbody>${rowset.rows.map(row=>`<tr><td>${escHtml(row.label)}</td><td class="num">${escHtml(row.qty)}</td><td class="num">${escHtml(row.rate)}</td><td class="num">${escHtml(row.amount)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3">${escHtml(rowset.totalLabel)}</td><td class="num">${escHtml(rowset.totalAmount)}</td></tr></tfoot>
    </table>
    ${balanceHtml}
    ${r.dyeing ? `<div class="meta-row" style="margin-top:14px"><span>Dyeing</span><b>${escHtml(r.dyeing)}</b></div>` : ''}
    ${saleLBlockHtml(r)}
    ${r.desc ? `<div class="meta-row" style="margin-top:${r.dyeing?'6':'14'}px"><span>Description</span><b>${escHtml(r.desc)}</b></div>` : ''}
    <div class="footer-note">Thank you for your business.</div>
  </div>`;
  if(opts && opts.htmlOnly) return html;
  const area = document.getElementById('receiptPrintArea');
  area.innerHTML = html;
  // Chrome/Edge/Firefox all default a "Save as PDF" filename to the page title, so set it
  // to "<Client>_<Date>" for the moment of printing, then restore it once the print dialog
  // closes.
  const originalTitle = document.title;
  document.title = fileBase;
  const restoreTitle = () => { document.title = originalTitle; window.removeEventListener('afterprint', restoreTitle); };
  window.addEventListener('afterprint', restoreTitle);
  window.print();
}
// Builds the same receipt as a one-page PDF (via jsPDF, loaded from CDN) and hands it to the
// native share sheet — so it can go straight to WhatsApp, Gmail, etc. without printing first.
// Bound to the Sale row's Share button. Shares the receipt as a PNG image directly via the
// native share sheet (WhatsApp, Gmail, etc.) — no in-app dialog first. Some Android setups
// block PDF sharing with "Permission denied" but allow images, which is why image is the
// default; shareSaleReceiptAsPdf below is kept only as a manual fallback (not wired to any
// button) in case a PDF is ever needed again.
async function shareSaleReceipt(saleId){
  const statusEl = document.getElementById('statusLine');
  const setStatus = (msg) => { if(statusEl) statusEl.textContent = msg; showToast(msg); };
  const f = buildReceiptFields(saleId);
  if(!f){ setStatus('That sale entry could not be found.'); return; }
  if(!canShareFiles()){ setStatus('Sharing files isn\'t supported here — use Print instead.'); return; }
  await shareReceiptAsImage('sale', saleId);
}
// Fallback path only (reached from the retry dialog when image sharing fails) — builds the
// same receipt as a one-page PDF via jsPDF and hands it to the native share sheet. File naming
// convention (fileBase, ASCII-cleaned) is unchanged from before, just with a .pdf extension.
async function shareSaleReceiptAsPdf(saleId){
  const statusEl = document.getElementById('statusLine');
  const setStatus = (msg) => { if(statusEl) statusEl.textContent = msg; showToast(msg); };
  const f = buildReceiptFields(saleId);
  if(!f){ setStatus('That sale entry could not be found.'); return; }
  if(!canShareFiles()){ setStatus('Sharing files isn\'t supported here — use Print instead.'); return; }
  if(typeof window.jspdf === 'undefined'){ setStatus('PDF library is still loading — try again in a moment.'); return; }
  const {r, bizName, biz, rate, previousBalance, currentSale, currentBalance, fileBase} = f;
  let file = null;
  const shareText = [bizName, `Sale receipt — ${fmtDate(r.date)}`, `Client: ${r.client||''}`, r.quality ? `Quality: ${r.quality}` : '', `Qty: ${fmtQtyMtr(r.qty)} mtr`, `Amount: ${fmtRs(currentSale)}`, `Balance: ${fmtRs(currentBalance)}`].filter(Boolean).join('\n');
  try{
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({unit:'pt', format:'a5'});
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 36;
    let y = 48;
    { const logoH = 34, logoW = logoH*BIZ_LOGO_RATIO;
      doc.addImage(BIZ_LOGO_PNG, 'PNG', (pageW-logoW)/2, y-24, logoW, logoH); y += logoH-8; }
    doc.setFont('helvetica','normal'); doc.setFontSize(9);
    if(biz.address){ doc.text(biz.address, pageW/2, y, {align:'center'}); y += 13; }
    if(biz.phone){ doc.text(`Phone: ${biz.phone}`, pageW/2, y, {align:'center'}); y += 13; }
    y += 6;
    doc.setDrawColor(180); doc.line(margin, y, pageW-margin, y); y += 20;
    doc.setFont('helvetica','bold'); doc.setFontSize(12);
    doc.text('Sale Receipt', pageW/2, y, {align:'center'}); y += 24;
    doc.setFont('helvetica','normal'); doc.setFontSize(10);
    const metaRow = (label, val) => {
      doc.setTextColor(90); doc.text(label, margin, y);
      doc.setTextColor(20); doc.setFont('helvetica','bold'); doc.text(String(val), margin+72, y); doc.setFont('helvetica','normal');
      y += 16;
    };
    metaRow('Date', fmtDate(r.date));
    metaRow('Invoice No', r.invoice||'—');
    metaRow('Client', r.client||'—');
    y += 6;
    // Item table — one row per line in saleReceiptRows(): a plain sale is a single row, but
    // an L (AIL) adjusted/superseded entry gets its shortage math as its own rows here too,
    // matching the HTML/image receipt exactly (see saleReceiptRows in this file).
    const rowset = saleReceiptRows(r, rate);
    const cols = [
      {label:'Quality', w:0.40, align:'left'},
      {label:'Qty (mtr)', w:0.22, align:'right'},
      {label:'Rate', w:0.16, align:'right'},
      {label:'Amount', w:0.22, align:'right'},
    ];
    const tableW = pageW - margin*2;
    let x = margin;
    doc.setFillColor(240,240,240); doc.rect(margin, y-12, tableW, 20, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(20);
    cols.forEach(c=>{ const w=c.w*tableW; doc.text(c.label, c.align==='left'?x+4:x+w-4, y, {align:c.align}); x+=w; });
    y += 22;
    doc.setFont('helvetica','normal'); doc.setFontSize(9);
    rowset.rows.forEach(row=>{
      const rowVals = [row.label, row.qty, row.rate, row.amount];
      x = margin;
      cols.forEach((c,i)=>{ const w=c.w*tableW; doc.text(String(rowVals[i]||''), c.align==='left'?x+4:x+w-4, y, {align:c.align}); x+=w; });
      y += 18;
    });
    doc.setFontSize(10);
    y += 4;
    doc.setDrawColor(200); doc.line(margin, y, pageW-margin, y); y += 18;
    doc.setFont('helvetica','bold');
    doc.text(rowset.totalLabel, margin+4, y);
    doc.text(rowset.totalAmount, pageW-margin-4, y, {align:'right'});
    y += 26;
    // Balance summary box
    const boxTop = y - 14;
    doc.setDrawColor(160); doc.setFillColor(250,250,250);
    doc.rect(margin, boxTop, tableW, 66, 'FD');
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(60);
    doc.text('Previous Balance', margin+10, y); doc.setTextColor(20); doc.text(fmtRs(previousBalance), pageW-margin-10, y, {align:'right'}); y += 20;
    doc.setTextColor(60); doc.text('Current Sale', margin+10, y); doc.setTextColor(20); doc.text(fmtRs(currentSale), pageW-margin-10, y, {align:'right'}); y += 20;
    doc.setFont('helvetica','bold'); doc.setTextColor(20);
    doc.text('Current Balance', margin+10, y); doc.text(fmtRs(currentBalance), pageW-margin-10, y, {align:'right'});
    y = boxTop + 66 + 24;
    if(r.dyeing){
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(60);
      doc.text(`Dyeing: ${r.dyeing}`, margin, y);
      y += 16;
    }
    if(r.lStatus==='returned'){
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(180,40,40);
      doc.text(`L (AIL): Lot returned${r.lCount?` — ${r.lCount} L`:''}`, margin, y);
      y += 16; doc.setTextColor(60);
    } else if(r.lStatus==='ok'){
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(60);
      doc.text('L (AIL): OK — no shortage', margin, y);
      y += 16;
    }
    if(r.desc){
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(60);
      doc.text(`Description: ${r.desc}`, margin, y);
      y += 20;
    }
    doc.setFont('helvetica','italic'); doc.setFontSize(9); doc.setTextColor(120);
    doc.text('Thank you for your business.', pageW/2, y, {align:'center'});
    addPdfWatermark(doc);
    const blob = doc.output('blob');
    file = new File([blob], `${asciiFileBase(fileBase)}.pdf`, {type:'application/pdf'});
    if(!navigator.canShare({files:[file]})){ downloadFileFallback(file); setStatus('Sharing isn\'t available here — the PDF was downloaded instead.'); return; }
    await navigator.share({files:[file], title:`Receipt — ${r.client||''}`, text:`Sale receipt — ${fmtDate(r.date)}`});
    setStatus('Receipt shared ✓');
  }catch(e){
    if(e && e.name === 'AbortError') return; // user closed the share sheet — not an error
    if(file){ shareRetryDialog(file, e, shareText, ()=>shareReceiptAsImage('sale', saleId), 'Share as image instead'); return; }
    setStatus('Could not build/share the receipt PDF: ' + (e && (e.name + ' ' + e.message) || 'unknown error'));
  }
}
// Plain-English lines about bounced-cheque replacements on one payment, for the Recovery log, the
// Client Statement and receipts: what this payment replaces, and what replaced this payment's own
// cheques. Both come from the links stored on the replacing payment (see calc.js).
function replacementNoteTexts(rec){
  const notes = replacementNotes(rec.id);
  const chq = n => 'cheque' + (n.chequeNo ? ' No. ' + n.chequeNo : '');
  const out = [];
  notes.replaces.forEach(n=>{
    const part = n.amount < n.chequeAmount - 0.005 ? ` (part of ${fmtRs(n.chequeAmount)})` : '';
    out.push(`Replaces ${chq(n)}${n.owner ? ' of ' + n.owner : ''} from ${fmtDate(n.date)} — ${fmtRs(n.amount)}${part}`);
  });
  notes.replacedBy.forEach(n=>{
    out.push(`${chq(n).replace(/^c/, 'C')} (${fmtRs(n.chequeAmount)}) replaced by ${n.by.map(b=>`${fmtRs(b.amount)} paid ${fmtDate(b.date)}`).join(' + ')}`);
  });
  return out;
}
// Human-readable one-line summary of a recovery payment's cash/bank/cheque split, for the
// Client Statement ledger — e.g. "Cash Rs 5,000 + Cheque Rs 10,000 + Cheque Rs 5,000 (Bounced — not credited)".
function recoveryDescription(rec){
  const {cashAmount, bankAmount, cheques} = recoveryParts(rec);
  const notes = replacementNotes(rec.id);
  // Non-breaking spaces keep "Cheque Rs 5,000" together, so a wrapped Details column only breaks
  // between the "+" items.
  const item = (label, n) => `${label}\u00a0${fmtRs(n).replace(' ', '\u00a0')}`;
  const parts = [];
  if(cashAmount) parts.push(item('Cash', cashAmount));
  if(bankAmount) parts.push(item('Bank', bankAmount));
  // Every cheque is listed with its amount so the Credit can be added up by hand. A Bounced or
  // Replaced cheque is left out of the Credit (see recoveryReceivableAmount), so it is marked as such.
  (cheques||[]).forEach(c=>{
    let notCredited = (c.status === 'Bounced' || c.status === 'Replaced') ? ` (${c.status} — not credited)` : '';
    const by = notes.replacedBy.find(n=>n.chequeId===c.id);
    if(by && c.status === 'Replaced') notCredited = ` (Replaced — not credited; made good by the payment${by.by.length>1?'s':''} of ${by.by.map(b=>fmtDate(b.date)).join(' and ')})`;
    parts.push(item('Cheque', Number(c.amount)||0) + notCredited);
  });
  let text = parts.join(' + ') || 'Payment';
  if(notes.replaces.length){
    text += ' — ' + notes.replaces.map(n=>`${fmtRs(n.amount)} of this replaces cheque${n.chequeNo ? ' No. ' + n.chequeNo : ''} from ${fmtDate(n.date)}`).join('; ');
  }
  return text;
}
// Shared by printRecoveryReceipt and shareRecoveryReceipt. Balance figures come from the same
// running ledger as the Client Statement (buildClientLedger), so a payment receipt's numbers
// always agree with the statement — "Amount Credited" is recoveryReceivableAmount (excludes
// bounced/replaced cheques), while the itemized breakdown below lists what was physically
// handed over at face value, cheques included, since that's the honest record of the moment
// the payment was received (before any cheque has had a chance to bounce).
function buildRecoveryReceiptFields(recoveryId){
  const r = DATA.recovery.find(x=>x.id===recoveryId);
  if(!r) return null;
  const biz = DATA.businessInfo || {};
  const bizName = biz.name || 'Ibrahim Weaving';
  const {cashAmount, bankAmount, cheques} = recoveryParts(r);
  const items = [];
  if(cashAmount) items.push({method:'Cash', detail:'—', amount:cashAmount});
  if(bankAmount) items.push({method:'Bank Transfer', detail:'—', amount:bankAmount});
  (cheques||[]).forEach(c=>{
    const bits = [c.chequeNo?`No. ${c.chequeNo}`:'', c.bank||'', c.chequeDate?fmtDate(c.chequeDate):'', c.owner?`Owner: ${c.owner}`:''].filter(Boolean);
    items.push({method:`Cheque (${c.status||'Pending'})`, detail: bits.join(', ')||'—', amount:Number(c.amount)||0});
  });
  const totalReceived = items.reduce((s,i)=>s+i.amount, 0);
  const ledger = buildClientLedger(r.client, null, null);
  const idx = ledger ? ledger.rows.findIndex(row=>row.id===recoveryId) : -1;
  const previousBalance = (ledger && idx > 0) ? ledger.rows[idx-1].balance : 0;
  const currentBalance = (ledger && idx > -1) ? ledger.rows[idx].balance : previousBalance;
  const amountCredited = recoveryReceivableAmount(r);
  const safe = s => String(s||'').trim().replace(/[\\/:*?"<>|]+/g,'').replace(/\s+/g,'_');
  // Naming convention for every shareable file: <ClientName>_<Date>_<Time> (see dateTimeStamp).
  const fileBase = `${safe(r.client)||'Payment'}_${dateTimeStamp()}`;
  const notes = replacementNoteTexts(r);
  return {r, biz, bizName, items, totalReceived, previousBalance, currentBalance, amountCredited, fileBase, notes};
}
// Prints a payment receipt for one Recovery entry, same #receiptPrintArea mechanism as
// printSaleReceipt.
function printRecoveryReceipt(recoveryId, opts){
  const f = buildRecoveryReceiptFields(recoveryId);
  if(!f) return;
  const {r, bizName, biz, items, totalReceived, previousBalance, amountCredited, currentBalance, fileBase, notes} = f;
  const bizLines = [`<img class="receipt-logo" src="${BIZ_LOGO_PNG}" alt="${escHtml(bizName)}">`,
    biz.address ? `<div class="biz-line">${escHtml(biz.address)}</div>` : '',
    biz.phone ? `<div class="biz-line">Phone: ${escHtml(biz.phone)}</div>` : ''].join('');
  const itemRows = items.map(i=>`<tr><td>${i.method}</td><td>${escHtml(i.detail)}</td><td class="num">${fmtRs(i.amount)}</td></tr>`).join('');
  const balanceHtml = `
    <div class="balance-summary">
      <div class="row"><span>Previous Balance</span><span>${fmtRs(previousBalance)}</span></div>
      <div class="row"><span>Amount Credited</span><span>${fmtRs(amountCredited)}</span></div>
      <div class="row total"><span>Current Balance</span><span>${fmtRs(currentBalance)}</span></div>
    </div>`;
  const html = `<div class="receipt">
    ${receiptWatermarkDiv}
    ${bizLines}
    <div class="receipt-title">Payment Receipt</div>
    <div class="meta-row"><span>Date</span><b>${fmtDate(r.date)}</b></div>
    <div class="meta-row"><span>Client</span><b>${escHtml(r.client||'—')}</b></div>
    <table>
      <thead><tr><th>Method</th><th>Details</th><th class="num">Amount (Rs)</th></tr></thead>
      <tbody>${itemRows}</tbody>
      <tfoot><tr><td colspan="2">Total Received</td><td class="num">${fmtRs(totalReceived)}</td></tr></tfoot>
    </table>
    ${balanceHtml}
    ${r.desc ? `<div class="meta-row" style="margin-top:14px"><span>Description</span><b>${escHtml(r.desc)}</b></div>` : ''}
    ${(notes||[]).map(t=>`<div class="meta-row" style="margin-top:8px"><span>Note</span><b>${escHtml(t)}</b></div>`).join('')}
    <div class="footer-note">Thank you for your payment.</div>
  </div>`;
  if(opts && opts.htmlOnly) return html;
  const area = document.getElementById('receiptPrintArea');
  area.innerHTML = html;
  const originalTitle = document.title;
  document.title = fileBase;
  const restoreTitle = () => { document.title = originalTitle; window.removeEventListener('afterprint', restoreTitle); };
  window.addEventListener('afterprint', restoreTitle);
  window.print();
}
// Bound to the Recovery row's Share button. Shares the receipt as a PNG image directly via
// the native share sheet — no in-app dialog first. shareRecoveryReceiptAsPdf below is kept
// only as a manual fallback (not wired to any button).
async function shareRecoveryReceipt(recoveryId){
  const statusEl = document.getElementById('statusLine');
  const setStatus = (msg) => { if(statusEl) statusEl.textContent = msg; showToast(msg); };
  const f = buildRecoveryReceiptFields(recoveryId);
  if(!f){ setStatus('That payment entry could not be found.'); return; }
  if(!canShareFiles()){ setStatus('Sharing files isn\'t supported here — use Print instead.'); return; }
  await shareReceiptAsImage('recovery', recoveryId);
}
// Fallback path only (reached from the retry dialog when image sharing fails) — builds the
// same payment receipt as a one-page PDF and hands it to the native share sheet. File naming
// convention (fileBase, ASCII-cleaned) is unchanged from before, just with a .pdf extension.
async function shareRecoveryReceiptAsPdf(recoveryId){
  const statusEl = document.getElementById('statusLine');
  const setStatus = (msg) => { if(statusEl) statusEl.textContent = msg; showToast(msg); };
  const f = buildRecoveryReceiptFields(recoveryId);
  if(!f){ setStatus('That payment entry could not be found.'); return; }
  if(!canShareFiles()){ setStatus('Sharing files isn\'t supported here — use Print instead.'); return; }
  if(typeof window.jspdf === 'undefined'){ setStatus('PDF library is still loading — try again in a moment.'); return; }
  const {r, bizName, biz, items, totalReceived, previousBalance, amountCredited, currentBalance, fileBase} = f;
  let file = null;
  const shareText = [bizName, `Payment receipt — ${fmtDate(r.date)}`, `Client: ${r.client||''}`, `Received: ${fmtRs(totalReceived)}`, `Balance: ${fmtRs(currentBalance)}`].join('\n');
  try{
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({unit:'pt', format:'a5'});
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 36;
    let y = 48;
    { const logoH = 34, logoW = logoH*BIZ_LOGO_RATIO;
      doc.addImage(BIZ_LOGO_PNG, 'PNG', (pageW-logoW)/2, y-24, logoW, logoH); y += logoH-8; }
    doc.setFont('helvetica','normal'); doc.setFontSize(9);
    if(biz.address){ doc.text(biz.address, pageW/2, y, {align:'center'}); y += 13; }
    if(biz.phone){ doc.text(`Phone: ${biz.phone}`, pageW/2, y, {align:'center'}); y += 13; }
    y += 6;
    doc.setDrawColor(180); doc.line(margin, y, pageW-margin, y); y += 20;
    doc.setFont('helvetica','bold'); doc.setFontSize(12);
    doc.text('Payment Receipt', pageW/2, y, {align:'center'}); y += 24;
    doc.setFont('helvetica','normal'); doc.setFontSize(10);
    const metaRow = (label, val) => {
      doc.setTextColor(90); doc.text(label, margin, y);
      doc.setTextColor(20); doc.setFont('helvetica','bold'); doc.text(String(val), margin+72, y); doc.setFont('helvetica','normal');
      y += 16;
    };
    metaRow('Date', fmtDate(r.date));
    metaRow('Client', r.client||'—');
    y += 6;
    const cols = [
      {label:'Method', w:0.30, align:'left'},
      {label:'Details', w:0.42, align:'left'},
      {label:'Amount', w:0.28, align:'right'},
    ];
    const tableW = pageW - margin*2;
    let x = margin;
    doc.setFillColor(240,240,240); doc.rect(margin, y-12, tableW, 20, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(20);
    cols.forEach(c=>{ const w=c.w*tableW; doc.text(c.label, c.align==='left'?x+4:x+w-4, y, {align:c.align}); x+=w; });
    y += 20;
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5);
    items.forEach(item=>{
      x = margin;
      const vals = [item.method, item.detail, fmtRs(item.amount)];
      let maxLines = 1;
      const wrapped = cols.map((c,i)=>{ const w=c.w*tableW; const lines = doc.splitTextToSize(String(vals[i]), w-8); maxLines = Math.max(maxLines, lines.length); return lines; });
      cols.forEach((c,i)=>{ const w=c.w*tableW; doc.text(wrapped[i], c.align==='left'?x+4:x+w-4, y, {align:c.align}); x+=w; });
      y += 12*maxLines + 4;
    });
    y += 4;
    doc.setDrawColor(200); doc.line(margin, y, pageW-margin, y); y += 18;
    doc.setFont('helvetica','bold'); doc.setFontSize(10);
    doc.text('Total Received', margin+4, y);
    doc.text(fmtRs(totalReceived), pageW-margin-4, y, {align:'right'});
    y += 26;
    const boxTop = y - 14;
    doc.setDrawColor(160); doc.setFillColor(250,250,250);
    doc.rect(margin, boxTop, tableW, 66, 'FD');
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(60);
    doc.text('Previous Balance', margin+10, y); doc.setTextColor(20); doc.text(fmtRs(previousBalance), pageW-margin-10, y, {align:'right'}); y += 20;
    doc.setTextColor(60); doc.text('Amount Credited', margin+10, y); doc.setTextColor(20); doc.text(fmtRs(amountCredited), pageW-margin-10, y, {align:'right'}); y += 20;
    doc.setFont('helvetica','bold'); doc.setTextColor(20);
    doc.text('Current Balance', margin+10, y); doc.text(fmtRs(currentBalance), pageW-margin-10, y, {align:'right'});
    y = boxTop + 66 + 24;
    if(r.desc){
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(60);
      doc.text(`Description: ${r.desc}`, margin, y);
      y += 20;
    }
    doc.setFont('helvetica','italic'); doc.setFontSize(9); doc.setTextColor(120);
    doc.text('Thank you for your payment.', pageW/2, y, {align:'center'});
    addPdfWatermark(doc);
    const blob = doc.output('blob');
    file = new File([blob], `${asciiFileBase(fileBase)}.pdf`, {type:'application/pdf'});
    if(!navigator.canShare({files:[file]})){ downloadFileFallback(file); setStatus('Sharing isn\'t available here — the PDF was downloaded instead.'); return; }
    await navigator.share({files:[file], title:`Receipt — ${r.client||''}`, text:`Payment receipt — ${fmtDate(r.date)}`});
    setStatus('Receipt shared ✓');
  }catch(e){
    if(e && e.name === 'AbortError') return; // user closed the share sheet — not an error
    if(file){ shareRetryDialog(file, e, shareText, ()=>shareReceiptAsImage('recovery', recoveryId), 'Share as image instead'); return; }
    setStatus('Could not build/share the receipt PDF: ' + (e && (e.name + ' ' + e.message) || 'unknown error'));
  }
}
// Renders a client's ledger (from buildClientLedger) as a multi-page A4 PDF and returns the
// jsPDF document plus a suggested filename — shared by the Download and Share buttons on the
// Client Statement card so their output never drifts apart.
function renderClientStatementPdf(clientName, fromDate, toDate){
  const ledger = buildClientLedger(clientName, fromDate, toDate);
  if(!ledger) return null;
  const biz = DATA.businessInfo || {};
  const bizName = biz.name || 'Ibrahim Weaving';
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'pt', format:'a4'});
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const cols = [
    {label:'Date', w:0.13, align:'left'},
    {label:'Details', w:0.43, align:'left'},
    {label:'Debit', w:0.14, align:'right'},
    {label:'Credit', w:0.14, align:'right'},
    {label:'Balance', w:0.16, align:'right'},
  ];
  const tableW = pageW - margin*2;
  const drawTableHeader = (y) => {
    doc.setFillColor(240,240,240); doc.rect(margin, y-12, tableW, 20, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(20);
    let x = margin;
    cols.forEach(c=>{ const w=c.w*tableW; doc.text(c.label, c.align==='left'?x+4:x+w-4, y, {align:c.align}); x+=w; });
    return y + 20;
  };
  const drawRow = (y, vals, opts={}) => {
    if(opts.bold) doc.setFont('helvetica','bold'); else doc.setFont('helvetica','normal');
    doc.setFontSize(9.5); doc.setTextColor(opts.color || 20);
    let x = margin;
    let maxLines = 1;
    const wrapped = cols.map((c,i)=>{
      const w = c.w*tableW;
      const lines = doc.splitTextToSize(String(vals[i]||''), w-8);
      maxLines = Math.max(maxLines, lines.length);
      return lines;
    });
    cols.forEach((c,i)=>{
      const w = c.w*tableW;
      doc.text(wrapped[i], c.align==='left'?x+4:x+w-4, y, {align:c.align});
      x += w;
    });
    return y + 12*maxLines + 4;
  };
  let y = 56;
  { const logoH = 40, logoW = logoH*BIZ_LOGO_RATIO;
    doc.addImage(BIZ_LOGO_PNG, 'PNG', (pageW-logoW)/2, y-28, logoW, logoH); y += logoH-6; }
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(60);
  if(biz.address){ doc.text(biz.address, pageW/2, y, {align:'center'}); y += 13; }
  if(biz.phone){ doc.text(`Phone: ${biz.phone}`, pageW/2, y, {align:'center'}); y += 13; }
  y += 8;
  doc.setDrawColor(180); doc.line(margin, y, pageW-margin, y); y += 22;
  doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(20);
  doc.text('Client Statement', pageW/2, y, {align:'center'}); y += 20;
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  doc.setTextColor(90); doc.text('Client', margin, y);
  doc.setTextColor(20); doc.setFont('helvetica','bold'); doc.text(clientName, margin+72, y); doc.setFont('helvetica','normal'); y += 15;
  doc.setTextColor(90); doc.text('Period', margin, y);
  doc.setTextColor(20); doc.setFont('helvetica','bold'); doc.text(`${fromDate?fmtDate(fromDate):'Beginning'} to ${toDate?fmtDate(toDate):'Now'}`, margin+72, y); doc.setFont('helvetica','normal'); y += 24;
  y = drawTableHeader(y);
  if(ledger.hasOpening){
    y = drawRow(y, ['', 'Opening Balance', '', '', fmtRs(ledger.openingBalance)], {bold:true});
    y += 4;
  }
  ledger.rows.forEach(r=>{
    if(y > pageH - 70){ doc.addPage(); y = margin + 16; y = drawTableHeader(y); }
    y = drawRow(y, [fmtDate(r.date), r.detail, r.debit?fmtRs(r.debit):'', r.credit?fmtRs(r.credit):'', fmtRs(r.balance)]);
  });
  // Summary of the period: what was sold, what was paid, and where that leaves the balance.
  // Same look as the Previous / Current Balance box on the receipts. Kept together on one page.
  const sumRows = [];
  if(ledger.hasOpening) sumRows.push(['Opening Balance', ledger.openingBalance, false]);
  sumRows.push(['Total Sales in Period', ledger.totalSales, false]);
  sumRows.push(['Total Payments in Period', ledger.totalPayments, false]);
  sumRows.push(['Closing Balance', ledger.closingBalance, true]);
  const boxH = sumRows.length*20 + 6;
  if(y + 24 + boxH > pageH - 50){ doc.addPage(); y = margin + 16; }
  y += 24;
  const boxTop = y - 14;
  doc.setDrawColor(160); doc.setFillColor(250,250,250); doc.rect(margin, boxTop, tableW, boxH, 'FD');
  doc.setFontSize(10);
  sumRows.forEach(([label, val, strong])=>{
    if(strong){ doc.setDrawColor(200); doc.line(margin, y-14, margin+tableW, y-14); }
    doc.setFont('helvetica', strong?'bold':'normal'); doc.setTextColor(strong?20:60);
    doc.text(label, margin+10, y);
    doc.setTextColor(20); doc.text(fmtRs(val), pageW-margin-10, y, {align:'right'});
    y += 20;
  });
  addPdfWatermark(doc);
  const safe = s => String(s||'').trim().replace(/[\\/:*?"<>|]+/g,'').replace(/\s+/g,'_');
  // Naming convention for every shareable file: <ClientName>_<Date>_<Time> (see dateTimeStamp).
  const filename = `${asciiFileBase(safe(clientName))}_${dateTimeStamp()}.pdf`;
  return {doc, filename};
}
// HTML equivalent of renderClientStatementPdf, used to share the Client Statement as a PNG
// image. Reuses the same .receipt CSS as the sale/payment receipts (see receiptHtmlToPngFile,
// which harvests any stylesheet rule mentioning ".receipt") so all three look consistent, and
// the same safe()-based naming convention as the PDF version, just with a .png extension.
const _stmtSafeName = s => String(s||'').trim().replace(/[\\/:*?"<>|]+/g,'').replace(/\s+/g,'_');
// One <tr> string per ledger line (Opening Balance first when there is one) — kept as a list so
// a long statement can be cut into several pictures at row boundaries.
function statementRowHtmls(ledger){
  // Date and money cells never wrap: with automatic column widths the browser otherwise squeezes
  // them (a date split "01-08-" / "2026", an amount split "Rs" / "35,262") whenever the Details
  // text is long, and a split amount is easy to misread. Details takes the wrapping instead.
  const NW = ' style="white-space:nowrap"';
  const rows = [];
  if(ledger.hasOpening) rows.push(`<tr><td${NW}></td><td><b>Opening Balance</b></td><td class="num"></td><td class="num"></td><td class="num"${NW}><b>${fmtRs(ledger.openingBalance)}</b></td></tr>`);
  ledger.rows.forEach(r=> rows.push(`<tr><td${NW}>${fmtDate(r.date)}</td><td>${escHtml(r.detail)}</td><td class="num"${NW}>${r.debit?fmtRs(r.debit):''}</td><td class="num"${NW}>${r.credit?fmtRs(r.credit):''}</td><td class="num"${NW}>${fmtRs(r.balance)}</td></tr>`));
  return rows;
}
// One picture's worth of statement: `first` adds the logo/address/title block, later pages get a
// short "continued" heading instead; `last` adds the period summary box and the thank-you line;
// `label` (e.g. "Page 2 of 4") is printed underneath when the statement spans several pictures.
function statementPartHtml(rowHtmls, o){
  const {clientName, fromDate, toDate, ledger, first, last, label} = o;
  const biz = DATA.businessInfo || {};
  const bizName = biz.name || 'Ibrahim Weaving';
  const bizLines = [`<img class="receipt-logo" src="${BIZ_LOGO_PNG}" alt="${escHtml(bizName)}">`,
    biz.address ? `<div class="biz-line">${escHtml(biz.address)}</div>` : '',
    biz.phone ? `<div class="biz-line">Phone: ${escHtml(biz.phone)}</div>` : ''].join('');
  const period = `<div class="meta-row"><span>Period</span><b>${fromDate?fmtDate(fromDate):'Beginning'} to ${toDate?fmtDate(toDate):'Now'}</b></div>`;
  // Period summary (last picture only): opening balance when there is one, what was sold, what
  // was paid, and the closing balance — same box style as the receipts' balance summary.
  const summaryHtml = `<div class="balance-summary">
      ${ledger.hasOpening ? `<div class="row"><span>Opening Balance</span><span>${fmtRs(ledger.openingBalance)}</span></div>` : ''}
      <div class="row"><span>Total Sales in Period</span><span>${fmtRs(ledger.totalSales)}</span></div>
      <div class="row"><span>Total Payments in Period</span><span>${fmtRs(ledger.totalPayments)}</span></div>
      <div class="row total"><span>Closing Balance</span><span>${fmtRs(ledger.closingBalance)}</span></div>
    </div>`;
  const head = first
    ? `${bizLines}
    <div class="receipt-title">Client Statement</div>
    <div class="meta-row"><span>Client</span><b>${escHtml(clientName)}</b></div>
    ${period}`
    : `<div class="receipt-title" style="margin-top:0">Client Statement (continued)</div>
    <div class="meta-row"><span>Client</span><b>${escHtml(clientName)}</b></div>
    ${period}`;
  return `<div class="receipt" style="max-width:680px">
    ${receiptWatermarkDiv}
    ${head}
    <table>
      <thead><tr><th style="white-space:nowrap">Date</th><th>Details</th><th class="num" style="white-space:nowrap">Debit</th><th class="num" style="white-space:nowrap">Credit</th><th class="num" style="white-space:nowrap">Balance</th></tr></thead>
      <tbody>${rowHtmls.join('')}</tbody>
    </table>
    ${last ? summaryHtml : ''}
    ${last ? '<div class="footer-note">Thank you for your business.</div>' : ''}
    ${label ? `<div class="footer-note" style="margin-top:${last?8:20}px">${label}</div>` : ''}
  </div>`;
}
function buildClientStatementHtml(clientName, fromDate, toDate){
  const ledger = buildClientLedger(clientName, fromDate, toDate);
  if(!ledger) return null;
  const html = statementPartHtml(statementRowHtmls(ledger), {clientName, fromDate, toDate, ledger, first:true, last:true, label:''});
  // Naming convention for every shareable file: <ClientName>_<Date>_<Time> (see dateTimeStamp).
  const fileBase = `${_stmtSafeName(clientName)}_${dateTimeStamp()}`;
  return {html, fileBase};
}
// Turns the statement into one or more PNG pictures for sharing.
//
// Why several: WhatsApp (and most chat apps) shrink any picture so its longest side is at most
// 1600px. A long statement drawn as one tall picture is therefore squeezed to a sliver — a
// 1280x4600 statement arrives as ~450x1600 and blurs as soon as it is zoomed. Instead the rows
// are split at row boundaries into pages that are each at most 1600px tall at full size, so
// nothing gets shrunk and text stays sharp when zoomed. A short statement stays one picture.
// How many rows fit on a page is found by really drawing candidate pages and measuring them
// (the same way receiptHtmlToPngFile finds its height), never by guessing.
const STMT_MAX_PX = 1600, STMT_SCALE = 1.75, STMT_PAD = 40;
let _stmtImageCache = null; // last result, so a second tap on Share is instant (see shareClientStatement)
async function buildClientStatementImages(clientName, fromDate, toDate, onProgress){
  const ledger = buildClientLedger(clientName, fromDate, toDate);
  if(!ledger) return null;
  const rows = statementRowHtmls(ledger), n = rows.length;
  const base = `${_stmtSafeName(clientName)}_${dateTimeStamp()}`;
  const cacheKey = JSON.stringify([clientName, fromDate, toDate, n, ledger.closingBalance, ledger.rows.map(r=>r.balance).join(',')]);
  if(_stmtImageCache && _stmtImageCache.key === cacheKey) return _stmtImageCache.built;
  const ctx = {clientName, fromDate, toDate, ledger};
  const part = (i, j, label)=> statementPartHtml(rows.slice(i, j), {...ctx, first: i === 0, last: j === n, label});
  const MAXCSS = Math.floor(STMT_MAX_PX / STMT_SCALE);          // tallest page, in CSS px
  const fitsOne = async (html, limit)=> (await receiptInkHeight(html, limit)) + STMT_PAD <= limit;
  const files = [];
  let pageRanges = [[0, n]];
  // Whole statement on one picture? Use the sharper 2x when it is short enough for that.
  const whole = part(0, n, '');
  const wholeInk = await receiptInkHeight(whole, MAXCSS);
  if(wholeInk + STMT_PAD <= MAXCSS){
    const scale = wholeInk + STMT_PAD <= Math.floor(STMT_MAX_PX / 2) ? 2 : STMT_SCALE;
    files.push(await receiptHtmlToPngFile(whole, base + '.png', {scale}));
  } else {
    // Page ranges. Start from an estimate of rows per page, then grow/shrink using real renders.
    const fullInk = await receiptInkHeight(whole, 24000);
    const avgRow = isFinite(fullInk) ? Math.max(30, (fullInk - 260) / n) : 60;
    const ranges = [];
    let i = 0;
    while(i < n){
      if(onProgress) onProgress(ranges.length + 1);
      const fit = (k)=> fitsOne(part(i, i + k, 'Page 99 of 99'), MAXCSS);   // placeholder label = same height as the real one
      let k = Math.max(1, Math.min(n - i, Math.floor((MAXCSS - (i === 0 ? 300 : 120)) / avgRow)));
      if(await fit(k)){ while(i + k < n && await fit(k + 1)) k++; }
      else { while(k > 1 && !(await fit(k))) k--; }
      ranges.push([i, i + k]); i += k;
    }
    pageRanges = ranges;
    for(let p = 0; p < ranges.length; p++){
      const [a, b] = ranges[p];
      files.push(await receiptHtmlToPngFile(part(a, b, `Page ${p + 1} of ${ranges.length}`), `${base}_page${p + 1}of${ranges.length}.png`, {scale: STMT_SCALE}));
    }
  }
  const built = {files, fileBase: base, ranges: pageRanges, rowCount: n};
  _stmtImageCache = {key: cacheKey, built};
  return built;
}
// Bound to the Client Statement's Share button. Shares the statement as PNG picture(s) directly
// via the native share sheet — no in-app dialog first. shareClientStatementAsPdf below is
// kept only as a manual fallback (not wired to any button).
async function shareClientStatement(client, from, to){
  const stmtStatus = (msg) => { const el=document.getElementById('stmtStatus'); if(el) el.textContent = msg; };
  if(!client){ stmtStatus('Pick a client first.'); return; }
  if(!canShareFiles()){ stmtStatus('Sharing files isn\'t supported here — use Download instead.'); return; }
  try{
    stmtStatus('Preparing statement…');
    const built = await buildClientStatementImages(client, from, to, p=> stmtStatus(`Preparing statement… page ${p}`));
    if(!built){ stmtStatus(`No sales or payments found for ${client} in this range.`); return; }
    if(navigator.canShare && !navigator.canShare({files: built.files})){ stmtStatus('This device can\'t share that many pictures at once — pick a shorter From/To range, or use Download PDF.'); return; }
    await navigator.share({files: built.files});
    stmtStatus(built.files.length > 1 ? `Statement shared ✓ (${built.files.length} pictures)` : 'Statement shared ✓');
  }catch(e){
    if(e && e.name === 'AbortError'){ stmtStatus(''); return; }
    // The pictures are cached, so a second tap (a fresh tap the phone will accept) shares instantly.
    if(e && e.name === 'NotAllowedError'){ stmtStatus('Ready — tap Share Statement once more to send it.'); return; }
    stmtStatus('Could not open share — tap Share Statement again.');
  }
}
// Fallback path only (reached from the retry dialog when image sharing fails) — shares the
// same statement as a multi-page PDF via jsPDF, exactly as before. Filename convention
// (client + date range, ASCII-cleaned) is unchanged.
async function shareClientStatementAsPdf(client, from, to){
  const stmtStatus = (msg) => { const el=document.getElementById('stmtStatus'); if(el) el.textContent = msg; };
  if(!client){ stmtStatus('Pick a client first.'); return; }
  if(typeof window.jspdf === 'undefined'){ stmtStatus('PDF library is still loading — try again in a moment.'); return; }
  const built = renderClientStatementPdf(client, from, to);
  if(!built){ stmtStatus(`No sales or payments found for ${client} in this range.`); return; }
  let file = null;
  try{
    const blob = built.doc.output('blob');
    file = new File([blob], built.filename, {type:'application/pdf'});
    if(!navigator.share || !navigator.canShare || !navigator.canShare({files:[file]})){
      built.doc.save(built.filename);
      stmtStatus('This browser can\'t share files directly, so the PDF was downloaded — attach it from your Downloads. ✓');
      return;
    }
    await navigator.share({files:[file], title:`Statement — ${client}`, text:`Client statement — ${client}`});
    stmtStatus('Statement shared ✓');
  }catch(e){
    if(e && e.name === 'AbortError') return;
    if(file){ shareRetryDialog(file, e); return; }
    stmtStatus('Could not share the statement PDF: ' + (e && (e.name + ' ' + e.message) || 'unknown error'));
  }
}
// Up/down arrows to reorder a simple list (Qualities/Clients/Employees/Looms/Warp Types) —
// the array order IS the dropdown order everywhere else in the app, so moving an entry here
// moves it in every select field that lists it. isFirst/isLast disable the button that would
// have nowhere to go.
function moveBtns(key,idx,isFirst,isLast){
  return `<span class="row-actions">`
       + `<button class="ghost rowbtn move" data-move="${key}:${idx}:up" ${isFirst?'disabled':''} title="Move up" aria-label="Move up">↑</button>`
       + `<button class="ghost rowbtn move" data-move="${key}:${idx}:down" ${isLast?'disabled':''} title="Move down" aria-label="Move down">↓</button>`
       + `</span>`;
}
