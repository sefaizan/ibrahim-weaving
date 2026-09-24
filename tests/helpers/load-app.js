'use strict';
/*
 * Loads the app's money-calculation code so it can be tested outside a browser.
 *
 * js/calc.js holds every calculation that only reads the global DATA object (wages, rate
 * history, shortfall shares, receivables, cheques, client statement, Overview figures, loans).
 * It contains no page code, so this file simply runs it, unchanged, in an isolated Node
 * "sandbox" with an empty ledger. The tests therefore exercise the exact file the phone loads.
 *
 * Adding a calculation? Put it in js/calc.js and it is available here automatically as
 * app.<functionName>(...).
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const CALC_JS = path.join(__dirname, '..', '..', 'js', 'calc.js');

function emptyData(){
  return {
    qualities: [], clients: [], employees: [], looms: [], warpTypes: [], banks: [],
    warpBeams: [], wageBonuses: [], wagePayments: [], wageSettlements: [], loanPayments: [],
    production: [], warp: [], weft: [], sale: [], recovery: [], expense: [], family: [],
    checkpoints: [], openingBalance: 0, wageRateHistory: {}, loomAssignments: [],
  };
}

function loadApp(){
  const src = fs.readFileSync(CALC_JS, 'utf8');
  const ctx = vm.createContext({});
  // Stand-ins for the few things calc.js expects the page to provide. "Today" is fixed so
  // date-based results (receivable aging) never change from one day to the next; the other two
  // only build display text on the client statement.
  vm.runInContext(`
    var DATA = ${JSON.stringify(emptyData())};
    var __today = '2026-09-20';
    var todayStr = () => __today;
    var __now = '12:00';
    var nowStr = () => __now;
    var fmtQtyMtr = n => String(n);
    var recoveryDescription = r => 'Payment';
  `, ctx);
  vm.runInContext(src, ctx, { filename: 'js/calc.js' });

  const app = {
    setData(patch){ ctx.DATA = Object.assign(emptyData(), patch || {}); },
    setToday(dateStr){ ctx.__today = dateStr; },
    setNow(hhmm){ ctx.__now = hhmm; },
    // For tests that change a record in place (like the Save button does) and then ask what follows.
    getData(){ return ctx.DATA; },
    replacePayment(id, change){ const p = ctx.DATA.recovery.find(r => r.id === id); change(p); return p; },
  };
  // Every function declared in calc.js becomes app.<name>. Results are copied into ordinary
  // objects/arrays (structuredClone keeps NaN and undefined intact) so tests can compare them
  // with assert.deepEqual.
  const names = [...src.matchAll(/^(?:async )?function (\w+)\(/gm)].map(m => m[1]);
  assert.ok(names.length > 20, 'js/calc.js should declare the calculation functions');
  names.forEach(n => { app[n] = (...args) => structuredClone(ctx[n](...args)); });
  return app;
}

/* Small builders so each test reads as "what happened", not as a wall of fields. */
let seq = 0;
const nextId = (p) => `${p}${++seq}`;
const prod = (o) => ({ id: nextId('p'), date: '2026-09-01', loom: '1', quality: 'Q', qty: 0,
  e1: '', e1m: 0, e2: '', e2m: 0, e3: '', e3m: 0, ...o });
const sale = (o) => ({ id: nextId('s'), date: '2026-09-01', client: 'A', quality: 'Q', qty: 0, amount: 0, ...o });
const payment = (o) => ({ id: nextId('r'), date: '2026-09-01', client: 'A', cashAmount: 0, bankAmount: 0, cheques: [], ...o });
const cheque = (amount, status, o) => ({ id: nextId('c'), amount, status, ...o });

/* Ledger amounts are plain rupees; compare with a tiny tolerance for fraction rounding
   (e.g. a Rs 10 shortfall split three ways is 3.3333...). */
function closeTo(actual, expected, message){
  assert.ok(Number.isFinite(actual), `${message || 'value'}: expected a number, got ${actual}`);
  assert.ok(Math.abs(actual - expected) < 1e-6,
    `${message || 'value'}: expected ${expected}, got ${actual}`);
}

module.exports = { loadApp, emptyData, prod, sale, payment, cheque, closeTo };
