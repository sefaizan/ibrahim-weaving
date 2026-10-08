'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const r = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
test('CSP present, error log loaded first, escHtml lives in calc.js', () => {
  const h = r('index.html');
  assert.match(h, /Content-Security-Policy/);
  assert.ok(h.indexOf('js/errorlog.js') < h.indexOf('js/ledger-store.js'));
  assert.match(r('js/calc.js'), /function escHtml/);
  assert.doesNotMatch(r('js/lock-init.js'), /function escHtml/);
});
test('service worker does not refresh cached app files in the background', () => {
  assert.doesNotMatch(r('service-worker.js'), /event\.waitUntil\(refresh\)/);
});
test('icon-only buttons with a title also have an aria-label', () => {
  const bad = (r('index.html').match(/<button[^>]*title="[^"]+"[^>]*>/g) || []).filter(b => !/aria-label/.test(b));
  assert.deepStrictEqual(bad, []);
});
