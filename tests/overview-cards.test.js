'use strict';
/*
 * Release 3, Overview: every card (and banner) is tagged with the sections it shows data from
 * (PERM_OVERVIEW_CARDS in js/view-only.js) and appears only when the signed-in account may view ALL of them.
 * Business viewer: Production, Sales and Cheques cards only. Runs the real cloud-sync.js, view-only.js, calc.js
 * and overview.js; the pages' own helpers are small stand-ins that print a marker.
 */
const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const OWNER = 'se.muhammadfaizan@gmail.com', WORKER = 'worker@example.com';
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const HOUR = 3600 * 1000;
const VIEWER = { production: 'v', reference: 'v', sales: 'v', recovery: 'v', business: 'v' };
const OPERATOR = { production: 'vae', reference: 'v', business: 'v' };
const ALL = { production: 'v', reference: 'v', sales: 'v', recovery: 'v', expenses: 'v', wages: 'v', loans: 'v', family: 'v', materials: 'v', tools: 'v', business: 'v' };

const dayStr = off => { const d = new Date(Date.now() + off * 86400000); return d.toISOString().slice(0, 10); };
const LEDGER = () => ({
  production: [{ id: 'p1', date: dayStr(-2), loom: '1', quality: 'Q', qty: 100, e1: 'Ali', e1m: 100 }],
  sale: [{ id: 's1', client: 'Acme', quality: 'Q', qty: 50, rate: 10, amount: 500, date: dayStr(-60) }],
  recovery: [{ id: 'r1', client: 'Acme', date: dayStr(-40), amount: 100, cashAmount: 0, bankAmount: 0,
    cheques: [{ chequeId: 'c1', amount: 100, status: 'Pending', chequeDate: dayStr(-3) }, { chequeId: 'c2', amount: 250, status: 'Pending', chequeDate: dayStr(4) }] }],
  clients: [{ id: 'cl1', name: 'Acme' }], qualities: [{ id: 'q1', name: 'Q' }], employees: [], looms: [], warpBeams: [], warp: [], weft: [], expense: [], family: [], personal: [],
  wagePayments: [], wageBonuses: [], wageSettlements: [], loanPayments: [], personalLoans: [], checkpoints: [], loomAssignments: [], dyeingUnits: [], banks: [],
  wageRateHistory: {}, openingBalance: 0,
});

let ctx, store, wrap;
function load(opts) {
  opts = opts || {};
  store = new Map(); wrap = { innerHTML: '' };
  const email = opts.email === undefined ? WORKER : opts.email;
  if (email) store.set('khata-cloud-user', JSON.stringify({ email, verified: true }));
  if (opts.perms) store.set('khata-cloud-perms', JSON.stringify(opts.perms));
  if (opts.grant) store.set('khata-write-grant', JSON.stringify({ email: WORKER, expiresAt: Date.now() + 2 * HOUR }));
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {}, animate() {}, classList: { add() {}, toggle() {} } });
  const marker = id => () => `<CARD ${id}>`;
  ctx = vm.createContext({
    console: { log() {}, error() {} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, Error, RegExp, isNaN, parseFloat,
    setTimeout: () => 1, clearTimeout() {}, setInterval() {}, navigator: { onLine: true }, sessionStorage: { getItem: () => null, setItem() {} },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { getElementById: id => id === 'statsWrap' ? wrap : id === 'monthBadge' ? { innerHTML: '' } : null, querySelectorAll: () => [], createElement: el, body: { appendChild() {}, classList: { toggle() {} } }, addEventListener() {}, head: { appendChild() {} } },
    firebase: { apps: [{}], initializeApp() {}, auth: () => ({ currentUser: null, onAuthStateChanged: () => () => {}, async signOut() {} }), firestore: () => ({}) },
    escHtml: x => String(x), encEnabled: () => false, showToast() {}, sha256Hex: async s => 'h' + s.length, switchTab() {}, tombResetBaseline() {},
    ensureDataDefaults: async () => false, UNDO_STACK: [], updateUndoButton() {}, save: async () => {}, TABS: ['overview', 'production', 'sale', 'recovery', 'expense', 'wages', 'loans', 'family', 'warpbeams', 'settings', 'backup', 'graphs'].map(id => ({ id, label: id })), CUR_PANEL: 'overview',
    // stand-ins for page helpers overview.js uses
    fmtRs: n => 'Rs ' + Math.round(n || 0), fmtRs2: n => 'Rs ' + (n || 0), fmtQtyMtr: n => String(n || 0), fmtNum: n => String(n || 0), fmtDate: d => String(d),
    todayStr: () => dayStr(0), MONTH_NAMES: [], daysSinceLastBackup: () => null, quickBackup() {},
    table: (h, rows) => `<TABLE ${(h || []).join('|')}>`, sumCardOpen: () => '', sumCardClose: () => '', field: () => '', clientSelectField: () => '', ICON_SHARE: '',
    enhanceSelects() {}, wireLConfirm() {}, SHOW_BEFORE_LAST_SALE: false, LAST_STATS_MONTHVAL: '', BEAM_ALERT_DAYS_KEY: 'x',
    pendingLCardHtml: marker('pending_l'), pendingChequesCardHtml: marker('pending_cheques'), bouncedChequesCardHtml: marker('bounced_cheques'),
    clientStatementCardHtml: marker('client_statement'),
    computeStats: () => ({ stockByQuality: [], receivablesByClient: [], clientQualityBreakdown: [], qualityNames: [], checkpoint: null, cash: 0, stock: 0, profitCum: 0, profitMonth: 0,
      producedCum: 0, producedMonth: 0, soldCum: 0, soldMonth: 0, salesAmtCum: 0, salesAmtMonth: 0, receivedCum: 0, receivedMonth: 0, receivable: 0,
      bizExpCum: 0, bizExpMonth: 0, wagesPaidCum: 0, wagesPaidMonth: 0, famExpCum: 0, famExpMonth: 0, personalExpCum: 0, personalExpMonth: 0, warpCostCum: 0, warpCostMonth: 0,
      warpSetsCum: 0, warpSetsMonth: 0, weftCostCum: 0, weftCostMonth: 0, weftBagsCum: 0, weftBagsMonth: 0,
      loanGivenCum: 0, loanGivenMonth: 0, loanRepaidCum: 0, loanRepaidMonth: 0, personalLoanGivenCum: 0, personalLoanGivenMonth: 0, personalLoanRepaidCum: 0, personalLoanRepaidMonth: 0 }),
    computeReceivablesAging: () => ({ rows: [], totals: {} }), computePurchaseYield: () => [], periodLabel: () => 'All', beamAlertDays: () => 3,
    computeBeamForecasts: () => (opts.beams ? [{ id: 'b1', state: 'ending' }] : []), beamForecastRows: () => '<BEAMROWS>', beamForecastBasisNote: () => 'basis',
  });
  vm.runInContext(`var DATA = ${JSON.stringify(opts.data || LEDGER())}; var CURRENT_TAB = 'overview'; var UNDO_SUPPRESS = false;`, ctx);
  vm.runInContext(read('js/cloud-sync.js'), ctx);
  vm.runInContext(read('js/view-only.js'), ctx);
  vm.runInContext(read('js/write-access.js'), ctx);
  // overview.js needs a few calc.js helpers for the "quiet clients" row: load the real ones
  vm.runInContext(read('js/calc.js'), ctx);
  vm.runInContext(read('js/overview.js'), ctx);
  // the real calc.js / overview.js just replaced some of the stand-ins: put the ones this test needs back
  ctx.clientStatementCardHtml = marker('client_statement');
  ctx.computeBeamForecasts = () => (opts.beams ? [{ id: 'b1', state: 'ending' }] : []);
}
const run = c => vm.runInContext(c, ctx);
const cards = () => { run('renderStats("")'); return [...wrap.innerHTML.matchAll(/<CARD (\w+)>|<h2>([^<]+)<\/h2>/g)].map(m => m[1] || m[2]); };

describe('the tags', () => {
  beforeEach(() => load({ email: OWNER }));
  test('every card the Overview draws has a tag, and only tagged names are used', () => {
    const ov = read('js/overview.js');
    const used = [...ov.matchAll(/ovCardOn\('(\w+)'\)/g)].map(m => m[1]);
    const tagged = Object.keys(JSON.parse(JSON.stringify(run('PERM_OVERVIEW_CARDS'))));
    used.forEach(id => assert.ok(tagged.includes(id), id + ' is used but not tagged'));
    tagged.forEach(id => assert.ok(used.includes(id), id + ' is tagged but never used'));
  });
  test('every heading drawn by renderStats sits inside a gated block (no card is drawn unconditionally)', () => {
    const body = read('js/overview.js'); const i = body.indexOf('wrap.innerHTML = `'); const j = body.indexOf('enhanceSelects(wrap);');
    const tpl = body.slice(i, j);
    const ungated = tpl.split('\n').filter(l => /^\s{4}<div class="card">/.test(l));
    assert.deepEqual(ungated, [], 'a card starts at the top level of the template without an ovCardOn(...) around it');
  });
  test('an untagged card is never shown to a limited account', () => {
    load({ perms: VIEWER });
    assert.equal(run(`permsCardAllowed('some_new_card')`), false);
  });
  test('the owner sees every card, and so does a phone whose permissions have not arrived', () => {
    Object.keys(JSON.parse(JSON.stringify(run('PERM_OVERVIEW_CARDS')))).forEach(id => assert.equal(run(`permsCardAllowed('${id}')`), true, id));
    load({ email: WORKER });
    assert.equal(run(`permsCardAllowed('profit_loss')`), true);
  });
});

describe('Business viewer: Production, Sales and Cheques cards only', () => {
  beforeEach(() => load({ perms: VIEWER, beams: true }));
  test('which cards may be shown', () => {
    const on = id => run(`permsCardAllowed('${id}')`);
    ['pending_l', 'pending_cheques', 'bounced_cheques', 'stock', 'client_statement', 'sales_receivables', 'receivables_aging', 'client_quality', 'beams_ending', 'reminders_cheques', 'reminders_clients']
      .forEach(id => assert.equal(on(id), true, id));
    ['cash_position', 'warp_usage', 'expenses_material', 'profit_loss', 'backup_reminder'].forEach(id => assert.equal(on(id), false, id));
  });
  test('the Overview page renders exactly those cards, in order', () => {
    // 'At a Glance' leads the page; it only holds numbers this role may already see (Sales and Receivable here)
    assert.deepEqual(cards(), ['At a Glance', 'pending_l', 'pending_cheques', 'bounced_cheques', 'Stock Position', 'client_statement', 'Sales & Receivables', 'Receivables Aging', 'Clients Breakdown by Quality']);
    run('renderStats("")');
    const glance = wrap.innerHTML.match(/<div class="card ov-glance">[\s\S]*?<\/div><div class="ov-sub">/)[0];
    assert.doesNotMatch(glance, /Cash Position|Profit/);
  });
  test('the Stock card has no Cash Position tile and no checkpoint note', () => {
    run('renderStats("2026-09")');
    assert.doesNotMatch(wrap.innerHTML, /Cash Position|checkpoint/i);
    assert.match(wrap.innerHTML, /In Stock is cumulative/);
  });
  test('nothing about expenses, wages, loans, family, warp / weft cost or profit is on the page', () => {
    run('renderStats("")');
    assert.doesNotMatch(wrap.innerHTML, /Expenses|Warp Usage|Profit|Wages|Loans|Personal|Family|Material Cost/);
  });
  test('the Reminders banner shows the cheque rows and the quiet-client row (Sales + Recovery are both allowed)', () => {
    const h = run('remindersBanner()');
    assert.match(h, /1 cheque overdue/); assert.match(h, /1 cheque due within 7 days/); assert.match(h, /1 client quiet 30\+ days/);
    assert.match(h, /View Cheques/); assert.match(h, /View Clients/);
  });
  test('Beams ending soon (a Production card) is shown; the backup reminder is not', () => {
    assert.match(run('beamsEndingCard()'), /Beams ending soon/);
    assert.equal(run('backupNagBanner()'), '');
  });
  test('the Overview page and the Add Sale / Add Recovery buttons: page opens, buttons are not drawn (view only)', () => {
    assert.equal(run(`permsTabAllowed('overview')`), true);
    assert.doesNotMatch(run('overviewPanel()'), /data-quick-add/);
  });
});

describe('the cheque reminder banner, row by row', () => {
  test('Recovery only: cheque rows, but not the quiet-client row (it needs Sales too)', () => {
    load({ perms: { recovery: 'v' } });
    const h = run('remindersBanner()');
    assert.match(h, /cheque overdue/); assert.match(h, /due within 7 days/); assert.doesNotMatch(h, /quiet 30\+/); assert.doesNotMatch(h, /View Clients/);
  });
  test('Sales only: no banner at all (no cheque rows, and quiet clients needs Recovery for the balance)', () => {
    load({ perms: { sales: 'v' } });
    assert.equal(run('remindersBanner()'), '');
  });
  test('Production operator: no banner', () => {
    load({ perms: OPERATOR, grant: true });
    assert.equal(run('remindersBanner()'), '');
  });
  test('dismissal follows only what the account can see: a hidden row never changes the signature', () => {
    load({ perms: { recovery: 'v' } });
    assert.match(run('remindersBanner()'), /dismissBanner\('reminders','1:1:0'\)/);
    load({ perms: VIEWER });
    assert.match(run('remindersBanner()'), /dismissBanner\('reminders','1:1:1'\)/);
  });
  test('the owner still sees the full banner and the backup reminder', () => {
    load({ email: OWNER });
    assert.match(run('remindersBanner()'), /1 client quiet 30\+ days/);
    assert.match(run('backupNagBanner()'), /Backup Reminder/);
  });
});

describe('Production operator', () => {
  beforeEach(() => load({ perms: OPERATOR, grant: true, beams: true }));
  test('no data card qualifies, so the Overview page does not open (they start on Production)', () => {
    assert.equal(run(`permsOverviewAllowed()`), false); assert.equal(run(`permsTabAllowed('overview')`), false);
    assert.equal(run('permsFirstTab()'), 'production');
  });
  test('the beams banner is a Production card, but a banner alone does not open the page', () => {
    assert.equal(run(`permsCardAllowed('beams_ending')`), true);
    const tags = JSON.parse(JSON.stringify(run('PERM_OVERVIEW_CARDS')));
    assert.equal(tags.beams_ending.banner, true);
  });
  test('a hand-typed render still draws no cards', () => {
    assert.deepEqual(cards(), []);
  });
});

describe('a role that may view everything sees every card', () => {
  test('all sections viewable: At a Glance plus all fourteen data cards and the Cash Position tile', () => {
    load({ perms: ALL });
    assert.deepEqual(cards(), ['At a Glance', 'pending_l', 'pending_cheques', 'bounced_cheques', 'Stock Position', 'client_statement', 'Sales & Receivables', 'Warp Usage (Last 2 Months)', 'Receivables Aging', 'Clients Breakdown by Quality', 'Expenses & Material Cost', 'Profit / Loss']);
    assert.match(wrap.innerHTML, /Cash Position/);
  });
  test('Materials missing: Warp usage, Expenses & Material cost and Profit / Loss (which include warp / weft cost) are left out, and so is Cash Position', () => {
    load({ perms: Object.assign({}, ALL, { materials: undefined }) });
    const c = cards();
    ['Warp Usage (Last 2 Months)', 'Expenses & Material Cost', 'Profit / Loss'].forEach(x => assert.ok(!c.includes(x), x));
    assert.doesNotMatch(wrap.innerHTML, /Cash Position/);
  });
});

describe('release 3 step 8 files stay in step', () => {
  test('version, badge, cache and build label agree', () => {
    const ver = JSON.parse(read('package.json')).version; assert.match(ver, /^3\.17\.\d+$/);
    assert.equal(read('index.html').match(/id="appVersionTag">v([\d.]+)</)[1], ver); assert.match(read('index.html'), /name="app-build" content="[^"]*release3-/);
    assert.match(read('service-worker.js'), /CACHE_VERSION = 'v\d+'/);
  });
});
