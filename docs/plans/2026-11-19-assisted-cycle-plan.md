# Assisted cycle (MVP-D0): bounded plan for A1 and A2

Status: DRAFT FOR REVIEW, 2026-11-19. Nothing here is authorized: no
worker, live call, landing or push. It implements MVP-D0 from the Codex
design delta (untracked, `/private/tmp/foreman-mvp-w2UQQi/docs/plans/
2026-11-19-mvp-design-delta.md`, register row M18), with the owner's
choice of subcommands over a persistent interactive program and the
requirements of the owner's 2026-11-19 review of the first outline.

## Goal and boundary

One terminal, no copying between tabs. The owner opens a session for a
bounded task in the supervisor worktree, then drives it with subcommands:
implement, review, correct, review again, and close. Foreman launches
each fresh client, shows its output, keeps every report and brief, and
builds the next client's input. Every handoff waits for an explicit owner
command. A client's verdict never launches anything.

Inside A1 and A2: fixed permission profiles, version pins, fresh context,
the existing admission check, grants and waivers, durable intent before
launch, captured reports, distinct holds, and fail-stop on anything
incomplete.

Outside A1 and A2: automatic verification, commits, resets, recovery,
replay, process signaling of any kind, a persistent interactive
interface, automatic transitions, background scheduling, rate fitting,
review worktrees, concurrency and self-promotion. The owner keeps
verification, commits and the cleanup of uncertain processes.

## Commands

All commands run in one terminal from a pinned foreman checkout
(decision P3). Each takes the project lock for its whole run, folds the
project log, checks the stop conditions below, and then acts. The facade
only parses arguments. Program sequences, and Features decides.

| Command | Allowed when | Appends | Launches |
|---|---|---|---|
| `foreman session open <task-file> --tranche <id>` | no open session; worktree check passes | `SessionOpened`, `Approved` (tranche approval) | nothing |
| `foreman implement [--waive]` | session open; no attempt yet | grant, `Intended`, `Launched`, `Finished`, `ReportRecorded`, `SnapshotTaken` | Claude, editing profile |
| `foreman review [--waive]` | last attempt was implement or correct, finished, snapshot unchanged | `HandoffApproved`, then as above minus `SnapshotTaken`, plus `ReviewChecked` | Codex, read-only profile |
| `foreman correct --findings <file> [--waive]` | last attempt was a review, finished, snapshot unchanged since that review | `HandoffApproved` (with the findings file's hash), then as for implement | Claude, editing profile |
| `foreman reject [--note <text>]` | a finished attempt awaits a handoff | `HandoffRejected` | nothing |
| `foreman status` | always (read-only, no lock needed) | nothing | nothing |
| `foreman step-ended <opId> --grant <grantId>` | that attempt has `Intended` without `Finished` and that grant is its open grant | `StepEndedByOwner` | nothing |
| `foreman session close --finished\|--abandoned\|--interrupted [--note]` | session open; `--interrupted` only after `step-ended` | `SessionClosed` | nothing |

`--waive` is owner input, recorded as a `Waived` event; it does not
select an implementation.

## Events and transitions

New events go in a new module, `src/domain/session-events.ts`, and join
`ProjectEvent`. Existing events are reused unchanged, except that
`Launched` gains an optional `leaderStartedAt`.

| Event | Fields |
|---|---|
| `SessionOpened` | `sessionId`, `tranche`, `taskPath`, `taskSha256`, `baseRevision`, `worktree` (the recorded identity) |
| `SnapshotTaken` | `sessionId`, `opId`, `tree` (tree id), `rawChecked: true` |
| `ReportRecorded` | `sessionId`, `opId`, `role`, `path`, `sha256`, `handoffPath`, `handoffSha256` |
| `HandoffApproved` | `sessionId`, `handoffId`, `fromOpId`, `toRole`, `tree`, `findingsSha256` (corrections only) |
| `HandoffRejected` | `sessionId`, `fromOpId`, `note` |
| `ReviewChecked` | `sessionId`, `opId`, `treeBefore`, `treeAfter` (stale when they differ) |
| `StepEndedByOwner` | `opId`, `grantId`, `at` (the B14 ruling's attestation, reduced: no probe) |
| `SessionClosed` | `sessionId`, `how` (`finished`, `abandoned`, `interrupted`), `note` |

The session fold (`src/features/session.ts`) maps the log to one state:

```
none --open--> open
open --implement--> attempt(implement)
attempt(r) --Finished+ReportRecorded[+SnapshotTaken]--> awaiting-handoff(r)
awaiting-handoff(implement|correct) --review--> attempt(review)
awaiting-handoff(review) --correct--> attempt(correct)
awaiting-handoff(any) --reject--> rejected
awaiting-handoff(review) --close --finished--> closed
attempt(r) with Intended but no Finished --(no command)--> interrupted
interrupted --step-ended--> interrupted-ended --close --interrupted--> closed
rejected | awaiting-handoff --close --abandoned--> closed
```

Corrections are bounded: at most two correction attempts per session
(M06). A third `correct` is refused. The owner closes the session and
opens a new one.

## Stop conditions (every command refuses, and names the reason)

- The lock is held.
- The startup worktree check fails (B11a to B11d).
- A client's `--version` differs from the pin in the configuration.
- Any attempt has `Intended` without `Finished` and no
  `StepEndedByOwner` (an incomplete attempt).
- Any hold other than a quota hold for the provider being launched
  (Approval, Uncertain, Failure, Drift, Protected), as `holdsOf` reports.
- The command does not match the session state (a duplicate or
  out-of-order command).
- The worktree's current snapshot differs from the one the handoff names
  (stale snapshot).
- A report or handoff file is missing, belongs to another session or
  attempt, or no longer matches its recorded hash (wrong-session report).
- A correction would exceed the bound.

A refusal appends nothing, except a pacing refusal, which appends its
quota hold as today.

## Crash behavior and closing an interrupted session

Durable state does not remove the gap between a log append and a process
effect. Foreman never replays an attempt, and never infers that one ran
or did not run.

- A crash before `Intended`: no effect was recorded, and none was
  attempted. The grant is an orphan, which the existing settle step
  cancels.
- A crash after `Intended` and before `Launched`: the client may or may
  not have started.
- A crash after `Launched` and before `Finished`: the client may still be
  running, and its output may be partial.

In the last two cases the attempt is incomplete, and every command except
`status`, `step-ended` and `session close --interrupted` refuses. The
owner's path:

1. `foreman status` shows the attempt, its grant, and the advisory
   process evidence below.
2. The owner establishes, outside foreman, that no process of the
   attempt is running, and inspects the worktree.
3. `foreman step-ended <opId> --grant <grantId>` records the owner's
   attestation. It signals nothing, does not retire or cancel the grant
   (the grant is charged at its estimate), does not resolve any hold, and
   authorizes no replay.
4. `foreman session close --interrupted --note <text>` ends the session.
   The worktree's state is the owner's to keep, restore or recreate.
   A new session needs `session open`, which starts from a fresh
   snapshot of whatever the worktree then holds.

An interrupted session never continues. This is the narrowest rule that
needs no recovery machinery (decision P6).

## Process evidence (advisory only)

`Launched` records the leader's pid, its process group, and the leader's
start time read once right after spawn. `status` lists the processes
whose group id equals the recorded group (`ps -A -o pid,pgid,lstart,command`,
decoded in Format), and marks whether the leader's pid and start time
still match.

Status labels this as evidence, not proof:
- A listed process with the group id but a different start time may be an
  unrelated process reusing the id.
- A descendant that left the group (`setsid`, double fork) is not listed.
- "Nothing listed" therefore does not establish cleanup. Only the owner's
  `step-ended` attestation unblocks, and foreman never signals.

## Snapshot identity and safety

A snapshot is a tree id for the worktree's candidate contents. It is
taken after each implement and correct attempt, before each review
launch, and after each review (to detect writes during review).

How it is taken:
- A fresh temporary index file in foreman's state directory, never the
  worktree's own index, so the real index is neither trusted nor
  changed.
- A new runner, `snapshotGitWith`, which is the pinned runner (B11d) plus
  `GIT_INDEX_FILE` set to that file: nine variables, with the three
  overrides. Its tests mirror B11d's exact-environment tests.
- `git read-tree <baseRevision>`, then `git add -A`, then `git
  write-tree`, all through that runner in the supervisor worktree.

Raw-byte and mode checks, because staging can convert content:
- For every entry of the written tree, `git hash-object --no-filters
  <path>` must equal the blob id in the tree. A mismatch means git
  converted the bytes (for example `core.autocrlf` in repository config)
  and the snapshot is refused.
- The file's mode on disk (regular, executable, symbolic link) must
  match the tree entry's mode. A mismatch is refused.
- A gitlink or a nested `.git` in the worktree is refused (M14).

Coverage, stated in `status` and every review brief:
- Covered: tracked and untracked files that git does not ignore.
- Not covered: ignored files, empty directories, files outside the
  worktree, and the git directory's metadata. Inspecting those between
  steps is the owner's task in this rung (no protected digest).
- Taking a snapshot writes blob and tree objects into the repository's
  object store. It moves no refs and changes no tracked state. The
  objects are unreferenced and removable by `git gc`.

A review is valid only for the snapshot it was given. `ReviewChecked`
records the tree before and after the review. If they differ, a write
happened during the review, the review is stale, and `correct` refuses to
use it.

## Approval semantics and waivers

- `Approved` (tranche approval) is appended once, by `session open`. It
  is the existing event and keeps its meaning.
- `HandoffApproved` is new and only lets the next attempt of this session
  launch. It never releases an `Approval` hold, and `Approved` never
  substitutes for it.
- Readings are never fresh until O11 (the clock mechanism) is decided,
  so pacing refuses every launch of either provider. That refusal
  appends a `Quota` hold for the provider, as today.
- With `--waive`, the same command then appends `Waived` for that
  provider, but only if `waiveAccepted` holds: the quota hold exists and
  no waiver is armed. Admission runs again with the armed waiver, takes
  the grant at its estimate, and `Intended` names the waiver. This works
  the same for Claude and Codex. One owner command records two separate
  facts: the handoff consent and a one-attempt waiver.
- Without `--waive`, the command stops after the refusal, and the quota
  hold stays, as today.
- Any other hold stops the command before admission, whatever flags are
  given.

## Profiles, context and briefs

- Claude implement and correct: the design's editing profile ("Permission
  profiles"): `--permission-mode dontAsk --permission-prompts none`, the
  allow and deny lists there (no `git commit`, `git push`, `git config`,
  web tools or `curl`; no edits to the protected set), sandbox enabled
  with `failIfUnavailable: true` and `allowUnsandboxedCommands: false`,
  no allowed domains, working directory the supervisor worktree.
- Codex review: `codex exec --sandbox read-only -c
  approval_policy="never" --json --output-last-message <file>`, working
  directory the supervisor worktree (the review worktree is deferred,
  M03).
- No bypass flag. Every attempt is a fresh process with no `--resume` or
  `--continue`.
- Client process environment: the parent's environment with every
  `GIT_*` variable removed (decision P2), so an agent's own git commands
  are not redirected and do not inherit foreman's pins.
- Briefs are built by Format from recorded files only:
  - implement: the task file;
  - review: the task, the snapshot's tree id, the base revision, the
    changed-path list (`git diff-tree -r --name-status <base-tree>
    <snapshot-tree>` through the pinned runner), Claude's last handoff
    text, the snapshot's coverage statement, and an instruction to end
    with a fenced JSON findings block;
  - correct: the task, the owner's findings file, the prior handoff and
    the snapshot's tree id.
- Findings: Format decodes the review's JSON findings block into a draft
  `findings.md` for the owner. A malformed block is shown raw, and the
  owner writes the findings file by hand. Only the file the owner passes
  to `correct` reaches the corrector, and its hash is in
  `HandoffApproved`.

## Slice A1: one owner-launched attempt, end to end

Prerequisite cleanup, its own commit at the start of A1: split
`src/domain/events.ts` (292 lines) under the 250-line limit, with no
behavior change (decision P1).

Files:
- Domain: `src/domain/session.ts` (new: `SessionId`, `HandoffId`, the
  session-state vocabulary), `src/domain/session-events.ts` (new events),
  `src/domain/events.ts` (union members; optional `leaderStartedAt` on
  `Launched`), `src/domain/process.ts` (new: leader identity and a
  process-listing row), `src/domain/profiles.ts` (new: the two fixed
  profiles as data).
- Features: `src/features/session.ts` (new: the fold, the allowed
  commands, the stop reasons), `src/features/process-evidence.ts` (new).
- Format: `src/format/ps.ts` (new), `src/format/foreman-config.ts` (new:
  pins, profile paths, state directory, estimates).
- Runtime: `src/runtime/spawn.ts` (new: spawn with an explicit argv, cwd
  and environment in a new process group; stream lines to a sink and a
  raw file; report exit status; no kill), `src/runtime/processes.ts`
  (new: raw `ps`), `src/runtime/client-version.ts` (new),
  `src/runtime/state-files.ts` (new: report files and SHA-256).
- Program: `src/program/attempt.ts` (new: lock, fold, stop conditions,
  admission and waiver, `Intended`, spawn, `Launched`, `Finished`,
  report, settle), `src/program/session.ts` (new: open, close, status,
  step-ended).
- Facade: `src/facade/cli.ts` (new: `session open`, `implement`,
  `status`, `step-ended`, `session close`).
- Tests: new files under `test/domain`, `test/features`, `test/format`,
  `test/runtime` and `test/program`; fake clients as fixture scripts in
  `test/fixtures/clients/` that emit recorded stream-json, injected
  through the client-launch seam rather than chosen by a flag.

A1 acceptance (fake clients only):
- `session open` then `implement` appends exactly: the grant,
  `Intended`, `Launched`, `Finished`, `ReportRecorded`, in that order,
  with the report's hash matching the file.
- Duplicate `implement` is refused, and so is `implement` with no
  session.
- Crash injection after `Intended` and after `Launched` (a Runtime that
  fails at that point): the next `implement`, `session open` and every
  other command except `status`, `step-ended` and `session close
  --interrupted` refuses; `step-ended` with a wrong grant or an unknown
  opId is refused; `close --interrupted` before `step-ended` is refused;
  nothing is replayed.
- `--waive` for Claude: with no fresh readings, the quota hold is
  appended, then `Waived`, then the grant, and `Intended` names the
  waiver. Without `--waive`, the hold stays and nothing launches. A
  second `--waive` while one is armed is refused.
- Any non-quota hold refuses before admission, with or without
  `--waive`.
- A version mismatch refuses.
- `status` shows the advisory process listing, labels it as evidence,
  and reports a reused group id (same group, different start time) as
  "not the recorded leader".
- The spawned child's environment has no `GIT_*` variable.

## Slice A2: owner-approved handoffs

Files:
- Domain: `src/domain/session-events.ts` (the handoff, snapshot and
  review-check events, if A1 left them out), `src/domain/findings.ts`
  (new).
- Features: `src/features/snapshot.ts` (new: the raw-byte, mode and
  gitlink judgment), `src/features/session.ts` (handoff transitions, the
  correction bound, staleness).
- Format: `src/format/brief.ts` (new: the three briefs),
  `src/format/findings.ts` (new: the JSON findings block),
  `src/format/codex.ts` (reuse; last-message file).
- Runtime: `src/runtime/git.ts` (`snapshotGitWith`),
  `src/runtime/snapshot.ts` (new: the temporary index and the raw reads).
- Program: `src/program/handoff.ts` (new: review, correct, reject),
  `src/program/snapshot.ts` (new).
- Facade: `src/facade/cli.ts` (`review`, `correct`, `reject`).
- Tests as in A1, plus real disposable repositories for the snapshot.

A2 acceptance:
- One complete cycle with fake clients: open, implement, review,
  correct, review, close finished. The log is exactly the expected
  sequence, each brief holds exactly the recorded inputs, and no step
  launched without its owner command.
- Stale snapshot: an edit between implement and review refuses `review`;
  a write during review (a fake reviewer that writes) yields a stale
  `ReviewChecked`, and `correct` refuses.
- Wrong-session report: a report file from another session, or one whose
  bytes changed after `ReportRecorded`, refuses the handoff.
- Duplicate and out-of-order commands: `review` twice, `correct` before
  any review, and a third `correct` are refused.
- Rejected handoff: after `reject`, `review` and `correct` refuse, and
  only `close --abandoned` is accepted.
- Interrupted launch during review and during correct: same rules as A1.
- Snapshot safety on real repositories: `core.autocrlf=true` with a CRLF
  file is refused (bytes differ); an executable-bit change is detected; a
  gitlink is refused; the worktree's own index is byte-identical before
  and after; no ref moves (`for-each-ref` before and after).
- `snapshotGitWith` passes exactly nine variables, with the overrides
  first (unit and coverage tests, as in B11d).
- `--waive` for Codex follows the same path as Claude's in A1.
- A malformed findings block leaves the raw review for the owner, and
  `correct` uses only the owner's file.

## Separate packages

- L3 subset (live, needs its own authorization): on a disposable
  repository, confirm that the Claude editing profile cannot write
  outside the worktree, cannot edit a protected path, and cannot run
  `git commit`, `git push` or `curl`; that the Codex read-only profile
  cannot write; and record both clients' versions for the pins. About 8
  short client runs. This must pass before any assisted cycle on real
  work, including foreman's own.
- W1 (Waxwing's exact-line attribute exception, M09): needed before the
  assisted cycle can open a session on Waxwing, since the startup check
  refuses it today. Not part of A1 or A2.

## Costs

| Item | Estimate or measurement | Basis |
|---|---|---|
| B11d implementation | 181,520 tokens, measured | replaces the delta's 200k to 450k allowance; its focused review is still pending |
| A1 implementation | 250k to 400k | five layers plus a CLI and a spawn module; B11a's slice measured 153,558, and B11d 181,520 |
| A1 review and corrections | 100k to 200k | B11b to B11c correction passes measured 205k to 327k; a tighter brief should land lower |
| A2 implementation | 200k to 350k | builds on A1's seams |
| A2 review and corrections | 100k to 200k | as A1 |
| L3 subset preparation | 80k to 150k | fixtures, runbook and records |
| L3 live calls | about 8 short client runs | subscription usage, recorded in the results file |
| W1 | 150k to 300k | Codex's estimate (M09) |
| Total for A1 and A2 with reviews | 650k to 1.15M | excluding L3, W1 and coordination |

These are forecasts, not caps. Each pass's measured usage is recorded,
and the next forecast is revised from it.

## Decisions to settle before dispatch

| ID | Decision | Recommendation |
|---|---|---|
| P1 | `src/domain/events.ts` is 292 lines, over the limit and not among the recorded cleanups | Split it as A1's first commit, with no behavior change |
| P2 | Client process environment | The parent's environment minus every `GIT_*` variable |
| P3 | How foreman runs | From a separate pinned checkout at a reviewed commit, invoked as `bun <checkout>/src/facade/cli.ts`; no `package.json` change in A1 or A2; promotion is manual |
| P4 | Profiles and pins | Exactly the design's Claude editing profile and Codex read-only review profile; pins in the configuration file, set from the L3 subset's recorded versions |
| P5 | Grant estimate per launch | The existing `initialEstimate` (15 points) for both roles until measurements exist |
| P6 | Interrupted session | Close only; no further attempt in that session |
| P7 | Review target | The uncommitted snapshot in the same worktree, named by tree id (M03) |
| P8 | Findings format | A fenced JSON block requested in the review brief; malformed falls back to the owner's own file |
| P9 | Correction bound | Two corrections per session (M06) |
| P10 | Order | B11d review and landing, then A1, then A2, then the L3 subset, then the first real assisted cycle on foreman; W1 before Waxwing |

Control for each slice: one fresh worker with a short brief naming these
files and decisions, no delegation, no automatic follow-up, `gtimeout` on
every run, docs, check and the full test suite before each commit, and a
stop for review.
