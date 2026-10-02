const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'calc.js'), 'utf8');
const { paisaDiff } = vm.runInNewContext(src + '\n({ paisaDiff })', {});

test('wage balance is taken on whole paisa, so hidden fractions never show as owed/credit', () => {
  assert.strictEqual(paisaDiff(9533.3249, 9533.32), 0);   // was +0.0049 -> "Rs 0 owed"
  assert.strictEqual(paisaDiff(11415.2251, 11415.23), 0); // was -0.0049 -> "Rs 0 credit"
  assert.ok(Object.is(paisaDiff(9558.95, 9558.95), 0));   // never -0
  assert.strictEqual(paisaDiff(100.5, 100), 0.5);
  assert.strictEqual(paisaDiff(100, 100.5), -0.5);
});
