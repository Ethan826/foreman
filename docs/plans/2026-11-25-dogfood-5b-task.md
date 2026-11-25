# Dogfood-5b: serialize the read-only readers (second session)

## Read this first: the worktree already holds round 1

This is the second session for the store version check. The first
(dogfood-5, [task](2026-11-24-dogfood-5-task.md)) ran an implement step
and two corrections, and its change is still in the worktree,
uncommitted: the new `src/domain/store-version.ts`, the shared writer
open in `src/runtime/sqlite.ts`, the versioned snapshot reads in
`src/runtime/state-read.ts`, `storeVersions` and the P6 finding in
`src/program/production-status.ts`, their tests and the README updates.
The session ended because tarlatan allows two corrections a session.
The owner's check on that tree passed: `bun run docs`, `bun run check`
and 1,712 of 1,712 tests.

The last review left one finding to fix (F8, below). Everything else
in the worktree has been reviewed three times; do not change it except
as F8 requires. The rulings of the dogfood-5 task (1 to 3 and P1 to P6)
still hold.

## Task

F8 (review 3 of dogfood-5, minor): concurrent reads on one reader can
fail. Each read in `state-read.ts` starts a deferred transaction on the
reader's one connection (`versionedRead`, about line 244, through
`transaction(readConnection(...), ...)`), with nothing serializing
them. The reviewer's in-memory probe ran two concurrent reads of 30,000
events on one `LogReader`: one returned every event, the other failed
with `cannot start a transaction within a transaction`. Before
dogfood-5 the log's read was one statement and did not fail this way.

### Owner rulings for this task (do not reopen)

1. Serialize each reader's whole snapshot transaction (begin, the
   version read, the row read, commit or rollback) on a one-permit
   semaphore made per reader, for both the log reader and the ledger
   reader. Follow the writers' pattern: `Semaphore.makeUnsafe(1)` when
   the store is opened and `Semaphore.withPermits(lock, 1)` around the
   transaction (`storeOf` in `src/runtime/ledger-sqlite.ts:234-235`,
   `logOf` in `src/runtime/project-log.ts:121-123`). Every read path a
   reader exposes (`read`, `readFrom`, `snapshot`, `versionedFrom`, and
   `openLedgerReading`'s read) goes through it.
2. Tests, in `test/runtime/state-read-files.test.ts`: for each reader,
   run two reads concurrently on one reader (`Effect.all` with
   unbounded concurrency) over enough rows that the reads overlap, and
   expect both to return every row. Before you trust each test, remove
   the semaphore and confirm the test fails, if the sandbox lets you
   run it; restore the semaphore, and say in the handoff what you saw.
   If the sandbox refuses the test command, say so; the coordinator
   then runs the mutation.
3. Update the module comment of `state-read.ts` and its paragraph in
   `src/runtime/README.md` with one sentence each about the
   serialization.
4. Change nothing else. In particular, no change to the version
   decision, the writers, status or their tests.

### Steps

1. Read `AGENTS.md` first and follow it (layering, Effect v4, TSDoc,
   readable functional code). The skills it names are not available in
   this session. Do not edit `AGENTS.md` or `CLAUDE.md`.
2. Read `git diff` for `src/runtime/state-read.ts` and
   `test/runtime/state-read-files.test.ts` to see round 1's shape.
3. Make the change and the tests, then run `bun run docs` and
   `bun run check` and fix what they report. You may try
   `bun --bun vitest run test/runtime/state-read-files.test.ts`.

### Rules

- Do not delete, skip, rename or loosen any existing test or assertion.
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
- each new test fails with the semaphore removed.

End with a handoff that lists every file you changed, where the
semaphore is made and taken for each reader (file and line), what the
mutation run showed, and anything you were unsure about.
