'use strict';
/*
 * Guards for the split-up app: catches the mistakes that only show up on a phone.
 *  - every file index.html loads exists, and is listed in the service worker (or the app would
 *    not work offline / would break after an update)
 *  - no function is defined twice across the js/ files (the later one would silently win)
 *  - every js file is valid JavaScript
 *  - calc.js stays free of page code, so it remains testable
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html');
const jsFiles = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).sort();
const loaded = [...html.matchAll(/<script[^>]+src="\.\/([^"]+)"/g)].map(m => m[1]);
const swFiles = [...read('service-worker.js').match(/const APP_FILES = \[([\s\S]*?)\];/)[1]
  .matchAll(/'\.\/([^']*)'/g)].map(m => m[1]);

describe('files', () => {
  test('every script index.html loads exists on disk', () => {
    loaded.forEach(f => assert.ok(fs.existsSync(path.join(root, f)), `${f} is loaded by index.html but missing`));
  });
  test('every file in js/ is loaded by index.html', () => {
    jsFiles.forEach(f => assert.ok(loaded.includes('js/' + f), `js/${f} is not loaded by index.html`));
  });
  test('calc.js loads first, and init (lock-init.js) loads last', () => {
    const app = loaded.filter(f => f.startsWith('js/'));
    assert.equal(app[0], 'js/calc.js');
    assert.equal(app[app.length - 1], 'js/lock-init.js');
  });
  test('the service worker caches every script index.html loads, and nothing that does not exist', () => {
    loaded.forEach(f => assert.ok(swFiles.includes(f), `${f} is missing from APP_FILES in service-worker.js`));
    swFiles.filter(f => f && f !== '').forEach(f => assert.ok(fs.existsSync(path.join(root, f)), `APP_FILES lists ${f} which does not exist`));
  });
});

describe('code', () => {
  test('every js file is valid JavaScript', () => {
    jsFiles.forEach(f => execFileSync(process.execPath, ['--check', path.join(root, 'js', f)]));
  });
  test('no function is defined in two places', () => {
    const seen = {};
    jsFiles.forEach(f => {
      for (const m of read('js/' + f).matchAll(/^(?:async )?function (\w+)\(/gm)) {
        assert.ok(!seen[m[1]], `function ${m[1]} is defined in both js/${seen[m[1]]} and js/${f}`);
        seen[m[1]] = f;
      }
    });
  });
  test('calc.js has no page code in it', () => {
    const code = read('js/calc.js').split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
    for (const bad of ['document.', 'window.', 'getElementById', 'innerHTML', 'localStorage', 'showToast(', 'switchTab(']) {
      assert.ok(!code.includes(bad), `js/calc.js must not use ${bad}`);
    }
  });
});
