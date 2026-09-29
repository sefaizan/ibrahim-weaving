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
| `replacements.test.js` | Linking a replacing payment to a bounced cheque: what can be linked, what is refused, how cheque statuses follow the links, finding and matching older unlinked Replaced cheques |
| `cheques.test.js` | How Pending / Cleared / Bounced / Replaced cheques count towards cash, received and bounced; Bounced and Pending lists; a cheque's life from Pending to Replaced |
| `production-entry.test.js` | Which loom "Add & next loom" moves to (Settings order, last loom, unknown loom) |
| `view-only.test.js` | View-only phones: who counts as view-only (owner and never-signed-in phones never do; signing out doesn't unlock), saving refused and undone, no pushing to the cloud, cloud copy still comes down, every Add / Edit / Delete / Save control is hidden and blocked |
| `cloud-auth.test.js` | Cloud Sync sign-in: email + password only (an old anonymous session is signed out), verified email required, sign up / sign in / password reset / sign out, the right account block for each state |
| `cloud-access.test.js` | Who the owner is, the config/access record (created once by the owner, never overwritten), and the Firestore rules text (owner or approved-and-unexpired; write needs write:true; only the owner edits approvals) |
| `cloud-people.test.js` | Approving people from the app (owner only): email and end-date checks, approve / extend / remove without touching anyone else, everyone approved is view-only, nothing written when a change is invalid, the People card in Settings shown only to the verified owner, with time left on each row, choosing how long (minutes / hours / days / a date and time; whole numbers only, at most 10 years, must end in the future), Extend / Shorten / Revoke per person (Revoke confirmed by reading back, changes made in one transaction), refused / offline messages |
| `release1-checks.test.js` | Release 1 final checks: header label and page class for viewers, locked fields, taps swallowed on a viewer phone (reading controls still work), an unapproved or expired account is refused politely and sends nothing, version / cache / notes kept in step |
| `write-access.test.js` | Time-limited edit access on the other phone: edits only while an unexpired grant is held (signed in, not ended), time left in the header and Settings, learns the grant from its note, drops to view-only on expiry / shortening / revoke / sign-out with unsynced entries filed as a safety copy first (never plain data next to an encrypted ledger), no pushes afterwards; the owner's notes follow the record |
| `app-files.test.js` | File layout: scripts loaded + cached offline, no duplicate functions, calc.js stays page-free |
| `cash.test.js` | Cash Position from the opening balance, and from a checkpoint (same-day time rules) |
| `autobackup.test.js` | Automatic email backup: nothing sent until set up / when locked / when empty; sent at most once per day (at midnight if the app is open, else the first open after midnight) and only when the ledger changed; the exact envelope sent to the service; password-protected files; wrong key / wrong address / no internet messages; the saved key and password never written into the page |
| `encryption.test.js` | Encrypted ledger: only the right PIN / recovery answer opens the data key, the ledger round-trips (also short / non-English text), tampering is rejected, saving refuses while locked and never writes plain data next to an encrypted ledger |
| `recovery-key.test.js` | Recovery key: format (20 characters, no look-alikes), only the right code opens the data key (any spacing/case), a new key replaces the old, refused when locked / wrong PIN, never stored, survives a PIN change |
| `cloud-status.test.js` | Cloud Sync: "Synced 2 min ago" wording, foreground re-check (at most once a minute, never over a waiting prompt/conflict), merge notice counts (+new / updated / removed) |

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
