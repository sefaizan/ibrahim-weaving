'use strict';
/* Production entry: which loom "Add & next loom" moves to. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app');

const app = loadApp();
const looms = (...names) => names.map(name => ({ id: 'l' + name, name }));

describe('nextLoomAfter', () => {
  test('follows the order of the Looms list in Settings, not the numbers', () => {
    app.setData({ looms: looms('8', '7', '6') }); // a register kept in descending order
    assert.equal(app.nextLoomAfter('8'), '7');
    assert.equal(app.nextLoomAfter('7'), '6');
  });

  test('the last loom has no next loom', () => {
    app.setData({ looms: looms('1', '2', '3') });
    assert.equal(app.nextLoomAfter('3'), null);
  });

  test('nothing picked, an unknown loom, or no looms at all gives no next loom', () => {
    app.setData({ looms: looms('1', '2') });
    assert.equal(app.nextLoomAfter(''), null);
    assert.equal(app.nextLoomAfter('99'), null);
    app.setData({ looms: [] });
    assert.equal(app.nextLoomAfter('1'), null);
  });
});
