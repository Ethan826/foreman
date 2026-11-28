# Checkpoint (2026-11-28)

Start here in a new session, after AGENTS.md. The execution record with
every ruling is `docs/plans/2026-11-19-assisted-cycle-plan.md` (read its
tail); the v0.2.0 design and plan are
`2026-11-25-session-recovery-and-rulings-design.md` and `-plan.md`.

## Where things stand

- `main` = `assisted` = ff8b86a (pushed, Linux CI green). v0.2.0 slices 1
  and 2 are landed: per-store format versions (ledger 1, log 2) and the
  log raise (`raisesLogFormat`), `FindingsRecorded`, `ruling add`,
  `overrule` and close after overrules, re-review, `rounds grant`,
  `session close --unconverged`; also dogfood-6e/6f's load-independent
  tests and the store-wait contract. No release since v0.1.1.
- Targets (Waxwing, durable-effect) run v0.1.1 from
  `~/Desktop/tarlatan-release/v0.1.1`. Tell the durable-effect session
  when v0.2.0 is tagged (it switches between sessions); Waxwing needs
  the owner's OK.
- Supervisor worktree `~/Desktop/tarlatan-wt/dogfood` at ff8b86a,
  `NoSession`, `node_modules` present.

## Next

1. Dogfood-8 (slice 3, first half): the task is drafted,
   `docs/plans/2026-11-28-dogfood-8-task.md` (snapshots kept by ref,
   `SnapshotKept`, and the restore as a tested Program function). It has
   not had its fresh task review yet. Procedure: fresh Opus task review
   (read-only, no git, no tests), fold findings in, record the review
   beside the task, bring rulings to the owner, commit, fast-forward the
   supervisor worktree, `tl session open`, then the loop.
2. Dogfood-8b: the session line (`src/features/session-line.ts` with a
   reference-model property test), `back-up` and `retry` with their
   request and result events and the hold.
3. Release v0.2.0: CHANGELOG, `package.json`, Linux CI, tag (push only
   with the owner's leave), release worktree; move targets with care
   (a session opened under v0.1.x refuses retry, back-up and overrule).

## How the loop runs (owner's standing authorizations)

- After the owner approves a task and its rulings, the coordinator runs
  session open, waived implement, the owner's check
  (`~/.config/tarlatan/check.sh`, run by the coordinator), and waived
  review and correct rounds until a review has no findings, with every
  launch's output in files. Stop for product decisions, before
  `session close --finished`, and before landing or pushing.
- When corrections run out with only minor findings, reject, close
  abandoned keeping the worktree, and open a second session for them
  without asking (until v0.2.0 is the running release: `rounds grant`
  then removes the need).
- The coordinator may record its own rulings in a session with
  `tl ruling add` (first used in dogfood-6f), so reviewers see them.
- Git experiments only with `git -C <absolute scratch path>`; a review
  subagent once committed into this repository by accident.

## Follow-ups on file (in the plan and the roadmap)

- `ps -A` stalls at a load average around 238 (status and launches
  too): list only tarlatan's process groups.
- `status-read-only.test.ts`'s 1,500 ms speed claim.
- The targets' feedback table in the roadmap ("Feedback from the
  targets"): evidence attached to a session, logged owner changes,
  `tl task review`, a session-open lint, per-step cost in status.
- Idle durations for `worktree-walk`'s FIFO constant were not measured.
