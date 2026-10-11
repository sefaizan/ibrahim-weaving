'use strict';
/* v3.18.79 UI fixes: sticky Wages tabs sit below the app bar, the phone frame is only drawn on screens that are
   wide AND tall (a phone turned sideways is not framed), the Wages quick-add button tucks away while scrolling,
   and summary tables are fitted to the screen (compact, or label/value cards) instead of being cut off. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = read('index.html'), ux = read('js/ux-enhance.js');

test('Wages tab strip sticks below the sticky app bar (and at 0 inside the desktop frame)', () => {
  assert.match(html, /\.wg-tabs\{[^}]*position:sticky; top:calc\(var\(--appbar-h\) \+ env\(safe-area-inset-top, 0px\)\)/);
  assert.match(html, /@media \(min-width:700px\) and \(min-height:700px\)\{ \.wg-tabs\{ top:0; \} \}/);
});
test('phone frame and fake status bar need a screen that is at least 700px wide AND tall', () => {
  assert.doesNotMatch(html, /@media \(min-width:700px\)\{/);
  assert.doesNotMatch(html, /max-width:699px/);
  assert.match(html, /@media \(min-width:700px\) and \(min-height:700px\)\{\s*html\{ display:flex/);
  assert.match(html, /@media not all and \(min-width:700px\) and \(min-height:700px\)\{ \.statusbar\{ display:none; \} \}/);
});
test('Wages quick-add button hides while scrolling', () => {
  assert.match(html, /\.wg-fab\.wg-fab-hide\{ opacity:0;/);
  assert.match(ux, /classList\.add\('wg-fab-hide'\)/);
});
test('summary tables are fitted: compact first, label/value cards when still too wide', () => {
  assert.match(ux, /function fitTables\(root\)/);
  assert.match(ux, /tb\.classList\.add\('tbl-stack'\)/);
  assert.match(ux, /fitTables\(root\);\s*\}/);          // runs on every render
  assert.match(html, /table\.fit-tbl\.tbl-stack td::before\{ content:attr\(data-label\)/);
  assert.match(ux, /heads\.some\(h => !h\.textContent\.trim\(\)\)\) return/); // action-button tables are left alone
});

test('v3.18.80: buttons are never cut off', () => {
  assert.match(html, /button\.primary:not\(\.rowbtn\), button\.ghost:not\(\.rowbtn\)\{ max-width:100%; white-space:normal;/);
  assert.match(html, /\.sel-fake\{ white-space:normal; text-overflow:clip;/);
  assert.match(ux, /function revealBtn\(b\)/);                 // Remove -> Confirm is scrolled into view in sideways logs
  assert.match(ux, /scrollBy\(\{ left: r\.right - pr\.right \+ 12 \}\)/);
});

test('v3.18.81: buttons inside Classic-table cells keep one line (cheque rows were ~900px tall)', () => {
  assert.match(html, /\.log-scroll td button\.primary, \.log-scroll td button\.ghost\{ white-space:nowrap; overflow-wrap:normal; max-width:none; \}/);
  // the phone card view still wraps its cheque buttons (more specific rule)
  assert.match(html, /html:not\(\[data-logs=\"table\"\]\) \.log-cards \.chq-actions button\{\s*width:100%; margin:0; white-space:normal;/);
});
