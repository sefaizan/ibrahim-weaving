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
  test('Pay this week list sits first on Summary; unpaid first; tap to pay, share when paid', () => {
    const w = rd('js/wages-ui.js');
    assert.ok(w.includes('wrap.innerHTML = wagesPayListHtml(data, from, to) +'));
    assert.ok(w.includes("'Pay this week'") && w.includes('data-wage-add="pay"') && w.includes('data-wage-share='));
  });
  test('Share slip toast appears after a payment', () => {
    assert.ok(rd('js/wages-ui.js').includes("label: 'Share slip', fn: () => shareWageReceipt(id)"));
    assert.ok(rd('js/core.js').includes('function showToast(msg, ms, action)'));
  });
});
