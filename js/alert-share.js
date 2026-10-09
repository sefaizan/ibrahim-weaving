/* Share an alert on WhatsApp (Settings > Send an alert, owner's phone).
 * Pick Stock (by quality), Weft, Warp beams, Cheques or your own text. The message is built here from the live ledger,
 * shown in a box you can edit, and "Send in WhatsApp" opens WhatsApp with it ready: choose a person or a group and send.
 * No server and nothing leaves the phone except what you send in WhatsApp. WhatsApp keeps a message for a person whose
 * phone is offline until it is back online. Who sees what is decided by who is in each WhatsApp group.
 * Needs (from other files): computeStats, orderStats, weftStockEstimate, computeBeamForecasts, beamAlertText, beamAlertDays,
 *   computePendingCheques, todayStr, dateAddDays, fmtRs, fmtQtyMtr, escHtml, showToast.
 */
function alertNum(n, dec){ return (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: dec == null ? 0 : dec }); }
function alertMtr(n){ return typeof fmtQtyMtr === 'function' ? fmtQtyMtr(n) : alertNum(n, 1) + ' m'; }
function alertAsOf(){ return '🕒 _As of ' + new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) + '_'; }
function alertBar(p){ const n = Math.max(0, Math.min(10, Math.round((Number(p) || 0) * 10))); return '▓'.repeat(n) + '░'.repeat(10 - n); }
// Order bar: ▓ already delivered, ▒ covered by the stock in hand, ░ still to weave (10 blocks = the whole order).
function alertOrderBar(donePct, stockPct){
  const d = Math.max(0, Math.min(10, Math.round(donePct / 10))), c = Math.max(0, Math.min(10 - d, Math.round(stockPct / 10)));
  return '▓'.repeat(d) + '▒'.repeat(c) + '░'.repeat(10 - d - c);
}
// orders: open orders [{quality, client, no, date, qty, got}]. One quality's stock is shared out oldest order first, so it is never counted twice.
function alertOrderLines(quality, stock, orders){
  let left = Number(stock) || 0;
  const mine = (orders || []).filter(o => o.quality === quality && Number(o.qty) > 0).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.no || '').localeCompare(String(b.no || ''), undefined, { numeric: true }));
  const lines = [];
  mine.slice(0, 3).forEach(o => {
    const qty = Number(o.qty), got = Math.min(Number(o.got) || 0, qty), take = Math.min(left, Math.max(0, qty - got));
    left -= take;
    const doneP = got / qty * 100, stockP = take / qty * 100, total = Math.min(100, Math.round(doneP + stockP));
    lines.push('    👤 ' + (o.client || '?') + (o.no ? ' (' + o.no + ')' : ''), '    ' + alertOrderBar(doneP, stockP) + ' *' + total + '%*  ' + Math.round(doneP) + '% sent + ' + Math.round(stockP) + '% from stock');
  });
  if(mine.length > 3) lines.push('    + ' + (mine.length - 3) + ' more orders');
  return lines;
}
function alertStockText(rows, total, orders){
  const list = (rows || []).filter(r => Number(r.stock) > 0.0001).sort((a, b) => b.stock - a.stock), t = Number(total) || 0, lines = [];
  if(!list.length) lines.push('No stock in hand.');
  else{
    lines.push('🟢 *Total: ' + alertMtr(t) + '*', '');
    let anyOrder = false;
    list.slice(0, 8).forEach(r => {
      lines.push('▪️ *' + r.name + '*: ' + alertMtr(r.stock));
      const ol = alertOrderLines(r.name, r.stock, orders);
      if(ol.length){ anyOrder = true; lines.push(...ol); }
      else{ const share = t > 0 ? r.stock / t : 0; lines.push('    ' + alertBar(share) + ' ' + Math.round(share * 100) + '% of stock'); }
    });
    if(list.length > 8) lines.push('+ ' + (list.length - 8) + ' more');
    if(anyOrder) lines.push('', '_▓ sent  ▒ stock in hand  ░ still to weave_');
  }
  lines.push('', alertAsOf());
  return { title: '📦 STOCK BY QUALITY', body: lines.join('\n') };
}
function alertWeftText(e){
  if(!e || !e.hasData) return { title: '🧵 WEFT STOCK', body: 'No weft purchases recorded yet.\n\n' + alertAsOf() };
  const lines = [(e.low ? '🔴 ' : '🟢 ') + '*' + alertNum(Math.max(e.bags, 0), 1) + ' bags* (' + alertNum(Math.max(e.lbs, 0)) + ' lbs)'];
  lines.push(e.cover === null ? '⏳ No recent production to measure the pace.' : '⏳ About *' + alertNum(e.cover, 1) + ' days* left at ' + alertNum(e.perDay) + ' lbs per day');
  if(e.low) lines.push('', '👉 *Order weft NOW* - stock is running low!');
  lines.push('', alertAsOf());
  return { title: e.low ? '🚨 WEFT RUNNING LOW 🚨' : '🧵 WEFT STOCK', body: lines.join('\n') };
}
function alertBeamText(list, days){
  const has = list && list.length;
  const body = has ? list.map(f => '⏰ ' + beamAlertText(f)).join('\n') + '\n\n👉 Get the next beam ready' : '✅ No beam is ending within ' + days + ' days.';
  return { title: has ? '🚨 BEAMS ENDING SOON 🚨' : '🔧 WARP BEAMS', body: body + '\n\n' + alertAsOf() };
}
function alertChequeText(pending, today, soon){
  const withDate = pending.filter(c => c.chequeDate);
  const over = withDate.filter(c => c.chequeDate < today), due = withDate.filter(c => c.chequeDate >= today && c.chequeDate <= soon);
  const sum = l => l.reduce((s, c) => s + (Number(c.amount) || 0), 0), shown = over.concat(due), lines = [];
  if(over.length) lines.push('❌ *' + over.length + ' OVERDUE:* ' + fmtRs(sum(over)));
  if(due.length) lines.push('⏰ *' + due.length + ' due within 7 days:* ' + fmtRs(sum(due)));
  if(!shown.length) lines.push('✅ No cheques overdue or due within 7 days.');
  else lines.push('');
  shown.slice(0, 8).forEach(c => lines.push((c.chequeDate < today ? '❌ ' : '⏰ ') + (c.client || '?') + ' - ' + fmtRs(c.amount) + ' - ' + c.chequeDate + (c.chequeDate < today ? ' (OVERDUE)' : '')));
  if(shown.length > 8) lines.push('+ ' + (shown.length - 8) + ' more');
  if(over.length) lines.push('', '👉 _Follow up today_');
  return { title: over.length ? '🚨 CHEQUES OVERDUE 🚨' : (due.length ? '⏰ CHEQUES DUE SOON' : '✅ CHEQUES'), body: lines.join('\n') };
}
// Open orders with what is already delivered (from orderStats); empty when the app has none.
function alertOpenOrders(){
  try{ return (typeof DATA !== 'undefined' && DATA.orders || []).filter(o => !o.closed && !o.revoked).map(o => ({ quality: o.quality, client: o.client, no: o.no, date: o.date, qty: Number(o.qty) || 0, got: orderStats(o).got })); }
  catch(e){ return []; }
}
// kind -> the message as one piece of text, ready for WhatsApp (title in bold).
function alertBuild(kind){
  let m;
  if(kind === 'stock'){ const st = computeStats(''); m = alertStockText(st.stockByQuality, st.stock, alertOpenOrders()); }
  else if(kind === 'weft') m = alertWeftText(weftStockEstimate());
  else if(kind === 'beams'){ const d = beamAlertDays() || 3; m = alertBeamText(computeBeamForecasts(d).filter(f => f.state === 'full' || f.state === 'ending' || f.state === 'soon'), d); }
  else if(kind === 'cheques'){ const t = todayStr(); m = alertChequeText(computePendingCheques(), t, dateAddDays(t, 7)); }
  else return '';
  return alertJoin(m);
}
function alertJoin(m){ return '*' + m.title + '*\n━━━━━━━━━━━━━━\n' + m.body; }
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
