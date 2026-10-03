'use strict';
/* v3.17.81: when the app cannot load at all (no internet, nothing cached) the user sees a clear message, not a broken page. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
describe('offline message', () => {
  test('service worker answers a failed page load with the offline page', () => {
    const sw = read('service-worker.js');
    assert.match(sw, /function offlinePage\(\)/); assert.match(sw, /Please connect to the internet to open this app/);
    assert.match(sw, /r\.type !== 'error' && r\.status !== 0\) \? r : offlinePage\(\)/);
  });
  test('the page shows the same message if its scripts could not load', () => {
    const h = read('index.html');
    assert.match(h, /typeof switchTab === 'function' && typeof DATA === 'object'/); assert.match(h, /Please connect to the internet to open this app/);
  });
  test('version, badge and cache stay in step', () => {
    const v = JSON.parse(read('package.json')).version;
    assert.match(read('index.html'), new RegExp('id="appVersionTag">v' + v.replace(/\./g, '\\.') + '<'));
    assert.equal(v, '3.17.83'); assert.match(read('service-worker.js'), /CACHE_VERSION = 'v211'/);
  });
});
