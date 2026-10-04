/* Page wiring: renderPanel + wirePanel connect every page's buttons, forms and filters to the
 * data; also the shared helpers those handlers use (v, wireEnterSubmit, wireDelete, wireEditGeneric). */

/* ---------------- Panel dispatch ---------------- */
function renderPanel(id){
  CUR_PANEL = id;
  const map = {
    overview: overviewPanel, production: productionPanel, sale: salePanel, recovery: recoveryPanel,
    expense: expensePanel, family: familyPanel, personal: personalPanel, personalloans: personalLoansPanel, ownerloans: ownerLoansPanel,
    warp: warpPanel, warpbeams: warpBeamsPanel, weft: weftPanel, wages: wagesPanel,
    loans: loansPanel, ratecalc: ratecalcPanel,
    checkpoints: checkpointsPanel, fiscal: typeof fiscalPanel === 'function' ? fiscalPanel : () => '', settings: settingsPanel, graphs: graphsPanel, backup: backupPanel,
    inbox: typeof proposalsInboxPanel === 'function' ? proposalsInboxPanel : () => '', // owner only (js/proposals.js)
    audit: typeof auditPanel === 'function' ? auditPanel : () => '', // owner only (js/audit.js)
  };
  return `<div class="panel active">${map[id]()}</div>`;
}

function wirePanel(id){
  if(id==='inbox' && typeof wireProposalsInbox === 'function') wireProposalsInbox();
  if(id==='audit' && typeof wireAuditPanel === 'function') wireAuditPanel();
  if(id==='overview'){
    const monthSel = document.getElementById('ov_month_sel');
    const yearSel = document.getElementById('ov_year_sel');
    const fromSel = document.getElementById('ov_from_sel');
    const toSel = document.getElementById('ov_to_sel');
    const customWrap = document.getElementById('ov_custom');
    const chips = Array.from(document.querySelectorAll('#ov_chips .chip'));
    const stickySel = document.getElementById('ov_sticky_sel');
    const setActiveChip = (period)=>{ chips.forEach(c=> c.classList.toggle('active', c.dataset.period === period)); if(stickySel) stickySel.value = period; };
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
    const applyPeriod = (period)=>{
        if(period === 'custom'){
          customWrap.hidden = false;
          setActiveChip('custom');
          const pc = document.getElementById('ov_chips'); if(pc) pc.scrollIntoView({behavior:'smooth', block:'center'});
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
    chips.forEach(chip=>{ chip.onclick = ()=> applyPeriod(chip.dataset.period); });
    if(stickySel) stickySel.onchange = ()=> applyPeriod(stickySel.value);
    setActiveChip('');
    renderStats('');
  }
  if(id==='production'){
    const readProductionForm = ()=>({date:v('p_date'), time:v('p_time'), loom:v('p_loom'), quality:v('p_quality'), qty:combineMtr16(v('p_qty'), v('p_qty_16')), beam:v('p_beam'),
      e1:v('p_e1'), e1m:Number(v('p_e1m')||0), e2:v('p_e2'), e2m:Number(v('p_e2m')||0),
      e3:v('p_e3'), e3m:Number(v('p_e3m')||0)});
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
    // Employee 2 is tucked away until it is needed: it opens by itself whenever Employee 2 (or their meters) has a value
    // -- the loom's usual pair, an edit, a typed entry -- or when "+ Add a second employee" is tapped.
    const e2wrap = document.getElementById('p_e2wrap'), e2btn = document.getElementById('p_toggleE2');
    let e2Open = false;
    const syncE2 = ()=>{
      const need = e2Open || !!v('p_e2') || !!v('p_e2m') || e3wrap.style.display !== 'none';
      e2wrap.style.display = need ? 'grid' : 'none';
      e2btn.style.display = need ? 'none' : '';
      e3btn.style.display = need ? '' : 'none';
    };
    e2btn.addEventListener('click', ()=>{ e2Open = true; syncE2(); });
    document.getElementById('p_e2').addEventListener('change', syncE2);
    const showE3 = ()=>{ e3wrap.style.display = 'grid'; e3btn.textContent = '− Remove third employee'; syncE2(); };
    const hideE3 = ()=>{
      e3wrap.style.display = 'none'; e3btn.textContent = '+ Add a third employee';
      document.getElementById('p_e3').value = '';
      document.getElementById('p_e3m').value = '';
      document.getElementById('p_e3m').dataset.manual = '';
      syncE2();
    };
    // Live "Remaining to assign" readout: total Quantity Produced minus whatever's been split
    // across Employee 1/2/3 so far — lets you catch a mis-typed meter figure (or a loom left
    // out) before saving, instead of only noticing it later on the Production Log. Employee 3's
    // meters only count while that field is actually shown (see e3wrap above); hidden-and-cleared
    // is the same as 0, not counted twice.
    const remainingEl = document.getElementById('p_remainingPreview');
    const updateRemaining = ()=>{
      const total = combineMtr16(v('p_qty'), v('p_qty_16'));
      const assigned = Number(v('p_e1m')||0) + Number(v('p_e2m')||0)
        + (e3wrap.style.display !== 'none' ? Number(v('p_e3m')||0) : 0);
      if(!total){ remainingEl.textContent = 'Remaining to assign: —'; remainingEl.classList.remove('over'); return; }
      const remaining = total - assigned;
      remainingEl.textContent = `Remaining to assign: ${fmtQtyMtr(remaining)} mtr`;
      remainingEl.classList.toggle('over', remaining < -1e-6); // more assigned than produced — flag it
    };
    ['p_qty','p_qty_16','p_e1m','p_e2m','p_e3m'].forEach(id=>{
      const inp = document.getElementById(id);
      if(inp) inp.addEventListener('input', updateRemaining);
    });
    e3btn.addEventListener('click', ()=>{
      e3wrap.style.display === 'none' ? showE3() : hideE3();
      updateRemaining(); // e3's meters just came into (or dropped out of) the total
    });
    updateRemaining();
    // Employee 2 Meters stays fully editable — marking it "manual" the moment it's typed into
    // directly stops the Employee 1 auto-split just below from overwriting a deliberately
    // different split; clearing it back to blank opts back into the auto-fill.
    document.getElementById('p_e2m').addEventListener('input', function(){
      this.dataset.manual = this.value.trim() ? '1' : '';
    });
    // Common two-employee flow: total first, then Employee 1's share. Employee 2 Meters
    // auto-fills live with whatever's left (total minus Employee 1), but only the WHOLE-meter
    // part of it — any 1/16ths left over stay out of Employee 2's figure and fall through to
    // the Diff column instead (see the production table's Diff calc), rather than silently
    // getting attributed to Employee 2 as a fraction they didn't actually weave. Only kicks in
    // once there's a total to split, an Employee 2 is already picked (usually already true via
    // the loom's usual assignment above), Employee 2 hasn't been hand-edited, and no third
    // employee is in play (a 3-way split needs typing by hand).
    const p_e1m = document.getElementById('p_e1m');
    const autoSplitRemaining = ()=>{
      const total = combineMtr16(v('p_qty'), v('p_qty_16'));
      const e2mInput = document.getElementById('p_e2m');
      if(!(total > 0) || !v('p_e2') || e2mInput.dataset.manual || e3wrap.style.display !== 'none') return false;
      const e2 = entryEmployee2Meters(total, v('p_e1m'), 0);
      if(e2 === null) return false; // Employee 1 alone already exceeds the total — leave it for a manual fix
      e2mInput.value = fmtQtyPlain(e2);
      updateRemaining();
      return true;
    };
    // Total woven, then the sixteenths: control moves straight to Employee 1's meters.
    document.getElementById('p_qty_16').addEventListener('change', ()=>{
      if(combineMtr16(v('p_qty'), v('p_qty_16')) > 0) document.getElementById('p_e1m').focus();
    });
    p_e1m.addEventListener('input', autoSplitRemaining);
    // Three-way split. With a third employee in play, whatever Employee 1 didn't weave is shared out
    // automatically (whole meters only; 1/16ths stay in Diff, same rule as the two-employee split):
    //   - Employee 2 and 3 both untouched  -> split the rest evenly (Employee 2 gets the odd meter)
    //   - one of them typed by hand        -> the other one takes whatever is left
    //   - both typed by hand               -> nothing is changed
    // Needs both Employee 2 and Employee 3 picked. Removing the third employee gives the rest back to Employee 2.
    const p_e2m = document.getElementById('p_e2m'), p_e3m = document.getElementById('p_e3m');
    p_e3m.addEventListener('input', function(){ this.dataset.manual = this.value.trim() ? '1' : ''; });
    const autoSplitThird = ()=>{
      if(e3wrap.style.display === 'none') return;
      const total = combineMtr16(v('p_qty'), v('p_qty_16'));
      if(!(total > 0) || !v('p_e2')) return;
      if(p_e2m.dataset.manual) return; // Employee 2 typed by hand — leave it alone
      // Employee 2 keeps everything Employee 1 didn't weave, minus whatever is typed for Employee 3.
      const e2 = entryEmployee2Meters(total, v('p_e1m'), v('p_e3m')) || 0;
      p_e2m.value = e2 > 0 ? fmtQtyPlain(e2) : '';
      updateRemaining();
    };
    ['p_qty','p_qty_16','p_e1m','p_e2m','p_e3m'].forEach(id=>{ const el = document.getElementById(id); if(el) el.addEventListener('input', autoSplitThird); });
    ['p_e2','p_e3'].forEach(id=>document.getElementById(id).addEventListener('change', autoSplitThird));
    e3btn.addEventListener('click', ()=>{ e3wrap.style.display === 'none' ? autoSplitRemaining() : autoSplitThird(); });
    // Once Employee 1's figure is typed in (leaving the field, e.g. by Tab), control moves
    // straight to the save button instead of stopping at Employee 2's already-filled fields —
    // the split is on screen to check, and Enter from there saves the entry.
    p_e1m.addEventListener('change', ()=>{
      if(autoSplitRemaining()) document.getElementById(EDITING ? 'addProduction' : 'addProductionNext').focus();
    });
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
      syncE2();
    });
    syncE2(); // first paint, and coming back from "Add & next loom" with the next loom's pair already filled in
    // Enter is the form's default action: "Add & next loom" for a new entry, and
    // Update Entry while a row is being edited (the next-loom button is hidden then).
    ['p_date','p_quality','p_loom','p_qty','p_qty_16','p_e1','p_e1m','p_e2','p_e2m','p_e3','p_e3m'].forEach(id=>{
      const inp = document.getElementById(id);
      if(!inp) return;
      inp.addEventListener('keydown', e=>{
        if(e.key === 'Enter'){ e.preventDefault();
          if(id === 'p_qty_16' && !v('p_e1m') && combineMtr16(v('p_qty'), v('p_qty_16')) > 0){ document.getElementById('p_e1m').focus(); return; }
          document.getElementById(EDITING ? 'addProduction' : 'addProductionNext').click(); }
      });
    });
    wireDelete('production');
    // Qty is stored as one decimal number, same as before — only the fieldMap entries for the
    // plain select/date/employee/etc fields go through the generic value=rec[field] fill. The
    // Qty/16ths boxes are split out from that decimal by hand in afterFill below.
    wireEditGeneric('production','addProduction','cancelProduction',
      {p_date:'date',p_time:'time',p_quality:'quality',p_loom:'loom',p_beam:'beam',p_e1:'e1',p_e1m:'e1m',p_e2:'e2',p_e2m:'e2m',p_e3:'e3',p_e3m:'e3m'},
      (rec)=>{
        renderBeamToggle(false); syncE2(); if(v('p_e3')){ showE3(); if(v('p_e3m')) p_e3m.dataset.manual = '1'; if(v('p_e2m')) p_e2m.dataset.manual = '1'; } nextBtn.style.display = 'none';
        document.getElementById('addProduction').className = 'primary'; // Update Entry is the main action while editing
        const s = splitMtr16(rec.qty);
        document.getElementById('p_qty').value = s.whole;
        document.getElementById('p_qty_16').value = s.sixteenths;
        updateRemaining(); // fields above were set by hand, not typed, so the preview needs a nudge
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

    // v3.17.60 — Multiple Entries (looms sheet). Cursor order: Gzana meters -> sixteenths -> Employee 1 -> Employee 2 (-> Employee 3) -> next loom.
    const mbRoot = document.getElementById('mb_cards');
    if(mbRoot){
      const q = (c,s)=>c.querySelector(s), num = el=>Number(el.value)||0;
      const cards = ()=>[...mbRoot.querySelectorAll('.mb-card')];
      const shown = ()=>cards().filter(c=>c.style.display!=='none');
      const e3On = c=>q(c,'.mb-e3').style.display!=='none';
      const total = c=>combineMtr16(q(c,'.mb_g').value, q(c,'.mb_s').value);
      const assigned = c=>num(q(c,'.mb_m1'))+num(q(c,'.mb_m2'))+(e3On(c)?num(q(c,'.mb_m3')):0);
      const autoSplit = c=>{
        const m2 = q(c,'.mb_m2'), t = total(c);
        if(m2.dataset.man || e3On(c) || !q(c,'.mb_n2').value || !(t>0)) return;
        const e2 = entryEmployee2Meters(t, num(q(c,'.mb_m1')), 0); if(e2 === null) return;
        m2.value = e2;
      };
      // Three-way share, same rules as the single-entry form: Employee 2 keeps everything Employee 1 didn't weave,
      // minus whatever is typed for Employee 3 (whose meters start empty). Employee 2 typed by hand -> left alone.
      const autoSplit3 = c=>{
        if(!e3On(c)) return;
        const m2 = q(c,'.mb_m2'), t = total(c);
        if(!(t>0) || !q(c,'.mb_n2').value || m2.dataset.man) return;
        const left = entryEmployee2Meters(t, num(q(c,'.mb_m1')), num(q(c,'.mb_m3'))) || 0;
        m2.value = left > 0 ? left : '';
      };
      const calc = ()=>{
        let T=0, A=0, bad=0;
        shown().forEach(c=>{
          const t = total(c), a = assigned(c), d = q(c,'.mb-df');
          if(!(t>0)){ d.textContent='Diff: —'; d.style.color=''; return; }
          const diff = Math.round((t-a)*16)/16;
          d.textContent = 'Diff: ' + fmtQtyMtr(diff); d.style.color = diff<0 ? 'var(--rust)' : '';
          if(diff<0) bad++; T+=t; A+=a;
        });
        document.getElementById('mb_totals').textContent = `Total Gzana: ${fmtQtyMtr(T)} · Assigned: ${fmtQtyMtr(A)} · Diff: ${fmtQtyMtr(Math.round((T-A)*16)/16)}`;
        document.getElementById('mb_err').textContent = bad ? `Employees exceed Gzana on ${bad} loom(s). Check the meters.` : '';
      };
      const setPicks = fn=>{
        document.querySelectorAll('.mb_pk').forEach(p=>{ p.checked = fn(p.value); });
        cards().forEach(c=>{ c.style.display = document.querySelector(`.mb_pk[value="${CSS.escape(c.dataset.loom)}"]`).checked ? 'block' : 'none'; });
        calc();
      };
      const groups = mbGroups();
      document.querySelector('[data-mb-all]').onclick = ()=>setPicks(()=>true);
      document.querySelector('[data-mb-none]').onclick = ()=>setPicks(()=>false);
      document.querySelectorAll('[data-mb-grp]').forEach(b=>{ b.onclick = ()=>{ const l = groups[Number(b.dataset.mbGrp)].looms; setPicks(n=>l.includes(n)); }; });
      document.querySelectorAll('.mb_pk').forEach(p=>p.addEventListener('change', ()=>setPicks(n=>document.querySelector(`.mb_pk[value="${CSS.escape(n)}"]`).checked)));
      mbRoot.addEventListener('input', e=>{
        const c = e.target.closest('.mb-card'); if(!c) return;
        if(e.target.classList.contains('mb_m2')) e.target.dataset.man = e.target.value.trim() ? '1' : '';
        if(e.target.classList.contains('mb_m3')) e.target.dataset.man = e.target.value.trim() ? '1' : '';
        if(e.target.matches('.mb_g,.mb_s,.mb_m1')) autoSplit(c);
        if(e.target.matches('.mb_g,.mb_s,.mb_m1,.mb_m2,.mb_m3')) autoSplit3(c);
        calc();
      });
      mbRoot.addEventListener('change', e=>{
        const c = e.target.closest('.mb-card');
        if(c && e.target.matches('.mb_n2,.mb_n3')){ autoSplit3(c); calc(); }
      });
      mbRoot.addEventListener('focusin', e=>{ if(e.target.classList.contains('mb_f')) e.target.select(); });
      mbRoot.addEventListener('keydown', e=>{
        if(e.key!=='Enter' || !e.target.classList.contains('mb_f')) return;
        e.preventDefault();
        const seq = shown().flatMap(c=>[...c.querySelectorAll('.mb_f')].filter(i=>i.offsetParent)), n = seq[seq.indexOf(e.target)+1];
        (n || document.getElementById('saveMultiProduction')).focus();
      });
      mbRoot.addEventListener('click', e=>{
        if(!e.target.classList.contains('mb-tg')) return;
        const c = e.target.closest('.mb-card'), w = q(c,'.mb-e3'), on = w.style.display==='none';
        w.style.display = on ? 'block' : 'none';
        e.target.textContent = on ? '− Remove third employee' : '+ Add a third employee';
        if(!on){ q(c,'.mb_n3').value=''; q(c,'.mb_m3').value=''; q(c,'.mb_m3').dataset.man=''; autoSplit(c); }
        else autoSplit3(c);
        calc();
      });
      document.getElementById('saveMultiProduction').onclick = async ()=>{
        const err = document.getElementById('mb_err'), date = v('mb_date'), quality = v('mb_quality');
        const fail = m=>{ err.textContent = m; };
        if(!date) return fail('Pick the date first.');
        if(!quality) return fail('Pick a quality first.');
        const list = shown(); if(!list.length) return fail('Tick at least one loom.');
        const recs = [];
        for(const c of list){
          const loom = c.dataset.loom, t = total(c);
          if(!(t>0)) return fail(`Loom ${loom}: enter the Gzana (total meters) first.`);
          const r = {date, time:nowStr(), loom, quality, qty:t, beam:'', e1:'', e1m:0, e2:'', e2m:0, e3:'', e3m:0};
          for(const n of (e3On(c)?[1,2,3]:[1,2])){
            const name = q(c,'.mb_n'+n).value, m = num(q(c,'.mb_m'+n));
            if(!name && m) return fail(`Loom ${loom}: pick Employee ${n} for ${m} meters.`);
            r['e'+n] = name; r['e'+n+'m'] = m;
          }
          if(!r.e1) return fail(`Loom ${loom}: pick Employee 1.`);
          if(assigned(c) - t > 1e-9) return fail(`Loom ${loom}: employee meters exceed the Gzana.`);
          recs.push(r);
        }
        recs.forEach(r=>DATA.production.push({id:uid(), ...r}));
        PAGE.production = 1;
        await save(); switchTab('production');
        showToast(`Saved ${recs.length} production entr${recs.length===1?'y':'ies'}.`);
      };
    }
  }
  if(id==='sale'){
    document.getElementById('addSale').onclick = async ()=>{
      const qty=combineMtr16(v('s_qty'), v('s_qty_16')), rate=Number(v('s_rate'));
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
      // An L (AIL)-applied original, a returned lot, or an adjustment entry itself (lAdjustedFromId)
      // has its qty/rate/amount tied to a linked record via that exact math (shortage/deduction
      // computed from THIS qty, or the adjustment's qty/amount computed as original-minus-shortage).
      // Letting a plain edit silently change those numbers would desync the pair — the deduction
      // and the adjusted entry would keep reflecting the old, now-wrong figures. So for these three
      // cases, qty/rate/amount are kept as they were; only the other fields (date, invoice, client,
      // quality, dyeing, description) are editable. To actually change qty/rate on an L-tracked sale,
      // fix it via Return Lot / a fresh Confirm L, not a plain edit.
      const isLLocked = !!(existing && (existing.lStatus==='applied' || existing.lStatus==='returned' || existing.lAdjustedFromId));
      if(isLLocked){
        rec.qty = Number(existing.qty); rec.rate = Number(existing.rate)||rate; rec.amount = Number(existing.amount);
      }
      if(EDITING && EDITING.key==='sale'){
        const idx = DATA.sale.findIndex(r=>r.id===EDITING.id);
        if(idx>-1){
          DATA.sale[idx] = {...DATA.sale[idx], ...rec};
          // Same rule as a brand-new Sale: naming a Dyeing unit starts L (AIL) tracking — this
          // covers a Sale entered before this feature existed, or one where Dyeing is only
          // added after the fact. Only if it was never tracked before (don't re-arm one that's
          // already Awaiting/OK/Applied/Returned just because it was edited again) — and never
          // for an adjustment entry (lAdjustedFromId), which has no lStatus of its own but is
          // already the resolved outcome of a completed L check, not a fresh untracked sale.
          if(DATA.sale[idx].dyeing && !DATA.sale[idx].lStatus && !DATA.sale[idx].lAdjustedFromId) DATA.sale[idx].lStatus = 'awaiting';
        }
        EDITING = null;
        if(isLLocked) showToast('Qty/Rate/Amount are locked on this entry (linked to an L (AIL) shortage record) — only the other fields were updated.');
      } else {
        // A lot going out to a dyeing unit is the one that comes back with an "L (AIL)"
        // shortage call — see lShortageMeters/lDeductionAmount in calc.js — so a fresh Sale
        // naming a dyeing unit starts life "Awaiting L (AIL)" until that call is logged via
        // the Awaiting L (AIL) card. A sale with no dyeing unit skips L tracking entirely.
        if(rec.dyeing) rec.lStatus = 'awaiting';
        DATA.sale.push({id:uid(), ...rec}); PAGE.sale = 1;
      }
      await save(); switchTab('sale');
      try{
        const cl = DATA.clients.find(c=>c.name===rec.client);
        if(cl && cl.creditLimit){
          const owed = clientReceivableNow(rec.client);
          if(owed > cl.creditLimit) showToast(`⚠ ${rec.client} owes Rs ${Math.round(owed).toLocaleString()} — over the credit limit of Rs ${Number(cl.creditLimit).toLocaleString()}.`, 8000);
        }
      }catch(e){}
    };
    wireAmountPreview(['s_qty','s_qty_16'],'s_rate','s_amtPreview','Amount',true);
    wireEnterSubmit(['s_date','s_client','s_quality','s_qty','s_qty_16','s_rate','s_inv'],'addSale');
    wireDelete('sale');
    // Qty is stored as one decimal number, same as before — the Meters/16ths boxes are split
    // out from that decimal by hand in afterFill below (same approach as Production).
    wireEditGeneric('sale','addSale','cancelSale',
      {s_date:'date',s_client:'client',s_quality:'quality',s_rate:'rate',s_inv:'invoice',s_dyeing:'dyeing',s_desc:'desc'},
      (rec)=>{
        const s = splitMtr16(rec.qty);
        document.getElementById('s_qty').value = s.whole;
        document.getElementById('s_qty_16').value = s.sixteenths;
        const el=document.getElementById('s_qty'); if(el) el.dispatchEvent(new Event('input'));
      });
    const sfClient = document.getElementById('sf_client');
    const sfQuality = document.getElementById('sf_quality');
    sfClient.value = FILTER.saleClient || '';
    sfQuality.value = FILTER.saleQuality || '';
    sfClient.addEventListener('change', ()=>{ FILTER.saleClient = sfClient.value; PAGE.sale = 1; switchTab('sale'); });
    sfQuality.addEventListener('change', ()=>{ FILTER.saleQuality = sfQuality.value; PAGE.sale = 1; switchTab('sale'); });
    // Toggles the Sales Log between its default (active records only — everything still
    // counted in totals) and a "linked records" view showing just the L (AIL) pairs: the
    // original entry (greyed out, excluded from totals) alongside the adjusted entry that
    // replaced it. See filteredSaleActive/filteredSaleLinked in panels-daily.js.
    const saleLinkedToggle = document.getElementById('saleLinkedToggle');
    if(saleLinkedToggle) saleLinkedToggle.onclick = ()=>{ FILTER.saleLinked = !FILTER.saleLinked; PAGE.sale = 1; switchTab('sale'); };
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
            <div class="field"><label>Amount</label><input type="number" inputmode="decimal" step="0.01" data-cf="amount" value="${c.amount||''}"></div>
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
    let outstandingNow = null; // the chosen client's outstanding amount (null until a client is picked)
    const updateTotalPreview = ()=>{
      const chequeTotal = chequeRows.reduce((s,c)=>s+(Number(c.amount)||0),0);
      const cash = Number(v('r_cash')||0), bank = Number(v('r_bank')||0);
      const total = cash + bank + chequeTotal;
      const parts = [cash ? `Cash ${fmtRs(cash)}` : '', bank ? `Bank ${fmtRs(bank)}` : '', chequeTotal ? `Cheques ${fmtRs(chequeTotal)}` : ''].filter(Boolean);
      let html = `Total: ${fmtRs2(total)}`;
      if(parts.length > 1) html += `<div class="rc-split">${parts.join(' · ')}</div>`;
      if(total > 0 && outstandingNow != null){
        const left = outstandingNow - total;
        html += `<div class="rc-split">${left > 0.004 ? `Still outstanding after this: ${fmtRs(left)}` : left < -0.004 ? `Paid ahead after this: ${fmtRs(-left)}` : 'Settles this client in full ✓'}</div>`;
      }
      document.getElementById('r_totalPreview').innerHTML = html;
    };
    // A new cheque starts with the bank and owner of the one above it (several cheques usually come from the same place).
    const addChequeRow = ()=>{ const last = chequeRows[chequeRows.length-1]; chequeRows.push({id:uid(), amount:'', chequeNo:'', bank:last?last.bank||'':'', owner:last?last.owner||'':'', chequeDate:'', status:'Pending'}); renderChequeRows(); updateTotalPreview(); };
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
    // Outstanding / paid-ahead line under the Client box, with one-tap fill buttons; also feeds the live total.
    const refreshClientInfo = ()=>{
      const box = document.getElementById('r_clientInfo'), name = v('r_client');
      if(!box) return;
      box.innerHTML = recoveryClientInfoHtml(name, editingPaymentId());
      box.hidden = !name;
      outstandingNow = name ? clientOutstanding(name, editingPaymentId()).receivable : null;
      updateTotalPreview();
    };
    const clientInfoBox = document.getElementById('r_clientInfo');
    if(clientInfoBox) clientInfoBox.addEventListener('click', (e)=>{
      const b = e.target.closest('[data-rfill]'); if(!b || outstandingNow == null || outstandingNow <= 0.004) return;
      const amt = String(Math.round(outstandingNow*100)/100);
      if(b.dataset.rfill === 'cash'){ document.getElementById('r_cash').value = amt; showCash(); }
      else document.getElementById('r_bank').value = amt;
      updateTotalPreview();
    });
    const renderReplaceRows = ()=>{
      refreshClientInfo();
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
          <div class="field" data-rep-amt-wrap style="margin:6px 0 0 26px"${st.on ? '' : ' hidden'}><label>How much of this payment replaces it (Rs)</label><input type="number" inputmode="decimal" step="0.01" data-rep-amt value="${st.amount === '' ? '' : escHtml(String(st.amount))}"></div>
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
    const rbc = document.getElementById('recByClient');
    if(rbc) rbc.addEventListener('click', (e)=>{
      const b = e.target.closest('[data-rcp]'); if(!b) return;
      FILTER.recoveryPeriod = b.dataset.rcp;
      document.getElementById('recByClientBody').innerHTML = recoveryByClientInner(); // in place: nothing typed in the form is lost
    });
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
  if(id==='personal'){
    document.getElementById('addPersonal').onclick = async ()=>{
      if(!requireFields([
        [v('pex_date'), 'Pick the date first.', 'pex_date'],
        [Number(v('pex_amt')||0) > 0, 'Enter the amount first.', 'pex_amt'],
      ])) return;
      const rec = {date:v('pex_date'), time:v('pex_time'), category:v('pex_cat'), desc:v('pex_desc'), amount:Number(v('pex_amt')||0)};
      if(EDITING && EDITING.key==='personal'){
        const idx = DATA.personal.findIndex(r=>r.id===EDITING.id);
        if(idx>-1) DATA.personal[idx] = {...DATA.personal[idx], ...rec};
        EDITING = null;
      } else {
        DATA.personal.push({id:uid(), ...rec}); PAGE.personal = 1;
      }
      await save(); switchTab('personal');
    };
    wireEnterSubmit(['pex_date','pex_time','pex_cat','pex_amt'],'addPersonal');
    wireDelete('personal');
    wireEditGeneric('personal','addPersonal','cancelPersonal',{pex_date:'date',pex_time:'time',pex_cat:'category',pex_amt:'amount',pex_desc:'desc'});
  }
  if(id==='ownerloans'){
    document.getElementById('addOwnerLoan').onclick = async ()=>{
      if(!requireFields([
        [v('ol_date'), 'Pick the date first.', 'ol_date'],
        [Number(v('ol_amt')||0) > 0, 'Enter the amount first.', 'ol_amt'],
      ])) return;
      const repaid = v('ol_type') === 'Loan Repaid';
      // The purpose only means something for money put in; the recovery link only for a repayment.
      const rec = {date:v('ol_date'), type:v('ol_type'), amount:Number(v('ol_amt')||0),
        purpose: repaid ? '' : v('ol_purpose'), recoveryId: repaid ? v('ol_rec') : '', remarks:v('ol_rem')};
      if(!Array.isArray(DATA.ownerLoans)) DATA.ownerLoans = [];
      if(EDITING && EDITING.key==='ownerLoans'){
        const idx = DATA.ownerLoans.findIndex(r=>r.id===EDITING.id);
        if(idx>-1) DATA.ownerLoans[idx] = {...DATA.ownerLoans[idx], ...rec};
        EDITING = null;
      } else {
        DATA.ownerLoans.push({id:uid(), ...rec}); PAGE.ownerLoans = 1;
      }
      await save(); switchTab('ownerloans');
    };
    // Live helper text: what the amount owed to you becomes, and which of the two optional fields applies.
    const updateOwnerLoanHelper = ()=>{
      const helperEl = document.getElementById('ol_helper');
      if(!helperEl) return;
      const repaid = v('ol_type') === 'Loan Repaid';
      const pw = document.getElementById('ol_purpose_wrap'), rw = document.getElementById('ol_rec_wrap');
      if(pw) pw.style.display = repaid ? 'none' : '';
      if(rw) rw.style.display = repaid ? '' : 'none';
      const b = computeOwnerLoanBalance();
      const amt = Number(v('ol_amt')||0);
      if(amt <= 0){ helperEl.textContent = b.balance > 0.004 ? `Currently ${fmtRs2(b.balance)} owed to you.` : ''; return; }
      if(repaid){
        const after = b.balance - amt;
        helperEl.textContent = after <= 0.004
          ? `This clears what you are owed${after < -0.004 ? `, with ${fmtRs2(Math.abs(after))} extra paid back` : ''}.`
          : `Reduces what you are owed to ${fmtRs2(after)}.`;
      } else {
        helperEl.textContent = `This brings what you are owed to ${fmtRs2(b.balance + amt)}.`;
      }
    };
    document.getElementById('ol_type').addEventListener('change', updateOwnerLoanHelper);
    document.getElementById('ol_amt').addEventListener('input', updateOwnerLoanHelper);
    updateOwnerLoanHelper();
    wireEnterSubmit(['ol_date','ol_amt'],'addOwnerLoan');
    wireDelete('ownerLoans');
    wireEditGeneric('ownerLoans','addOwnerLoan','cancelOwnerLoans',{ol_date:'date',ol_type:'type',ol_amt:'amount',ol_purpose:'purpose',ol_rec:'recoveryId',ol_rem:'remarks'},
      updateOwnerLoanHelper);
  }
  if(id==='personalloans'){
    document.getElementById('addPersonalLoan').onclick = async ()=>{
      if(!requireFields([
        [v('pl_date'), 'Pick the date first.', 'pl_date'],
        [v('pl_person'), 'Pick a person first.', 'pl_person'],
        [Number(v('pl_amt')||0) > 0, 'Enter the amount first.', 'pl_amt'],
      ])) return;
      const rec = {date:v('pl_date'), person:v('pl_person'), amount:Number(v('pl_amt')||0), type:v('pl_type'), remarks:v('pl_rem')};
      if(EDITING && EDITING.key==='personalLoans'){
        const idx = DATA.personalLoans.findIndex(r=>r.id===EDITING.id);
        if(idx>-1) DATA.personalLoans[idx] = {...DATA.personalLoans[idx], ...rec};
        EDITING = null;
      } else {
        DATA.personalLoans.push({id:uid(), ...rec}); PAGE.personalLoans = 1;
      }
      await save(); switchTab('personalloans');
    };
    // Live helper text: for Loan Given, shows what the running balance becomes; for Loan
    // Repaid, shows whether it clears the loan or leaves some still outstanding.
    const updatePersonalLoanHelper = ()=>{
      const person = v('pl_person');
      const helperEl = document.getElementById('pl_helper');
      if(!helperEl) return;
      if(!person){ helperEl.textContent = ''; return; }
      const b = computePersonLoanBalance(person);
      const amt = Number(v('pl_amt')||0);
      const type = v('pl_type');
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
    document.getElementById('pl_person').addEventListener('change', updatePersonalLoanHelper);
    document.getElementById('pl_amt').addEventListener('input', updatePersonalLoanHelper);
    document.getElementById('pl_type').addEventListener('change', updatePersonalLoanHelper);
    updatePersonalLoanHelper();
    wireEnterSubmit(['pl_date','pl_person','pl_amt'],'addPersonalLoan');
    wireDelete('personalLoans');
    wireEditGeneric('personalLoans','addPersonalLoan','cancelPersonalLoans',{pl_date:'date',pl_person:'person',pl_amt:'amount',pl_type:'type',pl_rem:'remarks'},
      updatePersonalLoanHelper);
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
    // Rate History edit / delete. While an entry is being edited RATE_EDITING holds its quality +
    // date, and the "Change a Rate" form is filled with it (the quality is locked).
    RATE_EDITING = null;
    const rateBtn = document.getElementById('saveRateChange');
    const rateCancel = document.getElementById('cancelRateChange');
    const resetRateForm = ()=>{
      RATE_EDITING = null;
      const q = document.getElementById('rc_quality'); if(q) q.disabled = false;
      if(rateBtn) rateBtn.textContent = 'Save New Rate';
      if(rateCancel) rateCancel.style.display = 'none';
      const en = document.getElementById('rc_editNote'); if(en) en.hidden = true;
    };
    // The "removing this will change past wages" note (one at a time, owned by the armed button).
    const hideDelNote = (owner)=>{
      const n = document.getElementById('rh_delNote');
      if(n && (!owner || n.dataset.owner === owner)){ n.hidden = true; n.dataset.owner = ''; }
    };
    const refreshRateViews = ()=>{
      const rateBody = document.getElementById('wg_rateRowsBody');
      if(rateBody) rateBody.innerHTML = qualityRateRowsHtml(v('wg_from'), v('wg_to')) || '<tr><td colspan="3" class="empty">Add qualities in the settings tab first</td></tr>';
      const histWrap = document.getElementById('wg_rateHistoryWrap');
      if(histWrap){ histWrap.innerHTML = rateHistoryBlockHtml(); wireRateHistory(); }
      hideDelNote();
    };
    const wireRateHistory = ()=>{
      document.querySelectorAll('[data-rh-edit]').forEach(btn=>{
        btn.onclick = ()=>{
          const quality = btn.dataset.rhQ, date = btn.dataset.rhD;
          const entry = ((DATA.wageRateHistory||{})[quality]||[]).find(e=>e.date===date);
          if(!entry) return;
          RATE_EDITING = {quality, date};
          OPEN_FORMS.add('rateChange');
          const body = document.querySelector('[data-form-body="rateChange"]'); if(body) body.style.display = 'block';
          const tog = document.querySelector('[data-toggle-form="rateChange"]'); if(tog) tog.textContent = 'Hide Change a Rate';
          const q = document.getElementById('rc_quality'); q.value = quality; q.disabled = true;
          document.getElementById('rc_rate').value = entry.rate;
          document.getElementById('rc_date').value = entry.date;
          rateBtn.textContent = 'Update Rate';
          rateCancel.style.display = 'inline-block';
          const span = rateHistorySpan(quality, date);
          const en = document.getElementById('rc_editNote');
          if(en && span){
            en.textContent = `Heads-up: editing this ${quality} rate changes the wages of production ${rateSpanText(span)}, including past periods that are already done. Earned and Net will recalculate for those days; payments already logged do not change, so Net will show the difference.`;
            en.hidden = false;
          }
          q.scrollIntoView({behavior:'smooth', block:'center'});
        };
      });
      document.querySelectorAll('[data-rh-del]').forEach(btn=>{
        // Same two-tap "arm, then Confirm" pattern as every other Remove button (native confirm() is blocked).
        btn.onclick = async ()=>{
          const quality = btn.dataset.rhQ, date = btn.dataset.rhD, owner = quality + '|' + date;
          if(!btn.dataset.armed){
            btn.dataset.armed = '1';
            btn.dataset.originalHtml = btn.innerHTML;
            btn.classList.add('armed');
            const lbl = btn.querySelector('.lbl'); if(lbl) lbl.textContent = 'Confirm';
            btn.style.color = 'var(--red)'; btn.style.borderColor = 'var(--red)'; btn.style.background = '#fff';
            const span = rateHistorySpan(quality, date);
            const dn = document.getElementById('rh_delNote');
            if(dn && span){
              const only = (DATA.wageRateHistory[quality]||[]).length < 2;
              dn.textContent = only
                ? `${quality} has only this one rate, so it can't be removed. Use Edit to change it (that also changes past wages from its date onward), or add another rate first.`
                : span.rateAfterRemoval === span.rate
                ? `Heads-up: removing this ${quality} rate changes the wages of production ${rateSpanText(span)}, including past periods that are already done. Earned and Net will recalculate; payments already logged do not change. Tap Confirm to remove it.`
                : `Heads-up: removing this ${quality} rate changes the wages of production ${rateSpanText(span)}: those days will use ${fmtRs2(span.rateAfterRemoval)}/m instead of ${fmtRs2(span.rate)}/m, including past periods that are already done. Earned and Net will recalculate; payments already logged do not change, so Net will show the difference. Tap Confirm to remove it.`;
              dn.dataset.owner = owner; dn.hidden = false;
            }
            // Longer than the plain Remove buttons (3s) so the note above can actually be read.
            btn._disarmTimer = setTimeout(()=>{
              if(btn.dataset.armed){
                delete btn.dataset.armed; btn.classList.remove('armed');
                btn.innerHTML = btn.dataset.originalHtml;
                btn.style.color = ''; btn.style.borderColor = ''; btn.style.background = '';
                hideDelNote(owner);
              }
            }, 8000);
            return;
          }
          clearTimeout(btn._disarmTimer);
          haptic(25);
          hideDelNote(owner);
          const result = removeRateHistoryEntry(quality, date);
          if(result === 'last'){
            showToast(`${quality} needs at least one rate. Edit this one, or add a new rate first.`);
            refreshRateViews();
            return;
          }
          if(RATE_EDITING && RATE_EDITING.quality===quality && RATE_EDITING.date===date) resetRateForm();
          await save();
          renderWages();
          refreshRateViews();
        };
      });
    };
    if(rateCancel) rateCancel.onclick = ()=>{ resetRateForm(); switchTab('wages'); };
    if(rateBtn) rateBtn.onclick = async ()=>{
      const quality = RATE_EDITING ? RATE_EDITING.quality : v('rc_quality');
      const rate = Number(v('rc_rate'));
      const date = v('rc_date') || todayStr();
      if(!requireFields([
        [quality, 'Pick a quality first.', 'rc_quality'],
        [v('rc_rate') !== '' && rate >= 0, 'Enter the new rate first (0 or more).', 'rc_rate'],
      ])) return;
      // Same effective date entered twice just overwrites that date's rate rather than stacking
      // duplicate history entries; an edit replaces the entry it started from.
      saveRateHistoryEntry(quality, rate, date, RATE_EDITING ? RATE_EDITING.date : null);
      const wasEditing = !!RATE_EDITING;
      resetRateForm();
      await save();
      renderWages();
      refreshRateViews();
      if(wasEditing){ document.getElementById('rc_rate').value = ''; document.getElementById('rc_date').value = todayStr(); }
    };
    wireRateHistory();
    renderWages();
    wagesUiWire(); // tabs, period chips, employee cards, Pay buttons and the quick-entry sheet (js/wages-ui.js)

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
        const paidBox = document.getElementById('wb_paid');
        const paidNow = !!(paidBox && paidBox.checked);
        addWageBonusEntry(rec, paidNow, uid); PAGE.wageBonuses = 1; if(paidNow) PAGE.wagePayments = 1;
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
      const helperEl = document.getElementById('wp_helper');
      if(!helperEl) return;
      helperEl.textContent = wagePaymentHelperMsg(v('wp_emp'), Number(v('wp_amt')||0), v('wg_from'), v('wg_to'));
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
  if(id==='fiscal' && typeof fiscalWire === 'function') fiscalWire();
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
    const graphsRoot = document.getElementById('graphs_root');
    if(graphsRoot){
      graphsRoot.addEventListener('click', graphsTapHandler);
      const cmp = document.getElementById('graphs_compare');
      if(cmp) cmp.onclick = ()=>{ FILTER.graphsCompare = !FILTER.graphsCompare; switchTab('graphs'); };
      graphsAnimate(graphsRoot);
    }
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
            if(typeof tombResetBaseline === 'function') tombResetBaseline(); // a restore swaps the whole ledger — not deletions
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
            if(typeof tombResetBaseline === 'function') tombResetBaseline(); // a restore swaps the whole ledger — not deletions
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
    wireCloudSyncCard();
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
    ['qualities','clients','employees','familyMembers','looms','warpTypes','weftTypes','dyeingUnits','banks'].forEach(key=>{
      document.querySelector(`[data-add="${key}"]`).onclick = async ()=>{
        const name = normalizeMasterName(v(`new_${key}`));
        if(!name) return;
        // Weft types also carry a count; the same name may exist with different counts, so the name AND count together must be unique.
        const isWeft = key === 'weftTypes';
        const isQual = key === 'qualities';
        const warpType = isQual ? String(v('new_qualities_warp')||'').trim() : '';
        const kangiRaw = isQual ? String(v('new_qualities_kangi')||'').trim() : '';
        const kangi = kangiRaw === '' ? null : Number(kangiRaw);
        if(isQual && kangiRaw !== '' && !(kangi > 0)){ showToast('Kangi must be a number above zero (or leave it empty).', 5000); return; }
        const picksRaw = isQual ? String(v('new_qualities_picks')||'').trim() : '';
        const picks = picksRaw === '' ? null : Number(picksRaw);
        if(isQual && picksRaw !== '' && !(picks > 0)){ showToast('Picks must be a number above zero (or leave it empty).', 5000); return; }
        const countRaw = isWeft ? String(v('new_weftTypes_count')||'').trim() : '';
        const count = countRaw === '' ? null : Number(countRaw);
        if(isWeft && countRaw !== '' && !(count > 0)){ showToast('Count must be a number above zero (or leave it empty).', 5000); return; }
        const isCli = key === 'clients';
        const cPhone = isCli ? String(v('new_clients_phone')||'').trim() : '';
        const cAddr = isCli ? String(v('new_clients_address')||'').trim() : '';
        const cLimRaw = isCli ? String(v('new_clients_limit')||'').trim() : '';
        const cLim = cLimRaw === '' ? null : Number(cLimRaw);
        if(isCli && cLimRaw !== '' && !(cLim > 0)){ showToast('Credit limit must be a number above zero (or leave it empty).', 5000); return; }
        const setCli = rec => { if(!isCli) return; if(cPhone) rec.phone = cPhone; else delete rec.phone; if(cAddr) rec.address = cAddr; else delete rec.address; if(cLim) rec.creditLimit = cLim; else delete rec.creditLimit; };
        const labelOf = r => isWeft ? weftTypeLabel(r) : r.name;
        const label = isWeft ? weftTypeLabel({name, count}) : name;
        const editingRec = (EDITING && EDITING.key===key) ? DATA[key].find(r=>r.id===EDITING.id) : null;
        const clash = DATA[key].find(r=> r !== editingRec && masterNameKey(labelOf(r)) === masterNameKey(label));
        if(clash){ showToast(`"${label}" is already in this list.`, 5000); return; }
        const isEmp = key === 'employees';
        const empTitle = isEmp ? String(v('new_employees_title')||'').trim() : '';
        const canSal = isEmp && !!document.getElementById('new_employees_salary');
        const salRaw = canSal ? String(v('new_employees_salary')||'').trim() : '';
        const sal = salRaw === '' ? null : Number(salRaw);
        const salFrom = canSal ? (v('new_employees_from') || todayStr()) : '';
        const salTo = canSal ? (v('new_employees_to') || '') : '';
        const basis = canSal ? v('new_employees_basis') : '';
        if(canSal && basis === 'salary'){
          if(!(sal > 0)){ showToast('Enter the weekly salary, or choose Per meter as the pay basis.', 5000); return; }
          if(salTo && salTo < salFrom){ showToast('Last working day is before the salary start date.', 5000); return; }
        }
        const setEmp = (rec, salKey)=>{
          if(!isEmp) return;
          if(empTitle) rec.title = empTitle; else delete rec.title;
          if(!canSal) return;
          if(basis === 'salary'){ saveStaffSalary(salKey, sal, salFrom, salTo); rec.salaried = true; }
          else if(rec.salaried){ endStaffSalary(salKey, salTo || salaryDayBefore(todayStr())); rec.salaried = false; showToast('Now paid per meter. Salary stops after ' + fmtDate(salTo || salaryDayBefore(todayStr())) + '.', 6000); }
        };
        if(editingRec){
          const oldName = labelOf(editingRec);
          if(oldName !== label && typeof permsRenameBlocked === 'function'){
            const blocked = permsRenameBlocked(key); // Release 3: a rename reaches other sections (a quality's wage rates too); only a role that may edit all of them can do it
            if(blocked){ showToast('Not allowed \u2014 renaming \u201C' + oldName + '\u201D also changes ' + PERM_SECTION_NAME(blocked.sec) + ', which your role can\u2019t edit.', 6000); return; }
          }
          if(isWeft){ if(count) editingRec.count = count; else delete editingRec.count; }
          if(isQual){
            if(warpType) editingRec.warpType = warpType; else delete editingRec.warpType;
            if(picks) editingRec.picks = picks; else delete editingRec.picks;
            if(kangi) editingRec.kangi = kangi; else delete editingRec.kangi;
          }
          setCli(editingRec);
          setEmp(editingRec, oldName);
          editingRec.name = name;
          const changed = (oldName !== label) ? cascadeMasterRename(key, oldName, label) : 0;
          EDITING = null;
          NEXT_UNDO_LABEL = `Renamed "${oldName}" to "${label}"` + (changed ? ` (${changed} record${changed===1?'':'s'} updated)` : '');
          await save(); switchTab('settings');
          return;
        }
        const newRec = {id:uid(), name};
        setCli(newRec);
        setEmp(newRec, name);
        if(isWeft && count) newRec.count = count;
        if(isQual){ if(warpType) newRec.warpType = warpType; if(picks) newRec.picks = picks; if(kangi) newRec.kangi = kangi; }
        DATA[key].push(newRec);
        await save(); switchTab('settings');
      };
      if(key === 'qualities'){
        // Picks + warp type fill the Name (e.g. "62/44 (Micro 150.144)"); it can still be typed over.
        const fillName = ()=>{ const n = qualityAutoName(v('new_qualities_warp'), v('new_qualities_picks'), v('new_qualities_kangi')); if(n) document.getElementById('new_qualities').value = n; };
        ['new_qualities_warp','new_qualities_picks','new_qualities_kangi'].forEach(id=>{ const el = document.getElementById(id); if(el){ el.addEventListener('input', fillName); el.addEventListener('change', fillName); } });
      }
      if(key === 'employees'){
        const basisEl = document.getElementById('new_employees_basis');
        if(basisEl) basisEl.addEventListener('change', ()=> empBasisToggle());
      }
      const inp = document.getElementById(`new_${key}`);
      if(inp) inp.addEventListener('keydown', e=>{
        if(e.key==='Enter'){ e.preventDefault(); document.querySelector(`[data-add="${key}"]`).click(); }
      });
      wireEditGeneric(key, `add_${key}`, `cancel_${key}`, key==='weftTypes' ? {new_weftTypes:'name', new_weftTypes_count:'count'} : key==='qualities' ? {new_qualities:'name', new_qualities_warp:'warpType', new_qualities_picks:'picks', new_qualities_kangi:'kangi'} : key==='clients' ? {new_clients:'name', new_clients_phone:'phone', new_clients_address:'address', new_clients_limit:'creditLimit'} : key==='employees' ? {new_employees:'name', new_employees_title:'title'} : {[`new_${key}`]:'name'}, key==='employees' ? (rec=>{
        const s = staffSalaryOf(rec.name), live = s && s.rates ? s.rates.filter(r=>Number(r.weekly) > 0) : [], last = live.length ? live[live.length-1] : null;
        const set = (id, val)=>{ const el = document.getElementById(id); if(el) el.value = val; };
        set('new_employees_basis', rec.salaried ? 'salary' : 'meter');
        set('new_employees_salary', rec.salaried && last ? last.weekly : ''); set('new_employees_from', rec.salaried && last ? last.date : ''); set('new_employees_to', rec.salaried && s && s.to || '');
        empBasisToggle();
      }) : undefined);
    });
    wireDelete('qualities'); wireDelete('clients'); wireDelete('employees'); wireDelete('familyMembers'); wireDelete('looms'); wireDelete('warpTypes'); wireDelete('weftTypes'); wireDelete('dyeingUnits'); wireDelete('banks');
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
// ---- Inline checks (#13): a warning right under the field for a far-off date, a duplicate entry,
// or a sale above the stock available. Warnings only — they never block saving.
function inlineWarn(fieldId, msg){
  const f = document.getElementById(fieldId); if(!f) return;
  const host = f.closest('.field') || f.parentElement; if(!host) return;
  const id = 'iw_' + fieldId; let el = document.getElementById(id);
  if(!msg){ if(el) el.remove(); return; }
  if(!el){ el = document.createElement('div'); el.id = id; el.className = 'inline-warn'; el.setAttribute('role','status'); host.appendChild(el); }
  el.textContent = '⚠ ' + msg;
}
function runInlineChecks(){
  try{
    const val = id => { const e = document.getElementById(id); return e ? e.value : ''; };
    // Dates far from today (more than a week ahead or two months back)
    document.querySelectorAll('input[type="date"][id$="_date"]').forEach(inp=>{
      if(!/^(s|r|p|ex|f|pex|ol|pl|w|wf|wb|wp|ws|lp|cp)_date$/.test(inp.id)) return;
      let m = '';
      if(inp.value){
        const days = Math.round((new Date(inp.value+'T00:00:00') - new Date(new Date().toDateString())) / 86400000);
        if(days > 7) m = `This date is ${days} days in the future.`;
        else if(days < -60) m = `This date is ${-days} days ago.`;
      }
      inlineWarn(inp.id, m);
    });
    const editId = (key)=> (EDITING && EDITING.key === key) ? EDITING.id : null;
    const dup = (key, pred)=> (DATA[key]||[]).some(r=> r.id !== editId(key) && pred(r));
    if(document.getElementById('s_qty')){ // Sale: duplicate + stock
      const qty = combineMtr16(val('s_qty'), val('s_qty_16')), q = val('s_quality');
      const d = qty > 0 && val('s_date') && val('s_client') && q && dup('sale', r=> r.date===val('s_date') && r.client===val('s_client') && r.quality===q && Number(r.qty)===qty);
      inlineWarn('s_qty', d ? 'A sale with the same date, client, quality and quantity already exists.' : '');
      let stockMsg = '';
      if(qty > 0 && q){
        const row = (computeStats('').stockByQuality||[]).find(r=> r.name === q);
        const ex = editId('sale') ? (DATA.sale.find(r=> r.id === editId('sale'))||{}) : {};
        const avail = (row ? row.stock : 0) + (ex.quality === q ? Number(ex.qty)||0 : 0);
        if(qty > avail + 0.0001) stockMsg = `Only ${fmtQtyMtr(Math.max(avail,0))} mtr of ${q} in stock; this sale is ${fmtQtyMtr(qty)} mtr.`;
      }
      inlineWarn('s_quality', stockMsg);
    }
    if(document.getElementById('p_qty')){ // Production duplicate
      const qty = combineMtr16(val('p_qty'), val('p_qty_16'));
      const d = qty > 0 && val('p_date') && val('p_loom') && dup('production', r=> r.date===val('p_date') && r.loom===val('p_loom') && r.quality===val('p_quality') && Number(r.qty)===qty);
      inlineWarn('p_qty', d ? 'Production for this loom, date, quality and quantity already exists.' : '');
    }
    if(document.getElementById('r_bank')){ // Recovery duplicate (cash + bank)
      const amt = Number(val('r_cash')||0) + Number(val('r_bank')||0);
      const d = amt > 0 && val('r_date') && val('r_client') && dup('recovery', r=> r.date===val('r_date') && r.client===val('r_client') && Number(r.amount)===amt);
      inlineWarn('r_bank', d ? 'A recovery from this client on this date for the same amount already exists.' : '');
    }
  }catch(e){ /* checks are advisory only */ }
}
(function(){
  if(typeof document === 'undefined' || !document.addEventListener || window.__inlineChecks) return; window.__inlineChecks = true;
  ['input','change'].forEach(ev=> document.addEventListener(ev, e=>{ const t = e.target; if(t && t.id && /^(s|r|p|ex|f|pex|ol|pl|w|wf|wb|wp|ws|lp|cp)_/.test(t.id)) runInlineChecks(); }));
})();

function requireFields(checks){
  for(const [ok, msg, fieldId] of checks){
    if(ok) continue;
    showToast(msg);
    const raw = fieldId ? document.getElementById(fieldId) : null;
    if(raw){
      try{
        // enhanceSelects() wraps every <select> into an invisible, non-interactive native
        // element (opacity:0, aria-hidden, tabIndex -1) sitting behind a visible ".sel-fake"
        // button — pointing at the real <select> here would highlight/focus something the
        // user can never see, so redirect to its visible stand-in.
        const target = (raw.tagName === 'SELECT' && raw.parentElement && raw.parentElement.querySelector('.sel-fake'))
          ? raw.parentElement.querySelector('.sel-fake') : raw;
        target.classList.add('field-flag');
        setTimeout(()=> target.classList.remove('field-flag'), 1600);
        target.scrollIntoView({block:'center', behavior:'smooth'});
        // Only steal keyboard focus for a plain text/number field. Doing it on a select's fake
        // button would pop its option list open uninvited, and on a date/time input it pops the
        // native OS picker open uninvited — both more disruptive than just pointing at the
        // field (via the highlight above) and letting the person tap it themselves.
        const type = (target.type || '').toLowerCase();
        if(target.tagName === 'INPUT' && type !== 'date' && type !== 'time'){ target.focus(); }
      }catch(e){ /* best effort */ }
    }
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
  // qtyId is normally a single input's id; pass a [whole, sixteenths] pair instead (see the
  // Sale form) to read the two-box Meters/16ths quantity via combineMtr16.
  const qtyIds = Array.isArray(qtyId) ? qtyId : [qtyId];
  const readQty = () => qtyIds.length > 1 ? combineMtr16(v(qtyIds[0]), v(qtyIds[1])) : Number(v(qtyIds[0])||0);
  const upd = ()=>{
    const qty = readQty(), rate = Number(v(rateId)||0);
    const raw = qty*rate;
    el.textContent = (qty && rate) ? `${label}: ${fmtRs(floorResult ? Math.floor(raw + 1e-6) : raw)}` : `${label}: —`;
  };
  [...qtyIds, rateId].forEach(id=>{
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
  if(key==='qualities'||key==='clients'||key==='employees'||key==='familyMembers'||key==='looms'||key==='warpTypes'||key==='weftTypes'||key==='dyeingUnits'||key==='banks') return 'settings';
  if(key==='rateCalcs') return 'ratecalc';
  if(key==='warpBeams'||key==='warpBeamsFinished') return 'warpbeams';
  if(key==='wageBonuses'||key==='wagePayments'||key==='wageSettlements') return 'wages';
  if(key==='loanPayments') return 'loans';
  if(key==='personalLoans') return 'personalloans';
  if(key==='ownerLoans') return 'ownerloans';
  return key;
}
let RATE_EDITING = null; // {quality, date} of the Rate History entry being edited on the Wages page
function wireDelete(key){
  document.querySelectorAll(`[data-del^="${key}:"]`).forEach(btn=>{
    // Native confirm()/alert() dialogs are blocked in the sandboxed preview this
    // runs in, so a real confirm() call silently no-ops and blocks every delete.
    // Use a two-click "arm, then confirm" pattern on the button itself instead.
    btn.onclick = async ()=>{
      if(!btn.dataset.armed){
        btn.dataset.armed = '1';
        btn.dataset.originalHtml = btn.innerHTML;
        // Keep the icon+label structure (rather than replacing it with plain text) and add
        // .armed so the CSS can widen the button and reveal the label on phones, where a
        // rowbtn is normally a fixed-width icon-only square — plain text there just gets
        // clipped by the button's own overflow:hidden.
        btn.classList.add('armed');
        const lbl = btn.querySelector('.lbl');
        if(lbl) lbl.textContent = 'Confirm'; else btn.textContent = 'Confirm';
        btn.style.color = 'var(--red)';
        btn.style.borderColor = 'var(--red)';
        btn.style.background = '#fff';
        btn._disarmTimer = setTimeout(()=>{
          if(btn.dataset.armed){
            delete btn.dataset.armed;
            btn.classList.remove('armed');
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
      // An L (AIL) shortage pair (see wireLConfirm's Apply handler) is really one unit split
      // across two Sale records: the original (now greyed out/excluded from every total via
      // activeSaleRows, linked forward via lSupersededBy) and the adjustment entry that
      // replaced it (linked back via lAdjustedFromId). Deleting either half alone leaves the
      // other as an orphan — a blurred original with nothing left to explain it, or an
      // adjustment whose "was X, now Y" badge (lBadge in panels-daily.js) loses its reference
      // — so both records go together, whichever end of the pair the delete was tapped on.
      const idsToDelete = new Set([delId]);
      if(key === 'sale'){
        const goneSale = DATA.sale.find(r=>r.id===delId);
        if(goneSale){
          if(goneSale.lAdjustedFromId) idsToDelete.add(goneSale.lAdjustedFromId);
          if(goneSale.lSupersededBy) idsToDelete.add(goneSale.lSupersededBy);
        }
      }
      DATA[key] = DATA[key].filter(r=>!idsToDelete.has(r.id));
      if(key === 'recovery') settleReplacementLinks(goneLinks, [], null);
      if(EDITING && EDITING.key===key && idsToDelete.has(EDITING.id)) EDITING = null;
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
// Wires the Awaiting L (AIL) card (pendingLCardHtml in panels-daily.js): "Apply L (AIL)" is
// a plain reveal toggle — it just shows/hides the L count and Shortage (mtr) boxes
// (data-l-box) for that row, nothing else. Typing an L count auto-fills the Shortage (mtr)
// boxes (Meters / 16ths, same two-box convention as Quantity elsewhere — combineMtr16/
// splitMtr16 in core.js) via the market formula (lShortageMeters/lDeductionAmount in
// calc.js, fractional meters dropped so the 16ths box lands on 0) and updates the live
// deduction preview — but the boxes stay the actual source of truth. Once either has been
// hand-edited (data-manual flag on the whole-meters box), further L count changes no longer
// overwrite them, so a mutually-agreed meter figure that differs from the formula
// (compensating more or less, including a 16ths fraction) sticks and is what "Apply"
// applies; the L count is then only kept on the record for reference. As soon as Shortage
// (mtr) holds a value, the row's own Apply/Cancel pair (data-l-finalrow) appears: "Apply"
// creates a linked adjustment entry — the original stays in the Sales Log as an audit trail
// but is excluded from every balance/total via activeSaleRows() — while "Cancel" makes no
// change to the record at all, it just re-hides the boxes. "L (AIL) OK" (a separate, always-
// visible button) clears the wait with nothing deducted; "Return Lot" records the lot as
// rejected outright. A blank/zero Shortage (mtr) refuses Apply — the L count alone isn't
// enough once L is past the 5 tolerance where the formula isn't confirmed; the negotiated
// meter figure must be typed in for those.
function wireLConfirm(){
  const rateOf = rec => rec.rate || (rec.qty ? (Number(rec.amount)||0)/rec.qty : 0);
  document.querySelectorAll('[data-l-toggle]').forEach(btn=>{
    btn.onclick = ()=>{
      const id = btn.dataset.lToggle;
      document.querySelectorAll(`[data-l-box="${id}"]`).forEach(el=>{ el.hidden = !el.hidden; });
    };
  });
  document.querySelectorAll('[data-l-cancel]').forEach(btn=>{
    btn.onclick = ()=>{
      // Deliberately makes no change to the record — only re-hides what "Apply L (AIL)"
      // (and typing a shortage) revealed.
      const id = btn.dataset.lCancel;
      document.querySelectorAll(`[data-l-box="${id}"]`).forEach(el=>{ el.hidden = true; });
      const finalRow = document.querySelector(`[data-l-finalrow="${id}"]`);
      if(finalRow) finalRow.hidden = true;
      const reasonRow = document.querySelector(`[data-l-reasonrow="${id}"]`);
      if(reasonRow) reasonRow.hidden = true;
    };
  });
  document.querySelectorAll('[data-lcount-input]').forEach(input=>{
    const saleId = input.dataset.lcountInput;
    const rec = DATA.sale.find(r=>r.id===saleId);
    const preview = document.querySelector(`[data-l-preview="${saleId}"]`);
    const metersInput = document.querySelector(`[data-lmeters-input="${saleId}"]`);
    const meters16Input = document.querySelector(`[data-lmeters16-input="${saleId}"]`);
    const finalRow = document.querySelector(`[data-l-finalrow="${saleId}"]`);
    const reasonRow = document.querySelector(`[data-l-reasonrow="${saleId}"]`);
    if(!rec || !preview || !metersInput || !meters16Input) return;
    const updatePreview = ()=>{
      const meters = combineMtr16(metersInput.value, meters16Input.value);
      if(finalRow) finalRow.hidden = !(meters > 0); // Apply/Cancel only once there's a shortage figure
      if(!(meters > 0)){ preview.textContent = ''; if(reasonRow) reasonRow.hidden = true; return; }
      const deduction = lDeductionAmount(meters, rateOf(rec));
      // If the figure was hand-edited away from what the L count's formula gives, show both —
      // this is exactly the "calculated vs decided" reference so the gap isn't lost by next year.
      const n = Number(input.value) || 0;
      const calc = n > 0 ? lShortageMeters(rec.qty, n) : 0;
      if(calc > 0 && Math.abs(calc - meters) > 1e-6){
        preview.textContent = `Calculated: ${fmtQtyMtr(calc)} mtr (from ${fmtLCount(n)} L) → Decided: ${fmtQtyMtr(meters)} mtr — Deduction: ${fmtRs(deduction)}`;
        if(reasonRow) reasonRow.hidden = false;
      } else {
        preview.textContent = `Shortage: ${fmtQtyMtr(meters)} mtr → Deduction: ${fmtRs(deduction)}`;
        if(reasonRow) reasonRow.hidden = true;
      }
    };
    input.addEventListener('input', ()=>{
      const n = Number(input.value);
      if(metersInput.dataset.manual) { updatePreview(); return; } // hand-edited figure sticks
      if(!(n > 0)){ metersInput.value = ''; meters16Input.value = ''; updatePreview(); return; }
      if(n > 5){ metersInput.value = ''; meters16Input.value = ''; preview.textContent = "L > 5 needs the double-L formula — not set up yet. Type the negotiated shortage (mtr) directly, or use Return Lot."; if(finalRow) finalRow.hidden = true; return; }
      metersInput.value = lShortageMeters(rec.qty, n) || '';
      meters16Input.value = '';
      updatePreview();
    });
    metersInput.addEventListener('input', ()=>{
      metersInput.dataset.manual = '1';
      updatePreview();
    });
    meters16Input.addEventListener('input', ()=>{
      metersInput.dataset.manual = '1';
      updatePreview();
    });
  });
  document.querySelectorAll('[data-l-ok]').forEach(btn=>{
    btn.onclick = async ()=>{
      const rec = DATA.sale.find(r=>r.id===btn.dataset.lOk);
      if(!rec) return;
      rec.lStatus = 'ok'; rec.lCount = 0;
      await save(); switchTab('overview');
    };
  });
  document.querySelectorAll('[data-l-return]').forEach(btn=>{
    btn.onclick = async ()=>{
      const rec = DATA.sale.find(r=>r.id===btn.dataset.lReturn);
      if(!rec) return;
      const input = document.querySelector(`[data-lcount-input="${rec.id}"]`);
      rec.lStatus = 'returned'; rec.lCount = Number(input && input.value) || 0;
      await save(); switchTab('overview');
    };
  });
  document.querySelectorAll('[data-l-confirm]').forEach(btn=>{
    btn.onclick = async ()=>{
      const rec = DATA.sale.find(r=>r.id===btn.dataset.lConfirm);
      if(!rec) return;
      const countInput = document.querySelector(`[data-lcount-input="${rec.id}"]`);
      const metersInput = document.querySelector(`[data-lmeters-input="${rec.id}"]`);
      const meters16Input = document.querySelector(`[data-lmeters16-input="${rec.id}"]`);
      const n = Number(countInput && countInput.value) || 0;
      const meters = combineMtr16(metersInput && metersInput.value, meters16Input && meters16Input.value);
      if(!(meters > 0)){ showToast('Enter the Shortage (mtr) — type an L count to compute it, or type the negotiated meter figure directly.'); return; }
      const rate = rateOf(rec);
      const deduction = lDeductionAmount(meters, rate);
      const calc = n > 0 ? lShortageMeters(rec.qty, n) : 0;
      const differs = calc > 0 && Math.abs(calc - meters) > 1e-6;
      const reasonInput = document.querySelector(`[data-lreason-input="${rec.id}"]`);
      const reason = differs ? (reasonInput && reasonInput.value.trim()) : '';
      const descBit = differs
        ? `L (AIL) adjustment: calculated ${fmtQtyMtr(calc)} mtr (${fmtLCount(n)} L) → decided ${fmtQtyMtr(meters)} mtr${reason ? ` — ${reason}` : ''}`
        : `L (AIL) adjustment of ${fmtQtyMtr(rec.qty)} mtr${n ? `, ${fmtLCount(n)} L (AIL)` : ''}`;
      const adjusted = {
        id: uid(), date: rec.date, invoice: rec.invoice, client: rec.client, quality: rec.quality,
        qty: Number(rec.qty) - meters, rate, amount: (Number(rec.amount)||0) - deduction,
        dyeing: rec.dyeing,
        desc: [rec.desc, descBit].filter(Boolean).join(' — '),
        lAdjustedFromId: rec.id,
      };
      rec.lStatus = 'applied'; rec.lCount = n; rec.lShortageQty = meters; rec.lDeduction = deduction; rec.lSupersededBy = adjusted.id;
      if(differs){ rec.lCalculatedShortageQty = calc; if(reason) rec.lReasonNote = reason; }
      DATA.sale.push(adjusted);
      await save(); switchTab('overview');
    };
  });
}
function empBasisToggle(){
  const b = document.getElementById('new_employees_basis'); if(!b) return;
  document.querySelectorAll('.emp-sal-f').forEach(el=>{ el.style.display = b.value === 'salary' ? '' : 'none'; });
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
      // Bring the form this entry is being edited in into view — not the top of the page, which is
      // somewhere else entirely on pages where the form sits below other cards or under a long log.
      // scrollIntoView works for whichever box scrolls (the page on phones, the panel on wide screens);
      // scroll-margin keeps the card's top clear of the sticky header.
      const target = (addBtn && addBtn.closest('.card')) || formBody;
      if(target){
        const hdr = document.querySelector('header.appbar');
        target.style.scrollMarginTop = ((hdr ? hdr.offsetHeight : 60) + 8) + 'px';
        target.scrollIntoView({behavior:'smooth', block:'start'});
      } else {
        window.scrollTo({top:0, behavior:'smooth'});
      }
    };
  });
  const cancelBtn = document.getElementById(cancelBtnId);
  if(cancelBtn) cancelBtn.onclick = ()=>{
    EDITING = null;
    switchTab(tabForKey(key));
  };
}
