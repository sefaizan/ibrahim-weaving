'use strict';
/* Receipts (print / Save as PDF, order papers, Share-as-picture) must stay in the light theme even when Dark Mode is on. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('receipts ignore dark mode', () => {
  test('print area and .receipt re-declare the light colour tokens', () => {
    const m = html.match(/#receiptPrintArea, \.receipt\{([^}]*)\}/);
    assert.ok(m, 'light-token rule for #receiptPrintArea, .receipt exists');
    const css = m[1];
    assert.match(css, /color-scheme:\s*light/);
    assert.match(css, /--ink:#1B2126/);
    assert.match(css, /--card:#FFFFFF/);
    assert.match(css, /--line:#D9DEE3/);
  });
  test('.receipt has a white background of its own', () => {
    assert.match(html, /\.receipt\{ background:#fff; \}/);
  });
  test('printing forces a white page and light colour scheme', () => {
    assert.match(html, /@media print\{\s*:root, :root\[data-theme="dark"\]\{ color-scheme: light; \}/);
    assert.match(html, /html\[data-theme="dark"\], body\{ background:#fff !important;/);
  });
  test('the light-token rule comes after the dark theme block so it wins', () => {
    assert.ok(html.indexOf('#receiptPrintArea, .receipt{') > html.indexOf(':root[data-theme="dark"]{'));
  });
});
