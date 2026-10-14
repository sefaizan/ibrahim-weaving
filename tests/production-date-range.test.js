'use strict';
/* Production Log: a Date range row sits right above the table (chips + From / To), sharing its filter with the Summary card's row. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const panels = read('js/panels-daily.js'), wiring = read('js/wiring.js');

describe('the Production Log card', () => {
  test('has a Date range row (chips + From / To) after the loom filter and before the table', () => {
    const card = panels.slice(panels.indexOf('<h2>Production Log</h2>'), panels.indexOf("logTable('production'"));
    const loom = card.indexOf('id="pf_looms"'), range = card.indexOf('id="pl_chips"'), table = card.length;
    assert.ok(loom > 0 && range > loom && table > range, 'order: loom filter, date range, table');
    ['All Time', 'This Week', 'Last Week', 'This Month', 'Last Month', 'This Year', 'Custom…'].forEach(t => assert.ok(card.includes('\'' + t + '\''), t));
    assert.ok(card.includes('id="pl_from" value="${fromVal}"') && card.includes('id="pl_to" value="${toVal}"') && card.includes('id="pl_custom" hidden'));
  });
  test('it filters the table through the same FILTER dates the Summary card uses (so the two rows always agree)', () => {
    assert.match(panels, /let filteredProduction = [^\n]+\n\s*if\(fromVal\) filteredProduction = filteredProduction\.filter\(r=>r\.date >= fromVal\);\n\s*if\(toVal\) filteredProduction = filteredProduction\.filter\(r=>r\.date <= toVal\);/);
    assert.match(panels, /const fromVal = FILTER\.productionFrom \|\| '';/);
    assert.ok(panels.includes('id="pf_chips"') && panels.includes('id="pf_from"'), 'the Summary card keeps its own row');
  });
  test('the "Showing N entries from X to Y" note and the Summary card are unchanged', () => {
    assert.ok(panels.includes("from ${fromVal?fmtDate(fromVal):'the start'} to ${toVal?fmtDate(toVal):'now'}"));
    assert.match(panels, /\$\{productionSummaryCard\(filteredProduction, qualityVal, fromVal, toVal, productionFilterHtml\)\}\s*<div class="card"><h2>Production Log<\/h2>/);
  });
});

describe('wiring: one function serves both rows', () => {
  const fn = wiring.slice(wiring.indexOf('const wireProductionDates'), wiring.indexOf("wireProductionDates('pf_chips'"));
  assert.ok(fn.length > 200, 'found the function');
  assert.ok(wiring.includes("wireProductionDates('pf_chips', 'pf_custom', 'pf_from', 'pf_to');") && wiring.includes("wireProductionDates('pl_chips', 'pl_custom', 'pl_from', 'pl_to');"));

  function setup(from, to){
    const els = {}, mk = (id, extra) => (els[id] = Object.assign({ id, handlers: {}, hidden: false, value: '', addEventListener(t, f){ this.handlers[t] = f; } }, extra));
    const chip = (row, period) => ({ dataset: { period }, active: false, classList: { toggle(c, on){ this.on = on; } }, onclick: null, row });
    const chips = { pl: ['', 'this-week', 'last-week', 'this-month', 'last-month', 'this-year', 'custom'].map(p => chip('pl', p)), pf: ['', 'this-week', 'this-month', 'custom'].map(p => chip('pf', p)) };
    ['pl', 'pf'].forEach(k => { mk(k + '_from', { value: from || '' }); mk(k + '_to', { value: to || '' }); mk(k + '_custom', { hidden: true }); });
    const calls = [], FILTER = { productionFrom: from || '', productionTo: to || '' }, PAGE = { production: 3 };
    const ctx = vm.createContext({
      document: { getElementById: id => els[id] || null, querySelectorAll: sel => chips[/#(pl|pf)_chips/.exec(sel)[1]] },
      FILTER, PAGE, switchTab: t => calls.push(t),
      quickPeriodRange: p => p === 'this-month' ? { from: '2026-10-01', to: '2026-10-31' } : p === 'this-week' ? { from: '2026-10-12', to: '2026-10-18' } : { from: '', to: '' }
    });
    vm.runInContext(fn + "\nwireProductionDates('pl_chips','pl_custom','pl_from','pl_to'); wireProductionDates('pf_chips','pf_custom','pf_from','pf_to');", ctx);
    return { els, chips, calls, FILTER, PAGE };
  }
  const active = row => row.filter(c => c.classList.on).map(c => c.dataset.period);

  test('tapping a period in the Log sets the shared dates, goes back to page 1 and redraws', () => {
    const t = setup();
    t.chips.pl.find(c => c.dataset.period === 'this-month').onclick();
    assert.equal(t.FILTER.productionFrom, '2026-10-01'); assert.equal(t.FILTER.productionTo, '2026-10-31');
    assert.equal(t.PAGE.production, 1); assert.deepEqual(JSON.parse(JSON.stringify(t.calls)), ['production']);
    assert.deepEqual(active(t.chips.pl), ['this-month']);
    assert.equal(t.els.pl_custom.hidden, true);
  });
  test('"All Time" clears both dates', () => {
    const t = setup('2026-10-01', '2026-10-31');
    t.chips.pl.find(c => c.dataset.period === '').onclick();
    assert.equal(t.FILTER.productionFrom, ''); assert.equal(t.FILTER.productionTo, '');
  });
  test('Custom shows From / To; picking either date filters straight away', () => {
    const t = setup();
    t.chips.pl.find(c => c.dataset.period === 'custom').onclick();
    assert.equal(t.els.pl_custom.hidden, false); assert.deepEqual(active(t.chips.pl), ['custom']);
    t.els.pl_from.value = '2026-09-15'; t.els.pl_from.handlers.change();
    t.els.pl_to.value = '2026-09-20'; t.els.pl_to.handlers.change();
    assert.equal(t.FILTER.productionFrom, '2026-09-15'); assert.equal(t.FILTER.productionTo, '2026-09-20');
    assert.equal(t.calls.length, 2); assert.equal(t.PAGE.production, 1);
  });
  test('after a redraw the row shows what is active: a known period lights its chip, any other range opens Custom', () => {
    const known = setup('2026-10-01', '2026-10-31');
    assert.deepEqual(active(known.chips.pl), ['this-month']); assert.equal(known.els.pl_custom.hidden, true);
    assert.deepEqual(active(known.chips.pf), ['this-month'], 'the Summary row agrees');
    const other = setup('2026-09-15', '2026-09-20');
    assert.deepEqual(active(other.chips.pl), ['custom']); assert.equal(other.els.pl_custom.hidden, false);
    const none = setup();
    assert.deepEqual(active(none.chips.pl), ['']);
  });
});

test('the label has an Urdu version', () => {
  const ur = vm.runInNewContext(read('js/i18n.js') + '\n({ I18N_UR })', {});
  assert.ok(ur.I18N_UR['Date range']);
});
