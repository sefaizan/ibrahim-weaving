/* Month Profit page + the live "profit at your agreed rate" card on the Grey Cloth Rate page (v3.18.30).
 * Month profit: type the whole electricity bill; wages, expenses, yarn and sales come from the ledger (see costMonth in calc.js). */
const CM_LINES = [['warp', 'Warp', 'var(--rust)'], ['weft', 'Weft', 'var(--gold)'], ['wage', 'Wages', 'var(--green)'], ['power', 'Electricity', '#6B8FB5'], ['other', 'Expenses', '#B07FA0']];
const cmV = id => { const e = document.getElementById(id); return e ? parseFloat(e.value) || 0 : 0; };
const cmR1 = n => (Math.round((n || 0) * 10) / 10).toLocaleString('en-IN', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const cmTone = m => m >= 5 ? 'good' : m >= 0 ? 'thin' : 'loss';
function cmMonthList(){
  const out = [], cur = todayStr().slice(0, 7); let [y, m] = costCfg().startMonth.split('-').map(Number);
  while(y + '-' + String(m).padStart(2, '0') <= cur){ out.unshift(y + '-' + String(m).padStart(2, '0')); if(++m > 12){ m = 1; y++; } }
  return out;
}
function cmBar(lines, total){
  const seg = CM_LINES.map(([k, , c]) => `<i style="width:${total ? lines[k] / total * 100 : 0}%;background:${c}"></i>`).join('');
  const leg = CM_LINES.map(([k, n, c]) => `<li><b style="background:${c}"></b><span>${n}</span><em>${cmR1(lines[k])}</em></li>`).join('');
  return `<div class="cm-bar">${seg}</div><ul class="cm-leg">${leg}</ul>`;
}
function cmMeter(cost, sale){
  if(!(sale > 0)) return '';
  const top = Math.max(sale, cost) * 1.06, ok = sale >= cost;
  return `<div class="cm-meter" aria-hidden="true"><div class="cm-cost" style="width:${Math.min(cost, top) / top * 100}%"></div><div class="cm-gain ${ok ? '' : 'neg'}" style="left:${Math.min(cost, sale) / top * 100}%;width:${Math.abs(sale - cost) / top * 100}%"></div><div class="cm-mark" style="left:${sale / top * 100}%"><span>Rs ${cmR1(sale)}</span></div></div>`;
}
function costingPanel(){
  const c = costCfg(), months = cmMonthList();
  return `<div class="cm"><div id="cm_stick" class="cm-stick"></div><div id="cm_out"></div>
    <div class="card"><h2>Month profit</h2><div class="cm-g c2"><div class="field"><label>Month</label><select id="cm_mon">${months.map(m => `<option>${m}</option>`).join('')}</select></div>${field('Whole electricity bill (Rs)', 'cm_bill', 'number')}</div>
      <button type="button" class="primary" id="cm_savebill" style="margin-top:12px">Save bill</button>
      <p class="note">Everything else comes from your records: all expenses of the month, wages earned on its production (paid or not), yarn used, and sales.</p></div>
    <details class="card cm-rules"><summary>Yarn use rules</summary><div class="cm-g c2">${field('Warp lbs: k', 'cm_wk', 'number', `value="${c.warpK}" step="any"`)}${field('Weft lbs: k', 'cm_fk', 'number', `value="${c.weftK}" step="any"`)}</div>
      <p class="note">Warp lbs per meter = k x reed x (width + 2) / count. Weft lbs per meter = k x picks x width. Fitted to your ledger; check them every few months.</p>
      <button type="button" class="primary" id="cm_saverules">Save rules</button></details></div>`;
}
function cmMonthOut(){
  const mon = document.getElementById('cm_mon').value, r = costMonth(mon, cmV('cm_bill'));
  if(!r.M) return `<div class="card"><p class="note">No production in ${mon}.</p></div>`;
  const rows = r.rows.map(x => `<tr><td>${escHtml(x.quality.split(' (')[0])}<small>${fmtNum(Math.round(x.m))} m</small></td><td>${cmR1(x.cost)}</td><td>${cmR1(x.sale)}</td><td class="${cmTone(x.margin)}">${cmR1(x.margin)}</td><td>${fmtRsShort(x.profit)}</td></tr>`).join('');
  const unl = Math.round((1 - r.linked / r.M) * 100), t = r.totals;
  return `<div class="card cm-res"><div class="cm-hero ${cmTone(r.sale - r.cost)}"><small>Estimated profit${r.est ? ' (bill not entered)' : ''}</small><strong>${fmtRs(r.profit)}</strong>
    <span>Rs ${cmR1(r.sale - r.cost)} per meter on ${fmtNum(Math.round(r.M))} m. Sold at Rs ${cmR1(r.sale)}, cost Rs ${cmR1(r.cost)}</span></div>
    ${cmMeter(r.cost, r.sale)}${cmBar(r.lines, r.cost)}
    <div class="cm-scroll"><table class="cm-tbl"><thead><tr><th>Quality</th><th>Cost</th><th>Sale</th><th>Margin</th><th>Profit</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">Wages ${fmtRs(t.wages)}, electricity ${fmtRs(t.power)}${r.est ? ' (estimate)' : ''}, other expenses ${fmtRs(t.exp)}. Wages and overheads are shared equally per meter.${t.skipped ? ' Salary/Wages expenses of ' + fmtRs(t.skipped) + ' were left out because the Wages page holds staff salaries.' : ''}
    ${unl > 0 ? ' ' + unl + '% of meters have no beam link, so warp used the lot being woven that day.' : ''}</p></div>`;
}
function cmCss(){
  if(document.getElementById('cm_css')) return;
  const s = document.createElement('style'); s.id = 'cm_css';
  s.textContent = `.cm-hero{padding:4px 0 16px}.cm-hero small{display:block;color:var(--ink-soft);font-weight:700}.cm-hero strong{display:block;font:700 46px/1.1 'Roboto Condensed',Roboto,sans-serif;letter-spacing:-.5px}.cm-hero span{color:var(--ink-soft);font-size:13px}.good{color:var(--green)}.thin{color:var(--gold)}.loss{color:var(--red)}
.cm-meter{position:relative;height:14px;background:var(--paper-dim);border-radius:7px;margin:6px 0 30px}.cm-cost,.cm-gain{position:absolute;top:0;bottom:0;transition:all .35s}.cm-cost{left:0;background:var(--ink-soft);opacity:.55;border-radius:7px 0 0 7px}.cm-gain{background:var(--green)}.cm-gain.neg{background:var(--red)}.cm-mark{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--ink)}.cm-mark span{position:absolute;top:22px;left:-26px;width:54px;text-align:center;font-size:11px;font-weight:700}
.cm-bar{display:flex;height:22px;border-radius:6px;overflow:hidden;gap:2px}.cm-bar i{display:block;transition:width .35s}.cm-leg{list-style:none;margin:12px 0 4px;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:6px 16px}.cm-leg li{display:flex;align-items:center;gap:8px;font-size:13px}.cm-leg b{width:10px;height:10px;border-radius:3px}.cm-leg span{flex:1;color:var(--ink-soft)}.cm-leg em{font-style:normal;font-weight:700}
.cm-scroll{overflow-x:auto;margin-top:14px}.cm-tbl{width:100%;border-collapse:collapse;font-size:13px}.cm-tbl th{text-align:right;color:var(--ink-soft);font-weight:700;padding:6px 8px}.cm-tbl td{text-align:right;padding:8px;border-top:1px solid var(--line)}.cm-tbl th:first-child,.cm-tbl td:first-child{text-align:left;font-weight:700}.cm-tbl small{display:block;color:var(--ink-soft);font-weight:400}.cm-rules summary{font-weight:700;cursor:pointer}
.cm-g{display:grid;gap:10px 12px;margin-top:12px}.cm-g.c2{grid-template-columns:1fr 1fr}.cm-g .field{margin:0}.cm-g label{font-size:12px}.cm-g input{width:100%;padding:10px 12px}
.cm-stick{display:none}.cm-stick.show{display:flex}.cm-stick{position:sticky;z-index:5;justify-content:space-between;align-items:center;padding:8px 14px;margin:-4px 0 8px;border-radius:var(--shape-md);background:var(--card);box-shadow:0 2px 8px rgba(0,0,0,.18);font-size:13px}.cm-stick b{font:700 20px 'Roboto Condensed',Roboto,sans-serif}.cm-stick.good b{color:var(--green)}.cm-stick.thin b{color:var(--gold)}.cm-stick.loss b{color:var(--red)}@media(prefers-reduced-motion:reduce){.cm *{transition:none!important}}`;
  document.head.appendChild(s);
}
function wireCosting(){
  cmCss();
  const set = (id, v) => { const e = document.getElementById(id); if(e) e.value = v; }, bar = document.querySelector('header.appbar');
  document.getElementById('cm_stick').style.top = (bar ? bar.getBoundingClientRect().height : 56) + 'px';
  const io = new IntersectionObserver(es => { const k = document.getElementById('cm_stick'); if(k) k.classList.toggle('show', !es[0].isIntersecting); else io.disconnect(); });
  const draw = () => {
    const out = document.getElementById('cm_out'), st = document.getElementById('cm_stick'); out.innerHTML = cmMonthOut();
    const h = out.querySelector('.cm-hero'); st.className = 'cm-stick ' + (h ? h.className.split(' ')[1] : '') + (st.classList.contains('show') ? ' show' : '');
    io.disconnect(); if(h) io.observe(h); st.innerHTML = h ? '<small>' + h.querySelector('small').textContent + '</small><b>' + h.querySelector('strong').textContent + '</b>' : '';
  };
  const loadBill = () => set('cm_bill', costCfg().bills[document.getElementById('cm_mon').value] || '');
  const persist = async (fn, btn) => { DATA.costSettings = Object.assign({}, DATA.costSettings || {}); fn(DATA.costSettings); await save(); const t = btn.textContent; btn.textContent = 'Saved'; setTimeout(() => { btn.textContent = t; }, 1600); draw(); };
  document.getElementById('cm_mon').onchange = () => { loadBill(); draw(); }; document.getElementById('cm_bill').oninput = draw;
  document.getElementById('cm_savebill').onclick = e => persist(s => { s.bills = Object.assign({}, s.bills || {}); s.bills[document.getElementById('cm_mon').value] = cmV('cm_bill'); }, e.target);
  document.getElementById('cm_saverules').onclick = e => persist(s => { s.warpK = cmV('cm_wk'); s.weftK = cmV('cm_fk'); }, e.target);
  loadBill(); draw();
}
// ---- Grey Cloth Rate page: the live card under the Result (called from renderRateCalcResult) ----
let RCP_AGREED = '', RCP_ORD = 20000;
function rcpRender(inp, r){
  const host = document.getElementById('rcpHost'); if(!host) return; cmCss();
  if(!(r.warpValid && r.weftValid)){ host.innerHTML = ''; return; }
  host.innerHTML = `<div class="card"><h2>Profit at your agreed rate</h2><div class="cm-g c2">${field('Agreed rate (Rs/m)', 'rcp_rate', 'number', `step="any" placeholder="${r.finalRate.toFixed(1)}"`)}${field('Order meters', 'rcp_ord', 'number')}</div><div id="rcp_out" class="cm-res" style="margin-top:14px"></div></div>`;
  const rt = document.getElementById('rcp_rate'), od = document.getElementById('rcp_ord'); rt.value = RCP_AGREED; od.value = RCP_ORD;
  const draw = () => {
    RCP_AGREED = rt.value; RCP_ORD = od.value; const agreed = parseFloat(rt.value) || 0, q = costQuote(inp, agreed), ord = parseFloat(od.value) || 0, o = document.getElementById('rcp_out');
    o.innerHTML = `<div class="cm-hero ${agreed ? cmTone(q.margin) : ''}"><small>${agreed ? 'Margin per meter' : 'Type the rate you agreed to see the profit'}</small><strong>${agreed ? 'Rs ' + cmR1(q.margin) : 'Rs ' + cmR1(q.cost)}</strong>
      <span>${agreed ? 'Cost Rs ' + cmR1(q.cost) + '. Formula rate Rs ' + cmR1(r.finalRate) + ', you settled Rs ' + cmR1(Math.abs(r.finalRate - agreed)) + (agreed < r.finalRate ? ' below' : ' above') + (ord ? '. On ' + fmtNum(ord) + ' m: ' + fmtRs(q.margin * ord) : '') : 'cost per meter, which is your break-even rate'}</span></div>
      ${cmMeter(q.cost, agreed)}${cmBar(q.lines, q.cost)}
      <p class="note">Warp ${q.warpLbs.toFixed(4)} lbs/m, weft ${q.weftLbs.toFixed(4)} lbs/m at the rates above. Wages, electricity and expenses are ${q.ref.month}'s totals shared over its meters${q.ref.est ? ' (its electricity bill is not entered yet)' : ''}.</p>`;
  };
  rt.oninput = od.oninput = draw; draw();
}
