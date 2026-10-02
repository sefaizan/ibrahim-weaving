'use strict';
/* Wages > Full tables: no pinned Employee column; same table wrapper as the other pages. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

describe('wages full tables', () => {
  const ui = read('js/wages-ui.js'), full = ui.slice(ui.indexOf('class="card wg-full"'));
  test('both tables use the standard log-scroll wrapper', () => assert.equal((full.match(/<div class="log-scroll"[^>]*><table>/g) || []).length, 2));
  test('no pinned (sticky) first column anywhere in the wages page or its CSS', () => {
    assert.doesNotMatch(ui, /wg-sticky/); assert.doesNotMatch(read('index.html'), /wg-sticky/);
  });
});
