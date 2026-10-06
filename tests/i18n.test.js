'use strict';
/*
 * The Urdu display layer (js/i18n.js). It only swaps screen text; these tests check that the dictionary covers
 * every page name, that typed data is never translated, and that the file can never touch the ledger.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const src = read('js/i18n.js');
const app = vm.runInNewContext(src + '\n({ i18nTranslate, i18nTextNode, I18N_NODES, I18N_UR, I18N_UR_PREFIX })', {});

describe('urdu dictionary', () => {
  test('every page name and menu group has an Urdu version', () => {
    const core = read('js/core.js');
    const labels = [...core.matchAll(/\{id:'[a-z]+', label:'([^']+)'/g)].map(m => m[1]);
    assert.ok(labels.length >= 18, 'found the page list');
    labels.forEach(l => assert.ok(app.i18nTranslate(l), `no Urdu for page "${l}"`));
    const groups = core.match(/const NAV_GROUPS = \[([^\]]+)\]/)[1].match(/'([^']+)'/g).map(x => x.slice(1, -1));
    groups.forEach(g => assert.ok(app.i18nTranslate(g), `no Urdu for group "${g}"`));
  });
  test('every Urdu value is real Urdu text (contains Arabic-script letters, never empty)', () => {
    Object.entries(app.I18N_UR).forEach(([en, ur]) => {
      assert.ok(/[\u0600-\u06FF]/.test(ur), `"${en}" has no Urdu letters`);
    });
  });
  test('the Production page text is covered', () => {
    ['Log Production', 'Quantity Produced (mtr)', 'Employees & Their Meters', 'Add Entry', 'Production Log', 'All Qualities']
      .forEach(t => assert.ok(app.i18nTranslate(t), t));
  });
});

describe('what is and is not translated', () => {
  test('words typed into the ledger are left alone', () => {
    ['Riaz', 'Gafar', '8', 'Rs 1,200', 'Ahmed Traders', 'Grey 60x60'].forEach(t => assert.equal(app.i18nTranslate(t), null));
  });
  test('a known text gives its Urdu, an unknown one gives null', () => {
    assert.equal(app.i18nTranslate('Production'), 'پیداوار');
    assert.equal(app.i18nTranslate('Something not in the list'), null);
  });
  test('a prefix keeps its number', () => {
    assert.equal(app.i18nTranslate('Remaining to assign: 12 mtr'), 'باقی تقسیم کرنا ہے: 12 mtr');
  });
  test('toString and other object names are not mistaken for dictionary entries', () => {
    assert.equal(app.i18nTranslate('toString'), null);
    assert.equal(app.i18nTranslate('constructor'), null);
  });
});

describe('it can never change the ledger', () => {
  test('the file never reads or writes DATA, never saves, never talks to the cloud', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/\bDATA\b/.test(code), 'must not touch DATA');
    assert.ok(!/\bsave\s*\(/.test(code), 'must not call save()');
    const noText = code.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""'); // dictionary wording may say "Cloud"
    assert.ok(!/cloud|firebase|firestore/i.test(noText), 'must not touch the cloud');
  });
  test('the choice is kept only in this phone\'s storage under its own key', () => {
    assert.match(src, /const I18N_KEY = 'khata-lang'/);
    const sync = read('js/cloud-sync.js');
    assert.ok(!sync.includes('khata-lang'), 'the language is never part of a sync');
  });
  test('typed fields are never rewritten', () => {
    assert.match(src, /TEXTAREA\|INPUT/);
  });
});

describe('swapping one piece of text', () => {
  test('keeps the spaces around it, is safe to run twice, and the English is remembered', () => {
    const n = { nodeValue: '\n   Log Production  ' };
    app.i18nTextNode(n);
    assert.equal(n.nodeValue, '\n   پیداوار درج کریں  ');
    app.i18nTextNode(n);                                   // second pass changes nothing
    assert.equal(n.nodeValue, '\n   پیداوار درج کریں  ');
    assert.equal(app.I18N_NODES.get(n).en, '\n   Log Production  ');
  });
  test('text that is not in the dictionary is untouched', () => {
    const n = { nodeValue: 'Riaz' };
    app.i18nTextNode(n);
    assert.equal(n.nodeValue, 'Riaz');
  });
});

describe('Orders page in Urdu (v3.18.27)', () => {
  const ur = s => app.i18nTranslate(s);
  test('the order form, cards, buttons and messages have Urdu', () => {
    for(const s of ['Agreement', 'Parties', 'Cloth and price', 'Delivery terms', 'Save order', 'Open orders', 'In progress', 'Mark complete', 'Share image', 'Undo revoke', 'Make replacement', 'Select the client and the quality first.', 'No terms written. Revoke anyway?']) assert.ok(ur(s), s);
  });
  test('text that carries numbers or names is translated and keeps them', () => {
    assert.equal(ur('8,000 m to go'), '8,000 میٹر باقی');
    assert.equal(ur('of 20,000 m'), 'از 20,000 میٹر');
    assert.equal(ur('ORD-001 · Q1 · Rs 100/m'), 'ORD-001 · Q1 · Rs 100/میٹر');
    assert.equal(ur('Over by 10,000 m (+50.0%)'), '10,000 میٹر زائد (+50.0%)');
    assert.equal(ur('This week 0 of 5,000 m (done)'), 'اس ہفتے 0 از 5,000 میٹر (مکمل)');
    assert.equal(ur('Revoked 5 Oct 2026, replaced by ORD-002'), 'منسوخ 5 Oct 2026، متبادل ORD-002');
    assert.equal(ur('Delete order ORD-003?'), 'آرڈر ORD-003 حذف کریں؟');
    assert.ok(ur('20,000 m at Rs 100, delivered 12,000 m, 8,000 m to go (completed)').includes('(مکمل)'));
  });
});
