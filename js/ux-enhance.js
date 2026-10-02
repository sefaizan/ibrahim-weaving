/* UX enhancements (v3.17.43+): applied on top of the rendered pages, no page markup is rewritten.
 * 1 required-field * markers + inline errors   2 log search + period chips   6 Today/Yesterday chips
 * 7 Enter = next field / save                  8 long notes fold into "Notes"  12 autofocus after save
 * Loaded after i18n.js, before lock-init.js (which must stay last). */
(function(){
  'use strict';
  const REQ = new Set(["cp_date", "ex_amt", "ex_date", "ex_to", "f_amt", "f_date", "lp_amt", "lp_date", "lp_emp", "ol_amt", "ol_date", "p_date", "p_loom", "p_qty", "p_quality", "pex_amt", "pex_date", "pl_amt", "pl_date", "pl_person", "r_client", "r_date", "rc_quality", "s_client", "s_date", "s_inv", "s_qty", "s_quality", "w_date", "w_rate", "wb_amt", "wb_date", "wb_emp", "wb_length", "wb_loom", "wb_purchase", "wf_bags", "wf_date", "wf_rate", "wp_amt", "wp_date", "wp_emp", "wq_date", "wq_emp", "ws_date", "ws_emp"]);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const panels = () => document.getElementById('panels');

  /* ---- 1. required markers + inline error under the field ---- */
  function markRequired(root){
    REQ.forEach(id => {
      const el = (root || document).querySelector('#' + id);
      const lab = el && el.closest('.field') && el.closest('.field').querySelector('label');
      if(lab && !lab.dataset.req && !/optional|اختیاری/i.test(lab.textContent)){ lab.dataset.req = '1'; lab.insertAdjacentHTML('beforeend', ' <span class="req" aria-hidden="true">*</span>'); }
    });
  }
  function clearErr(box){ const e = box && box.querySelector('.field-err'); if(e) e.remove(); }
  if(typeof window.requireFields === 'function'){
    const orig = window.requireFields;
    window.requireFields = function(checks){
      $$('.field-err').forEach(e => e.remove());
      const ok = orig.apply(this, arguments);
      if(!ok){
        try{
          const bad = (checks || []).find(c => !c[0] && c[2]);
          const raw = bad && document.getElementById(bad[2]);
          const box = raw && (raw.closest('.field') || raw.parentElement);
          if(box){
            const d = document.createElement('div'); d.className = 'field-err'; d.setAttribute('role', 'alert'); d.textContent = bad[1];
            box.appendChild(d);
            const off = () => { clearErr(box); box.removeEventListener('input', off); box.removeEventListener('click', off); };
            box.addEventListener('input', off); box.addEventListener('click', off);
            box.scrollIntoView({block:'center', behavior:'smooth'});
          }
        }catch(e){}
      }
      return ok;
    };
  }

  /* ---- 2. search + period chips above each log table ---- */
  const parseRowDate = tr => {
    const m = tr.textContent.match(/(\d{2})-(\d{2})-(\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  };
  function applyLog(bar){
    const wrap = bar.nextElementSibling; if(!wrap) return;
    const q = bar.querySelector('input').value.trim().toLowerCase();
    const per = (bar.querySelector('.on') || {}).dataset ? bar.querySelector('.on').dataset.p : 'all';
    const now = new Date(); now.setHours(0,0,0,0);
    const from = per === 'today' ? now : per === '7' ? new Date(now - 6*864e5) : per === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1) : null;
    let shown = 0;
    $$('tbody tr', wrap).forEach(tr => {
      let ok = !q || tr.textContent.toLowerCase().includes(q);
      if(ok && from){ const d = parseRowDate(tr); ok = !!d && d >= from; }
      tr.hidden = !ok; if(ok) shown++;
    });
    bar.querySelector('.lf-count').textContent = (q || from) ? shown + ' shown' : '';
  }
  function addLogBar(wrap){
    if(wrap.dataset.lf || wrap.closest('.wg-sheet')) return;
    if($$('tbody tr', wrap).length < 6 || !parseRowDate($$('tbody tr', wrap)[0] || document.body)) return;
    wrap.dataset.lf = '1';
    const bar = document.createElement('div'); bar.className = 'log-filter';
    bar.innerHTML = '<input type="search" placeholder="Search this log…" aria-label="Search this log">' +
      '<div class="lf-chips">' + [['all','All'],['today','Today'],['7','7 days'],['month','This month']].map((c, i) => '<button type="button" class="lf-chip' + (i ? '' : ' on') + '" data-p="' + c[0] + '">' + c[1] + '</button>').join('') + '</div><span class="lf-count"></span>';
    wrap.parentNode.insertBefore(bar, wrap);
    bar.addEventListener('input', () => applyLog(bar));
    bar.addEventListener('click', e => { const b = e.target.closest('.lf-chip'); if(!b) return; $$('.lf-chip', bar).forEach(x => x.classList.toggle('on', x === b)); applyLog(bar); });
  }

  /* ---- 6. Today / Yesterday chips beside entry dates ---- */
  const iso = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  function addDateChips(inp){
    if(inp.dataset.qd || /^(rf_|wg)|filter|from|to$/i.test(inp.id) || !inp.closest('.card') || inp.closest('.wg-sheet')) return;
    if(!inp.closest('.card').querySelector('button.primary')) return;
    inp.dataset.qd = '1';
    const d = document.createElement('div'); d.className = 'qd';
    d.innerHTML = '<button type="button" data-o="0">Today</button><button type="button" data-o="1">Yesterday</button>';
    d.addEventListener('click', e => {
      const b = e.target.closest('button'); if(!b) return;
      const t = new Date(); t.setDate(t.getDate() - +b.dataset.o);
      inp.value = iso(t); inp.dispatchEvent(new Event('input', {bubbles:true})); inp.dispatchEvent(new Event('change', {bubbles:true}));
    });
    inp.insertAdjacentElement('afterend', d);
  }

  /* ---- 8. fold long help notes (after the buttons) into a "Notes" toggle ---- */
  function foldNotes(card){
    $$(':scope > .note, :scope > .info-note', card).forEach(n => {
      if(n.dataset.fold || n.textContent.length < 90 || n.closest('details')) return;
      const btn = card.querySelector('button.primary'); if(!btn) return;
      if(!(btn.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
      n.dataset.fold = '1';
      const det = document.createElement('details'); det.className = 'note-fold';
      det.innerHTML = '<summary>ℹ︎ Notes</summary>';
      n.parentNode.insertBefore(det, n); det.appendChild(n);
    });
  }

  /* ---- 1b. rarely-used optional fields tucked under "More details" (opens itself when they hold data) ---- */
  function hasVal(box){ return $$('input,select,textarea', box).some(e => e.type==='checkbox' ? e.checked : (e.value||'').trim() !== ''); }
  function foldFields(root, ids, title, label){
    const first = root.querySelector('#' + ids[0]); if(!first || first.closest('.more-fold')) return;
    const fields = ids.map(i => { const e = root.querySelector('#' + i); return e && e.closest('.field'); }).filter(Boolean);
    if(!fields.length) return;
    const lastGrid = fields[fields.length-1].closest('.grid');
    const det = document.createElement('details'); det.className = 'more-fold';
    det.innerHTML = '<summary>' + title + '</summary><div class="grid cols-2"></div>';
    lastGrid.parentNode.insertBefore(det, lastGrid.nextSibling);
    const g = det.querySelector('.grid');
    fields.forEach(f => { const old = f.parentNode; g.appendChild(f); if(old && old.classList.contains('grid') && !old.querySelector('.field')) old.remove(); });
    /* empty spacer grids left behind */
    $$('.grid', root).forEach(x => { if(!x.children.length || (x.children.length===1 && x.firstElementChild.matches('div:empty'))) x.remove(); });
  }
  function foldBlock(root, anchorId, title){
    const a = root.querySelector('#' + anchorId); if(!a || a.closest('.more-fold')) return;
    const blk = a.parentNode; if(!blk || blk.matches('.card,.panel')) return;
    const det = document.createElement('details'); det.className = 'more-fold';
    det.innerHTML = '<summary>' + title + '</summary>';
    blk.parentNode.insertBefore(det, blk); det.appendChild(blk);
  }
  function autoOpen(root){
    $$('details.more-fold', root).forEach(d => { if(!d.open && hasVal(d)) d.open = true; });
    const rows = root.querySelector('#r_chequeRows');
    const cf = rows && rows.closest('.more-fold'); if(cf && rows.children.length) cf.open = true;
  }

  function enhance(){
    const root = panels(); if(!root) return;
    foldFields(root, ['s_inv','s_dyeing'], 'More details — invoice no, dyeing');
    foldBlock(root, 'r_chequeRows', '+ Cheques (optional)');
    autoOpen(root);
    markRequired(root);
    $$('.log-scroll', root).forEach(addLogBar);
    $$('input[type="date"]', root).forEach(addDateChips);
    $$('.card', root).forEach(foldNotes);
  }
  let t = null;
  const sched = () => { clearTimeout(t); t = setTimeout(enhance, 120); };
  function boot(){
    const root = panels(); if(!root) return;
    new MutationObserver(sched).observe(root, {childList:true, subtree:true});
    enhance();
    root.addEventListener('click', () => setTimeout(() => autoOpen(root), 200));

    /* ---- 7. Enter = next field, last field = save ---- */
    root.addEventListener('keydown', e => {
      if(e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      const el = e.target;
      if(!el.matches || !el.matches('input:not([type=search]):not([type=checkbox]):not([type=file]):not([type=button])')) return;
      const card = el.closest('.card'); if(!card || el.closest('.wg-sheet') || el.closest('.log-filter')) return;
      const go = card.querySelector('button.primary'); if(!go) return;
      const fields = $$('input:not([type=hidden]):not([type=search]):not([type=checkbox]):not([type=file]):not(:disabled), textarea', card).filter(x => x.offsetParent && !x.closest('.log-filter'));
      const i = fields.indexOf(el); if(i < 0) return;
      e.preventDefault();
      if(i < fields.length - 1) fields[i + 1].focus(); else go.click();
    });

    /* ---- 12. after Save, jump back to the first empty field for the next entry ---- */
    root.addEventListener('click', e => {
      const b = e.target.closest('button.primary'); if(!b || b.closest('.wg-sheet')) return;
      const card = b.closest('.card'); if(!card) return;
      setTimeout(() => {
        const f = $$('input:not([type=hidden]):not([type=date]):not([type=time]):not([type=search]):not([type=checkbox]):not([type=file])', card).find(x => x.offsetParent && !x.disabled);
        if(f && !f.value && !document.querySelector('.field-err') && !card.querySelector('.field-flag')) f.focus({preventScroll:true});
      }, 450);
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
