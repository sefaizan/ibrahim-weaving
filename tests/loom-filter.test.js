'use strict';
/* Production Log > "Filter by Loom #": the chips must show the loom NAMES (DATA.looms holds {id, name} objects; showing the object
 * itself printed "[object Object]" on every chip and broke the filter). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'panels-daily.js'), 'utf8');

test('the loom filter chips are built from loom names, never from the loom objects', () => {
  const line = src.split('\n').find(l => l.includes('id="pf_looms"'));
  assert.ok(line, 'the loom filter row exists');
  assert.ok(line.includes('mbLoomList().map(l=>'), 'chips come from the list of loom names');
  assert.ok(!/DATA\.looms\.map\(l=>`<button/.test(line), 'not from DATA.looms objects');
});
test('mbLoomList gives plain names, sorted as numbers (2 before 10)', () => {
  const vm = require('node:vm');
  const body = src.match(/function mbLoomList\(\)\{[^\n]+\}/)[0];
  const ctx = vm.createContext({ DATA: { looms: [{ id: 'a', name: '10' }, { id: 'b', name: '2' }, { id: 'c', name: '1' }] } });
  vm.runInContext(body, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.mbLoomList())), ['1', '2', '10']);
});
