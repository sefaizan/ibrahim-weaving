'use strict';
/* Every tab in TABS must have an inline SVG in ICONS, or the menu shows a blank icon (it happened to Orders in 3.18.12). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('every tab icon has an ICONS entry', () => {
  const s = fs.readFileSync(require('node:path').join(__dirname, '..', 'js', 'core.js'), 'utf8');
  const tabs = [...s.slice(s.indexOf('const TABS')).split('\n];')[0].matchAll(/id:'([a-z]+)'.*?icon:'([a-z_]+)'/g)];
  const block = s.slice(s.indexOf('const ICONS = {'));
  const missing = tabs.filter(t => !new RegExp('\\n  ' + t[2] + ':').test(block)).map(t => t[1] + ' -> ' + t[2]);
  assert.ok(tabs.length > 10, 'found the tab list');
  assert.deepEqual(missing, []);
});
