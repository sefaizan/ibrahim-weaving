'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
describe('wages page flow (v3.18.87)', () => {
  test('opens on the current wage week once per session', () => {
    const p = rd('js/panels-wages-receipts.js');
    assert.ok(p.includes('WAGES_UI.weekInit') && p.includes('currentWageWeek(todayStr())'));
  });
  test('no separate Pay this week list; Pay / Share live on each employee card', () => {
    const w = rd('js/wages-ui.js');
    assert.ok(!w.includes('wagesPayListHtml') && !w.includes('Pay this week'));
    assert.ok(w.includes('data-wage-add="pay"') && w.includes('data-wage-share='));
  });
  test('Share slip toast appears after a payment', () => {
    assert.ok(rd('js/wages-ui.js').includes("label: 'Share slip', fn: () => shareWageReceipt(id)"));
    assert.ok(rd('js/core.js').includes('function showToast(msg, ms, action)'));
  });
});

describe('wages page flow, part 2 (v3.18.88)', () => {
  const w = rd('js/wages-ui.js');
  test('status chip, due-first sorting, totals strip', () => {
    assert.ok(w.includes('function wagesStatusTag') && w.includes('.sort(wagesDueFirst)') && w.includes('wagesBonusAllHtml(data, from, to)'));
  });
  test('bonus to all: arm-then-add, skips anyone with a bonus in the period, date stays inside the period', () => {
    assert.ok(w.includes('data-wg-bonus-all') && w.includes('btn.__armed') && w.includes("remarks: 'Weekly bonus'"));
    assert.ok(w.includes('!(DATA.wageBonuses || []).some(b => b.employee === d.name'));
  });
  test('Rates and Settle live under More', () => {
    assert.ok(w.includes("[['sum', 'Summary'], ['pay', 'Payments']]") && w.includes('data-wtab-more'));
  });
});

describe('bonus to all by staff type (v3.18.107)', () => {
  const w = rd('js/wages-ui.js');
  test('selector offers production, salaried and all; targets follow the choice', () => {
    assert.ok(w.includes("['prod', 'Production staff'], ['sal', 'Salaried staff'], ['all', 'All']") && w.includes('id="wg_bonusType"'));
    assert.ok(w.includes("type === 'all' || (type === 'sal') === isSalariedEmp(d.name)") && w.includes('wagesBonusTargets(items, from, to, WAGES_UI.bonusType)'));
  });
});
