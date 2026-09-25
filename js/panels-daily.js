/* Everyday pages: form field builders, Production, Sale, Recovery (incl. cheque cards), Expense,
 * Family, Warp, Weft and Warp Beams. (Calculations for these live in calc.js.) */

/* ---------------- Form field builders ---------------- */
function field(label, id, type='text', extra=''){
  return `<div class="field"><label>${label}</label><input id="${id}" type="${type}" ${extra}></div>`;
}
function textareaField(label, id, extra=''){
  return `<div class="field"><label>${label}</label><textarea id="${id}" rows="2" ${extra}></textarea></div>`;
}
function selectField(label, id, arr, extra=''){
  return `<div class="field"><label>${label}</label><select id="${id}" ${extra}><option value="">—</option>${opts(arr)}</select></div>`;
}
// Two boxes in a single row: whole meters + sixteenths (the same fraction convention used
// for Stock Position on the Overview page). Kept as two plain number inputs for now — the two
// values are combined into one decimal number when the form is read (see combineMtr16 in
// core.js); the stored record itself is unchanged.
function meterFracField(label, idWhole, idSixteenth, extra=''){
  return `<div class="field"><label>${label}</label>
    <div style="display:flex;gap:8px">
      <input id="${idWhole}" type="number" placeholder="Whole" ${extra} style="flex:2;min-width:0">
      <input id="${idSixteenth}" type="number" placeholder="/16" min="0" max="15" style="flex:1;min-width:0">
    </div>
  </div>`;
}
// Which employees usually run a given loom, set up once in Settings > Loom Assignments and
// used to auto-fill the Log Production form when that loom is picked — a convenience default,
// never a constraint, so the auto-filled dropdowns stay fully editable per entry.
function loomAssignmentFor(loomName){
  return DATA.loomAssignments.find(a=>a.loom===loomName) || null;
}
function setLoomAssignment(loomName, e1, e2){
  const idx = DATA.loomAssignments.findIndex(a=>a.loom===loomName);
  const rec = {loom:loomName, e1:e1||'', e2:e2||''};
  if(!rec.e1 && !rec.e2){
    if(idx>-1) DATA.loomAssignments.splice(idx,1);
    return;
  }
  if(idx>-1) DATA.loomAssignments[idx] = {...DATA.loomAssignments[idx], ...rec};
  else DATA.loomAssignments.push(rec);
}
// Employee picker for entry forms: active employees listed plainly (so new entries never
// see anyone who's left), inactive ones tucked into their own labeled group below — still
// selectable (so editing an old entry that references someone inactive still works and
// shows their name correctly) but visually out of the way.
function employeeSelectField(label, id, extra=''){
  const active = DATA.employees.filter(e=>e.active !== false);
  const inactive = DATA.employees.filter(e=>e.active === false);
  const inactiveHtml = inactive.length ? `<optgroup label="Inactive">${opts(inactive)}</optgroup>` : '';
  return `<div class="field"><label>${label}</label><select id="${id}" ${extra}><option value="">—</option>${opts(active)}${inactiveHtml}</select></div>`;
}
// Same pattern as employeeSelectField, for the Personal Loans (Given) page — picking from a
// managed Settings > Family Members list (instead of typing a free-text name) keeps balances
// accurate: a typo or a slightly different spelling used to be able to create a second
// "person" with their own separate running balance.
function familyMemberSelectField(label, id, extra=''){
  const active = DATA.familyMembers.filter(m=>m.active !== false);
  const inactive = DATA.familyMembers.filter(m=>m.active === false);
  const inactiveHtml = inactive.length ? `<optgroup label="Inactive">${opts(inactive)}</optgroup>` : '';
  return `<div class="field"><label>${label}</label><select id="${id}" ${extra}><option value="">—</option>${opts(active)}${inactiveHtml}</select></div>`;
}
// Clients can be deactivated (Settings → Clients) just like employees: active ones are listed
// plainly, inactive ones sit in their own "Inactive" group — still selectable, so old entries
// and filters/statements for a past client keep working — but out of the way of new entries.
function isClientInactive(name){
  const c = DATA.clients.find(x=>x.name===name);
  return !!c && c.active === false;
}
function groupedClientOpts(){
  const active = DATA.clients.filter(c=>c.active !== false);
  const inactive = DATA.clients.filter(c=>c.active === false);
  return opts(active) + (inactive.length ? `<optgroup label="Inactive">${opts(inactive)}</optgroup>` : '');
}
function clientSelectField(label, id, extra=''){
  return `<div class="field"><label>${label}</label><select id="${id}" ${extra}><option value="">—</option>${groupedClientOpts()}</select></div>`;
}
// Warp purchases don't have a plain display name, so this builds its own option labels
// (date, type, weight, amount) instead of using opts(). Value is the purchase's id, so a
// Warp Beam can link back to the exact purchase batch its yarn came from.
function warpPurchaseSelectField(label, id, extra=''){
  // Only the last 2 months of purchases are offered, to keep the list short and current —
  // except a purchase already linked to some existing Warp Beam stays listed too, so editing
  // an older beam record doesn't strand it with a purchase no longer in the dropdown.
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth()-2);
  const linkedIds = new Set(DATA.warpBeams.map(b=>b.purchaseId).filter(Boolean));
  const purchases = DATA.warp.slice()
    .filter(p=> new Date(p.date) >= cutoff || linkedIds.has(p.id))
    .sort((a,b)=> dtOf(b)-dtOf(a));
  const options = purchases.map(p=>{
    const weightBit = p.lbs ? ` — ${fmtNum(p.lbs)} lbs` : '';
    return `<option value="${p.id}">${fmtDate(p.date)} — ${escHtml(p.type||'Type —')}${weightBit} — ${fmtRs(p.amount)}</option>`;
  }).join('');
  return `<div class="field"><label>${label}</label><select id="${id}" ${extra}><option value="">— Select a purchase —</option>${options}</select></div>`;
}

/* ---------------- Panel renderers per sheet ---------------- */
function productionPanel(){
  const qualityVal = FILTER.production || '';
  const fromVal = FILTER.productionFrom || '';
  const toVal = FILTER.productionTo || '';
  let filteredProduction = qualityVal ? DATA.production.filter(r=>r.quality===qualityVal) : DATA.production;
  if(fromVal) filteredProduction = filteredProduction.filter(r=>r.date >= fromVal);
  if(toVal) filteredProduction = filteredProduction.filter(r=>r.date <= toVal);
  const filterQty = filteredProduction.reduce((s,r)=>s+(Number(r.qty)||0),0);
  return `<div class="card"><h2>Log Production</h2>
    <div class="grid cols-3">
      ${field('Date','p_date','date',`value="${todayStr()}" autofocus`)}
      ${selectField('Quality','p_quality',DATA.qualities)}
      ${selectField('Loom','p_loom',DATA.looms)}
    </div>
    <div class="grid cols-2" style="margin-top:12px">
      ${meterFracField('Quantity Produced (mtr)','p_qty','p_qty_16')}
    </div>
    <div id="p_beamToggleWrap"></div>
    <input type="hidden" id="p_beam" value="">
    <div class="group-label">Employees & Their Meters</div>
    <div class="grid cols-2">
      ${employeeSelectField('Employee 1','p_e1')}
      ${field('Employee 1 Meters','p_e1m','number')}
      ${employeeSelectField('Employee 2 (optional)','p_e2')}
      ${field('Employee 2 Meters','p_e2m','number')}
    </div>
    <div id="p_e3wrap" class="grid cols-2" style="display:none;margin-top:12px">
      ${employeeSelectField('Employee 3','p_e3')}
      ${field('Employee 3 Meters','p_e3m','number')}
    </div>
    <button type="button" class="ghost" id="p_toggleE3" style="margin-top:10px">+ Add a third employee</button>
    <div class="calc-amount" id="p_remainingPreview">Remaining to assign: —</div>
    <div class="form-actions">
      <button class="primary" id="addProductionNext">Add &amp; next loom →</button>
      <button class="ghost" id="addProduction">Add Entry</button>
      <button class="ghost" id="cancelProduction" style="display:none">Cancel Edit</button>
    </div></div>
    <div class="card"><div class="card-head"><h2>Bulk Import</h2><button type="button" class="info-btn" data-info-toggle data-info-target="info-bulkimport" title="Info">i</button></div>
      ${formToggleBtn('bulkImport','Form')}
      <div ${formBodyOpen('bulkImport')}>
      <p class="note info-note" id="info-bulkimport" hidden>Paste one line per loom from your register (format shown below the date and quality) and they're all added at once, instead of typing each entry separately. If any line has a problem, nothing is imported and the problems are listed so you can fix the text and retry.</p>
      <div class="grid cols-2">
        ${field('Date (applies to all rows)','pb_date','date',`value="${todayStr()}"`)}
        ${selectField('Quality (applies to all rows)','pb_quality',DATA.qualities)}
      </div>
      <div class="field" style="margin-top:12px">
        <label>Rows — one per line: Loom, Qty, Employee1, Meters1[, Employee2, Meters2[, Employee3, Meters3]]</label>
        <textarea id="pb_rows" rows="8" placeholder="8, 202, Riaz, 90, Gafar, 112
7, 156, Riaz, 90, Gafar, 66
6, 167, Riaz, 90, Gafar, 77"></textarea>
      </div>
      <button class="primary" id="importProduction" style="margin-top:12px">Import Rows</button>
      <div class="note" id="pb_result" style="margin-top:8px"></div>
      </div>
    </div>
    <div class="card"><h2>Production Log</h2>
      <div class="field"><label>Filter by Quality</label><select id="pf_quality"><option value="">All Qualities</option>${opts(DATA.qualities)}</select></div>
      <div class="chip-row" id="pf_chips" style="margin-top:12px">
        <button type="button" class="chip" data-period="">All Time</button>
        <button type="button" class="chip" data-period="this-month">This Month</button>
        <button type="button" class="chip" data-period="last-month">Last Month</button>
        <button type="button" class="chip" data-period="this-year">This Year</button>
        <button type="button" class="chip" data-period="custom">Custom…</button>
      </div>
      <div id="pf_custom" hidden style="margin-top:12px">
        <div class="grid cols-2">
          <div class="field"><label>From</label><input type="date" id="pf_from" value="${fromVal}"></div>
          <div class="field"><label>To</label><input type="date" id="pf_to" value="${toVal}"></div>
        </div>
      </div>
      ${(qualityVal || fromVal || toVal) ? `<p class="note" style="margin-top:10px">Showing ${filteredProduction.length} entr${filteredProduction.length===1?'y':'ies'}${qualityVal?` for <b>${qualityVal}</b>`:''}${fromVal||toVal?` from ${fromVal?fmtDate(fromVal):'the start'} to ${toVal?fmtDate(toVal):'now'}`:''} — total ${fmtQtyMtr(filterQty)} mtr.</p>` : ''}
      ${logTable('production',
      ['Date','Loom','Quality','Qty','Beam','Emp 1','Emp 2','Emp 3','Diff',''],
      filteredProduction.slice().reverse(),
      r=>{
        const diff = (r.qty||0) - ((r.e1m||0)+(r.e2m||0)+(r.e3m||0));
        const beamRec = r.beam ? DATA.warpBeams.find(b=>b.id===r.beam) : null;
        return [fmtDate(r.date), `<span class="loom-no">${escHtml(r.loom)}</span>`, escHtml(r.quality), fmtQtyMtr(r.qty), beamRec?fmtDate(beamRec.date):'—', `<span class="name">${escHtml(r.e1||'')}</span> (${fmtQtyMtr(r.e1m)})`, r.e2?`<span class="name">${escHtml(r.e2)}</span> (${fmtQtyMtr(r.e2m)})`:'—', r.e3?`<span class="name">${escHtml(r.e3)}</span> (${fmtQtyMtr(r.e3m)})`:'—', fmtQtyMtr(diff), actionBtns('production',r.id)];
      }
    )}</div>`;
}
// Small status badge for a Sale row's L (AIL) tracking — shown in the Sales Log so a lot's
// shortage history is visible at a glance without opening its receipt.
function lBadge(r){
  if(r.lStatus==='awaiting') return `<span class="note" style="color:var(--rust);margin:0">⏳ Awaiting</span>`;
  if(r.lStatus==='ok') return `<span class="note" style="margin:0">L (AIL) OK</span>`;
  if(r.lStatus==='applied') return `<span class="note" style="color:var(--rust);margin:0">${r.lCount} L (AIL) — ${fmtQtyPlain(r.lShortageQty)} mtr / ${fmtRs(r.lDeduction)} deducted</span>`;
  if(r.lStatus==='returned') return `<span class="note" style="color:var(--red);margin:0"><b>Returned</b>${r.lCount?` (${r.lCount} L)`:''}</span>`;
  if(r.lAdjustedFromId){
    const orig = DATA.sale.find(s=>s.id===r.lAdjustedFromId);
    return `<span class="note" style="margin:0">L (AIL) adj.${orig?` — was ${fmtQtyMtr(orig.qty)}, now ${fmtQtyMtr(r.qty)} mtr`:''}</span>`;
  }
  return '—';
}
function salePanel(){
  const clientVal = FILTER.saleClient || '';
  const qualityVal = FILTER.saleQuality || '';
  let filteredSale = DATA.sale;
  if(clientVal) filteredSale = filteredSale.filter(r=>r.client===clientVal);
  if(qualityVal) filteredSale = filteredSale.filter(r=>r.quality===qualityVal);
  const filteredSaleActive = filteredSale.filter(r=> r.lStatus!=='applied' && r.lStatus!=='returned');
  const filterQty = filteredSaleActive.reduce((s,r)=>s+(Number(r.qty)||0),0);
  const filterAmt = filteredSaleActive.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const saleTotals = sumAllAndMonth(activeSaleRows(), 'amount');
  const qtyTotals = sumAllAndMonth(activeSaleRows(), 'qty');
  const salesAmtAll = saleTotals.all;
  // Client-wise breakdown: for each client, Qty + Amount sold, Received, and Receivable
  // outstanding — everything you'd otherwise need Overview for, but scoped to Sale/clients.
  const saleClientNames = orderedGroupNames(DATA.clients.map(c=>c.name), [DATA.sale,'client']);
  const qtyByClient = sumWhereBy(activeSaleRows(), 'client', 'qty', null, null);
  const amtByClient = sumWhereBy(activeSaleRows(), 'client', 'amount', null, null);
  const receivedByClient = sumRecoveryByClient(DATA.recovery, recoveryReceivableAmount, null, null);
  const bouncedByClient = sumRecoveryByClient(DATA.recovery, recoveryBouncedAmount, null, null);
  const clientRows = saleClientNames
    .map(name=>{
      const qty = qtyByClient[name]||0, amt = amtByClient[name]||0;
      const received = receivedByClient[name]||0, bounced = bouncedByClient[name]||0;
      const receivable = amt - received - bounced;
      return {name, qty, amt, receivable, bounced};
    })
    .filter(r=> r.qty || r.amt);
  // Inactive clients drop off once nothing is owed (and nothing bounced) — same rule as
  // inactive employees on the Wages tables. Totals below still cover everyone.
  const hiddenInactiveClients = clientRows.filter(r=> isClientInactive(r.name) && Math.abs(r.receivable) <= 0.004 && Math.abs(r.bounced) <= 0.004).length;
  const visibleClientRows = clientRows.filter(r=> !(isClientInactive(r.name) && Math.abs(r.receivable) <= 0.004 && Math.abs(r.bounced) <= 0.004));
  const clientTable = clientRows.length ? `<div class="log-scroll"><table><thead><tr><th>Client</th><th>Quantity (mtr)</th><th>Amount</th><th>Receivable</th></tr></thead>
    <tbody>${visibleClientRows.map(r=>`<tr><td><span class="name">${escHtml(r.name)}</span></td><td>${fmtQtyMtr(r.qty)}</td><td>${fmtRs(r.amt)}</td><td>${r.receivable>0.004?`<b style="color:var(--red)">${fmtRs(r.receivable)}</b>`:fmtRs(0)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td><b>Total</b></td><td><b>${fmtQtyMtr(qtyTotals.all)}</b></td><td><b>${fmtRs(salesAmtAll)}</b></td><td><b>${fmtRs(clientRows.reduce((s,r)=>s+Math.max(0,r.receivable),0))}</b></td></tr></tfoot>
    </table></div>${hiddenInactiveClients?`<p class="note">${hiddenInactiveClients} inactive client${hiddenInactiveClients===1?'':'s'} with nothing owed hidden — totals still include them.</p>`:''}` : `<div class="empty">No sales yet</div>`;
  const summary = `${sumCardOpen('breakdown','Client-wise Breakdown')}
    <div class="grid cols-2" style="margin-bottom:14px">
      <div class="stat compact"><div class="label">Total Sale (All Time)</div><div class="value">${fmtRs(salesAmtAll)}</div></div>
      <div class="stat compact"><div class="label">This Month</div><div class="value">${fmtRs(saleTotals.month)}</div></div>
    </div>
    ${clientTable}
  ${sumCardClose()}`;
  return `${summary}${pendingLCardHtml()}<div class="card"><h2>Log Sale</h2>
    <div class="grid cols-3">
      ${field('Date','s_date','date',`value="${todayStr()}" autofocus`)}
      ${clientSelectField('Client','s_client')}
      ${selectField('Quality','s_quality',DATA.qualities)}
    </div>
    <div class="grid cols-3" style="margin-top:12px">
      ${field('Quantity (mtr)','s_qty','number')}
      ${field('Rate per mtr (Rs)','s_rate','number')}
      ${field('Invoice No (optional)','s_inv','text')}
    </div>
    <div class="grid cols-2" style="margin-top:12px">
      ${selectField('Dyeing (optional)','s_dyeing',DATA.dyeingUnits)}
      <div></div>
    </div>
    <div class="note" id="s_qtyHint" hidden style="margin:6px 0 0"></div>
    <div class="grid cols-1" style="margin-top:12px">
      ${textareaField('Description (optional)','s_desc')}
    </div>
    <div class="calc-amount" id="s_amtPreview">Amount: —</div>
    <div class="form-actions">
      <button class="primary" id="addSale">Add Entry</button>
      <button class="ghost" id="cancelSale" style="display:none">Cancel Edit</button>
    </div></div>
    <div class="card"><h2>Sales Log</h2>
      <div class="grid cols-2">
        <div class="field"><label>Filter by Client</label><select id="sf_client"><option value="">All Clients</option>${groupedClientOpts()}</select></div>
        <div class="field"><label>Filter by Quality</label><select id="sf_quality"><option value="">All Qualities</option>${opts(DATA.qualities)}</select></div>
      </div>
      ${(clientVal||qualityVal) ? `<p class="note">Showing ${filteredSale.length} entr${filteredSale.length===1?'y':'ies'}${clientVal?` for <b>${clientVal}</b>`:''}${qualityVal?` — <b>${qualityVal}</b>`:''} — ${fmtQtyMtr(filterQty)} mtr, total ${fmtRs(filterAmt)}.</p>` : ''}
      ${logTable('sale',
      ['Date','Invoice','Client','Quality','Qty','Rate','Amount','Dyeing','L (AIL)','Description',''],
      filteredSale.slice().reverse(),
      r=>{
        const cells = [fmtDate(r.date), escHtml(r.invoice||'—'), `<span class="name">${escHtml(r.client)}</span>`, escHtml(r.quality), fmtQtyMtr(r.qty), (r.rate ? fmtRs2(r.rate) : (r.qty ? fmtRs2((Number(r.amount)||0)/r.qty) : '—')), fmtRs(r.amount), escHtml(r.dyeing||'—'), lBadge(r), escHtml(r.desc||'—'), `<span class="row-actions">${receiptBtn(r.id)}${canShareFiles() ? shareReceiptBtn(r.id) : ''}${actionBtns('sale',r.id)}</span>`];
        // Superseded (L applied) or returned entries no longer count anywhere money is
        // totaled (see activeSaleRows in calc.js) — greyed out here so that's visible at a
        // glance in the log itself, not just implied by the badge text.
        if(r.lStatus==='applied' || r.lStatus==='returned') cells.rowStyle = 'opacity:0.55';
        return cells;
      }
    )}</div>`;
}
function daysSince(dateStr){ return Math.max(0, Math.round((new Date(todayStr()+'T00:00:00Z') - new Date(dateStr+'T00:00:00Z')) / 86400000)); }
function isChequeOverdue(c){ return c.chequeDate && c.chequeDate < todayStr(); }
function pendingChequesCardHtml(){
  const pendingCheques = computePendingCheques();
  if(!pendingCheques.length) return '';
  const pendingTotal = pendingCheques.reduce((s,c)=>s+(Number(c.amount)||0),0);
  const headers = ['Date','Client','Cheque Owner','Cheque No','Bank','Cheque Date','Amount','Days Pending',''];
  const mapFn = c=>{
    const cells = [
      fmtDate(c.date), `<span class="name">${escHtml(c.client)}</span>`, escHtml(c.owner||'—'), escHtml(c.chequeNo||'—'), escHtml(c.bank||'—'),
      c.chequeDate?fmtDate(c.chequeDate)+(isChequeOverdue(c)?' <span style="color:var(--rust)"><b>(overdue)</b></span>':''):'—',
      fmtRs(c.amount), daysSince(c.date),
      `<div class="chq-actions"><button class="ghost" data-cheque="${c.recoveryId}:${c.id}:Cleared">Mark Cleared</button><button class="ghost" data-cheque="${c.recoveryId}:${c.id}:Bounced">Mark Bounced</button></div>`
    ];
    if(isChequeOverdue(c)) cells.rowStyle = 'background:var(--warn-bg-1)';
    return cells;
  };
  return `
    <div class="card"><div class="card-head"><h2 style="color:var(--rust)">Pending Cheques — ${fmtRs(pendingTotal)} not yet in Cash Position</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Sorted by each cheque's own clearing date (not when it was logged) — rows shaded red are past that date and still Pending, worth following up on. Won't count toward Cash Position until marked Cleared. Other cheques from the same payment aren't affected.</p>
      ${logTable('pendingCheques', headers, pendingCheques, mapFn)}
    </div>`;
}
function bouncedChequesCardHtml(){
  const bouncedCheques = computeBouncedCheques();
  if(!bouncedCheques.length) return '';
  const bouncedTotal = bouncedCheques.reduce((s,c)=>s+(Number(c.amount)||0),0);
  const headers = ['Date','Client','Cheque Owner','Cheque No','Bank','Cheque Date','Amount',''];
  const mapFn = c=>{
    const made = chequeReplacedAmount(c.recoveryId, c.id);
    const progress = made > 0.004 ? `<div class="note" style="margin:3px 0 0">${fmtRs(made)} replaced so far — ${fmtRs(Math.max(0,(Number(c.amount)||0)-made))} still owed</div>` : '';
    return [
    fmtDate(c.date), `<span class="name">${escHtml(c.client)}</span>`, `<b>${escHtml(c.owner||'—')}</b>`, escHtml(c.chequeNo||'—'), escHtml(c.bank||'—'),
    c.chequeDate?fmtDate(c.chequeDate):'—', fmtRs(c.amount) + progress,
    `<div class="chq-actions"><button class="ghost" data-replace-cheque="${c.recoveryId}:${c.id}">Log replacement</button><button class="ghost" data-cheque="${c.recoveryId}:${c.id}:Replaced">Mark Replaced</button><button class="ghost" data-cheque="${c.recoveryId}:${c.id}:Pending">Reopen as Pending</button><button class="ghost" data-cheque="${c.recoveryId}:${c.id}:Cleared">Mark Cleared</button></div>`
    ];
  };
  return `
    <div class="card"><div class="card-head"><h2 style="color:var(--rust)">Bounced Cheques — ${fmtRs(bouncedTotal)}</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Cheque Owner tells you exactly whose cheque failed, even when your client passed on a third party's cheque — useful when they ask which one it was. Once the client has made good on it — cash, transfer, a new cheque, or some mix — tap "Log replacement": it opens the payment form with this cheque ticked, so the new payment is linked to it. When the payments linked to a cheque add up to its amount, it drops off this list as Replaced by itself (and comes back here if that payment is later removed). "Mark Replaced" does the same without linking a payment — it then shows up under "Replaced cheques not linked to a payment" until you link one. Either way the cheque stays out of your Receivable; this only changes which cheques still need chasing.</p>
      ${logTable('bouncedCheques', headers, bouncedCheques, mapFn)}
    </div>`;
}
// Cheques marked Replaced whose replacement payment was never linked (older entries, or "Mark
// Replaced" used on its own). Nothing is wrong with the money — this list only exists so each such
// cheque can be tied to the payment that made good on it. The person picks; nothing links itself.
function unlinkedReplacedCardHtml(){
  const list = uncoveredReplacedCheques();
  if(!list.length) return '';
  const total = list.reduce((s,c)=>s+c.missing,0);
  const headers = ['Client','Cheque','Not linked','Link it to the payment that replaced it'];
  const mapFn = c=>{
    const sugg = suggestReplacementPayments(c.recoveryId, c.chequeId);
    const buttons = sugg.length
      ? sugg.map(s=>`<button class="ghost" data-link-replacement="${s.paymentId}|${c.recoveryId}|${c.chequeId}|${c.missing}">${fmtDate(s.date)} payment · ${fmtRs(s.total)}</button>`).join('')
      : `<span class="note" style="margin:0">No later payment from this client is big enough.</span><button class="ghost" data-cheque="${c.recoveryId}:${c.chequeId}:Bounced">Reopen as Bounced</button>`;
    const name = [c.chequeNo ? 'No. ' + escHtml(c.chequeNo) : '', c.owner ? escHtml(c.owner) : '', fmtDate(c.date)].filter(Boolean).join(' · ');
    return [`<span class="name">${escHtml(c.client)}</span>`, name, fmtRs(c.missing) + (c.linked > 0.004 ? `<div class="note" style="margin:3px 0 0">of ${fmtRs(c.amount)}</div>` : ''), `<div class="chq-actions">${buttons}</div>`];
  };
  return `
    <div class="card"><div class="card-head"><h2 style="color:var(--rust)">Replaced cheques not linked to a payment — ${list.length}</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>These cheques are marked Replaced, but the payment that made good on each one was never tied to it. Your balances are not affected. Tap the payment that replaced the cheque and the two are linked: the payment then shows "Replaces cheque…" in the Recovery Log and on statements, and the cheque shows which payment replaced it. Only payments from the same client, dated on or after the cheque, and big enough to cover it are offered. If it wasn't really replaced, "Reopen as Bounced" puts it back on the Bounced list.</p>
      ${logTable('unlinkedReplaced', headers, list, mapFn)}
    </div>`;
}
// Sales sent to a dyeing unit that haven't had their "L (AIL)" shortage call logged yet
// (see lStatus:'awaiting' set in wiring.js's addSale). Each row lets that call be settled on
// the spot: "No Shortage" clears it with nothing else changing, a typed L count previews the
// shortage/deduction via the confirmed market formula (lShortageMeters/lDeductionAmount in
// calc.js) before it's applied, and "Return Lot" records the lot as rejected outright. The
// double-L (L > 5) formula isn't settled yet, so anything past the 5 L tolerance can only be
// recorded as a return here until that formula is confirmed.
function pendingLCardHtml(){
  const awaiting = DATA.sale.filter(r=>r.lStatus==='awaiting');
  if(!awaiting.length) return '';
  const headers = ['Date','Client','Quality','Qty','Rate','Dyeing','L (AIL)',''];
  const mapFn = r=>{
    const rate = r.rate ? Number(r.rate) : (r.qty ? (Number(r.amount)||0)/r.qty : 0);
    return [
      fmtDate(r.date), `<span class="name">${escHtml(r.client)}</span>`, escHtml(r.quality), fmtQtyMtr(r.qty), fmtRs2(rate), escHtml(r.dyeing||'—'),
      `<input type="number" min="0" step="1" data-lcount-input="${r.id}" style="width:64px" placeholder="0">`,
      `<div class="chq-actions">
        <button class="ghost" data-l-ok="${r.id}">L (AIL) OK</button>
        <button class="ghost" data-l-confirm="${r.id}">Confirm L</button>
        <button class="ghost" data-l-return="${r.id}">Return Lot</button>
      </div>
      <p class="note" data-l-preview="${r.id}" style="margin:4px 0 0"></p>`
    ];
  };
  return `
    <div class="card"><div class="card-head"><h2 style="color:var(--rust)">Awaiting L (AIL) — ${awaiting.length}</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
      <p class="note info-note" hidden>Once the dyeing unit calls with the shortage check, type the L (AIL) count and tap Confirm L to apply the shortage to this lot — it reduces the quantity/amount owed and both the original and adjusted entries stay in the Sales Log for reference. "L (AIL) OK" clears the wait with nothing deducted. "Return Lot" records the lot as rejected outright. L above 5 isn't calculated here yet — use Return Lot for those until that formula is confirmed.</p>
      ${logTable('pendingL', headers, awaiting, mapFn)}
    </div>`;
}
function recoveryPanel(){
  const filterVal = FILTER.recovery || '';
  const filteredRecovery = filterVal ? DATA.recovery.filter(r=>r.client===filterVal) : DATA.recovery;
  const filterTotal = filteredRecovery.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const receivedTotals = sumAllAndMonthBy(DATA.recovery, recoveryReceivableAmount);
  const pendingAll = computePendingCheques().reduce((s,c)=>s+(Number(c.amount)||0),0);
  // Client-wise breakdown: how much each client owed (Sales), how much they've paid
  // (Received), and what's still outstanding (Receivable) — scoped to this page.
  const recClientNames = orderedGroupNames(DATA.clients.map(c=>c.name), [DATA.sale,'client'], [DATA.recovery,'client']);
  const salesByClient = sumWhereBy(activeSaleRows(), 'client', 'amount', null, null);
  const receivedByClient = sumRecoveryByClient(DATA.recovery, recoveryReceivableAmount, null, null);
  const bouncedByClient = sumRecoveryByClient(DATA.recovery, recoveryBouncedAmount, null, null);
  const clientRows = recClientNames
    .map(name=>{
      const sales = salesByClient[name]||0, received = receivedByClient[name]||0, bounced = bouncedByClient[name]||0;
      const receivable = sales - received - bounced;
      return {name, sales, received, bounced, receivable};
    })
    .filter(r=> r.sales || r.received || r.bounced);
  // Inactive clients drop off once nothing is owed and nothing bounced (same rule as inactive
  // employees on Wages). `clientRows` stays the full list so the Total row still covers everyone.
  const isSettledInactive = r=> isClientInactive(r.name) && Math.abs(r.receivable) <= 0.004 && Math.abs(r.bounced) <= 0.004;
  const hiddenInactiveClients = clientRows.filter(isSettledInactive).length;
  const visibleClientRows = clientRows.filter(r=>!isSettledInactive(r));
  const anyBounced = clientRows.some(r=>r.bounced > 0.004);
  const clientTable = clientRows.length ? `<div class="log-scroll"><table><thead><tr><th>Client</th><th>Sales</th><th>Received</th>${anyBounced?'<th>Bounced</th>':''}<th>Receivable</th></tr></thead>
    <tbody>${visibleClientRows.map(r=>`<tr><td><span class="name">${escHtml(r.name)}</span></td><td>${fmtRs(r.sales)}</td><td>${fmtRs(r.received)}</td>${anyBounced?`<td>${r.bounced>0.004?`<span style="color:var(--red)">${fmtRs(r.bounced)}</span>`:'—'}</td>`:''}<td>${r.receivable>0.004?`<b style="color:var(--red)">${fmtRs(r.receivable)}</b>`:fmtRs(0)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td><b>Total</b></td><td><b>${fmtRs(clientRows.reduce((s,r)=>s+r.sales,0))}</b></td><td><b>${fmtRs(clientRows.reduce((s,r)=>s+r.received,0))}</b></td>${anyBounced?`<td><b>${fmtRs(clientRows.reduce((s,r)=>s+r.bounced,0))}</b></td>`:''}<td><b>${fmtRs(clientRows.reduce((s,r)=>s+Math.max(0,r.receivable),0))}</b></td></tr></tfoot>
    </table></div>${hiddenInactiveClients?`<p class="note">${hiddenInactiveClients} inactive client${hiddenInactiveClients===1?'':'s'} with nothing owed hidden — totals still include them.</p>`:''}` : `<div class="empty">No recovery entries yet</div>`;
  const summary = `${sumCardOpen('breakdown','Client-wise Breakdown')}
    <div class="grid cols-3" style="margin-bottom:14px">
      <div class="stat compact"><div class="label">Received (All Time)</div><div class="value">${fmtRs(receivedTotals.all)}</div></div>
      <div class="stat compact"><div class="label">This Month</div><div class="value">${fmtRs(receivedTotals.month)}</div></div>
      <div class="stat compact"><div class="label">Pending Cheques</div><div class="value">${fmtRs(pendingAll)}</div></div>
    </div>
    ${clientTable}
  ${sumCardClose()}`;
  return `${summary}${pendingChequesCardHtml()}${bouncedChequesCardHtml()}${unlinkedReplacedCardHtml()}<div class="card"><div class="card-head"><h2>Log Payment Received</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>A single payment can be part cash, part bank transfer, and part cheques, all at once — fill in whichever apply. Leave any that don't apply at 0 / empty.</p>
    <div class="grid cols-3">
      ${field('Date','r_date','date',`value="${todayStr()}" autofocus`)}
      ${field('Time','r_time','time',`value="${nowStr()}"`)}
      ${clientSelectField('Client','r_client')}
    </div>
    <div class="grid cols-2" style="margin-top:12px">
      ${field('Bank Transfer Amount (Rs)','r_bank','number','placeholder="0"')}
      <div></div>
    </div>
    <div id="r_cashWrap" class="grid cols-2" style="display:none;margin-top:12px">
      ${field('Cash Amount (Rs)','r_cash','number','placeholder="0"')}
      <div></div>
    </div>
    <button type="button" class="ghost" id="r_toggleCash" style="margin-top:10px">+ Add Cash</button>
    <div style="margin-top:12px">
      <div class="group-label">Cheques (optional — add as many as came with this payment)</div>
      <div id="r_chequeRows"></div>
      <button type="button" class="ghost" id="r_addChequeRow" style="margin-top:8px">+ Add Cheque</button>
    </div>
    <div id="r_replaceWrap" style="margin-top:12px" hidden>
      <div class="group-label">Does part of this payment replace a bounced cheque? (optional)</div>
      <p class="note" style="margin-top:0">Tick the cheque this money makes good on and say how much of the payment it is. The two are then linked — you'll see it in the Recovery Log and on statements — and the cheque drops off the Bounced list once it is fully covered. Leave everything unticked for an ordinary payment.</p>
      <div id="r_replaceRows"></div>
    </div>
    <div class="calc-amount" id="r_totalPreview">Total: Rs 0</div>
    <div class="grid cols-1" style="margin-top:12px">
      ${textareaField('Description (optional)','r_desc')}
    </div>
    <p class="note">Cash and Bank Transfer count toward Cash Position immediately. Each cheque only counts once marked Cleared — other cheques in the same payment keep their own status independently.</p>
    <p class="note">Time is used to order same-day entries against Cash Checkpoints — it doesn't need to be exact.</p>
    <div class="form-actions">
      <button class="primary" id="addRecovery">Add Entry</button>
      <button class="ghost" id="cancelRecovery" style="display:none">Cancel Edit</button>
    </div></div>
    <div class="card"><h2>Recovery Log</h2>
      <div class="grid cols-2">
        <div class="field"><label>Filter by Client</label><select id="rf_client"><option value="">All Clients</option>${groupedClientOpts()}</select></div>
      </div>
      ${filterVal ? `<p class="note">Showing ${filteredRecovery.length} entr${filteredRecovery.length===1?'y':'ies'} for <b>${filterVal}</b> — total ${fmtRs(filterTotal)}.</p>` : ''}
      ${logTable('recovery',
      ['Date','Time','Client','Amount','Method','Description',''],
      filteredRecovery.slice().reverse(),
      r=>[fmtDate(r.date), r.time||'—', `<span class="name">${escHtml(r.client)}</span>`, fmtRs(r.amount), recoveryMethodLabel(r), escHtml(r.desc||'') + replacementNoteTexts(r).map(t=>`<div class="note" style="margin:3px 0 0">↳ ${escHtml(t)}</div>`).join(''), `<span class="row-actions">${recoveryReceiptBtn(r.id)}${canShareFiles() ? shareRecoveryReceiptBtn(r.id) : ''}${actionBtns('recovery',r.id)}</span>`]
    )}</div>`;
}
function expensePanel(){
  const cats = ['Electricity','Salary/Wages','Loom Repair & Maintenance','Yarn/Spare Parts','Rent','Transport','Loan/Interest','Other'];
  const expTotals = sumAllAndMonth(DATA.expense, 'amount');
  const wagesPaidAll = DATA.wagePayments.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const byCat = sumByGroup(DATA.expense, 'category', 'amount');
  const catTable = byCat.length ? `<div class="group-label">By Category (All Time)</div>
    <table><thead><tr><th>Category</th><th>Amount</th></tr></thead>
    <tbody>${byCat.map(([cat,amt])=>`<tr><td>${escHtml(cat)}</td><td>${fmtRs(amt)}</td></tr>`).join('')}</tbody></table>` : '';
  const summary = summaryCard('Summary', [
    {label:'Total Expense (All Time)', value: fmtRs(expTotals.all)},
    {label:'This Month', value: fmtRs(expTotals.month)},
    {label:'Wages Paid (All Time)', value: fmtRs(wagesPaidAll)},
    {label:'Entries Logged', value: fmtNum(DATA.expense.length)},
  ], catTable);
  return `${summary}<div class="card"><h2>Log Business Expense</h2>
    <div class="grid cols-3">
      ${field('Date','ex_date','date',`value="${todayStr()}" autofocus`)}
      ${field('Time','ex_time','time',`value="${nowStr()}"`)}
      <div class="field"><label>Category</label><select id="ex_cat"><option value="">—</option>${cats.map(c=>`<option>${c}</option>`).join('')}</select></div>
    </div>
    <div class="grid cols-2" style="margin-top:12px">
      ${field('Amount (Rs)','ex_amt','number')}
      ${field('Paid To','ex_to','text')}
    </div>
    <div class="grid cols-1" style="margin-top:12px">
      ${textareaField('Description','ex_desc')}
    </div>
    <p class="note">Time is used to order same-day entries against Cash Checkpoints — it doesn't need to be exact.</p>
    <div class="form-actions">
      <button class="primary" id="addExpense">Add Entry</button>
      <button class="ghost" id="cancelExpense" style="display:none">Cancel Edit</button>
    </div></div>
    <div class="card"><h2>Expense Log</h2>${logTable('expense',
      ['Date','Time','Category','Description','Amount',''],
      DATA.expense.slice().reverse(),
      r=>[fmtDate(r.date), r.time||'—', escHtml(r.category||'—'), escHtml(r.desc||'—'), fmtRs(r.amount), actionBtns('expense',r.id)]
    )}</div>`;
}
function familyPanel(){
  const cats = ['Groceries','Household Items','Utilities (Home)','Medical','Education','Clothing','Rent (Personal)','Transport','Eid/Functions','Other'];
  const famTotals = sumAllAndMonth(DATA.family, 'amount');
  const byCat = sumByGroup(DATA.family, 'category', 'amount');
  const catTable = byCat.length ? `<div class="group-label">By Category (All Time)</div>
    <table><thead><tr><th>Category</th><th>Amount</th></tr></thead>
    <tbody>${byCat.map(([cat,amt])=>`<tr><td>${escHtml(cat)}</td><td>${fmtRs(amt)}</td></tr>`).join('')}</tbody></table>` : '';
  const summary = summaryCard('Summary', [
    {label:'Total Family Expense (All Time)', value: fmtRs(famTotals.all)},
    {label:'This Month', value: fmtRs(famTotals.month)},
    {label:'Entries Logged', value: fmtNum(DATA.family.length)},
  ], catTable);
  return `${summary}<div class="card"><h2>Log Family Expense</h2>
    <div class="grid cols-3">
      ${field('Date','f_date','date',`value="${todayStr()}" autofocus`)}
      ${field('Time','f_time','time',`value="${nowStr()}"`)}
      <div class="field"><label>Category</label><select id="f_cat"><option value="">—</option>${cats.map(c=>`<option>${c}</option>`).join('')}</select></div>
    </div>
    <div class="grid cols-2" style="margin-top:12px">
      ${field('Amount (Rs)','f_amt','number')}
    </div>
    <div class="grid cols-1" style="margin-top:12px">
      ${textareaField('Description','f_desc')}
    </div>
    <p class="note">Time is used to order same-day entries against Cash Checkpoints — it doesn't need to be exact.</p>
    <div class="form-actions">
      <button class="primary" id="addFamily">Add Entry</button>
      <button class="ghost" id="cancelFamily" style="display:none">Cancel Edit</button>
    </div></div>
    <div class="card"><h2>Family Expense Log</h2>${logTable('family',
      ['Date','Time','Category','Description','Amount',''],
      DATA.family.slice().reverse(),
      r=>[fmtDate(r.date), r.time||'—', escHtml(r.category||'—'), escHtml(r.desc||'—'), fmtRs(r.amount), actionBtns('family',r.id)]
    )}</div>`;
}
// Personal Expense: your own spending, kept in its own ledger separate from Family Expense
// so the two totals never mix — same shape and same treatment (Cash Position / Profit-Loss)
// as Family Expense, see famExpCum/personalExpCum in calc.js.
function personalPanel(){
  const cats = ['Personal Care','Shopping','Entertainment','Travel','Gifts','Health','Subscriptions','Pocket Money','Other'];
  const totals = sumAllAndMonth(DATA.personal, 'amount');
  const byCat = sumByGroup(DATA.personal, 'category', 'amount');
  const catTable = byCat.length ? `<div class="group-label">By Category (All Time)</div>
    <table><thead><tr><th>Category</th><th>Amount</th></tr></thead>
    <tbody>${byCat.map(([cat,amt])=>`<tr><td>${escHtml(cat)}</td><td>${fmtRs(amt)}</td></tr>`).join('')}</tbody></table>` : '';
  const summary = summaryCard('Summary', [
    {label:'Total Personal Expense (All Time)', value: fmtRs(totals.all)},
    {label:'This Month', value: fmtRs(totals.month)},
    {label:'Entries Logged', value: fmtNum(DATA.personal.length)},
  ], catTable);
  return `${summary}<div class="card"><h2>Log Personal Expense</h2>
    <div class="grid cols-3">
      ${field('Date','pex_date','date',`value="${todayStr()}" autofocus`)}
      ${field('Time','pex_time','time',`value="${nowStr()}"`)}
      <div class="field"><label>Category</label><select id="pex_cat"><option value="">—</option>${cats.map(c=>`<option>${c}</option>`).join('')}</select></div>
    </div>
    <div class="grid cols-2" style="margin-top:12px">
      ${field('Amount (Rs)','pex_amt','number')}
    </div>
    <div class="grid cols-1" style="margin-top:12px">
      ${textareaField('Description','pex_desc')}
    </div>
    <p class="note">Time is used to order same-day entries against Cash Checkpoints — it doesn't need to be exact.</p>
    <div class="form-actions">
      <button class="primary" id="addPersonal">Add Entry</button>
      <button class="ghost" id="cancelPersonal" style="display:none">Cancel Edit</button>
    </div></div>
    <div class="card"><h2>Personal Expense Log</h2>${logTable('personal',
      ['Date','Time','Category','Description','Amount',''],
      DATA.personal.slice().reverse(),
      r=>[fmtDate(r.date), r.time||'—', escHtml(r.category||'—'), escHtml(r.desc||'—'), fmtRs(r.amount), actionBtns('personal',r.id)]
    )}</div>`;
}
function warpPanel(){
  const spend = sumAllAndMonth(DATA.warp, 'amount');
  const summary = summaryCard('Summary', [
    {label:'Total Spent (All Time)', value: fmtRs(spend.all)},
    {label:'This Month', value: fmtRs(spend.month)},
    {label:'Purchases Logged', value: fmtNum(DATA.warp.length)},
  ]);
  return `${summary}<div class="card"><h2>Log Warp (Tana) Purchase</h2>
    <div class="grid cols-3">
      ${field('Date','w_date','date',`value="${todayStr()}" autofocus`)}
      ${field('Time','w_time','time',`value="${nowStr()}"`)}
      ${selectField('Warp Count/Type','w_type',DATA.warpTypes)}
    </div>
    <div class="grid cols-2" style="margin-top:12px">
      ${field('Supplier','w_sup','text')}
    </div>
    <div class="group-label">Weight — by cartons (auto-converts to lbs)</div>
    <div class="grid cols-4">
      ${field('Cartons','w_cartons','number','placeholder="e.g. 50"')}
      ${field('Kg per Carton','w_kgPerCarton','number','placeholder="e.g. 36" step="0.01"')}
      ${field('Total Weight (lbs)','w_lbs','number','step="0.01"')}
      ${field('Rate per lb (Rs)','w_rate','number')}
    </div>
    <div class="note" id="w_kgPreview">Enter cartons &amp; kg/carton to auto-calculate weight — or type the lbs directly.</div>
    <div class="calc-amount" id="w_amtPreview">Amount: —</div>
    <p class="note">Time is used to order same-day entries against Cash Checkpoints — it doesn't need to be exact.</p>
    <div class="form-actions">
      <button class="primary" id="addWarp">Add Entry</button>
      <button class="ghost" id="cancelWarp" style="display:none">Cancel Edit</button>
    </div></div>
    <div class="card"><h2>Warp (Tana) Log</h2>${logTable('warp',
      ['Date','Time','Type','Supplier','Cartons','Weight (lbs)','Amount',''],
      DATA.warp.slice().reverse(),
      r=>[fmtDate(r.date), r.time||'—', escHtml(r.type||'—'), r.supplier?`<span class="name">${escHtml(r.supplier)}</span>`:'—', (r.cartons&&r.kgPerCarton)?`${fmtNum(r.cartons)} × ${fmtNum(r.kgPerCarton)}kg`:'—', fmtNum(r.lbs), fmtRs(r.amount), actionBtns('warp',r.id)]
    )}</div>`;
}
function weftPanel(){
  const spend = sumAllAndMonth(DATA.weft, 'amount');
  const bags = sumAllAndMonth(DATA.weft, 'bags');
  const summary = summaryCard('Summary', [
    {label:'Total Spent (All Time)', value: fmtRs(spend.all)},
    {label:'This Month', value: fmtRs(spend.month)},
    {label:'Number of Bags (All Time)', value: fmtNum(bags.all)},
    {label:'Purchases Logged', value: fmtNum(DATA.weft.length)},
  ]);
  return `${summary}<div class="card"><h2>Log Weft (Bana) Purchase</h2>
    <div class="grid cols-3">
      ${field('Date','wf_date','date',`value="${todayStr()}" autofocus`)}
      ${field('Time','wf_time','time',`value="${nowStr()}"`)}
      ${selectField('Yarn Count/Type','wf_type',DATA.weftTypes)}
    </div>
    <div class="grid cols-2" style="margin-top:12px">
      ${field('Supplier','wf_sup','text')}
    </div>
    <div class="group-label">Weight — by bags (auto-calculates total lbs)</div>
    <div class="grid cols-4">
      ${field('Number of Bags','wf_bags','number','placeholder="e.g. 20"')}
      ${field('Lbs per Bag','wf_lbsPerBag','number','value="100" step="0.01"')}
      <div class="field"><label>Total Weight (lbs)</label><div class="value-label" id="wf_lbsLabel">—</div><input type="hidden" id="wf_lbs" value=""></div>
      ${field('Rate per lb (Rs)','wf_rate','number')}
    </div>
    <div class="note" id="wf_bagsPreview">Enter bags &amp; lbs/bag to auto-calculate total weight.</div>
    <div class="calc-amount" id="wf_amtPreview">Amount: —</div>
    <p class="note">Time is used to order same-day entries against Cash Checkpoints — it doesn't need to be exact.</p>
    <div class="form-actions">
      <button class="primary" id="addWeft">Add Entry</button>
      <button class="ghost" id="cancelWeft" style="display:none">Cancel Edit</button>
    </div></div>
    <div class="card"><h2>Weft (Bana) Log</h2>${logTable('weft',
      ['Date','Time','Type','Supplier','Bags','Weight (lbs)','Amount',''],
      DATA.weft.slice().reverse(),
      r=>[fmtDate(r.date), r.time||'—', escHtml(r.type||'—'), r.supplier?`<span class="name">${escHtml(r.supplier)}</span>`:'—', (r.bags&&r.lbsPerBag)?`${fmtNum(r.bags)} × ${fmtNum(r.lbsPerBag)}lbs`:'—', fmtNum(r.lbs), fmtRs(r.amount), actionBtns('weft',r.id)]
    )}</div>`;
}
/* ---------------- Warp Beams (per-loom length tracking, FIFO by install date) ---------------- */
// Beams for a loom, newest-install-first.
function beamsForLoom(loomName){
  return DATA.warpBeams.filter(b=>b.loom===loomName).slice().sort((a,b)=> dtOf(b)-dtOf(a));
}
// Builds the "This entry is from: New beam / Previous beam" toggle on the Production form,
// scoped to the entry's own Date (p_date) rather than just "whichever beam was logged most
// recently overall" — a backdated entry shouldn't be asked to choose between two beams that
// were both installed after it. Logic, given this loom's beams (newest-install-first):
//   - No beam on this loom has a date on/before the entry date (entry predates every beam
//     logged, e.g. backfilling before beam-tracking started) → nothing to choose; p_beam
//     cleared silently, no toggle shown.
//   - The most recent beam on/before the entry date is unambiguous UNLESS the entry date is
//     exactly that beam's own install date — the one real changeover day, where meters from
//     the outgoing beam and the new one can both legitimately get logged. Only then is the
//     toggle shown, between that beam and the one installed just before it.
//   - Otherwise (entry date falls inside one beam's window, not on a changeover day) that
//     beam is auto-assigned silently — nothing to ask.
// forceCurrent=true resets the choice to the newer of the two (used when the Loom dropdown
// changes); forceCurrent=false preserves whatever's already in #p_beam (used when an
// existing entry is loaded for editing, so its saved choice is restored, not overwritten —
// and when only the Date field changed, so an already-correct choice isn't reset under you).
function renderBeamToggle(forceCurrent){
  const loom = v('p_loom');
  const date = v('p_date');
  const wrap = document.getElementById('p_beamToggleWrap');
  const hidden = document.getElementById('p_beam');
  if(!wrap || !hidden) return;
  const beams = beamsForLoom(loom); // newest-install-first
  const existing = hidden.value;
  const clear = ()=>{ wrap.innerHTML = ''; hidden.value = ''; };
  if(beams.length === 0 || !date){ clear(); return; }
  if(beams.length === 1){
    // Still nothing to choose, but only applies once the entry date reaches that one beam —
    // an entry dated before it was ever installed gets no beam, same as the multi-beam case.
    wrap.innerHTML = '';
    hidden.value = beams[0].date <= date ? beams[0].id : '';
    return;
  }
  // Beams installed on/before this entry's date — beams is already newest-first, so the
  // first match is the most recent one that applies as of that date.
  const onOrBefore = beams.filter(b=> b.date <= date);
  if(onOrBefore.length === 0){ clear(); return; } // entry predates every beam on this loom
  const active = onOrBefore[0];
  const activeIdx = beams.indexOf(active);
  const prior = beams[activeIdx + 1]; // installed just before `active`, if any
  if(active.date === date && prior){
    // The changeover day: both beams are legitimately possible, so ask.
    const selected = (!forceCurrent && (existing===active.id || existing===prior.id)) ? existing : active.id;
    hidden.value = selected;
    wrap.innerHTML = `<div class="field"><label>This entry is from</label>
      <div style="display:flex;gap:16px;align-items:center;padding:8px 0;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;font-weight:600;cursor:pointer">
          <input type="radio" name="p_beam_choice" value="${active.id}" ${selected===active.id?'checked':''}> New beam (${fmtDate(active.date)}, ${escHtml(active.warpType||'')})
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-weight:600;cursor:pointer">
          <input type="radio" name="p_beam_choice" value="${prior.id}" ${selected===prior.id?'checked':''}> Previous beam (${fmtDate(prior.date)}, ${escHtml(prior.warpType||'')})
        </label>
      </div></div>`;
    wrap.querySelectorAll('input[name="p_beam_choice"]').forEach(radio=>{
      radio.addEventListener('change', ()=>{ hidden.value = radio.value; });
    });
  } else {
    // Entry date falls cleanly inside one beam's window — no ambiguity, no toggle.
    wrap.innerHTML = '';
    hidden.value = active.id;
  }
}
// Rolls up beams into the specific Warp purchase they were chained from (via each beam's
// optional purchaseId), so grey cloth output can be measured against a specific batch of
// yarn instead of warp cost in aggregate. Only purchases with at least one linked beam are
// returned. "Complete" means every linked beam has finished (no longer the active beam on
// its loom) — at that point totalWoven is final, not still growing, so yield% and cost/m
// are exact rather than a running estimate.
function computePurchaseYield(){
  const usage = computeWarpBeamUsage();
  return DATA.warp
    .map(purchase=>{
      // Sorted by Loom number (numeric-aware, so "10" sorts after "9") rather than by date
      // logged, matching how the Warp Beam Log itself is ordered — makes it easy to scan
      // a purchase's beams loom-by-loom instead of in whatever order they were logged.
      const beams = DATA.warpBeams.filter(b=>b.purchaseId===purchase.id).slice().sort((a,b)=>
        (Number(a.loom)-Number(b.loom)) || String(a.loom).localeCompare(String(b.loom)) || (dtOf(a)-dtOf(b))
      );
      if(!beams.length) return null;
      const totalLength = beams.reduce((s,b)=>s+(Number(b.length)||0),0);
      const totalWoven = beams.reduce((s,b)=> s + (usage[b.id]?usage[b.id].woven:0), 0);
      const complete = beams.every(b=> usage[b.id] && !usage[b.id].isActive);
      const totalShrinkage = totalLength - totalWoven;
      const yieldPct = totalLength > 0 ? (totalWoven/totalLength*100) : null;
      const shrinkagePct = totalLength > 0 ? (totalShrinkage/totalLength*100) : null;
      const costPerMeter = totalWoven > 0.004 ? (Number(purchase.amount)||0)/totalWoven : null;
      return {purchase, beams, totalLength, totalWoven, totalShrinkage, complete, yieldPct, shrinkagePct, costPerMeter};
    })
    .filter(Boolean)
    .sort((a,b)=> dtOf(b.purchase)-dtOf(a.purchase));
}
// One purchase's summary panel: purchase-level totals up top under an "Overall Summary"
// label, then every beam linked to it underneath under its own "Beam-Level Detail" label —
// kept as two clearly separated sections within the same panel rather than run together.
// "Finished On" cell: the date (and time, when known) a beam finished, and whether the next beam replaced it
// or it was marked Finished by hand. Empty dash while the beam is still active.
function finishedOnCell(d){
  if(!d || !d.finishedOn) return d && d.finishedHow === 'manual' ? 'Marked finished (no date)' : '—';
  const how = d.finishedHow === 'replaced' ? 'replaced by next beam' : 'marked finished';
  return `${fmtDate(d.finishedOn)}${d.finishedTime ? ' · ' + escHtml(d.finishedTime) : ''}<br><span style="font-size:11px;color:var(--ink-soft)">${how}</span>`;
}
function renderYieldPanel(r, beamDetails){
  const shrinkStat = r.complete
    ? `${fmtQtyMtr(r.totalShrinkage)}m${r.shrinkagePct!=null?` (${fmtNum(Math.round(r.shrinkagePct*100)/100)}%)`:''}`
    : '— (pending)';
  const yieldStat = r.complete && r.yieldPct!=null ? fmtNum(Math.round(r.yieldPct*100)/100)+'%' : '— (pending)';
  const costStat = r.complete && r.costPerMeter!=null ? fmtRs2(r.costPerMeter)+'/m' : '— (pending)';
  const beamRows = r.beams.map(b=>{
    const d = beamDetails[b.id] || {woven:0, isActive:true, daysTaken:0, shrinkage:Number(b.length)||0, shrinkagePct:null};
    const shrinkCell = d.isActive ? '—' : (d.shrinkage < 0
      ? `<span style="color:var(--rust)">${fmtQtyMtr(d.shrinkage)} (over)</span>`
      : fmtQtyMtr(d.shrinkage));
    const shrinkPctCell = d.isActive ? '—' : (d.shrinkagePct!=null ? fmtNum(Math.round(d.shrinkagePct*100)/100)+'%' : '—');
    const daysCell = fmtNum(Math.round(d.daysTaken*10)/10) + (d.isActive ? ' (so far)' : '');
    return [
      fmtDate(b.date), escHtml(b.warpType||'—'), `<span class="loom-no">${escHtml(b.loom)}</span>`,
      fmtQtyMtr(b.length), fmtQtyMtr(d.woven), shrinkCell, shrinkPctCell, daysCell,
      finishedOnCell(d), d.isActive ? '<b>Active</b>' : 'Finished'
    ];
  });
  return `
  <div class="purchase-panel">
    <div class="ptitle">${fmtDate(r.purchase.date)} — ${escHtml(r.purchase.type||'—')}${r.purchase.supplier?` (${escHtml(r.purchase.supplier)})`:''}</div>
    <div class="psub">${fmtRs(r.purchase.amount)} · ${r.beams.length} beam${r.beams.length===1?'':'s'} · ${r.complete?'<span class="badge month">Complete</span>':'<span class="badge progress">In Progress</span>'}</div>
    <div class="panel-subhead">Overall Summary</div>
    <div class="grid cols-3">
      <div class="stat"><div class="label">Length Logged</div><div class="value">${fmtNum(r.totalLength)}m</div></div>
      <div class="stat"><div class="label">Woven${r.complete?'':' So Far'}</div><div class="value">${fmtNum(r.totalWoven)}m</div></div>
      <div class="stat"><div class="label">Shrinkage</div><div class="value">${shrinkStat}</div></div>
      <div class="stat"><div class="label">Yield</div><div class="value">${yieldStat}</div></div>
      <div class="stat"><div class="label">Cost / Meter</div><div class="value">${costStat}</div></div>
    </div>
    <div class="panel-subhead" style="margin-top:16px;padding-top:14px;border-top:1px dashed var(--line)">Beam-Level Detail</div>
    <div class="log-scroll log-cards">${table(['Beam Date','Warp Type','Loom','Length (m)','Woven (m)','Shrinkage (m)','Shrinkage %','Days Taken','Finished On','Status'], beamRows, true)}</div>
  </div>`;
}
function warpBeamsPanel(){
  const usage = computeWarpBeamUsage();
  let purchaseFilterVal = FILTER.warpBeamsFinishedPurchase;
  const activePurchaseFilterVal = FILTER.warpBeamsActivePurchase || '';
  // Sorted by Loom number first (numeric-aware, so "10" sorts after "9" not before it),
  // then newest-first within the same loom — makes it easy to review each loom's beam
  // history together instead of interleaved by date across every loom.
  const sorted = DATA.warpBeams.slice().sort((a,b)=>
    (Number(a.loom)-Number(b.loom)) || String(a.loom).localeCompare(String(b.loom)) || (dtOf(b)-dtOf(a))
  );
  const purchaseLabel = (id)=>{
    if(!id) return '—';
    const p = DATA.warp.find(x=>x.id===id);
    return p ? `${fmtDate(p.date)} (${escHtml(p.type||'—')})` : '—';
  };
  const yieldRows = computePurchaseYield();
  const beamDetails = computeBeamDetails();
  // Split so the default view only ever holds purchases that are still actually running —
  // once every beam on a purchase finishes, it drops out of the "In Progress" list here and
  // becomes reachable (one at a time, via the picker) in the Completed card below instead of
  // piling up indefinitely in one ever-growing list.
  const activeYieldRows = yieldRows.filter(r=>!r.complete);
  const completedYieldRows = yieldRows.filter(r=>r.complete);
  let summaryPurchaseVal = FILTER.warpBeamsSummaryPurchase;
  if(summaryPurchaseVal === undefined){
    summaryPurchaseVal = completedYieldRows[0] ? completedYieldRows[0].purchase.id : '';
  }
  const selectedCompletedRow = completedYieldRows.find(r=>r.purchase.id===summaryPurchaseVal) || completedYieldRows[0] || null;
  if(selectedCompletedRow) summaryPurchaseVal = selectedCompletedRow.purchase.id;
  const summaryOptions = completedYieldRows.map(r=>
    `<option value="${r.purchase.id}"${summaryPurchaseVal===r.purchase.id?' selected':''}>${fmtDate(r.purchase.date)} — ${escHtml(r.purchase.type||'Type —')} — ${fmtRs(r.purchase.amount)}</option>`
  ).join('');
  const activeYieldCard = `
    ${sumCardOpen('beams-active','Beam Summary by Purchase — In Progress', '<button type="button" class="info-btn" data-info-toggle data-info-target="info-beams-active" title="Info">i</button>')}
      <p class="note info-note" id="info-beams-active" hidden>Every purchase that still has at least one Active beam linked to it, each shown as its own panel — purchase-level totals under "Overall Summary", every linked beam's own numbers under "Beam-Level Detail". "Woven" comes straight from Production entries, not an estimate, and only counts entries dated within that beam's own window. Once every beam on a purchase finishes, it moves out of this list and into the Completed summary below.</p>
      ${activeYieldRows.length
        ? `<div class="purchase-panels">${activeYieldRows.map(r=>renderYieldPanel(r, beamDetails)).join('')}</div>`
        : `<div class="empty">No purchases currently in progress.</div>`}
    ${sumCardClose()}
  `;
  const completedYieldCard = `
    ${sumCardOpen('beams-done','Beam Summary by Purchase — Completed', '<button type="button" class="info-btn" data-info-toggle data-info-target="info-beams-done" title="Info">i</button>')}
      <p class="note info-note" id="info-beams-done" hidden>Every purchase whose linked beams have all finished, with final Shrinkage/Yield%/Cost-per-meter figures. Pick one from the dropdown below to view its summary — kept to one at a time so this card doesn't grow endlessly as more purchases complete.</p>
      ${completedYieldRows.length ? `
        <div class="field" style="max-width:360px;margin-bottom:12px">
          <label>Select Purchase</label>
          <select id="wbs_purchase">${summaryOptions}</select>
        </div>
        ${selectedCompletedRow ? renderYieldPanel(selectedCompletedRow, beamDetails) : ''}
      ` : `<div class="empty">No completed purchases yet.</div>`}
    ${sumCardClose()}
  `;
  return beamForecastCard() + `<div class="card"><div class="card-head"><h2>Log New Warp (Tana) Beam</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>Log this whenever a beam is chained onto a loom. Meters remaining are tracked from Production entries logged against this loom, starting this date, until the loom's next beam is logged here — or until you mark it Finished by hand below, if you're done with it before a replacement beam is logged.</p>
    <div class="grid cols-3">
      ${field('Date','wb_date','date',`value="${todayStr()}" autofocus`)}
      ${field('Time','wb_time','time',`value="${nowStr()}"`)}
      ${selectField('Loom','wb_loom',DATA.looms)}
    </div>
    <div class="grid cols-2" style="margin-top:12px">
      ${selectField('Warp Type','wb_type',DATA.warpTypes)}
      ${field('Beam Length (meters)','wb_length','number','step="0.01"')}
    </div>
    <div class="grid cols-1" style="margin-top:12px">
      ${warpPurchaseSelectField('Source Purchase','wb_purchase')}
    </div>
    <p class="note" style="margin-top:0">Required — link this beam to the Warp purchase its yarn came from, to track exact grey cloth yield per purchase, below. Only purchases from the last 2 months are listed.</p>
    <div class="grid cols-1" style="margin-top:12px">
      ${textareaField('Remarks (optional)','wb_rem')}
    </div>
    <div class="form-actions">
      <button class="primary" id="addWarpBeam">Log Beam</button>
      <button class="ghost" id="cancelWarpbeams" style="display:none">Cancel Edit</button>
    </div></div>
    ${activeYieldCard}
    ${completedYieldCard}
    <div class="card"><div class="card-head"><h2>Warp (Tana) Beam Log</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>Active beams only — currently on a loom or not yet marked/replaced as Finished. A beam moves to the Finished Beams Log below once a newer beam is logged on the same loom, or once you mark it Finished by hand.</p>
    ${(()=>{
      // Split into Active vs Finished using the exact same rule the Status column already
      // used — a beam is finished either because a newer beam superseded it (u.hasNext) or
      // because it was marked Finished by hand (r.finished). Keeping them in one table with
      // a Status column made it easy to lose track of which looms are actually still running
      // — this way the log itself only ever shows what's currently active.
      const withStatus = sorted.map(r=>{
        const u = usage[r.id] || {woven:0, remaining:Number(r.length)||0, isActive:false, hasNext:false};
        return {r, u, isFinished: u.hasNext || !!r.finished};
      });
      const activeBeams = withStatus.filter(x=>!x.isFinished).map(x=>x.r);
      let finishedBeams = withStatus.filter(x=>x.isFinished).map(x=>x.r);
      // Same idea as the Finished table's filter below, but scoped to purchases actually
      // linked to a currently-Active beam.
      const activePurchaseIds = Array.from(new Set(activeBeams.map(r=>r.purchaseId).filter(Boolean)));
      const activePurchases = activePurchaseIds
        .map(id=>DATA.warp.find(p=>p.id===id)).filter(Boolean)
        .sort((a,b)=>dtOf(b)-dtOf(a));
      const activePurchaseFilterOptions = activePurchases.map(p=>
        `<option value="${p.id}"${activePurchaseFilterVal===p.id?' selected':''}>${fmtDate(p.date)} — ${escHtml(p.type||'Type —')} — ${fmtRs(p.amount)}</option>`
      ).join('');
      const activePurchaseFilterHtml = activePurchases.length ? `<div class="field" style="max-width:360px;margin-bottom:12px">
        <label>Filter by Source Purchase</label>
        <select id="wba_purchase"><option value="">— All purchases —</option>${activePurchaseFilterOptions}</select>
      </div>` : '';
      const activeBeamsFiltered = activePurchaseFilterVal ? activeBeams.filter(r=>r.purchaseId===activePurchaseFilterVal) : activeBeams;
      // Filter options only list purchases actually linked to a finished beam — not the same
      // "last 2 months" list used when logging a new beam, since a finished beam can easily be
      // older than that and should still be findable here.
      const finishedPurchaseIds = Array.from(new Set(finishedBeams.map(r=>r.purchaseId).filter(Boolean)));
      const finishedPurchases = finishedPurchaseIds
        .map(id=>DATA.warp.find(p=>p.id===id)).filter(Boolean)
        .sort((a,b)=>dtOf(b)-dtOf(a));
      // No explicit choice made yet (FILTER value is still undefined, not the empty string
      // an explicit "All purchases" pick would set) — default to the second-most-recent
      // purchase in this list, i.e. the one before the latest, rather than showing everything.
      if(purchaseFilterVal === undefined){
        purchaseFilterVal = finishedPurchases[1] ? finishedPurchases[1].id : '';
      }
      const purchaseFilterOptions = finishedPurchases.map(p=>
        `<option value="${p.id}"${purchaseFilterVal===p.id?' selected':''}>${fmtDate(p.date)} — ${escHtml(p.type||'Type —')} — ${fmtRs(p.amount)}</option>`
      ).join('');
      const purchaseFilterHtml = finishedPurchases.length ? `<div class="field" style="max-width:360px;margin-bottom:12px">
        <label>Filter by Source Purchase</label>
        <select id="wbf_purchase"><option value="">— All purchases —</option>${purchaseFilterOptions}</select>
      </div>` : '';
      if(purchaseFilterVal) finishedBeams = finishedBeams.filter(r=>r.purchaseId===purchaseFilterVal);
      const mapFn = r=>{
        const u = usage[r.id] || {woven:0, remaining:Number(r.length)||0, isActive:false, hasNext:false};
        const remainingCell = u.remaining < 0
          ? `<span style="color:var(--rust)">${fmtQtyMtr(u.remaining)} (over)</span>`
          : fmtQtyMtr(u.remaining);
        let statusCell;
        if(r.finished){
          statusCell = `<span class="badge month">Finished</span><br><button class="ghost" data-finish="${r.id}:reopen" style="padding:3px 8px;font-size:12px;margin-top:4px">Reopen</button>`;
        } else if(u.hasNext){
          statusCell = '<span class="badge month">Finished</span>';
        } else {
          statusCell = `<span class="badge progress">Active</span><br><button class="ghost" data-finish="${r.id}:finish" style="padding:3px 8px;font-size:12px;margin-top:4px">Mark Finished</button>`;
        }
        const d = beamDetails[r.id] || {isActive:true, shrinkage:0, shrinkagePct:null};
        const shrinkCell = d.isActive ? '—' : (d.shrinkage < 0
          ? `<span style="color:var(--rust)">${fmtQtyMtr(d.shrinkage)} (over)</span>`
          : fmtQtyMtr(d.shrinkage));
        const cells = [
          fmtDate(r.date), r.time||'—', escHtml(r.warpType||'—'), `<span class="loom-no">${escHtml(r.loom)}</span>`,
          fmtQtyMtr(r.length), fmtQtyMtr(u.woven), remainingCell, shrinkCell,
          purchaseLabel(r.purchaseId), statusCell, actionBtns('warpBeams',r.id)
        ];
        // Flags a beam that's running low on warp so it stands out at a glance in the log —
        // only while it's still Active (reorder soon). A Finished beam is done and its low
        // remaining is just history, not something needing attention, so it stays unstyled.
        const isFinishedRow = r.finished || u.hasNext;
        if(!isFinishedRow && u.remaining < 300) cells.rowStyle = 'background:var(--warn-bg-2)';
        return cells;
      };
      const headers = ['Date','Time','Warp Type','Loom','Length (m)','Woven (m)','Remaining (m)','Shrinkage (m)','Source Purchase','Status',''];
      // The Finished Beams Log also shows when each beam finished (just before the Status column)
      const finishedHeaders = headers.slice(); finishedHeaders.splice(9, 0, 'Finished On');
      const mapFnFinished = r=>{ const cells = mapFn(r); cells.splice(9, 0, finishedOnCell(beamDetails[r.id])); return cells; };
      // The Active Beams log gets an Est. Finish column (right after Remaining) from the beam forecast
      const forecastById = {}; computeBeamForecasts(beamAlertDays() || 3).forEach(f=>{ forecastById[f.id] = f; });
      const activeHeaders = headers.slice(); activeHeaders.splice(7, 0, 'Est. Finish');
      const mapFnActive = r=>{ const cells = mapFn(r); cells.splice(7, 0, estFinishCell(forecastById[r.id])); return cells; };
      return activePurchaseFilterHtml
        + (activeBeamsFiltered.length ? logTable('warpBeams', activeHeaders, activeBeamsFiltered, mapFnActive) : `<div class="empty">${activePurchaseFilterVal ? 'No active beams for this purchase.' : 'No active beams.'}</div>`)
        + `</div><div class="card"><div class="card-head"><h2>Finished Beams Log</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>Beams that are done — either superseded by a newer beam on the same loom, or marked Finished by hand. Use Reopen on a hand-finished beam if that was a mistake.</p>
    ${purchaseFilterHtml}
    ` + (finishedBeams.length ? logTable('warpBeamsFinished', finishedHeaders, finishedBeams, mapFnFinished) : `<div class="empty">${purchaseFilterVal ? 'No finished beams for this purchase.' : 'No finished beams yet.'}</div>`);
    })()}</div>`;
}
