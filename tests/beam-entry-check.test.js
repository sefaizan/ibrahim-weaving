'use strict';
/* Production entries are checked against the loom's beam: no entry past length minus 2.5% shrinkage,
 * and none at all once the beam is finished and the new warp beam is not logged yet. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, prod } = require('./helpers/load-app');

const beam = (o) => ({ id: 'b1', date: '2026-09-01', time: '08:00', loom: '1', warpType: 'Micro', length: 1000, ...o });
const rec = (o) => ({ loom: '1', date: '2026-09-20', qty: 10, ...o });   // cap for a 1000 m beam = 975 m

describe('beam about to finish', () => {
  test('an entry that still fits under length - 2.5% is accepted', () => {
    const app = loadApp();
    app.setData({ warpBeams: [beam()], production: [prod({ id: 'p1', loom: '1', date: '2026-09-10', qty: 900 })] });
    assert.equal(app.beamEntryCheck(rec({ qty: 75 })).ok, true);
  });
  test('an entry past it is refused and says how many meters fit', () => {
    const app = loadApp();
    app.setData({ warpBeams: [beam()], production: [prod({ id: 'p1', loom: '1', date: '2026-09-10', qty: 900 })] });
    const r = app.beamEntryCheck(rec({ qty: 76 }));
    assert.equal(r.ok, false);
    assert.match(r.msg, /about to finish/);
    assert.match(r.msg, /2\.5% shrinkage/);
    assert.match(r.msg, /only 75 m more fits/);
  });
  test('a beam already at its limit is "finished": log the new warp beam first', () => {
    const app = loadApp();
    app.setData({ warpBeams: [beam()], production: [prod({ id: 'p1', loom: '1', date: '2026-09-10', qty: 975 })] });
    const r = app.beamEntryCheck(rec({ qty: 5 }));
    assert.equal(r.ok, false);
    assert.match(r.msg, /beam is finished/);
    assert.match(r.msg, /log the new warp beam against a new purchase/);
  });
  test('other looms, looms with no beam logged, and blank quantities are not checked', () => {
    const app = loadApp();
    app.setData({ warpBeams: [beam()], production: [prod({ id: 'p1', loom: '1', date: '2026-09-10', qty: 975 })] });
    assert.equal(app.beamEntryCheck(rec({ loom: '2', qty: 500 })).ok, true);
    assert.equal(app.beamEntryCheck(rec({ qty: 0 })).ok, true);
  });
});

describe('beam finished and the new one not logged', () => {
  const finished = () => beam({ finished: true, finishedDate: '2026-09-18', finishedTime: '10:00' });
  test('an entry after the finish date is refused', () => {
    const app = loadApp();
    app.setData({ warpBeams: [finished()], production: [prod({ id: 'p1', loom: '1', date: '2026-09-10', qty: 400 })] });
    const r = app.beamEntryCheck(rec({ date: '2026-09-19', qty: 20 }));
    assert.equal(r.ok, false);
    assert.match(r.msg, /beam is finished/);
    assert.match(r.msg, /new purchase/);
  });
  test('an entry on the finish day itself (still within the beam) is accepted', () => {
    const app = loadApp();
    app.setData({ warpBeams: [finished()], production: [prod({ id: 'p1', loom: '1', date: '2026-09-10', qty: 400 })] });
    assert.equal(app.beamEntryCheck(rec({ date: '2026-09-18', qty: 20 })).ok, true);
  });
  test('once the new beam is logged, the loom takes entries again', () => {
    const app = loadApp();
    app.setData({ warpBeams: [finished(), beam({ id: 'b2', date: '2026-09-19' })], production: [prod({ id: 'p1', loom: '1', date: '2026-09-10', qty: 400 })] });
    assert.equal(app.beamEntryCheck(rec({ date: '2026-09-19', qty: 20 })).ok, true);
  });
});

describe('editing an entry', () => {
  test('an old entry on an over-full beam can be shrunk or left as is, but not made bigger', () => {
    const app = loadApp();
    app.setData({ warpBeams: [beam()], production: [prod({ id: 'p1', loom: '1', date: '2026-09-10', qty: 600 }), prod({ id: 'p2', loom: '1', date: '2026-09-11', qty: 400 })] });   // 1000 woven
    assert.equal(app.beamEntryCheck(rec({ date: '2026-09-11', qty: 400 }), 'p2').ok, true);
    assert.equal(app.beamEntryCheck(rec({ date: '2026-09-11', qty: 300 }), 'p2').ok, true);
    assert.equal(app.beamEntryCheck(rec({ date: '2026-09-11', qty: 401 }), 'p2').ok, false);
  });
  test('the entry being edited does not count twice against the beam', () => {
    const app = loadApp();
    app.setData({ warpBeams: [beam()], production: [prod({ id: 'p1', loom: '1', date: '2026-09-10', qty: 800 })] });
    assert.equal(app.beamEntryCheck(rec({ date: '2026-09-10', qty: 900 }), 'p1').ok, true);   // 900 <= 975
    assert.equal(app.beamEntryCheck(rec({ date: '2026-09-10', qty: 980 }), 'p1').ok, false);
  });
});

describe('Urdu for the beam messages', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const ur = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js/i18n.js'), 'utf8') + '\n({ i18nTranslate })', {});
  const scenarios = [
    { name: 'about to finish', beams: [beam()], prod: [prod({ id: 'p1', loom: '1', date: '2026-09-10', qty: 900 })], r: rec({ qty: 76 }) },
    { name: 'full beam', beams: [beam()], prod: [prod({ id: 'p1', loom: '1', date: '2026-09-10', qty: 975 })], r: rec({ qty: 5 }) },
    { name: 'marked finished', beams: [beam({ finished: true, finishedDate: '2026-09-18' })], prod: [], r: rec({ date: '2026-09-19' }) },
  ];
  scenarios.forEach(s => test(s.name + ' message has an Urdu version', () => {
    const app = loadApp();
    app.setData({ warpBeams: s.beams, production: s.prod });
    const msg = app.beamEntryCheck(s.r).msg;
    const u = ur.i18nTranslate(msg);
    assert.ok(u && /[\u0600-\u06FF]/.test(u) && !/this beam/.test(u), msg);
  }));
});

describe('mark beam finished from the production form (beamFinishOffer / finishBeamAt)', () => {
  const woven = (q) => [prod({ id: 'p1', loom: '1', date: '2026-09-10', qty: q })];   // cap 975 m
  test('offered only when this entry fills the beam to within 0.5 m, not before and not over', () => {
    const app = loadApp();
    app.setData({ warpBeams: [beam()], production: woven(900) });
    assert.equal(app.beamFinishOffer(rec({ qty: 75 })).beam.id, 'b1');       // exactly fills it
    assert.equal(app.beamFinishOffer(rec({ qty: 74.6 })).beam.id, 'b1');     // within 0.5 m
    assert.equal(app.beamFinishOffer(rec({ qty: 75 })).near, true);
    assert.equal(app.beamFinishOffer(rec({ qty: 40 })).near, false);         // 940 m = 6% shrinkage: still offered, wording is the softer one
    assert.equal(app.beamFinishOffer(rec({ qty: 39 })), null);               // below the 6% point: too early to ask
    assert.equal(app.beamFinishOffer(rec({ qty: 76 })), null);               // over: blocked by beamEntryCheck instead
  });
  test('the max shrinkage is a setting', () => {
    const app = loadApp();
    app.setData({ warpBeams: [beam()], production: woven(900), costSettings: { beamMaxShrinkPct: 8 } });
    assert.equal(app.beamFinishOffer(rec({ qty: 20 })).beam.id, 'b1');       // 920 m = 8% shrinkage
    assert.equal(app.beamFinishOffer(rec({ qty: 19 })), null);
  });
  test('not offered for a beam already finished by hand or replaced by a newer beam', () => {
    const app = loadApp();
    app.setData({ warpBeams: [beam({ finished: true, finishedDate: '2026-09-15' })], production: woven(900) });
    assert.equal(app.beamFinishOffer(rec({ qty: 75, date: '2026-09-15' })), null);
    app.setData({ warpBeams: [beam(), beam({ id: 'b2', date: '2026-09-20', time: '09:00' })], production: woven(900) });
    assert.equal(app.beamFinishOffer(rec({ qty: 75, beam: 'b1' })), null);
  });
  test('finishBeamAt stamps the entry date and time, and the next entry after that date is blocked', () => {
    const app = loadApp();
    const b = beam();
    app.setData({ warpBeams: [b], production: woven(900) });
    app.finishBeamAt(b, '2026-09-20', '17:30');
    assert.equal(b.finished, true); assert.equal(b.finishedDate, '2026-09-20'); assert.equal(b.finishedTime, '17:30');
    assert.equal(app.beamEntryCheck(rec({ qty: 5, date: '2026-09-20' })).ok, true);
    assert.equal(app.beamEntryCheck(rec({ qty: 5, date: '2026-09-21' })).ok, false);
  });
  test('an entry that names the previous beam is checked against that beam, not the new one', () => {
    const app = loadApp();
    app.setData({ warpBeams: [beam(), beam({ id: 'b2', date: '2026-09-20', time: '09:00' })], production: woven(900) });
    assert.equal(app.beamEntryCheck(rec({ qty: 75, beam: 'b1' })).ok, true);
    assert.equal(app.beamEntryCheck(rec({ qty: 76, beam: 'b1' })).ok, false);
    assert.equal(app.beamEntryCheck(rec({ qty: 76, beam: 'b2' })).ok, true);
  });
});

test('both production forms wire the beam choice and the finish tickbox before saving', () => {
  const fs = require('fs'), path = require('path'), w = fs.readFileSync(path.join(__dirname, '..', 'js', 'wiring.js'), 'utf8');
  assert.equal((w.match(/applyFinishTick\(rec\)/g) || []).length, 2);                       // single entry + Add & next loom
  assert.ok(w.includes("beam:c.dataset.beam || ''") && w.includes('finishQ.forEach(f=>finishBeamAt('));   // Multiple Entries
  assert.ok(w.includes('mb_bch') && w.includes('mb_fin'));
});
