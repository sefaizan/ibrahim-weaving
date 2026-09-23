/* Page wiring: renderPanel + wirePanel connect every page's buttons, forms and filters to the
 * data; also the shared helpers those handlers use (v, wireEnterSubmit, wireDelete, wireEditGeneric). */

/* ---------------- Panel dispatch ---------------- */
function renderPanel(id){
  CUR_PANEL = id;
  const map = {
    overview: overviewPanel, production: productionPanel, sale: salePanel, recovery: recoveryPanel,
    expense: expensePanel, family: familyPanel, warp: warpPanel, warpbeams: warpBeamsPanel, weft: weftPanel, wages: wagesPanel,
    loans: loansPanel, ratecalc: ratecalcPanel,
    checkpoints: checkpointsPanel, settings: settingsPanel, graphs: graphsPanel, backup: backupPanel,
  };
  return `<div class="panel active">${map[id]()}</div>`;
}

function wirePanel(id){
  if(id==='overview'){
    const monthSel = document.getElementById('ov_month_sel');
    const yearSel = document.getElementById('ov_year_sel');
    const fromSel = document.getElementById('ov_from_sel');
    const toSel = document.getElementById('ov_to_sel');
    const customWrap = document.getElementById('ov_custom');
    const chips = Array.from(document.querySelectorAll('#ov_chips .chip'));
    const setActiveChip = (period)=> chips.forEach(c=> c.classList.toggle('active', c.dataset.period === period));
    const combine = ()=>{
      // A custom From/To range takes priority over Month/Year whenever either date is set.
      if(fromSel.value || toSel.value) return `range:${fromSel.value}:${toSel.value}`;
      const m = monthSel.value;
      let y = yearSel.value;
      if(m && !y){ // month chosen without a year — default to current year for context
        y = String(new Date().getFullYear());
        yearSel.value = y;
      }
      if(m && y) return `${y}-${m}`;
      if(!m && y) return y; // whole year
      return '';
    };
    const runCustom = ()=>{ setActiveChip('custom'); renderStats(combine()); };
    monthSel.addEventListener('change', ()=>{ fromSel.value=''; toSel.value=''; runCustom(); });
    yearSel.addEventListener('change', ()=>{ fromSel.value=''; toSel.value=''; runCustom(); });
    fromSel.addEventListener('change', ()=>{ monthSel.value=''; yearSel.value=''; runCustom(); });
    toSel.addEventListener('change', ()=>{ monthSel.value=''; yearSel.value=''; runCustom(); });
    // Quick chips cover the common cases in one tap; "Custom…" just reveals the existing
    // Month/Year/range controls instead of duplicating their logic.
    chips.forEach(chip=>{
      chip.onclick = ()=>{
        const period = chip.dataset.period;
        if(period === 'custom'){
          customWrap.hidden = false;
          setActiveChip('custom');
          return;
        }
        customWrap.hidden = true;
        monthSel.value=''; yearSel.value=''; fromSel.value=''; toSel.value='';
        setActiveChip(period);
        const now = new Date();
        let val = '';
        if(period === 'this-month') val = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        else if(period === 'last-month'){
          const d = new Date(now.getFullYear(), now.getMonth()-1, 1);
          val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        } else if(period === 'this-year') val = String(now.getFullYear());
        renderStats(val);
      };
    });
    setActiveChip('');
    renderStats('');
  }
  if(id==='production'){
    const readProductionForm = ()=>({date:v('p_date'), loom:v('p_loom'), quality:v('p_quality'), qty:Number(v('p_qty')), beam:v('p_beam'),
      e1:v('p_e1'), e1m:combineMtr16(v('p_e1m_w'), v('p_e1m_16')), e2:v('p_e2'), e2m:combineMtr16(v('p_e2m_w'), v('p_e2m_16')),
      e3:v('p_e3'), e3m:combineMtr16(v('p_e3m_w'), v('p_e3m_16'))});
    // Both Add buttons need a date, loom, quality and quantity, so a stray tap can't save a blank
    // entry (which would also count towards wages).
    const productionChecks = rec => [
      [rec.date, 'Pick the date first.', 'p_date'],
      [rec.loom, 'Pick a loom first.', 'p_loom'],
      [rec.quality, 'Pick a quality first.', 'p_quality'],
      [rec.qty > 0, 'Enter the quantity produced first.', 'p_qty'],
    ];
    // "Add & next loom": saves this entry, then reopens the form on the next loom with the same
    // date and quality (see PRODUCTION_PREFILL below) so a whole day's looms can be keyed in
    // one after another. It needs a loom and a quantity so a stray second tap can't save a blank
    // entry (which would also count towards wages), and it isn't offered while editing a row.
    const nextBtn = document.getElementById('addProductionNext');
    nextBtn.onclick = async ()=>{
      if(EDITING) return;
      const rec = readProductionForm();
      if(!requireFields(productionChecks(rec))) return;
      nextBtn.disabled = true;
      const next = nextLoomAfter(rec.loom);
      DATA.production.push({id:uid(), ...rec}); PAGE.production = 1;
      PRODUCTION_PREFILL = {date:rec.date, quality:rec.quality, loom:next || ''};
      await save(); switchTab('production');
      // If this entry brought the loom's beam close to its end, say so (once a day per beam)
      const beamMsg = takeBeamAlert(rec.loom);
      const savedMsg = next ? `Saved loom ${rec.loom} — now loom ${next}` : `Saved loom ${rec.loom} — that was the last loom`;
      if(beamMsg){ haptic([30,40,30]); showActionToast(`${savedMsg} · ${beamMsg}`, 'View', ()=> switchTab('warpbeams'), 9000); }
      else showToast(savedMsg, 2500);
    };
    document.getElementById('addProduction').onclick = async ()=>{
      const rec = readProductionForm();
      if(!requireFields(productionChecks(rec))) return;
      if(EDITING && EDITING.key==='production'){
        const idx = DATA.production.findIndex(r=>r.id===EDITING.id);
        if(idx>-1) DATA.production[idx] = {...DATA.production[idx], ...rec};
        EDITING = null;
      } else {
        DATA.production.push({id:uid(), ...rec}); PAGE.production = 1;
      }
      await save(); switchTab('production');
      beamAlertToast(takeBeamAlert(rec.loom)); // the loom's beam may now be about to end
    };
    document.getElementById('p_loom').addEventListener('change', ()=> renderBeamToggle(true));
    // Date drives which beam(s) are even relevant (see renderBeamToggle) — recompute on
    // every date change, but preserve an existing valid choice rather than resetting it.
    document.getElementById('p_date').addEventListener('change', ()=> renderBeamToggle(false));
    // Coming back from "Add & next loom": restore date + quality, select the next loom with its
    // usual employees, and put the cursor on Quantity. Values are set here, before the custom
    // dropdowns are built, so they show the right labels.
    if(PRODUCTION_PREFILL){
      const pf = PRODUCTION_PREFILL; PRODUCTION_PREFILL = null;
      const a = pf.loom ? loomAssignmentFor(pf.loom) : null;
      document.getElementById('p_date').value = pf.date;
      document.getElementById('p_quality').value = pf.quality;
      document.getElementById('p_loom').value = pf.loom;
      document.getElementById('p_e1').value = a?.e1 || '';
      document.getElementById('p_e2').value = a?.e2 || '';
      document.getElementById('p_qty').focus();
    }
    renderBeamToggle(true);
    // Employee 3 stays hidden until needed — clicking the button reveals it; clicking
    // again hides it and clears whatever was typed, so a hidden field never gets submitted.
    const e3wrap = document.getElementById('p_e3wrap');
    const e3btn = document.getElementById('p_toggleE3');
    const showE3 = ()=>{ e3wrap.style.display = 'grid'; e3btn.textContent = '− Remove third employee'; };
    const hideE3 = ()=>{
      e3wrap.style.display = 'none'; e3btn.textContent = '+ Add a third employee';
      document.getElementById('p_e3').value = '';
      document.getElementById('p_e3m_w').value = ''; document.getElementById('p_e3m_16').value = '';
    };
    e3btn.addEventListener('click', ()=>{ e3wrap.style.display === 'none' ? showE3() : hideE3(); });
    // Auto-fill Employee 1/2 from this loom's usual assignment (set in Settings > Loom
    // Assignments) whenever the loom is changed by hand — never during Edit prefill, since
    // that sets .value directly without firing 'change'. Both stay fully editable; picking a
    // different loom just re-applies whichever pair is assigned to it (or clears back to
    // blank if that loom has no assignment). Employee 3 is deliberately left alone here —
    // it's typically a one-off fill-in (someone covering for a regular who's on leave, or an
    // outside worker who may never work another shift), not something tied to the loom itself,
    // so it keeps working exactly as before: hidden until "+ Add a third employee" is clicked.
    document.getElementById('p_loom').addEventListener('change', ()=>{
      const a = loomAssignmentFor(v('p_loom'));
      document.getElementById('p_e1').value = a?.e1 || '';
      document.getElementById('p_e2').value = a?.e2 || '';
    });
    wireEnterSubmit(['p_date','p_quality','p_loom','p_qty','p_e1','p_e1m_w','p_e1m_16','p_e2','p_e2m_w','p_e2m_16','p_e3','p_e3m_w','p_e3m_16'],'addProduction');
    wireDelete('production');
    // Meters are stored as one decimal number per employee, same as before — only the fieldMap
    // entries for the plain select/date/etc fields go through the generic value=rec[field] fill.
    // The Meters/16ths boxes are split out from that decimal by hand in afterFill below.
    wireEditGeneric('production','addProduction','cancelProduction',
      {p_date:'date',p_quality:'quality',p_loom:'loom',p_qty:'qty',p_beam:'beam',p_e1:'e1',p_e2:'e2',p_e3:'e3'},
      (rec)=>{
        renderBeamToggle(false); if(v('p_e3')) showE3(); nextBtn.style.display = 'none';
        const fillFrac = (idWhole, idSixteenth, val)=>{
          const wEl = document.getElementById(idWhole), sEl = document.getElementById(idSixteenth);
          if(!wEl || !sEl) return;
          if(val===undefined || val===null){ wEl.value = ''; sEl.value = ''; return; }
          const s = splitMtr16(val);
          wEl.value = s.whole; sEl.value = s.sixteenths;
        };
        fillFrac('p_e1m_w','p_e1m_16', rec.e1m);
        fillFrac('p_e2m_w','p_e2m_16', rec.e2m);
        fillFrac('p_e3m_w','p_e3m_16', rec.e3m);
      });
    const pfQuality = document.getElementById('pf_quality');
    pfQuality.value = FILTER.production || '';
    pfQuality.addEventListener('change', ()=>{ FILTER.production = pfQuality.value; PAGE.production = 1; switchTab('production'); });
    const pfFrom = document.getElementById('pf_from');
    const pfTo = document.getElementById('pf_to');
    const pfCustom = document.getElementById('pf_custom');
    const pfChips = Array.from(document.querySelectorAll('#pf_chips .chip'));
    const setPfActiveChip = (period)=> pfChips.forEach(c=> c.classList.toggle('active', c.dataset.period === period));
    pfFrom.addEventListener('change', ()=>{
      FILTER.productionFrom = pfFrom.value; PAGE.production = 1; setPfActiveChip('custom'); switchTab('production');
    });
    pfTo.addEventListener('change', ()=>{
      FILTER.productionTo = pfTo.value; PAGE.production = 1; setPfActiveChip('custom'); switchTab('production');
    });
    pfChips.forEach(chip=>{
      chip.onclick = ()=>{
        const period = chip.dataset.period;
        if(period === 'custom'){ pfCustom.hidden = false; setPfActiveChip('custom'); return; }
        pfCustom.hidden = true;
        const {from, to} = quickPeriodRange(period);
        FILTER.productionFrom = from; FILTER.productionTo = to;
        PAGE.production = 1; setPfActiveChip(period);
        switchTab('production');
      };
    });
    setPfActiveChip((FILTER.productionFrom || FILTER.productionTo) ? 'custom' : '');
    const pfDetected = (()=>{
      const from = FILTER.productionFrom || '', to = FILTER.productionTo || '';
      if(!from && !to) return '';
      for(const p of ['this-month','last-month','this-year']){
        const r = quickPeriodRange(p);
        if(r.from===from && r.to===to) return p;
      }
      return 'custom';
    })();
    setPfActiveChip(pfDetected);
    if(pfDetected === 'custom') pfCustom.hidden = false;

    // Bulk import: pastes multiple "Loom, Qty, Employee1, Meters1[, Employee2, Meters2[, Employee3, Meters3]]"
    // rows (one per line) — matches employee names loosely (case-insensitive, partial match if unique) since
    // transcribed handwriting is rarely an exact match; auto-adds any Loom number not yet in Settings, since
    // that's low-risk. Quality and Date are set once and applied to every row. Nothing is imported if any row
    // has a problem — errors are listed so you can fix the pasted text and retry, rather than partially importing.
    const findEmpMatch = (input)=>{
      const norm = (input||'').trim().toLowerCase();
      if(!norm) return null;
      const exact = DATA.employees.find(e=>e.name.toLowerCase()===norm);
      if(exact) return exact.name;
      const candidates = DATA.employees.filter(e=> e.name.toLowerCase().startsWith(norm) || e.name.toLowerCase().includes(norm));
      return candidates.length===1 ? candidates[0].name : null;
    };
    const importBtn = document.getElementById('importProduction');
    if(importBtn) importBtn.onclick = async ()=>{
      const resultEl = document.getElementById('pb_result');
      const date = v('pb_date');
      const quality = v('pb_quality');
      if(!date){ resultEl.innerHTML = `<span style="color:var(--rust)">Set a Date first.</span>`; return; }
      if(!quality){ resultEl.innerHTML = `<span style="color:var(--rust)">Pick a Quality first.</span>`; return; }
      const lines = document.getElementById('pb_rows').value.split('\n').map(l=>l.trim()).filter(Boolean);
      if(!lines.length){ resultEl.innerHTML = `<span style="color:var(--rust)">Paste at least one row first.</span>`; return; }
      const errors = [];
      const newRecords = [];
      lines.forEach((line, idx)=>{
        const parts = line.split(',').map(p=>p.trim());
        if(parts.length < 4 || parts.length % 2 !== 0){
          errors.push(`Line ${idx+1}: expected Loom, Qty, then Employee/Meters pairs — got ${parts.length} value(s).`);
          return;
        }
        const loomInput = parts[0];
        const qty = Number(parts[1]);
        if(!loomInput){ errors.push(`Line ${idx+1}: missing Loom number.`); return; }
        if(isNaN(qty)){ errors.push(`Line ${idx+1}: Qty "${parts[1]}" isn't a number.`); return; }
        let loomName = DATA.looms.find(l=>l.name.toLowerCase()===loomInput.toLowerCase())?.name;
        if(!loomName) loomName = loomInput; // resolved/created after all lines validate cleanly
        const empPairs = [];
        let lineHadError = false;
        for(let i=2;i<parts.length;i+=2){
          const empInput = parts[i], metersVal = Number(parts[i+1]);
          if(!empInput) continue;
          if(isNaN(metersVal)){ errors.push(`Line ${idx+1}: meters for "${empInput}" isn't a number.`); lineHadError = true; break; }
          const empName = findEmpMatch(empInput);
          if(!empName){ errors.push(`Line ${idx+1}: employee "${empInput}" not recognized — add them in Settings first, or check the spelling.`); lineHadError = true; break; }
          empPairs.push([empName, metersVal]);
        }
        if(lineHadError) return;
        if(!empPairs.length){ errors.push(`Line ${idx+1}: no employee/meters given.`); return; }
        newRecords.push({
          date, loom: loomName, quality, qty, beam:'',
          e1: empPairs[0]?empPairs[0][0]:'', e1m: empPairs[0]?empPairs[0][1]:0,
          e2: empPairs[1]?empPairs[1][0]:'', e2m: empPairs[1]?empPairs[1][1]:0,
          e3: empPairs[2]?empPairs[2][0]:'', e3m: empPairs[2]?empPairs[2][1]:0,
        });
      });
      if(errors.length){
        resultEl.innerHTML = `<span style="color:var(--rust)">${errors.length} row(s) had a problem — nothing was imported yet:</span><br>`
          + errors.map(e=>`• ${escHtml(e)}`).join('<br>');
        return;
      }
      newRecords.forEach(rec=>{
        if(!DATA.looms.some(l=>l.name===rec.loom)) DATA.looms.push({id:uid(), name:rec.loom});
        DATA.production.push({id:uid(), ...rec});
      });
      PAGE.production = 1;
      await save();
      switchTab('production');
      showToast(`Imported ${newRecords.length} production entr${newRecords.length===1?'y':'ies'}.`);
    };
  }
  if(id==='sale'){
    document.getElementById('addSale').onclick = async ()=>{
      const qty=Number(v('s_qty')), rate=Number(v('s_rate'));
      // An older sale saved before rates were stored has an Amount but no Rate. Editing it (even just
      // the description) used to recalculate its Amount as Rs 0. Keep the Amount as it was while the
      // quantity is unchanged and no rate is typed in; type a rate and it is recalculated as usual.
      const existing = (EDITING && EDITING.key==='sale') ? DATA.sale.find(r=>r.id===EDITING.id) : null;
      const noRateOnFile = !!(existing && !Number(existing.rate) && Number(existing.amount) > 0);
      const keepAmount = noRateOnFile && !(rate > 0) && qty === Number(existing.qty);
      const rateMsg = noRateOnFile
        ? `Enter the rate per mtr — this older sale has none saved (Rs ${fmtNum(existing.amount)} for ${fmtQtyMtr(existing.qty)} mtr).`
        : 'Enter the rate per mtr first.';
      if(!requireFields([
        [v('s_date'), 'Pick the date first.', 's_date'],
        [v('s_client'), 'Pick a client first.', 's_client'],
        [v('s_quality'), 'Pick a quality first.', 's_quality'],
        [qty > 0, 'Enter the quantity (mtr) first.', 's_qty'],
        [keepAmount || rate > 0, rateMsg, 's_rate'],
      ])) return;
      const rec = {date:v('s_date'), invoice:v('s_inv'), client:v('s_client'), quality:v('s_quality'), qty, rate, amount: keepAmount ? Number(existing.amount) : Math.floor(qty*rate + 1e-6), dyeing:v('s_dyeing'), desc:v('s_desc')};
      if(EDITING && EDITING.key==='sale'){
        const idx = DATA.sale.findIndex(r=>r.id===EDITING.id);
        if(idx>-1) DATA.sale[idx] = {...DATA.sale[idx], ...rec};
        EDITING = null;
      } else {
        DATA.sale.push({id:uid(), ...rec}); PAGE.sale = 1;
      }
      await save(); switchTab('sale');
    };
    wireAmountPreview('s_qty','s_rate','s_amtPreview','Amount',true);
    wireEnterSubmit(['s_date','s_client','s_quality','s_qty','s_rate','s_inv'],'addSale');
    wireDelete('sale');
    wireEditGeneric('sale','addSale','cancelSale',
      {s_date:'date',s_client:'client',s_quality:'quality',s_qty:'qty',s_rate:'rate',s_inv:'invoice',s_dyeing:'dyeing',s_desc:'desc'},
      ()=>{ const el=document.getElementById('s_qty'); if(el) el.dispatchEvent(new Event('input')); });
    const sfClient = document.getElementById('sf_client');
    const sfQuality = document.getElementById('sf_quality');
    sfClient.value = FILTER.saleClient || '';
    sfQuality.value = FILTER.saleQuality || '';
    sfClient.addEventListener('change', ()=>{ FILTER.saleClient = sfClient.value; PAGE.sale = 1; switchTab('sale'); });
    sfQuality.addEventListener('change', ()=>{ FILTER.saleQuality = sfQuality.value; PAGE.sale = 1; switchTab('sale'); });
  }
  if(id==='recovery'){
    // Cheque rows are managed as in-memory state and rebuilt into the DOM on every change —
    // simplest way to support add/remove of an arbitrary number of rows without a reactive
    // framework. `chequeRows` holds {id, amount, chequeNo, bank, owner, chequeDate, status}.
    // Cheques are now always available alongside Cash/Bank Transfer amounts, since a single
    // real payment can genuinely be a mix of all three.
    let chequeRows = [];
    const renderChequeRows = ()=>{
      const wrap = document.getElementById('r_chequeRows');
      wrap.innerHTML = chequeRows.map((c,i)=>`
        <div data-cheque-row="${c.id}" style="margin-top:${i?'16px':'0'};padding-top:${i?'16px':'0'};${i?'border-top:1px dashed var(--line)':''}">
          <div class="grid cols-3">
            <div class="field"><label>Amount</label><input type="number" step="0.01" data-cf="amount" value="${c.amount||''}"></div>
            <div class="field"><label>Cheque No (optional)</label><input type="text" data-cf="chequeNo" value="${escHtml(c.chequeNo||'')}"></div>
            <div class="field"><label>Bank (optional)</label><select data-cf="bank"><option value="">—</option>${opts(DATA.banks)}</select></div>
          </div>
          <div class="grid cols-3" style="margin-top:10px">
            <div class="field"><label>Cheque Owner Name (optional)</label><input type="text" data-cf="owner" value="${escHtml(c.owner||'')}" placeholder="if different from the client"></div>
            <div class="field"><label>Cheque Date (optional)</label><input type="date" data-cf="chequeDate" value="${c.chequeDate||''}"></div>
            <div class="field"><label>Status</label><select data-cf="status">
              <option ${c.status==='Pending'?'selected':''}>Pending</option>
              <option ${c.status==='Cleared'?'selected':''}>Cleared</option>
              <option ${c.status==='Bounced'?'selected':''}>Bounced</option>
              <option ${c.status==='Replaced'?'selected':''}>Replaced</option>
            </select></div>
          </div>
          <button type="button" class="ghost" data-cf="remove" style="margin-top:10px" title="Remove this cheque">✕ Remove Cheque</button>
        </div>
      `).join('');
      wrap.querySelectorAll('[data-cheque-row]').forEach(rowEl=>{
        const cid = rowEl.dataset.chequeRow;
        const row = chequeRows.find(c=>c.id===cid);
        rowEl.querySelectorAll('[data-cf]').forEach(inp=>{
          const field = inp.dataset.cf;
          if(field === 'remove'){
            inp.onclick = ()=>{ chequeRows = chequeRows.filter(c=>c.id!==cid); renderChequeRows(); updateTotalPreview(); };
          } else {
            if(field === 'bank') inp.value = row.bank || '';
            inp.addEventListener('input', ()=>{ row[field] = inp.value; updateTotalPreview(); });
          }
        });
      });
      // Called after the bank select's value is set above (its `selected` state isn't in the
      // template), same ordering reason as switchTab's own enhanceSelects call.
      enhanceSelects(wrap);
    };
    // Live total across Cash + Bank Transfer + all cheque rows, so the whole payment's
    // combined value is visible before saving — nothing here is auto-filled into a single
    // "Amount" field anymore, since the total is now genuinely a sum of separate parts.
    const updateTotalPreview = ()=>{
      const chequeTotal = chequeRows.reduce((s,c)=>s+(Number(c.amount)||0),0);
      const total = Number(v('r_cash')||0) + Number(v('r_bank')||0) + chequeTotal;
      document.getElementById('r_totalPreview').textContent = `Total: ${fmtRs2(total)}`;
    };
    const addChequeRow = ()=>{ chequeRows.push({id:uid(), amount:'', chequeNo:'', bank:'', owner:'', chequeDate:'', status:'Pending'}); renderChequeRows(); updateTotalPreview(); };
    document.getElementById('r_addChequeRow').onclick = addChequeRow;
    document.getElementById('r_cash').addEventListener('input', updateTotalPreview);
    document.getElementById('r_bank').addEventListener('input', updateTotalPreview);
    // Cash stays hidden until needed — clicking the button reveals it; clicking again
    // hides it and clears whatever was typed, so a hidden field never gets submitted.
    const rCashWrap = document.getElementById('r_cashWrap');
    const rCashBtn = document.getElementById('r_toggleCash');
    const showCash = ()=>{ rCashWrap.style.display = 'grid'; rCashBtn.textContent = '− Remove Cash'; };
    const hideCash = ()=>{ rCashWrap.style.display = 'none'; rCashBtn.textContent = '+ Add Cash'; document.getElementById('r_cash').value = ''; updateTotalPreview(); };
    rCashBtn.addEventListener('click', ()=>{ rCashWrap.style.display === 'none' ? showCash() : hideCash(); });
    updateTotalPreview();

    // "Does part of this payment replace a bounced cheque?" — one row per bounced cheque of the chosen
    // client. `replaceState` maps "recoveryId:chequeId" -> {on, amount}; it is rebuilt when the client
    // changes and filled from the record when a payment is edited.
    let replaceState = {};
    const editingPaymentId = ()=> (EDITING && EDITING.key==='recovery') ? EDITING.id : null;
    const renderReplaceRows = ()=>{
      const wrap = document.getElementById('r_replaceWrap');
      const rowsEl = document.getElementById('r_replaceRows');
      const client = v('r_client');
      const list = client ? replaceableCheques(client, editingPaymentId()) : [];
      if(!list.length){ wrap.hidden = true; rowsEl.innerHTML = ''; return; }
      wrap.hidden = false;
      rowsEl.innerHTML = list.map(c=>{
        const key = c.recoveryId + ':' + c.chequeId;
        const st = replaceState[key] || {on:false, amount:''};
        const label = ['Cheque' + (c.chequeNo ? ' No. ' + escHtml(c.chequeNo) : ''), c.owner ? escHtml(c.owner) : '', c.bank ? escHtml(c.bank) : '', fmtRs(c.amount), 'from ' + fmtDate(c.date)].filter(Boolean).join(' · ');
        const part = c.owed < c.amount - 0.005 ? `<div class="note" style="margin:2px 0 0 26px">${fmtRs(c.owed)} of it is still owed.</div>` : '';
        return `<div data-rep="${key}" style="margin-top:10px">
          <label style="display:flex;align-items:flex-start;gap:8px"><input type="checkbox" data-rep-on style="width:auto;margin:3px 0 0"${st.on ? ' checked' : ''}><span>${label}</span></label>${part}
          <div class="field" data-rep-amt-wrap style="margin:6px 0 0 26px"${st.on ? '' : ' hidden'}><label>How much of this payment replaces it (Rs)</label><input type="number" step="0.01" data-rep-amt value="${st.amount === '' ? '' : escHtml(String(st.amount))}"></div>
        </div>`;
      }).join('');
      rowsEl.querySelectorAll('[data-rep]').forEach(rowEl=>{
        const key = rowEl.dataset.rep;
        const item = list.find(c=> c.recoveryId + ':' + c.chequeId === key);
        const on = rowEl.querySelector('[data-rep-on]'), amtWrap = rowEl.querySelector('[data-rep-amt-wrap]'), amt = rowEl.querySelector('[data-rep-amt]');
        on.addEventListener('change', ()=>{
          const st = replaceState[key] = replaceState[key] || {on:false, amount:''};
          st.on = on.checked;
          amtWrap.hidden = !on.checked;
          if(on.checked && (st.amount === '' || st.amount == null)){ st.amount = String(item.owed); amt.value = st.amount; }
        });
        amt.addEventListener('input', ()=>{ (replaceState[key] = replaceState[key] || {on:true, amount:''}).amount = amt.value; });
      });
    };
    const clientSel = document.getElementById('r_client');
    clientSel.addEventListener('change', ()=>{ replaceState = {}; renderReplaceRows(); });
    renderReplaceRows();

    document.getElementById('addRecovery').onclick = async ()=>{
      if(!requireFields([
        [v('r_date'), 'Pick the date first.', 'r_date'],
        [v('r_client'), 'Pick a client first.', 'r_client'],
      ])) return;
      const cashAmount = Number(v('r_cash')||0);
      const bankAmount = Number(v('r_bank')||0);
      const validCheques = chequeRows.filter(c=>Number(c.amount)>0).map(c=>({id:c.id, amount:Number(c.amount), chequeNo:c.chequeNo||'', bank:c.bank||'', owner:c.owner||'', chequeDate:c.chequeDate||'', status:c.status||'Pending'}));
      const amount = cashAmount + bankAmount + validCheques.reduce((s,c)=>s+c.amount,0);
      // r_cash is hidden until "+ Add Cash" is tapped, so point at the Bank Transfer box, which is always there.
      if(!requireFields([[amount > 0, 'Enter a Cash Amount, Bank Transfer Amount, or at least one cheque before saving.', 'r_bank']])) return;
      const rec = {date:v('r_date'), time:v('r_time'), client:v('r_client'), amount, desc:v('r_desc'),
        cashAmount, bankAmount, cheques: validCheques};
      // Bounced cheques this payment replaces (only those still shown for this client are kept).
      const shown = new Set(replaceableCheques(rec.client, editingPaymentId()).map(c=>c.recoveryId + ':' + c.chequeId));
      const links = Object.keys(replaceState).filter(k=> replaceState[k].on && shown.has(k)).map(k=>{
        const [recoveryId, chequeId] = k.split(':');
        return {recoveryId, chequeId, amount: Number(replaceState[k].amount) || 0};
      });
      const problem = links.length ? checkReplacementLinks(editingPaymentId(), rec.client, amount, links) : null;
      if(!requireFields([[!problem, problem, 'r_replaceWrap']])) return;
      let ownId, oldLinks = [];
      if(EDITING && EDITING.key==='recovery'){
        const idx = DATA.recovery.findIndex(r=>r.id===EDITING.id);
        if(idx>-1){
          oldLinks = (Array.isArray(DATA.recovery[idx].replaces) ? DATA.recovery[idx].replaces : []).map(l=>({...l}));
          const merged = {...DATA.recovery[idx], ...rec};
          if(links.length) merged.replaces = links; else delete merged.replaces;
          DATA.recovery[idx] = merged;
          ownId = merged.id;
        }
        EDITING = null;
      } else {
        const fresh = {id:uid(), ...rec};
        if(links.length) fresh.replaces = links;
        DATA.recovery.push(fresh); PAGE.recovery = 1;
        ownId = fresh.id;
      }
      const changes = settleReplacementLinks(oldLinks, links, ownId);
      await save(); switchTab('recovery');
      const nowReplaced = changes.filter(c=>c.to==='Replaced').length, nowBounced = changes.filter(c=>c.to==='Bounced').length;
      if(nowReplaced) showToast(`${nowReplaced} bounced cheque${nowReplaced===1?'':'s'} now marked Replaced ✓`);
      else if(nowBounced) showToast(`${nowBounced} cheque${nowBounced===1?' is':'s are'} back on the Bounced list (no longer fully replaced).`, 5000);
    };
    wireEnterSubmit(['r_date','r_time','r_client','r_cash','r_bank'],'addRecovery');
    wireDelete('recovery');
    wireEditGeneric('recovery','addRecovery','cancelRecovery',
      {r_date:'date',r_time:'time',r_client:'client',r_cash:'cashAmount',r_bank:'bankAmount',r_desc:'desc'},
      ()=>{
        // Backward compatible: an old single-`method` entry gets normalized into the same
        // {cashAmount, bankAmount, cheques} shape before populating the form.
        const editingRec = DATA.recovery.find(r=>r.id===EDITING?.id);
        const parts = editingRec ? recoveryParts(editingRec) : {cashAmount:0, bankAmount:0, cheques:[]};
        document.getElementById('r_cash').value = parts.cashAmount || '';
        document.getElementById('r_bank').value = parts.bankAmount || '';
        if(parts.cashAmount) showCash(); else hideCash();
        chequeRows = parts.cheques.map(c=>({...c}));
        renderChequeRows();
        updateTotalPreview();
        replaceState = {};
        (editingRec && Array.isArray(editingRec.replaces) ? editingRec.replaces : []).forEach(l=>{ replaceState[l.recoveryId + ':' + l.chequeId] = {on:true, amount:String(l.amount)}; });
        renderReplaceRows();
      });
    // "Log replacement" on a Bounced cheque: open a fresh payment for that cheque's client with it ticked.
    if(PENDING_REPLACE){
      const want = PENDING_REPLACE; PENDING_REPLACE = null;
      const f = findCheque(want.recoveryId, want.chequeId);
      if(f){
        document.getElementById('r_client').value = f.rec.client;
        replaceState = {};
        replaceState[want.recoveryId + ':' + want.chequeId] = {on:true, amount:String(chequeStillOwed(want.recoveryId, want.chequeId))};
        renderReplaceRows();
        setTimeout(()=>{ const box = document.getElementById('r_client'); const card = box && box.closest('.card'); if(card) card.scrollIntoView({block:'start', behavior:'smooth'}); }, 80);
      }
    }
    const rfClient = document.getElementById('rf_client');
    rfClient.value = FILTER.recovery || '';
    rfClient.addEventListener('change', ()=>{
      FILTER.recovery = rfClient.value;
      PAGE.recovery = 1;
      switchTab('recovery');
    });
  }
  if(id==='expense'){
    document.getElementById('addExpense').onclick = async ()=>{
      if(!requireFields([
        [v('ex_date'), 'Pick the date first.', 'ex_date'],
        [Number(v('ex_amt')||0) > 0, 'Enter the amount first.', 'ex_amt'],
      ])) return;
      const rec = {date:v('ex_date'), time:v('ex_time'), category:v('ex_cat'), desc:v('ex_desc'), amount:Number(v('ex_amt')||0), paidTo:v('ex_to')};
      if(EDITING && EDITING.key==='expense'){
        const idx = DATA.expense.findIndex(r=>r.id===EDITING.id);
        if(idx>-1) DATA.expense[idx] = {...DATA.expense[idx], ...rec};
        EDITING = null;
      } else {
        DATA.expense.push({id:uid(), ...rec}); PAGE.expense = 1;
      }
      await save(); switchTab('expense');
    };
    wireEnterSubmit(['ex_date','ex_time','ex_cat','ex_amt','ex_to'],'addExpense');
    wireDelete('expense');
    wireEditGeneric('expense','addExpense','cancelExpense',
      {ex_date:'date',ex_time:'time',ex_cat:'category',ex_amt:'amount',ex_desc:'desc',ex_to:'paidTo'});
  }
  if(id==='family'){
    document.getElementById('addFamily').onclick = async ()=>{
      if(!requireFields([
        [v('f_date'), 'Pick the date first.', 'f_date'],
        [Number(v('f_amt')||0) > 0, 'Enter the amount first.', 'f_amt'],
      ])) return;
      const rec = {date:v('f_date'), time:v('f_time'), category:v('f_cat'), desc:v('f_desc'), amount:Number(v('f_amt')||0)};
      if(EDITING && EDITING.key==='family'){
        const idx = DATA.family.findIndex(r=>r.id===EDITING.id);
        if(idx>-1) DATA.family[idx] = {...DATA.family[idx], ...rec};
        EDITING = null;
      } else {
        DATA.family.push({id:uid(), ...rec}); PAGE.family = 1;
      }
      await save(); switchTab('family');
    };
    wireEnterSubmit(['f_date','f_time','f_cat','f_amt'],'addFamily');
    wireDelete('family');
    wireEditGeneric('family','addFamily','cancelFamily',{f_date:'date',f_time:'time',f_cat:'category',f_amt:'amount',f_desc:'desc'});
  }
  if(id==='warp'){
    document.getElementById('addWarp').onclick = async ()=>{
      const cartons=Number(v('w_cartons')||0), kgPerCarton=Number(v('w_kgPerCarton')||0);
      const lbs=Number(v('w_lbs')||0), rate=Number(v('w_rate')||0);
      if(!requireFields([
        [v('w_date'), 'Pick the date first.', 'w_date'],
        [lbs > 0, 'Enter the weight (lbs) — or cartons and kg per carton — first.', 'w_lbs'],
        [rate > 0, 'Enter the rate first.', 'w_rate'],
      ])) return;
      const rec = {date:v('w_date'), time:v('w_time'), type:v('w_type'), supplier:v('w_sup'), cartons, kgPerCarton, lbs, rate, amount: Math.floor(lbs*rate + 1e-6)};
      if(EDITING && EDITING.key==='warp'){
        const idx = DATA.warp.findIndex(r=>r.id===EDITING.id);
        if(idx>-1) DATA.warp[idx] = {...DATA.warp[idx], ...rec};
        EDITING = null;
      } else {
        DATA.warp.push({id:uid(), ...rec}); PAGE.warp = 1;
      }
      await save(); switchTab('warp');
    };
    wireCartonsToLbs('w_cartons','w_kgPerCarton','w_lbs','w_kgPreview');
    wireAmountPreview('w_lbs','w_rate','w_amtPreview','Amount',true);
    wireEnterSubmit(['w_date','w_time','w_type','w_sup','w_cartons','w_kgPerCarton','w_lbs','w_rate'],'addWarp');
    wireDelete('warp');
    wireEditGeneric('warp','addWarp','cancelWarp',
      {w_date:'date',w_time:'time',w_type:'type',w_sup:'supplier',w_cartons:'cartons',w_kgPerCarton:'kgPerCarton',w_lbs:'lbs',w_rate:'rate'},
      ()=>{
        const cartons = document.getElementById('w_cartons');
        // Dispatching on cartons (when present) also refreshes the kg-preview note and,
        // via wireCartonsToLbs, re-dispatches input on w_lbs to refresh the amount preview.
        if(cartons && cartons.value){ cartons.dispatchEvent(new Event('input')); }
        else { const el=document.getElementById('w_lbs'); if(el) el.dispatchEvent(new Event('input')); }
      });
  }
  if(id==='weft'){
    document.getElementById('addWeft').onclick = async ()=>{
      const bags=Number(v('wf_bags')||0), lbsPerBag=Number(v('wf_lbsPerBag')||0);
      const lbs=Number(v('wf_lbs')||0), rate=Number(v('wf_rate')||0);
      if(!requireFields([
        [v('wf_date'), 'Pick the date first.', 'wf_date'],
        [lbs > 0, 'Enter the weight — bags and lbs per bag — first.', 'wf_bags'],
        [rate > 0, 'Enter the rate first.', 'wf_rate'],
      ])) return;
      const rec = {date:v('wf_date'), time:v('wf_time'), type:v('wf_type'), supplier:v('wf_sup'), bags, lbsPerBag, lbs, rate, amount: lbs*rate};
      if(EDITING && EDITING.key==='weft'){
        const idx = DATA.weft.findIndex(r=>r.id===EDITING.id);
        if(idx>-1) DATA.weft[idx] = {...DATA.weft[idx], ...rec};
        EDITING = null;
      } else {
        DATA.weft.push({id:uid(), ...rec}); PAGE.weft = 1;
      }
      await save(); switchTab('weft');
    };
    wireBagsToLbs('wf_bags','wf_lbsPerBag','wf_lbs','wf_bagsPreview','wf_lbsLabel');
    wireAmountPreview('wf_lbs','wf_rate','wf_amtPreview');
    wireEnterSubmit(['wf_date','wf_time','wf_type','wf_sup','wf_bags','wf_lbsPerBag','wf_rate'],'addWeft');
    wireDelete('weft');
    wireEditGeneric('weft','addWeft','cancelWeft',
      {wf_date:'date',wf_time:'time',wf_type:'type',wf_sup:'supplier',wf_bags:'bags',wf_lbsPerBag:'lbsPerBag',wf_lbs:'lbs',wf_rate:'rate'},
      ()=>{
        const bags = document.getElementById('wf_bags');
        const lbsEl = document.getElementById('wf_lbs');
        const labelEl = document.getElementById('wf_lbsLabel');
        if(bags && bags.value){ bags.dispatchEvent(new Event('input')); }
        else {
          // Legacy entry with a saved weight but no bags/lbs-per-bag on file —
          // show its existing total as-is and still refresh the Amount preview.
          if(labelEl && lbsEl) labelEl.textContent = lbsEl.value ? fmtNum(Number(lbsEl.value)) : '—';
          if(lbsEl) lbsEl.dispatchEvent(new Event('input'));
        }
      });
  }
  if(id==='warpbeams'){
    document.getElementById('addWarpBeam').onclick = async ()=>{
      if(!requireFields([
        [v('wb_purchase'), 'Select the Source Purchase this warp beam came from before saving.', 'wb_purchase'],
        [v('wb_date'), 'Pick the date first.', 'wb_date'],
        [v('wb_loom'), 'Pick a loom first.', 'wb_loom'],
        [Number(v('wb_length')||0) > 0, 'Enter the beam length first.', 'wb_length'],
      ])) return;
      const rec = {date:v('wb_date'), time:v('wb_time'), loom:v('wb_loom'), warpType:v('wb_type'), length:Number(v('wb_length')||0), purchaseId:v('wb_purchase'), remarks:v('wb_rem')};
      if(EDITING && EDITING.key==='warpBeams'){
        const idx = DATA.warpBeams.findIndex(r=>r.id===EDITING.id);
        if(idx>-1) DATA.warpBeams[idx] = {...DATA.warpBeams[idx], ...rec};
        EDITING = null;
      } else {
        DATA.warpBeams.push({id:uid(), ...rec}); PAGE.warpBeams = 1;
      }
      await save(); switchTab('warpbeams');
    };
    wireEnterSubmit(['wb_date','wb_time','wb_loom','wb_type','wb_length'],'addWarpBeam');
    wireDelete('warpBeams');
    wireEditGeneric('warpBeams','addWarpBeam','cancelWarpbeams',
      {wb_date:'date',wb_time:'time',wb_loom:'loom',wb_type:'warpType',wb_length:'length',wb_purchase:'purchaseId',wb_rem:'remarks'});
    wireBeamFinishToggle();
    const wbaPurchase = document.getElementById('wba_purchase');
    if(wbaPurchase){
      wbaPurchase.addEventListener('change', ()=>{
        FILTER.warpBeamsActivePurchase = wbaPurchase.value;
        PAGE.warpBeams = 1;
        switchTab('warpbeams');
      });
    }
    const wbfPurchase = document.getElementById('wbf_purchase');
    if(wbfPurchase){
      wbfPurchase.addEventListener('change', ()=>{
        FILTER.warpBeamsFinishedPurchase = wbfPurchase.value;
        PAGE.warpBeamsFinished = 1;
        switchTab('warpbeams');
      });
    }
    const wbsPurchase = document.getElementById('wbs_purchase');
    if(wbsPurchase){
      wbsPurchase.addEventListener('change', ()=>{
        FILTER.warpBeamsSummaryPurchase = wbsPurchase.value;
        switchTab('warpbeams');
      });
    }
  }
  if(id==='wages'){
    const recalc = async (persist)=>{
      DATA.wageFrom = v('wg_from'); DATA.wageTo = v('wg_to');
      if(persist) await save();
      renderWages();
      const rateBody = document.getElementById('wg_rateRowsBody');
      if(rateBody) rateBody.innerHTML = qualityRateRowsHtml(v('wg_from'), v('wg_to')) || '<tr><td colspan="3" class="empty">Add qualities in the settings tab first</td></tr>';
    };
    document.getElementById('wg_from').addEventListener('change', ()=>{ recalc(true); fillWageAmount(); updateWagePaymentHelper(); });
    document.getElementById('wg_to').addEventListener('change', ()=>{ recalc(true); fillWageAmount(); updateWagePaymentHelper(); });
    const saveRateBtn = document.getElementById('saveRateChange');
    if(saveRateBtn) saveRateBtn.onclick = async ()=>{
      const quality = v('rc_quality');
      const rate = Number(v('rc_rate'));
      const date = v('rc_date') || todayStr();
      if(!requireFields([
        [quality, 'Pick a quality first.', 'rc_quality'],
        [v('rc_rate') !== '' && rate >= 0, 'Enter the new rate first (0 or more).', 'rc_rate'],
      ])) return;
      DATA.wageRateHistory = DATA.wageRateHistory || {};
      DATA.wageRateHistory[quality] = DATA.wageRateHistory[quality] || [];
      // Same effective date entered twice just overwrites that date's rate rather than
      // stacking duplicate history entries.
      const existing = DATA.wageRateHistory[quality].find(e=>e.date===date);
      if(existing) existing.rate = rate;
      else DATA.wageRateHistory[quality].push({date, rate});
      await save();
      renderWages();
      const rateBody = document.getElementById('wg_rateRowsBody');
      if(rateBody) rateBody.innerHTML = qualityRateRowsHtml(v('wg_from'), v('wg_to')) || '<tr><td colspan="3" class="empty">Add qualities in the settings tab first</td></tr>';
      const histWrap = document.getElementById('wg_rateHistoryWrap');
      if(histWrap){
        const rows = rateHistoryRowsHtml();
        histWrap.innerHTML = rows ? `<div class="group-label" style="margin-top:16px">Rate History</div>
      <table style="margin-top:6px"><thead><tr><th>Quality</th><th>Effective From</th><th>Rate (Rs/m)</th></tr></thead>
      <tbody>${rows}</tbody></table>` : '';
      }
    };
    renderWages();

    const obBtn = document.getElementById('saveOpeningBalances');
    if(obBtn){
      obBtn.onclick = async ()=>{
        const date = v('ob_date') || todayStr();
        document.querySelectorAll('[data-ob-emp]').forEach(inp=>{
          DATA.wageSettlements.push({id:uid(), date, employee:inp.dataset.obEmp, carryForward:Number(inp.value||0), remarks:'Opening balance'});
        });
        await save(); switchTab('wages');
      };
    }

    const saBtn = document.getElementById('settleAllEmployees');
    if(saBtn){
      saBtn.onclick = async ()=>{
        const date = v('sa_date') || todayStr();
        document.querySelectorAll('[data-sa-emp]').forEach(inp=>{
          DATA.wageSettlements.push({id:uid(), date, employee:inp.dataset.saEmp, carryForward:Number(inp.value||0), remarks:'Bulk settlement'});
        });
        await save(); switchTab('wages');
      };
    }

    document.getElementById('addWageBonus').onclick = async ()=>{
      if(!requireFields([
        [v('wb_date'), 'Pick the date first.', 'wb_date'],
        [v('wb_emp'), 'Pick an employee first.', 'wb_emp'],
        [Number(v('wb_amt')||0) > 0, 'Enter the amount first.', 'wb_amt'],
      ])) return;
      const rec = {date:v('wb_date'), employee:v('wb_emp'), amount:Number(v('wb_amt')||0), remarks:v('wb_rem')};
      if(EDITING && EDITING.key==='wageBonuses'){
        const idx = DATA.wageBonuses.findIndex(r=>r.id===EDITING.id);
        if(idx>-1) DATA.wageBonuses[idx] = {...DATA.wageBonuses[idx], ...rec};
        EDITING = null;
      } else {
        DATA.wageBonuses.push({id:uid(), ...rec}); PAGE.wageBonuses = 1;
      }
      await save(); switchTab('wages');
    };
    wireEnterSubmit(['wb_date','wb_emp','wb_amt'],'addWageBonus');
    wireDelete('wageBonuses');
    wireEditGeneric('wageBonuses','addWageBonus','cancelWageBonuses',{wb_date:'date',wb_emp:'employee',wb_amt:'amount',wb_rem:'remarks'});

    document.getElementById('addWagePayment').onclick = async ()=>{
      if(!requireFields([
        [v('wp_date'), 'Pick the date first.', 'wp_date'],
        [v('wp_emp'), 'Pick an employee first.', 'wp_emp'],
        [Number(v('wp_amt')||0) > 0, 'Enter the amount first.', 'wp_amt'],
      ])) return;
      const rec = {date:v('wp_date'), employee:v('wp_emp'), amount:Number(v('wp_amt')||0), remarks:v('wp_rem')};
      if(EDITING && EDITING.key==='wagePayments'){
        const idx = DATA.wagePayments.findIndex(r=>r.id===EDITING.id);
        if(idx>-1) DATA.wagePayments[idx] = {...DATA.wagePayments[idx], ...rec};
        EDITING = null;
      } else {
        DATA.wagePayments.push({id:uid(), ...rec}); PAGE.wagePayments = 1;
      }
      await save(); switchTab('wages');
    };
    // Suggests what's actually still due for the selected Wage Period (the From/To dates at
    // the top of the page): wages+bonus earned in that range, MINUS whatever's already been
    // paid with a date inside that same range (computeEmployeeWageNetForPeriod). So once an
    // employee has been paid in full for a period, this shows 0 — and if a rate is later
    // changed for a date inside that period, Earned recomputes with the new rate while what
    // was already paid stays put, so this correctly re-shows just the extra amount now due,
    // never the full new total and never a blank/negative figure. Ignores carryForward from
    // Settle Employee on purpose — that's a separate running balance, not this period's own
    // figure. Also skipped while editing an existing payment, so its saved amount stays
    // untouched, and recalculates automatically whenever the Wage Period dates change.
    const fillWageAmount = ()=>{
      if(EDITING) return;
      const emp = v('wp_emp');
      const amtEl = document.getElementById('wp_amt');
      if(!amtEl) return;
      if(!emp){ amtEl.value = ''; return; }
      const {net} = computeEmployeeWageNetForPeriod(emp, v('wg_from')||null, v('wg_to')||null);
      amtEl.value = net > 0.004 ? (Math.round(net*100)/100) : '';
    };
    // Live helper text: compares the typed amount against what's still due for the selected
    // Wage Period (earned minus already paid in that same range), plus a note if the employee
    // currently has a credit (paid ahead) balance, so nothing is hidden.
    const updateWagePaymentHelper = ()=>{
      const emp = v('wp_emp');
      const helperEl = document.getElementById('wp_helper');
      if(!helperEl) return;
      if(!emp){ helperEl.textContent = ''; return; }
      const {earned, paid, net: stillDue} = computeEmployeeWageNetForPeriod(emp, v('wg_from')||null, v('wg_to')||null);
      const amt = Number(v('wp_amt')||0);
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
      const b = computeEmployeeWageBalance(emp);
      if(b.balance < -0.004){
        msg += (msg ? ' ' : '') + `They also have a credit of ${fmtRs2(Math.abs(b.balance))} from being paid ahead of wages earned.`;
      }
      helperEl.textContent = msg;
    };
    document.getElementById('wp_emp').addEventListener('change', ()=>{ fillWageAmount(); updateWagePaymentHelper(); });
    document.getElementById('wp_amt').addEventListener('input', updateWagePaymentHelper);
    updateWagePaymentHelper();
    wireEnterSubmit(['wp_date','wp_emp','wp_amt'],'addWagePayment');
    wireDelete('wagePayments');
    wireEditGeneric('wagePayments','addWagePayment','cancelWagePayments',{wp_date:'date',wp_emp:'employee',wp_amt:'amount',wp_rem:'remarks'},
      updateWagePaymentHelper);

    document.getElementById('addWageSettlement').onclick = async ()=>{
      if(!requireFields([
        [v('ws_date'), 'Pick the date first.', 'ws_date'],
        [v('ws_emp'), 'Pick an employee first.', 'ws_emp'],
      ])) return;
      const rec = {date:v('ws_date'), employee:v('ws_emp'), carryForward:Number(v('ws_carry')||0), remarks:v('ws_rem')};
      if(EDITING && EDITING.key==='wageSettlements'){
        const idx = DATA.wageSettlements.findIndex(r=>r.id===EDITING.id);
        if(idx>-1) DATA.wageSettlements[idx] = {...DATA.wageSettlements[idx], ...rec};
        EDITING = null;
      } else {
        DATA.wageSettlements.push({id:uid(), ...rec}); PAGE.wageSettlements = 1;
      }
      await save(); switchTab('wages');
    };
    const fillCarrySuggestion = ()=>{
      const emp = v('ws_emp');
      const carryEl = document.getElementById('ws_carry');
      if(!carryEl) return;
      if(!emp){ carryEl.value = '0'; return; }
      const b = computeEmployeeWageBalance(emp);
      carryEl.value = (Math.round(b.balance*100)/100);
    };
    document.getElementById('ws_emp').addEventListener('change', fillCarrySuggestion);
    fillCarrySuggestion();
    wireEnterSubmit(['ws_emp','ws_date','ws_carry'],'addWageSettlement');
    wireDelete('wageSettlements');
    wireEditGeneric('wageSettlements','addWageSettlement','cancelWageSettlements',{ws_date:'date',ws_emp:'employee',ws_carry:'carryForward',ws_rem:'remarks'});
  }
  if(id==='loans'){
    document.getElementById('addLoanPayment').onclick = async ()=>{
      if(!requireFields([
        [v('lp_date'), 'Pick the date first.', 'lp_date'],
        [v('lp_emp'), 'Pick an employee first.', 'lp_emp'],
        [Number(v('lp_amt')||0) > 0, 'Enter the amount first.', 'lp_amt'],
      ])) return;
      const rec = {date:v('lp_date'), employee:v('lp_emp'), amount:Number(v('lp_amt')||0), type:v('lp_type'), remarks:v('lp_rem')};
      if(EDITING && EDITING.key==='loanPayments'){
        const idx = DATA.loanPayments.findIndex(r=>r.id===EDITING.id);
        if(idx>-1) DATA.loanPayments[idx] = {...DATA.loanPayments[idx], ...rec};
        EDITING = null;
      } else {
        DATA.loanPayments.push({id:uid(), ...rec}); PAGE.loanPayments = 1;
      }
      await save(); switchTab('loans');
    };
    // Live helper text: for Loan Given, shows what the running balance becomes; for Loan
    // Repaid, shows whether it clears the loan or leaves some still outstanding.
    const updateLoanHelper = ()=>{
      const emp = v('lp_emp');
      const helperEl = document.getElementById('lp_helper');
      if(!helperEl) return;
      if(!emp){ helperEl.textContent = ''; return; }
      const b = computeEmployeeLoanBalance(emp);
      const amt = Number(v('lp_amt')||0);
      const type = v('lp_type');
      if(type === 'Loan Repaid'){
        if(amt <= 0){ helperEl.textContent = b.balance > 0.004 ? `Currently ${fmtRs2(b.balance)} outstanding.` : ''; return; }
        const after = b.balance - amt;
        helperEl.textContent = after <= 0.004
          ? `This clears the loan${after < -0.004 ? `, with ${fmtRs2(Math.abs(after))} extra paid back` : ''}.`
          : `Reduces the loan to ${fmtRs2(after)} still outstanding.`;
        return;
      }
      if(amt <= 0){ helperEl.textContent = b.balance > 0.004 ? `Currently ${fmtRs2(b.balance)} outstanding.` : ''; return; }
      const after = b.balance + amt;
      helperEl.textContent = `This brings the loan outstanding to ${fmtRs2(after)}.`;
    };
    document.getElementById('lp_emp').addEventListener('change', updateLoanHelper);
    document.getElementById('lp_amt').addEventListener('input', updateLoanHelper);
    document.getElementById('lp_type').addEventListener('change', updateLoanHelper);
    updateLoanHelper();
    wireEnterSubmit(['lp_date','lp_emp','lp_amt'],'addLoanPayment');
    wireDelete('loanPayments');
    wireEditGeneric('loanPayments','addLoanPayment','cancelLoanPayments',{lp_date:'date',lp_emp:'employee',lp_amt:'amount',lp_type:'type',lp_rem:'remarks'},
      updateLoanHelper);
  }
  if(id==='ratecalc'){
    const wireRateCalcButtons = ()=>{
      const saveBtn = document.getElementById('saveRateCalc');
      if(saveBtn) saveBtn.onclick = async ()=>{
        const inp = readRateCalcInputs();
        const r = computeGreyRate(inp);
        DATA.rateCalcDefaults = { pickRate: inp.pickRate, widthAdd: inp.widthAdd };
        if(EDITING && EDITING.key==='rateCalcs'){
          const idx = DATA.rateCalcs.findIndex(x=>x.id===EDITING.id);
          if(idx>-1) DATA.rateCalcs[idx] = {...DATA.rateCalcs[idx], ...inp, ...r};
          EDITING = null;
        } else {
          DATA.rateCalcs.push({id:uid(), date: todayStr(), ...inp, ...r}); PAGE.rateCalcs = 1;
        }
        await save(); switchTab('ratecalc');
      };
      const cancelBtn = document.getElementById('cancelRateCalc');
      if(cancelBtn) cancelBtn.onclick = ()=>{ EDITING = null; switchTab('ratecalc'); };
    };
    const recalc = ()=>{ renderRateCalcResult(); wireRateCalcButtons(); };
    ['rc_label','rc_thread','rc_width','rc_widthAdd','rc_warpCount','rc_warpRate','rc_picks','rc_weftCount','rc_weftRate','rc_pickRate','rc_extra'].forEach(fid=>{
      const el = document.getElementById(fid);
      if(el) el.addEventListener('input', recalc);
    });
    recalc();
    wireDelete('rateCalcs');
    wireEditGeneric('rateCalcs','saveRateCalc','cancelRateCalc',
      {rc_label:'label', rc_thread:'thread', rc_width:'width', rc_widthAdd:'widthAdd', rc_warpCount:'warpCount', rc_warpRate:'warpRate',
       rc_picks:'picks', rc_weftCount:'weftCount', rc_weftRate:'weftRate', rc_pickRate:'pickRate', rc_extra:'extra'},
      recalc);
  }
  if(id==='checkpoints'){
    document.getElementById('saveOpening').onclick = async ()=>{
      DATA.openingBalance = Number(v('ob')||0); await save(); switchTab('checkpoints');
    };
    wireEnterSubmit(['ob'],'saveOpening');
    document.getElementById('addCheckpoint').onclick = async ()=>{
      if(!requireFields([
        [v('cp_date'), 'Pick the date first.', 'cp_date'],
        [v('cp_bal') !== '', 'Enter the cash balance first (0 is fine).', 'cp_bal'],
      ])) return;
      const rec = {date:v('cp_date'), time:v('cp_time'), balance:Number(v('cp_bal')||0), remarks:v('cp_rem')};
      if(EDITING && EDITING.key==='checkpoints'){
        const idx = DATA.checkpoints.findIndex(r=>r.id===EDITING.id);
        if(idx>-1) DATA.checkpoints[idx] = {...DATA.checkpoints[idx], ...rec};
        EDITING = null;
      } else {
        DATA.checkpoints.push({id:uid(), ...rec}); PAGE.checkpoints = 1;
      }
      await save(); switchTab('checkpoints');
    };
    wireEnterSubmit(['cp_date','cp_time','cp_bal'],'addCheckpoint');
    wireDelete('checkpoints');
    wireEditGeneric('checkpoints','addCheckpoint','cancelCheckpoints',{cp_date:'date',cp_time:'time',cp_bal:'balance',cp_rem:'remarks'});
  }
  if(id==='graphs'){
    const fromSel = document.getElementById('graphsFrom');
    const toSel = document.getElementById('graphsTo');
    const graphsCustom = document.getElementById('graphs_custom');
    const graphsChips = Array.from(document.querySelectorAll('#graphs_chips .chip'));
    const setGraphsActiveChip = (val)=> graphsChips.forEach(c=> c.classList.toggle('active', c.dataset.range === val));
    if(fromSel) fromSel.addEventListener('change', ()=>{ FILTER.graphsFrom = fromSel.value; setGraphsActiveChip('custom'); switchTab('graphs'); });
    if(toSel) toSel.addEventListener('change', ()=>{ FILTER.graphsTo = toSel.value; setGraphsActiveChip('custom'); switchTab('graphs'); });
    graphsChips.forEach(chip=>{
      chip.onclick = ()=>{
        const val = chip.dataset.range;
        if(val === 'custom'){ graphsCustom.hidden = false; setGraphsActiveChip('custom'); return; }
        graphsCustom.hidden = true;
        FILTER.graphsRange = val; FILTER.graphsFrom = ''; FILTER.graphsTo = '';
        setGraphsActiveChip(val);
        switchTab('graphs');
      };
    });
  }
  if(id==='backup'){
    autoBackupWire();
    const backupStatus = (msg)=>{ const el=document.getElementById('backupStatus'); if(el) el.textContent = msg; };
    // Tries the real clipboard API first; if that's blocked (common in sandboxed/embedded
    // views), falls back to a hidden textarea + execCommand('copy'), which still copies
    // automatically — no manual Ctrl/Cmd+C required. Only if BOTH fail do we give up on
    // auto-copy and just select the text in the Restore box for a manual copy.
    async function copyTextRobust(text){
      try{
        if(navigator.clipboard && navigator.clipboard.writeText){
          await navigator.clipboard.writeText(text);
          return true;
        }
      }catch(e){ /* fall through to execCommand fallback */ }
      try{
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if(ok) return true;
      }catch(e){ /* fall through */ }
      return false;
    }
    // ---- password protection (optional) ----
    const encBox = document.getElementById('bk_encrypt'), encFields = document.getElementById('bk_encFields');
    if(encBox) encBox.onchange = ()=>{
      if(encFields) encFields.hidden = !encBox.checked;
      if(encBox.checked){ const pw = document.getElementById('bk_pw'); if(pw) pw.focus(); }
    };
    // null = no password wanted; a function = encrypt with the typed password; false = password wanted but missing/too short.
    function backupEncryptor(){
      if(!encBox || !encBox.checked) return null;
      const pw = (document.getElementById('bk_pw') || {}).value || '';
      if(pw.length < 6){ backupStatus('Password protection is ticked — type a password of at least 6 characters, or untick it.'); return false; }
      return (text)=> encryptBackupText(text, pw);
    }
    // mode: 'compressed' | 'plain'. Returns {payload, note, suffix}, or null when a status message already explained why not.
    async function buildBackupPayload(mode){
      const enc = backupEncryptor();
      if(enc === false) return null;
      const rawJson = JSON.stringify(DATA);
      let payload = rawJson, note = `${rawJson.length.toLocaleString()} chars`, suffix = mode === 'plain' ? '-plain' : '';
      if(mode === 'compressed'){
        const compressed = await gzipToBase64(rawJson);
        if(compressed && compressed.length < rawJson.length){
          payload = BACKUP_GZ_PREFIX + compressed;
          note = `${payload.length.toLocaleString()} chars, compressed from ${rawJson.length.toLocaleString()}`;
          suffix = '-compressed';
        }
      } else note += ', uncompressed';
      if(enc){
        try{ payload = await enc(payload); }
        catch(e){ backupStatus('Could not encrypt here — untick password protection, or try another browser.'); return null; }
        note += ', password-protected'; suffix += '-protected';
      }
      return {payload, note, suffix};
    }
    async function doCopy(mode){
      const b = await buildBackupPayload(mode);
      if(!b) return;
      const ok = await copyTextRobust(b.payload);
      if(ok){
        recordBackupTaken();
        backupStatus(`Copied to clipboard ✓ (${b.note}) — ` + new Date().toLocaleString());
      }else{
        const ta = document.getElementById('restoreJsonInput');
        ta.value = b.payload;
        ta.focus(); ta.select();
        backupStatus(`Clipboard blocked — text is selected in the box below (${b.note}), press Ctrl/Cmd+C to copy.`);
      }
    }
    async function doDownload(mode){
      const b = await buildBackupPayload(mode);
      if(!b) return;
      const url = URL.createObjectURL(new Blob([b.payload], {type:'text/plain'}));
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFileName(b.suffix);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=> URL.revokeObjectURL(url), 5000);
      recordBackupTaken();
      backupStatus(`Download started ✓ (${b.note}) — ` + new Date().toLocaleString());
    }
    document.getElementById('copyJsonBtn').onclick = ()=> doCopy('compressed');
    document.getElementById('copyPlainJsonBtn').onclick = ()=> doCopy('plain');
    document.getElementById('downloadJsonBtn').onclick = ()=> doDownload('compressed');
    document.getElementById('downloadPlainJsonBtn').onclick = ()=> doDownload('plain');
    const shareBackupBtn = document.getElementById('shareBackupBtn');
    if(shareBackupBtn) shareBackupBtn.onclick = async ()=>{
      try{
        const b = await buildBackupPayload('compressed');
        if(!b) return;
        const file = new File([b.payload], backupFileName(b.suffix), {type:'text/plain'});
        if(!navigator.canShare({files:[file]})){
          backupStatus('Sharing files isn\'t supported here — use Copy or Download instead.');
          return;
        }
        await navigator.share({files:[file], title:'Ibrahim Weaving Backup', text:`Ibrahim Weaving backup — ${fmtDate(todayStr())}`});
        recordBackupTaken();
        backupStatus(`Shared ✓ — ` + new Date().toLocaleString());
      }catch(e){
        // AbortError just means the user closed the share sheet without picking anything —
        // not a real failure, so don't show an error for that one.
        if(e && e.name === 'AbortError') return;
        backupStatus('Could not open the share sheet — use Copy or Download instead.');
      }
    };
    const restoreFileInput = document.getElementById('restoreJsonFile');
    if(restoreFileInput) restoreFileInput.onchange = ()=>{
      const file = restoreFileInput.files && restoreFileInput.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = ()=>{
        const ta = document.getElementById('restoreJsonInput');
        if(ta) ta.value = String(reader.result || '').trim();
        showRestorePw();
        backupStatus(`Loaded "${file.name}" (${file.size.toLocaleString()} bytes) — review below, then press Restore.`);
      };
      reader.onerror = ()=>{ backupStatus(`Could not read "${file.name}" — try choosing it again.`); };
      reader.readAsText(file);
    };
    const restoreBtn = document.getElementById('restoreJsonBtn');
    const restorePwWrap = document.getElementById('restorePwWrap');
    // The password box only appears once the loaded/pasted text is a password-protected backup.
    function showRestorePw(){
      const ta = document.getElementById('restoreJsonInput');
      if(restorePwWrap && ta) restorePwWrap.hidden = !ta.value.trim().startsWith(BACKUP_ENC_PREFIX);
    }
    const restoreTa = document.getElementById('restoreJsonInput');
    if(restoreTa) restoreTa.addEventListener('input', showRestorePw);
    function disarmRestore(){
      clearTimeout(restoreBtn._disarmTimer);
      delete restoreBtn.dataset.armed;
      restoreBtn.textContent = 'Restore from Backup';
      restoreBtn.style.background = '';
      restoreBtn.style.color = '';
      restoreBtn.style.borderColor = '';
    }
    // Step 1 (first tap): decode + validate the backup and show what's in it next to what's there now.
    // Step 2 (second tap, within 12s): keep a safety copy of the current data, then replace it.
    restoreBtn.onclick = async ()=>{
      const raw = v('restoreJsonInput').trim();
      if(!raw){ backupStatus('Paste a JSON backup first.'); return; }
      let parsed;
      try{ parsed = await decodeBackupText(raw, (document.getElementById('restorePw') || {}).value || ''); }
      catch(err){
        if(err && err.code === 'needs-password' && restorePwWrap) restorePwWrap.hidden = false;
        disarmRestore();
        backupStatus(backupErrorMessage(err));
        return;
      }
      const check = validateBackupData(parsed);
      if(!check.ok){ disarmRestore(); backupStatus(check.problem); return; }
      if(!restoreBtn.dataset.armed){
        const cur = backupCounts(DATA);
        let msg = `This backup has ${countsText(check.counts)}. Your data right now has ${countsText(cur)}.`;
        if(totalEntries(check.counts) < totalEntries(cur)) msg = '⚠ This backup has FEWER entries than you have now. ' + msg;
        msg += window.indexedDB
          ? ' Tap the red button again to replace ALL current data (a safety copy of the current data is kept first).'
          : ' Tap the red button again to replace ALL current data — this browser can\'t keep a safety copy, so take a backup first if unsure.';
        backupStatus(msg);
        restoreBtn.dataset.armed = '1';
        restoreBtn.textContent = 'Tap again to confirm — replaces ALL data';
        // Pin background explicitly too, not just text/border color — otherwise the
        // .ghost:hover rule (blue background) can still win on hover/touch, leaving
        // red text unreadable against it.
        restoreBtn.style.background = 'var(--red)';
        restoreBtn.style.color = '#fff';
        restoreBtn.style.borderColor = 'var(--red)';
        restoreBtn._disarmTimer = setTimeout(disarmRestore, 12000);
        return;
      }
      clearTimeout(restoreBtn._disarmTimer);
      try{ await snapAdd('before-restore', JSON.stringify(DATA)); }catch(e){ /* best effort — see the message shown at step 1 */ }
      DATA = parsed;
      EDITING = null;
      await ensureDataDefaults();
      UNDO_SUPPRESS = true; UNDO_STACK.length = 0; updateUndoButton();
      await save();
      switchTab('backup');
      showToast('Backup restored ✓');
    };

    // ---- Safety copies list ----
    const snapListEl = document.getElementById('snapList');
    const snapStatus = (msg)=>{ const el = document.getElementById('snapStatus'); if(el) el.textContent = msg; };
    async function renderSnapList(){
      if(!snapListEl) return;
      let list;
      try{ list = await snapList(); }
      catch(e){ snapListEl.innerHTML = '<div class="empty">Safety copies aren\'t available in this browser.</div>'; return; }
      if(!list.length){ snapListEl.innerHTML = '<div class="empty">None yet — one is taken automatically about once a day.</div>'; return; }
      snapListEl.innerHTML = '<div class="log-scroll">' + table(['Saved','Type','Contents',''], list.map(c=>[
        escHtml(new Date(c.at).toLocaleString(undefined, {day:'numeric', month:'short', hour:'numeric', minute:'2-digit'})),
        escHtml(SNAP_LABEL[c.reason] || c.reason),
        escHtml(c.counts ? `${c.counts.sales.toLocaleString()} sales · ${c.counts.recoveries.toLocaleString()} recoveries` : '—'),
        `<button type="button" class="ghost" data-snap-restore="${c.id}" style="margin:0;padding:6px 10px">Restore</button>`
      ])) + '</div>';
      snapListEl.querySelectorAll('[data-snap-restore]').forEach(btn=>{
        btn.onclick = async ()=>{
          if(!btn.dataset.armed){
            btn.dataset.armed = '1';
            btn.textContent = 'Tap again';
            btn.style.color = 'var(--red)'; btn.style.borderColor = 'var(--red)';
            snapStatus('Tap "Tap again" to replace ALL current data with this safety copy (your current data is kept as a new safety copy first).');
            btn._t = setTimeout(()=>{ delete btn.dataset.armed; btn.textContent = 'Restore'; btn.style.color = ''; btn.style.borderColor = ''; }, 6000);
            return;
          }
          clearTimeout(btn._t);
          try{
            const rec = await snapGet(Number(btn.dataset.snapRestore));
            const parsed = rec && JSON.parse(await snapText(rec));
            const check = validateBackupData(parsed);
            if(!check.ok){ snapStatus('That safety copy could not be read: ' + check.problem); return; }
            await snapAdd('before-restore', JSON.stringify(DATA));
            DATA = parsed;
            EDITING = null;
            await ensureDataDefaults();
            UNDO_SUPPRESS = true; UNDO_STACK.length = 0; updateUndoButton();
            await save();
            switchTab('backup');
            showToast('Restored from safety copy ✓');
          }catch(e){ snapStatus('Could not restore that safety copy.'); }
        };
      });
    }
    const snapNowBtn = document.getElementById('snapNowBtn');
    if(snapNowBtn) snapNowBtn.onclick = async ()=>{
      try{ await snapAdd('manual', JSON.stringify(DATA)); snapStatus('Safety copy saved ✓'); renderSnapList(); }
      catch(e){ snapStatus('Could not save a safety copy in this browser.'); }
    };
    renderSnapList();
  }
  if(id==='settings'){
    const darkToggle = document.getElementById('darkModeToggle');
    if(darkToggle) darkToggle.addEventListener('change', ()=>{
      const dark = darkToggle.checked;
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#0B0D0F' : '#163B3D');
      try{ localStorage.setItem('khata-theme', dark ? 'dark' : 'light'); }catch(e){}
    });
    const logCardsToggle = document.getElementById('logCardsToggle');
    if(logCardsToggle) logCardsToggle.addEventListener('change', ()=>{
      if(logCardsToggle.checked) document.documentElement.removeAttribute('data-logs');
      else document.documentElement.setAttribute('data-logs', 'table');
      try{ localStorage.setItem('khata-logs', logCardsToggle.checked ? 'cards' : 'table'); }catch(e){}
    });
    const saveBizBtn = document.getElementById('saveBusinessInfo');
    if(saveBizBtn) saveBizBtn.onclick = async ()=>{
      DATA.businessInfo = {name: v('biz_name'), address: v('biz_address'), phone: v('biz_phone')};
      await save();
      switchTab('settings');
    };
    // PIN Lock — not-yet-enabled form: validates the new PIN pair, then turns the lock on.
    const pinEnableBtn = document.getElementById('pinEnableBtn');
    if(pinEnableBtn) pinEnableBtn.onclick = async ()=>{
      const pin1 = v('pin_new1'), pin2 = v('pin_new2');
      const errEl = document.getElementById('pinSetupError');
      const fail = (msg)=>{ if(errEl) errEl.textContent = msg; };
      const wantLen = Number(v('pin_len')) || 6;
      if(!new RegExp(`^\\d{${wantLen}}$`).test(pin1)) return fail(`PIN must be exactly ${wantLen} digits.`);
      if(pin1 !== pin2) return fail('PINs do not match.');
      const recQ = v('pin_q'), recA1 = v('pin_a1'), recA2 = v('pin_a2');
      const recErr = validateRecoveryInput(recQ, recA1, recA2);
      if(recErr) return fail(recErr);
      await setRecovery(recQ, recA1); // recovery first: the lock only turns on once the PIN hash exists
      await setPin(pin1);
      switchTab('settings');
    };
    // PIN Lock — already-enabled state: toggle the Change / Disable sub-forms.
    // Change PIN / Disable / Recovery Question: only one sub-form open at a time.
    const pinWraps = ['pinChangeWrap','pinDisableWrap','pinRecWrap'];
    const pinToggle = (btnId, wrapId)=>{
      const btn = document.getElementById(btnId);
      if(!btn) return;
      btn.onclick = ()=>{
        pinWraps.forEach(id=>{
          const w = document.getElementById(id);
          if(!w) return;
          w.style.display = (id===wrapId && w.style.display==='none') ? 'block' : 'none';
        });
      };
    };
    const pinLockNowBtn = document.getElementById('pinLockNowBtn');
    if(pinLockNowBtn) pinLockNowBtn.onclick = ()=>{
      try{ localStorage.setItem(PIN_LAST_ACTIVE_KEY, '0'); }catch(e){ /* best effort only */ }
      mountLockScreen();
    };
    pinToggle('pinShowChange','pinChangeWrap');
    pinToggle('pinShowDisable','pinDisableWrap');
    pinToggle('pinShowRec','pinRecWrap');
    const pinChangeSaveBtn = document.getElementById('pinChangeSaveBtn');
    if(pinChangeSaveBtn) pinChangeSaveBtn.onclick = async ()=>{
      const errEl = document.getElementById('pinChangeError');
      const fail = (msg)=>{ if(errEl) errEl.textContent = msg; };
      const cur = v('pin_cur'), n1 = v('pin_change_new1'), n2 = v('pin_change_new2');
      if(!(await checkPin(cur))) return fail('Current PIN is incorrect.');
      const wantLen = Number(v('pin_change_len')) || PIN_LENGTH;
      if(!new RegExp(`^\\d{${wantLen}}$`).test(n1)) return fail(`New PIN must be exactly ${wantLen} digits.`);
      if(n1 !== n2) return fail('New PINs do not match.');
      await setPin(n1);
      switchTab('settings');
    };
    const pinRecSaveBtn = document.getElementById('pinRecSaveBtn');
    if(pinRecSaveBtn) pinRecSaveBtn.onclick = async ()=>{
      const errEl = document.getElementById('pinRecError');
      const fail = (msg)=>{ if(errEl) errEl.textContent = msg; };
      if(!(await checkPin(v('pin_rec_cur')))) return fail('Current PIN is incorrect.');
      const q = v('pin_rec_q'), a1 = v('pin_rec_a1'), a2 = v('pin_rec_a2');
      const err = validateRecoveryInput(q, a1, a2);
      if(err) return fail(err);
      await setRecovery(q, a1);
      switchTab('settings');
    };
    wireEncryptionCard();
    wireBeamAlertSettings();
    const pinDisableSaveBtn = document.getElementById('pinDisableSaveBtn');
    if(pinDisableSaveBtn) pinDisableSaveBtn.onclick = async ()=>{
      const errEl = document.getElementById('pinDisableError');
      const cur = v('pin_disable_cur');
      if(!(await checkPin(cur))){ if(errEl) errEl.textContent = 'Current PIN is incorrect.'; return; }
      if(encEnabled()){ if(errEl) errEl.textContent = 'Turn off Encrypt Data (below) first — disabling the PIN would leave the data unprotected.'; return; }
      disablePin();
      switchTab('settings');
    };
    ['qualities','clients','employees','looms','warpTypes','weftTypes','dyeingUnits','banks'].forEach(key=>{
      document.querySelector(`[data-add="${key}"]`).onclick = async ()=>{
        const name = normalizeMasterName(v(`new_${key}`));
        if(!name) return;
        const editingRec = (EDITING && EDITING.key===key) ? DATA[key].find(r=>r.id===EDITING.id) : null;
        const clash = DATA[key].find(r=> r !== editingRec && masterNameKey(r.name) === masterNameKey(name));
        if(clash){ showToast(`"${name}" is already in this list.`, 5000); return; }
        if(editingRec){
          const oldName = editingRec.name;
          editingRec.name = name;
          const changed = (oldName !== name) ? cascadeMasterRename(key, oldName, name) : 0;
          EDITING = null;
          NEXT_UNDO_LABEL = `Renamed "${oldName}" to "${name}"` + (changed ? ` (${changed} record${changed===1?'':'s'} updated)` : '');
          await save(); switchTab('settings');
          return;
        }
        DATA[key].push({id:uid(), name});
        await save(); switchTab('settings');
      };
      const inp = document.getElementById(`new_${key}`);
      if(inp) inp.addEventListener('keydown', e=>{
        if(e.key==='Enter'){ e.preventDefault(); document.querySelector(`[data-add="${key}"]`).click(); }
      });
      wireEditGeneric(key, `add_${key}`, `cancel_${key}`, {[`new_${key}`]:'name'});
    });
    wireDelete('qualities'); wireDelete('clients'); wireDelete('employees'); wireDelete('looms'); wireDelete('warpTypes'); wireDelete('weftTypes'); wireDelete('dyeingUnits'); wireDelete('banks');
    document.querySelectorAll('[data-move]').forEach(btn=>{
      btn.onclick = async ()=>{
        const [key, idxStr, dir] = btn.dataset.move.split(':');
        const idx = Number(idxStr);
        const swapWith = dir === 'up' ? idx - 1 : idx + 1;
        if(swapWith < 0 || swapWith >= DATA[key].length) return;
        const list = DATA[key];
        [list[idx], list[swapWith]] = [list[swapWith], list[idx]];
        await save(); switchTab('settings');
      };
    });
    document.querySelectorAll('[data-toggle-active]').forEach(btn=>{
      btn.onclick = async ()=>{
        const [key, id] = btn.dataset.toggleActive.split(':');
        const rec = DATA[key].find(r=>r.id===id);
        if(rec) rec.active = rec.active === false ? true : false;
        await save(); switchTab('settings');
      };
    });
    // Loom Assignments: each per-loom dropdown saves on change; Quick Assign applies one
    // employee pair to every checked loom at once.
    DATA.looms.forEach(l=>{
      ['e1','e2'].forEach(slot=>{
        const el = document.getElementById(`la_${slot}_${l.id}`);
        if(!el) return;
        el.addEventListener('change', async ()=>{
          const a = loomAssignmentFor(l.name) || {};
          const next = {e1:a.e1||'', e2:a.e2||''};
          next[slot] = el.value;
          setLoomAssignment(l.name, next.e1, next.e2);
          await save(); switchTab('settings');
        });
      });
    });
    const laApply = document.getElementById('la_apply');
    if(laApply) laApply.onclick = async ()=>{
      const looms = Array.from(document.querySelectorAll('.la_loom_pick:checked')).map(cb=>cb.value);
      const e1 = v('la_qa_e1'), e2 = v('la_qa_e2');
      if(!requireFields([
        [looms.length, 'Pick at least one loom first.', null],
        [e1 || e2, 'Pick at least one employee first.', 'la_qa_e1'],
      ])) return;
      looms.forEach(loomName=> setLoomAssignment(loomName, e1, e2));
      await save(); switchTab('settings');
    };
  }
}
function v(id){ const el = document.getElementById(id); return el ? el.value : ''; }
// Stops a save when something essential is missing (a stray tap on Add used to store a blank row).
// `checks` is a list of [ok, message, fieldId]; the first one that fails is shown as a toast and the
// cursor is put on that field. Returns true when everything is filled in.
function requireFields(checks){
  for(const [ok, msg, fieldId] of checks){
    if(ok) continue;
    showToast(msg);
    const el = fieldId ? document.getElementById(fieldId) : null;
    if(el){ try{ el.focus(); el.scrollIntoView({block:'center', behavior:'smooth'}); }catch(e){ /* best effort */ } }
    return false;
  }
  return true;
}
function wireCartonsToLbs(cartonsId, kgId, lbsId, previewId){
  const KG_TO_LB = 2.2046;
  const lbsEl = document.getElementById(lbsId);
  const previewEl = document.getElementById(previewId);
  const upd = ()=>{
    const cartons = Number(v(cartonsId)||0), kgEach = Number(v(kgId)||0);
    if(cartons && kgEach){
      const totalKg = cartons*kgEach;
      // Kept at full precision (not rounded to 2dp) since this value feeds directly into
      // Amount = Weight × Rate — rounding here was shaving the weight down before that
      // multiplication, throwing off the total amount paid. fmtNum still rounds only the
      // preview text below, for display.
      const totalLbs = totalKg*KG_TO_LB;
      lbsEl.value = totalLbs;
      previewEl.textContent = `${fmtNum(cartons)} carton(s) × ${fmtNum(kgEach)} kg = ${fmtNum(totalKg)} kg → ${fmtNum(totalLbs)} lbs`;
      lbsEl.dispatchEvent(new Event('input'));
    } else {
      previewEl.textContent = 'Enter cartons & kg/carton to auto-calculate weight — or type the lbs directly.';
    }
  };
  [cartonsId, kgId].forEach(id=>{
    const inp = document.getElementById(id);
    if(inp) inp.addEventListener('input', upd);
  });
}
function wireBagsToLbs(bagsId, lbsPerBagId, lbsId, previewId, labelId){
  const lbsEl = document.getElementById(lbsId);
  const labelEl = document.getElementById(labelId);
  const previewEl = document.getElementById(previewId);
  const syncLabel = ()=>{ labelEl.textContent = lbsEl.value ? fmtNum(Number(lbsEl.value)) : '—'; };
  const upd = ()=>{
    const bags = Number(v(bagsId)||0), lbsEach = Number(v(lbsPerBagId)||0);
    if(bags && lbsEach){
      const totalLbs = Math.round(bags*lbsEach*100)/100;
      lbsEl.value = totalLbs;
      previewEl.textContent = `${fmtNum(bags)} bag(s) × ${fmtNum(lbsEach)} lbs = ${fmtNum(totalLbs)} lbs`;
      lbsEl.dispatchEvent(new Event('input'));
    } else {
      // Bags/lbs-per-bag not filled in — leave whatever's already in the hidden
      // total (e.g. a legacy entry's saved weight) untouched rather than zeroing it.
      previewEl.textContent = 'Enter bags & lbs/bag to auto-calculate total weight.';
    }
    syncLabel();
  };
  [bagsId, lbsPerBagId].forEach(id=>{
    const inp = document.getElementById(id);
    if(inp) inp.addEventListener('input', upd);
  });
  syncLabel(); // initial paint — shows a legacy entry's saved weight even with no bags data
}
function wireAmountPreview(qtyId, rateId, previewId, label='Amount', floorResult=false){
  const el = document.getElementById(previewId);
  const upd = ()=>{
    const qty = Number(v(qtyId)||0), rate = Number(v(rateId)||0);
    const raw = qty*rate;
    el.textContent = (qty && rate) ? `${label}: ${fmtRs(floorResult ? Math.floor(raw + 1e-6) : raw)}` : `${label}: —`;
  };
  [qtyId, rateId].forEach(id=>{
    const inp = document.getElementById(id);
    if(inp) inp.addEventListener('input', upd);
  });
}
function wireEnterSubmit(fieldIds, buttonId){
  fieldIds.forEach(id=>{
    const inp = document.getElementById(id);
    if(!inp) return;
    inp.addEventListener('keydown', e=>{
      if(e.key === 'Enter'){ e.preventDefault(); document.getElementById(buttonId).click(); }
    });
  });
}
function tabForKey(key){
  if(key==='qualities'||key==='clients'||key==='employees'||key==='looms'||key==='warpTypes'||key==='weftTypes'||key==='dyeingUnits'||key==='banks') return 'settings';
  if(key==='rateCalcs') return 'ratecalc';
  if(key==='warpBeams'||key==='warpBeamsFinished') return 'warpbeams';
  if(key==='wageBonuses'||key==='wagePayments'||key==='wageSettlements') return 'wages';
  if(key==='loanPayments') return 'loans';
  return key;
}
function wireDelete(key){
  document.querySelectorAll(`[data-del^="${key}:"]`).forEach(btn=>{
    // Native confirm()/alert() dialogs are blocked in the sandboxed preview this
    // runs in, so a real confirm() call silently no-ops and blocks every delete.
    // Use a two-click "arm, then confirm" pattern on the button itself instead.
    btn.onclick = async ()=>{
      if(!btn.dataset.armed){
        btn.dataset.armed = '1';
        btn.dataset.originalHtml = btn.innerHTML;
        btn.textContent = 'Confirm?';
        btn.style.color = 'var(--red)';
        btn.style.borderColor = 'var(--red)';
        btn.style.background = '#fff';
        btn._disarmTimer = setTimeout(()=>{
          if(btn.dataset.armed){
            delete btn.dataset.armed;
            btn.innerHTML = btn.dataset.originalHtml;
            btn.style.color = '';
            btn.style.borderColor = '';
            btn.style.background = '';
          }
        }, 3000);
        return;
      }
      clearTimeout(btn._disarmTimer);
      haptic(25); // firm single buzz right at the moment a delete is actually confirmed
      const delId = btn.dataset.del.split(':')[1];
      // A payment that replaced a bounced cheque takes its link with it, so that cheque may need to go
      // back on the Bounced list (and links pointing at this payment's own cheques are dropped).
      const gone = key === 'recovery' ? DATA.recovery.find(r=>r.id===delId) : null;
      const goneLinks = gone && Array.isArray(gone.replaces) ? gone.replaces.map(l=>({...l})) : [];
      DATA[key] = DATA[key].filter(r=>r.id!==delId);
      if(key === 'recovery') settleReplacementLinks(goneLinks, [], null);
      if(EDITING && EDITING.key===key && EDITING.id===delId) EDITING = null;
      await save(); switchTab(tabForKey(key));
    };
  });
}
// Lets a Warp Beam be marked Finished by hand — for when it's done but no replacement
// beam has been chained on yet, so it wouldn't otherwise show as Finished. "Reopen"
// undoes it. Has no visible effect on a beam a newer beam has already superseded, since
// that one shows Finished automatically regardless of this flag.
function wireBeamFinishToggle(){
  document.querySelectorAll('[data-finish]').forEach(btn=>{
    btn.onclick = async ()=>{
      const [beamId, action] = btn.dataset.finish.split(':');
      const rec = DATA.warpBeams.find(r=>r.id===beamId);
      if(!rec) return;
      if(action==='finish'){
        rec.finished = true;
        rec.finishedDate = todayStr();
        rec.finishedTime = nowStr();
      } else {
        rec.finished = false;
        delete rec.finishedDate;
        delete rec.finishedTime;
      }
      await save(); switchTab('warpbeams');
    };
  });
}
function wireEditGeneric(key, addBtnId, cancelBtnId, fieldMap, afterFill){
  document.querySelectorAll(`[data-edit^="${key}:"]`).forEach(btn=>{
    btn.onclick = ()=>{
      const editId = btn.dataset.edit.split(':')[1];
      const rec = DATA[key].find(r=>r.id===editId);
      if(!rec) return;
      EDITING = {key, id: editId};
      // If this key has a collapsible form (Wages page forms share their key with EDITING.key
      // for exactly this reason), force it open so the fields being populated below are
      // actually visible rather than sitting hidden behind a collapsed toggle.
      OPEN_FORMS.add(key);
      const formBody = document.querySelector(`[data-form-body="${key}"]`);
      if(formBody) formBody.style.display = 'block';
      const toggleBtn = document.querySelector(`[data-toggle-form="${key}"]`);
      if(toggleBtn) toggleBtn.textContent = 'Hide Form';
      Object.keys(fieldMap).forEach(inputId=>{
        const el = document.getElementById(inputId);
        if(el) el.value = rec[fieldMap[inputId]] ?? '';
      });
      if(afterFill) afterFill(rec);
      const addBtn = document.getElementById(addBtnId);
      if(addBtn) addBtn.textContent = 'Update Entry';
      const cancelBtn = document.getElementById(cancelBtnId);
      if(cancelBtn) cancelBtn.style.display = 'inline-block';
      window.scrollTo({top:0, behavior:'smooth'});
    };
  });
  const cancelBtn = document.getElementById(cancelBtnId);
  if(cancelBtn) cancelBtn.onclick = ()=>{
    EDITING = null;
    switchTab(tabForKey(key));
  };
}
