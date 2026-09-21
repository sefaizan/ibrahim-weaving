# Tests for the money calculations

These check the parts of the ledger where a silent mistake costs real money: wages (with rate
changes over time), shortfall shares, receivables, cheques and cash position. Each test sets up
a small ledger with known numbers, runs the app's own calculation, and compares it with the
answer worked out by hand.

## Running them

Needs Node.js 18 or newer (nothing to install):

    node --test          # or: npm test

All tests pass = every line prints `ok` and the summary ends with `# fail 0`.

## What is covered

| File | What it protects |
|------|------------------|
| `wages.test.js` | Rate history (which rate applies on which day), wages per period, bonuses, settlements + carry-forward, employee loans |
| `shortfall.test.js` | The Difference (qty produced - logged meters) split between employees, incl. negative differences; every meter paid exactly once |
| `receivables.test.js` | Receivable aging buckets, "before last sale" figure, client statement running balance, Overview Receivable (headline = sum of client rows, for every period filter) |
| `cheques.test.js` | How Pending / Cleared / Bounced / Replaced cheques count towards cash, received and bounced; Bounced and Pending lists; a cheque's life from Pending to Replaced |
| `production-entry.test.js` | Which loom "Add & next loom" moves to (Settings order, last loom, unknown loom) |
| `app-files.test.js` | File layout: scripts loaded + cached offline, no duplicate functions, calc.js stays page-free |
| `cash.test.js` | Cash Position from the opening balance, and from a checkpoint (same-day time rules) |
| `autobackup.test.js` | Automatic email backup: nothing sent until set up / when locked / when empty; sent once when the ledger changed and not more often than every 3 hours; the exact envelope sent to the service; password-protected files; wrong key / wrong address / no internet messages; the saved key and password never written into the page |
| `encryption.test.js` | Encrypted ledger: only the right PIN / recovery answer opens the data key, the ledger round-trips (also short / non-English text), tampering is rejected, saving refuses while locked and never writes plain data next to an encrypted ledger |

## How it works

`js/calc.js` holds every calculation that only reads the ledger data. It has no page code, so
`helpers/load-app.js` just runs that file, unchanged, in a sandbox: the tests exercise the exact
file the phone loads. A new function added to `calc.js` is available to tests automatically.

`encryption.test.js` runs the real `js/encryption.js` with a fake localStorage (the Settings buttons themselves are checked by hand on a phone).

`app-files.test.js` guards the multi-file layout: every script is loaded by `index.html` and cached
by the service worker, no function is defined twice, and `calc.js` stays free of page code.

## Adding a test

Copy any existing test, change the numbers, and work out the expected answer by hand *before*
running it. If a test fails, either the code or the hand calculation is wrong; find out which
before changing either.

The `tests/` folder and `package.json` are for development only; you don't need to upload them
to the web host.
