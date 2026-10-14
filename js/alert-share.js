/* Floating Share button: share what is ticked in Settings > Share on WhatsApp as PICTURES (v3.18.103).
 * Each ticked option (Stock, Open orders, Warp beams, Weft, Cheques, Money to receive, Profit and cash) becomes its OWN picture, made from the
 * ledger on this phone the moment you tap Share. A section with more rows than fit on one picture gets as many pages as it needs, worked out
 * when the pictures are made (like the client statement). The phone's share sheet then opens with all the pictures: pick WhatsApp, then a person
 * or a group. Nothing leaves the phone except what you send. Words follow the app language (Urdu or English); figures always read left to right
 * (3,299-8 is never shown as 8-3,299). Text is shrunk to fit its space, so nothing is ever cut off.
 * Needs (from other files): computeStats, orderStats, weftStockEstimate, computeBeamForecasts, beamAlertDays, computePendingCheques, todayStr,
 *   dateAddDays, fmtQtyMtr, showToast, canShareFiles, BIZ_LOGO_PNG (the business logo shown on every picture).
 */
function alertUr(){ try{ return typeof I18N_LANG !== 'undefined' && I18N_LANG === 'ur'; }catch(e){ return false; } }

/* ---------------- what the pictures say (English / Urdu) ---------------- */
const SP_MON_UR = ['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر'];
const SP_MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SP_TXT = {
  en: {
    stock: 'Stock', orders: 'Open orders', beams: 'Warp beams', weft: 'Weft stock', cheques: 'Cheques', receivable: 'Money to receive', profit: 'Profit and cash',
    quality: 'Quality', meters: 'Meters', deliv: 'Delivered (m)', remain: 'Remaining (m)', loom: 'Loom', now: 'Now', today: 'Today', tomorrow: 'Tomorrow', nextBeam: 'Get the next beam ready',
    bags: 'Bags', lbsLine: n => '(' + n + ' lbs)', daysLeft: 'Days left', perDay: n => 'About ' + n + ' lbs per day', orderWeft: 'Order weft now', rs: 'Rupees',
    recvL: 'To receive from clients', profitL: 'Profit', lossL: 'Loss', cashL: 'Cash in hand',
    late: n => n + (n === 1 ? ' day late' : ' days late'), inD: n => 'in ' + n + (n === 1 ? ' day' : ' days'), dayN: n => n + (n === 1 ? ' day' : ' days'),
    noStock: 'No stock in hand', noOrders: 'No open orders', noBeam: n => 'No beam is ending within ' + n + ' days', noWeft: 'No weft purchases recorded yet', noPace: 'No recent production to measure the pace',
    noChq: 'No cheques overdue or due within 7 days', noRecv: 'Nothing to receive from clients'
  },
  ur: {
    stock: 'اسٹاک', orders: 'کھلے آرڈرز', beams: 'تانا بیم', weft: 'بانا اسٹاک', cheques: 'چیک', receivable: 'وصول ہونے والی رقم', profit: 'منافع اور نقد',
    quality: 'کوالٹی', meters: 'میٹر', deliv: 'ڈیلیور (میٹر)', remain: 'باقی (میٹر)', loom: 'لوم', now: 'ابھی', today: 'آج', tomorrow: 'کل', nextBeam: 'اگلا بیم تیار رکھیں',
    bags: 'بیگ', lbsLine: n => '(' + n + ' پاؤنڈ)', daysLeft: 'دن باقی', perDay: n => 'تقریباً ' + n + ' پاؤنڈ روزانہ', orderWeft: 'بانا ابھی منگوائیں', rs: 'روپے',
    recvL: 'گاہکوں سے وصول ہونے ہیں', profitL: 'منافع', lossL: 'نقصان', cashL: 'نقد موجود',
    late: n => 'لیٹ ' + n + ' دن', inD: n => n + ' دن میں', dayN: n => n + ' دن',
    noStock: 'اسٹاک موجود نہیں ہے', noOrders: 'کوئی کھلا آرڈر نہیں ہے', noBeam: n => 'اگلے ' + n + ' دنوں میں کوئی بیم ختم نہیں ہو رہا', noWeft: 'ابھی تک بانے کی کوئی خریداری درج نہیں ہے', noPace: 'رفتار جانچنے کے لیے حالیہ پیداوار موجود نہیں ہے',
    noChq: 'کوئی چیک لیٹ یا 7 دن کے اندر واجب الادا نہیں', noRecv: 'گاہکوں سے کچھ وصول نہیں ہونا'
  }
};
function spL(){ return SP_TXT[alertUr() ? 'ur' : 'en']; }

/* ---------------- small helpers ---------------- */
function spNum(n){ return Math.round(Number(n) || 0).toLocaleString('en-IN'); }
// Meters: the app's own formatter gives a bare number ("1240" or "1240-8" in sixteenths); the picture adds the commas.
function spMtr(n){
  const base = typeof fmtQtyMtr === 'function' ? fmtQtyMtr(n) : String(Math.round(Number(n) || 0));
  return String(base).replace(/^(-?)(\d+)/, (m, sg, d) => sg + Number(d).toLocaleString('en-IN'));
}
// "62/44 (Micro 150.144)" -> "62/44", like the Orders page; two qualities that would look the same keep their full name.
function spShortNames(names){
  const short = n => String(n || '').split(' (')[0], count = {};
  names.forEach(n => { count[short(n)] = (count[short(n)] || 0) + 1; });
  const map = {}; names.forEach(n => { map[n] = count[short(n)] > 1 ? String(n) : short(n); });
  return map;
}
function spDmy(s){ const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(s || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : String(s || ''); }
function spDayDiff(from, to){
  const p = s => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  return Math.round((p(to) - p(from)) / 86400000);
}
function spMonthLabel(){ const d = new Date(); return (alertUr() ? SP_MON_UR : SP_MON_EN)[d.getMonth()] + ' ' + d.getFullYear(); }

/* ---------------- the ledger, shaped for each picture ---------------- */
// Open orders with what is already delivered and the client (from orderStats); empty when the app has none.
function spOpenOrders(){
  try{
    return (typeof DATA !== 'undefined' && DATA.orders || []).filter(o => !o.closed && !o.revoked)
      .map(o => ({ quality: o.quality, client: o.client || '', no: o.no, date: o.date, qty: Number(o.qty) || 0, got: orderStats(o).got }))
      .filter(o => o.qty > 0)
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.no || '').localeCompare(String(b.no || ''), undefined, { numeric: true }));
  }catch(e){ return []; }
}
function spBeamWhen(f){ return f.state === 'full' ? 'now' : f.daysLeft <= 0.5 ? 'today' : f.daysLeft <= 1.5 ? 'tomorrow' : Math.round(f.daysLeft); }
function spCollect(id){
  if(id === 'stock'){
    const st = computeStats(''), list = (st.stockByQuality || []).filter(r => Number(r.stock) > 0.0001).sort((a, b) => b.stock - a.stock), nm = spShortNames(list.map(r => r.name));
    return { rows: list.map(r => [nm[r.name], Number(r.stock)]) };
  }
  if(id === 'orders'){
    const list = spOpenOrders(), nm = spShortNames(Array.from(new Set(list.map(o => o.quality))));
    return { rows: list.map(o => ({ no: o.no || '', client: o.client, q: o.quality ? nm[o.quality] : '', qty: o.qty, got: Math.min(Number(o.got) || 0, o.qty) })) };
  }
  if(id === 'beams'){
    const days = (typeof beamAlertDays === 'function' && beamAlertDays()) || 3, key = f => f.state === 'full' ? -1 : f.daysLeft;
    const list = computeBeamForecasts(days).filter(f => f.state === 'full' || f.state === 'ending' || f.state === 'soon').sort((a, b) => key(a) - key(b));
    return { days, rows: list.map(f => [f.loom, spBeamWhen(f)]) };
  }
  if(id === 'weft') return { e: weftStockEstimate() };
  if(id === 'cheques'){
    const t = todayStr(), soon = dateAddDays(t, 7), withDate = computePendingCheques().filter(c => c.chequeDate), byDate = (a, b) => String(a.chequeDate).localeCompare(String(b.chequeDate));
    const over = withDate.filter(c => c.chequeDate < t).sort(byDate).map(c => ({ client: c.client || '?', amt: Number(c.amount) || 0, date: c.chequeDate, over: spDayDiff(c.chequeDate, t) }));
    const due = withDate.filter(c => c.chequeDate >= t && c.chequeDate <= soon).sort(byDate).map(c => ({ client: c.client || '?', amt: Number(c.amount) || 0, date: c.chequeDate, over: 0, inD: spDayDiff(t, c.chequeDate) }));
    return { rows: over.concat(due) };
  }
  if(id === 'receivable') return { total: Number(computeStats('').receivable) || 0 };
  if(id === 'profit'){ const st = computeStats(todayStr().slice(0, 7)); return { profit: Number(st.profitMonth) || 0, cash: Number(st.cash) || 0, label: spMonthLabel() }; }
  return {};
}

/* ---------------- the colours of the app (light, like the receipts, so a picture reads the same in any theme) ---------------- */
const SP_W = 1080, SP_HEAD = 170, SP_MAXH = 1560;   // a picture stays under ~1600px tall: chat apps shrink anything bigger and the text goes soft
const SP_C = { b1: '#204E52', b2: '#163B3D', ink: '#1B2126', soft: '#626B72', line: '#B9C2C9', tonal: '#DCEDEB', deep: '#163B3D', green: '#3D8361', red: '#B5402E', redT: '#F7E0DB', goldT: '#F3DFCB', goldInk: '#8A4A1D', zebra: '#F3F5F7', white: '#FFFFFF' };
const SP_SANS = "Roboto, 'Segoe UI', Arial, sans-serif";
const SP_URDU = "'Noto Naskh Arabic', 'Geeza Pro', 'Segoe UI', Tahoma, sans-serif";
const SP_LRE = '\u202A', SP_PDF = '\u202C', SP_AR = /[\u0600-\u06FF]/;

// Drawing tools on one canvas. Positions are measured from the reading-start side (right in Urdu, left in English).
//   k: 'n' = figures and codes (always left to right), 'u' = words (right to left in Urdu), 'c' = a typed name (its own script decides).
//   max: the text shrinks (then is shortened with "...") until it fits this width.
//   a: 'start' (xs = distance from the start edge) | 'end' (xs = distance from the END edge, text ends there) | 'c' / 'l' / 'r' (with abs: true, xs is the exact x)
function spHelper(ctx, W, ur, logo){
  const h = { x: ctx, W, ur, L: SP_TXT[ur ? 'ur' : 'en'] };
  const sx = xs => ur ? W - xs : xs;
  h.rect = (x, y, w, hh, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, hh); };
  h.rr = (x, y, w, hh, r, col) => {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
  };
  h.kind = (str, k) => k === 'c' ? (SP_AR.test(str) ? 'a' : 'n') : k;
  h.font = (size, wt, k) => {
    const isU = k === 'a' || (ur && k === 'u');
    ctx.font = (wt || 700) + ' ' + size + 'px ' + (isU ? SP_URDU : SP_SANS);
    ctx.direction = (k === 'n' || (!ur && k === 'u')) ? 'ltr' : 'rtl';
    return isU;
  };
  h.w = (str, size, wt, k) => { k = h.kind(str, k || 'u'); h.font(size, wt, k); return ctx.measureText(k === 'n' ? SP_LRE + str + SP_PDF : str).width; };
  h.t = (str, xs, y, o) => {
    o = o || {}; let size = o.size || 64; const k = h.kind(str, o.k || 'u'), a = o.a || 'start', wt = o.wt || 700;
    let txt = String(str), s = k === 'n' ? SP_LRE + txt + SP_PDF : txt;
    if(o.max){
      while(size > 26){ h.font(size, wt, k); if(ctx.measureText(s).width <= o.max) break; size -= 2; }
      // Even the smallest size is too wide (a very long name): shorten it with "…" rather than let it run off the picture.
      h.font(size, wt, k);
      while(txt.length > 1 && ctx.measureText(s).width > o.max){ txt = txt.slice(0, -1).trimEnd(); s = (k === 'n' ? SP_LRE : '') + txt + '…' + (k === 'n' ? SP_PDF : ''); }
    }
    const isU = h.font(size, wt, k);
    ctx.fillStyle = o.c || SP_C.ink; ctx.textBaseline = 'middle';
    ctx.textAlign = a === 'c' ? 'center' : a === 'l' ? 'left' : a === 'r' ? 'right' : a === 'start' ? (ur ? 'right' : 'left') : (ur ? 'left' : 'right');
    ctx.fillText(s, o.abs ? xs : a === 'end' ? (ur ? xs : W - xs) : sx(xs), y + (isU ? size * 0.06 : 0));
    return ctx.measureText(s).width;
  };
  // Centred words that wrap onto more lines when too long. Returns the number of lines.
  h.wrap = (str, cx, y, maxW, size, lh, o) => {
    o = o || {}; const words = String(str).split(' '), lines = []; let cur = '';
    words.forEach(w => { const test = cur ? cur + ' ' + w : w; if(!cur || h.w(test, size, o.wt || 700, 'u') <= maxW) cur = test; else { lines.push(cur); cur = w; } });
    if(cur) lines.push(cur);
    lines.forEach((ln, i) => h.t(ln, cx, y + i * lh, { size, c: o.c, wt: o.wt, a: 'c', abs: true, max: maxW }));
    return lines.length;
  };
  // One header line: the business logo on a white card at the left, then the title centred in the space that is left, with the date under it.
  h.band = (title, pg) => {
    const g = ctx.createLinearGradient(0, 0, W * 0.5, SP_HEAD); g.addColorStop(0, SP_C.b1); g.addColorStop(1, SP_C.b2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, SP_HEAD);
    const has = !!(logo && logo.naturalWidth), lh = 100, lw = has ? lh * logo.naturalWidth / logo.naturalHeight : 319, bx = 22, by = (SP_HEAD - (lh + 24)) / 2;
    h.rr(bx, by, lw + 24, lh + 24, 22, '#FFFFFF');
    if(has) ctx.drawImage(logo, bx + 12, by + 12, lw, lh);
    const x0 = bx + lw + 24 + 26, x1 = W - 26, cx = (x0 + x1) / 2, maxW = x1 - x0, d = new Date(), multi = pg && pg.total > 1;
    const ds = d.getDate() + ' ' + (ur ? SP_MON_UR : SP_MON_EN)[d.getMonth()];
    h.t(title, cx, ur ? 58 : 66, { size: ur ? 76 : 78, c: SP_C.white, a: 'c', abs: true, max: maxW });
    h.t(multi ? ds + '  -  ' + pg.idx + ' / ' + pg.total : ds, cx, ur ? 138 : 130, { size: 40, c: '#DCEDEB', wt: 500, a: 'c', abs: true, max: maxW });
    return SP_HEAD;
  };
  // Nothing to show: a green tick and one sentence.
  h.empty = (title, msg) => {
    const y = h.band(title), cy = y + 210;
    ctx.fillStyle = SP_C.green; ctx.beginPath(); ctx.arc(W / 2, cy, 110, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 26; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(W / 2 - 52, cy + 4); ctx.lineTo(W / 2 - 12, cy + 44); ctx.lineTo(W / 2 + 56, cy - 40); ctx.stroke(); ctx.lineCap = 'butt';
    const n = h.wrap(msg, W / 2, y + 430, W - 140, 62, 92, { c: SP_C.ink });
    return y + 430 + n * 92 + 70;
  };
  return h;
}

/* ---------------- one drawer per section: draws itself and returns its height ---------------- */
const SP_DRAW = {};

SP_DRAW.stock = (h, d, pg) => {
  const W = h.W, ur = h.ur, L = h.L;
  if(!d.rows.length) return h.empty(L.stock, L.noStock);
  const y = h.band(L.stock, pg), colH = 110, rowH = 150, rows = d.rows.slice(pg.from, pg.to);
  const qW = Math.round(W * 0.40), splitX = ur ? W - qW : qW, numX = ur ? splitX - 40 : W - 40, numMax = ur ? splitX - 80 : W - qW - 80;
  h.rect(0, y, W, colH, SP_C.tonal);
  h.t(L.quality, 40, y + colH / 2, { size: 54, c: SP_C.deep, max: qW - 60 });
  h.t(L.meters, numX, y + colH / 2, { size: 54, c: SP_C.deep, abs: true, a: 'r', max: numMax });
  rows.forEach((r, i) => {
    const ry = y + colH + i * rowH;
    h.rect(0, ry, W, rowH, i % 2 ? SP_C.zebra : SP_C.white); h.rect(0, ry, W, 3, SP_C.line);
    h.t(r[0], 40, ry + rowH / 2, { size: 92, k: 'n', max: qW - 60 });
    h.t(spMtr(r[1]), numX, ry + rowH / 2, { size: 92, k: 'n', abs: true, a: 'r', max: numMax });
  });
  const end = y + colH + rows.length * rowH;
  h.rect(splitX - 2, y, 4, end - y, SP_C.line); h.rect(0, end - 3, W, 3, SP_C.line);
  return end;
};

// One donut per order: green = delivered, pale = still to deliver. The client's name is the first line of each block.
SP_DRAW.orders = (h, d, pg) => {
  const W = h.W, ur = h.ur, L = h.L, ctx = h.x;
  if(!d.rows.length) return h.empty(L.orders, L.noOrders);
  const y = h.band(L.orders, pg), bh = 450, R = 120, ringW = 50, tx = 44 + 2 * R + 90, avail = W - 44 - tx, list = d.rows.slice(pg.from, pg.to);
  list.forEach((o, i) => {
    const by = y + i * bh, got = Math.min(o.got, o.qty), pct = Math.round(got / o.qty * 100), rem = Math.max(0, o.qty - got), cy = by + bh / 2;
    const cx = ur ? W - (44 + R + ringW / 2 + 10) : 44 + R + ringW / 2 + 10;
    h.rect(0, by, W, bh, i % 2 ? SP_C.zebra : SP_C.white); h.rect(0, by, W, 3, SP_C.line);
    ctx.lineWidth = ringW; ctx.strokeStyle = SP_C.tonal; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    if(pct > 0){ ctx.strokeStyle = SP_C.green; ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (pct / 100)); ctx.stroke(); }
    ctx.lineWidth = 3; ctx.strokeStyle = SP_C.line; ctx.beginPath(); ctx.arc(cx, cy, R + ringW / 2, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy, R - ringW / 2, 0, Math.PI * 2); ctx.stroke();
    h.t(pct + '%', cx, cy, { size: 78, k: 'n', wt: 900, a: 'c', abs: true, max: 2 * (R - ringW / 2) - 24, c: pct > 0 ? SP_C.green : SP_C.soft });
    if(o.client) h.t(o.client, tx, by + 58, { size: 64, k: 'c', max: avail });
    h.t(o.no, tx, by + 128, { size: 54, k: 'n', c: SP_C.b1, max: avail * 0.55 });
    if(o.q) h.t(o.q, 44, by + 128, { size: 54, k: 'n', c: SP_C.soft, a: 'end', max: avail * 0.4 });
    h.t(L.deliv, tx, by + 208, { size: 38, c: SP_C.soft, wt: 500, max: avail });
    h.t(spMtr(got), tx, by + 262, { size: 62, k: 'n', c: pct > 0 ? SP_C.green : SP_C.ink, max: avail });
    h.t(L.remain, tx, by + 328, { size: 38, c: SP_C.soft, wt: 500, max: avail });
    h.t(spMtr(rem), tx, by + 382, { size: 62, k: 'n', max: avail });
  });
  return y + list.length * bh;
};

SP_DRAW.beams = (h, d, pg) => {
  const W = h.W, L = h.L;
  if(!d.rows.length) return h.empty(L.beams, L.noBeam(d.days));
  const y = h.band(L.beams, pg), rowH = 118, list = d.rows.slice(pg.from, pg.to);
  list.forEach((f, i) => {
    const ry = y + i * rowH, urgent = typeof f[1] === 'string';
    h.rect(0, ry, W, rowH, urgent ? SP_C.redT : (i % 2 ? SP_C.zebra : SP_C.white)); h.rect(0, ry, W, 3, SP_C.line);
    const w = h.t(L.loom, 44, ry + rowH / 2, { size: 66, max: 330 });
    h.t(String(f[0]), 44 + w + 20, ry + rowH / 2, { size: 80, k: 'n' });
    h.t(urgent ? L[f[1]] : L.dayN(f[1]), 44, ry + rowH / 2, { size: 66, a: 'end', c: urgent ? SP_C.red : SP_C.ink, max: 400 });
  });
  const ey = y + list.length * rowH; h.rect(0, ey, W, 3, SP_C.line);
  h.rect(0, ey, W, 140, SP_C.goldT);
  h.t(L.nextBeam, W / 2, ey + 70, { size: 60, c: SP_C.goldInk, a: 'c', abs: true, max: W - 88 });
  return ey + 140;
};

SP_DRAW.weft = (h, d) => {
  const W = h.W, L = h.L, e = d.e;
  if(!e || !e.hasData) return h.empty(L.weft, L.noWeft);
  const y = h.band(L.weft), low = !!e.low;
  h.t(L.bags, W / 2, y + 70, { size: 54, c: SP_C.soft, wt: 500, a: 'c', abs: true, max: W - 88 });
  h.t(String(Math.round(Math.max(e.bags, 0) * 10) / 10), W / 2, y + 185, { size: 170, k: 'n', wt: 900, c: SP_C.deep, a: 'c', abs: true, max: W - 88 });
  h.t(L.lbsLine(spNum(Math.max(e.lbs, 0))), W / 2, y + 305, { size: 56, c: SP_C.soft, a: 'c', abs: true, max: W - 88 });
  const y2 = y + 380; h.rect(0, y2, W, 3, SP_C.line); h.rect(0, y2 + 3, W, 400, SP_C.zebra);
  if(e.cover === null || e.cover === undefined){
    h.wrap(L.noPace, W / 2, y2 + 190, W - 140, 56, 84, { c: SP_C.soft, wt: 500 });
    return y2 + 403;
  }
  h.t(L.daysLeft, W / 2, y2 + 75, { size: 54, c: SP_C.soft, wt: 500, a: 'c', abs: true, max: W - 88 });
  h.t(String(Math.round(e.cover * 10) / 10), W / 2, y2 + 215, { size: 190, k: 'n', wt: 900, c: low ? SP_C.red : SP_C.green, a: 'c', abs: true, max: W - 88 });
  h.t(L.perDay(spNum(e.perDay)), W / 2, y2 + 345, { size: 56, c: SP_C.soft, a: 'c', abs: true, max: W - 88 });
  let end = y2 + 403;
  if(low){ h.rect(0, end, W, 170, SP_C.goldT); h.t(L.orderWeft, W / 2, end + 85, { size: 72, c: SP_C.goldInk, a: 'c', abs: true, max: W - 88 }); end += 170; }
  return end;
};

SP_DRAW.cheques = (h, d, pg) => {
  const W = h.W, ur = h.ur, L = h.L;
  if(!d.rows.length) return h.empty(L.cheques, L.noChq);
  const y = h.band(L.cheques, pg), rowH = 250, rows = d.rows.slice(pg.from, pg.to);
  rows.forEach((c, i) => {
    const ry = y + i * rowH, over = c.over > 0, today = !over && c.inD === 0;
    h.rect(0, ry, W, rowH, over ? SP_C.redT : (i % 2 ? SP_C.zebra : SP_C.white)); h.rect(0, ry, W, 3, SP_C.line);
    h.t(c.client, 44, ry + 62, { size: 70, k: 'c', max: W - 88 });
    const label = over ? L.late(c.over) : today ? L.today : L.inD(c.inD), pw = Math.min(h.w(label, 50, 700, 'u') + 70, 400), px = ur ? 44 : W - 44 - pw;
    const aw = h.t(spNum(c.amt), 44, ry + 160, { size: 88, k: 'n', max: W - 88 - pw - 40 - 150 });
    h.t(L.rs, 44 + aw + 20, ry + 160, { size: 44, c: SP_C.soft, wt: 500, max: 140 });
    h.rr(px, ry + 118, pw, 84, 42, over ? SP_C.red : SP_C.goldT);
    h.t(label, px + pw / 2, ry + 160, { size: 50, c: over ? SP_C.white : SP_C.goldInk, a: 'c', abs: true, max: pw - 40 });
    h.t(spDmy(c.date), 44, ry + 228, { size: 38, k: 'n', c: SP_C.soft, wt: 500, a: 'end' });
  });
  return y + rows.length * rowH;
};

SP_DRAW.receivable = (h, d) => {
  const W = h.W, L = h.L;
  if(!(d.total > 0.5)) return h.empty(L.receivable, L.noRecv);
  const y = h.band(L.receivable);
  h.t(L.recvL, W / 2, y + 100, { size: 60, c: SP_C.soft, wt: 500, a: 'c', abs: true, max: W - 88 });
  h.t(spNum(d.total), W / 2, y + 260, { size: 190, k: 'n', wt: 900, c: SP_C.deep, a: 'c', abs: true, max: W - 88 });
  h.t(L.rs, W / 2, y + 390, { size: 70, c: SP_C.soft, wt: 500, a: 'c', abs: true });
  return y + 480;
};

SP_DRAW.profit = (h, d) => {
  const W = h.W, L = h.L, y = h.band(L.profit), loss = d.profit < 0;
  h.t((loss ? L.lossL : L.profitL) + ' - ' + d.label, W / 2, y + 85, { size: 56, c: SP_C.soft, wt: 500, a: 'c', abs: true, max: W - 88 });
  h.t(spNum(Math.abs(d.profit)), W / 2, y + 225, { size: 170, k: 'n', wt: 900, c: loss ? SP_C.red : SP_C.green, a: 'c', abs: true, max: W - 88 });
  h.t(L.rs, W / 2, y + 340, { size: 64, c: SP_C.soft, wt: 500, a: 'c', abs: true });
  const y2 = y + 420; h.rect(0, y2, W, 3, SP_C.line); h.rect(0, y2 + 3, W, 440, SP_C.zebra);
  h.t(L.cashL, W / 2, y2 + 90, { size: 56, c: SP_C.soft, wt: 500, a: 'c', abs: true, max: W - 88 });
  h.t(spNum(Math.abs(d.cash)), W / 2, y2 + 230, { size: 170, k: 'n', wt: 900, c: d.cash < 0 ? SP_C.red : SP_C.deep, a: 'c', abs: true, max: W - 88 });
  h.t(L.rs, W / 2, y2 + 345, { size: 64, c: SP_C.soft, wt: 500, a: 'c', abs: true });
  return y2 + 443;
};

/* ---------------- how many pictures? worked out when they are made, from the data ---------------- */
function spSplit(n, cap){
  const pages = Math.max(1, Math.ceil(n / Math.max(1, cap))), per = Math.ceil(n / pages), out = [];
  for(let i = 0; i < pages; i++) out.push({ from: i * per, to: Math.min(n, (i + 1) * per), idx: i + 1, total: pages });
  return out;
}
// Rows are shared evenly across the pages (never a page with one lonely row) and a page is never cut through a row.
function spPages(id, d){
  const one = [{ from: 0, to: 1, idx: 1, total: 1 }], n = d && d.rows ? d.rows.length : 0;
  if(!n) return one;
  if(id === 'stock') return spSplit(n, Math.floor((SP_MAXH - SP_HEAD - 110) / 150));
  if(id === 'orders') return spSplit(n, Math.floor((SP_MAXH - SP_HEAD) / 450));
  if(id === 'beams') return spSplit(n, Math.floor((SP_MAXH - SP_HEAD - 140) / 118));
  if(id === 'cheques') return spSplit(n, Math.floor((SP_MAXH - SP_HEAD) / 250));
  return one;
}
function spPlan(ids, data){
  const plan = [];
  ids.forEach(id => spPages(id, data[id]).forEach(pg => plan.push({ id, pg })));
  return plan;
}
function spCanvas(id, d, pg, ur, logo){
  const W = SP_W, mk = () => document.createElement('canvas'), scratch = mk(); scratch.width = W; scratch.height = 3000;
  const H = Math.ceil(SP_DRAW[id](spHelper(scratch.getContext('2d'), W, ur, logo), d, pg)) + 6;
  const c = mk(); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, W, H);
  SP_DRAW[id](spHelper(x, W, ur, logo), d, pg);
  x.lineWidth = 10; x.strokeStyle = SP_C.b2; x.strokeRect(5, 5, W - 10, H - 10);
  return c;
}
async function spFonts(){
  try{
    if(typeof document === 'undefined' || !document.fonts || !document.fonts.load) return;
    await Promise.race([Promise.all([document.fonts.load('700 40px Roboto', '0123456789'), document.fonts.load('900 40px Roboto', '0123456789')]), new Promise(r => setTimeout(r, 2500))]);
  }catch(e){ /* the fallback font is used */ }
}
let _spLogoImg = null;
function spLogo(){
  return new Promise(res => {
    if(_spLogoImg && _spLogoImg.naturalWidth) return res(_spLogoImg);
    try{
      if(typeof BIZ_LOGO_PNG === 'undefined' || typeof Image === 'undefined') return res(null);
      const im = new Image(), t = setTimeout(() => res(null), 3000);
      im.onload = () => { clearTimeout(t); _spLogoImg = im; res(im); };
      im.onerror = () => { clearTimeout(t); res(null); };
      im.src = BIZ_LOGO_PNG;
    }catch(e){ res(null); }
  });
}
// ids -> the picture files (one or more per option), in the fixed order of SHARE_SECTIONS.
async function sharePicturesBuild(ids){
  await spFonts();
  const logo = await spLogo(), ur = alertUr(), data = {};
  ids.forEach(id => { data[id] = spCollect(id); });
  const plan = spPlan(ids, data), files = [], day = typeof todayStr === 'function' ? todayStr() : '';
  for(const it of plan){
    const c = spCanvas(it.id, data[it.id], it.pg, ur, logo);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    if(!blob) throw new Error('image export blocked');
    files.push(new File([blob], 'ibrahim-weaving_' + it.id + (it.pg.total > 1 ? '_page' + it.pg.idx + 'of' + it.pg.total : '') + (day ? '_' + day : '') + '.png', { type: 'image/png' }));
  }
  return files;
}

/* ---------------- Floating Share button: what it sends (kept on this phone) ---------------- */
const SHARE_PREFS_KEY = 'khata-share-prefs';
const SHARE_SECTIONS = [
  ['stock', 'Stock by quality', 'how much stock of each quality'],
  ['orders', 'Open orders', 'client, quality and how much is delivered'],
  ['beams', 'Warp beams', 'beams ending soon'],
  ['weft', 'Weft stock', 'bags and days left'],
  ['cheques', 'Cheques', 'overdue and due within 7 days'],
  ['receivable', 'Money to receive', 'total owed by clients'],
  ['profit', 'Profit and cash', 'this month, and cash in hand']
];
function sharePrefs(){
  const p = { stock: true, beams: true, weft: true };
  try{
    const s = JSON.parse(localStorage.getItem(SHARE_PREFS_KEY) || 'null');
    if(s && typeof s === 'object') SHARE_SECTIONS.forEach(x => { if(typeof s[x[0]] === 'boolean') p[x[0]] = s[x[0]]; });
  }catch(e){ /* use the defaults */ }
  return p;
}
function setSharePrefs(p){
  const out = {}; SHARE_SECTIONS.forEach(x => { out[x[0]] = !!p[x[0]]; });
  try{ localStorage.setItem(SHARE_PREFS_KEY, JSON.stringify(out)); }catch(e){ /* best effort */ }
}
function shareIds(p){ return SHARE_SECTIONS.filter(x => p && p[x[0]]).map(x => x[0]); }

// Pictures made but the phone asked for a fresh tap: show them ready with a new Share button (a new tap always counts).
function shareReadyDialog(files){
  const old = document.getElementById('shareReady'); if(old) old.remove();
  const wrap = document.createElement('div'); wrap.id = 'shareReady';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:20px;';
  wrap.innerHTML = `<div style="background:#fff;color:#222;border-radius:16px;padding:20px;max-width:340px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.35);font-family:inherit">
    <div style="font-weight:700;font-size:16px;margin-bottom:6px">Pictures are ready</div>
    <div style="font-size:13.5px;line-height:1.4;margin-bottom:14px" id="shareReadyMsg">${files.length} ${files.length === 1 ? 'picture' : 'pictures'} to share. Tap Share, then choose WhatsApp.</div>
    <div style="display:flex;flex-direction:column;gap:8px"><button id="shareReadyGo" type="button" class="primary" style="margin:0;width:100%">Share</button><button id="shareReadyX" type="button" class="ghost" style="width:100%">Cancel</button></div></div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('#shareReadyX').onclick = close;
  wrap.querySelector('#shareReadyGo').onclick = async () => {
    try{ await navigator.share({ files }); close(); }
    catch(e){ if(e && e.name === 'AbortError'){ close(); return; } wrap.querySelector('#shareReadyMsg').textContent = 'Could not open share: ' + (e && e.name || 'unknown error'); }
  };
}
async function shareFabNow(){
  const toast = (m, ms) => { if(typeof showToast === 'function') showToast(m, ms || 3000); };
  const hide = () => { try{ const el = document.getElementById('appToast'); if(el) el.classList.remove('show'); }catch(e){ /* cosmetic */ } };
  const ids = shareIds(sharePrefs());
  if(!ids.length){ toast('Choose what to share in Settings first.'); if(typeof switchTab === 'function') switchTab('settings'); return; }
  if(typeof canShareFiles === 'function' && !canShareFiles()){ toast('Sharing pictures is not supported on this phone.', 5000); return; }
  let files = [];
  try{ toast('Making pictures…', 60000); files = await sharePicturesBuild(ids); }
  catch(e){ if(typeof logErr === 'function') logErr('share', e); hide(); toast('Could not make the pictures - tap Share again.', 5000); return; }
  hide();
  if(!files.length){ toast('Could not make the pictures - tap Share again.', 5000); return; }
  if(navigator.canShare && !navigator.canShare({ files })){ toast("This phone can't share that many pictures at once - untick some options in Settings.", 6000); return; }
  try{ await navigator.share({ files }); toast(files.length > 1 ? 'Shared ✓ (' + files.length + ' pictures)' : 'Shared ✓'); }
  catch(e){
    if(e && e.name === 'AbortError') return;
    if(e && e.name === 'NotAllowedError'){ shareReadyDialog(files); return; }
    toast('Could not open share - tap Share again.', 5000);
  }
}

// Settings > Share on WhatsApp: only tick boxes, each with what it sends.
function shareFabCardHtml(){
  try{ if(typeof permsLimited === 'function' && permsLimited()) return ''; }catch(e){ /* show it */ }
  const p = sharePrefs();
  const rows = SHARE_SECTIONS.map(x => `<label style="display:flex;align-items:flex-start;gap:10px;font-weight:500;cursor:pointer;margin-top:12px"><input type="checkbox" class="sf_chk" data-key="${x[0]}" ${p[x[0]] ? 'checked' : ''} style="width:18px;height:18px;margin-top:2px"><span>${x[1]}<span class="note" style="display:block;font-weight:400;margin:0">${x[2]}</span></span></label>`).join('');
  return `<div class="card" id="shareFabCard">
    <div class="card-head"><h2>Floating Share button</h2><button type="button" class="info-btn" data-info-toggle title="Info">i</button></div>
    <p class="note info-note" hidden>Tap the round button at the bottom of any screen, then Share on WhatsApp. Each ticked option is made into its own picture from the ledger on this phone, and the phone's share sheet opens: choose WhatsApp, then a person or a group. These choices are kept on this phone only.</p>
    ${rows}
  </div>`;
}
function shareFabWire(){
  if(!document.getElementById('shareFabCard')) return;
  document.querySelectorAll('.sf_chk').forEach(c => {
    c.onchange = () => { const p = {}; document.querySelectorAll('.sf_chk').forEach(k => { p[k.dataset.key] = k.checked; }); setSharePrefs(p); };
  });
}
