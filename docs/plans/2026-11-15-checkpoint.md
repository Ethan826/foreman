# Checkpoint (updated 2026-11-18)

Where the foreman work stands, for the next session.

## Current state

Work is stopped at an approval gate on local `main`. The implementation
plan's task records and owner rulings govern the scope; writing down a
slice does not authorize it.

- Part A landed 2026-11-16: Domain types, period membership, pacing and
  estimates per role and window. L1 and L2 ran that day and both came
  back positive; see [the live-test results](../../research/live/results-2026-11-16.md).
- Part B milestone 1 (B1 to B10) landed 2026-11-17 by fast-forward:
  ledger, admission and settle, event log, holds, waivers, review queue,
  scheduler and backlog, including the review corrections.
- B11a landed 2026-11-18 by fast-forward: supervisor worktree creation
  and identity. The last R2 correction, 0c6298c, keeps stat kinds and
  identity command results until Features decides. Fresh verification
  during this status update: `bun run check` passed (0 blocking prose
  findings, 29 advisory notes); `bun run test` passed (47 files, 515 tests).
- B11b is scoped in 1f35d61 and is not authorized. It would supply the clean
  git command environment and address R8, including the tests' git
  helper and the English-stderr assertion. The estimate is about 150k
  tokens for one worker, or about 400k with a review and correction
  round. These are estimates, not caps. Nothing is running.
- The rest of B11 and B12 to B18 remain unauthorized. L3 waits on B16;
  L4 waits on B13 to B15. No push is authorized.

Deferred findings keep their recorded triggers: R5 before extending the
listing decoder or claiming strict validation; R7 at the next lint-gate
change; F8 with B15. Re-vendoring the prose linter from the skills
repository and the editorial pass on the docs remain open.

The 2026-11-16 owner rulings resolved the old checkpoint's accounting,
O14 and O15 questions for the initial implementation: owner-only retire
through the first runtime milestone, the tolerance-based period rule as
a pacing heuristic, and a one-point minimum estimate. They do not
establish Codex reset semantics. The Claude decoder's `unifiedWindows`
change and its review correction are recorded in the implementation
plan. These items are no longer waiting on the decisions listed below.

Status wording reviewed 2026-11-18: replaced the obsolete approval limit
and pending-live-test list with dated outcomes and the B11b approval
boundary. Historical failures, measurement limits and deferred findings
remain in the record.

## Earlier checkpoint: done

- Design revision 4 (usage ledger, review queue and scheduler,
  pre-approved backlog, role-swap suggestions, durable layer kept
  hand-built), approved by the owner with the rulings recorded at the end
  of the design. Model checks check3 and check4 pass; reruns are in
  research/model.
- Code: Domain types, Format decoders, provisional `pace`, ESLint house
  rules (native-method and null-check bans, closed vocabularies, layer
  edges), a vendored prose linter, CI (check and test), the onion diagram
  with its drift test, orientation docs, and a stability tripwire for
  effect/workflow.

## Earlier checkpoint: next (superseded by current state above)

1. Done: final independent reviews of the design through revision 6.1;
   the owner approved revision 6.1 on 2026-11-15 (see the ruling at the
   end of the design).
2. Done: the durable-execution question was answered in the design
   ("Durable-execution engines"); the hand-built log stays.
3. Done: orientation docs (README.md, docs/how-it-works.md) updated to
   revision 6.1 with the implementation plan. The onion diagram's layers
   did not change.
4. Still open: re-vendor the prose linter from the skills repository and
   run an editorial pass on the docs.
5. Superseded by
   [the implementation plan](2026-11-15-implementation-plan.md): its
   "Sequence" section gives the order (L1 and L2 packages for approval
   first, then Part A, the accounting decision, Part B, L3 and L4).
6. Done 2026-11-16: live tests L1 and L2 ran under the owner's approval
   and both came back positive (research/live/results-2026-11-16.md).
7. Done 2026-11-16: Part A (Tasks A1 to A4) ran inline under a
   300k-token cap: Domain types, period membership, `pace` to revision
   6.1 with the C13 oracle, C16 timer properties and C22 fixtures, and
   the estimate per role and window. Commit 5c0e2da went in with the
   prose gate failing (a command chain that did not stop on failure);
   c0cee4f fixed it, and both stay in history. Part A's token use is
   unknown: roughly estimated at 200k, not verified to be within the
   300k cap.
9. Intermittent failure, investigated 2026-11-17: `test/lint/prose.test.ts`
   ("passes on the repository's own Markdown") failed once in three full
   runs on 2026-11-16; the message was not captured. Investigation:
   - Timing. 5 plain full runs, 3 runs beside a concurrent `bun run
     check`, and 20 runs under a continuous `bun run check` loop: 0
     failures in 28. The test took 1.5 to 2.0 seconds under load against
     vitest's 5-second default. The timeout hypothesis is not supported.
   - No test writes files, so one test racing another is ruled out.
   - `tools/prose/check.sh` scans tracked and untracked, not-ignored
     Markdown. A probe with a temporary untracked `.md` containing a tell
     fails this test while the file exists and passes once it is gone. A
     transient untracked Markdown file at the time would explain one
     failure followed by clean reruns; that such a file existed is not
     shown.
   - The test now reports status, signal, spawn error, stderr and every
     BLOCK line on failure, and asserts no spawn error or signal, so a
     recurrence names its cause. No timeout or tolerance was changed.
   Owner ruling 2026-11-17: the failure stays unexplained, with improved
   diagnostics; it is not root-cause resolved, and the untracked-Markdown
   probe shows a possible mechanism, not what happened. The gate keeps its
   scan scope. A recurrence is captured and investigated, never erased by
   a passing rerun. Part B's first milestone (B1 to B10) proceeds.
8. Waiting on the owner: the accounting choice (deferred until L1 and L2
   reported; the arithmetic is to be rechecked before it is presented),
   O14 (Codex reset times roll forward while idle), approval of Part B,
   and whether the Claude decoder in `src/format/claude.ts` should take
   the `unifiedWindows` shape L1 found (Format decoders are in the
   authorized slice; it was not in Part A's task list).

## Rules to remember

Commits and pushes use the noreply address only; never use GitHub's merge
button. Personal material the owner shares as a writing model never
enters a repository.
