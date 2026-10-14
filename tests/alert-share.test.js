'use strict';
/* Floating Share button: ticked options become their own pictures. Loads js/alert-share.js with small stand-ins (a recording canvas,
 * a small fake ledger) and checks what is shared, how many pictures are made, that figures stay left to right, that the client's name
 * is on every order, and that no text ever runs off the edge of a picture. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// A canvas that remembers every piece of text drawn on it. A character is 0.55 of the font size wide.
function makeCanvas(all){
  const calls = [];
  const ctx = {
    calls, font: '700 40px Roboto', direction: 'ltr', textAlign: 'left', fillStyle: '', strokeStyle: '', lineWidth: 0, textBaseline: '', lineCap: '', lineJoin: '',
    createLinearGradient(){ return { addColorStop(){} }; }, fillRect(){}, strokeRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, arcTo(){}, closePath(){}, fill(){}, stroke(){}, arc(){}, drawImage(){},
    measureText(s){ const m = /(\d+)px/.exec(this.font); return { width: String(s).length * (m ? +m[1] : 40) * 0.55 }; },
    fillText(s, x, y){ calls.push({ s: String(s), x, y, font: this.font, align: this.textAlign, dir: this.direction }); }
  };
  const c = { width: 0, height: 0, ctx, calls, getContext(){ return ctx; }, toBlob(cb){ cb({ size: 1 }); } };
  all.push(c); return c;
}
const LEDGER = `
var computeStats = p => p === '' ? { stockByQuality: [{ name: '62/44 (Micro 150.144)', stock: 3299.5 }, { name: '56/42', stock: 644.25 }, { name: 'Zero', stock: 0 }], receivable: 4746457 } : { profitMonth: -500, cash: 263724 };
var DATA = { orders: [
  { no: 'ORD-002', quality: '62/44 (Micro 150.144)', client: 'Ahmed Traders', date: '2026-10-05', qty: 20000 },
  { no: 'ORD-001', quality: '62/44 (Micro 150.144)', client: 'احمد ٹریڈرز', date: '2026-09-01', qty: 10000 },
  { no: 'ORD-000', quality: '56/42', client: 'Closed Ltd', date: '2026-08-01', qty: 500, closed: true }] };
var orderStats = o => ({ got: o.no === 'ORD-001' ? 5549.25 : 0 });
var fmtQtyMtr = n => { const w = Math.floor(n + 1e-9), s = Math.round((n - w) * 16); return s ? w + '-' + s : String(w); };
var computeBeamForecasts = d => [{ loom: 11, state: 'ending', daysLeft: 4.2 }, { loom: 7, state: 'full' }, { loom: 3, state: 'soon', daysLeft: 0.3 }, { loom: 9, state: 'ok', daysLeft: 30 }, { loom: 2, state: 'soon', daysLeft: 1.2 }];
var beamAlertDays = () => 6;
var weftStockEstimate = () => ({ hasData: true, bags: 19.1, lbs: 1906, cover: 9.4, perDay: 202, low: false });
var computePendingCheques = () => [{ client: 'A', amount: 1000, chequeDate: '2026-10-01' }, { client: 'B', amount: 500, chequeDate: '2026-10-14' }, { client: 'C', amount: 9000, chequeDate: '2026-12-30' }, { client: 'D', amount: 7, chequeDate: '' }];
var todayStr = () => '2026-10-14'; var dateAddDays = () => '2026-10-21';`;
function load(extra, opts){
  opts = opts || {};
  const canvases = [], toasts = [], shared = [], dialogs = [];
  const store = opts.store || {};
  const ctx = vm.createContext({
    File: class { constructor(parts, name, o){ this.name = name; this.type = o && o.type; } },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    document: {
      createElement: t => t === 'canvas' ? makeCanvas(canvases) : { style: {}, appendChild(){}, remove(){}, querySelector: () => ({}), set innerHTML(v){ dialogs.push(v); } },
      getElementById: () => null, body: { appendChild(){} }, querySelectorAll: () => []
    },
    navigator: { canShare: opts.canShare || (() => true), share: opts.share || (async f => { shared.push(f); }) },
    showToast: m => toasts.push(m), canShareFiles: () => opts.canShareFiles !== false, switchTab: t => toasts.push('tab:' + t), setTimeout, clearTimeout, console
  });
  vm.runInContext(read('js/alert-share.js').replace(/^(const|let) /gm, 'var ') + LEDGER + (extra || ''), ctx);
  ctx.canvases = canvases; ctx.toasts = toasts; ctx.shared = shared; ctx.dialogs = dialogs; ctx.store = store;
  return ctx;
}
const J = x => JSON.parse(JSON.stringify(x));   // plain copies, so results made inside the test sandbox compare equal
// Where a piece of text starts and ends on the picture.
function extent(c, W){
  const w = c.s.length * (+/(\d+)px/.exec(c.font)[1]) * 0.55;
  return c.align === 'right' ? [c.x - w, c.x] : c.align === 'center' ? [c.x - w / 2, c.x + w / 2] : [c.x, c.x + w];
}
function allInside(canvas, W){
  canvas.calls.forEach(c => { const [a, b] = extent(c, W); assert.ok(a >= -0.5 && b <= W + 0.5, `"${c.s}" runs off the picture (${Math.round(a)}..${Math.round(b)})`); });
}

describe('what is ticked', () => {
  test('defaults, saved ticks, and the fixed order of the options', () => {
    const a = load();
    assert.deepEqual(J(a.sharePrefs()), { stock: true, beams: true, weft: true });
    assert.deepEqual(J(a.SHARE_SECTIONS.map(x => x[0])), ['stock', 'orders', 'beams', 'weft', 'cheques', 'receivable', 'profit']);
    const b = load('', { store: { 'khata-share-prefs': JSON.stringify({ stock: false, orders: true, receivable: true, note: 'old text line', phone: '0300', stockOrders: true }) } });
    assert.deepEqual(J(b.shareIds(b.sharePrefs())), ['orders', 'beams', 'weft', 'receivable']);
    b.setSharePrefs({ profit: true, stock: true, note: 'x' });
    assert.deepEqual(J(Object.keys(JSON.parse(b.store['khata-share-prefs'])).sort()), ['beams', 'cheques', 'orders', 'profit', 'receivable', 'stock', 'weft'], 'only the ticks are kept');
  });
  test('the Settings card is only tick boxes, each with what it sends - no message, number or preview', () => {
    const a = load();
    const html = a.shareFabCardHtml();
    assert.equal((html.match(/class="sf_chk"/g) || []).length, 7);
    a.SHARE_SECTIONS.forEach(x => assert.ok(html.includes(x[1]) && html.includes(x[2]), x[0] + ' has its description'));
    assert.ok(!/<textarea|type="text"|type="tel"|<button[^>]*id=/.test(html), 'no text boxes and no extra buttons');
    assert.ok(!/Preview|Share now|phone|number|WhatsApp group/i.test(html.replace(/the phone's share sheet|on this phone|this phone/gi, '')), 'the old message settings are gone');
    assert.equal(load('var permsLimited = () => true;').shareFabCardHtml(), '', 'a limited role never sees it');
  });
  test('nothing ticked: no pictures, and the person is sent to Settings', async () => {
    const a = load(), s = JSON.stringify({ stock: false, beams: false, weft: false });
    const b = load('', { store: { 'khata-share-prefs': s } });
    await b.shareFabNow();
    assert.deepEqual(J(b.toasts), ['Choose what to share in Settings first.', 'tab:settings']);
    assert.equal(b.shared.length, 0);
    assert.equal(a.shareIds({}).length, 0);
  });
  test('the old text-message code is gone from the app', () => {
    const src = read('js/alert-share.js'), shell = read('js/shell.js'), wiring = read('js/wiring.js'), html = read('index.html');
    assert.ok(!/wa\.me|alertWhatsAppUrl|alertBuild|shareBuild|alertShareCardHtml|alertShareWire|alertLangRefresh/.test(src + shell + wiring + read('js/i18n.js')));
    assert.ok(!html.includes('Share (alerts)') && html.includes('<span>Share on WhatsApp</span>'));
  });
});

describe('what each picture is made from', () => {
  const a = load();
  test('stock: only qualities with stock, biggest first, short names', () => {
    assert.deepEqual(J(a.spCollect('stock').rows), [['62/44', 3299.5], ['56/42', 644.25]]);
  });
  test('orders: open ones only, oldest first, WITH the client, what is delivered and the short quality', () => {
    const r = a.spCollect('orders').rows;
    assert.deepEqual(J(r.map(o => o.no)), ['ORD-001', 'ORD-002']);
    assert.deepEqual(J(r.map(o => o.client)), ['احمد ٹریڈرز', 'Ahmed Traders']);
    assert.equal(r[0].got, 5549.25); assert.equal(r[0].q, '62/44'); assert.equal(r[1].got, 0);
    assert.ok(!JSON.stringify(r).includes('Closed Ltd'));
  });
  test('beams: a full beam first ("now"), then by days left; today / tomorrow / N days; beams far away are left out', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(a.spCollect('beams').rows)), [[7, 'now'], [3, 'today'], [2, 'tomorrow'], [11, 4]]);
  });
  test('cheques: overdue first with days late, then due soon with days left; far-off and undated ones are left out', () => {
    const r = a.spCollect('cheques').rows;
    assert.deepEqual(J(r.map(c => c.client)), ['A', 'B']);
    assert.equal(r[0].over, 13); assert.equal(r[1].over, 0); assert.equal(r[1].inD, 0);
  });
  test('money to receive, profit and cash (a loss stays a loss)', () => {
    assert.equal(a.spCollect('receivable').total, 4746457);
    const p = a.spCollect('profit'); assert.equal(p.profit, -500); assert.equal(p.cash, 263724);
  });
  test('meters keep the app\'s sixteenths with commas: 3,299-8', () => {
    assert.equal(a.spMtr(3299.5), '3,299-8');
    assert.equal(a.spMtr(644.25), '644-4');
    assert.equal(a.spMtr(20000), '20,000');
  });
});

describe('how many pictures', () => {
  const a = load();
  test('one picture per ticked option, in the fixed order', () => {
    const data = {}; ['profit', 'stock', 'orders'].forEach(id => { data[id] = a.spCollect(id); });
    assert.deepEqual(J(a.spPlan(['stock', 'orders', 'profit'], data).map(p => p.id)), ['stock', 'orders', 'profit']);
  });
  test('too many rows for one picture: more pages, shared evenly, never a row cut through', () => {
    const rows = n => ({ rows: Array.from({ length: n }, (_, i) => i) });
    const pages = (id, n) => JSON.parse(JSON.stringify(a.spPages(id, rows(n))));
    assert.equal(pages('stock', 8).length, 1); assert.equal(pages('stock', 9).length, 2);
    assert.deepEqual(pages('stock', 12).map(p => p.to - p.from), [6, 6]);
    assert.equal(pages('orders', 3).length, 1); assert.deepEqual(pages('orders', 4).map(p => p.to - p.from), [2, 2]);
    assert.equal(pages('beams', 10).length, 1); assert.deepEqual(pages('beams', 20).map(p => p.to - p.from), [10, 10]);
    assert.equal(pages('cheques', 5).length, 1); assert.equal(pages('cheques', 6).length, 2);
    assert.deepEqual(pages('stock', 17).map(p => p.idx + '/' + p.total), ['1/3', '2/3', '3/3']);
    assert.equal(pages('stock', 0).length, 1, 'an empty option is still one picture (it says there is nothing)');
    assert.equal(a.spPages('weft', { e: {} }).length, 1);
  });
  test('every picture stays under the height chat apps shrink pictures at', () => {
    for(const id of ['stock', 'orders', 'beams', 'cheques']){
      const n = id === 'orders' ? 3 : id === 'cheques' ? 5 : id === 'beams' ? 10 : 8, d = { rows: Array.from({ length: n }, () => ({ no: 'A', client: 'C', q: 'Q', qty: 10, got: 5, client_: 1, amt: 5, date: '2026-10-01', over: 1 })) };
      d.rows = id === 'stock' || id === 'beams' ? Array.from({ length: n }, (_, i) => id === 'stock' ? ['Q' + i, 100] : [i + 1, 3]) : d.rows;
      const pg = a.spPages(id, d)[0], c = a.spCanvas(id, d, pg, false, null);
      assert.ok(c.height <= 1600, id + ' is ' + c.height + ' px tall');
    }
  });
  test('the real share builds the files: named, numbered and in order', async () => {
    const b = load('', { store: { 'khata-share-prefs': JSON.stringify({ stock: true, orders: true, beams: false, weft: false, profit: true }) } });
    const files = await b.sharePicturesBuild(b.shareIds(b.sharePrefs()));
    assert.deepEqual(J(files.map(f => f.name)), ['ibrahim-weaving_stock_2026-10-14.png', 'ibrahim-weaving_orders_2026-10-14.png', 'ibrahim-weaving_profit_2026-10-14.png']);
    assert.ok(files.every(f => f.type === 'image/png'));
  });
});

describe('what is drawn', () => {
  const orders = (ur) => { const a = load(ur ? 'var I18N_LANG = "ur";' : ''); const d = a.spCollect('orders'); return { a, c: a.spCanvas('orders', d, a.spPages('orders', d)[0], ur, null) }; };
  test('every order shows its client, order number, quality, and delivered / remaining meters in sixteenths (English)', () => {
    const { c } = orders(false), txt = c.calls.map(x => x.s.replace(/[\u202A\u202C]/g, ''));
    ['Ahmed Traders', 'احمد ٹریڈرز', 'ORD-001', 'ORD-002', '62/44', '5,549-4', '4,450-12', '20,000', '55%', '0%', 'Open orders', 'Delivered (m)', 'Remaining (m)'].forEach(t => assert.ok(txt.includes(t), t + ' is on the picture: ' + txt.join(' | ')));
    allInside(c, 1080);
  });
  test('Urdu: the words are Urdu, the figures stay left to right (3,299-8, never 8-3,299)', () => {
    const { c } = orders(true), words = c.calls.map(x => x.s);
    assert.ok(words.includes('کھلے آرڈرز') && words.includes('ڈیلیور (میٹر)') && words.includes('باقی (میٹر)'));
    const fig = c.calls.find(x => x.s.includes('5,549-4'));
    assert.ok(fig && fig.s.startsWith('\u202A') && fig.s.endsWith('\u202C') && fig.dir === 'ltr', 'figures are one left-to-right piece');
    const stock = load('var I18N_LANG = "ur";'), d = stock.spCollect('stock'), sc = stock.spCanvas('stock', d, stock.spPages('stock', d)[0], true, null);
    const q = sc.calls.find(x => x.s.includes('3,299-8'));
    assert.ok(q && q.dir === 'ltr' && !/8-3,299/.test(q.s));
    assert.ok(sc.calls.some(x => x.s === 'اسٹاک') && sc.calls.some(x => x.s === 'کوالٹی') && sc.calls.some(x => x.s === 'میٹر'));
    allInside(c, 1080); allInside(sc, 1080);
  });
  test('a typed name is drawn in its own script, in either app language', () => {
    const { c } = orders(false), urdu = c.calls.find(x => x.s === 'احمد ٹریڈرز'), eng = c.calls.find(x => x.s.replace(/[\u202A\u202C]/g, '') === 'Ahmed Traders');
    assert.equal(urdu.dir, 'rtl'); assert.ok(/Noto Naskh/.test(urdu.font));
    assert.ok(eng.dir === 'ltr' && /Roboto/.test(eng.font));
  });
  test('no text is ever cut off: long names, long words and big figures shrink to fit, in both languages, on every picture', () => {
    for(const lang of ['en', 'ur']){
      const a = load(lang === 'ur' ? 'var I18N_LANG = "ur";' : '');
      const long = 'Muhammad Ibrahim and Brothers Wholesale Cloth Merchants Limited Karachi', longUr = 'محمد ابراہیم اینڈ برادرز ہول سیل کپڑا مرچنٹس لمیٹڈ کراچی';
      const mk = id => {
        const ur = lang === 'ur';
        if(id === 'stock') return { rows: [['A very long quality name 62/44 (Micro 150.144)', 123456789.5], ['56/42', 5]] };
        if(id === 'orders') return { rows: [{ no: 'ORD-0000000012', client: ur ? longUr : long, q: 'A very long quality name (Micro)', qty: 99999999, got: 12345678.5 }, { no: 'O', client: '', q: '', qty: 10, got: 10 }] };
        if(id === 'beams') return { days: 6, rows: [[11, 'now'], [123456, 4], [7, 'tomorrow']] };
        if(id === 'weft') return { e: { hasData: true, bags: 123456.7, lbs: 98765432, cover: 12345.6, perDay: 987654, low: true } };
        if(id === 'cheques') return { rows: [{ client: ur ? longUr : long, amt: 987654321, date: '2026-10-01', over: 120 }, { client: 'B', amt: 5, date: '2026-10-14', over: 0, inD: 0 }, { client: 'C', amt: 5, date: '2026-10-20', over: 0, inD: 6 }] };
        if(id === 'receivable') return { total: 98765432109 };
        return { profit: -987654321, cash: 123456789012, label: 'September 2026' };
      };
      for(const id of ['stock', 'orders', 'beams', 'weft', 'cheques', 'receivable', 'profit']){
        const d = mk(id), c = a.spCanvas(id, d, { from: 0, to: 9, idx: 2, total: 3 }, lang === 'ur', null);
        allInside(c, 1080);
      }
      ['stock', 'orders', 'beams', 'weft', 'cheques', 'receivable', 'profit'].forEach(id => {
        const d = id === 'weft' ? { e: { hasData: false } } : id === 'receivable' ? { total: 0 } : id === 'profit' ? { profit: 1, cash: 1, label: 'x' } : { rows: [], days: 3 };
        allInside(a.spCanvas(id, d, { from: 0, to: 1, idx: 1, total: 1 }, lang === 'ur', null), 1080);
      });
    }
  });
  test('a section with nothing to show says so in words (a green tick), in English and Urdu', () => {
    const en = load(), ur = load('var I18N_LANG = "ur";');
    const t = (a, id, d) => a.spCanvas(id, d, { from: 0, to: 1, idx: 1, total: 1 }, a === ur, null).calls.map(x => x.s);
    assert.ok(t(en, 'stock', { rows: [] }).includes('No stock in hand') && t(ur, 'stock', { rows: [] }).includes('اسٹاک موجود نہیں ہے'));
    assert.ok(t(en, 'cheques', { rows: [] }).join(' ').includes('No cheques overdue or due within 7 days'), 'a long sentence wraps onto two lines');
    assert.ok(t(ur, 'cheques', { rows: [] }).join(' ').includes('کوئی چیک لیٹ یا 7 دن کے اندر واجب الادا نہیں'));
    assert.ok(t(en, 'orders', { rows: [] }).includes('No open orders'));
    assert.ok(t(en, 'beams', { rows: [], days: 6 }).join(' ').includes('No beam is ending within 6 days'));
  });
  test('the header is one line: the title centred beside the logo card, the date under it, page "1 / 2" only when there are several pages', () => {
    const a = load(), d = a.spCollect('stock'), one = a.spCanvas('stock', d, { from: 0, to: 2, idx: 1, total: 1 }, false, null), many = a.spCanvas('stock', d, { from: 0, to: 2, idx: 1, total: 2 }, false, null);
    const title = one.calls.find(x => x.s === 'Stock' && x.align === 'center');
    assert.ok(title, 'the title is centred');
    assert.ok(!one.calls.some(x => /\d \/ \d/.test(x.s)) && many.calls.some(x => /1 \/ 2/.test(x.s)));
  });
});

describe('the Share button', () => {
  test('makes the pictures, opens the phone share sheet with all of them, and says so', async () => {
    const a = load('', { store: { 'khata-share-prefs': JSON.stringify({ stock: true, orders: true, beams: false, weft: false }) } });
    await a.shareFabNow();
    assert.equal(a.shared.length, 1); assert.equal(a.shared[0].files.length, 2);
    assert.deepEqual(J(a.toasts), ['Making pictures…', 'Shared ✓ (2 pictures)']);
  });
  test('cancelling the share sheet is silent; a phone that wants a fresh tap shows a ready dialog; a phone that cannot share files says so', async () => {
    const abort = load('', { share: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; } });
    await abort.shareFabNow(); assert.ok(!abort.toasts.some(t => /Could not|Shared/.test(t)));
    const fresh = load('', { share: async () => { const e = new Error('x'); e.name = 'NotAllowedError'; throw e; } });
    await fresh.shareFabNow(); assert.equal(fresh.dialogs.length, 1); assert.ok(fresh.dialogs[0].includes('Pictures are ready') && fresh.dialogs[0].includes('3 pictures'));
    const none = load('', { canShareFiles: false }); await none.shareFabNow();
    assert.deepEqual(J(none.toasts), ['Sharing pictures is not supported on this phone.']);
    const many = load('', { canShare: () => false }); await many.shareFabNow();
    assert.ok(many.toasts.some(t => t.includes("can't share that many pictures")));
  });
});

describe('Urdu for the Settings card and the messages', () => {
  const ur = vm.runInNewContext(read('js/i18n.js') + '\n({ I18N_UR, I18N_UR_RE74 })', {});
  test('every label, description and message the Share button shows has an Urdu version', () => {
    const src = require('node:vm').runInNewContext(read('js/alert-share.js').replace(/^(const|let) /gm, 'var ') + '\n({ SHARE_SECTIONS })', {});
    src.SHARE_SECTIONS.forEach(x => { assert.ok(ur.I18N_UR[x[1]], x[1]); assert.ok(ur.I18N_UR[x[2]], x[2]); });
    ['Floating Share button', 'Share on WhatsApp', 'Floating button', 'Pictures are ready', 'Making pictures…', 'Shared ✓', 'Choose what to share in Settings first.', 'Sharing pictures is not supported on this phone.',
      'Could not make the pictures - tap Share again.', 'Could not open share - tap Share again.', "This phone can't share that many pictures at once - untick some options in Settings."].forEach(t => assert.ok(ur.I18N_UR[t], t));
    const info = fs.readFileSync(path.join(root, 'js/alert-share.js'), 'utf8').match(/<p class="note info-note" hidden>([^<]+)<\/p>/)[1];
    assert.ok(ur.I18N_UR[info], 'the info text of the card');
    assert.ok(ur.I18N_UR_RE74.some(p => p[0].test('3 pictures to share. Tap Share, then choose WhatsApp.')) && ur.I18N_UR_RE74.some(p => p[0].test('Shared ✓ (3 pictures)')));
  });
});
