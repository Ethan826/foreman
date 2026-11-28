# Session recovery and owner rulings: implementation plan (v0.2.0)

> **For agentic workers:** each slice below runs as one tarlatan dogfood
> cycle. The coordinator drafts the slice's task file from this plan
> (`docs/plans/<date>-dogfood-<n>-task.md`), a fresh reviewer reads it
> against the code, the owner confirms its rulings, and `tl` runs
> implement, the owner's check, and review and correct to a review with
> no findings (standing authorization of 2026-11-25). Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** owner rulings that reach every brief, overrule and extra
correction rounds, and retry and back-up of a step, all as logged owner
commands, shipped as v0.2.0.

**Architecture:** new owner and session events in the project log
(Domain), folded into the session state and decided by the command
rules (Features), with git snapshot refs and the restore in Runtime and
Program, and new CLI commands in the facade. Each store gets its own
known format version; the log moves from 1 to 2 with its first new
event.

**Tech Stack:** TypeScript, Effect v4, Bun, `bun:sqlite`, git plumbing
through `pinnedGitWith` and `snapshotGitWith` (`src/runtime/git.ts`).

**Spec:** [`2026-11-25-session-recovery-and-rulings-design.md`](2026-11-25-session-recovery-and-rulings-design.md)
(approved 2026-11-25). Every slice's task file cites it; implementers
read both.

## Global Constraints

- Decision-core layering, Effect v4, TSDoc on every export, readable
  functional code, no casts, no lint-disable comments (AGENTS.md).
- Closed vocabularies: the new close kind `unconverged` goes into
  `CloseKinds` (`src/domain/session.ts:46`), `closedNames` in
  `eslint.rules.js` and `lint-fixtures/src/features/bare-names.ts`.
  Every other new tag is a `Schema.TaggedClass` name, not a string
  vocabulary. The coordinator makes the `eslint.rules.js` change.
- `maxCorrections` stays 2 (`src/features/command-rules.ts:58`).
- Store versions: ledger known version 1, log known version 2. An
  unstamped log is stamped 1; a new log is created at 1; only the
  first event v0.1.1 would not decode to the same meaning raises it to
  2, in that event's transaction.
- Existing event shapes do not change. New facts are new events.
- Owner commands append nothing unless the command rules allow them,
  in the same transaction as the read that decided it.
- Every new command that deletes worktree files (`retry`, `back-up`)
  requires `--attest`.
- Check commands for every slice: `bun run docs`, `bun run check`; the
  owner's check runs the full suite outside the sandbox.

## Provenance

| Component | Source | Fidelity | Approval and evidence |
|---|---|---|---|
| Owner decisions as appended events, state by fold | The design's event log and fold (revision 6.1) | Faithful | Design 6.1 approval |
| Conditional append deciding and recording in one transaction | `ProjectLog.append(expected, ...)` | Faithful | Existing |
| Snapshot kept as a commit on a private ref | `git stash`, `git commit-tree`, `git update-ref` | Adapted: one ref per snapshot end under `refs/tarlatan/` | Owner approval of the design, 2026-11-25 |
| Restore of a tree onto the worktree | `git read-tree --reset -u`, `git clean -fd`, the design's drift `restore` | Adapted: tree target, index reset to HEAD, two pre-checks | Owner approval; oracle in `research/v0.2.0-restore-oracle/` (1,200 trials clean with the pre-checks, seven targeted cases); two adversarial reviews |
| Intent before effect, redo after a crash | The design's lock-holder requests | Faithful | Existing |
| Correction limit as default plus grants, counted on the line | None | Invented, small | Owner rulings 2026-11-25 (extra rounds; refund by default); second adversarial review (findings 1 to 3) |
| Rulings superseded, never edited | Architecture decision records (Nygard) | Adapted | Owner approval of the design |
| Overrule recorded with a reason | pr-cockpit per-finding ticking (prior-art lessons) | Adapted | Owner approval of the design |

## Review Focus

Inputs the design implies that are most likely to bite, each pinned to
a task's test:

1. A reviewer's findings block that repeats an id, or a review that
   crashed: no overrule and no close on it (Task 1.2, 1.4).
2. A v0.1.1 project log opened by v0.2.0 at 0 or 1, and a v0.2.0 log
   opened by v0.1.1 (Task 1.1).
3. A back-up to a superseded attempt, and two back-ups with mixed
   `--keep-count` (Task 3.4).
4. A restore over an ignored file in the way, a changed `.gitignore`
   or `info/exclude`, an unremovable file, and an attributes or
   `core.autocrlf` setting that makes the fresh snapshot refuse (Task
   3.3).
5. A crash between a request event and its result, and a rerun with a
   different target while held (Task 3.5).

Distinguishing examples from the adversarial review, by task: oracle
classes "ignored file in a directory the target has as a file" and
"ignore rules differ" (3.3); case 4, case-only rename, is a documented
restriction with no test; second-review findings 1 to 8 (3.4, 3.5);
F1, the version decision (1.1).

## File structure

| File | Responsibility | Slice |
|---|---|---|
| `src/domain/store-version.ts` | per-store known versions; `StoreOlderReadable`; raise decision | 1 |
| `src/runtime/sqlite.ts`, `project-log.ts` | stamp 1, raise to 2 inside the appending transaction | 1 |
| `src/domain/session-events.ts` | `FindingsRecorded`, `RulingAdded`, `FindingOverruled`; later `RoundsGranted`, `SnapshotKept`, request and result events | 1 to 3 |
| `src/domain/session-state.ts` | `OpenSession` gains rulings, overrules, grants, the line | 1 to 3 |
| `src/features/session.ts` | the fold | 1 to 3 |
| `src/features/command-rules.ts`, `session-phases.ts`, `command-refusals.ts` | which command each state allows, and why not | 1 to 3 |
| `src/features/session-line.ts` (new) | the line: parents, position, targets, corrections counted, reviewed tree | 3 |
| `src/format/brief.ts` | the "Owner rulings" section | 1 |
| `src/format/findings.ts` | duplicate ids refused | 1 |
| `src/program/review.ts`, `correct.ts`, `implement.ts`, `session.ts` | append the new events with each step; take and keep snapshots | 1, 3 |
| `src/program/restore.ts` (new) | pre-checks, the restore, the fresh-snapshot verdict | 3 |
| `src/runtime/git.ts` (or a new `snapshot-refs.ts`) | `commit-tree`, `update-ref`, ref listing | 3 |
| `src/facade/cli-arguments.ts`, `cli-commands.ts`, `cli.ts` | the new commands and flags | 1 to 3 |
| `src/program/production-status.ts`, `status.ts` | rulings, overrules, limit, held restores, refs | 1 to 3 |

## Slice 1 (dogfood-6): versions, findings in the log, rulings, overrule

### Task 1.1: per-store versions and the log raise

**Files:** modify `src/domain/store-version.ts`, `src/runtime/sqlite.ts`,
`src/runtime/project-log.ts`, `src/runtime/ledger-sqlite.ts`; tests in
`test/domain/store-version.test.ts`, `test/runtime/project-log.test.ts`,
`test/runtime/ledger-sqlite.test.ts`.

**Interfaces:**
- Produces: `knownLedgerVersion = 1`, `knownLogVersion = 2`;
  `decideStoreVersion(version: number, known: number): StoreVersionDecision`
  with the new `StoreOlderReadable { found }`;
  `ProjectLog.append` gains no parameter: the store raises to 2 when an
  appended event is one of `raisingEvents` (a Domain predicate on
  `ProjectEvent`, true for every event this plan adds).

- [ ] Step 1: failing tests. Decision: 0 unstamped, 1 older readable
  for the log and current for the ledger, 2 current for the log and
  newer for the ledger, -1 invalid. Log: a v0.1.0 log at 0 is stamped
  1, not 2; a new log is created at 1; appending only existing events
  leaves 1; appending a raising event sets 2 in the same transaction
  (rolled back with it on a `PositionMoved`). v0.1.1 compatibility:
  a log at 2 fails `decideStoreVersion(2, 1)` as newer.
- [ ] Step 2: run, watch them fail for the right reason.
- [ ] Step 3: implement; the writer's open accepts current and older
  readable; the raise is `PRAGMA user_version = 2` inside the append's
  `BEGIN IMMEDIATE`, only when the read version is 1.
- [ ] Step 4: `bun run docs`, `bun run check`; owner's check.
- [ ] Step 5: TSDoc: the docstring change the design names ("raised
  only by its first changed event").

### Task 1.2: findings in the log

**Files:** modify `src/domain/session-events.ts`, `src/domain/events.ts`
(union), `src/format/findings.ts`, `src/program/review.ts`; tests in
`test/format/findings.test.ts`, `test/program/` (review step).

**Interfaces:** Produces `FindingsRecorded { sessionId, reviewOpId,
findings: Findings }`, appended in the batch with a usable review's
`Finished`.

- [ ] Tests: a block that repeats an id decodes to a refusal and the
  review's outcome is `Unclassified`, with no `FindingsRecorded`; a
  `ChangesRequested` review appends its findings; a `Success` review
  appends an empty list; a crashed review appends none.
- [ ] Implement, document, run the checks.

### Task 1.3: rulings and the brief

**Files:** `src/domain/session-events.ts` (`RulingAdded`),
`src/domain/session-state.ts` (`OpenSession.rulings`),
`src/features/session.ts`, `src/features/command-rules.ts`,
`src/format/brief.ts`, `src/program/` (a `ruling` command module),
the facade; tests in `test/features/session.test.ts`,
`test/format/brief.test.ts`, `test/facade/cli.test.ts`.

**Interfaces:** `ruling add --text <t> [--supersedes <id>]` appends
`RulingAdded { sessionId, rulingId, text, supersedes: Option<RulingId> }`;
ids `R1`, `R2`, ... in session order. `implementBrief`, `reviewBrief`
and `correctBrief` take `rulings: ReadonlyArray<Ruling>`.

- [ ] Tests: allowed in every open state without an incomplete
  attempt, refused otherwise and with no session; `--supersedes` of an
  unknown id refused; each brief kind contains every ruling with its id,
  and a superseded one marked; the review brief contains the sentence
  that a finding contradicting a ruling must cite it; adding a ruling
  changes the next brief's recorded hash.
- [ ] Implement, document, run the checks.

### Task 1.4: overrule and the close after overrules

**Files:** `src/domain/session-events.ts` (`FindingOverruled`),
`session-state.ts` (overrules), `src/features/session.ts`,
`command-rules.ts`, `session-phases.ts`, `command-refusals.ts`, a
program module, the facade, `src/program/status.ts`; tests in
`test/features/command-close.test.ts`, `command-rules.test.ts`.

**Interfaces:** `overrule <findingId> --note <reason>` appends
`FindingOverruled { sessionId, reviewOpId, findingId, rulingId, note }`
and the `RulingAdded` it implies, in one batch.

- [ ] Tests: allowed only while a `ChangesRequested` review awaits
  handoff and its recorded findings include the id; refused for a
  crashed review and for a session opened before v0.2.0 (no
  `FindingsRecorded`); `close --finished` allowed after every finding
  of the awaited review is overruled and refused when one of two is;
  `review` allowed again after one overrule on the reviewed tree and
  refused when the tree changed; `status` lists rulings and overrules.
- [ ] Implement, document, run the checks.
- [ ] Coordinator: CHANGELOG entry draft under "Unreleased".

## Slice 2 (dogfood-7): rounds and the unconverged close

### Task 2.1: `rounds grant` and the limit

**Files:** `session-events.ts` (`RoundsGranted`), `session-state.ts`
(grants), `src/features/session.ts`, `command-rules.ts`,
`command-refusals.ts`, a program module, the facade, status.

**Interfaces:** `rounds grant <n> --note <reason>` appends
`RoundsGranted { sessionId, count, note }`; the rules compare
corrections counted with `maxCorrections + Σ count`.
`CorrectionsExhausted` names `rounds grant` in its message.

- [ ] Tests: two grants of 1 allow two more corrections and not a
  third; a grant in one session does not carry into the next;
  `count` must be at least 1; status shows the limit and corrections
  used.
- [ ] Implement, document, run the checks.

### Task 2.2: `session close --unconverged`

**Files:** `src/domain/session.ts` (`CloseKinds.Unconverged =
"unconverged"`), `command-rules.ts`, the facade; the coordinator edits
`eslint.rules.js` and `bare-names.ts`.

- [ ] Tests: allowed only when a `ChangesRequested` review awaits
  handoff, not every finding is overruled, and corrections counted
  equal the limit; refused one below the limit and after a grant;
  the closed session records `unconverged`.
- [ ] Implement, document, run the checks.

## Slice 3: snapshots, the line, restore, retry, back-up

Run as two cycles (coordinator, 2026-11-28): dogfood-8 takes tasks 3.1
and 3.3 (refs and the restore, the git half, no new command);
dogfood-8b takes 3.2, 3.4 and 3.5 (the line, back-up, retry: the fold
half, which needs the retry and back-up events to mean anything).

### Task 3.1: snapshots kept by ref

**Files:** new `src/runtime/snapshot-refs.ts`; `session-events.ts`
(`SnapshotKept { sessionId, opId: Option<OpId>, end: start|end|open
as tagged classes, tree, ref, excludeDigest }`); `src/program/session.ts`
(open), `implement.ts`, `correct.ts`, `review.ts`.

**Interfaces:** `keepSnapshot(sessionId, label, tree, base) ->
Effect<RefName, GitError>`: `commit-tree` then `update-ref` with the
old value required absent, before the batch that appends `SnapshotKept`;
`listSessionRefs(sessionId)`; refs removed on `close --finished`.

- [ ] Tests: every attempt has a start and an end ref, the session an
  open ref; a second review and a retried step write new refs; an
  existing ref makes `update-ref` fail and the command fail; refs are
  gone after a finished close and kept after the others; an orphan
  ref (ref without event) is listed by status.
- [ ] Implement, document, run the checks.

### Task 3.2: the line

**Files:** new `src/features/session-line.ts`; `session-state.ts`;
`src/features/session.ts`; tests in `test/features/session-line.test.ts`
with a reference model.

**Interfaces:** `lineOf(log) -> { position, current: ReadonlyArray<OpId>,
superseded, withdrawn }`; `correctionsCounted(log): number`;
`reviewedTreeAt(log, position): Option<Revision>`;
`backUpTargets(log): ReadonlyArray<OpId | "open">` (as tagged values).

- [ ] Property test: generated sequences of implement, review, correct,
  step-ended, retry, back-up (with and without keep-count), reject and
  grant, checked against a separately written reference model of the
  design's "The session's line"; distinguishing cases from the second
  review (findings 1, 2, 3, 7, 8) as named examples.
- [ ] Implement, document, run the checks.

### Task 3.3: the restore

**Files:** new `src/program/restore.ts`, Runtime git calls; tests in
`test/program/restore.test.ts` against real temporary repositories.

**Interfaces:** `restoreTree(worktree, tree) -> Effect<RestoreVerdict>`
with `Restored`, `RestoreIncomplete { paths, messages }`,
`RestoreUnverified { reason }`, `RestoreRefused { paths, why }` (the
pre-checks, nothing touched).

- [ ] Tests: the oracle's classes as fixtures (ignored file in a
  directory the target has as a file: refused; `.gitignore` differs:
  refused; `info/exclude` digest differs: refused; self-ignored
  `.gitignore`: refused); the targeted cases (mode-only, symlink and
  directory swaps, a symlinked directory pointing outside: its files
  kept); an unremovable file: incomplete with its path; `core.autocrlf`
  making the fresh snapshot refuse: unverified; HEAD and the base never
  move; ignored files kept in every exact case. Port the oracle as a
  bounded generated test.
- [ ] Implement, document, run the checks.

### Task 3.4: back-up

**Files:** `session-events.ts` (`BackUpRequested { target, tree,
keepCount }`, `BackedUp`, `BackUpIncomplete`, `RestoreUnverified`),
the fold, the rules, refusals, a program module, the facade, status.

- [ ] Tests: the second review's findings 1 to 3, 5, 7, 8 as cases;
  back-up from `Rejected` clears it; back-up refused in `Interrupted`;
  the hold refuses every launch and handoff; a rerun with another
  target or `keepCount` refused; a rerun repeats the pre-checks;
  `close --abandoned` allowed while held; a crash after
  `BackUpRequested` redone by the rerun, with exactly one result
  event.
- [ ] Implement, document, run the checks.

### Task 3.5: retry

**Files:** `session-events.ts` (`RetryRequested`, `StepRetried`,
`RetryIncomplete`), the fold, the rules, a program module, the facade.

- [ ] Tests: retry in `Interrupted` restores the start tree and returns
  to the state before the attempt; a retried correction counts once;
  the waiver is not re-armed; a held retry allows `close --interrupted`
  and refuses `--abandoned`; a crash after `RetryRequested` redone;
  `retry` refused outside `Interrupted` and without `--attest`.
- [ ] Implement, document, run the checks.

### Release

- [ ] Coordinator: CHANGELOG 0.2.0 (formats: log version 2, new events,
  refs under `refs/tarlatan/`; CLI: the new commands and close kind),
  `package.json` 0.2.0, Linux CI, tag, release worktree; move Waxwing
  and durable-effect only after the owner's OK, with each target's open
  session closed first (a session opened under v0.1.x refuses retry,
  back-up and overrule).

## Self-review notes

- Spec coverage: G1 (1.3), G2 (1.4), G3 (2.1, 2.2), G4 (3.5), G5 (3.4),
  G6 (every task's refusal tests and status rows); constraints on
  formats (1.1), quiescence and attestation (3.4, 3.5); the line (3.2);
  restore and its pre-checks (3.3); refs (3.1).
- Ordering: 1.1 lands before any raising event exists, so no build
  appends a new event to a log stamped 1 without raising it.
- Proportion: signatures, events and tests only; bodies are left to
  the implementer, who has the design.
