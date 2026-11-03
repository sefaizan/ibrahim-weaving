'use strict';
/* v3.19.5: the installed-app wrapper (Android) darkened the app's dark theme a second time. The page now declares up front,
   in every way a browser / WebView looks for, that it handles dark mode itself. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = read('index.html'), wiring = read('js/wiring.js');

describe('dark mode is declared to the browser', () => {
  test('the page uses prefers-color-scheme queries (both sides), so WebViews treat it as dark-aware', () => {
    assert.match(html, /@media \(prefers-color-scheme: dark\)\{ :root\{ --scheme-hint:dark; \} \}/);
    assert.match(html, /@media \(prefers-color-scheme: light\)\{ :root\{ --scheme-hint:light; \} \}/);
  });
  test('saved dark theme sets color-scheme=dark and a dark theme-color before first paint', () => {
    const head = html.slice(0, html.indexOf('<style>'));
    assert.match(head, /if\(t === 'dark'\)\{[\s\S]*?setAttribute\('content', 'dark'\)[\s\S]*?setAttribute\('content', '#15181B'\)/);
  });
  test('the meta tags exist before the script that edits them', () => {
    assert.ok(html.indexOf('name="color-scheme"') < html.indexOf("khata-theme"));
    assert.ok(html.indexOf('name="theme-color"') < html.indexOf("khata-theme"));
  });
  test('the Dark Mode switch keeps the color-scheme meta in step', () => {
    assert.match(wiring, /csMeta\.setAttribute\('content', dark \? 'dark' : 'light dark'\)/);
  });
  test('light theme keeps its existing "only light" opt-out', () => assert.match(html, /color-scheme: only light;/));
});
