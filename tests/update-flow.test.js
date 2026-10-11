'use strict';
/* Getting a new version without force-closing the app. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const shell = read('js/shell.js'), sw = read('service-worker.js'), html = read('index.html');
const fn = (src, name) => src.match(new RegExp('^(?:async )?function ' + name + '[\\s\\S]*?^}', 'm'))[0];

describe('an update never interrupts typing, but a leftover focused field no longer blocks it', () => {
  function busy(active, typedAgoMs, cloudPending){
    const ctx = vm.createContext({ document: { activeElement: active }, Date: { now: () => 1e12 }, _lastTypeAt: 1e12 - typedAgoMs, CLOUD_PENDING_PULL: !!cloudPending });
    vm.runInContext(fn(shell, 'updateIsBusy') + '\nthis.r = updateIsBusy();', ctx); return ctx.r;
  }
  test('typing in a field right now = busy', () => assert.equal(busy({ tagName: 'INPUT' }, 5000), true));
  test('field still focused but nothing typed for 2 minutes = not busy', () => assert.equal(busy({ tagName: 'INPUT' }, 120000), false));
  test('no field focused = not busy', () => assert.equal(busy({ tagName: 'BODY' }, 1000), false));
  test('reviewing cloud data = busy', () => assert.equal(busy({ tagName: 'BODY' }, 1e6, true), true));
});

describe('the check for a new version', () => {
  test('a newer build starts the safe update, not a bare reload that would reopen the old saved copy', () => {
    const f = fn(shell, 'checkForNewVersion').replace(/^async /, '');
    assert.match(shell, /m\[1\] !== APP_BUILD\)\{[^}]*applyNewVersion\(\)/);
    assert.doesNotMatch(f, /showUpdateBar\(/);
  });
  test('waits for the new worker to take over, with a 25 second fallback that clears the saved app copies', () => {
    assert.match(shell, /function applyNewVersion\(\)\{ showUpdateBar\(dropSavedAppCopies\); \}/);
    assert.match(shell, /beforeReload \? 25000 : 1500/);
    assert.match(shell, /n\.startsWith\('powerlooms-'\)\)\.map\(n => caches\.delete\(n\)\)/);
  });
  test('the worker taking over cuts the fallback wait short', () => assert.match(shell, /!beforeReload && _fallbackPending\)\{ clearTimeout\(_autoReloadTimer\)/));
  test('checks at most every 5 minutes, but a tap on the version pill checks right now', () => {
    assert.match(shell, /!manual && Date\.now\(\) - _lastUpdateCheck < 5\*60\*1000/);
    assert.match(shell, /closest\('#appVersionTag'\)\) checkForNewVersion\(true\)/);
  });
  test('keeps checking while the app stays open: every 10 minutes and when back online', () => {
    assert.match(shell, /setInterval\(\(\)=>\{ if\(document\.visibilityState === 'visible'\) checkForNewVersion\(\); \}, 10\*60\*1000\)/);
    assert.match(shell, /window\.addEventListener\('online', \(\)=> checkForNewVersion\(\)\)/);
  });
});

describe('the service worker is looked for often and cannot stall', () => {
  test('page asks for a newer worker on resume, focus, pageshow, online and every 10 minutes', () => {
    for (const ev of ["'visibilitychange'", "'pageshow'", "'focus'", "'online'"]) assert.ok(html.includes(ev + ', poke'), ev);
    assert.match(html, /setInterval\(poke, 10\*60\*1000\)/);
  });
  test('font downloads time out so they cannot hold up the install', () => {
    assert.match(sw, /function fetchQuick\(url, ms\)[\s\S]*?ctl\.abort\(\)/);
    assert.doesNotMatch(sw, /await fetch\(FONTS_CSS_URL/);
    assert.doesNotMatch(sw, /await fetch\(u, \{mode:'cors'\}\)/);
  });
  test('a new worker still takes over at once', () => {
    assert.match(sw, /await self\.skipWaiting\(\)/); assert.match(sw, /await self\.clients\.claim\(\)/);
  });
});
