/* Orders page + agreement (v3.18.12). Agreement = same HTML for the image share (receiptHtmlToPngFile) and the PDF (print dialog). */
let ORD_EDIT = null, ORD_REV = null, ORD_FROM = null, ORD_LINK = null;
const ODT = {
  en: {dir: 'ltr', sub: 'Grey cloth manufacturer', title: 'Order Agreement', seller: 'Seller', buyer: 'Buyer', date: 'Date of agreement', q: 'Quantity', r: 'Rate', v: 'Order value', m: 'm', pm: 'Rs / m', rs: 'Rs', ql: 'Quality', wd: 'Width', inch: 'inches', dl: 'Delivery', dlv: 'In batches, each recorded on an invoice', tl: 'Tolerance', th: 'Terms', pres: 'In the presence of', pb: "From the buyer's side: name", ps: "From the seller's side: name", no: 'Order no', ph: 'Phone', rv: 'Revoked', rvT: 'Revocation of order', rvOn: 'Revoked on', rvTe: 'Terms of revocation', rvD: (m, r) => 'Meters already delivered on this order (' + m + ' m) stay billed at the agreed rate of Rs ' + r + ' per meter.', rvN: n => 'Both parties agreed to revoke this order. It is replaced by order ' + n + '.', rvB: 'Both parties agreed to revoke this order.', rp: (n, d) => 'This order replaces order ' + n + ', revoked by mutual agreement' + (d ? ' on ' + d : '') + '.',
    t: (o, lo, hi) => ['The quantity is approximate. Actual delivery may be above or below it, and billing is on the meters actually delivered at the agreed rate.', 'The rate of Rs ' + o.rate + ' per meter is fixed for this order and applies to every batch.', "Meters delivered above the tolerance are supplied only with the buyer's consent, at the same rate unless both parties agree otherwise.", 'Each batch is recorded on an invoice with its meters. The total of these invoices is the delivered quantity for this order.']
      .concat(Number(o.minBatch) > 0 ? ['Each batch will be at least ' + fmtNum(o.minBatch) + ' m.'] : [], Number(o.weekly) > 0 ? ['The seller will deliver at least ' + fmtNum(o.weekly) + ' m each week.'] : [],
        ['The order is closed when the seller marks it complete and the buyer has received the final batch.', 'Any dispute about quantity or rate will be settled from this agreement and the delivery invoices.'])},
  ur: {dir: 'rtl', sub: 'کورا کپڑا تیار کنندہ', title: 'آرڈر معاہدہ', seller: 'فروخت کنندہ', buyer: 'خریدار', date: 'معاہدے کی تاریخ', q: 'مقدار', r: 'ریٹ', v: 'آرڈر کی مالیت', m: 'میٹر', pm: 'روپے فی میٹر', rs: 'روپے', ql: 'کوالٹی', wd: 'چوڑائی', inch: 'انچ', dl: 'ڈیلیوری', dlv: 'قسطوں میں، ہر قسط انوائس پر درج ہوگی', tl: 'کمی بیشی کی گنجائش', th: 'شرائط', pres: 'موجودگی میں', pb: 'خریدار کی طرف سے: نام', ps: 'فروخت کنندہ کی طرف سے: نام', no: 'آرڈر نمبر', ph: 'فون', rv: 'منسوخ', rvT: 'آرڈر کی منسوخی', rvOn: 'منسوخی کی تاریخ', rvTe: 'منسوخی کی شرائط', rvD: (m, r) => 'اس آرڈر پر اب تک ڈیلیور شدہ میٹر (' + m + ' میٹر) طے شدہ ' + r + ' روپے فی میٹر کے حساب سے ہی بل ہوں گے۔', rvN: n => 'دونوں فریقوں نے اس آرڈر کو منسوخ کرنے پر اتفاق کیا۔ اس کی جگہ آرڈر ' + n + ' ہے۔', rvB: 'دونوں فریقوں نے اس آرڈر کو منسوخ کرنے پر اتفاق کیا۔', rp: (n, d) => 'یہ آرڈر، آرڈر ' + n + ' کی جگہ ہے جو باہمی رضامندی سے منسوخ ہوا' + (d ? ' (' + d + ')' : '') + '۔',
    t: (o, lo, hi) => ['مقدار تقریباً ہے۔ اصل ڈیلیوری اس سے کم یا زیادہ ہو سکتی ہے، اور بل اصل ڈیلیور کیے گئے میٹروں پر طے شدہ ریٹ کے حساب سے بنے گا۔', o.rate + ' روپے فی میٹر کا ریٹ اس آرڈر کے لیے مقرر ہے اور ہر قسط پر لاگو ہوگا۔', 'گنجائش سے زائد میٹر صرف خریدار کی رضامندی سے دیے جائیں گے، اسی ریٹ پر، جب تک دونوں فریق کسی اور بات پر متفق نہ ہوں۔', 'ہر قسط انوائس پر میٹروں سمیت درج کی جائے گی۔ ان انوائسوں کا مجموعہ اس آرڈر کی ڈیلیور شدہ مقدار ہوگا۔']
      .concat(Number(o.minBatch) > 0 ? ['ہر قسط کم از کم ' + fmtNum(o.minBatch) + ' میٹر کی ہوگی۔'] : [], Number(o.weekly) > 0 ? ['فروخت کنندہ ہر ہفتے کم از کم ' + fmtNum(o.weekly) + ' میٹر ڈیلیور کرے گا۔'] : [],
        ['آرڈر اس وقت مکمل مانا جائے گا جب فروخت کنندہ اسے مکمل قرار دے اور خریدار آخری قسط وصول کر لے۔', 'مقدار یا ریٹ سے متعلق کسی بھی اختلاف کا فیصلہ اس معاہدے اور ڈیلیوری انوائسوں کی بنیاد پر ہوگا۔'])},
};
function orderAgreementHtml(o, lang){
  const L = ODT[lang] || ODT.en, biz = DATA.businessInfo || {}, name = biz.name || 'Ibrahim Weaving', q = (DATA.qualities || []).find(x => x.name === o.quality) || {}, c = costCfg();
  const tol = o.tolerance !== undefined && o.tolerance !== '' && o.tolerance !== null ? Number(o.tolerance) : 5, lo = Math.round(o.qty * (1 - tol / 100)), hi = Math.round(o.qty * (1 + tol / 100));
  const rows = [[L.ql, '<span dir="ltr">' + escHtml(o.quality) + '</span>'], [L.wd, (o.width || c.widthByReed[q.kangi] || c.width) + ' ' + L.inch], [L.dl, L.dlv], [L.tl, '±' + tol + (lang === 'ur' ? ' فیصد' : '%') + ' (' + fmtNum(lo) + (lang === 'ur' ? ' سے ' : ' to ') + fmtNum(hi) + ' ' + L.m + ')']];
  const old = o.replaces ? (DATA.orders || []).find(x => x.id === o.replaces) : null, nw = o.revoked && o.revoked.newId ? (DATA.orders || []).find(x => x.id === o.revoked.newId) : null;
  const terms = L.t(o).concat(old ? [L.rp(old.no || '', old.revoked ? fmtDate(old.revoked.date) : '')] : []);
  const rev = o.revoked ? `<h2>${L.rvT}</h2><div class="rv"><div class="rd">${L.rvOn}: <span dir="ltr">${fmtDate(o.revoked.date)}</span></div><p>${nw ? L.rvN(escHtml(nw.no || '')) : L.rvB}</p>${o.revoked.terms ? `<p><b>${L.rvTe}:</b> ${escHtml(o.revoked.terms).replace(/\n/g, '<br>')}</p>` : ''}<p>${L.rvD(fmtNum(o.revoked.delivered !== undefined ? o.revoked.delivered : Math.round(orderStats(o).got)), o.revoked.rate !== undefined ? o.revoked.rate : o.rate)}</p></div>` : '';
  const wn = (v, l) => `<span><b style="display:block;min-height:24px;color:#1B2126;font-size:14px">${escHtml(v || '')}</b>${l}</span>`;
  const font = lang === 'ur' ? "'Noto Nastaliq Urdu','Noto Naskh Arabic',serif" : "Roboto,'Segoe UI',Arial,sans-serif";
  return `<div class="agr" dir="${L.dir}"><style>.agr{width:640px;background:#fff;color:#1B2126;font:14px/1.7 ${font};box-sizing:border-box}.agr *{box-sizing:border-box;margin:0}.agr{position:relative}.agr .wm{position:absolute;top:46%;left:50%;width:70%;aspect-ratio:1145/360;transform:translate(-50%,-50%);background-size:contain;background-repeat:no-repeat;background-position:center;opacity:.08}.agr>*:not(.wm){position:relative}.agr .h{padding:22px 26px 0}.agr .h img{display:block;height:44px;width:auto;margin:0 0 6px}.agr .bl{font-size:12.5px;color:#444;margin:1px 0}.agr .p{padding:0 26px}.agr h1{text-align:center;font-size:15px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin:18px 26px 12px;border-top:1px solid #999;border-bottom:1px solid #999;padding:8px 0;color:#1a1a1a}.agr .mr{display:flex;gap:10px;align-items:baseline;font-size:13px;margin:3px 26px}.agr .mr span{flex:0 0 110px;color:#444}.agr .pt{display:flex;gap:12px;padding:6px 26px}.agr .pt div{flex:1;border:1px solid #D5DADF;border-radius:9px;padding:8px 14px}.agr small{color:#626B72;font-size:11.5px}.agr .pt b{display:block;font-size:17px}.agr .o{margin:6px 26px;border:1px solid #D5DADF;border-radius:10px;background:#F6F8F8;overflow:hidden}.agr .g{display:flex;text-align:center;background:#DCEDEB}.agr .g div{flex:1;padding:10px 4px}.agr .g small{display:block}.agr .g b{font-size:20px;color:#163B3D}.agr table{width:100%;border-collapse:collapse}.agr td{padding:7px 14px;border-top:1px solid #D5DADF;font-size:13.5px}.agr td:first-child{color:#626B72;width:36%}.agr td:last-child{font-weight:700}.agr h2{font-size:14px;color:#204E52;padding:12px 26px 0}.agr ol{padding:0 46px;font-size:13px}.agr li{margin:2px 0}.agr .w{display:flex;gap:26px;padding:22px 26px 0}.agr .w span{flex:1;border-top:1px dashed #9aa9ab;padding-top:3px;font-size:11.5px;color:#626B72}.agr .rv{margin:6px 26px 0;border:1px solid #B3563A;border-radius:10px;background:#FBF1EE;padding:8px 14px;font-size:13px}.agr .rv p{margin:3px 0}.agr .rd{font-weight:700;color:#B3563A}.agr .rvb{display:inline-block;margin:0 26px;padding:0 10px;border:2px solid #B3563A;color:#B3563A;border-radius:6px;font-weight:700;font-size:13px}.agr .f{margin-top:16px;background:#EDEFF1;padding:8px 26px;font-size:11px;color:#626B72}</style>
<div class="wm" style="background-image:url('${BIZ_LOGO_PNG}')"></div><div class="h"><img src="${BIZ_LOGO_PNG}" alt="${escHtml(name)}"/>${biz.address ? `<div class="bl">${escHtml(biz.address)}</div>` : ''}${biz.phone ? `<div class="bl">${L.ph}: <span dir="ltr">${escHtml(biz.phone)}</span></div>` : ''}</div>
<h1>${L.title}</h1>${o.revoked ? `<div class="rvb">${L.rv}</div>` : ''}<div class="mr"><span>${L.no}</span><b>${escHtml(o.no || '')}</b></div><div class="mr"><span>${L.date}</span><b dir="ltr">${fmtDate(o.date)}</b></div><div class="pt" style="margin-top:8px"><div><small>${L.seller}</small><b>${escHtml(name)}</b></div><div><small>${L.buyer}</small><b>${escHtml(o.client)}</b></div></div>
<div class="o"><div class="g"><div><small>${L.q}</small><b>${fmtNum(o.qty)} ${L.m}</b></div><div><small>${L.r}</small><b>${o.rate} ${L.pm}</b></div><div><small>${L.v}</small><b>${fmtNum(Math.round(o.qty * o.rate))} ${L.rs}</b></div></div><table>${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table></div>
<h2>${L.th}</h2><ol>${terms.map(x => `<li>${x}</li>`).join('')}</ol>
${rev}<h2>${L.pres}</h2><div class="w">${wn(o.witBuyer, L.pb)}${wn(o.witSeller, L.ps)}</div><div class="f">${escHtml(o.no || '')}</div></div>`;
}
async function orderShare(id, lang){
  const o = DATA.orders.find(x => x.id === id); if(!o) return;
  try{
    const file = await receiptHtmlToPngFile(orderAgreementHtml(o, lang), asciiFileBase((o.no || 'order') + '_' + o.client + '_' + lang) + '.png');
    if(navigator.canShare && navigator.canShare({files: [file]})) await navigator.share({files: [file]});
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); }
  }catch(e){ if(e && e.name === 'AbortError') return; showToast('Could not make the image. Tap again.', 5000); }
}
function orderPdf(id, lang){
  const o = DATA.orders.find(x => x.id === id); if(!o) return;
  document.getElementById('receiptPrintArea').innerHTML = orderAgreementHtml(o, lang);
  const t = document.title; document.title = asciiFileBase((o.no || 'order') + '_' + o.client);
  const back = () => { document.title = t; window.removeEventListener('afterprint', back); }; window.addEventListener('afterprint', back);
  window.print();
}
const odStatus = (o, s) => ({revoked: ['Revoked', 'thin'], closed: ['Completed', ''], over: ['Over by ' + fmtNum(Math.round(s.diff)) + ' m (+' + s.pct.toFixed(1) + '%)', 'thin'], within: ['Within tolerance', 'good'], open: ['In progress', ''], new: ['No delivery yet', '']})[s.status];
const ordNo = id => ((DATA.orders || []).find(x => x.id === id) || {}).no || '-';
function revForm(o){
  if(ORD_REV !== o.id) return '';
  const s = orderStats(o);
  return `<div class="od-rev"><b>Revoke ${escHtml(o.no || '')}</b><small>${fmtNum(Math.round(s.got))} m already delivered stays on this order at Rs ${o.rate}/m.</small>
    ${field('Date of revocation', 'r_date', 'date', `value="${todayStr()}"`)}${textareaField('Terms agreed by both parties', 'r_terms', 'rows="3"')}
    <label class="od-ck"><input type="checkbox" id="r_new" checked> Make a new order now (opens a form with these details)</label>
    <div class="od-act"><button type="button" class="primary" id="r_ok" data-edit="orders:${o.id}">Revoke order</button><button type="button" class="ghost" id="r_no">Cancel</button></div></div>`;
}
const act = (o, a, t, cls, on) => on ? `<button type="button" class="${cls}" data-a="${a}" data-edit="orders:${o.id}">${t}</button>` : '';
function linkForm(o){
  if(ORD_LINK !== o.id) return '';
  const el = (DATA.orders || []).filter(x => !x.closed && !x.replaces && x.id !== o.id && x.client === o.client);
  return `<div class="od-rev"><b>Link ${escHtml(o.no || '')} to an existing order</b><small>Open orders of ${escHtml(o.client)} that are not already a replacement.</small>
    <div class="field"><select id="l_ord"><option value="">—</option>${el.map(x => `<option value="${x.id}">${escHtml(x.no || '')}: ${fmtNum(x.qty)} m at Rs ${x.rate}</option>`).join('')}</select></div>
    <div class="od-act"><button type="button" class="primary" id="l_ok" data-edit="orders:${o.id}">Link</button><button type="button" class="ghost" id="l_no">Cancel</button></div></div>`;
}
const odLang = () => (typeof I18N_LANG !== 'undefined' && I18N_LANG === 'ur') ? 'ur' : 'en'; // the agreement follows the app language
function orderCard(o){
  const s = orderStats(o), [txt, tone] = odStatus(o, s), top = Math.max(o.qty * (1 + s.tol / 100) * 1.03, s.got), p = x => (x / top * 100).toFixed(2) + '%';
  const k = o.revoked ? 'rev' : o.closed ? 'done' : tone === 'good' ? 'good' : tone === 'thin' ? 'thin' : s.got ? 'run' : 'new';
  const pct = s.qty ? Math.min(100, Math.round(s.got / s.qty * 100)) : 0, ini = escHtml((o.client || '?').trim().charAt(0).toUpperCase());
  const left = !o.closed && s.pending ? fmtNum(Math.round(s.pending)) + ' m to go' : o.revoked ? 'Revoked' : o.closed ? 'Completed' : s.diff > 0 ? '+' + fmtNum(Math.round(s.diff)) + ' m extra' : 'Delivered';
  const tiles = [['Avg rate', s.got ? 'Rs ' + (Math.round(s.avg * 10) / 10) : '-'], ['Value', s.got ? fmtRs(s.val) : '-'], ['Batches', s.batches], ['Last', s.last ? fmtDate(s.last) : '-']].map(m => `<div><small>${m[0]}</small><b>${m[1]}</b></div>`).join('');
  const pills = [Number(o.weekly) > 0 ? `This week ${fmtNum(s.weekGot)} of ${fmtNum(o.weekly)} m` + (s.weekGot >= o.weekly ? ' (done)' : '') : '', Number(o.minBatch) > 0 ? 'Minimum batch ' + fmtNum(o.minBatch) + ' m' : '',
    s.offRate ? s.offRate + ' batch(es) at a different rate than Rs ' + o.rate : '', !o.closed && s.pending && s.stock ? `Stock covers ${fmtNum(Math.round(Math.min(s.stock, s.pending)))} m` : '', !o.closed && s.toWeave ? `${fmtNum(Math.round(s.toWeave))} m still to weave` : '',
    o.replaces ? 'Replaces ' + escHtml(ordNo(o.replaces)) : '', o.revoked ? 'Revoked ' + fmtDate(o.revoked.date) + (o.revoked.newId ? ', replaced by ' + escHtml(ordNo(o.revoked.newId)) : '') : ''].filter(Boolean).map(x => `<span class="od-pill">${x}</span>`).join('');
  const hist = (o.history || []).slice(-3).map(h => `<small class="od-link">Changed ${fmtDate(h.date)}: ${escHtml(h.text)}</small>`).join('');
  return `<div class="card od-card k-${k}" data-id="${o.id}"><div class="od-top"><span class="od-av">${ini}</span><div class="od-nm"><b>${escHtml(o.client)}</b><small>${escHtml(o.no || '')} · ${escHtml(o.quality.split(' (')[0])} · Rs ${o.rate}/m</small></div><span class="od-chip ${tone}"><i></i>${txt}</span></div>
    <div class="od-mid"><div class="od-ring" style="--p:${pct}"><b>${pct}%</b></div><div class="od-nums"><div class="od-big">${fmtNum(Math.round(s.got))}<small> of ${fmtNum(o.qty)} m</small></div><div class="od-left">${left}</div></div></div>
    <div class="od-bar"><i style="width:${p(s.got)}"></i><u style="left:${p(o.qty * (1 - s.tol / 100))};width:${p(o.qty * s.tol / 50)}"></u><b style="left:${p(o.qty)}"></b></div>
    <div class="od-meta">${tiles}</div>${pills ? `<div class="od-pills">${pills}</div>` : ''}${revForm(o)}${linkForm(o)}${hist}
    <div class="od-share"><button type="button" class="primary" data-a="img">Share image</button><button type="button" class="ghost" data-a="pdf">PDF</button></div>
    <div class="od-act">${act(o, 'edit', 'Edit', 'ghost', !o.revoked)}${o.revoked ? act(o, 'unrev', 'Undo revoke', 'ghost', true) + (o.revoked.newId ? '' : act(o, 'mkrep', 'Make replacement', 'primary', true) + act(o, 'linkex', 'Link existing', 'ghost', true)) : act(o, 'done', o.closed ? 'Reopen' : 'Mark complete', 'ghost', true) + act(o, 'revoke', 'Revoke', 'ghost', !o.closed)}<button type="button" class="ghost od-del" data-a="del" data-del="orders:${o.id}">Delete</button></div></div>`;
}
function ordersPanel(){
  if(ORD_EDIT && ((DATA.orders || []).find(x => x.id === ORD_EDIT) || {}).revoked) ORD_EDIT = null;
  const all = DATA.orders || [], open = all.filter(o => !o.closed), done = all.filter(o => o.closed), e = ORD_EDIT ? all.find(x => x.id === ORD_EDIT) || {} : (ORD_FROM ? Object.assign({}, all.find(x => x.id === ORD_FROM) || {}, {qty: '', rate: '', date: '', tolerance: '', minBatch: '', weekly: '', replaces: ORD_FROM}) : {});
  const pick = (html, v) => v ? html.replace('<option value="' + escHtml(v) + '">', '<option value="' + escHtml(v) + '" selected>') : html;
  const nextNo = 'ORD-' + String(all.reduce((m, x) => Math.max(m, parseInt(String(x.no || '').replace(/\D/g, '')) || 0), 0) + 1).padStart(3, '0');
  const lock = ORD_EDIT && orderDeliveries(ORD_EDIT) ? 'disabled' : '', biz = (DATA.businessInfo || {}).name || 'Ibrahim Weaving', open_ = ORD_EDIT || ORD_FROM || !all.length;
  const title = ORD_EDIT ? 'Edit order ' + escHtml(e.no || '') : ORD_FROM ? 'New order (replaces ' + escHtml(ordNo(ORD_FROM)) + ')' : 'New order';
  return `<div class="od"><details class="card"${open_ ? ' open' : ''}><summary><b>${title}</b></summary>
    <div class="od-sec">Agreement</div><div class="cm-g c2"><div class="field"><label>Order no.</label><input value="${escHtml(e.no || nextNo)}" disabled></div>${field('Date of agreement', 'o_date', 'date', `value="${e.date || todayStr()}"`)}</div>
    <div class="od-sec">Parties</div><div class="cm-g c2"><div class="field"><label>Seller</label><input value="${escHtml(biz)}" disabled></div>${pick(clientSelectField('Buyer (client)', 'o_client', lock), e.client)}</div>
    <div class="od-sec">Cloth and price</div><div class="cm-g c2">${pick(selectField('Quality', 'o_quality', DATA.qualities || [], lock), e.quality)}${field('Width (inches)', 'o_width', 'number', `value="${e.width || ''}" step="any"${e.width ? ' data-t="1"' : ''}`)}${field('Ordered meters', 'o_qty', 'number', `value="${e.qty || ''}"`)}${field('Agreed rate (Rs/m)', 'o_rate', 'number', `value="${e.rate || ''}" step="any"`)}</div>
    <div class="od-sum" id="o_sum"></div>
    <div class="od-sec">Delivery terms</div><div class="cm-g c2">${field('Tolerance % (default 5)', 'o_tol', 'number', `value="${e.tolerance !== undefined ? e.tolerance : ''}" placeholder="5" step="any"`)}${field('Minimum batch m (optional)', 'o_min', 'number', `value="${e.minBatch || ''}"`)}${field('Per week m (optional)', 'o_week', 'number', `value="${e.weekly || ''}"`)}</div>
    ${lock ? '<small class="od-link">Client and quality are locked because deliveries are linked to this order.</small>' : ''}<div class="od-sec">In the presence of</div><div class="cm-g c2">${field("From the buyer's side: name", 'o_wb', 'text', `value="${escHtml(e.witBuyer || '')}"`)}${field("From the seller's side: name", 'o_ws', 'text', `value="${escHtml(e.witSeller || '')}"`)}</div>
    <div class="form-actions"><button type="button" class="primary" id="o_save">${ORD_EDIT ? 'Save changes' : 'Save order'}</button>${ORD_EDIT || ORD_FROM ? '<button type="button" class="ghost" id="o_cancel">Cancel</button>' : ''}</div></details>
    <h3 style="margin:16px 4px 8px">Open orders</h3>${open.length ? open.map(orderCard).join('') : '<p class="note">No open orders.</p>'}
    ${done.length ? `<details class="card"><summary>Completed and revoked (${done.length})</summary>${done.map(orderCard).join('')}</details>` : ''}</div>`;
}
function wireOrders(){
  if(!document.getElementById('od_css2')){ const old = document.getElementById('od_css'); if(old) old.remove(); const s = document.createElement('style'); s.id = 'od_css2';
    s.textContent = `.od-card{margin-top:14px;position:relative;overflow:hidden;border-inline-start:5px solid var(--odc);--odc:var(--rust);animation:odUp .35s ease both}.od-card.k-good{--odc:var(--green)}.od-card.k-thin{--odc:var(--gold)}.od-card.k-run{--odc:var(--rust)}.od-card.k-new{--odc:#7B8794}.od-card.k-done{--odc:#7B8794}.od-card.k-rev{--odc:var(--red)}
@keyframes odUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@keyframes odGrow{from{width:0}}
.od-top{display:flex;gap:10px;align-items:center}.od-av{flex:0 0 auto;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font:700 18px Roboto,sans-serif;color:#fff;background:var(--odc)}.od-nm{flex:1;min-width:0}.od-nm b{display:block;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.od-nm small{display:block;color:var(--ink-soft);font-size:12px}
.od-chip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:14px;background:var(--paper-dim);white-space:nowrap}.od-chip i{width:8px;height:8px;border-radius:50%;background:var(--odc)}.od-chip.good{color:var(--green)}.od-chip.thin{color:var(--gold)}
.od-mid{display:flex;align-items:center;gap:16px;margin-top:14px}.od-ring{flex:0 0 auto;width:78px;height:78px;border-radius:50%;display:grid;place-items:center;position:relative;background:conic-gradient(var(--odc) calc(var(--p) * 1%),var(--paper-dim) 0)}.od-ring::before{content:'';position:absolute;inset:8px;border-radius:50%;background:var(--card)}.od-ring b{position:relative;font:700 17px 'Roboto Condensed',Roboto,sans-serif}
.od-big{font:700 30px/1.15 'Roboto Condensed',Roboto,sans-serif}.od-big small{font:400 13px Roboto,sans-serif;color:var(--ink-soft)}.od-left{margin-top:2px;font-size:13px;font-weight:700;color:var(--odc)}
.od-bar{position:relative;height:10px;background:var(--paper-dim);border-radius:6px;margin:16px 0 14px;overflow:visible}.od-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:6px;background:var(--odc);animation:odGrow .7s ease both}.od-bar u{position:absolute;top:0;bottom:0;background:var(--green);opacity:.22}.od-bar b{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--ink)}
.od-meta{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.od-meta div{background:var(--paper-dim);border-radius:10px;padding:7px 8px;min-width:0}.od-meta small{display:block;color:var(--ink-soft);font-size:10.5px}.od-meta b{font-size:12.5px;overflow-wrap:anywhere}
.od-pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.od-pill{font-size:11.5px;padding:3px 10px;border-radius:12px;background:var(--rust-tonal);color:var(--rust-deep);font-weight:600}
.od-share{display:flex;gap:8px;margin-top:14px}.od-share button{flex:1;margin:0}.od-act{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center}.od-act button{width:auto;flex:0 0 auto;margin:0;padding:8px 14px;font-size:12.5px}.od-del{margin-inline-start:auto!important;color:var(--red)!important}
.od-sec{margin:14px 0 6px;font-size:12px;font-weight:700;letter-spacing:.3px;color:var(--rust-deep);text-transform:uppercase;border-bottom:1px dashed var(--line);padding-bottom:3px}.od-sec:first-of-type{margin-top:4px}.od-sum{margin-top:8px;padding:10px 12px;border-radius:10px;background:var(--rust-tonal);color:var(--rust-deep);font-size:13px;font-weight:700}.od-sum:empty{display:none}.od-rev{margin-top:12px;padding:12px;border:1px solid var(--rust);border-radius:12px;background:var(--paper-dim)}.od-rev small{display:block;color:var(--ink-soft);margin:2px 0 8px}.od-ck{display:flex;gap:8px;align-items:center;font-size:13px;margin-top:8px}.od-ck input{width:auto}.od-link{display:block;margin-top:8px;color:var(--ink-soft);font-weight:700}
@media (prefers-reduced-motion:reduce){.od-card,.od-bar i{animation:none}}`; document.head.appendChild(s); }
  const g = id => document.getElementById(id), n = id => parseFloat(g(id).value) || 0;
  const live = () => { if(!g('o_qty')) return; const q = (DATA.qualities || []).find(x => x.name === g('o_quality').value) || {}, c = costCfg(), t = g('o_tol').value === '' ? 5 : n('o_tol'), qy = n('o_qty');
    if(!g('o_width').dataset.t) g('o_width').value = q.name ? (c.widthByReed[q.kangi] || c.width) : '';
    g('o_sum').textContent = qy && n('o_rate') ? 'Order value Rs ' + fmtNum(Math.round(qy * n('o_rate'))) + '. Tolerance range ' + fmtNum(Math.round(qy * (1 - t / 100))) + ' to ' + fmtNum(Math.round(qy * (1 + t / 100))) + ' m.' : ''; };
  if(g('o_width')) g('o_width').addEventListener('input', () => { g('o_width').dataset.t = '1'; });
  ['o_quality', 'o_qty', 'o_rate', 'o_tol'].forEach(i => { if(g(i)){ g(i).oninput = live; g(i).onchange = live; } }); live();
  if(g('r_no')) g('r_no').onclick = () => { ORD_REV = null; switchTab('orders'); };
  if(g('r_ok')) g('r_ok').onclick = async () => {
    const o = DATA.orders.find(x => x.id === ORD_REV); if(!o) return;
    if(!g('r_terms').value.trim() && !confirm('No terms written. Revoke anyway?')) return;
    orderRevoke(o.id, g('r_date').value || todayStr(), g('r_terms').value.trim());
    const mk = g('r_new').checked; ORD_REV = null; ORD_FROM = mk ? o.id : null; await save(); switchTab('orders');
  };
  if(g('l_no')) g('l_no').onclick = () => { ORD_LINK = null; switchTab('orders'); };
  if(g('l_ok')) g('l_ok').onclick = async () => {
    const r = orderLinkReplacement(ORD_LINK, g('l_ord').value); if(!r.ok){ showToast(g('l_ord').value ? 'That order cannot be linked.' : 'Pick the replacement order first.'); return; }
    ORD_LINK = null; await save(); switchTab('orders');
  };
  if(g('o_save')) g('o_save').onclick = async () => {
    if(!g('o_client').value || !g('o_quality').value) { showToast('Select the client and the quality first.'); return; }
    if(!n('o_qty') || !n('o_rate')) { showToast('Enter the ordered meters and the agreed rate first.'); return; }
    const rec = {client: g('o_client').value, quality: g('o_quality').value, qty: n('o_qty'), rate: n('o_rate'), date: g('o_date').value || todayStr(), tolerance: g('o_tol').value === '' ? '' : n('o_tol'), minBatch: n('o_min') || '', width: n('o_width') || '', weekly: n('o_week') || '', witBuyer: g('o_wb').value.trim(), witSeller: g('o_ws').value.trim()};
    DATA.orders = DATA.orders || [];
    if(ORD_EDIT){ const i = DATA.orders.findIndex(x => x.id === ORD_EDIT), cur = DATA.orders[i];
      if(cur && cur.revoked){ showToast('A revoked order cannot be edited. Undo the revoke first.', 5000); return; }
      if(cur && orderDeliveries(cur.id)){ rec.client = cur.client; rec.quality = cur.quality; }
      const ch = cur ? orderChanges(cur, rec) : [];
      if(ch.length && orderDeliveries(cur.id) && !confirm('This order already has deliveries. Change ' + ch.join(', ') + '?')) return;
      if(i > -1) DATA.orders[i] = Object.assign({}, cur, rec, ch.length ? {history: (cur.history || []).concat([{date: todayStr(), text: ch.join(', ')}])} : {}); ORD_EDIT = null; }
    else { if(ORD_FROM) rec.replaces = ORD_FROM; const k = DATA.orders.reduce((m, x) => Math.max(m, parseInt(String(x.no || '').replace(/\D/g, '')) || 0), 0) + 1; const nid = uid(); DATA.orders.push(Object.assign({id: nid, no: 'ORD-' + String(k).padStart(3, '0'), closed: false}, rec)); if(ORD_FROM){ const old = DATA.orders.find(x => x.id === ORD_FROM); if(old && old.revoked){ old.revoked.newId = nid; old.revoked.newMade = true; } ORD_FROM = null; } }
    await save(); switchTab('orders');
  };
  if(g('o_cancel')) g('o_cancel').onclick = () => { ORD_EDIT = null; ORD_FROM = null; switchTab('orders'); };
  document.querySelectorAll('.od-card').forEach(c => c.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
    const id = c.dataset.id, a = b.dataset.a, o = DATA.orders.find(x => x.id === id), lang = odLang();
    if(a === 'img') orderShare(id, lang); else if(a === 'pdf') orderPdf(id, lang);
    else if(a === 'edit'){ ORD_EDIT = id; switchTab('orders'); }
    else if(a === 'revoke'){ ORD_REV = id; switchTab('orders'); }
    else if(a === 'mkrep'){ ORD_FROM = id; switchTab('orders'); }
    else if(a === 'linkex'){ if(!(DATA.orders || []).some(x => !x.closed && !x.replaces && x.id !== id && x.client === o.client)){ showToast('No open order of this client to link. Use Make replacement.', 5000); return; } ORD_LINK = id; switchTab('orders'); }
    else if(a === 'unrev'){
      const nx = o.revoked && o.revoked.newId && o.revoked.newMade ? (DATA.orders || []).find(x => x.id === o.revoked.newId) : null;
      if(nx && orderDeliveries(nx.id)){ showToast(nx.no + ' already has deliveries, so this revoke cannot be undone.', 5000); return; }
      if(!confirm('Undo the revocation of ' + (o.no || '') + '?' + (nx ? ' The replacement ' + (nx.no || '') + ' (no deliveries) will be deleted.' : ''))) return;
      const r = orderUndoRevoke(id); if(r.ok){ await save(); switchTab('orders'); }
    }
    else if(a === 'done'){ o.closed = !o.closed; await save(); switchTab('orders'); }
    else if(a === 'del'){
      if((DATA.sale || []).some(s => s.order === id)){ showToast('This order has deliveries linked to it. Mark it complete instead.', 5000); return; }
      if(confirm('Delete order ' + (o.no || '') + '?')){ DATA.orders = DATA.orders.filter(x => x.id !== id); await save(); switchTab('orders'); }
    }
  }));
}
// Sale form: pick the order a delivery belongs to. Every open order is listed as "ORD-001 - Client - Quality" (narrowed to the chosen client / quality when
// that leaves something to pick). Choosing an order fills the client, quality and rate of the sale; with client and quality already chosen and exactly one open order, it is chosen for you.
const orderLabel = o => [o.no || '', o.client, o.quality].join(' - ');
function orderSaleChoices(client, quality, keep){
  const live = (DATA.orders || []).filter(o => (!o.closed && !o.revoked) || o.id === keep).sort((a, b) => String(b.no || '').localeCompare(String(a.no || ''), undefined, {numeric: true}));
  const byC = client ? live.filter(o => o.client === client || o.id === keep) : live, byQ = quality ? byC.filter(o => o.quality === quality || o.id === keep) : byC;
  return byQ.length ? byQ : byC.length ? byC : live;
}
function orderSaleField(){ return '<div class="field"><label>Order (optional)</label><select id="s_order"><option value="">No order</option></select><small id="s_order_info" class="note" style="display:block;margin-top:4px"></small></div>'; }
function wireSaleOrder(){
  const sel = document.getElementById('s_order'), cl = document.getElementById('s_client'), q = document.getElementById('s_quality'); if(!sel || !cl || !q) return;
  const ed = typeof EDITING !== 'undefined' && EDITING && EDITING.key === 'sale' ? (DATA.sale || []).find(r => r.id === EDITING.id) : null, info = document.getElementById('s_order_info');
  let busy = false;
  const show = () => { const o = (DATA.orders || []).find(x => x.id === sel.value); if(!info) return; if(!o){ info.textContent = ''; return; }
    const st = orderStats(o); info.textContent = fmtNum(o.qty) + ' m at Rs ' + o.rate + ', delivered ' + fmtNum(Math.round(st.got)) + ' m' + (st.pending ? ', ' + fmtNum(Math.round(st.pending)) + ' m to go' : '') + (o.closed ? (o.revoked ? ' (revoked)' : ' (completed)') : ''); };
  const fill = keep => {
    const opts = orderSaleChoices(cl.value, q.value, keep), both = cl.value && q.value ? opts.filter(o => o.client === cl.value && o.quality === q.value && !o.closed) : [];
    sel.innerHTML = '<option value="">No order</option>' + opts.map(o => `<option value="${o.id}">${escHtml(orderLabel(o))}</option>`).join('');
    sel.value = keep && opts.some(o => o.id === keep) ? keep : (both.length === 1 && !ed ? both[0].id : ''); show();
  };
  const pick = () => {
    const o = (DATA.orders || []).find(x => x.id === sel.value); show(); if(!o || busy) return; busy = true;
    try{ if(cl.value !== o.client){ cl.value = o.client; cl.dispatchEvent(new Event('change', {bubbles: true})); } if(q.value !== o.quality){ q.value = o.quality; q.dispatchEvent(new Event('change', {bubbles: true})); }
      const r = document.getElementById('s_rate'); if(r && (!r.value || r.dataset.fromOrder)){ r.value = o.rate; r.dataset.fromOrder = '1'; } }finally{ busy = false; }
  };
  const narrow = () => { if(!busy) fill(''); };
  cl.addEventListener('change', narrow); q.addEventListener('change', narrow); sel.addEventListener('change', pick); fill(ed ? ed.order : '');
  const rt = document.getElementById('s_rate'); if(rt) rt.addEventListener('input', () => { delete rt.dataset.fromOrder; });
}
