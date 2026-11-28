# Dogfood-6e: make the load-sensitive tests independent of machine load

## Task

The owner's check failed four existing tests while other sessions kept
the machine's load average between about 75 and 200; each passed on
reruns of the changed tree and of `main` (record in
`docs/plans/2026-11-19-assisted-cycle-plan.md`, the 2026-11-26 findings;
earlier timeouts of the same kind are recorded there for
`handoff-crash.test.ts` and `test/runtime/spawn.test.ts`). A test that
passes on a rerun is still a failure, and AGENTS.md says to fix every
instance of a pattern. This task removes the cause from every test
exposed to it.

| Test that failed | Observed under load |
|---|---|
| `test/facade/status-read-only.test.ts` "leaves an existing state's files as they were" | `Test timed out in 5000ms` (vitest's default) |
| `test/program/handoff-refusals.test.ts` "a write after a clean review makes close --finished refuse" | timed out at 5,000 ms |
| `test/program/handoff-refusals.test.ts` "a third correction is refused" | timed out at 5,000 ms |
| `test/program/inherited-pipe.test.ts` "keeps the command waiting after the leader exits, until the descendant ends" | the command had already finished when the test looked: `AttemptRecorded` with outcome `Unclassified` |

The interrupts the log shows inside `checkAttributeSources` and
`stageSnapshot` only mark where vitest's 5 seconds ran out; these
commands run many git processes in sequence (`thirdCorrection` makes six
launches, each with attribute and snapshot git work,
`handoff-refusals.test.ts:157-166`). Do not look for the cause in `src/`
for speed.

### Owner rulings for this task (confirmed by the owner 2026-11-27; do not reopen)

1. **Scope.** Every test that runs real git, `ps` or a child process and
   has no explicit timeout. List them first, in the handoff, with how
   you found them: at least the files using `withHarness({ repository:
   true })`, `test/runtime/git-repo`, `test/runtime/child-process`,
   `startClientWith`, `readProcesses` or the facade's `main`, including
   the rest of `handoff-refusals.test.ts`, `handoff-crash.test.ts`, the
   other `main` and status tests in `status-read-only.test.ts`, the
   second test of `inherited-pipe.test.ts` and
   `test/runtime/spawn.test.ts`. A test you leave out needs a reason.
2. **Causes.** For each kind of work, give its cause. If you cannot run
   the test, give the cause derived from the code as a prediction, with
   a probe the coordinator can run under load to confirm it (which
   assertion fails, what a marker file holds); the coordinator confirms
   it before landing.
3. **Timeouts, constrained.** These tests make no claim about speed, and
   vitest's 5,000 ms default asserts nothing about them; there is
   precedent in `endToEndMillis = 60_000` (`test/program/production-harness.ts:22-27`)
   and `cycleMillis` (`test/program/assisted-cycle.test.ts:188`). An
   explicit timeout is allowed only as follows:
   - one named constant per kind of work, defined in the harness or
     helper that does that work (for example next to `withHarness` for
     the repository harness), not one per test;
   - its TSDoc counts what it bounds: the number of git or `ps` starts
     in the longest test that uses it, and that test's duration when the
     machine is idle;
   - no constant above `endToEndMillis` (60,000 ms); a larger value goes
     to the owner;
   - every test of that kind uses it, not only the ones that failed;
   - avoidable slowness, meaning git or process work in a test or
     harness beyond what its fact needs, is removed instead; never change
     `src/` for speed.
   No assertion is removed or weakened and no expected value or test
   name changes; adding steps and assertions is allowed. `handoff-refusals`
   uses `it.effect` (TestClock); a per-test timeout argument applies
   there too, so do not switch it to `it.live`.
4. **Inherited pipe, made deterministic.** The failure is the test
   looking too late, most likely: `startClientWith` runs a full `ps -A`
   before it returns (`src/runtime/spawn.ts:120`), the test records the
   start only after that (`inherited-pipe.test.ts:61`), and `eventually`
   polls every 25 ms (`:91`), while the 2-second descendant clock runs
   from the spawn; `leaderGone` runs `ps` on every poll (`:77-83, :94`)
   and the watch adds 400 ms (`:95`). It can fail at `:92`, `:109` or
   `:110`. Fix it so the order holds by construction:
   - the descendant writes a started marker, then waits, sleeping
     between checks and never spinning, for a release file the test
     creates after its watch; it ends on its own after at most
     `waitBoundSeconds` even if never released, and starts nothing that
     outlives it (orphaned `/bin/sh` loops from earlier spawn tests ran
     for days; see the plan record). That bound equals the bound the test
     already puts on every wait, so it is not a new margin;
   - the test establishes the descendant is alive and holding stdout
     before it watches;
   - both tests in the file use it.
   Raising `descendantSeconds` alone is refused. If the probe shows the
   command completed while the descendant was alive (its marker shows it
   started and was not released, and its pid is still listed), the cause
   is in `src/` or Bun (`close` before the pipe closed,
   `src/runtime/spawn.ts:181`): stop and report it with the evidence; that
   is a product finding, not part of this task.
5. **Excluded, owner's choice:** `status-read-only.test.ts` "answers
   while another process holds the ledger's write lock" asserts an
   answer within `answerWithinMillis = 1_500` (`:32, :130`), a real speed
   claim. Leave it as it is; it is filed as a follow-up for the owner.
6. Change nothing in `src/` (ruling 4's report aside), and no global
   vitest configuration (no `testTimeout` in a config file or in the
   `test` script).

### How landing is verified (the coordinator's gate)

- Fact: each test in ruling 1's list passes under high load, and the
  inherited-pipe order holds by construction.
- Source: the owner's check output and the coordinator's load runs.
- Load: several times as many `yes > /dev/null` processes as cores,
  plus two full `bun run test` runs at once; the coordinator records the
  load average reached.
- Runs: the affected files at least five times under that load, then the
  full check.
- Counterexample for inherited-pipe, needing no load: in a scratch copy,
  insert a `descendantSeconds + 1` second sleep after the descendant
  starts; the old test fails and the new one passes.
- Blind spot: a few passes under load do not prove a race absent; the
  construction argument for inherited-pipe and the counted constants
  carry the rest.
- The handoff reports idle durations per kind of work; the coordinator
  checks that loaded durations stay below each constant with headroom.

### Steps

1. Read `AGENTS.md` first and follow it. Do not edit `AGENTS.md`,
   `CLAUDE.md`, `eslint.rules.js`, `package.json` or anything under
   `.claude/`.
2. Read the tests in ruling 1's list and what they import.
3. You may run `bun --bun vitest run <test file>` to observe; if the
   sandbox refuses it, follow ruling 2.
4. Run `bun run docs` and `bun run check`.

### Rules

- In new code use the Effect modules, never native array or string
  methods; no lint-disable comments, casts or non-null assertions;
  named numbers (the house lint).
- Do not commit; run no `git` command other than `git status` and
  `git diff`.

### Done when

Your step: `bun run docs` and `bun run check` pass, and the handoff gives
the list (ruling 1), the cause per kind of work with its evidence or
probe (ruling 2), each constant with its count, the inherited-pipe
change, and idle durations. Landing: the coordinator's gate above
passes.
