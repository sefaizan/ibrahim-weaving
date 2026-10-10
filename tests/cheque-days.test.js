'use strict';
/* Pending / Bounced cheque day counts: "Days Held" (since received), "Due" (against the cheque's own date),
 * and "Days Since Bounced" (exact once the bounce date is recorded, otherwise an estimate). */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const src = read('js/panels-daily.js');
const grab = name => {
  const lines = src.split('\n'), i = lines.findIndex(l => l.startsWith('function ' + name + '(') || l.startsWith('const ' + name + ' ='));
  assert.ok(i >= 0, name + ' not found');
  if (/[;}]\s*(\/\/.*)?$/.test(lines[i]) && !/\{\s*(\/\/.*)?$/.test(lines[i])) return lines[i];
  let j = i; while (!/^}/.test(lines[j])) j++;
  return lines.slice(i, j + 1).join('\n');
};
function load(today){
  const ctx = { todayStr: () => today };
  vm.createContext(ctx);
  vm.runInContext(['daysSince', 'daysUntil', 'dayWord', 'chequeDueText', 'chequeBouncedText'].map(grab).join('\n') +
    '\nthis.f = {daysSince, daysUntil, dayWord, chequeDueText, chequeBouncedText};', ctx);
  return ctx.f;
}
const strip = h => h.replace(/<[^>]*>/g, '');

describe('Due text (Pending cheques)', () => {
  const f = load('2026-10-11');
  test('dated yesterday = Overdue 1 day (not "pending 1 day")', () => assert.equal(strip(f.chequeDueText({chequeDate: '2026-10-10'})), 'Overdue 1 day'));
  test('dated today = Due today', () => assert.equal(strip(f.chequeDueText({chequeDate: '2026-10-11'})), 'Due today'));
  test('dated in 3 days = Due in 3 days', () => assert.equal(strip(f.chequeDueText({chequeDate: '2026-10-14'})), 'Due in 3 days'));
  test('older cheque, plural', () => assert.equal(strip(f.chequeDueText({chequeDate: '2026-10-01'})), 'Overdue 10 days'));
  test('no cheque date = dash', () => assert.equal(f.chequeDueText({}), '—'));
  test('overdue is flagged red', () => assert.match(f.chequeDueText({chequeDate: '2026-10-10'}), /var\(--rust\)/));
});

describe('Days Held counts from the day it was received', () => {
  const f = load('2026-10-11');
  test('received 20 days ago, dated next week: held 20 days', () => assert.equal(f.dayWord(f.daysSince('2026-09-21')), '20 days'));
  test('received today: 0 days', () => assert.equal(f.dayWord(f.daysSince('2026-10-11')), '0 days'));
  test('singular', () => assert.equal(f.dayWord(f.daysSince('2026-10-10')), '1 day'));
});

describe('Days Since Bounced', () => {
  const f = load('2026-10-11');
  test('uses the recorded bounce date when there is one', () => assert.equal(f.chequeBouncedText({bouncedOn: '2026-10-08', chequeDate: '2026-09-01', date: '2026-08-20'}), '3 days'));
  test('older entries: estimate from the cheque date, labelled as such', () => {
    const t = strip(f.chequeBouncedText({chequeDate: '2026-10-01', date: '2026-09-20'}));
    assert.match(t, /^~10 days/); assert.match(t, /estimated/);
  });
  test('no cheque date: estimate from the entry date', () => assert.match(strip(f.chequeBouncedText({date: '2026-10-09'})), /^~2 days/));
});

describe('the bounce date is recorded and kept', () => {
  test('marking Bounced stamps today; any other status clears it', () => {
    const s = read('js/lock-init.js');
    assert.match(s, /if\(status === 'Bounced'\) cheque\.bouncedOn = todayStr\(\); else delete cheque\.bouncedOn;/);
  });
  test('editing a payment keeps the cheque\'s bouncedOn', () => assert.match(read('js/wiring.js'), /\.\.\.\(c\.bouncedOn\?\{bouncedOn:c\.bouncedOn\}:\{\}\)/));
  test('tables show the new columns and not the old label', () => {
    assert.match(src, /'Amount','Days Held','Due',''\]/);
    assert.match(src, /'Amount','Days Since Bounced',''\]/);
    assert.doesNotMatch(src, /'Days Pending'/);
  });
});
