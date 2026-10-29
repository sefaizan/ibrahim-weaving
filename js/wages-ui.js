/* Wages page screen (v3.17.38): period bar with quick chips, Summary / Payments / Rates / Settle tabs,
 * one card per employee (balance first, tap for the per-quality breakdown), a Pay button on each card and
 * a floating "+" that opens one quick-entry sheet (Payment / Bonus / Settle).
 * Nothing here changes a wage calculation: every figure comes from calc.js (computeWages,
 * computeEmployeeWageBalance, computeEmployeeWageNetForPeriod, rateForQualityOn). The old forms, logs,
 * Edit / Remove buttons and their element ids (wp_*, wb_*, ws_*, rc_*, sa_*, ob_*) are unchanged.
 * To go back to the earlier screen: restore the 3.17.37 copies of the changed files and delete this file. */

const WAGES_UI = {
  tab: 'sum',          // sum | pay | rates | settle
  logKind: 'pay',      // pay | bonus (which log shows on the Payments tab)
  bonusType: 'prod',   // prod | sal | all (who the "Add bonus" button covers)
  bonusAmt: null,      // amount typed in the bonus box, kept when the type is switched
  sheet: null,         // null, or { kind: 'pay'|'bonus'|'settle', emp, date } while the quick-entry sheet is open
  openEmps: new Set(), // employee cards that are expanded
};

/* ---------------- Period bar ---------------- */
function wagesPrevDay(d){ const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); }
// This wage week (Friday to Thursday), last wage week, this calendar month.
function wagePeriodPresets(){
  const t = todayStr(), tw = currentWageWeek(t), lw = currentWageWeek(wagesPrevDay(tw.from));
  const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)), p = n => String(n).padStart(2, '0');
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [
    { id: 'week', label: 'This week', from: tw.from, to: tw.to },
    { id: 'last', label: 'Last week', from: lw.from, to: lw.to },
    { id: 'month', label: 'This month', from: `${y}-${p(m)}-01`, to: `${y}-${p(m)}-${p(last)}` },
  ];
}
function wagesChipsHtml(from, to){
  const pr = wagePeriodPresets(), hit = pr.find(x => x.from === from && x.to === to);
  return pr.map(x => `<button type="button" class="wg-chip${hit && hit.id === x.id ? ' on' : ''}" data-wg-from="${x.from}" data-wg-to="${x.to}">${x.label}</button>`).join('')
    + `<button type="button" class="wg-chip${hit ? '' : ' on'}" data-wg-custom>Custom</button>`;
}
function wagesTopBarHtml(from, to){
  const tabs = [['sum', 'Summary'], ['pay', 'Payments']], moreOn = WAGES_UI.tab === 'rates' || WAGES_UI.tab === 'settle';
  return `<div class="wg-top">
    <div class="wg-chips" id="wg_chips">${wagesChipsHtml(from, to)}</div>
    <div class="wg-dates"><div class="field"><label>From</label><input id="wg_from" type="date" value="${from}"></div><div class="field"><label>To</label><input id="wg_to" type="date" value="${to}"></div></div>
  </div>
  <div class="wg-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" class="wg-tab${WAGES_UI.tab === k ? ' on' : ''}" data-wtab-btn="${k}" role="tab">${l}</button>`).join('')}<button type="button" class="wg-tab${moreOn ? ' on' : ''}" data-wtab-more role="tab" aria-expanded="${moreOn}">More</button></div>
  <div class="wg-more" id="wg_more"${moreOn ? '' : ' hidden'}>${[['rates', 'Rates'], ['settle', 'Settle']].map(([k, l]) => `<button type="button" class="wg-chip${WAGES_UI.tab === k ? ' on' : ''}" data-wtab-btn="${k}">${l}</button>`).join('')}</div>`;
}
function wagesPaneCls(k){ return 'wg-pane' + (WAGES_UI.tab === k ? ' on' : ''); }
function wagesSubCls(k){ return 'wg-sub' + (WAGES_UI.logKind === k ? ' on' : ''); }
function wagesLogSwitchHtml(){
  return `<div class="wg-seg" id="wg_logSwitch"><button type="button" class="${WAGES_UI.logKind === 'pay' ? 'on' : ''}" data-wg-log="pay">Payments</button><button type="button" class="${WAGES_UI.logKind === 'bonus' ? 'on' : ''}" data-wg-log="bonus">Bonus</button></div>`;
}

/* ---------------- Shared text for "what is still due" (Payments form and the quick-entry sheet) ---------------- */
// What to pay for the selected period. The period's wages (`due`) are reduced by any credit carried from earlier weeks being paid
// ahead (rounded-up payments, advances): when the employee's running balance is lower than the period's wages, the balance is
// what is actually owed, so that is the default amount and the credit is used up instead of piling up week after week.
// The period's net with `left` added: what is really still to pay once extra paid in earlier weeks is taken off (see computeWageLeftForPeriod).
function wagesNetFor(emp, from, to){
  const n = computeEmployeeWageNetForPeriod(emp, from || null, to || null);
  n.left = computeWageLeftForPeriod(emp, from || null, to || null).left;
  return n;
}
function wagesPayDue(emp, from, to){
  const n = computeEmployeeWageNetForPeriod(emp, from || null, to || null), b = computeEmployeeWageBalance(emp, to || null);
  const due = n.net > 0.004 ? n.net : 0, bal = b.balance;
  const eff = due > 0 && bal < due - 0.004 ? Math.max(bal, 0) : due;
  return {n, due, bal, eff, carry: due - eff};
}
function wagePaymentHelperMsg(emp, amt, from, to){
  if(!emp) return '';
  const pd = wagesPayDue(emp, from, to), {earned, paid} = pd.n, stillDue = pd.eff;
  const diff = stillDue - amt;
  const paidNote = paid > 0.004 ? ` (${fmtRs2(paid)} already paid for this period)` : '';
  let msg;
  if(diff > 0.004){
    msg = `${fmtRs2(diff)} of the ${fmtRs2(stillDue)} still due for the selected period won't be paid this time. Earned in period: ${fmtRs2(earned)}${paidNote}.`;
  } else if(diff < -0.004){
    msg = `This pays ${fmtRs2(Math.abs(diff))} more than the ${fmtRs2(stillDue)} still due for the selected period. Earned in period: ${fmtRs2(earned)}${paidNote}.`;
  } else if(stillDue > 0){
    msg = `This pays the full ${fmtRs2(stillDue)} still due for the selected period.${paidNote}`;
  } else if(paid > 0.004){
    msg = `Nothing left due for this period — ${fmtRs2(paid)} already paid against ${fmtRs2(earned)} earned.`;
  } else {
    msg = '';
  }
  if(pd.carry > 0.004) msg += (msg ? ' ' : '') + `${fmtRs2(pd.carry)} paid ahead in earlier weeks has been taken off this period's ${fmtRs2(pd.due)}.`;
  else if(pd.bal < -0.004) msg += (msg ? ' ' : '') + `They also have a credit of ${fmtRs2(Math.abs(pd.bal))} from being paid ahead of wages earned.`;
  return msg;
}

/* ---------------- Quick-entry sheet + floating + ---------------- */
function wagesSheetHtml(){
  const on = WAGES_UI.sheet ? ' on' : '';
  const kinds = [['pay', 'Payment'], ['bonus', 'Bonus'], ['settle', 'Settle']];
  return `<button type="button" class="wg-fab" data-wage-add="pay" aria-label="Add wage entry">+</button>
    <div class="wg-sheetbg${on}" id="wg_sheetBg"></div>
    <div class="wg-sheet${on}" id="wg_sheet" role="dialog" aria-label="Add wage entry">
      <div class="wg-seg" id="wq_kind">${kinds.map(([k, l]) => `<button type="button" data-wq-kind="${k}">${l}</button>`).join('')}</div>
      <div class="grid cols-1">${employeeSelectField('Employee', 'wq_emp')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
        <div class="field"><label>Date</label><input id="wq_date" type="date" value="${todayStr()}"></div>
        <div class="field"><label id="wq_amtL">Amount (Rs)</label><input id="wq_amt" type="number" inputmode="decimal" step="0.01"></div>
      </div>
      <div class="wg-qa" id="wq_chips"></div>
      <div class="note" id="wq_helper" style="margin-top:8px"></div>
      <div class="field" style="margin-top:8px"><label>Remarks (optional)</label><input id="wq_rem"></div>
      <div class="form-actions"><button type="button" class="primary" id="wq_save">Add Payment</button><button type="button" class="ghost" id="wq_close">Close</button></div>
    </div>`;
}
const wagesR2 = n => Math.round((Number(n) || 0) * 100) / 100;
function wagesLastBy(list, emp){
  const r = list.filter(x => x.employee === emp).slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return r.length ? r[r.length - 1] : null;
}
// Next employee (after `current`, wrapping round) who still has something due for the period; '' if nobody.
function wagesNextDueEmployee(current, from, to){
  const names = wageRelevantEmployees().filter(e => e.active !== false).map(e => e.name);
  const start = names.indexOf(current);
  for(let k = 1; k <= names.length; k++){
    const n = names[(start + k + names.length) % names.length];
    if(n !== current && computeEmployeeWageNetForPeriod(n, from || null, to || null).net > 0.004) return n;
  }
  return '';
}
// Fill the sheet to match WAGES_UI.sheet. setAmount = also put the suggested amount in the box
// (when the sheet opens and when the employee changes, never while typing).
function wagesSheetFill(setAmount){
  const s = WAGES_UI.sheet; if(!s) return;
  const k = s.kind, emp = v('wq_emp'), from = v('wg_from') || null, to = v('wg_to') || null;
  document.querySelectorAll('[data-wq-kind]').forEach(b => b.classList.toggle('on', b.dataset.wqKind === k));
  const save = document.getElementById('wq_save'); if(save) save.textContent = { pay: 'Add Payment', bonus: 'Add Bonus', settle: 'Mark Settled' }[k];
  const paidUp = k === 'pay' && emp && wagesPeriodPaid(wagesNetFor(emp, from, to));
  if(save){ save.disabled = !!paidUp; save.title = paidUp ? 'Already paid for this period' : ''; }
  const amt = document.getElementById('wq_amt');
  const lbl = document.getElementById('wq_amtL'); if(lbl) lbl.textContent = k === 'settle' ? 'Carry Forward (Rs)' : k === 'bonus' ? 'Bonus Amount (Rs)' : 'Amount Paid (Rs)';
  if(amt){ if(k === 'settle') amt.removeAttribute('inputmode'); else amt.setAttribute('inputmode', 'decimal'); } // settle may be negative: default number keyboard
  const chips = []; let def = '';
  if(emp){
    const b = computeEmployeeWageBalance(emp);
    if(k === 'pay'){
      const pd = wagesPayDue(emp, from, to);
      const due = pd.eff > 0.004 ? wagesR2(pd.eff) : 0, bal = b.balance > 0.004 ? wagesR2(b.balance) : 0;
      const last = wagesLastBy(DATA.wagePayments, emp);
      if(due) chips.push([pd.carry > 0.004 ? 'Period due (after credit)' : 'Period due', due]);
      if(bal && bal !== due) chips.push(['Full balance', bal]);
      if(last) chips.push(['Last paid', Number(last.amount) || 0]);
      def = due || bal || '';
    } else if(k === 'bonus'){
      const last = wagesLastBy(DATA.wageBonuses, emp);
      if(last) chips.push(['Last bonus', Number(last.amount) || 0]);
    } else {
      chips.push(['Current balance', wagesR2(b.balance)], ['Zero', 0]);
      def = wagesR2(b.balance);
    }
  }
  const box = document.getElementById('wq_chips');
  if(box) box.innerHTML = chips.map(([l, x]) => `<button type="button" class="wg-chip" data-wq-amt="${x}">${l}${x || l !== 'Zero' ? ' ' + fmtRs2(x) : ''}</button>`).join('');
  if(setAmount && amt) amt.value = def === '' ? '' : String(def);
  const help = document.getElementById('wq_helper');
  if(help) help.textContent = (k === 'pay' && emp) ? wagePaymentHelperMsg(emp, Number(v('wq_amt') || 0), from, to) : '';
}
// The page's scroll position is kept while the sheet is open and put back when it closes: focusing the amount box (and the phone
// keyboard) otherwise leaves the page scrolled to the bottom.
function wagesScrollMark(){
  const sc = document.getElementById('panels');
  WAGES_UI.sheetY = { p: sc ? sc.scrollTop : 0, w: typeof window !== 'undefined' ? window.scrollY : 0 };
}
function wagesScrollBack(){
  const y = WAGES_UI.sheetY; if(!y) return;
  const sc = document.getElementById('panels'), put = () => { if(sc) sc.scrollTop = y.p; if(typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, y.w); };
  put(); if(typeof requestAnimationFrame === 'function') requestAnimationFrame(put);
}
function wagesSheetOpen(kind, emp){
  if(!WAGES_UI.sheet) wagesScrollMark();
  // Opened from one person's Pay button = a single payment (the sheet closes after it); opened from the + button = a run of payments.
  WAGES_UI.sheet = { kind: kind || 'pay', emp: emp || '', date: todayStr(), single: !!emp };
  const bg = document.getElementById('wg_sheetBg'), sh = document.getElementById('wg_sheet');
  if(bg) bg.classList.add('on'); if(sh) sh.classList.add('on');
  const e = document.getElementById('wq_emp'); if(e) e.value = WAGES_UI.sheet.emp;
  const d = document.getElementById('wq_date'); if(d) d.value = WAGES_UI.sheet.date;
  const r = document.getElementById('wq_rem'); if(r) r.value = '';
  wagesSheetFill(true);
  const a = document.getElementById('wq_amt'); if(a && emp) setTimeout(() => { try{ a.focus({ preventScroll: true }); a.select(); }catch(err){} }, 60);
}
function wagesSheetClose(){
  WAGES_UI.sheet = null;
  ['wg_sheetBg', 'wg_sheet'].forEach(i => { const el = document.getElementById(i); if(el) el.classList.remove('on'); });
  wagesScrollBack(); WAGES_UI.sheetY = null;
}
async function wagesSheetSave(){
  const s = WAGES_UI.sheet; if(!s) return;
  const k = s.kind, emp = v('wq_emp'), date = v('wq_date'), raw = v('wq_amt'), amt = Number(raw || 0), rem = v('wq_rem');
  if(!requireFields([
    [date, 'Pick the date first.', 'wq_date'],
    [emp, 'Pick an employee first.', 'wq_emp'],
    [k === 'settle' ? raw !== '' : amt > 0, k === 'settle' ? 'Enter the carry forward first (0 if fully settled).' : 'Enter the amount first.', 'wq_amt'],
  ])) return;
  if(k === 'pay' && wagesPeriodPaid(wagesNetFor(emp, v('wg_from') || null, v('wg_to') || null))){ showToast('Already paid in full for this period.'); return; }
  EDITING = null; // a half-finished Edit on the page's own form must not turn this into an overwrite
  const id = uid(), list = k === 'settle' ? 'wageSettlements' : k === 'bonus' ? 'wageBonuses' : 'wagePayments';
  DATA[list].push(k === 'settle' ? { id, date, employee: emp, carryForward: amt, remarks: rem } : Object.assign({ id, date, employee: emp, amount: amt, remarks: rem }, v('wg_from') && v('wg_to') ? { periodFrom: v('wg_from'), periodTo: v('wg_to') } : {}));
  PAGE[list] = 1;
  await save();
  // A change held for the owner's approval (or refused) leaves the ledger as it was: say nothing false.
  const kept = DATA[list].some(r => r.id === id);
  let next = '';
  if(kept){
    showToast(`${{ pay: 'Paid', bonus: 'Bonus', settle: 'Settled' }[k]} ${k === 'settle' ? fmtRs2(amt) + ' carried' : fmtRs2(amt)} · ${emp}`, k === 'pay' ? 10000 : undefined, k === 'pay' ? { label: 'Share slip', fn: () => shareWageReceipt(id) } : undefined);
    if(k === 'pay') next = wagesNextDueEmployee(emp, v('wg_from'), v('wg_to'));
  }
  // Paying several people in a row: stay open on the next person who is still due; otherwise close.
  // (Only when it was opened from the + button: a person's own Pay button means a single payment, so the sheet just closes.)
  WAGES_UI.sheet = (kept && (k !== 'pay' || (next && !s.single))) ? { kind: k, emp: s.single ? '' : next, date, single: false } : null;
  if(!WAGES_UI.sheetY) wagesScrollMark();
  switchTab('wages');
  wagesScrollBack(); if(!WAGES_UI.sheet) WAGES_UI.sheetY = null;
}

// Pay is off for a period that is already paid in full (something was earned and nothing is left due).
// n.left (from wagesNetFor) already takes earlier extra payments off; plain {earned, paid, net} objects fall back to net.
function wagesOwedOf(n){ return typeof n.left === 'number' ? n.left : n.net; }
function wagesPeriodPaid(n){ return n.earned > 0.004 && wagesOwedOf(n) <= 0.004; }
// The newest payment of the period (same date rule as the Paid figure), so a paid card can share its receipt from here.
function wagesPeriodPayment(name, from, to){
  return (DATA.wagePayments || []).filter(p => p.employee === name && (!from || p.date >= from) && (!to || p.date <= to)).reduce((a, p) => !a || p.date >= a.date ? p : a, null);
}
// Period status for a card: Paid (nothing left), Part (something paid, something left), Due (nothing paid yet); nothing when nothing was earned.
function wagesStatusTag(net){
  if(net.earned <= 0.004 && Math.abs(net.net) <= 0.004) return '';
  if(wagesOwedOf(net) <= 0.004) return '<span class="wg-tag zero">Paid</span>';
  return net.paid > 0.004 ? '<span class="wg-tag due">Part</span>' : '<span class="wg-tag due">Due</span>';
}
// People still owed first (biggest amount first), then everyone else.
function wagesDueFirst(a, b){ return ((b.net.net > 0.004) - (a.net.net > 0.004)) || (b.net.net - a.net.net); }
function wagesPayBtn(name, net, from, to){
  const done = wagesPeriodPaid(net), last = done ? wagesPeriodPayment(name, from, to) : null;
  const share = last ? `<button type="button" class="ghost wg-pay" data-wage-share="${escHtml(last.id)}" aria-label="Share receipt" title="Share the wage receipt" style="padding-inline:12px;min-width:0">${typeof ICON_SHARE !== 'undefined' ? ICON_SHARE : 'Share'}</button>` : '';
  return share + `<button type="button" class="ghost wg-pay" data-wage-add="pay" data-wage-emp="${escHtml(name)}"${done ? ' disabled aria-disabled="true" title="' + (net.paid > 0.004 ? 'Already paid for this period' : 'Covered by extra paid in earlier weeks') + '" style="opacity:.55"' : ''}>${done ? 'Paid' : 'Pay'}</button>`;
}

/* ---------------- Summary tab ---------------- */
function wagesEmpCardHtml(d, qualities, from, to, asOf){
  const {name, row, bal, net} = d, open = WAGES_UI.openEmps.has(name);
  const tag = bal.balance > 0.004 ? `<span class="wg-tag due">${fmtRs(bal.balance)} owed</span>`
    : bal.balance < -0.004 ? `<span class="wg-tag cr">${fmtRs(Math.abs(bal.balance))} credit</span>` : `<span class="wg-tag zero">Settled</span>`;
  const netCls = net.net > 0.004 ? 'due' : net.net < -0.004 ? 'cr' : '';
  const qRows = row ? qualities.map((q, i) => ({ q, b: row.byQuality[i] })).filter(x => x.b.meters || x.b.wages || x.b.diffMeters) : [];
  let changed = false;
  const body = qRows.map(({ q, b }) => {
    const r = rateForQualityOn(q.name, asOf), r0 = from ? rateForQualityOn(q.name, from) : r, star = r !== r0;
    if(star) changed = true;
    return `<tr><td>${escHtml(q.name)}</td><td>${fmtQtyMtr(b.meters)}</td><td>${fmtRs2(r).replace('Rs ', '')}${star ? '*' : ''}</td><td><b>${fmtRs2(b.wages).replace('Rs ', '')}</b></td></tr>`;
  }).join('');
  const own = row ? row.totalMeters - row.totalDiffMeters : 0;
  const carry = bal.carryForward ? (bal.carryForward > 0 ? `${fmtRs2(bal.carryForward)} owed` : `${fmtRs2(Math.abs(bal.carryForward))} credit`) : '—';
  const detail = qRows.length
    ? `<div class="wg-scroll"><table class="wg-q"><thead><tr><th>Quality</th><th>Meters</th><th>Rate</th><th>Wages Rs</th></tr></thead><tbody>${body}</tbody>
       <tfoot><tr><td>Total</td><td>${fmtQtyMtr(row.totalMeters)}</td><td></td><td>${fmtRs2(row.totalWagesNoBonus).replace('Rs ', '')}</td></tr></tfoot></table></div>${changed ? '<div class="wg-fine">* rate changed during this period (rate shown is the one on the To date)</div>' : ''}`
    : `<div class="wg-fine">No production in this period.</div>`;
  return `<div class="wg-emp${open ? ' open' : ''}" data-wg-emp="${escHtml(name)}">
    <div class="wg-eh" data-wg-toggle><span class="wg-chev">${ICON_CHEV}</span><span class="name">${escHtml(name)}</span>${wagesStatusTag(net)}${tag}${wagesPayBtn(name, net, from, to)}</div>
    <div class="wg-sub" data-wg-toggle>Earned <b>${fmtRs2(net.earned)}</b> · ${fmtQtyMtr(row ? row.totalMeters : 0)} m</div>
    <div class="wg-det">${detail}
      <div class="wg-lines">${row && row.salary > 0 ? `<span>Weekly salary earned <b>${fmtRs2(row.salary)}</b></span>` : ''}<span>Bonus <b>${fmtRs2(row ? row.bonus : 0)}</b></span><span>Total with bonus <b>${fmtRs2(row ? row.totalWages : 0)}</b></span><span>Paid <b>${net.paid ? fmtRs2(net.paid) : '\u2013'}</b></span><span>Net <b class="${netCls}">${fmtRs2(net.net)}</b></span><span>Carried forward <b>${carry}</b></span><span>Last settled <b>${bal.lastSettled ? fmtDate(bal.lastSettled) : 'Never'}</b></span></div></div>
  </div>`;
}
// Salaried staff get their own card: weekly salary, salary earned in the period, bonus, paid, net. No meters or quality table.
function wagesSalCardHtml(d, from, to, asOf){
  const {name, row, bal, net} = d, open = WAGES_UI.openEmps.has(name);
  const emp = DATA.employees.find(e => e.name === name) || {};
  const tag = bal.balance > 0.004 ? `<span class="wg-tag due">${fmtRs(bal.balance)} owed</span>`
    : bal.balance < -0.004 ? `<span class="wg-tag cr">${fmtRs(Math.abs(bal.balance))} credit</span>` : `<span class="wg-tag zero">Settled</span>`;
  const netCls = net.net > 0.004 ? 'due' : net.net < -0.004 ? 'cr' : '';
  const weekly = salaryWeeklyOn(name, asOf);
  const carry = bal.carryForward ? (bal.carryForward > 0 ? `${fmtRs2(bal.carryForward)} owed` : `${fmtRs2(Math.abs(bal.carryForward))} credit`) : '';
  return `<div class="wg-emp${open ? ' open' : ''}" data-wg-emp="${escHtml(name)}">
    <div class="wg-eh" data-wg-toggle><span class="wg-chev">${ICON_CHEV}</span><span class="name">${escHtml(name)}</span>${wagesStatusTag(net)}${tag}${wagesPayBtn(name, net, from, to)}</div>
    <div class="wg-sub" data-wg-toggle>${emp.title ? escHtml(emp.title) : 'Salaried'} · Earned <b>${fmtRs2(row ? row.totalWages : 0)}</b> · Salary ${weekly ? fmtRs2(weekly) + '/week' : '\u2013'}</div>
    <div class="wg-det"><div class="wg-lines"><span>Salary <b>${fmtRs2(row ? row.salary : 0)}</b></span>${row && row.totalWagesNoBonus > 0 ? `<span>Wages <b>${fmtRs2(row.totalWagesNoBonus)}</b></span>` : ''}<span>Bonus <b>${row && row.bonus ? fmtRs2(row.bonus) : '\u2013'}</b></span><span>Total with bonus <b>${fmtRs2(row ? row.totalWages : 0)}</b></span><span>Paid <b>${net.paid ? fmtRs2(net.paid) : '\u2013'}</b></span><span>Net <b class="${netCls}">${fmtRs2(net.net)}</b></span><span>Carried forward <b>${carry || '\u2013'}</b></span><span>Last settled <b>${bal.lastSettled ? fmtDate(bal.lastSettled) : 'Never'}</b></span></div></div>
  </div>`;
}
// People who would get the weekly bonus: active staff of the chosen type (prod = per-meter, sal = salaried, all = both)
// (the type is the employee's Basis in Settings: per meter or salary) who have no bonus logged in the period yet.
// No earnings test: the bonus is a flat amount for each person of that type.
function wagesBonusTargets(items, from, to, type){
  type = type || 'prod';
  return items.filter(d => (type === 'all' || (type === 'sal') === isSalariedEmp(d.name)) && (DATA.employees.find(e => e.name === d.name) || {}).active !== false
    && !(DATA.wageBonuses || []).some(b => b.employee === d.name && (!from || b.date >= from) && (!to || b.date <= to))).map(d => d.name);
}
const WAGES_BONUS_TYPES = [['prod', 'Production staff'], ['sal', 'Salaried staff'], ['all', 'All']];
function wagesBonusAllHtml(items, from, to){
  const type = WAGES_UI.bonusType || 'prod';
  if(!WAGES_BONUS_TYPES.some(([k]) => wagesBonusTargets(items, from, to, k).length)) return '';
  const names = wagesBonusTargets(items, from, to, type);
  const typed = items.filter(d => (type === 'all' || (type === 'sal') === isSalariedEmp(d.name)) && (DATA.employees.find(e => e.name === d.name) || {}).active !== false).length;
  const last = (DATA.wageBonuses || []).filter(b => type === 'all' || (type === 'sal') === isSalariedEmp(b.employee)).sort((a, b) => a.date < b.date ? -1 : 1).pop();
  const amt = WAGES_UI.bonusAmt != null ? WAGES_UI.bonusAmt : (last ? Number(last.amount) || 500 : 500);
  const btnTxt = names.length ? `Add bonus to ${names.length} ${names.length === 1 ? 'person' : 'people'}` : (typed ? 'Everyone already has a bonus this period' : 'No active staff of this type');
  return `<div class="wg-pw-bonus" style="flex-wrap:wrap"><select id="wg_bonusType" aria-label="Bonus for" style="flex:1 1 55%;margin:0">${WAGES_BONUS_TYPES.map(([k, l]) => `<option value="${k}"${k === type ? ' selected' : ''}>${l}</option>`).join('')}</select><input id="wg_bonusAll" type="number" inputmode="decimal" min="0" value="${amt}" aria-label="Bonus amount (Rs)" style="flex:0 0 90px"><button type="button" class="ghost" style="flex:1 1 100%;border-radius:12px" data-wg-bonus-all${names.length ? '' : ' disabled'}>${btnTxt}</button>${names.length ? `<div class="note" style="flex:1 1 100%;margin:0">Will go to: ${names.map(escHtml).join(', ')}</div>` : ''}</div>`;
}
function renderWages(){
  const from = v('wg_from'), to = v('wg_to');
  const wrap = document.getElementById('wagesWrap'); if(!wrap) return;
  const qualities = DATA.qualities;
  if(!qualities.length || !DATA.employees.length){
    wrap.innerHTML = `<div class="card"><div class="empty">Add employees and qualities in the settings tab to see wages.</div></div>`;
    return;
  }
  const asOf = to || todayStr();
  const rows = computeWages(from, to), rowOf = {}; rows.forEach(r => { rowOf[r.employee] = r; });
  // Everyone relevant for balances, plus anyone with earnings in the period (never hide earned money).
  const names = wageRelevantEmployees().map(e => e.name); rows.forEach(r => { if(!names.includes(r.employee)) names.push(r.employee); });
  const meterRows = rows.filter(r => !isSalariedEmp(r.employee));
  const data = names.map(name => ({ name, row: rowOf[name], bal: computeEmployeeWageBalance(name), net: wagesNetFor(name, from, to) }));
  // Follows the selected period: earned minus paid within it (the running balance is on Settle).
  const owed = data.reduce((s, d) => s + (d.net.net > 0.004 ? d.net.net : 0), 0);
  const credit = data.reduce((s, d) => s + (d.net.net < -0.004 ? -d.net.net : 0), 0);
  const earned = data.reduce((s, d) => s + d.net.earned, 0), paid = data.reduce((s, d) => s + d.net.paid, 0);
  const bonus = rows.reduce((s, r) => s + r.bonus, 0);

  // Totals by quality (several qualities are often woven at the same time): only qualities with something in the period.
  const tMeters = qualities.map((q, i) => rows.reduce((s, r) => s + r.byQuality[i].meters, 0));
  const tDiff = qualities.map((q, i) => rows.reduce((s, r) => s + r.byQuality[i].diffMeters, 0));
  const tWages = qualities.map((q, i) => rows.reduce((s, r) => s + r.byQuality[i].wages, 0));
  const tDiffW = qualities.map((q, i) => rows.reduce((s, r) => s + r.byQuality[i].diffWages, 0));
  const act = qualities.map((q, i) => i).filter(i => tMeters[i] !== 0 || tWages[i] !== 0);
  const gM = tMeters.reduce((a, b) => a + b, 0), gD = tDiff.reduce((a, b) => a + b, 0), gW = tWages.reduce((a, b) => a + b, 0);

  // The full wide tables (as on the earlier screen), kept under one fold for exact figures.
  const showNum = n => n ? fmtQtyMtr(n) : '', showRs2 = n => n ? fmtRs2(n) : '';
  const gDiffW = rows.reduce((s, r) => s + r.totalDiffWages, 0);
  // ONE table: for each quality the meters woven and the wages earned side by side, so nothing needs tallying across two tables.
  const dAct = act.filter(i => tDiff[i] !== 0);
  const g2 = t => `<th colspan="2">${t}</th>`, mr = '<th>Mtr</th><th>Rs</th>';
  const head1 = `<th rowspan="2">Employee</th>${act.map(i => g2(escHtml(qualities[i].name))).join('')}${dAct.map(i => g2(escHtml(qualities[i].name) + ' Diff')).join('')}${g2('Excl. Diff')}${g2('Total')}<th rowspan="2">Bonus (Rs)</th><th rowspan="2">Total Wages</th>`;
  const head2 = mr.repeat(act.length + dAct.length + 2);
  const rows2 = meterRows.map(r => `<tr><td><span class="name">${escHtml(r.employee)}</span></td>${act.map(i => `<td>${showNum(r.byQuality[i].meters)}</td><td>${showRs2(r.byQuality[i].wages)}</td>`).join('')}${dAct.map(i => `<td class="mono">${showNum(r.byQuality[i].diffMeters)}</td><td class="mono">${showRs2(r.byQuality[i].diffWages)}</td>`).join('')}<td class="mono">${showNum(r.totalMeters - r.totalDiffMeters)}</td><td class="mono">${showRs2(r.totalWagesNoBonus - r.totalDiffWages)}</td><td class="mono"><b>${showNum(r.totalMeters)}</b></td><td class="mono"><b>${showRs2(r.totalWagesNoBonus)}</b></td><td>${showRs2(r.bonus)}</td><td class="mono"><b>${showRs2(r.totalWages)}</b></td></tr>`).join('');
  const foot2 = `<tr><td><b>Total</b></td>${act.map(i => `<td><b>${showNum(tMeters[i])}</b></td><td><b>${showRs2(tWages[i])}</b></td>`).join('')}${dAct.map(i => `<td><b>${showNum(tDiff[i])}</b></td><td><b>${showRs2(tDiffW[i])}</b></td>`).join('')}<td><b>${showNum(gM - gD)}</b></td><td><b>${showRs2(gW - gDiffW)}</b></td><td><b>${showNum(gM)}</b></td><td><b>${showRs2(gW)}</b></td><td><b>${showRs2(bonus)}</b></td><td><b>${showRs2(gW + bonus)}</b></td></tr>`;

  // Production by quality for the period, laid out like "In Stock by Quality" in Overview's At a Glance card
  // (quality on the left, meters on the right) plus a share bar and a total. Diff meters are included.
  const prodRows = act.filter(i => tMeters[i] > 0.0001);
  const prodHtml = prodRows.length ? `<div class="wg-prod"><div class="wg-prod-title">Production by Quality (mtr)</div>${prodRows.map(i => {
      const pct = gM > 0 ? Math.max(3, Math.round(tMeters[i] / gM * 100)) : 0;
      return `<div class="wg-prod-row"><span class="q">${escHtml(qualities[i].name)}</span><span class="m">${fmtQtyMtr(tMeters[i])}</span><span class="bar"><i style="width:${pct}%"></i></span></div>`;
    }).join('')}${prodRows.length > 1 ? `<div class="wg-prod-row tot"><span class="q">Total production</span><span class="m">${fmtQtyMtr(gM)}</span></div>` : ''}</div>` : '';

  wrap.innerHTML = `
    <div class="card wg-hero"><div class="wg-hero-l">Still owed to employees (this period)</div><div class="wg-hero-big">${fmtRs(owed)}</div>
            <div class="wg-hero-row3"><span>Earned <b>${fmtRs(earned - bonus)}</b></span><span>Bonus <b>${fmtRs(bonus)}</b></span><span>Paid extra <b>${fmtRs(credit)}</b></span></div>
      <div class="wg-hero-grand"><span>Grand total</span><b>${fmtRs(earned + credit)}</b></div>
      ${prodHtml}
      <div class="wg-hero-sub">Earned, paid, bonus and production are for ${fmtDate(from)} to ${fmtDate(to)}</div></div>
    <div class="card"><div class="card-head"><h2>Employees</h2><button type="button" class="info-btn" data-info-toggle data-info-target="info-wgemps" title="Info">i</button></div>
      <p class="note info-note" id="info-wgemps" hidden>Everyone in one list, people still owed first. Tap a name for the breakdown (per-meter staff: own meters, the share of unassigned Difference, the rate and the wages; salaried staff: salary, bonus and carried forward). "Earned" and "Paid" are for the selected period only (earned includes bonus), and "Net" reaches 0 once you have paid what was earned there. "Owed" is the running balance since the employee's last settlement, whatever period is selected. "Credit" means paid ahead of wages earned. Weekly salary accrues daily. Advances to employees are in the Employee Loans page.</p>
      ${wagesBonusAllHtml(data, from, to)}
      ${data.slice().sort(wagesDueFirst).map(d => isSalariedEmp(d.name) ? wagesSalCardHtml(d, from, to, asOf) : wagesEmpCardHtml(d, qualities, from, to, asOf)).join('') || '<div class="empty">No employees</div>'}</div>
    <details class="card wg-full" open><summary>Full table (meters & wages)</summary>
      <div class="log-scroll"><table><thead><tr>${head1}</tr><tr>${head2}</tr></thead><tbody>${rows2 || '<tr><td class="empty" colspan="99">No employees yet</td></tr>'}</tbody>
      <tfoot>${foot2}</tfoot></table></div>${dAct.length ? '<div class="wg-fine">Diff = each employee\'s share of unassigned loom output, already included in the totals and paid at that quality\'s own rate.</div>' : ''}
    </details>`;
}

/* ---------------- Wiring (called by wiring.js each time the Wages page is drawn) ---------------- */
// Add the same weekly bonus for everyone listed. Tap once to arm, again to add (native confirm() is blocked in places).
async function wagesBonusAll(btn){
  const amt = Number(v('wg_bonusAll') || 0);
  if(!(amt > 0)){ showToast('Enter the bonus amount first.'); return; }
  if(!btn.__armed){
    btn.__armed = true; const txt = btn.textContent; btn.textContent = `Tap again: Rs ${amt} each`;
    setTimeout(() => { btn.__armed = false; btn.textContent = txt; }, 5000); return;
  }
  const from = v('wg_from'), to = v('wg_to'), t = todayStr();
  const date = (from && t < from) ? from : (to && t > to) ? to : t; // a date inside the period, so the bonus lands in it
  const items = wageRelevantEmployees().map(e => ({ name: e.name, net: computeEmployeeWageNetForPeriod(e.name, from, to) }));
  const names = wagesBonusTargets(items, from, to, WAGES_UI.bonusType);
  if(!names.length){ showToast('Everyone already has a bonus in this period.'); return; }
  EDITING = null;
  names.forEach(name => addWageBonusEntry({ date, employee: name, amount: amt, remarks: 'Weekly bonus' }, false, uid));
  WAGES_UI.bonusAmt = null;
  PAGE.wageBonuses = 1;
  await save();
  showToast(`Bonus Rs ${amt} added for ${names.length} ${names.length === 1 ? 'person' : 'people'}`);
  const sc = document.getElementById('panels'), y = sc ? sc.scrollTop : 0;
  switchTab('wages'); if(sc) sc.scrollTop = y;
}
function wagesUiWire(){
  const root = document.getElementById('wagesRoot'); if(!root) return;
  const scroller = document.getElementById('panels');
  const showTab = (k) => {
    WAGES_UI.tab = k;
    root.querySelectorAll('[data-wtab-btn]').forEach(b => b.classList.toggle('on', b.dataset.wtabBtn === k));
    root.querySelectorAll('[data-wpane]').forEach(p => p.classList.toggle('on', p.dataset.wpane === k));
    const more = k === 'rates' || k === 'settle', mb = root.querySelector('[data-wtab-more]'), mm = document.getElementById('wg_more');
    if(mb) mb.classList.toggle('on', more);
    if(mm && more) mm.hidden = false;
    if(scroller) scroller.scrollTop = 0;
  };
  const refreshChips = () => { const c = document.getElementById('wg_chips'); if(c) c.innerHTML = wagesChipsHtml(v('wg_from'), v('wg_to')); };
  ['wg_from', 'wg_to'].forEach(id => { const el = document.getElementById(id); if(el) el.addEventListener('change', () => { refreshChips(); if(WAGES_UI.sheet) wagesSheetFill(false); }); });
  root.addEventListener('click', (e) => {
    const t = e.target;
    const moreBtn = t.closest('[data-wtab-more]');
    if(moreBtn){ const mm = document.getElementById('wg_more'); if(mm){ mm.hidden = !mm.hidden; moreBtn.setAttribute('aria-expanded', String(!mm.hidden)); } return; }
    const tabBtn = t.closest('[data-wtab-btn]'); if(tabBtn){ showTab(tabBtn.dataset.wtabBtn); return; }
    const ba = t.closest('[data-wg-bonus-all]');
    if(ba){ wagesBonusAll(ba); return; }
    const chip = t.closest('[data-wg-from]');
    if(chip){
      document.getElementById('wg_from').value = chip.dataset.wgFrom;
      const to = document.getElementById('wg_to'); to.value = chip.dataset.wgTo;
      to.dispatchEvent(new Event('change')); // the page's own handler recalculates and saves the period
      return;
    }
    if(t.closest('[data-wg-custom]')){ const f = document.getElementById('wg_from'); if(f){ try{ f.focus(); if(f.showPicker) f.showPicker(); }catch(err){} } return; }
    const lg = t.closest('[data-wg-log]');
    if(lg){
      WAGES_UI.logKind = lg.dataset.wgLog;
      root.querySelectorAll('[data-wg-log]').forEach(b => b.classList.toggle('on', b === lg));
      root.querySelectorAll('[data-wsub]').forEach(s => s.classList.toggle('on', s.dataset.wsub === WAGES_UI.logKind));
      return;
    }
    const sh = t.closest('[data-wage-share]');
    if(sh){ shareWageReceipt(sh.dataset.wageShare); return; }
    const add = t.closest('[data-wage-add]');
    if(add){ wagesSheetOpen(add.dataset.wageAdd, add.dataset.wageEmp || ''); return; }
    const head = t.closest('[data-wg-toggle]');
    if(head && !t.closest('button')){
      const card = head.closest('[data-wg-emp]'), n = card.dataset.wgEmp;
      const open = !card.classList.contains('open'); card.classList.toggle('open', open);
      if(open) WAGES_UI.openEmps.add(n); else WAGES_UI.openEmps.delete(n);
      return;
    }
    const kind = t.closest('[data-wq-kind]');
    if(kind){ if(WAGES_UI.sheet){ WAGES_UI.sheet.kind = kind.dataset.wqKind; wagesSheetFill(true); } return; }
    const qa = t.closest('[data-wq-amt]');
    if(qa){ const a = document.getElementById('wq_amt'); if(a){ a.value = qa.dataset.wqAmt; wagesSheetFill(false); } return; }
    if(t.closest('#wq_close') || t.id === 'wg_sheetBg'){ wagesSheetClose(); return; }
    if(t.closest('#wq_save')){ wagesSheetSave(); return; }
  });
  const bt = document.getElementById('wg_bonusType');
  if(bt) bt.addEventListener('change', () => {
    WAGES_UI.bonusType = bt.value; const ba = document.getElementById('wg_bonusAll'); WAGES_UI.bonusAmt = null; void ba; // new type, so its own usual amount
    const sc = document.getElementById('panels'), y = sc ? sc.scrollTop : 0; switchTab('wages'); if(sc) sc.scrollTop = y;
  });
  const emp = document.getElementById('wq_emp'); if(emp) emp.addEventListener('change', () => wagesSheetFill(true));
  const amt = document.getElementById('wq_amt'); if(amt) amt.addEventListener('input', () => wagesSheetFill(false));
  if(typeof wireEnterSubmit === 'function') wireEnterSubmit(['wq_date', 'wq_emp', 'wq_amt', 'wq_rem'], 'wq_save');
  // The sheet was open when the page redrew (after saving one payment): fill it again.
  if(WAGES_UI.sheet){
    const s = WAGES_UI.sheet;
    if(emp) emp.value = s.emp || '';
    const d = document.getElementById('wq_date'); if(d) d.value = s.date || todayStr();
    wagesSheetFill(true);
    if(amt && s.emp) setTimeout(() => { try{ amt.focus(); amt.select(); }catch(err){} }, 60);
  }
}
