'use strict';
/* Owner Loans (to Company): the owner's own money put into the business and paid back later.
 * Raises cash when put in, lowers it when paid back, never touches Profit/Loss, owner-only everywhere. */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, payment, closeTo } = require('./helpers/load-app');

const app = loadApp();
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const loans = () => [
  { id: 'o1', date: '2026-09-01', type: 'Loan In', amount: 100000, purpose: 'Weft (Bana)' },
  { id: 'o2', date: '2026-09-05', type: 'Loan In', amount: 40000, purpose: 'Spare parts' },
  { id: 'o3', date: '2026-09-10', type: 'Loan Repaid', amount: 30000, purpose: '', recoveryId: 'p1' },
];

describe('Owner Loans: balance', () => {
  test('owed = put in - paid back, and put-in is split by purpose', () => {
    app.setData({ ownerLoans: loans() });
    const b = app.computeOwnerLoanBalance();
    closeTo(b.given, 140000); closeTo(b.repaid, 30000); closeTo(b.balance, 110000);
    assert.deepEqual(app.ownerLoanByPurpose(), [{ purpose: 'Weft (Bana)', amount: 100000 }, { purpose: 'Spare parts', amount: 40000 }]);
  });
  test('paying back more than is owed shows a negative balance, never hidden', () => {
    app.setData({ ownerLoans: [{ id: 'a', date: '2026-09-01', type: 'Loan In', amount: 100 }, { id: 'b', date: '2026-09-02', type: 'Loan Repaid', amount: 150 }] });
    closeTo(app.computeOwnerLoanBalance().balance, -50);
  });
  test('an old ledger with no ownerLoans at all gives zeros and does not throw', () => {
    app.setData({ ownerLoans: undefined });
    const b = app.computeOwnerLoanBalance();
    assert.equal(b.balance, 0);
    closeTo(app.computeStats('').ownerLoanOwed, 0);
  });
});

describe('Owner Loans: Cash Position and Profit/Loss', () => {
  test('without a checkpoint: money in raises cash, money paid back lowers it', () => {
    app.setData({ openingBalance: 5000, ownerLoans: loans(), warp: [{ id: 'k', date: '2026-09-02', amount: 20000 }] });
    closeTo(app.computeStats('').cash, 5000 + 140000 - 30000 - 20000);
  });
  test('with a checkpoint: only entries after its date and time count', () => {
    app.setData({
      checkpoints: [{ id: 'c', date: '2026-09-05', time: '12:00', balance: 50000 }],
      ownerLoans: [
        { id: 'o1', date: '2026-09-04', type: 'Loan In', amount: 99999 },               // before: already inside the balance
        { id: 'o2', date: '2026-09-05', time: '11:00', type: 'Loan In', amount: 88888 }, // same day, earlier
        { id: 'o3', date: '2026-09-06', type: 'Loan In', amount: 10000 },               // after: counted
        { id: 'o4', date: '2026-09-07', type: 'Loan Repaid', amount: 4000 },            // after: counted
      ],
    });
    closeTo(app.computeStats('').cash, 50000 + 10000 - 4000);
  });
  test('Profit/Loss and Business Expenses are exactly the same with and without owner loans', () => {
    const base = { sale: [{ id: 's', date: '2026-09-03', qty: 10, amount: 90000, client: 'A', quality: 'Q' }], expense: [{ id: 'x', date: '2026-09-03', amount: 2500 }] };
    app.setData(base); const a = app.computeStats('');
    app.setData({ ...base, ownerLoans: loans() }); const b = app.computeStats('');
    closeTo(b.profitCum, a.profitCum); closeTo(b.bizExpCum, a.bizExpCum); closeTo(b.receivable, a.receivable);
  });
  test('owed to you is as of the period end; put-in / paid-back also shown for the month alone', () => {
    app.setData({ ownerLoans: loans() });
    const s = app.computeStats('2026-09');
    closeTo(s.ownerLoanOwed, 110000); closeTo(s.ownerLoanInMonth, 140000); closeTo(s.ownerLoanRepaidMonth, 30000);
    const early = app.computeStats('2026-08');
    closeTo(early.ownerLoanOwed, 0);
  });
  test('paying yourself back from a recovery: cash received minus the repayment', () => {
    app.setData({ ownerLoans: [{ id: 'a', date: '2026-09-01', type: 'Loan In', amount: 100000 }, { id: 'b', date: '2026-09-10', type: 'Loan Repaid', amount: 30000, recoveryId: 'p1' }],
      recovery: [payment({ id: 'p1', date: '2026-09-10', cashAmount: 50000 })] });
    const s = app.computeStats('');
    closeTo(s.cash, 100000 + 50000 - 30000);
    closeTo(s.cash - s.ownerLoanOwed, 50000); // cash after repaying you = just the recovery money
  });
});

describe('Owner Loans: wired in everywhere, owner-only', () => {
  test('the tab, the data list and the default exist; old backups get an empty list', () => {
    const core = read('js/core.js');
    assert.match(core, /id:'ownerloans'/);
    assert.match(core, /"ownerLoans": \[\]/);
    assert.match(core, /if\(!DATA\.ownerLoans\) DATA\.ownerLoans = \[\]/);
  });
  test('backups, counts, CSV export, undo labels and the page are all aware of it', () => {
    const shell = read('js/shell.js');
    assert.match(shell, /BACKUP_KNOWN_LISTS = \[[^\]]*'ownerLoans'/);
    assert.match(shell, /n\('ownerLoans'\)/);
    assert.match(shell, /ownerLoans:'Owner_Loans'/);
    assert.match(shell, /ownerLoans:'Owner loan entry'/);
    const wiring = read('js/wiring.js');
    assert.match(wiring, /ownerloans: ownerLoansPanel/);
    assert.match(wiring, /key==='ownerLoans'\) return 'ownerloans'/);
  });
  test('owner-only: tab needs the owner-only tools section, data lives in the tools cloud section, card needs tools', () => {
    assert.match(read('js/view-only.js'), /ownerloans: \['tools'\]/);
    assert.match(read('js/view-only.js'), /owner_loans:\s+\{ needs: \['tools'\] \}/);
    assert.match(read('js/cloud-sync.js'), /id:'tools',\s+keys:\[[^\]]*'ownerLoans'/);
    // and no preset role is ever given the tools section
    const roles = read('js/cloud-sync.js').match(/const CLOUD_ROLES = \{[\s\S]*?\n\};/)[0];
    assert.doesNotMatch(roles, /tools/);
  });
  test('release bookkeeping stays in step: package.json version matches the header badge', () => {
    const html = read('index.html');
    const v = JSON.parse(read('package.json')).version;
    assert.ok(html.includes(`id="appVersionTag">v${v}<`));
    assert.match(read('service-worker.js'), /CACHE_VERSION = 'v\d+'/);
  });
});
