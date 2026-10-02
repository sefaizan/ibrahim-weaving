const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('view-only phones can still use Change PIN / Disable PIN Lock (device settings, not ledger edits)', () => {
  assert.match(read('js/view-only.js'), /\[data-cancel\]:not\(#pinShowChange\):not\(#pinShowDisable\)/);
  assert.match(read('index.html'), /body\.view-only \[data-cancel\]:not\(#pinShowChange\):not\(#pinShowDisable\)/);
});
