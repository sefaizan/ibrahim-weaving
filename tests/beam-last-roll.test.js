'use strict';
/* Beam last roll (v3.19.8): a beam can be marked finished at a typed time while its last roll is still on the loom; that roll,
   logged after the next beam is attached, is linked to the old beam and the loom's idle gap is shown. Wages never read beams. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, prod, closeTo } = require('./helpers/load-app.js');

const A = { id: 'bA', loom: '1', date: '2026-10-01', time: '09:00', length: 1000, warpType: 'W' };
const B = { id: 'bB', loom: '1', date: '2026-11-07', time: '15:00', length: 1000, warpType: 'W' };   // Saturday afternoon
function data(a, extra){
  return { qualities: [{ name: 'Q1' }], clients: [], warpBeams: [a, B],
    production: [prod({ date: '2026-10-20', loom: '1', quality: 'Q1', qty: 960, beam: 'bA' })].concat(extra || []) };
}
const fin = { finished: true, finishedDate: '2026-11-05', finishedTime: '23:00', rollPending: true };   // Thursday night

describe('beam last roll', () => {
  test('manual finish time wins over the newer beam; idle gap shown; days taken stop at the finish', () => {
    const app = loadApp(); app.setData(data({ ...A, ...fin })); app.setToday('2026-11-10');
    const d = app.computeBeamDetails()['bA'];
    assert.equal(d.finishedHow, 'manual'); assert.equal(d.finishedOn, '2026-11-05'); assert.equal(d.finishedTime, '23:00');
    closeTo(d.idleDays, 40 / 24); closeTo(d.daysTaken, (35 * 24 + 14) / 24);
    assert.equal(d.rollPending, true);
  });
  test('without a manual mark (or one stamped after the new beam) the new beam still ends the old one, as before', () => {
    const app = loadApp(); app.setToday('2026-11-10');
    app.setData(data(A)); let d = app.computeBeamDetails()['bA'];
    assert.equal(d.finishedHow, 'replaced'); assert.equal(d.finishedOn, '2026-11-07'); assert.equal(d.idleDays, null);
    app.setData(data({ ...A, finished: true, finishedDate: '2026-11-09', finishedTime: '10:00' })); d = app.computeBeamDetails()['bA'];
    assert.equal(d.finishedHow, 'replaced');
  });
  test('Sunday roll linked to the old beam counts there, not on the new beam', () => {
    const app = loadApp(); app.setToday('2026-11-10');
    app.setData(data({ ...A, ...fin }, [prod({ date: '2026-11-08', loom: '1', quality: 'Q1', qty: 20, beam: 'bA' })]));
    const u = app.computeWarpBeamUsage(); closeTo(u.bA.woven, 980); closeTo(u.bB.woven, 0);
    app.setData(data({ ...A, ...fin }, [prod({ date: '2026-11-08', loom: '1', quality: 'Q1', qty: 20 })]));   // no link: falls on the new beam
    const v = app.computeWarpBeamUsage(); closeTo(v.bA.woven, 960); closeTo(v.bB.woven, 20);
  });
  test('the form asks for the first entry on the new beam, not for the second', () => {
    const app = loadApp(); app.setToday('2026-11-10'); app.setData(data({ ...A, ...fin }));
    let ch = app.beamChoiceFor('1', '2026-11-08', null);
    assert.ok(ch); assert.equal(ch.active.id, 'bB'); assert.equal(ch.prior.id, 'bA'); assert.equal(ch.pending, true);
    app.setData(data({ ...A, ...fin }, [prod({ id: 'p9', date: '2026-11-08', loom: '1', quality: 'Q1', qty: 30, beam: 'bB' })]));
    assert.equal(app.beamChoiceFor('1', '2026-11-09', null), null);            // new beam already has an entry
    assert.ok(app.beamChoiceFor('1', '2026-11-09', 'p9'));                      // editing that first entry still asks
    assert.ok(app.beamChoiceFor('1', '2026-11-07', null));                      // the changeover day asks, as before
  });
  test('no question when the previous beam is complete and not pending', () => {
    const app = loadApp(); app.setToday('2026-11-10');
    app.setData(data({ ...A, finished: true, finishedDate: '2026-11-05', finishedTime: '23:00' }, [prod({ date: '2026-10-25', loom: '1', quality: 'Q1', qty: 15, beam: 'bA' })]));
    assert.equal(app.beamChoiceFor('1', '2026-11-08', null), null);              // 975 of 1000 woven: no room left
  });
  test('a pending beam accepts its last roll after the finish time even before a new beam exists; a plain finished one refuses', () => {
    const app = loadApp(); app.setToday('2026-11-10');
    const one = a => ({ qualities: [{ name: 'Q1' }], clients: [], warpBeams: [a], production: [] });
    app.setData(one({ ...A, ...fin }));
    assert.equal(app.beamEntryCheck({ loom: '1', date: '2026-11-08', qty: 20, beam: 'bA' }).ok, true);
    app.setData(one({ ...A, finished: true, finishedDate: '2026-11-05', finishedTime: '23:00' }));
    assert.equal(app.beamEntryCheck({ loom: '1', date: '2026-11-08', qty: 20 }).ok, false);
  });
  test('saving the roll clears the pending flag; wages code never reads beams', () => {
    const app = loadApp(); app.setToday('2026-11-10'); app.setData(data({ ...A, ...fin }));
    app.beamRollTaken({ beam: 'bA' });
    assert.equal(app.computeBeamDetails()['bA'].rollPending, false);
    const calc = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'js', 'calc.js'), 'utf8');
    const w = calc.slice(calc.indexOf('function computeWages'), calc.indexOf('function computeWages') + 6000);
    assert.equal(/beam/i.test(w), false);
  });
});
