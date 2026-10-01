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
| `edit-stamps.test.js` | Who and when: an edit is stamped with the signed-in email and time, a new entry with who added it and when, the stamps never count as an edit and never decide a merge, an Undo'd delete keeps its original added stamp, the row Info button's wording (added / edited / nothing recorded), searching ignores the stamps, and the Info button still works on a view-only phone |
| `write-access.test.js` | Time-limited edit access on the other phone: edits only while an unexpired grant is held (signed in, not ended), time left in the header and Settings, learns the grant from its note, drops to view-only on expiry / shortening / revoke / sign-out with unsynced entries filed as a safety copy first (never plain data next to an encrypted ledger), no pushes afterwards; the owner's notes follow the record |
| `release2-checks.test.js` | Release 2 final checks: the People card gives and takes away edit access (Approve to edit, Allow edit / Stop edit: end time kept, note sent or removed, ended approvals refused, only the owner), a whole hand-over between two fake phones (owner grants -> worker edits -> owner stops -> view only again), and that the version / cache / HOSTING notes / this README were kept in step |
| `rates-in-wages.test.js` | Release 3 step 7: rate history and every wage record live in the Wages section and nowhere else, an operator's phone holds no rates (and any wage calculation gives 0), the Production page and Settings lists show names and meters only, and renaming a quality / employee needs edit on every section the rename reaches |
| `overview-cards.test.js` | Release 3 Overview: every card and banner tagged with the sections it needs and shown only if all are viewable; Business viewer gets Production, Sales and Cheques cards only (no Cash Position, Warp Usage, Expenses, Profit / Loss, backup reminder); the cheque Reminders banner row by row; Production operator gets no Overview page; owner sees everything |
| `roles.test.js` | Release 3 roles: the Business viewer and Production operator presets, letters (view / add / edit / delete) per section, per-person overrides, the edit switch, creating / editing / deleting / resetting roles, what the People card and each person's note hold, and what the other phone learns from its note |
| `permissions-ui.test.js` | Release 3 on screen: who is limited (never the owner), tabs left out, sections a role may not view not kept on the phone, Edit / Delete / Add controls hidden per action, a slipped-through tap stopped, and save() refusing any change outside the role (last layer) |
| `needs-approval.test.js` | Release 3 Needs approval switches: kept per person and per section in the record and the person's note, saved with the letters, kept through a role / end-time / edit-switch change and by Reset to role, cleared when off or when access ends, never changes what a person may do, the owner is never asked, nothing new for the Firebase console |
| `proposals.test.js` | Release 3 Proposals: an add / edit / delete by a person who needs approval is kept as a proposal (action, section, list, record, before, after, who, when) and the ledger is put back (also through the real save() of core.js); edits keep old and new, deletes are proposals, one save is one action, a change the role does not allow is still refused, the owner / view-only / unflagged sections are never held, nothing is let through when something fails, sealed on the phone with Encrypt Data on; the person's own list ("Waiting for approval" / "Accepted" / "Rejected" with the owner's note), Withdraw only while waiting, Clear once decided, only their own account's, the note escaped and sealed; sent to the cloud (pending, once, queued offline / when refused, never readable with Encrypt Data on and no key), the answer coming back, Withdraw taking it out of the cloud too (online only, refused once answered); the owner's Approvals inbox (who / when / before / after, Accept applies add / edit / delete / setting, conflicts stay waiting, Reject, optional note, Accept all per person, answered-elsewhere and offline handled), the header badge, owner-only screen, and the new Firestore rule block |
| `approved-stamps.test.js` | Release 3 Accept through the normal save path: an accepted edit / add / delete is applied like any other change (real save() of core.js, tombstones, Undo entry "Approved change by ...", sync scheduled) and stamped as the person's work (_cb / _mb) approved by the owner (_ca / _ma, shown on the row's Info button); the approval is used once and cleared by a later normal edit, a failed or refused Accept leaves nothing behind; the audit entry is in the person's name with the owner as approver (sent by the owner's phone, shown on the Audit screen and in its CSV Person column); stamps never count as a change, are ignored by search, and a merge still goes by the approval time |
| `proposal-conflicts.test.js` | Release 3 conflicts: when the record changed since a proposal was made the Approvals row shows both versions field by field (what they saw / now / what they want, a field you both changed marked), offers Accept anyway / Edit / Reject and no plain Accept; Accept anyway puts only the person's changed fields on top of the current record (your own later changes stay); a record deleted since can only be rejected; two proposals for one record (same or different people) mention each other, the second never overwrites the first without being shown, Accept all never forces; Edit starts from the current record with their changes on top, keeps the id, refuses half-typed numbers, applies through the normal save with stamps "theirs, approved by you" and a note for the person; deletes and order changes cannot be edited |
| `proposal-pending-edges.test.js` | Release 3 pending proposals: made offline (kept, "Not sent yet", sent once when back online, withdraw offline); access ended / revoked (a refused send keeps every proposal and says so, sent later if access returns, the access-ended message counts the ones kept, nothing deleted, what was typed stays readable); rejected ones stay in the log (cannot be cleared, show the note and what was typed, do not count as waiting), accepted ones can be cleared |
| `proposals-final-checks.test.js` | Release 3 Proposals final checks: a whole hand-over between the person's phone and the owner's phone for every action - add, edit, delete, accept (applied through the normal save), reject (ledger untouched, note kept, never cleared), stale (plain Accept refused, Accept anyway, deleted-since only rejectable), offline (kept, sent once when back; owner offline applies nothing), revoked (sent ones still answerable, unsent ones kept and sent if access returns) - and that the version / cache / notes stay in step |
| `fixes-3-17-29.test.js` | Fixes from the strict QA pass of 3.17.28: an Accept that could not be stored is taken back and the proposal waits again (also when the cloud cannot be reached: put back at the next inbox load; a locked phone is told first); a rejected proposal is kept in the audit log; a proposal sent again after the owner answered counts as sent, not as ended access; one refused audit entry does not hold back the rest; the Firestore rule refuses a person's own write to a needs-approval section and needs the matching a / e / d letter for entries and proposals; key order is not a change |
| `release3-checks.test.js` | Release 3 final checks: a whole hand-over between two fake phones for each preset (approve with a role -> the phone sees and may do exactly what the role allows -> owner changes the role, stops edit or revokes -> the phone follows), one extra section for one person touches nobody else, the owner is never limited, and the version / cache / notes stay in step |
| `wages-ui.test.js` | Wages page redesign (3.17.38): the period chips (this / last wage week, this month, Custom), the Summary tab (one card per employee, per-quality rows with own meters, Diff, rate and a star when the rate changed in the period, bonus, totals tie to the wage calculations, nobody with earnings left out), the quick-entry sheet (suggested amounts and chips, saving adds the same records as the old forms, moves to the next person still due, a change held for approval is not announced), and that the new + / Pay buttons follow the view-only and role rules while the old forms keep their ids |
| `app-files.test.js` | File layout: scripts loaded + cached offline, no duplicate functions, calc.js stays page-free |
| `cash.test.js` | Cash Position from the opening balance, and from a checkpoint (same-day time rules) |
| `autobackup.test.js` | Automatic email backup: nothing sent until set up / when locked / when empty; sent at most once per day (at midnight if the app is open, else the first open after midnight) and only when the ledger changed; the exact envelope sent to the service; password-protected files; wrong key / wrong address / no internet messages; the saved key and password never written into the page |
| `encryption.test.js` | Encrypted ledger: only the right PIN / recovery answer opens the data key, the ledger round-trips (also short / non-English text), tampering is rejected, saving refuses while locked and never writes plain data next to an encrypted ledger |
| `recovery-key.test.js` | Recovery key: format (20 characters, no look-alikes), only the right code opens the data key (any spacing/case), a new key replaces the old, refused when locked / wrong PIN, never stored, survives a PIN change |
| `cloud-status.test.js` | Cloud Sync: "Synced 2 min ago" wording, foreground re-check (at most once a minute, never over a waiting prompt/conflict), merge notice counts (+new / updated / removed) |
| `section-keys.test.js` | Section keys: a key per section, backed up in the owner's vault before any section is sealed; a person's bundle holds only the keys of sections their role may view (Business viewer, Production operator, custom); 20-character access code (stable, per person, New code invalidates the old); a person's phone opens only those sections even when handed every document; rotation on revoke / section removed / approval ended (cloud copy re-sealed in place, nothing uploaded from the owner's phone, previous key kept until done); owner's second phone (Join), encryption off and on again, earlier single-key layout moved over; People card code box; the new Firestore rules text |

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

`i18n.test.js` covers the Urdu display layer (js/i18n.js): every page name is in the dictionary, typed
ledger text is never translated, and the file can never touch the ledger or the cloud.
