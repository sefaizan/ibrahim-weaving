#!/usr/bin/env node
'use strict';
/* One-command release: bumps every marker that must change together, then runs the tests.
 *
 *   node scripts/release.js "short-label"        (or: npm run release -- "short-label")
 *   node scripts/release.js "short-label" minor   (bump 3.18.x -> 3.19.0; "major" likewise)
 *   node scripts/release.js --check               (no changes: just shows the current markers)
 *
 * Changes: package.json "version" (patch +1), index.html app-build (v<version>-<label>) and the
 * #appVersionTag pill, and CACHE_VERSION in service-worker.js (+1). Then runs `node --test`. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const wr = (f, t) => fs.writeFileSync(path.join(root, f), t);

const pkgText = rd('package.json'), html = rd('index.html'), sw = rd('service-worker.js');
const cur = JSON.parse(pkgText).version;
const cache = +sw.match(/const CACHE_VERSION = 'v(\d+)';/)[1];
const args = process.argv.slice(2);

if (args[0] === '--check') {
  console.log('version', cur, '| app-build', html.match(/name="app-build" content="([^"]+)"/)[1], '| CACHE_VERSION v' + cache);
  process.exit(0);
}
const label = (args[0] || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
if (!label) { console.error('Usage: node scripts/release.js "short-label" [minor|major]'); process.exit(1); }

let [ma, mi, pa] = cur.split('.').map(Number);
if (args[1] === 'major') { ma++; mi = 0; pa = 0; } else if (args[1] === 'minor') { mi++; pa = 0; } else pa++;
const next = ma + '.' + mi + '.' + pa;

const must = (re, t, what) => { if (!re.test(t)) { console.error('Could not find ' + what + ' - nothing changed.'); process.exit(1); } };
must(/name="app-build" content="[^"]+"/, html, 'the app-build tag');
must(/id="appVersionTag">v[\d.]+</, html, 'the #appVersionTag pill');

wr('package.json', pkgText.replace(/"version": "[\d.]+"/, '"version": "' + next + '"'));
wr('index.html', html
  .replace(/name="app-build" content="[^"]+"/, 'name="app-build" content="v' + next + '-' + label + '"')
  .replace(/id="appVersionTag">v[\d.]+</, 'id="appVersionTag">v' + next + '<'));
wr('service-worker.js', sw.replace(/const CACHE_VERSION = 'v\d+';/, "const CACHE_VERSION = 'v" + (cache + 1) + "';"));
console.log('Bumped ' + cur + ' -> ' + next + ', app-build v' + next + '-' + label + ', CACHE_VERSION v' + cache + ' -> v' + (cache + 1));

const r = spawnSync(process.execPath, ['--test'], { cwd: root, stdio: 'inherit' });
console.log(r.status === 0 ? '\nAll tests pass - ready to deploy.' : '\nTESTS FAILED - fix before deploying.');
process.exit(r.status || 0);
