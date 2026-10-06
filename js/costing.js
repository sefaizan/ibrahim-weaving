/* Cost & Margin page (v3.18.9). Two views over the model at the end of calc.js:
 *   Quote a rate  - pick a quality, type a sale rate, see cost per meter, margin, break-even and the Grey Cloth Rate formula next to it.
 *   Month profit  - type the month's electricity bill; production, sales, yarn and wage rates come from the ledger.
 * Everything recalculates as you type. Nothing here writes to the ledger except the rules and bills you save. */
let CM_MODE = 'quote';
const CM_LINES = [['warp', 'Warp', 'var(--rust)'], ['weft', 'Weft', 'var(--gold)'], ['wage', 'Wages', 'var(--green)'], ['power', 'Electricity', '#6B8FB5'], ['rent', 'Rent', '#A39580'], ['other', 'Staff and other', '#B07FA0']];
const cmV = id => { const e = document.getElementById(id); return e ? parseFloat(e.value) || 0 : 0; };
const cmR1 = n => (Math.round((n || 0) * 10) / 10).toLocaleString('en-IN', {minimumFractionDigits: 1, maximumFractionDigits: 1});
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
const cmTone = m => m >= 5 ? 'good' : m >= 0 ? 'thin' : 'loss';
function costingPanel(){
  const q = (DATA.qualities || []), c = costCfg(), months = cmMonthList();
  const rent2 = c.rent[c.rent.length - 1];
  return `<div class="cm">
    <div class="cm-seg" role="tablist"><button type="button" data-cm="quote">Quote a rate</button><button type="button" data-cm="month">Month profit</button></div>
    <div id="cm_stick" class="cm-stick"></div><div id="cm_out"></div>
    <div id="cm_quote" class="card">
      <h2>Quote a rate</h2>
      <div class="field"><label>Quality</label><select id="cm_q">${q.map(x => `<option>${escHtml(x.name)}</option>`).join('')}</select></div>
      <div class="cm-g c3">${field('Reed', 'cm_reed', 'number')}${field('Picks', 'cm_picks', 'number')}${field('Width (in)', 'cm_width', 'number')}</div>
      <div class="cm-g c2">${field('Warp rate (Rs/lb)', 'cm_wr', 'number')}${field('Weft rate (Rs/lb)', 'cm_fr', 'number')}</div>
      <div class="cm-g c2">${field('Sale rate (Rs/m)', 'cm_sale', 'number')}${field('Meters per month', 'cm_vol', 'number')}</div>
      <div class="cm-g c2">${field('Electricity (Rs/m)', 'cm_pw', 'number', 'step="0.1"')}${field('Order size (m)', 'cm_ord', 'number', 'value="20000"')}</div>
    </div>
    <div id="cm_month" class="card" hidden>
      <h2>Month profit</h2>
      <div class="cm-g c2"><div class="field"><label>Month</label><select id="cm_mon">${months.map(m => `<option>${m}</option>`).join('')}</select></div>${field('Electricity bill (Rs)', 'cm_bill', 'number')}</div>
      <button type="button" class="primary" id="cm_savebill" style="margin-top:12px">Save bill</button>
    </div>
    <details class="card cm-rules"><summary>Rules behind the estimate</summary>
      <div class="cm-g c2">${field('Rent now (Rs/month)', 'cm_rent1', 'number', `value="${costRent(todayStr().slice(0, 7), c)}"`)}${field('Rent from ' + rent2.from, 'cm_rent2', 'number', `value="${rent2.amount}"`)}
      ${field('Staff and other (Rs/m)', 'cm_other', 'number', `value="${c.otherPerM}"`)}${field('Electricity if no bill (Rs/m)', 'cm_elec', 'number', `value="${c.elecPerM}"`)}
      ${field('Warp lbs: k', 'cm_wk', 'number', `value="${c.warpK}" step="any"`)}${field('Weft lbs: k', 'cm_fk', 'number', `value="${c.weftK}" step="any"`)}</div>
      <p class="note">Warp lbs per meter = k x reed x (width + 2) / count. Weft lbs per meter = k x picks x width. Fitted to your ledger; check them every few months.</p>
      <button type="button" class="primary" id="cm_saverules">Save rules</button>
    </details></div>`;
}
function cmQuoteOut(){
  const c = costCfg(), q = DATA.qualities.find(x => x.name === document.getElementById('cm_q').value) || {}, vol = cmV('cm_vol') || 1;
  const i = {reed: cmV('cm_reed'), picks: cmV('cm_picks'), width: cmV('cm_width'), count: c.warpCount[q.warpType] || 36, warpRate: cmV('cm_wr'), weftRate: cmV('cm_fr'),
    wage: costWageRate(q.name, todayStr()), power: cmV('cm_pw'), rent: costRent(todayStr().slice(0, 7), c) / vol, other: c.otherPerM};
  const b = costBreakdown(i), sale = cmV('cm_sale'), margin = sale - b.total, ord = cmV('cm_ord');
  let formula = '';
  try{
    const f = computeGreyRate({thread: i.reed, width: i.width, widthAdd: c.widthAdd, warpCount: i.count, warpRate: i.warpRate, picks: i.picks, weftCount: c.weftCount, weftRate: i.weftRate, pickRate: (DATA.rateCalcDefaults || {}).pickRate || 0.5, extra: 0});
    if(f && f.finalRate > 0) formula = `<div class="cm-cmp"><div><span>Rate calculator</span><b>Rs ${cmR1(f.finalRate)}</b></div><div><span>Real cost</span><b>Rs ${cmR1(b.total)}</b></div><div><span>Formula leaves</span><b class="${cmTone(f.finalRate - b.total)}">Rs ${cmR1(f.finalRate - b.total)}</b></div></div>`;
  }catch(e){ /* the formula page needs more inputs than this one: skip the comparison */ }
  return `<div class="card cm-res"><div class="cm-hero ${cmTone(margin)}"><small>${sale ? 'Margin per meter' : 'Enter a sale rate'}</small><strong>${sale ? 'Rs ' + cmR1(margin) : '-'}</strong>
    <span>Cost Rs ${cmR1(b.total)}. Break-even Rs ${cmR1(b.total)}${sale && ord ? '. On ' + fmtNum(ord) + ' m: ' + fmtRs(margin * ord) : ''}</span></div>
    ${cmMeter(b.total, sale)}${cmBar(b.lines, b.total)}
    <p class="note">Warp ${b.warpLbs.toFixed(4)} lbs/m, weft ${b.weftLbs.toFixed(4)} lbs/m. Rent is spread over ${fmtNum(vol)} m a month.</p>${formula}</div>`;
}
function cmMonthOut(){
  const mon = document.getElementById('cm_mon').value, r = costMonth(mon, cmV('cm_bill'));
  if(!r.M) return `<div class="card"><p class="note">No production in ${mon}.</p></div>`;
  const rows = r.rows.map(x => `<tr><td>${escHtml(x.quality.split(' (')[0])}<small>${fmtNum(Math.round(x.m))} m</small></td><td>${cmR1(x.cost)}</td><td>${cmR1(x.sale)}</td><td class="${cmTone(x.margin)}">${cmR1(x.margin)}</td><td>${fmtRsShort(x.profit)}</td></tr>`).join('');
  const unl = Math.round((1 - r.linked / r.M) * 100);
  return `<div class="card cm-res"><div class="cm-hero ${cmTone(r.sale - r.cost)}"><small>Estimated profit${r.est ? ' (bill not entered)' : ''}</small><strong>${fmtRs(r.profit)}</strong>
    <span>Rs ${cmR1(r.sale - r.cost)} per meter on ${fmtNum(Math.round(r.M))} m. Sold at Rs ${cmR1(r.sale)}, cost Rs ${cmR1(r.cost)}</span></div>
    ${cmMeter(r.cost, r.sale)}${cmBar(r.lines, r.cost)}
    <div class="cm-scroll"><table class="cm-tbl"><thead><tr><th>Quality</th><th>Cost</th><th>Sale</th><th>Margin</th><th>Profit</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">${r.est ? 'Electricity uses Rs ' + cmR1(r.power) + ' per meter until you enter the bill. ' : ''}${unl > 0 ? unl + '% of meters have no beam link, so warp used the lot being woven that day.' : 'Every meter is linked to its warp lot.'}</p></div>`;
}
function cmCss(){
  if(document.getElementById('cm_css')) return;
  const s = document.createElement('style'); s.id = 'cm_css';
  s.textContent = `.cm-seg{display:flex;gap:4px;padding:4px;background:var(--paper-dim);border-radius:var(--shape-lg);margin-bottom:12px}.cm-seg button{flex:1;border:0;background:none;color:var(--ink-soft);font:700 14px Roboto,sans-serif;padding:10px;border-radius:var(--shape-md);transition:background .2s,color .2s}.cm-seg button.on{background:var(--card);color:var(--rust);box-shadow:0 1px 3px rgba(0,0,0,.18)}
.cm-hero{padding:4px 0 16px}.cm-hero small{display:block;color:var(--ink-soft);font-weight:700}.cm-hero strong{display:block;font:700 46px/1.1 'Roboto Condensed',Roboto,sans-serif;letter-spacing:-.5px;transition:color .25s}.cm-hero span{color:var(--ink-soft);font-size:13px}.good{color:var(--green)}.thin{color:var(--gold)}.loss{color:var(--red)}.cm-hero.good strong,.cm-hero.thin strong,.cm-hero.loss strong{color:inherit}
.cm-meter{position:relative;height:14px;background:var(--paper-dim);border-radius:7px;margin:6px 0 30px}.cm-cost,.cm-gain{position:absolute;top:0;bottom:0;transition:all .35s}.cm-cost{left:0;background:var(--ink-soft);opacity:.55;border-radius:7px 0 0 7px}.cm-gain{background:var(--green)}.cm-gain.neg{background:var(--red)}.cm-mark{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--ink)}.cm-mark span{position:absolute;top:22px;left:-26px;width:54px;text-align:center;font-size:11px;font-weight:700}
.cm-bar{display:flex;height:22px;border-radius:6px;overflow:hidden;gap:2px}.cm-bar i{display:block;transition:width .35s}.cm-leg{list-style:none;margin:12px 0 4px;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:6px 16px}.cm-leg li{display:flex;align-items:center;gap:8px;font-size:13px}.cm-leg b{width:10px;height:10px;border-radius:3px}.cm-leg span{flex:1;color:var(--ink-soft)}.cm-leg em{font-style:normal;font-weight:700}
.cm-cmp{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}.cm-cmp div{display:flex;flex-direction:column;font-size:12px;color:var(--ink-soft)}.cm-cmp b{font-size:16px;color:var(--ink)}.cm-cmp b.good{color:var(--green)}.cm-cmp b.thin{color:var(--gold)}.cm-cmp b.loss{color:var(--red)}
.cm-scroll{overflow-x:auto;margin-top:14px}.cm-tbl{width:100%;border-collapse:collapse;font-size:13px}.cm-tbl th{text-align:right;color:var(--ink-soft);font-weight:700;padding:6px 8px}.cm-tbl td{text-align:right;padding:8px;border-top:1px solid var(--line)}.cm-tbl th:first-child,.cm-tbl td:first-child{text-align:left;font-weight:700}.cm-g{display:grid;gap:10px 12px;margin-top:12px}.cm-g.c2{grid-template-columns:1fr 1fr}.cm-g.c3{grid-template-columns:1fr 1fr 1fr}.cm-g .field{margin:0}.cm-g label{font-size:12px}.cm-g input{width:100%;padding:10px 12px}.cm-tbl small{display:block;color:var(--ink-soft);font-weight:400}.cm-stick{display:none}.cm-stick.show{display:flex}.cm-stick{position:sticky;top:0;z-index:5;justify-content:space-between;align-items:center;padding:8px 14px;margin:-4px 0 8px;border-radius:var(--shape-md);background:var(--card);box-shadow:0 2px 8px rgba(0,0,0,.18);font-size:13px}.cm-stick b{font:700 20px 'Roboto Condensed',Roboto,sans-serif}.cm-stick.good b{color:var(--green)}.cm-stick.thin b{color:var(--gold)}.cm-stick.loss b{color:var(--red)}.cm-rules summary{font-weight:700;cursor:pointer}@media(prefers-reduced-motion:reduce){.cm *{transition:none!important}}`;
  document.head.appendChild(s);
}
function wireCosting(){
  cmCss();
  const c = costCfg(), today = todayStr(), prev = (() => { const d = new Date(today.slice(0, 7) + '-01T00:00:00'); d.setMonth(d.getMonth() - 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); })();
  const set = (id, v) => { const e = document.getElementById(id); if(e) e.value = v; };
  const out = document.getElementById('cm_out');
  const bar = document.querySelector('header.appbar'); document.getElementById('cm_stick').style.top = (bar ? bar.getBoundingClientRect().height : 56) + 'px';
  const io = new IntersectionObserver(es => document.getElementById('cm_stick').classList.toggle('show', !es[0].isIntersecting));
  const draw = () => { out.innerHTML = CM_MODE === 'quote' ? cmQuoteOut() : cmMonthOut(); const h = out.querySelector('.cm-hero'), st = document.getElementById('cm_stick');
    st.className = 'cm-stick ' + (h ? h.className.split(' ')[1] : '') + (st.classList.contains('show') ? ' show' : ''); io.disconnect(); if(h) io.observe(h); st.innerHTML = h ? '<small>' + h.querySelector('small').textContent + '</small><b>' + h.querySelector('strong').textContent + '</b>' : ''; };
  const fill = () => {
    const q = DATA.qualities.find(x => x.name === document.getElementById('cm_q').value) || {}, sales = (DATA.sale || []).filter(s => s.quality === q.name).sort((a, b) => a.date < b.date ? 1 : -1);
    set('cm_reed', q.kangi || ''); set('cm_picks', q.picks || ''); set('cm_width', c.widthByReed[q.kangi] || c.width);
    set('cm_wr', costLastRate(DATA.warp, null, q.warpType) || ''); set('cm_fr', costLastRate(DATA.weft, null) || ''); set('cm_sale', sales[0] ? sales[0].rate : '');
    draw();
  };
  const lastBill = Object.keys(c.bills).sort().pop(), pv = costMonth(prev);
  set('cm_vol', Math.round(pv.M || costMonth(today.slice(0, 7)).M || 40000));
  set('cm_pw', lastBill ? (c.bills[lastBill] / (costMonth(lastBill).M || 1)).toFixed(2) : c.elecPerM);
  const mode = m => { CM_MODE = m; document.getElementById('cm_quote').hidden = m !== 'quote'; document.getElementById('cm_month').hidden = m !== 'month';
    document.querySelectorAll('.cm-seg button').forEach(b => b.classList.toggle('on', b.dataset.cm === m));
    if(m === 'month') set('cm_bill', c.bills[document.getElementById('cm_mon').value] || ''); draw(); };
  document.querySelectorAll('.cm-seg button').forEach(b => b.onclick = () => mode(b.dataset.cm));
  document.getElementById('cm_q').onchange = fill;
  document.querySelectorAll('#cm_quote input,#cm_bill').forEach(e => e.oninput = draw);
  document.getElementById('cm_mon').onchange = () => { set('cm_bill', costCfg().bills[document.getElementById('cm_mon').value] || ''); draw(); };
  const persist = async (fn, btn, msg) => { DATA.costSettings = Object.assign({}, DATA.costSettings || {}); fn(DATA.costSettings); await save(); btn.textContent = msg; setTimeout(() => { btn.textContent = btn.dataset.t; }, 1600); draw(); };
  ['cm_savebill', 'cm_saverules'].forEach(id => document.getElementById(id).dataset.t = document.getElementById(id).textContent);
  document.getElementById('cm_savebill').onclick = e => persist(s => { s.bills = Object.assign({}, s.bills || {}); s.bills[document.getElementById('cm_mon').value] = cmV('cm_bill'); }, e.target, 'Saved');
  document.getElementById('cm_saverules').onclick = e => persist(s => {
    const base = costCfg(), r2 = base.rent[base.rent.length - 1];
    s.rent = [{from: '2026-01', amount: cmV('cm_rent1')}, {from: r2.from, amount: cmV('cm_rent2')}];
    s.otherPerM = cmV('cm_other'); s.elecPerM = cmV('cm_elec'); s.warpK = cmV('cm_wk'); s.weftK = cmV('cm_fk');
  }, e.target, 'Saved');
  fill(); mode(CM_MODE);
}
