# Dogfood-6f: the store-wait contract and four review findings (second session for dogfood-6e)

## Read this first: the worktree already holds dogfood-6e

This is the second session for [dogfood-6e](2026-11-26-dogfood-6e-task.md)
(load-sensitive tests). Its change is in the worktree, uncommitted, and
has been reviewed three times; on its final tree the owner's check
passed (1,826 of 1,826) and the coordinator's load gate passed five full
runs at load averages 41 to 121. The session ended because tarlatan
allows two corrections a session. The rulings of the dogfood-6e task
still hold. Change only what this task asks.

## Task

### F1: the ledger's busy wait, as a contract (owner ruling, 2026-11-28)

The test "waits within busy_timeout and succeeds"
(`test/runtime/ledger-sqlite.test.ts`, about lines 185-230, with
`holdAfterGoMillis`) tries to show by timing that a write meeting a held
lock waits for it. `bun:sqlite` offers no way to observe that a write met
the lock, so every timing version is either load-sensitive or can pass
without contention. The owner ruled: rely on SQLite's documented
`busy_timeout` behaviour, with the dependency inverted.

1. **The contract lives in Domain.** The TSDoc of `LedgerStore`
   (`src/domain/ledger.ts`, the interface and its `transact`, about lines
   197 and 239) states the contract any implementation must meet: a write
   that meets another writer's lock waits up to the store's configured
   busy timeout, then fails with `LedgerBusy` and writes nothing. Do the
   same for `ProjectLog` (`src/domain/events.ts`) for what it promises
   about a busy log (`ProjectLogError` "project log busy"). Name no
   database in Domain.
2. **The SQLite adapters say how they meet it.** The module comments and
   the open functions' TSDoc in `src/runtime/ledger-sqlite.ts` and
   `project-log.ts` state that they meet the contract by setting
   `PRAGMA busy_timeout` to the configured value on every connection,
   citing sqlite.org/pragma.html#pragma_busy_timeout and
   sqlite.org/c3ref/busy_timeout.html, and that this documented behaviour
   is the evidence (no test observes the wait). Another database would
   supply its own evidence against the Domain contract.
3. **Tests.**
   - Replace the timing test with a deterministic one: the connection
     the adapter opens has `busy_timeout` equal to the configured value,
     for the ledger and for the project log, with two different values so
     a hard-coded one fails. Read it through the adapter's own seam. If
     there is none, add the smallest Runtime export that reports a
     connection's configured busy timeout, with TSDoc; no test-only
     backdoor in Domain, and no change to the store interfaces' behaviour.
   - Keep the existing contention test: under a held lock, a write with a
     short timeout fails with `LedgerBusy` and writes nothing.
   - Remove `holdAfterGoMillis`, `clockToleranceMillis` and the
     hold-after-go argument from `test/runtime/hold-ledger-write.ts` and
     `child-args.ts` if nothing else uses them.
   - Removing the timing test is authorized by this ruling; say in the
     handoff which test replaced it.

### F2 to F5: the third review's other findings (verbatim), with rulings

- F2 (`test/program/inherited-pipe.test.ts:107`): "The deadline check
  and release-file check are separate. If the shell is descheduled
  immediately after sampling a time before the deadline, a release file
  created after the deadline can still produce a released marker when the
  shell resumes. Pause the shell between those checks to reproduce it.
  Check the deadline after observing the release file and before
  accepting it so a late release cannot satisfy ruling 4." Ruling: do it.
  The shell accepts a release only if, after it has seen the release
  file, a fresh clock read is still before the deadline; otherwise it
  records `expired`.
- F3 (`test/program/inherited-pipe.test.ts:266`): "The interrupted case
  replaces the immediate done-marker assertion after running.exit with a
  separate polling wait. An early running.exit can now pass if the
  descendant writes the marker during that wait. Ruling 3 requires
  preserving the original ordering assertion. Check the marker
  immediately after running.exit settles." Ruling: do it.
- F4 (`test/format/blob-id.test.ts:24`): "Each of the four text fixtures
  still starts git four times to create and commit a repository before
  calling hash-object. The text comparisons only need hash-object without
  -w, which can run from a temporary directory with no repository.
  Remove the unnecessary setup under ruling 3 while preserving the
  assertions. The binary bundle fixture still needs a repository."
  Ruling: do it.
- F5 (`test/runtime/child-process.ts:38`): "The handoff is incomplete
  under rulings 1 and 3. It omits blob-id.test.ts from the
  disposable-repository inventory. The listing, version-read, direct-git
  and FIFO budgets lack idle measurements, and childMillis still
  identifies the 487 ms project-lock case as its longest despite the
  ledger test's new one-second hold." Ruling: fix the inventory and the
  TSDoc. With F1 the one-second hold goes away; name the longest
  remaining case from the code. The coordinator measures idle durations
  on this snapshot and adds them where the TSDoc lacks one; say which
  constants need them.

## Steps and rules

- Read `AGENTS.md` first and follow it. Do not edit `AGENTS.md`,
  `CLAUDE.md`, `eslint.rules.js`, `package.json` or anything under
  `.claude/`.
- `src/` changes are limited to F1: TSDoc and module comments, and the
  one small Runtime export if the adapters have no seam.
- In new code use the Effect modules, never native array or string
  methods; no lint-disable comments, casts or non-null assertions; named
  numbers.
- Run `bun run docs` and `bun run check`. You may try
  `bun --bun vitest run <one test file>`; say so if the sandbox refuses
  it.
- Do not commit; run no `git` command other than `git status` and
  `git diff`.

## Done when

`bun run docs` and `bun run check` pass in your step; the owner's check
and the coordinator's load gate pass after it. End with a handoff naming
each change, the seam used for F1, and anything you were unsure about.
