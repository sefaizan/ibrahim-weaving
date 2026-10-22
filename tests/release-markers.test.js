'use strict';
/* Every release must change all four markers together; the "App updated" notice depends on app-build. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('visible version, package.json and app-build all carry the same version', () => {
  const ver = JSON.parse(read('package.json')).version;
  const html = read('index.html');
  assert.equal(html.match(/id="appVersionTag">v([\d.]+)</)[1], ver);
  assert.ok(html.match(/name="app-build" content="([^"]+)"/)[1].startsWith('v' + ver + '-'), 'app-build must start with v' + ver + '- (bump it every release or the "App updated" notice never shows)');
  assert.match(read('service-worker.js'), /const CACHE_VERSION = 'v\d+';/);
});
