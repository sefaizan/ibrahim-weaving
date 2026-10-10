/* Share an alert on WhatsApp (Settings > Send an alert, owner's phone).
 * Pick Stock (by quality), Weft, Warp beams, Cheques or your own text. The message is built here from the live ledger,
 * shown in a box you can edit, and "Send in WhatsApp" opens WhatsApp with it ready: choose a person or a group and send.
 * No server and nothing leaves the phone except what you send in WhatsApp. WhatsApp keeps a message for a person whose
 * phone is offline until it is back online. Who sees what is decided by who is in each WhatsApp group.
 * Needs (from other files): computeStats, orderStats, weftStockEstimate, computeBeamForecasts, beamAlertText, beamAlertDays,
 *   computePendingCheques, todayStr, dateAddDays, fmtRs, fmtQtyMtr, escHtml, showToast.
 */
function alertNum(n, dec){ return (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: dec == null ? 0 : dec }); }

/* ---- language: the messages follow the app language (Urdu when the header button is on "English"), built fresh each time ---- */
function alertUr(){ try{ return typeof I18N_LANG !== 'undefined' && I18N_LANG === 'ur'; }catch(e){ return false; } }
const AL_MONTHS_UR = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'];
// key -> [English, Urdu]; {0} {1} are filled in by al(). Names, quality names, order numbers and dates are never translated.
const AL = {
  stockTitle: ['📦 STOCK IN HAND', '📦 اسٹاک موجود'], noStock: ['No stock in hand.', 'اسٹاک موجود نہیں ہے۔'],
  total: ['Total', 'کل اسٹاک'], more: ['more', 'مزید'], moreOrders: ['more orders', 'مزید آرڈرز'], orders: ['ORDERS', 'آرڈرز'], order: ['Order', 'آرڈر'],
  legend: ['🟩 Sent   🟨 In stock   ⬜ To weave', '🟩 بھیجا گیا   🟨 اسٹاک   ⬜ بننا باقی'],
  sent: ['Sent: *{0}%*', 'بھیجا گیا: *{0}%*'], fromStock: ['From stock: *{0}%*', 'اسٹاک سے: *{0}%*'], toWeave: ['Still to weave: *{0}%*', 'بننا باقی: *{0}%*'],
  weftTitle: ['🧵 WEFT STOCK', '🧵 بانا اسٹاک'], weftLow: ['🚨 WEFT RUNNING LOW 🚨', '🚨 بانا ختم ہو رہا ہے 🚨'],
  noWeft: ['No weft purchases recorded yet.', 'ابھی تک بانے کی کوئی خریداری درج نہیں ہے۔'],
  weftQty: ['*{0} bags* ({1} lbs)', '*{0} بیگ* ({1} پاؤنڈ)'], noPace: ['⏳ No recent production to measure the pace.', '⏳ رفتار جانچنے کے لیے حالیہ پیداوار موجود نہیں ہے۔'],
  weftDays: ['⏳ About *{0} days* left at {1} lbs per day', '⏳ تقریباً *{0} دن* باقی ({1} پاؤنڈ روزانہ کے حساب سے)'],
  weftOrder: ['👉 *Order weft NOW* - stock is running low!', '👉 *بانا ابھی منگوائیں* - اسٹاک کم ہو رہا ہے!'],
  beamTitle: ['🔧 WARP BEAMS', '🔧 تانا بیم'], beamSoon: ['🚨 BEAMS ENDING SOON 🚨', '🚨 بیم جلد ختم ہو رہے ہیں 🚨'],
  beamNext: ['👉 Get the next beam ready', '👉 اگلا بیم تیار رکھیں'], noBeam: ['✅ No beam is ending within {0} days.', '✅ اگلے {0} دنوں میں کوئی بیم ختم نہیں ہو رہا۔'],
  chqOver: ['🚨 CHEQUES OVERDUE 🚨', '🚨 چیک کی میعاد گزر چکی 🚨'], chqSoon: ['⏰ CHEQUES DUE SOON', '⏰ چیک جلد واجب الادا'], chqTitle: ['✅ CHEQUES', '✅ چیک'],
  chqOverN: ['❌ *{0} OVERDUE:* {1}', '❌ *{0} چیک کی میعاد گزر چکی:* {1}'], chqDueN: ['⏰ *{0} due within 7 days:* {1}', '⏰ *{0} چیک 7 دن کے اندر واجب الادا:* {1}'],
  chqNone: ['✅ No cheques overdue or due within 7 days.', '✅ کوئی چیک میعاد گزرا ہوا یا 7 دن کے اندر واجب الادا نہیں ہے۔'],
  overdueTag: [' (OVERDUE)', ' (میعاد گزر چکی)'], followUp: ['👉 _Follow up today_', '👉 _آج ہی رابطہ کریں_'],
  openTitle: ['📋 OPEN ORDERS', '📋 کھلے آرڈرز'], noOrders: ['✅ No open orders.', '✅ کوئی کھلا آرڈر نہیں ہے۔'], ofQty: ['↳ {0} of {1}', '↳ {1} میں سے {0} ڈیلیور'],
  recvTitle: ['💰 MONEY TO RECEIVE', '💰 وصول ہونے والی رقم'], recv: ['🟡 *{0}* to receive from clients', '🟡 گاہکوں سے *{0}* وصول ہونے ہیں'],
  noRecv: ['✅ Nothing to receive from clients', '✅ گاہکوں سے کچھ وصول نہیں ہونا'],
  profitTitle: ['📊 PROFIT AND CASH', '📊 منافع اور نقد'], profit: ['Profit {0}: {1}', 'منافع {0}: {1}'], cash: ['Cash in hand: {0}', 'نقد موجود: {0}'],
  shNone: ['Nothing is ticked yet - the Share button will ask you to choose.', 'ابھی کچھ منتخب نہیں ہے - شیئر بٹن آپ سے انتخاب کے لیے کہے گا۔'],
  shChars: ['({0} characters)', '({0} حروف)'], shLong: ['({0} characters - long, WhatsApp may cut it)', '({0} حروف - پیغام لمبا ہے، واٹس ایپ اسے کاٹ سکتا ہے)'],
  shChoose: ['Choose what to share in Settings first.', 'پہلے سیٹنگز میں چنیں کہ کیا شیئر کرنا ہے۔'], shFail: ['Could not build the message.', 'پیغام نہیں بن سکا۔']
};
function al(k, a, b){
  const v = AL[k], t = v ? (alertUr() ? v[1] : v[0]) : String(k), f = x => String(x == null ? '' : x);
  return t.replace('{0}', () => f(a)).replace('{1}', () => f(b));
}
// Meters: the app's own formatter gives a bare number ("1240" or "1240-8" in sixteenths); the message adds commas and the unit.
function alertMtr(n){
  const base = typeof fmtQtyMtr === 'function' ? fmtQtyMtr(n) : alertNum(n, 1);
  const num = String(base).replace(/^(-?)(\d+)/, (m, sg, d) => sg + Number(d).toLocaleString('en-IN'));
  // Urdu: the quantity is forced left-to-right so 123-12 never flips to 12-123; only the unit word is Urdu.
  return alertUr() ? '\u202A' + num + '\u202C ' + 'میٹر' : num + ' m';
}
function alertRs(n){ const t = typeof fmtRs === 'function' ? fmtRs(n) : 'Rs ' + alertNum(n); return alertUr() ? t.replace(/^Rs\s*/, '') + ' روپے' : t; }
function alertMonthLabel(){ const d = new Date(); return alertUr() ? AL_MONTHS_UR[d.getMonth()] + ' ' + d.getFullYear() : d.toLocaleString('en-GB', { month: 'short', year: 'numeric' }); }
function alertAsOf(){
  const d = new Date();
  if(!alertUr()) return '🕙 *As of ' + d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/i, m => m.toUpperCase()) + '*';
  const h = d.getHours(), part = h < 12 ? 'صبح' : h < 16 ? 'دوپہر' : h < 20 ? 'شام' : 'رات';
  return '🕙 *تازہ ترین: ' + d.getDate() + ' ' + AL_MONTHS_UR[d.getMonth()] + '، ' + (h % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + part + '*';
}
const ALERT_ASOF_RE = /\n*(?:🕙 \*|_)(?:As of|تازہ ترین:) [^\n]*[*_]\s*$/;
function alertBar(p){ const n = Math.max(0, Math.min(10, Math.round((Number(p) || 0) * 10))); return '▓'.repeat(n) + '░'.repeat(10 - n); }
// Order bar: 🟩 already delivered, 🟨 covered by the stock in hand, ⬜ still to weave (10 squares = the whole order).
function alertOrderBar(sentPct, stockPct){
  const d = Math.max(0, Math.min(10, Math.round(sentPct / 10))), c = Math.max(0, Math.min(10 - d, Math.round(stockPct / 10)));
  return '🟩'.repeat(d) + '🟨'.repeat(c) + '⬜'.repeat(10 - d - c);
}
// "62/44 (Micro 150.144)" -> "62/44", like the Orders page; two qualities that would look the same keep their full name.
function alertShortNames(names){
  const short = n => String(n || '').split(' (')[0], count = {};
  names.forEach(n => { count[short(n)] = (count[short(n)] || 0) + 1; });
  const map = {}; names.forEach(n => { map[n] = count[short(n)] > 1 ? String(n) : short(n); });
  return map;
}
// orders: open orders [{quality, no, date, qty, got}]. One quality's stock is shared out oldest order first, so it is never counted twice.
function alertOrderLines(quality, stock, orders){
  let left = Number(stock) || 0;
  const mine = (orders || []).filter(o => o.quality === quality && Number(o.qty) > 0).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.no || '').localeCompare(String(b.no || ''), undefined, { numeric: true }));
  const out = [];
  mine.slice(0, 3).forEach((o, i) => {
    const qty = Number(o.qty), got = Math.min(Number(o.got) || 0, qty), take = Math.min(left, Math.max(0, qty - got));
    left -= take;
    const sent = Math.round(got / qty * 100), stk = Math.round(take / qty * 100), total = Math.min(100, sent + stk);
    if(i) out.push('');
    out.push('*' + (o.no || al('order')) + '*', alertOrderBar(sent, stk) + '  *' + total + '%*' + (total >= 100 ? ' ✅' : ''), al('sent', sent), al('fromStock', stk), al('toWeave', Math.max(0, 100 - total)));
  });
  if(mine.length > 3) out.push('', '+ ' + (mine.length - 3) + ' ' + al('moreOrders'));
  return out;
}
function alertStockText(rows, total, orders){
  const list = (rows || []).filter(r => Number(r.stock) > 0.0001).sort((a, b) => b.stock - a.stock), t = Number(total) || 0, lines = [];
  if(!list.length){ lines.push(al('noStock'), '', alertAsOf()); return { title: al('stockTitle'), body: lines.join('\n') }; }
  const shown = list.slice(0, 8), nm = alertShortNames(shown.map(r => r.name));
  const nameW = Math.max(...shown.map(r => nm[r.name].length)), mtrs = shown.map(r => alertMtr(r.stock)), vis = x => x.replace(/[\u200E\u202A\u202C]/g, ''), mW = Math.max(...mtrs.map(x => vis(x).length));
  const lrm = alertUr() ? '\u200E' : '';   // keeps the name-then-meters columns left to right even though the unit is Urdu
  const HAND = '   👉   ', RULE = '━━━━━━━━━━━━━━';   // spaces round the hand so the number stands apart
  const block = shown.map((r, i) => lrm + '*' + nm[r.name] + '*\n' + HAND + '*' + mtrs[i] + '*').join('\n\n');   // quality on one line, its quantity on the next
  lines.push('🟢 *' + al('total') + ': ' + alertMtr(t) + '*', '', RULE, '', block + (list.length > 8 ? '\n\n+ ' + (list.length - 8) + ' ' + al('more') : ''));
  const og = [];
  shown.forEach(r => { const ol = alertOrderLines(r.name, r.stock, orders); if(ol.length) og.push('*' + nm[r.name] + '*', '', ...ol, ''); });
  if(og.length) lines.push('', RULE, '', '📋 *' + al('orders') + '*', '', ...og, al('legend'));
  lines.push('', RULE, alertAsOf());
  return { title: al('stockTitle'), body: lines.join('\n') };
}
function alertWeftText(e){
  if(!e || !e.hasData) return { title: al('weftTitle'), body: al('noWeft') + '\n\n' + alertAsOf() };
  const lines = [(e.low ? '🔴 ' : '🟢 ') + al('weftQty', alertNum(Math.max(e.bags, 0), 1), alertNum(Math.max(e.lbs, 0)))];
  lines.push(e.cover === null ? al('noPace') : al('weftDays', alertNum(e.cover, 1), alertNum(e.perDay)));
  if(e.low) lines.push('', al('weftOrder'));
  lines.push('', alertAsOf());
  return { title: e.low ? al('weftLow') : al('weftTitle'), body: lines.join('\n') };
}
// One beam line; in Urdu it is worded here, otherwise the app's own wording is used.
function alertBeamLine(f){
  if(!alertUr()) return typeof beamAlertText === 'function' ? beamAlertText(f) : '';
  if(f.state === 'full') return 'لوم ' + f.loom + ' کا بیم پورا بُنا جا چکا ہے — اگلا بیم چڑھائیں یا اسے مکمل کریں';
  const when = f.daysLeft <= 0.5 ? 'آج' : f.daysLeft <= 1.5 ? 'کل' : 'تقریباً ' + Math.round(f.daysLeft) + ' دن میں';
  return 'لوم ' + f.loom + ' کا بیم ' + when + ' ختم ہوگا (~' + Math.round(f.expectedRemaining) + ' میٹر باقی)';
}
function alertBeamText(list, days){
  const has = list && list.length;
  const body = has ? list.map(f => '⏰ ' + alertBeamLine(f)).join('\n') + '\n\n' + al('beamNext') : al('noBeam', days);
  return { title: has ? al('beamSoon') : al('beamTitle'), body: body + '\n\n' + alertAsOf() };
}
function alertChequeText(pending, today, soon){
  const withDate = pending.filter(c => c.chequeDate);
  const over = withDate.filter(c => c.chequeDate < today), due = withDate.filter(c => c.chequeDate >= today && c.chequeDate <= soon);
  const sum = l => l.reduce((s, c) => s + (Number(c.amount) || 0), 0), shown = over.concat(due), lines = [];
  if(over.length) lines.push(al('chqOverN', over.length, alertRs(sum(over))));
  if(due.length) lines.push(al('chqDueN', due.length, alertRs(sum(due))));
  if(!shown.length) lines.push(al('chqNone'));
  else lines.push('');
  shown.slice(0, 8).forEach(c => lines.push((c.chequeDate < today ? '❌ ' : '⏰ ') + (c.client || '?') + ' - ' + alertRs(c.amount) + ' - ' + c.chequeDate + (c.chequeDate < today ? al('overdueTag') : '')));
  if(shown.length > 8) lines.push('+ ' + (shown.length - 8) + ' ' + al('more'));
  if(over.length) lines.push('', al('followUp'));
  return { title: over.length ? al('chqOver') : (due.length ? al('chqSoon') : al('chqTitle')), body: lines.join('\n') };
}
function alertOrdersText(orders){
  const list = (orders || []).filter(o => Number(o.qty) > 0).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.no || '').localeCompare(String(b.no || ''), undefined, { numeric: true })), lines = [];
  if(!list.length) lines.push(al('noOrders'));
  else{
    list.slice(0, 8).forEach((o, i) => {
      const qty = Number(o.qty), got = Math.min(Number(o.got) || 0, qty);
      if(i) lines.push('');
      lines.push((o.no || al('order')) + ' ' + alertBar(got / qty) + ' *' + Math.round(got / qty * 100) + '%*', al('ofQty', alertMtr(got), alertMtr(qty)));
    });
    if(list.length > 8) lines.push('', '+ ' + (list.length - 8) + ' ' + al('moreOrders'));
  }
  lines.push('', alertAsOf());
  return { title: al('openTitle'), body: lines.join('\n') };
}
function alertReceivableText(total){
  const t = Number(total) || 0;
  return { title: al('recvTitle'), body: (t > 0.5 ? al('recv', alertRs(t)) : al('noRecv')) + '\n\n' + alertAsOf() };
}
function alertProfitText(profit, cash, label){
  const p = Number(profit) || 0;
  return { title: al('profitTitle'), body: (p >= 0 ? '📈 ' : '📉 ') + '*' + al('profit', label, alertRs(p)) + '*\n💵 ' + al('cash', alertRs(Number(cash) || 0)) + '\n\n' + alertAsOf() };
}
// Open orders with what is already delivered (from orderStats); empty when the app has none.
function alertOpenOrders(){
  try{ return (typeof DATA !== 'undefined' && DATA.orders || []).filter(o => !o.closed && !o.revoked).map(o => ({ quality: o.quality, client: o.client, no: o.no, date: o.date, qty: Number(o.qty) || 0, got: orderStats(o).got })); }
  catch(e){ return []; }
}
// kind -> the message as one piece of text, ready for WhatsApp (title in bold).
function alertBuild(kind, opts){
  let m;
  if(kind === 'stock'){ const st = computeStats(''), withOrders = opts && opts.orders !== undefined ? !!opts.orders : !!sharePrefs().stockOrders; m = alertStockText(st.stockByQuality, st.stock, withOrders ? alertOpenOrders() : []); }
  else if(kind === 'weft') m = alertWeftText(weftStockEstimate());
  else if(kind === 'beams'){ const d = beamAlertDays() || 3; m = alertBeamText(computeBeamForecasts(d).filter(f => f.state === 'full' || f.state === 'ending' || f.state === 'soon'), d); }
  else if(kind === 'cheques'){ const t = todayStr(); m = alertChequeText(computePendingCheques(), t, dateAddDays(t, 7)); }
  else if(kind === 'orders') m = alertOrdersText(alertOpenOrders());
  else if(kind === 'receivable') m = alertReceivableText(computeStats('').receivable);
  else if(kind === 'profit'){ const st = computeStats(todayStr().slice(0, 7)); m = alertProfitText(st.profitMonth, st.cash, alertMonthLabel()); }
  else return '';
  return alertJoin(m);
}
function alertJoin(m){ return '*' + m.title + '*\n━━━━━━━━━━━━━━\n' + m.body; }
// phone (optional): opens that person's chat directly. 03xx... is read as a Pakistan number (92...). Groups cannot be opened from a link.
function alertPhoneDigits(phone){
  let d = String(phone || '').replace(/\D/g, '');
  if(d.startsWith('00')) d = d.slice(2);
  else if(d.startsWith('0')) d = '92' + d.slice(1);
  return d.length >= 8 ? d : '';
}
function alertWhatsAppUrl(text, phone){ return 'https://wa.me/' + alertPhoneDigits(phone) + '?text=' + encodeURIComponent(String(text || '')); }

function alertShareCardHtml(){
  try{ if(typeof permsLimited === 'function' && permsLimited()) return ''; }catch(e){ /* show it */ }   // approved people with a limited role never see this card
  return `<div class="card" id="alertShareCard">
    <div class="card-head"><h2>Send an alert</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>Builds the message from the ledger on this phone and opens WhatsApp with it ready. Choose a person or a group and send. Keep one WhatsApp group per kind of person (for example Stock viewers) so each group gets only what it should see.</p>
    <div class="field" style="max-width:360px"><label for="al_kind">What to send</label>
      <select id="al_kind"><option value="stock">Stock by quality</option><option value="weft">Weft stock</option><option value="beams">Warp beams</option><option value="cheques">Cheques</option><option value="custom">My own message</option></select></div>
    <label id="al_ord_wrap" style="display:flex;align-items:center;gap:10px;font-weight:500;cursor:pointer;margin:0 0 12px"><input type="checkbox" id="al_ord" style="width:18px;height:18px"><span>Include orders (how much of each open order the stock covers)</span></label>
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
  const ord = $('al_ord'), wrap = $('al_ord_wrap');
  if(ord){ ord.checked = !!sharePrefs().stockOrders; ord.onchange = () => { setSharePrefs(Object.assign(sharePrefs(), { stockOrders: ord.checked })); const f = document.querySelector('.sf_chk[data-key="stockOrders"]'); if(f) f.checked = ord.checked; fill(); }; }
  const fill = () => { if(wrap) wrap.style.display = kind.value === 'stock' ? 'flex' : 'none'; text.value = kind.value === 'custom' ? '' : alertBuild(kind.value); if(kind.value === 'custom') text.focus(); sync(); };
  kind.onchange = fill; text.oninput = sync; $('al_refresh').onclick = fill;
  wa.onclick = (e) => { if(!text.value.trim()){ e.preventDefault(); if(typeof showToast === 'function') showToast('Write or build a message first.', 2500); } };
  fill();
}


/* ---------------- Floating Share button: what it sends (kept on this phone) ---------------- */
const SHARE_PREFS_KEY = 'khata-share-prefs';
const SHARE_SECTIONS = [
  ['stock', 'Stock by quality', 'with how much of each open order it covers'],
  ['orders', 'Open orders', 'how much of each is delivered'],
  ['beams', 'Warp beams', 'beams ending soon'],
  ['weft', 'Weft stock', 'bags and days left'],
  ['cheques', 'Cheques', 'overdue and due within 7 days'],
  ['receivable', 'Money to receive', 'total owed by clients'],
  ['profit', 'Profit and cash', 'this month, and cash in hand']
];
function sharePrefs(){
  const p = { stock: true, beams: true, weft: true, stockOrders: false, note: '', phone: '' };
  try{
    const s = JSON.parse(localStorage.getItem(SHARE_PREFS_KEY) || 'null');
    if(s && typeof s === 'object'){ SHARE_SECTIONS.forEach(x => { if(typeof s[x[0]] === 'boolean') p[x[0]] = s[x[0]]; }); if(typeof s.stockOrders === 'boolean') p.stockOrders = s.stockOrders; if(typeof s.note === 'string') p.note = s.note; if(typeof s.phone === 'string') p.phone = s.phone; }
  }catch(e){ /* use the defaults */ }
  return p;
}
function setSharePrefs(p){ try{ localStorage.setItem(SHARE_PREFS_KEY, JSON.stringify(p)); }catch(e){ /* best effort */ } }
function shareHasContent(p){ return !!(p && (String(p.note || '').trim() || SHARE_SECTIONS.some(x => p[x[0]]))); }
// The ticked sections in one message (your own line on top, a single "As of" line at the end).
function shareBuild(p){
  const parts = [];
  if(String(p.note || '').trim()) parts.push(String(p.note).trim());
  SHARE_SECTIONS.forEach(x => {
    if(!p[x[0]]) return;
    const t = alertBuild(x[0]);
    if(t) parts.push(t.replace(ALERT_ASOF_RE, '').trim());
  });
  if(parts.length && SHARE_SECTIONS.some(x => p[x[0]])) parts.push(alertAsOf());
  return parts.join('\n\n');
}
function shareFabNow(){
  const toast = m => { if(typeof showToast === 'function') showToast(m, 3000); };
  const p = sharePrefs();
  if(!shareHasContent(p)){ toast(al('shChoose')); if(typeof switchTab === 'function') switchTab('settings'); return; }
  let text = '';
  try{ text = shareBuild(p); }catch(e){ if(typeof logErr === 'function') logErr('share', e); toast(al('shFail')); return; }
  const url = alertWhatsAppUrl(text, p.phone);
  const w = window.open(url, '_blank');
  if(!w) window.location.href = url;
}
function shareFabCardHtml(){
  try{ if(typeof permsLimited === 'function' && permsLimited()) return ''; }catch(e){ /* show it */ }
  const p = sharePrefs();
  const rows = SHARE_SECTIONS.map(x => `<label style="display:flex;align-items:flex-start;gap:10px;font-weight:500;cursor:pointer;margin-top:10px"><input type="checkbox" class="sf_chk" data-key="${x[0]}" ${p[x[0]] ? 'checked' : ''} style="width:18px;height:18px;margin-top:2px"><span>${x[1]}<span class="note" style="display:block;font-weight:400;margin:0">${x[2]}</span></span></label>`).join('');
  return `<div class="card" id="shareFabCard">
    <div class="card-head"><h2>Floating Share button</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>Tap the round button at the bottom of any screen, then Share. WhatsApp opens with the message below, built fresh from the ledger. Tick what to include. These choices are kept on this phone only.</p>
    ${rows}
    <label style="display:flex;align-items:flex-start;gap:10px;font-weight:500;cursor:pointer;margin-top:10px;padding-left:28px"><input type="checkbox" class="sf_chk" data-key="stockOrders" ${p.stockOrders ? 'checked' : ''} style="width:18px;height:18px;margin-top:2px"><span>Stock message: include orders<span class="note" style="display:block;font-weight:400;margin:0">adds how much of each open order the stock covers</span></span></label>
    <div class="field" style="margin-top:14px"><label for="sf_note">Your own line on top (optional)</label><input id="sf_note" type="text" maxlength="200" placeholder="e.g. Today's update" value="${typeof escHtml === 'function' ? escHtml(p.note) : ''}"></div>
    <div class="field"><label for="sf_phone">Send to this number (optional)</label><input id="sf_phone" type="tel" inputmode="tel" placeholder="03xx xxxxxxx - leave empty to choose in WhatsApp" value="${typeof escHtml === 'function' ? escHtml(p.phone) : ''}"><p class="note" style="margin-top:4px">A number opens that chat directly. A WhatsApp group cannot be opened from a link, so leave this empty and pick the group in WhatsApp.</p></div>
    <div class="field"><label for="sf_preview">Preview <span id="sf_count" class="note" style="margin:0"></span></label><textarea id="sf_preview" rows="10" readonly></textarea></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="primary" id="sf_test" style="min-height:44px">Share now</button><button type="button" class="ghost" id="sf_refresh" style="margin:0">Refresh preview</button></div>
  </div>`;
}
function shareFabWire(){
  const $ = id => document.getElementById(id);
  if(!$('shareFabCard')) return;
  const read = () => { const p = { note: $('sf_note').value, phone: $('sf_phone').value }; document.querySelectorAll('.sf_chk').forEach(c => { p[c.dataset.key] = c.checked; }); return p; };
  const preview = () => {
    const p = read(); let t = '';
    try{ t = shareHasContent(p) ? shareBuild(p) : ''; }catch(e){ t = al('shFail'); }
    $('sf_preview').value = t || al('shNone');
    $('sf_count').textContent = t ? al(t.length > 3500 ? 'shLong' : 'shChars', t.length) : '';
  };
  const save = () => { const p = read(); setSharePrefs(p); const a = $('al_ord'); if(a && a.checked !== !!p.stockOrders){ a.checked = !!p.stockOrders; const k = $('al_refresh'); if(k) k.click(); } preview(); };
  document.querySelectorAll('.sf_chk').forEach(c => { c.onchange = save; });
  $('sf_note').oninput = save; $('sf_phone').onchange = save; $('sf_refresh').onclick = preview; $('sf_test').onclick = () => { setSharePrefs(read()); shareFabNow(); };
  preview();
}
// Called when the language button is pressed: rebuild the messages in the new language.
function alertLangRefresh(){
  const click = id => { const b = document.getElementById(id); if(b) b.click(); };
  click('al_refresh'); click('sf_refresh');
}
