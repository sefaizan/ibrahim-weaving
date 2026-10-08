/* Share an alert on WhatsApp (Settings > Send an alert, owner's phone).
 * Pick Stock (by quality), Weft, Warp beams, Cheques or your own text. The message is built here from the live ledger,
 * shown in a box you can edit, and "Send in WhatsApp" opens WhatsApp with it ready: choose a person or a group and send.
 * No server and nothing leaves the phone except what you send in WhatsApp. WhatsApp keeps a message for a person whose
 * phone is offline until it is back online. Who sees what is decided by who is in each WhatsApp group.
 * Needs (from other files): computeStats, weftStockEstimate, computeBeamForecasts, beamAlertText, beamAlertDays,
 *   computePendingCheques, todayStr, dateAddDays, fmtRs, fmtQtyMtr, escHtml, showToast.
 */
function alertNum(n, dec){ return (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: dec == null ? 0 : dec }); }
function alertMtr(n){ return typeof fmtQtyMtr === 'function' ? fmtQtyMtr(n) : alertNum(n, 1) + ' m'; }
function alertAsOf(){ return 'As of ' + new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }); }
function alertStockText(rows, total){
  const lines = (rows || []).filter(r => Number(r.stock) > 0.0001).map(r => '▪️ ' + r.name + ': ' + alertMtr(r.stock));
  if(!lines.length) lines.push('No stock in hand.');
  lines.push('*Total: ' + alertMtr(total) + '*', alertAsOf());
  return { title: '📦 Stock by quality', body: lines.join('\n') };
}
function alertWeftText(e){
  if(!e || !e.hasData) return { title: '🧵 Weft stock', body: 'No weft purchases recorded yet.\n' + alertAsOf() };
  const lines = [alertNum(Math.max(e.bags, 0), 1) + ' bags (' + alertNum(Math.max(e.lbs, 0)) + ' lbs)'];
  lines.push(e.cover === null ? 'No recent production to measure the pace.' : 'About ' + alertNum(e.cover, 1) + ' days left at ' + alertNum(e.perDay) + ' lbs per day.');
  if(e.low) lines.push('🚨 Order weft NOW - stock is running low!');
  lines.push(alertAsOf());
  return { title: e.low ? '🚨 WEFT RUNNING LOW 🚨' : '🧵 Weft stock', body: lines.join('\n') };
}
function alertBeamText(list, days){
  const body = (list && list.length) ? list.map(f => '⏰ ' + beamAlertText(f)).join('\n') : 'No beam is ending within ' + days + ' days.';
  return { title: list && list.length ? '🚨 BEAMS ENDING SOON 🚨' : '🔧 Warp beams', body: body + '\n' + alertAsOf() };
}
function alertChequeText(pending, today, soon){
  const withDate = pending.filter(c => c.chequeDate);
  const over = withDate.filter(c => c.chequeDate < today), due = withDate.filter(c => c.chequeDate >= today && c.chequeDate <= soon);
  const sum = l => l.reduce((s, c) => s + (Number(c.amount) || 0), 0), shown = over.concat(due), lines = [];
  if(over.length) lines.push('❌ ' + over.length + ' OVERDUE: ' + fmtRs(sum(over)));
  if(due.length) lines.push('⏰ ' + due.length + ' due within 7 days: ' + fmtRs(sum(due)));
  if(!shown.length) lines.push('✅ No cheques overdue or due within 7 days.');
  shown.slice(0, 8).forEach(c => lines.push((c.chequeDate < today ? '❌ ' : '⏰ ') + (c.client || '?') + ' - ' + fmtRs(c.amount) + ' - ' + c.chequeDate + (c.chequeDate < today ? ' (OVERDUE)' : '')));
  if(shown.length > 8) lines.push('+ ' + (shown.length - 8) + ' more');
  return { title: over.length ? '🚨 CHEQUES OVERDUE 🚨' : (due.length ? '⏰ Cheques due soon' : '✅ Cheques'), body: lines.join('\n') };
}
// kind -> the message as one piece of text, ready for WhatsApp (title in bold).
function alertBuild(kind){
  let m;
  if(kind === 'stock'){ const st = computeStats(''); m = alertStockText(st.stockByQuality, st.stock); }
  else if(kind === 'weft') m = alertWeftText(weftStockEstimate());
  else if(kind === 'beams'){ const d = beamAlertDays() || 3; m = alertBeamText(computeBeamForecasts(d).filter(f => f.state === 'full' || f.state === 'ending' || f.state === 'soon'), d); }
  else if(kind === 'cheques'){ const t = todayStr(); m = alertChequeText(computePendingCheques(), t, dateAddDays(t, 7)); }
  else return '';
  return alertJoin(m);
}
function alertJoin(m){ return '*' + m.title + '*\n' + m.body; }
function alertWhatsAppUrl(text){ return 'https://wa.me/?text=' + encodeURIComponent(String(text || '')); }

function alertShareCardHtml(){
  try{ if(typeof permsLimited === 'function' && permsLimited()) return ''; }catch(e){ /* show it */ }   // approved people with a limited role never see this card
  return `<div class="card" id="alertShareCard">
    <div class="card-head"><h2>Send an alert</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>Builds the message from the ledger on this phone and opens WhatsApp with it ready. Choose a person or a group and send. Keep one WhatsApp group per kind of person (for example Stock viewers) so each group gets only what it should see.</p>
    <div class="field" style="max-width:360px"><label for="al_kind">What to send</label>
      <select id="al_kind"><option value="stock">Stock by quality</option><option value="weft">Weft stock</option><option value="beams">Warp beams</option><option value="cheques">Cheques</option><option value="custom">My own message</option></select></div>
    <div class="field"><label for="al_text">Message (you can edit it)</label><textarea id="al_text" rows="7"></textarea></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <a class="primary" id="al_wa" target="_blank" rel="noopener" href="#" style="text-decoration:none;display:inline-flex;align-items:center;padding:0 18px;min-height:44px">Send in WhatsApp</a>
      <button type="button" class="ghost" id="al_refresh" style="margin:0">Refresh figures</button>
    </div>
  </div>`;
}
function alertShareWire(){
  const $ = id => document.getElementById(id);
  const kind = $('al_kind'), text = $('al_text'), wa = $('al_wa');
  if(!kind || !text || !wa) return;
  const sync = () => { wa.href = text.value.trim() ? alertWhatsAppUrl(text.value) : '#'; };
  const fill = () => { text.value = kind.value === 'custom' ? '' : alertBuild(kind.value); if(kind.value === 'custom') text.focus(); sync(); };
  kind.onchange = fill; text.oninput = sync; $('al_refresh').onclick = fill;
  wa.onclick = (e) => { if(!text.value.trim()){ e.preventDefault(); if(typeof showToast === 'function') showToast('Write or build a message first.', 2500); } };
  fill();
}
