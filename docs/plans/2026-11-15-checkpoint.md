# Checkpoint (updated 2026-11-20)

Where the foreman work stands, for the next session.

## Current state

Work is stopped at an approval gate on `main`. The implementation
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
- B11b landed 2026-11-18 by fast-forward, after a Codex review, one
  correction pass and a correction review that passed. Every production
  git command runs in the clean environment (design E7), through
  `worktreeProgram` and `cleanGit`. Hazard tests trigger each hazard for
  real, and coverage tests observe the production entry points. Measured
  worker use: 457,553 tokens in two passes, against an estimate of about
  400k. On the landed content: `bun run docs` (no warnings), `bun run
  check` (0 blocking, 29 notes) and `bun run test` (53 files, 604 tests)
  pass.
- B11c landed 2026-11-19 by fast-forward, after a scope review, a code
  review, one correction and a correction review that passed. Creation
  (before `worktree add`) and startup refuse any attribute source the
  clean environment would change or leave in force. That covers revision
  `.gitattributes` with any content, a non-empty common
  `info/attributes`, a configured `core.attributesFile` (including in
  `config.worktree`) and any `includeIf`. Read failures refuse. The
  rulings chose option A and option R. Measured worker use: 550,441
  tokens across three units, against estimates of about 100k each for the
  slice and the correction. On the landed content, `bun run docs` (no
  warnings), `bun run check` (0 blocking, 30 notes) and `bun run test`
  (58 files, 675 tests) pass.
- CI: the F7 lifecycle property timed out on GitHub's runner. It has a
  provisional 60-second limit (83870d8), and it passed on CI in 6,486 ms.
  The `git.test.ts` fixture no longer links to `/usr/bin/env`, which is a
  multi-call binary on ubuntu-26.04 (be991f8).
- On the local branch `assisted` (not landed or pushed): B11d (the
  pinned runner), W1 (Waxwing's exact attribute line) and the assisted
  cycle, MVP-D0 slices A1 and A2, with a runnable `bun
  src/facade/main.ts --config <path> <command>`. Built 2026-11-19 with
  parallel workers; the Codex batch review found B01 to B17, and four
  correction groups plus an integration pass corrected them on
  2026-11-20. On 8cd5bb5: `bun run docs` (no warnings), `bun run check`
  (0 blocking, 45 notes) and `bun run test` (120 files, 1,473 tests)
  pass. Measured worker use: 2,979,906 tokens to build, 1,434,890 to
  correct. The record is the execution section of
  `2026-11-19-assisted-cycle-plan.md`.
- Checkpoint 2026-11-20 (evening): `assisted` is at 65398e5 (this
  checkpoint's commit follows it). Three more review rounds (the
  correction re-review R01 to R06, the focused review, the focused
  re-review) were corrected; the red intermediate history was folded on
  the owner's ruling. On 65398e5: check (0 blocking, 52 notes), docs (no
  warnings), the full suite (133 files, 1,547 tests, output kept) and
  `research/live/l3-subset/test-scripts.sh` (61 of 61) pass. Each
  review record is in this directory (`2026-11-20-assisted-*.md`); the
  plan's execution record lists every integration, ruling, incident and
  measured worker use.
- Done 2026-11-20 (late): Codex reviewed 3b72efc..65398e5; the owner
  adopted its rulings (recorded at the end of the plan), including the
  first dogfood profile: P (user settings and hooks excluded),
  connectors off and project MCP servers neutralized, validated with P
  only. Two workers fixed A1, A4, B11c/R01 and the L3 runbook (L1 to
  L4); `assisted` is at 95fd4e1, where check (0 blocking, 63 notes),
  docs, the full suite (135 files, 1,562 tests) and `test-scripts.sh`
  (112 of 112) pass.
- 2026-11-21: Codex's L3 corrections review was adopted; the profile
  change (c0d0952) and the L3 gate fixes (b5c7e91) are integrated, and
  an offline rehearsal of the first cycle on foreman ran with stand-in
  clients (findings and the draft task are at the end of the plan).
- 2026-11-21: Codex reviewed 95fd4e1..fa70235 and holds L3 Path A for
  three evidence-gate findings (C1's diagnostic, incomplete evidence
  scoring PASS, an incomplete C1 retry leaving an older PASS usable);
  the owner adopted it, including the first cycle's operating procedure
  (recorded at the end of the plan). One worker corrects the gates.
- Ruled, no longer open: L03 (P: user settings and hooks excluded),
  connectors off and project MCP servers excluded (`--strict-mcp-config`
  plus `disableClaudeAiConnectors`), L3 by Path A only (P and X, eight
  runs) after the profile change, attribute read failures keep the
  waiver, a damaged gitfile stays `GitCommandFailed`, `status` works
  without HOME.
- 2026-11-22: after seven Codex rounds and one low-context Opus review
  (no P1 or P2), the L3 package is ready: `test-scripts.sh` 335 of 335,
  every gate in the runbook's table with its fact, source,
  counterexamples and blind spot.
- Open: the owner's authorization of the L3 Path A live run (P and X,
  eight runs); landing (a fast-forward of `main`) and push; then the
  first real cycle on foreman (decision P10) with
  [the dogfood-1 task](2026-11-21-dogfood-1-task.md).
- The rest of B11 (the protected digest, the commit procedure and the
  review worktree) and B12 to B18 remain unauthorized. L4 waits on B13 to
  B15. Each push needs the owner's OK.

Deferred findings keep their recorded triggers: R5 before extending the
listing decoder or claiming strict validation, and F8 with B15. R7 is
closed (c600b98). Deferred cleanups: split `eslint.rules.js` (418 lines)
and `test/program/admission.test.ts` (261 lines) under the 250-line
limit. Re-vendoring the prose linter from the skills
repository and the editorial pass on the docs remain open. From B11b:
the `gate-integrity` lift (a local draft is in
[the B11b review note](2026-11-18-b11b-scope-review.md); writing to the
skills repository needs authorization), and splitting
`test/program/admission.test.ts` (261 lines).

The 2026-11-16 owner rulings resolved the old checkpoint's accounting,
O14 and O15 questions for the initial implementation: owner-only retire
through the first runtime milestone, the tolerance-based period rule as
a pacing heuristic, and a one-point minimum estimate. They do not
establish Codex reset semantics. The Claude decoder's `unifiedWindows`
change and its review correction are recorded in the implementation
plan. These items are no longer waiting on the decisions listed below.

Historical failures, measurement limits and deferred findings remain in
the implementation plan's record.

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
