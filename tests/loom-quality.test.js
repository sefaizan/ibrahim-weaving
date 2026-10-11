'use strict';
/* Loom default quality: stored on the loom assignment, a default only (v3.18.84). */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const panels = fs.readFileSync(path.join(root, 'js/panels-daily.js'), 'utf8');
const src = ['loomAssignmentFor', 'setLoomAssignment', 'loomQualityFor'].map(n => panels.match(new RegExp('function ' + n + '[\\s\\S]*?\\n}\\n'))[0]).join('\n');
const load = d => { const c = vm.createContext({ DATA: d }); vm.runInContext(src + '\nthis.api={setLoomAssignment,loomQualityFor,loomAssignmentFor};', c); return c.api; };

describe('loom default quality', () => {
  test('set, read back, and kept when only employees change', () => {
    const d = { qualities: [{ name: 'Q1' }, { name: 'Q2' }], loomAssignments: [] }, a = load(d);
    a.setLoomAssignment('1', 'A', 'B', 'Q1');
    a.setLoomAssignment('1', 'C', 'B');
    assert.equal(a.loomQualityFor('1'), 'Q1');
    assert.equal(a.loomAssignmentFor('1').e1, 'C');
  });
  test('quality alone keeps the row; clearing everything removes it', () => {
    const d = { qualities: [{ name: 'Q1' }], loomAssignments: [] }, a = load(d);
    a.setLoomAssignment('2', '', '', 'Q1'); assert.equal(d.loomAssignments.length, 1);
    a.setLoomAssignment('2', '', '', ''); assert.equal(d.loomAssignments.length, 0);
  });
  test('a deleted quality is not offered as a default', () => {
    const d = { qualities: [], loomAssignments: [{ loom: '3', e1: 'A', e2: '', q: 'Gone' }] };
    assert.equal(load(d).loomQualityFor('3'), '');
  });
  test('wiring: production form, group shortcut, multi-entry cards and rename cascade', () => {
    const w = fs.readFileSync(path.join(root, 'js/wiring.js'), 'utf8'), s = fs.readFileSync(path.join(root, 'js/shell.js'), 'utf8');
    assert.ok(w.includes("loomQualityFor(v('p_loom'))") && w.includes('la_gq_') && w.includes('cardQ'));
    assert.ok(s.includes('Set quality for the whole group') && s.includes("['loomAssignments','q']"));
  });
});
