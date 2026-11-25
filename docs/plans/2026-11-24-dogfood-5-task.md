# Dogfood-5: a format version on both SQLite stores

## Task

Tarlatan keeps two SQLite stores: the usage ledger, shared by every
project (`src/runtime/ledger-sqlite.ts`), and each project's event log
(`src/runtime/project-log.ts`). Neither records which format it holds,
so a later release that changes a format could be misread by an older
one. This task gives both stores a format version in SQLite's
`PRAGMA user_version` header field (sqlite.org/pragma.html#pragma_user_version),
stamps it on first open, and refuses a store stamped by a newer
release. It ships as v0.1.1. The coordinator bumps `package.json`,
writes `CHANGELOG.md` and tags the release after this cycle.

v0.1.0 never reads or writes the field, so every store it wrote is at
0. The coordinator read the live ledger (`~/.tarlatan/ledger.sqlite`)
and tarlatan's own log: bytes 60 to 63 of each header are `00000000`,
and both WAL files are empty.

### Owner rulings for this task (do not reopen)

1. Scope: both SQLite stores, the shared ledger and each project's
   log, get a format version. The project lock file (`lock.sqlite`,
   `src/runtime/project-lock.ts`) is not a store and is left as it is.
2. The mechanism is `PRAGMA user_version`. The format version this
   release knows is 1. A store at 0 was written by v0.1.0 and has
   format 1: the first opening command stamps it 1. A new store is
   created at 1. A store stamped higher than 1 is refused with a new
   tagged error, `StoreVersionNewer`, and is never read or written.
   `status` stays read-only: it reports each store's version and
   stamps nothing.
3. Stamping the shared ledger while another project runs v0.1.0 is
   approved: v0.1.0 never reads the header.

### Owner rulings P1 to P6 (2026-11-24, confirmed; do not reopen)

P1. **The order of `open`, and a conditional stamp.** Two processes
    can open the shared ledger together, and a newer release may stamp
    it 2 between this release's read and its write; an unconditional
    `PRAGMA user_version = 1` would then lower it. Each writer's `open`
    runs, in this order:
    1. When the file exists, read `user_version` on a separate
       read-only connection (`readonly: true`, `busy_timeout` set) and
       close it. A newer or negative version fails here, so a refused
       store gets no read-write connection: no `journal_mode` change, no
       `CREATE TABLE`, and no checkpoint on close.
    2. Open read-write as today: `busy_timeout`, then `keepWalFiles`,
       then `journal_mode=WAL` and the WAL check. The journal mode cannot
       change inside a transaction (sqlite.org/pragma.html#pragma_journal_mode),
       so this sits between the two reads.
    3. `BEGIN IMMEDIATE`; read `user_version` again and decide on that
       read; refuse newer or negative; run the `CREATE ... IF NOT EXISTS`
       statements; set `user_version = 1` only if this read gave 0;
       `COMMIT`. `user_version` is in the database header (page 1), so it
       commits and rolls back with the transaction, in WAL mode too.
    Close the connection on any failure, as the WAL refusal does now. A
    lock timeout in step 3 is `LedgerBusy` for the ledger and
    `ProjectLogError` ("project log busy") for the log, as today. Every
    log open now takes the write lock briefly (the ledger's already did,
    through `INSERT OR IGNORE`), so a log open can wait up to
    `busy_timeout`; that is accepted.

P2. **A negative version is refused, but not as newer.** `user_version`
    is a signed 32-bit integer, and no tarlatan release writes a
    negative one. A store below 0 fails with the store's existing error
    (`LedgerError` or `ProjectLogError`) with the reason `store format
    version <n> is not one tarlatan writes`, and is not read or written.

P3. **The error and the decision.** `StoreVersionNewer` is a
    `Schema.TaggedError` in a new Domain module,
    `src/domain/store-version.ts`, with fields `path` (the store's
    file), `found` (the version read) and `known` (1). The module also
    holds the known version as a named constant and the pure decision
    from a read version to one of four `Schema.TaggedClass` values:
    `StoreUnstamped` (0), `StoreCurrent` (1), `StoreNewer` (above 1,
    with `found`) and `StoreVersionInvalid` (below 0, with `found`).
    Callers branch with `Match.tag`. Do not spell the four outcomes as
    an `as const` string object: that is a closed vocabulary, which
    would need `eslint.rules.js`, and this task may not change it.
    Export every type the decision's signature names (typedoc fails on
    an unexported one). The Runtime reads the pragma and calls the
    decision; it does not compare numbers itself. The CLI prints the
    error's fields on stderr and exits 1, as for any other failure
    (`described` in `src/facade/cli.ts`); nothing there changes.

P4. **Where the error reaches.** `openLedger` fails with
    `LedgerError | LedgerBusy | StoreVersionNewer`, `openProjectLog`
    with `ProjectLogError | StoreVersionNewer`, and the two readers in
    `src/runtime/state-read.ts` likewise. The callers in `src/` are
    `production.ts:118-119` (log, then ledger), `production-exits.ts:68`
    (`step-ended`, the log only) and `:103-104` (the closes, log then
    ledger), and `production-status.ts:114` and `:152`. Every program
    factory there already returns `unknown` errors, so no type breaks.
    A log at 0 beside a newer ledger is stamped 1 before the ledger is
    refused; that is accepted, since 1 is the format the log already
    has. A newer ledger also refuses `session close --abandoned |
    --interrupted`, which must write the ledger to settle; `step-ended`
    still works, since it opens only the log.

P5. **What `status` shows.** `ProductionStatusReport`
    (`src/program/production-status.ts`) gains `storeVersions`, a struct
    with `log` (`Schema.Int`) and `ledger`
    (`Schema.OptionFromOptionalKey(Schema.Int)`, the house form for
    printed optional fields, as `src/domain/ledger.ts:92`). It prints as
    `{"log": 1, "ledger": 0}`, or `{"log": 1}` when no target is in force
    or no ledger file is found. The value is the header as read, so 0
    means "written by v0.1.0, not yet stamped". `StatusReport`
    (`src/program/status.ts`), `StatusCapabilities` and the
    `StatusContext` fakes do not change. `StateMissing` does not change:
    with no log, status reads nothing else. A newer or negative log
    fails `status` (without the log there is nothing to report).

P6. **A newer ledger under `status`.** Status's contract is to report
    what is broken beside whatever it can read (`production-status.ts:1-5`,
    `src/facade/README.md:28`), and the shared ledger can be stamped
    newer by another project's newer release. So status reports a newer
    ledger as a finding (a new `StatusFinding` case carrying `path`,
    `found` and `known`), does not read its rows, shows
    `storeVersions.ledger` with the version found, reads the ledger as
    having no rows (`ledgerFound: false`), and exits 0, as it already
    does with no target in force. Holds that rest on ledger rows are then
    absent from the report; the finding says why. A negative ledger
    version is a finding the same way, with P2's reason.

### Behaviour wanted

1. **Domain.** `src/domain/store-version.ts` as in P3, with TSDoc on
   every export, and a paragraph for it in `src/domain/README.md` in
   the form of the others.
2. **Writers.** In `ledger-sqlite.ts` and `project-log.ts`, `open`
   follows P1. Put the read of `PRAGMA user_version` (decoded with a
   Schema into a number, not cast) and the call to Domain's decision in
   `src/runtime/sqlite.ts`, shared by both stores, and keep each store's
   own error mapping. `open` already sits at the callback-depth limit
   (`ledger-sqlite.ts:247-249`), so give the transaction body named
   helpers.
3. **Readers.** In `state-read.ts`, the version check goes in the open
   (`presentOpen`), not in `read` or `readFrom`, whose error types stay
   as they are. Each reader exposes `version: number` (decoded with
   `Schema.Int`, with TSDoc). A newer or negative version fails the
   open, so no row is read. Nothing is stamped: the connection is
   read-only, and `test/facade/status-read-only.test.ts` must keep
   passing unchanged.
4. **Status.** P5 and P6.
5. **Docs.** Update what these describe:
   - `src/runtime/README.md`: both stores' paragraphs and the
     `state-read.ts` paragraph (line 19);
   - the module comments of the three Runtime files;
   - `src/facade/README.md`: line 28 (when status exits 1) and line 33
     (`ProductionStatusReport` gains a seventh field);
   - `src/program/README.md`, lines 54 and 82 (what status reads and
     shows);
   - `docs/how-it-works.md`: one sentence where it describes the stores.

### Tests

Each test below states the fact it establishes. Write them in the
existing files (`test/runtime/ledger-sqlite.test.ts`,
`test/runtime/project-log.test.ts`, `test/runtime/state-read-files.test.ts`,
`test/program/production-status.test.ts`), a new
`test/domain/store-version.test.ts`, and for the CLI a new test in the
style of `test/facade/status-read-only.test.ts`. Make a store in a given
state with `bun:sqlite` directly, in a temporary directory, as these
files already do. Two traps:
- A raw connection that is the last to close deletes the `-wal` and
  `-shm` files under Bun's SQLite on Linux (`src/runtime/sqlite.ts:94-104`),
  so a later read-only open creates them: macOS passes, Linux CI fails.
  Call `keepWalFiles` on every raw connection to a WAL-mode fixture.
- In WAL mode, page 1 can sit in the WAL, so the main file's header
  bytes can lag. Read a version with `PRAGMA user_version` on a fresh
  connection. Compare file bytes only for the rollback-mode fixtures.

Rows 1 to 4 apply to both stores.

| Fact | How the test shows it | Counterexample it must not pass |
| --- | --- | --- |
| A new store is created at 1. | Open a missing path, close, read `user_version`: 1. | A test that checks only that the open succeeds. |
| A v0.1.0 store is stamped 1 and its rows are kept. | Write rows with this release, set `user_version` to 0 on a raw connection, reopen: version 1, and every row reads back equal. | Checking the version alone: a stamp that recreated the tables would pass it. |
| A newer store is refused and left untouched. | A rollback-mode file at version 2 with one unrelated table and no tarlatan tables. Open: `StoreVersionNewer` with `path`, `found` 2 and `known` 1. The file's bytes are identical to before, and no `-wal` or `-shm` file exists. | Checking only the error tag: an open that ran `CREATE TABLE` or took WAL before refusing would pass it. |
| A negative version is refused as in P2. | As above at -1: the store's own error with P2's reason, bytes unchanged. | As above. |
| The decision is total and never lowers. | Pure test for 0, 1, 2, -1, and the 32-bit bounds. | A test of 0 and 1 only. |
| Opening a current store commits nothing. | A store at 1 with its tables; a second connection reads `PRAGMA data_version`; open and close the store; the second connection reads `data_version` again: unchanged (sqlite.org/pragma.html#pragma_data_version). Watch this test fail against an unconditional stamp before you trust it, and say so in the handoff. | A test that only re-reads `user_version`, which an unconditional stamp of 1 also leaves at 1. |
| The readers stamp nothing. | A log and a ledger at 0, opened through `state-read.ts`: `version` is 0, and a fresh connection still reads 0 after the scope closes. | A test that reads `version` and never re-reads the store. |
| A reader refuses a newer or negative store without reading rows. | A ledger at 2 holding a row that would not decode: the open fails with `StoreVersionNewer`, not `LedgerError`. The same for a log at 2, and for both at -1 (P2's reason, not a decode error). | A store at 2 with valid rows, where reading first and failing later looks the same. |
| `status` reports the raw values. | Production status over a log at 1 and a ledger at 0: `storeVersions` is `{ log: 1, ledger: 0 }`, and the ledger is still 0 afterwards. | A fixture where both stores are at 1, which cannot tell the raw value from a stamped one. |
| `status` omits the ledger's version when there is none. | No target in force, and separately no ledger file: the printed object has `storeVersions.log` and no `ledger` key. | A test of the in-force case only. |
| `status` over a newer ledger reports it and still answers (P6). | Through `main`: a log at 1 and a ledger at 2 holding a row that would not decode. Exit 0; the finding carries `path`, `found` 2 and `known` 1; `storeVersions.ledger` is 2; `ledgerFound` is false; the ledger is unchanged. | Checking the exit code alone, or a ledger with valid rows, where reading them and discarding the result looks the same. |
| A command refuses a newer ledger through production. | `session close --abandoned` over a log at 0 and a ledger at 2: fails with `StoreVersionNewer`; the ledger is unchanged and the log now reads 1 (P4's accepted order). | A Runtime-only test, which cannot show the production wiring reaches it. |

Blind spot, left to the reviewer: the race in P1 (a newer release
stamping between step 1 and step 3) cannot be staged deterministically.
The reviewer checks by reading that step 3's read, decision, table
creation and stamp sit inside one `BEGIN IMMEDIATE`.

### Steps

1. Read `AGENTS.md` first and follow it (layering, Effect v4, TSDoc,
   readable functional code). The skills it names are not available in
   this session. Do not edit `AGENTS.md` or `CLAUDE.md`.
2. Read the files named above, `src/runtime/bun-sqlite.d.ts` (the parts
   of `bun:sqlite` the project declares; extend it if you need more,
   with TSDoc), and the existing tests of the three Runtime files.
3. Write the Domain module and its test, then the writers, the readers
   and status, each with its tests.
4. Run `bun run docs` and `bun run check` and fix what they report. The
   test suite cannot run inside the sandbox (`spawn EPERM`); the owner
   runs it after your step.

### Rules

- Do not delete, skip, rename or loosen any existing test or assertion.
  An existing test may change only where the new `storeVersions` field
  (or P6's finding) or the wider error unions force it; list each such change in the
  handoff with the error that forced it.
- In new code, source and tests, use the Effect modules, never native
  array or string methods; give an arrow that calls a void function a block
  body; keep callback nesting within three levels.
- No lint-disable comments, no type casts, no non-null assertions, no
  changes to lint configuration, check scripts, `package.json`,
  `bun.lock`, `CHANGELOG.md` or CI.
- Do not commit, and run no `git` command other than `git status` and
  `git diff`.

### Done when

- `bun run docs` and `bun run check` pass in your step, and the owner's
  `bun run test` passes after it;
- every fact in the table has a test that would fail on its
  counterexample.

End with a handoff that lists every file you changed, where the
version read, the decision and the stamp sit in each `open` (file and
line), each existing test you changed and why, and anything you were
unsure about.
