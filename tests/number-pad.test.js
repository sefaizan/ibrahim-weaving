'use strict';
/*
 * Number fields open the phone's number pad (inputmode). Fields where a minus sign is valid
 * (balances, carry-forward) are marked data-keep-keyboard and stay on the default number keyboard.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const daily = read('js/panels-daily.js');
const fieldSrc = daily.match(/function field\([\s\S]*?\n\}/)[0];
const fracSrc = daily.match(/function meterFracField\([\s\S]*?\n\}/)[0];
const ctx = vm.runInNewContext(fieldSrc + '\n' + fracSrc + '\n({ field, meterFracField })', {});

describe('number pad keyboards', () => {
  test('field() gives every number field a decimal pad unless told otherwise', () => {
    assert.match(ctx.field('Rate', 's_rate', 'number'), /type="number" inputmode="decimal"/);
    assert.match(ctx.field('Cartons', 'w_cartons', 'number', 'inputmode="numeric"'), /inputmode="numeric"/);
    assert.doesNotMatch(ctx.field('Cartons', 'w_cartons', 'number', 'inputmode="numeric"'), /inputmode="decimal"/);
    assert.doesNotMatch(ctx.field('Opening', 'ob', 'number', 'data-keep-keyboard'), /inputmode=/);
    assert.doesNotMatch(ctx.field('Name', 'x', 'text'), /inputmode=/);
  });
  test('meter fields: whole part decimal pad, sixteenths whole-number pad', () => {
    const html = ctx.meterFracField('Qty', 'q', 'q16');
    assert.match(html, /id="q" type="number" inputmode="decimal"/);
    assert.match(html, /id="q16" type="number" inputmode="numeric"/);
  });
  test('no hand-written number input is left without an inputmode (or an explicit keep-keyboard mark)', () => {
    ['index.html', ...fs.readdirSync(path.join(root, 'js')).map(f => 'js/' + f)].forEach((f) => {
      const inputs = read(f).match(/<input\b[^>]*type=\\?"number\\?"[^>]*>/g) || [];
      inputs.forEach((tag) => assert.ok(/inputmode=|data-keep-keyboard/.test(tag), `${f}: ${tag.slice(0, 90)}`));
    });
  });
  test('fields that can be negative keep the default number keyboard', () => {
    const w = read('js/panels-wages-receipts.js');
    ['ws_carry', 'cp_bal', "'ob'", 'data-ob-emp', 'data-sa-emp'].forEach((k) => {
      const line = w.split('\n').find((l) => l.includes(k) && /type=|number/.test(l));
      assert.ok(line && /data-keep-keyboard/.test(line), `${k} should keep the default keyboard`);
    });
  });
});
