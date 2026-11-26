# Dogfood-6: per-store versions, the log raise, findings in the log

## Task

First cycle of v0.2.0 ([design](2026-11-25-session-recovery-and-rulings-design.md),
[plan](2026-11-25-session-recovery-and-rulings-plan.md), tasks 1.1 and
1.2). Read the design's "Constraints" (the format bullets) and "Commands
and events" (`FindingsRecorded`) before you start. Two changes:

1. Each SQLite store gets its own known format version, ledger 1 and
   project log 2. A log at 1 stays readable and is raised to 2 by the
   first event a v0.1.1 build would not decode, in that event's own
   transaction.
2. A usable review's findings are recorded in the log, as a new event
   `FindingsRecorded`. That event is the first event that raises the
   log.

Nothing in this task adds a command; later cycles add `ruling add`,
`overrule` and the rest, and read `FindingsRecorded`.

### Owner rulings for this task (do not reopen)

1. The design is approved (2026-11-25); its rulings stand. In
   particular: an unstamped log (0) is stamped 1, never 2; a new log is
   created at 1; only the raise writes 2; the ledger stays at 1 and is
   never raised; existing event shapes do not change.
2. `src/domain/store-version.ts`:
   - Replace `knownStoreVersion` with `knownLedgerVersion = 1` and
     `knownLogVersion = 2`, each with TSDoc.
   - `decideStoreVersion(version: number, known: number)`: below 0
     `StoreVersionInvalid`; 0 `StoreUnstamped`; from 1 up to, not
     including, `known` the new `StoreOlderReadable { found }`; `known`
     `StoreCurrent`; above `known` `StoreNewer`. `StoreVersionNewer`'s
     `known` is the store's own known version.
   - The decision docstring's "only an unstamped store is ever stamped"
     becomes "a store is stamped 1 when unstamped, and raised only by
     the first event that needs the newer format".
   - Add `raisesLogFormat(event: ProjectEvent): boolean`, true exactly
     for the events v0.1.1 does not decode. In this task that is
     `FindingsRecorded` alone. Write it as an exhaustive `Match` over the
     event tags (`Match.tagsExhaustive` or equivalent), so each later
     cycle's new event fails to compile until it is classified; not as
     `Schema.is(FindingsRecorded)`. It lives in `store-version.ts`, which
     may import `events.ts` without a cycle.
   - Name the stamp's value: `firstStoreVersion = 1` (the house lint
     forbids a bare number in `src/`). The raise writes
     `knownLogVersion`.
3. Runtime (`src/runtime/sqlite.ts`, `project-log.ts`,
   `ledger-sqlite.ts`, `state-read.ts`):
   - Every place that reads a version passes its store's known version.
   - Writers and readers accept `StoreCurrent` and `StoreOlderReadable`
     as usable.
   - The stamp of an unstamped store writes 1 for both stores, not the
     known version. A new store is created at 1.
   - The raise: inside `appendTx`'s `BEGIN IMMEDIATE` in
     `project-log.ts`, after the position check passes and before the
     inserts, if any appended event satisfies `raisesLogFormat` and the
     version read in that transaction is 1, set
     `PRAGMA user_version = 2`. It commits and rolls back with the
     inserts. A version read there of 0 (possible only after a raw
     reset) is treated as 1. A newer or invalid version read there fails
     the append with `ProjectLogError`, its reason naming the version
     read and the known one, and writes nothing; `ProjectLog.append`'s
     error type does not change (the project lock already keeps other
     tarlatan writers out). The ledger has no raise.
   - The helpers that take a version need the store's known version:
     `readStoreVersion` (`sqlite.ts:156`), `refusalFailure` and
     `refusalOutcome` (about 191-212), `StoreWriter` (about 219) and the
     `state-read.ts` call sites (about 269, 291, 308, 355). Update the
     comments that say a usable version is "0 or 1".
4. `status` (`src/program/production-status.ts`) and its P6 finding use
   the ledger's known version. `storeVersions` keeps reporting the raw
   header values, so a log at 1 shows 1.
5. `FindingsRecorded { sessionId, reviewOpId, findings: Findings }` is
   a new `Schema.TaggedClass` in `src/domain/session-events.ts` (it adds
   `sessionId` to the design's fields, as `ReportRecorded` has) and
   joins the `ProjectEvent` union (`src/domain/events.ts`). It is
   appended in batch F (`src/program/attempt-run.ts:99`, the
   `append(position, [finished, report])` call), after `finished` and
   `report`, only when the attempt is a review, its outcome is usable
   (`usable(role, outcome)`, `src/features/step-outcome.ts:136`), and its
   findings decoded. A `Success` review records its (possibly empty)
   list. Bind `plan.decode(...)`'s result in `runClient` and add to
   `LaunchPlan` (`src/program/attempt.ts`) a pure member
   `finishedExtras: (input: { session: OpenSession; opId: OpId; outcome:
   StepOutcome; decoded: DecodedAttempt }) => ReadonlyArray<ProjectEvent>`;
   review supplies `FindingsRecorded` under the condition above, and
   `implement` (`implement.ts:58`) and `correct` (`correct.ts:75`)
   return `[]`.
6. A findings block that repeats an id fails `decodeFindingsBlock`
   (`src/format/findings.ts`, in `decodeBody`, about line 187) with
   `MalformedFindings` and the reason `finding id <id> appears more than
   once`, so the review is `Unclassified` through the existing path and
   records no `FindingsRecorded`. The reviewer's brief
   (`src/format/brief.ts`, the findings request, about lines 62-80) gains
   that each finding's id must be distinct.
7. The fold (`src/features/session.ts`) ignores `FindingsRecorded` in
   this task, so session states do not change. If a total match over
   event tags needs an arm, add one that changes nothing.
8. Existing tests: change exactly the following, and list each change
   in the handoff. Change no other expected value.
   - `test/domain/store-version.test.ts`: the assertions that
     `knownStoreVersion` is 1 and `decideStoreVersion(1)` is current
     become the per-store forms.
   - `test/program/assisted-cycle.test.ts:42-61`: add
     `"FindingsRecorded"` after `"ReportRecorded"` in the two review
     batch-F rows (lines about 50 and 59).
   - `test/features/holds.test.ts:160-166`: add `FindingsRecorded` to
     `neutralKinds`.
   - The log halves of the newer-store tests: in
     `test/runtime/project-log.test.ts:121-128` (`newerLogUntouched`)
     and `test/runtime/state-read-files.test.ts:128-135`
     (`newerRefusedUnread`) and `167-178` (`stampedAfterOpenRefused`),
     stamp the log `knownLogVersion + 1` (3) and expect `found: 3,
     known: 2`. Give the shared helpers (`storesAt`,
     `undecodableStoresAt`, `undecodableStampedRaw`) a separate log
     version. Every ledger half (2, `known: 1`) stays as it is.
   - `test/fixtures/events/encoded-events.json`: add one entry for
     `FindingsRecorded`, last, with 2-space indent, keys in the order
     `_tag, sessionId, reviewOpId, findings`, finding keys in the order
     `id, severity, file, summary`, `file` omitted when absent, and two
     findings, one with and one without `file`
     (`test/domain/events-encoding.test.ts:49-60` re-encodes the file
     byte for byte and needs one row per member).
   - Reuse `unstampedLogStamped` and `newLogAtOne`
     (`test/runtime/project-log.test.ts:99-119`) for "0 is stamped 1" and
     "a new log is created at 1"; with `knownLogVersion` 2 they now carry
     the signal.

### Tests (each fact with a counterexample it must not pass)

| Fact | Counterexample |
|---|---|
| The decision is per store: 1 is older-readable for the log and current for the ledger; 2 is current for the log and newer for the ledger; 0 unstamped and -1 invalid for both. | Testing one store only. |
| A v0.1.0 log at 0 is stamped 1, not 2, on its first read-write open; a new log is created at 1; a new ledger at 1. | A test of a new store only, which cannot tell "stamp 1" from "stamp known". |
| Appending only existing events leaves a log at 1. | Appending nothing. |
| Appending `FindingsRecorded` raises a log at 1 to 2; an append refused with `PositionMoved` leaves it at 1. | Checking the version only after a successful append, which an open-time raise also passes. |
| The raise is in the inserts' transaction: with a trigger made on a raw connection (`CREATE TRIGGER t BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'x'); END`), appending `FindingsRecorded` fails and the log still reads 1. | A raise in its own statement before the transaction, which the `PositionMoved` row cannot tell apart. |
| A log at 3 is refused by the writer and the reader with `StoreVersionNewer { found: 3, known: 2 }`; a log stamped 3 by another connection after the open fails the append with `ProjectLogError` naming 3 and writes nothing. | A log at 2, which is now current. |
| `raisesLogFormat` is false for every existing event and true for `FindingsRecorded`, checked over every row of `encoded-events.json`. | An implementation returning true for everything, tested only on the events an append test uses. |
| A log at 2 is refused by a v0.1.1-style decision (`decideStoreVersion(2, 1)` is `StoreNewer`), and a v0.2.0 reader reads it. | A log raised but read only by v0.2.0. |
| A `ChangesRequested` review's batch F holds `FindingsRecorded` with its findings in order (a new fixture with two findings, one without `file`); a `Success` review's holds an empty list; a crashed or unclassified review whose final message holds a valid, non-empty findings block records none; an implement's records none. | A test of the `ChangesRequested` case only, or a crashed review with no findings block, which an implementation keyed on "findings decoded" alone also passes. |
| A findings block with a repeated id makes the review `Unclassified` and records no `FindingsRecorded`. | A block whose ids are distinct. |
| `status` over a log at 1 and at 2 reports the raw value and no finding. | A log at 2 only. |

### Steps

1. Read `AGENTS.md` first and follow it (layering, Effect v4, TSDoc,
   closed vocabularies, readable functional code). The skills it names
   are not available in this session. Do not edit `AGENTS.md`,
   `CLAUDE.md`, `eslint.rules.js` or anything under `.claude/`.
2. Read the design sections named above and the files named in the
   rulings, and their tests.
3. Make the change test-first where you can. Run `bun run docs` and
   `bun run check` and fix what they report. You may try
   `bun --bun vitest run <one test file>`; the sandbox may refuse it, in
   which case say so.
4. Update `src/domain/README.md`, `src/runtime/README.md`,
   `src/program/README.md`, `src/format/README.md` (line 86,
   `decodeFindingsBlock`) and `src/facade/README.md` (about lines 28-40,
   the version refusals) where they describe the store versions, batch F
   or the findings block.

### Rules

- Do not delete, skip, rename or loosen any existing test or assertion
  beyond ruling 8.
- In new code, source and tests, use the Effect modules, never native
  array or string methods; give an arrow that calls a void function a
  block body; keep callback nesting within three levels.
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

End with a handoff that lists every file you changed, where the raise
sits (file and line), how batch F gets `FindingsRecorded`, each existing
test you changed and why, and anything you were unsure about.
