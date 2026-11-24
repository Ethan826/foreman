# Assisted cycle (MVP-D0): bounded plan for A1 and A2

Status: revision 3, 2026-11-19; decisions P1 to P13 approved. Nothing here
authorizes a worker, live call, landing or push. Revision 2 (29c3c81)
corrected revision 1 (4f1b949) for the Codex review's findings AC1 to
AC6. Revision 3 makes the revision-2 review's three corrections: the
waiver step runs past a quota hold and writes batch Q before batch W;
the first review covers the owner-attested current candidate; and the
closed-vocabulary registrations AGENTS.md requires are allowed. The
specification below is self-contained; it does not depend on the
untracked design delta it came from.

## Goal and boundary

One terminal, no copying between tabs. The owner opens a session for a
bounded task in the supervisor worktree and drives it with subcommands:
implement, review, correct, review again, close. Foreman launches each
fresh client, shows its output, keeps every report and brief, and builds
the next client's input. Every handoff waits for an explicit owner
command. A client's verdict never launches anything.

Inside A1 and A2: fixed permission profiles, version pins, fresh
context, the existing admission check, grants and waivers, durable
intent before launch, captured reports, distinct holds, fail-stop on
anything incomplete, and a close that is always reachable.

Outside A1 and A2: automatic verification, commits, resets, recovery,
replay, process signaling of any kind, a persistent interactive
interface, automatic transitions, background scheduling, rate fitting,
review worktrees, concurrency and self-promotion. The owner keeps
verification, commits, process cleanup and protected-input inspection.

## Global constraints

- AGENTS.md binds every slice: decision-core layering, Effect v4, TSDoc
  on every export, closed vocabularies with their lint fixtures, files at
  most 250 lines, no suppressions, no weaker gates.
- `bun run docs`, `bun run check` and the full `bun run test` pass
  before each commit. Runs use `gtimeout`; no pattern kills.
- No bypass permission flag for either client. No `--resume` or
  `--continue`. No signal is ever sent to a client process.
- Holds stay distinct. A handoff consent never releases an approval
  hold; a timer never grants anything.
- No new dependency, and no change to `package.json` or CI in A1 or A2.
- Lint configuration changes are limited to what AGENTS.md requires for
  new closed vocabularies: adding their names to `closedNames`, their
  modules to `canonicalModules`, the rule message's list of constants,
  and one fixture line and assertion per name. No rule is weakened and
  no exemption is added.
- Git commands run only through B11b's clean runner, B11d's pinned
  runner, or the snapshot runner defined below.

## Provenance

| Component | Source | Fidelity |
|---|---|---|
| Compare-and-append log, atomic event batches | existing `ProjectLog.append(expected, events)` (B5); optimistic concurrency (Kung and Robinson, 1981) | Reuse |
| Grants, admission, waivers, settlement | existing B1 to B7 code and design "Grant lifecycle", "Waivers" | Reuse, plus one settle action (below) |
| Owner attestation of an ended step | design ruling of 2026-11-16 (`step ended`) | Reduced: no probe |
| Atomic file publication | write to a temporary name, flush, `rename(2)` (POSIX) | Faithful |
| Temporary index and tree snapshot | git's documented `GIT_INDEX_FILE`, `read-tree`, `add -A`, `write-tree` | Faithful use of the CLI |
| Blob ids for raw checks | git's object format: SHA-1 of `blob <size>\0<bytes>` (gitformat-loose); a symbolic link's blob is its link text | Faithful; checked against `git` in tests |
| Process listing | `ps -A -o pid,pgid,lstart,command` | Advisory evidence only |
| Client invocation | the design's "Permission profiles" for Claude and Codex | Reuse |

Nothing here is an invented algorithm.

## Commands and their prerequisites (AC1)

Each command checks only its own prerequisites, so the owner's exits stay
available when the worktree, a client or a file is broken.

| Condition | `status` | `session open` | `implement` | `review` | `correct` | `reject` | `step-ended` | `session close` |
|---|---|---|---|---|---|---|---|---|
| Project lock | not taken | required | required | required | required | required | required | required |
| Session state | any | none open | open, no attempt | awaiting handoff after a usable implement or correct | awaiting handoff after a usable review with changes requested | awaiting handoff | incomplete attempt | open (see close rules) |
| Startup worktree check (B11a to B11d) | reported | required | required | required | required | not needed | not needed | not needed |
| HEAD equals the session's base (owner ruling of 2026-11-23) | a moved HEAD is reported as a finding | n/a | required (HEAD from the startup check) | required (HEAD from the startup check) | required (HEAD from the startup check) | not needed | not needed | `--finished`: required, from its own `git rev-parse HEAD` alone; `--abandoned` and `--interrupted`: not needed, no HEAD read |
| Client version pin | reported | not needed | required (Claude) | required (Codex) | required (Claude) | not needed | not needed | not needed |
| Holds | reported | no non-quota hold | no non-quota hold; a Claude quota hold goes to the waiver step | no non-quota hold; a Codex quota hold goes to the waiver step | as `implement` | not needed | not needed | not needed |
| Recorded report files intact | reported | n/a | n/a | required | required | not needed | not needed | not needed |
| Owner attestation (`--attest`) | n/a | n/a | n/a | required | required | not needed | itself an attestation | required for `--finished` |
| Snapshot | reported | n/a | n/a | taken now, after `--attest`; must pass the raw checks | must equal the reviewed tree | not needed | not needed | `--finished`: must equal the reviewed tree |

`blocks` is the existing provider-specific rule: a quota hold blocks
only its own provider; every other hold blocks every launch.

Close rules:
- `--abandoned`: any open session with no incomplete attempt, including
  one opened with no attempt yet.
- `--interrupted`: a session whose every incomplete attempt has
  `StepEndedByOwner`.
- `--finished`: the last attempt is a usable review with no changes
  requested, `--attest` is given, the worktree's HEAD is still the
  session's base (read with `git rev-parse HEAD` only, after the other
  rules pass; owner ruling of 2026-11-23), and the snapshot still equals
  the reviewed one.
- Every close runs the settle step and appends `WaiverExpired` for an
  armed waiver. It releases no hold, deletes no file and changes no
  grant except through settlement.

`status` never takes the lock and never writes. It shows the session
state, every incomplete attempt with its grant, holds, armed waivers, the
pin check, the worktree check, a HEAD that moved from the open session's
base, report integrity and the advisory process evidence.

## Events

New events go in `src/domain/session-events.ts` and join
`ProjectEvent`. `Launched` gains an optional `leaderStartedAt`.

| Event | Fields |
|---|---|
| `SessionOpened` | `sessionId`, `tranche`, `taskPath`, `taskSha256`, `baseRevision`, `worktree` (`RecordedGitIdentity`) |
| `ReportRecorded` | `sessionId`, `opId`, `role`, `rawPath`, `rawSha256`, `handoffPath`, `handoffSha256` (an empty handoff file when the client gave none) |
| `SnapshotTaken` | `sessionId`, `forOpId` (the attempt it follows), `tree` |
| `HandoffApproved` | `sessionId`, `fromOpId`, `toRole`, `tree`, `findingsSha256` (corrections only), `attests` (`quiescence-and-inspection`) |
| `HandoffRejected` | `sessionId`, `fromOpId`, `note` |
| `ReviewChecked` | `sessionId`, `reviewOpId`, `reviewedTree`, `currentTree` |
| `StepEndedByOwner` | `opId`, `grantId`, `at` |
| `SessionClosed` | `sessionId`, `how` (`finished`, `abandoned`, `interrupted`), `note`, `attests` (optional; required for `finished`) |

## Write protocol (AC2)

All log writes are atomic batches through `ProjectLog.append(expected,
events)`. A batch either lands whole or not at all. Files are published
before the log record that names them: write to `<name>.tmp`, flush,
rename to `<name>`, then hash. A published file with no record is an
orphan: kept as evidence, never used. A record whose file is missing or
whose hash no longer matches makes that session close-only.

A launch command (`implement`, `review`, `correct`) runs these steps:

1. Take the lock and fold the log. Run the settle step (existing, plus
   the owner-ended charge below). Check the command's prerequisites.
2. For `review` and `correct` only: re-run the B11c attribute-source
   check through the pinned runner, then take the snapshot (below). For
   `correct`, also compare it with the reviewed tree.
3. Admission and the waiver step. Non-quota holds already stopped the
   command in step 1; a quota hold for this provider does not.
   - An armed waiver for this provider exists (a retry after batch W):
     decide with it; the ledger transaction writes the grant.
   - Otherwise, if no quota hold for this provider exists, decide
     admission (pure, from the ledger snapshot). Admitted: the ledger
     transaction writes the grant, and the command goes to step 4.
     Refused by pacing: append batch Q = [`HoldCreated(Quota)`] (as
     today).
   - Now a quota hold for this provider exists. Without `--waive`, stop:
     nothing else is recorded, and the owner's consent is not consumed.
   - With `--waive`: check `waiveAccepted` (the hold now exists, so the
     only refusal is another armed waiver). If accepted, append batch W
     = [`Waived(provider, waiverId)`], decide again with the armed
     waiver, and the ledger transaction writes the grant. If refused,
     stop; nothing beyond batch Q was written.
   - A quota hold released by readings (`quotaReleased`) is treated as
     absent, as today.
4. Append batch I, which is the consent and the intent together:
   - `implement`: [`Intended`].
   - `review`: [`SnapshotTaken`, `HandoffApproved`, `Intended`].
   - `correct`: [`ReviewChecked`, `HandoffApproved`, `Intended`].
   If batch I fails with `PositionMoved`, cancel the grant as a lost
   race and stop.
5. Spawn the client. Append batch L = [`Launched(pid, pgid,
   leaderStartedAt)`].
6. Stream output to the terminal and to the raw file. When the leader
   exits, publish the raw file and the handoff file.
7. Classify the outcome (Features). Append batch F = [`Finished(outcome,
   endedAt)`, `ReportRecorded(...)`]. One batch, so no state has
   `Finished` without its report.
8. Run the settle step (the grant is charged at its estimate).

Every crash point and what follows:

| Crash after | State seen next | Next command allowed |
|---|---|---|
| step 1 or 2 | nothing new (snapshot objects only, unreferenced) | the same command again |
| batch Q | quota hold | the same command with `--waive` (it skips batch Q and writes batch W), or `close --abandoned` |
| batch W, before the grant | armed waiver, no grant | the same command, with or without `--waive` (it uses the armed waiver and writes no second `Waived`); `close` expires it |
| the grant, before batch I | orphan grant | any; the settle step cancels it `orphan` |
| batch I, before batch L | incomplete attempt (may or may not have started) | `status`, `step-ended`, then `close --interrupted` |
| batch L, before batch F | incomplete attempt (may still run) | the same |
| batch F, before step 8 | finished attempt, charge pending | any; the next settle step charges it |

A refused `--waive` (another provider's waiver armed) writes nothing
beyond batch Q. Retrying any command after any row above neither
launches twice nor strands the session: the only way past an incomplete
attempt is `step-ended` and then `close --interrupted`, and nothing is
ever replayed.

## Settlement for owner-ended steps (AC3)

`src/features/settle.ts` gains `ChargeFromOwnerEnded(grantId, endedAt,
points)`. `actionFor` returns it for an `Intended` with no `Finished` and
a `StepEndedByOwner` naming the same opId and grant, whether or not
`Launched` exists. `endedAt` is the attestation's `at`.
`src/program/admission.ts` `settleRowOf` maps it to `Charged` at the
grant's estimate.

Rules: it charges once (a charged grant is no longer open); it cancels
and retires nothing; it writes no `Finished` and no outcome; a failed
settle transaction writes nothing and is retried by the next command's
settle step.

`step-ended` appends `StepEndedByOwner` only when the attempt has
`Intended` without `Finished` and the grant is that attempt's; a second
attestation for the same opId is refused.

## Quiescence, inspection and snapshots (AC4)

A leader's normal exit does not prove that its descendants stopped. So
every handoff command (`review`, `correct`, `close --finished`) requires
`--attest`, which records in `HandoffApproved` (or, for `close
--finished`, in `SessionClosed.attests`, appended in one batch with its
`ReviewChecked`) that the owner has:

1. established that no process of any preceding attempt in this session
   is still running, and
2. inspected the protected inputs (instruction files, `.claude/`,
   `.codex/`, attribute files, the git directory's config, hooks and
   `info/`) since the last attempt.

One flag, one owner action per handoff. Without it the command refuses.
`status` shows the advisory process evidence to help with (1).

No snapshot is taken automatically after an attempt. The first git
staging after an attempt happens only inside the next handoff command,
after the attestation and after the B11c attribute-source check passes
again through the pinned runner. A fake client whose leader exits while a
child keeps writing must not enable the next launch without `--attest`.

## Process evidence (advisory only)

`Launched` records the leader's pid, its process group and its start
time, read once right after spawn. `status` lists processes whose group
equals the recorded group, decoded from `ps`, and marks whether the
leader's pid and start time still match.

Status labels this as evidence, not proof: a matching group with a
different start time may be an unrelated process reusing the id; a
descendant that left the group is not listed; "nothing listed" does not
establish cleanup. Foreman never signals.

## Snapshot identity and raw checks (AC5)

A snapshot is the tree id of the worktree's covered contents, built in a
temporary index in foreman's state directory. The worktree's own index
is never read or written.

What gets reviewed: the first `review` after an attempt reviews the
worktree's current candidate, the one the owner's `--attest` selects. No
snapshot exists between an attempt's end and that review, so foreman
cannot see an edit made in between, and the plan does not claim to. Any
such edit is part of the candidate the owner attested. After that, every
`correct` and `close --finished` requires the worktree to still equal the
reviewed tree.

- Runner: `snapshotGitWith(start)(home)(identity)(indexFile)`, the B11d
  pinned runner plus `GIT_INDEX_FILE`, exactly nine variables, with the
  three overrides.
- Commands, in the supervisor worktree: `git read-tree <baseRevision>`,
  `git add -A`, `git write-tree`, then `git ls-tree -r -z <tree>` for the
  entries.
- Raw checks, per entry, using `lstat` (never following a link):
  - mode 100644 or 100755: the path is a regular file; its executable bit
    matches; the blob id computed in-process from its raw bytes equals
    the tree's;
  - mode 120000: the path is a symbolic link; the blob id of its link
    text (`readlink`, not followed) equals the tree's. Links inside,
    outside or dangling are all handled the same way, and no target is
    read;
  - mode 160000 (gitlink), or any other file type on disk, is refused
    before staging (M14).
  - A repository whose object format is not SHA-1 is refused.
- Coverage, stated in `status` and every review brief: tracked and
  untracked files git does not ignore. Not covered: ignored files, empty
  directories, anything outside the worktree, and the git directory.
- Staging writes blob and tree objects into the object store. It moves
  no refs and changes no tracked state.
- A review is valid only for the tree it was given. `ReviewChecked`
  compares that tree with a fresh snapshot at the next handoff. Equality
  shows only that the covered contents are the same at both endpoints.
  It does not detect a write that was later undone. Read-only containment
  of the reviewer is L3's to establish.
- When `ReviewChecked` would show a different tree, `correct` and
  `close --finished` refuse and append nothing. The review stays stale,
  and only `reject` or `close --abandoned` remain.

Waxwing has 15 tracked symbolic links (`.claude/skills/*` to
`.agents/skills/*`), so links are handled rather than refused.

## Outcomes and usable attempts (AC6)

`src/features/step-outcome.ts` owns classification:
`classifyAttempt(role, exit, decoded): StepOutcome`, from the leader's
exit and the decoded client events (existing Format decoders), never from
the client's prose.

| Role | Usable outcomes | Next |
|---|---|---|
| implementer, corrector | `Success` | `review` or `reject` |
| reviewer | `Success` (no changes) | `close --finished` or `reject` |
| reviewer | `ChangesRequested` | `correct` or `reject` |
| any | `RateLimited`, `AuthFailed`, `PermissionDenied`, `MaxTurns`, `Crashed`, `Unclassified` | close only (`--abandoned`) |

A reviewer's verdict comes from its decoded findings block: an empty
list is `Success`, a non-empty one is `ChangesRequested`, and a missing
or malformed block is `Unclassified`. Corrections are bounded at two per
session; a third `correct` is refused.

## Profiles, environment and briefs

- Claude implement and correct: the design's editing profile:
  `--permission-mode dontAsk --permission-prompts none`, the design's
  allow and deny lists (no `git commit`, `git push`, `git config`, web
  tools or `curl`; no edits to the protected set), sandbox enabled with
  `failIfUnavailable: true` and `allowUnsandboxedCommands: false`, no
  allowed domains, `--output-format stream-json`, working directory the
  supervisor worktree.
- Codex review: `codex exec --sandbox read-only -c
  approval_policy="never" --json --output-last-message <file>`, working
  directory the supervisor worktree (no separate review worktree in this
  rung).
- Client environment: the parent's environment with every `GIT_*`
  variable removed.
- Briefs (Format, from recorded files only): implement takes the task
  file. Review takes the task, the tree id, the base revision, the
  changed paths (`git diff-tree -r --name-status <base> <tree>` through
  the pinned runner), the last handoff text, the coverage statement, and
  a request for a fenced JSON findings block. Correct takes the task, the
  owner's findings file, the prior handoff and the tree id.
- Findings: Format decodes the block into a draft `findings.md`. Only the
  file the owner passes to `correct` reaches the corrector, and its hash
  is in `HandoffApproved`.

## Injected capabilities

Signatures are TypeScript shapes over Effect; exact names may follow
house style, but each must exist and be injected through Program, never
chosen by a flag.

- `StartClient`: `(launch: ClientLaunch) => Effect<RunningClient,
  ClientStartFailed>`, where `ClientLaunch = { argv, cwd, env, rawPath }`
  and `RunningClient = { pid, pgid, leaderStartedAt: Option<string>,
  lines: Stream<string>, exit: Effect<ClientExit> }`, `ClientExit = {
  code: Option<number>, signal: Option<string> }`.
- `ReadProcesses`: `() => Effect<string, ProcessReadFailed>` (raw `ps`
  text; Format decodes).
- `ReadClientVersion`: `(client: Client) => Effect<GitOutput-like raw
  output, ClientStartFailed>`.
- `StateFiles`: `publish(path, bytes) => Effect<Sha256, StateFileFailed>`,
  `read(path) => Effect<bytes, StateFileFailed>`.
- `ReadWorktreeEntry` (A2): `(path) => Effect<RawEntry, EntryReadFailed>`
  where `RawEntry` is regular (bytes, executable), link (text), or other.
- Existing: `ProjectLog`, `LedgerStore`, `tryLock`, `cleanGit`,
  `pinnedGitWith`, Effect's `Clock`.

Features functions, all pure: `foldSession(log): SessionState`;
`allowed(command, state, checks): Allowed | Refusal`; `classifyAttempt`;
`settleActions` (extended); `processEvidence(recorded, rows)`; and in A2
`judgeSnapshot(treeEntries, rawEntries): SnapshotVerdict` and
`reviewCurrent(reviewed, current)`.

## Slice A1: one owner-launched attempt, end to end

A1's executable boundary: `session open`, `implement`, `status`,
`step-ended`, `session close --abandoned|--interrupted`. No snapshot, no
review, no handoff, no `--attest`.

First commit (P1): split `src/domain/events.ts` (292 lines) with no
behavior change. Step events (`Intended`, `Launched`, `Finished`,
`CommitRecorded`) move to `src/domain/step-events.ts`; owner events
(`Approved`, `PreApproved`, `Waived`, `WaiverExpired`, `Released`,
`Adopted`, `Reconciliations`, `Reconciled`, `ProtectedReleased`) to
`src/domain/owner-events.ts`; worktree and request events to
`src/domain/worktree-events.ts`. `events.ts` keeps `ProjectEvent`,
`LogPosition`, `LoggedEvent`, the errors and `ProjectLog`, and re-exports
every moved name. Test: `test/domain/events-encoding.test.ts` decodes a
golden fixture holding one encoded row of every event, written before
the split, and the fixture is unchanged after it.

Files:
- Domain: `src/domain/session.ts` (new), `src/domain/session-events.ts`
  (new: `SessionOpened`, `ReportRecorded`, `StepEndedByOwner`,
  `SessionClosed`), `src/domain/events.ts` (union), the three split
  modules, `src/domain/process.ts` (new), `src/domain/profiles.ts` (new).
- Features: `src/features/session.ts` (new), `src/features/command-rules.ts`
  (new: the prerequisite matrix), `src/features/step-outcome.ts` (new),
  `src/features/process-evidence.ts` (new), `src/features/settle.ts`
  (owner-ended charge).
- Format: `src/format/ps.ts` (new), `src/format/foreman-config.ts` (new),
  `src/format/claude.ts` and `src/format/codex.ts` (reuse).
- Runtime: `src/runtime/spawn.ts` (new), `src/runtime/processes.ts`
  (new), `src/runtime/client-version.ts` (new),
  `src/runtime/state-files.ts` (new).
- Program: `src/program/admission.ts` (`settleRowOf`),
  `src/program/attempt.ts` (new: the write protocol, steps 1, 3 to 8),
  `src/program/session.ts` (new: open, close, status, step-ended).
- Facade: `src/facade/cli.ts` (new).

A1 tests:
- `test/domain/events-encoding.test.ts`
- `test/features/session.test.ts`: the fold, every state.
- `test/features/command-rules.test.ts`: each cell of the matrix,
  including close with no attempt, close with a failed worktree check, a
  version mismatch and a missing report.
- `test/features/step-outcome.test.ts`
- `test/features/settle-owner-ended.test.ts`: charges once; with and
  without `Launched`; repeated settle writes nothing; no `Finished`
  written; wrong grant ignored.
- `test/features/process-evidence.test.ts`: reused group id, missing
  leader, nothing listed.
- `test/format/ps.test.ts`, `test/format/foreman-config.test.ts`
- `test/runtime/spawn.test.ts`: real child in a new group; environment
  has no `GIT_*` variable; exit code and signal reported; nothing
  signaled.
- `test/runtime/state-files.test.ts`: publish is atomic; hash matches.
- `test/program/attempt-protocol.test.ts`: the exact sequence with a
  fake client: settle, grant, batch I, batch L, batch F, settle. Under
  refusing pacing:
  - a fresh `--waive`: batch Q, then batch W, then the grant, then batch
    I naming the waiver;
  - without `--waive`: batch Q only, and a second run without it appends
    nothing;
  - a retry with `--waive` after batch Q: no second hold, batch W, grant,
    batch I;
  - a retry after batch W (with or without `--waive`): no second
    `Waived`, grant, batch I naming the armed waiver;
  - a non-quota hold, or a quota hold of the other provider plus that
    provider's armed waiver: refused, nothing appended.
- `test/program/attempt-crash.test.ts`: a failure injected after batch Q,
  batch W, the grant, batch I, batch L, the raw file's publication and
  batch F, and a failed settle transaction and a `PositionMoved` on
  batch I. Each matches the crash table; retries never launch twice.
- `test/program/session-commands.test.ts`: duplicate `implement`;
  `step-ended` with a wrong grant, an unknown opId, twice; `close
  --interrupted` before `step-ended`; close expires an armed waiver;
  close leaves every hold.
- `test/facade/cli.test.ts`: argument parsing only.
- Fake clients: `test/fixtures/clients/claude-success.ts`,
  `claude-crash.ts`, `claude-rate-limited.ts`, injected through
  `StartClient`.

## Slice A2: owner-approved handoffs

A2's executable boundary adds `review`, `correct`, `reject`, `--attest`,
`close --finished`, snapshots and review checks.

Files:
- Domain: `src/domain/session-events.ts` (`SnapshotTaken`,
  `HandoffApproved`, `HandoffRejected`, `ReviewChecked`),
  `src/domain/findings.ts` (new), `src/domain/snapshot.ts` (new).
- Features: `src/features/snapshot.ts` (new: `judgeSnapshot`,
  `reviewCurrent`), `src/features/session.ts` and
  `src/features/command-rules.ts` (handoff transitions, the bound).
- Format: `src/format/brief.ts` (new), `src/format/findings.ts` (new),
  `src/format/blob-id.ts` (new: the blob id of raw bytes).
- Runtime: `src/runtime/git.ts` (`snapshotGitWith`),
  `src/runtime/worktree-entries.ts` (new: `lstat`, read, `readlink`).
- Program: `src/program/handoff.ts` (new), `src/program/snapshot.ts`
  (new).
- Facade: `src/facade/cli.ts` (the new commands).

A2 tests:
- `test/program/assisted-cycle.test.ts`: open, implement, review
  (`--attest`), correct (`--attest`), review, close `--finished`, with
  fake clients. The log is exactly the expected batches; each brief holds
  only recorded inputs; nothing launched without its command.
- `test/program/handoff-refusals.test.ts`: no `--attest`; a candidate
  that fails the raw checks; a write during review detected at the next
  handoff (`correct` and `close --finished` both refuse); a report from another session; a report whose bytes changed;
  `review` twice; `correct` before a review; a third `correct`; after
  `reject` only `close --abandoned`; an unusable outcome allows only
  close; a fake implementer whose leader exits while a child keeps
  writing does not enable `review` without `--attest`.
- `test/program/handoff-crash.test.ts`: failures after snapshot staging,
  batch W, the grant, batch I, batch L and batch F for `review` and
  `correct`.
- `test/runtime/snapshot-git.test.ts`: `snapshotGitWith` passes exactly
  nine variables with the overrides first.
- `test/program/snapshot-real.test.ts` (real disposable repositories):
  `core.autocrlf=true` with a CRLF file is refused; an executable-bit
  change is detected; internal, dangling and outside symbolic links all
  match git's blob without reading a target; a gitlink is refused; the
  worktree's index file is byte-identical before and after; no ref moves.
- `test/format/blob-id.test.ts`: equals `git hash-object` on fixtures.
- `test/format/findings.test.ts`, `test/format/brief.test.ts`.
- `test/features/snapshot.test.ts`.
- Fake clients: `test/fixtures/clients/codex-review-clean.ts`,
  `codex-review-findings.ts`, `codex-review-malformed.ts`,
  `claude-lingering-child.ts`.

## Separate packages

- L3 subset (live, separate authorization): on a disposable repository,
  confirm the Claude editing profile cannot write outside the worktree,
  edit a protected path, or run `git commit`, `git push` or `curl`;
  confirm the Codex read-only profile cannot write; record both
  versions for the pins. About 8 short client runs. Required before any
  assisted cycle on real work.
- W1 (Waxwing's exact-line attribute exception): required before a
  session on Waxwing. Not part of A1 or A2.

## Costs

| Item | Estimate or measurement |
|---|---|
| B11d implementation | 181,520 tokens, measured; its review is pending |
| A1 implementation | 300k to 450k (widened for the write protocol and settlement) |
| A1 review and corrections | 100k to 200k |
| A2 implementation | 250k to 400k (snapshots with raw checks) |
| A2 review and corrections | 100k to 200k |
| L3 subset preparation | 80k to 150k, plus about 8 short live client runs |
| W1 | 150k to 300k |
| A1 and A2 with reviews | 750k to 1.25M |
| With L3 preparation | 830k to 1.40M, before live usage and coordination |

Forecasts, not caps. Measured usage is recorded after each pass.

## Review focus

For the reviewer of each slice: the crash table against the code (every
batch boundary has a test); no path that replays an attempt or launches
twice; `status` and `close` reachable under every failure in the matrix;
the owner-ended charge happens once; the snapshot never follows a link
or touches the real index; no client environment carries `GIT_*`.

## Decisions

Owner ruling (2026-11-19): P1 to P13 are approved as recommended. This
approves the plan's decisions, not dispatch. A1 still needs its own
authorization, after B11d's review and landing (P10).

| ID | Decision | Ruling |
|---|---|---|
| P1 | Split `events.ts` first, files as named in A1 | Approve |
| P2 | Client environment: parent's minus every `GIT_*` | Approve |
| P3 | Run from a separate pinned checkout as `bun <checkout>/src/facade/cli.ts`; manual promotion | Approve |
| P4 | Profiles exactly as above; pins from the L3 subset's recorded versions | Approve |
| P5 | Grant estimate: existing `initialEstimate` (15 points) for every role | Approve |
| P6 | Interrupted session: `step-ended`, then close only | Approve |
| P7 | Review the uncommitted snapshot in the same worktree | Approve |
| P8 | Findings as a fenced JSON block; malformed is `Unclassified` | Approve |
| P9 | Two corrections per session | Approve |
| P10 | Order: B11d review and landing, A1, A2, L3 subset, first real cycle on foreman, W1 before Waxwing | Approve |
| P11 | Unusable outcomes (rate limit, crash, unclassified and the rest) are close-only | Approve for this rung; revisit if rate limits make it painful |
| P12 | `--attest` covers quiescence and protected-input inspection in one flag | Approve |
| P13 | Symbolic links handled by link-text blob ids, not refused; non-SHA-1 repositories refused | Approve |

Control for each slice: one fresh worker with a short brief naming this
document, the slice's files and the ruled decisions; no delegation; no
automatic follow-up; a stop for review.

## Execution record

Owner direction (2026-11-19, evening): work A1, A2 and their supporting
pieces tonight with parallel workers, and review in larger batches. The
coordinator integrates each worker branch onto `assisted` (B11d rebased
onto main, then the slices), verifying docs, check and the full test
suite after each merge. No live client call, landing or push without a
separate OK. The deferred cleanups stay deferred.

Wave 1, in parallel, each in its own worktree:
- `a1-events`: P1's `events.ts` split, then the findings decoder
  (`src/domain/findings.ts`, `src/format/findings.ts`).
- `a1-runtime`: `src/domain/process.ts`, `src/format/ps.ts`,
  `src/runtime/spawn.ts`, `processes.ts`, `client-version.ts`,
  `state-files.ts`, and the pure `src/features/client-environment.ts`
  (P2).
- `a2-snapshot`: the snapshot vertical below the handoff: blob ids,
  worktree entries, `snapshotGitWith`, `judgeSnapshot`, the temporary
  index procedure.
- `w1-waxwing`: the exact-line attribute exception as an injected
  allowance, empty by default.
- `l3-prep`: the L3 subset's runbook and disposable-repository scripts;
  no live calls.

Integrated onto `assisted` so far (each verified after integration with
docs, check and the full test suite; measured worker use from the
harness):

| Branch | Commits on `assisted` | Measured tokens |
|---|---|---|
| `w1-waxwing` | e8cbd0f | 154,493 |
| `a1-events` | ddea966, d7dbb3e, bcb64d9 | 141,051 |
| `a2-snapshot` | 09977db | 211,551 |
| `l3-prep` | 60f4417 (prepared, not run) | 148,369 |
| `a1-core` | 5dbb46c, cb23f85, dadcb2a | 281,093 |
| `a1-runtime`, part 1 | a1d3903 (the declaration file merged by the coordinator) | 236,870 for the first pass |

Owner ruling (2026-11-19, evening), on the `a1-runtime` worker's scope
stop: B11b's process gate (`test/runtime/git-process-gate.test.ts`)
allows exactly four modules to import `node:child_process`, by path:
`src/runtime/git.ts`, `spawn.ts`, `processes.ts` and
`client-version.ts`. It is tightened at the same time: every `spawn`
call must pass an explicit `env`, and no module other than `git.ts` may
pass "git" as the program. Must-fail fixtures prove each new rule.

Wave 3 started: `a2-briefs` (the brief builder and the name-status
decoder). The A1 Program wave starts once `a1-runtime` finishes.

More integrated: `a1-runtime` part 2 (de2223f; the gate change), 252,511
tokens for the resumed pass; `a2-briefs` (67532ad), 133,991; `a1-program`
(9a8d0d9, e152a84, 931cd33 as 7ffa281 and its two parents), 408,984.

Owner ruling (2026-11-19, evening), on the `a1-program` worker's scope
stop: the CLI's entry statement lives in `src/facade/main.ts`, the only
file besides the four runtime process modules that may reference the
`process` global, and only as `process.argv`, `process.env` and
`process.exit`. The process gate enforces both limits, with must-fail
fixtures.

Coordinator's correction: the `a1-program` brief left out
`--permission-prompts none`, which the plan and the L3 runbook include;
the A2 worker adds it.

More integrated: `a2-handoff` part 1 (`--permission-prompts none`;
Claude's result text as the handoff), 230,883 tokens for a pass that
stopped at a lint conflict; `assisted-docs` (5132bda), 198,854.

Owner ruling (2026-11-19, evening), on the entry point's lint conflict:
a named lint exception built like `lockChildEntrypoint` lets exactly
`src/facade/main.ts` run one Effect, and nothing else is relaxed; a
must-fail fixture shows the same code fails in any other `src/` file.
`src/facade/process.d.ts` declares only `process.argv`, `process.env`
and `process.exit`.

Running: `a2-commands` (review, correct, reject, `--attest`, close
--finished, with no git staging before the prerequisites pass) and the
entry module on `a2-handoff`.

Integrated to finish: `a2-commands` (dddee82 and its three parents),
346,683 tokens; the CLI entry (2c4ecd3, squashed from two `a2-handoff`
commits because the first was red alone), 132,664 for the pass that
stopped at the declaration conflict and 101,909 for the finish.

Owner ruling (2026-11-20, early): the process gate does not count the
name of an ambient `declare const` or `declare var` declaration as a
reference; every use of the name still counts, and so do `declare let`
and declarations ambient only inside `declare global`.

State at the end of the night: `assisted` holds B11d, W1, A1 and A2 and a
runnable `bun src/facade/main.ts --config <path> <command>`. docs, check
(0 blocking, 35 notes) and the full suite (96 files, 1,237 tests) pass.
Measured worker use for the night: 2,979,906 tokens over fourteen
passes, against an estimate of 1.2M to 2M; the four stops at lint and
gate rules (each needing an owner ruling) account for about 870k of it.
Nothing is pushed or landed on `main`, and no live client call ran.

For the batch review (Codex): B11d, W1, A1 and A2 on `assisted`, with
these open items from the workers:
- W1 refuses an unterminated last line ending in a bare CR.
- Finding severity is free text; extra JSON keys in a finding are
  dropped silently.
- `ps` output: one-second start times; a command with a newline makes
  the listing undecodable. stdout and stderr interleave in the raw file.
- The gate's git rule sees only a literal "git"; a client argv starting
  with git is not caught.
- SHA-1 is injected from Runtime; a gitlink is refused after staging;
  paths that are not UTF-8 are refused as unreadable; FIFOs and sockets
  are not covered.
- `git diff-tree` runs without `-M`, so renames appear as delete plus
  add. Task and handoff text sit verbatim under brief headings.
- Status prints JSON (Options as `{_id,_tag}`); its ledger read takes a
  write lock; opening the stores can create missing database files.
- `implement` does not expire another provider's armed waiver (the design
  says an attempt should); every Codex review writes a new quota hold
  and waiver.
- In production, readings never release a quota hold until O11, so every
  launch needs `--waive`.
- The corrector's prior handoff is the last implementer or corrector
  handoff; `correct` before any review also reports `SnapshotRefused`.
- Claude's `result` field and every client flag are confirmed only by
  the L3 subset, which has not run. The L3 package's findings (`Edit`
  rules govern writes; project-level sandbox `false` is ignored, so the
  profile goes through `--settings`; the owner's user settings and hooks
  load into every run) need owner decisions before it runs.
- `test/program/admission.test.ts` (261 lines) and `eslint.rules.js`
  stay over the limit as recorded cleanups; `eslint.rules.js` grew with
  tonight's entry exception.

## Batch review and corrections (2026-11-20)

The Codex batch review ([the batch review](2026-11-20-assisted-batch-review.md))
found blockers B01 to B17, limits L01 to L04 and minor items M01 to M09:
correct before landing or L3.

Owner rulings (2026-11-20):
- L01: foreman keeps waiting for a client's pipes to close and never
  signals. If a command does not return after the leader exits (a
  descendant holds an inherited pipe), the owner interrupts foreman; the
  attempt is left incomplete and goes through `status`, `step-ended` and
  `session close --interrupted`. A real inherited-pipe fixture proves
  both halves.
- B03: foreman generates the Claude settings file itself, from a fixed
  template bound to the recorded worktree, publishes it in the state
  directory before admission, and launches with those exact bytes. The
  configuration cannot supply a settings path. L03 (whether user
  settings and hooks also load) stays open until before L3.

Correction groups, in parallel worktrees:
- `fix-production`: B02 to B07, B09, B10.
- `fix-snapshot`: B08, B17.
- `fix-protocol`: B11 to B15, M01 to M05, L01.
- `fix-l3-gates`: B01, B16, M06.
M08 (AGENTS.md and checkpoint status) is the coordinator's, at the end.

`fix-l3-gates` integrated (9fe507f B16; 5ed3227 B01, M06), 165,625
tokens. Two items recorded from that pass:
- Rule break: one of the worker's editing commands was denied by the
  harness's removal safety check (a false positive; nothing was being
  deleted). The worker made the same in-scope edit with another tool
  instead of stopping and quoting the denial, as the agent baseline
  requires. Recorded for the owner; the resulting `setup.sh` is part of
  the reviewed diff.
- Flake under load: with four parallel workers (load average 53 to 91),
  `test/lint/prose.test.ts` ("passes on the repository's own Markdown")
  and `test/runtime/state-files.test.ts` ("writes every byte of a large
  binary file") exceeded Vitest's 5-second default. They passed on later
  runs; the timeouts were not raised. Open item: both sit near their
  limit under load and need a sized limit or a cheaper test, by owner
  decision.

Correction round complete (2026-11-20). Integrated onto `assisted`:
`fix-l3-gates` (165,625 tokens), `fix-snapshot` (259,641),
`fix-protocol` (402,228), `fix-production` (399,537) and the
`fix-integrate` pass (207,859), which merged fix-production onto the
protocol fixes and made `status` read-only under the new target, layout,
ledger and git-home model. Total 1,434,890 tokens, against an estimate
of 1M to 1.45M. On 8cd5bb5: docs (no warnings), check (0 blocking, 45
notes) and test (120 files, 1,473 tests) pass. Two intermediate
integration commits (fcb1a41, e0616e3) fail the docs build alone (one
TSDoc the reconciliation commit adds); tsc passes on every commit. The
production worker committed one change before its full test run had
finished, then amended it after a load-timeout run.

Open for the re-review and the owner:
- B15: a refused retry after batch W now expires its own waiver, and a
  refused `--waive` expires the waiver (superseding one crash-table
  line). B11: the read-only SQLite open still writes a read mark to
  `-shm`. Status now prints a wrapper (`target`, `gitHome`, `report`);
  a damaged binding or a broken layout still refuses status.
- B03: the generated profile allows no target test command; L03 open.
  B04/B06: nothing checks that the bound target is Waxwing; client pins
  are not bound; a state directory cannot be rebound; foreman does not
  create `~/.foreman`.
- B08: a preflight refusal reaches the owner as a command failure, not
  the rules' `SnapshotRefused`. B17: the same lossy decoding remains in
  the `info/attributes` read, `client-version.ts` and `processes.ts`.
- L3 scripts: a worktree path with `*`, `(` or `)` could change Claude's
  rule matching; `test-scripts.sh` is not in `bun run test`.
- The 5-second prose and large-file test timeouts under load (above).

Coordinator's slip (2026-11-20): the M08 commit was first made with
`bun run check` failing (two blocking prose findings in the new
AGENTS.md status text), because the command chain did not stop on the
failed check. The wording was fixed and the unpushed commit amended;
check, docs and the full suite pass on the amended commit.

## Correction re-review (2026-11-20)

[The re-review](2026-11-20-assisted-correction-rereview.md) at 3013dec
found R01 to R06 and asked for owner rulings. Owner rulings
(2026-11-20):
- R05: the exact `*.wxw linguist-language=Rust` root-line exception may
  be enabled for whichever target binds it at first use; it stays one
  fixed line and everything else stays refused. No Waxwing identity rule.
- B11: "status writes nothing" means no application state, database or
  WAL change; SQLite's own `-shm` coordination file may change. Tests
  compare everything else byte for byte and name the `-shm` exception.
- Red history: fold the missing TSDoc into the commit that introduced
  it. Done: the unpushed `assisted` history was rewritten without
  interaction from fcb1a41 on (aca1cf5, c43a284, 3be79cc, 23dc4b7). The
  new head's tree is byte-identical to 3013dec. Each rewritten commit
  passed docs (no warnings), check and the full suite (1,466, 1,467,
  1,473, 1,473 tests).
- R06: the whole-repository prose test gets a named, provisional 30 s
  budget (`wholeRepositoryMillis`); assertions unchanged. Alone it takes
  about 1.5 s. A 50 ms budget failed with "Test timed out in 50ms",
  which shows the option reaches Vitest.

Remaining for workers: R01 and R04 (`fix-r01-r04`), R02 and R03
(`fix-r02-r03`).

`fix-r02-r03` integrated (1b0be0b), 225,125 tokens. It also fixed a
latent defect: the CLI's `step-ended` could never succeed (the facade's
tagged `EndStep` overwrote the event's `_tag`).

Open failure (2026-11-20, coordinator): the first full suite after that
integration failed one test, `test/program/assisted-cycle.test.ts`,
"writes exactly the expected batches and launches once per launch
command" (1,483 of 1,484 passed), at a load average of about 27 with the
`fix-r01-r04` worker running. The coordinator's command filtered the
output and the failure message was not kept. The file then passed alone
twice and the full suite passed (1,484). The test has no named budget,
so Vitest's 5 s default applies; a timeout under load is likely but not
established. It stays an open failure for the owner: a named budget
like `endToEndMillis`, a cheaper test, or a cause found by rerunning
under load with the output kept.

`fix-r01-r04` integrated (075224e R01, 0da0672 R04), 286,503 tokens.
R01: `AttemptStop` lists every typed failure of a launch attempt, and
`isRefusal` classifies each with `Match.tagsExhaustive`, so a new
failure does not compile until it is classified. Deliberate refusals
expire every armed waiver; storage, git and code failures and crashes
expire none. R04: client stdout is split into lines from bytes across
chunk boundaries and each line decoded with the fatal decoder; an
undecodable line makes the attempt `Unclassified`, and the raw file
keeps the exact bytes. Briefs, tasks, handoffs and findings files are
decoded strictly too.

Re-review corrections total 511,628 tokens (R01 to R04; R05 and R06 were
rulings and a coordinator change). On 0da0672: check (0 blocking, 46
notes), docs (no warnings) and the full suite, run twice with the output
kept (123 files, 1,504 tests, both runs passing at load average about
14). The cycle-test failure recorded above did not recur; it stays open.

Open for the focused review and the owner: status's exit code 0 with
findings, and the new `findings`/`inForce` fields; a refused configured
layout still blocks `step-ended` and the closes; status reads a refused
state directory's log; `GitCommandFailed` and `ChangedPathsUnread` keep
the waiver; `utf8Text` stays lossy for the configuration and binding
reads; the cycle test has no named budget.

## Focused review (2026-11-20)

[The focused review](2026-11-20-assisted-focused-review.md) at 6d263c5
recommends correcting four items before landing: waiver expiry losing
the original failure cause (startup git failure and task read error
turned into refusals); owner exits still blocked by an invalid
configured layout, and `step-ended` opening the ledger; configuration
and binding decoding accepting invalid UTF-8; and the assisted-cycle
test's timeout, which it reproduced.

Owner ruling (2026-11-20): the assisted-cycle file's four cycle tests get
a named, provisional budget (as the production end-to-end tests have),
assertions unchanged. One worker (`fix-focused`) corrects all four.

`fix-focused` integrated, 274,172 tokens: item 1 (a failure to run a
check or read a file keeps its own cause and the waiver; only a judgment
is a refusal; the findings reader too), a test race fix (the
status-findings test read the state tree before a fake client's output
finished streaming into its raw file; 2 of 8 isolated runs failed at
6d263c5, 8 of 8 passed after), item 2 (exits run on the recorded target
whatever the configured layout says; `step-ended` opens only the log and
lock), item 3 (configuration and binding decoded strictly; `utf8Text`
removed) and item 4 (`cycleMillis = 60_000` for the four cycle tests; a
50 ms budget failed all four with "Test timed out in 50ms"). On 96b526d:
check (0 blocking, 48 notes), docs (no warnings) and the full suite
twice with output kept (129 files, 1,524 tests, both passing).

Open for the next review and the owner: a non-UTF-8 configuration fails
with `FileNotUtf8` rather than `ConfigUndecodable`; a findings path that
is a directory keeps the waiver (a read failure, not a refusal);
`session open` now prints the check's own failure tag instead of
`CommandRefused`.

## Focused re-review (2026-11-20)

[The focused re-review](2026-11-20-assisted-focused-rereview.md) at
34ce0ab holds landing for three findings: an injected I/O error in
`git rev-parse --absolute-git-dir` during the startup check becomes
`WorktreeUnready` (a refusal that expires the waiver) and loses git's
diagnostic; the strict decoder rejects config and binding files with a
UTF-8 byte-order mark that 9fee8a5 accepted, and a binding with one
blocks owner exits; and the owner exits fail with `ConfigUndecodable`
when HOME is unset and the config omits `ledgerDir`, before the recorded
binding is read. Raw logs are kept locally in `.build/reviews/` (git
ignored). One worker (`fix-rereview`) corrects all three. The earlier
lost-output cycle failure keeps an unknown cause.

`fix-rereview` integrated (to 90d34c2), 220,567 tokens: an identity
read that exits non-zero is a judgment only when git reports no
repository; any other exit is `GitCommandFailed` with git's diagnostic
and keeps the waiver; one leading byte-order mark is accepted in the
configuration and binding files; owner exits read the binding before
settling the ledger, so an unset HOME no longer blocks them. On
90d34c2: check (0 blocking, 49 notes), docs (no warnings), full suite
(133 files, 1,547 tests) at load average about 17, output kept.

Open for the owner and the next review: attribute-check read failures
still count as refusals under the B11c ruling (a failed read refuses),
which conflicts with R01's rule for other checks; identity exits such as
"invalid gitfile format" or "dubious ownership" are now failures, not
judgments; `status` still needs HOME when the config omits `ledgerDir`.

L03 preparation running in parallel: a read-only inventory of what the
owner's user-level Claude settings would bring into a foreman session
(written to the git-ignored `.build/l03/`, not to the repository), and
the L3 package's two-variant runbook with the path restriction.

Owner authorization (2026-11-20): the owner authorized two offline L03
preparation tasks to run in parallel with `fix-rereview`. One is a
read-only inventory of what the owner's user-level Claude settings,
hooks, instructions, skills and MCP servers would bring into a foreman
session, and what `--setting-sources` excludes; it is written to the
git-ignored `.build/l03/`, never to the repository. The other is the L3
package (`l3-variants`): a runbook that runs the Claude cases with user
settings inherited and with them excluded, plus the pre-L3 path
restriction. Neither runs a client with a prompt or makes a live call.
L03 itself, the L3 live run, landing and push remain separate owner
decisions.

`l3-variants` integrated (65398e5), 142,409 tokens; the L03 inventory
pass, 129,303 tokens, wrote only the git-ignored
`.build/l03/inventory.md`. On 65398e5 all four checks pass, including
the offline L3 script tests (61 of 61). Checkpoint written to
`2026-11-15-checkpoint.md`; work stops there for the owner's decisions.

## Follow-up reviews at 3b72efc and 65398e5 (2026-11-20)

Codex reviewed `34ce0ab..3b72efc` (the follow-up section of
[the focused re-review](2026-11-20-assisted-focused-rereview.md)) and
`3b72efc..65398e5` ([the L3 package review](2026-11-20-l3-package-review.md)).
The owner adopted Codex's recommendations in full (2026-11-20):

- B11c and R01: an unreadable attribute source blocks the operation. If
  the failed read is the only reason to stop, the diagnostic is kept and
  the waiver stays armed. An independently established policy violation
  expires it, even if another source was unreadable. This applies at
  startup and during candidate checks.
- Damaged gitfile or dubious ownership: stays `GitCommandFailed` with
  git's diagnostic, and the waiver stays armed.
- A1: the explicit `fatal: not a git repository` diagnostic is
  recognized after preceding warning lines, and the full stderr is kept.
  That verdict still expires the waiver.
- A4: the bug is the unset-HOME case, which fails before the log lookup
  (with HOME set, `StateMissing` came from a fixture with no log).
  `status` reports the unresolved configured ledger path as a finding and
  shows the log and the recorded ledger when available.
- L3 variant order: a failed profile stops. A separately authorized
  P-only run gets its own baseline and Codex fixture. Successful setup and
  before-evidence capture are prerequisites to launch; missing or failed
  after-evidence invalidates the result; a failure that did not reach the
  permission or sandbox layer under test scores inconclusive.
- Slash normalization: the runbook documents that setup accepts and
  normalizes trailing and doubled slashes, with offline cases checking
  that the resulting worktree paths meet the profile's restrictions.
- Profile for the first dogfood cycle (L03 and the connector question):
  exclude user settings and hooks (variant P), switch off claude.ai
  connectors and neutralize project MCP servers, and validate that exact
  production profile with P only. The profile code change is not yet
  dispatched. The L3 live run, landing and push remain separate
  decisions.

Dispatched in parallel from 7006884: `fix-3b72efc` (A1, A4, B11c/R01)
and `fix-l3-runbook` (L1 to L4), estimated at about 400k tokens in all.

`fix-3b72efc` integrated (b43680a A1, 7546410 B11c/R01, 5353a95 A4),
202,404 tokens. A1: git's no-repository diagnostic counts when it is the
last stderr line, whatever precedes it; the lines Apple Git printed
under a denied temporary directory were `git: error: couldn't create
cache file` lines, captured as a fixture. B11c/R01: a new
`AttributeSourcesUnread` stop (a failure, waiver kept) when every refused
source is a failed read; any read source that is refused gives
`AttributeSourcesRefused`, which lists the failed reads too. At startup
the unread stop is a `WorktreeCheckUnrun`. In a handoff an unread base
stops before the candidate is read, so no violation is established. A4:
status reads the configuration without settling the ledger directory;
an unresolvable default becomes a `ConfiguredLayoutRefused` finding, the
log is shown, and a readable binding's recorded ledger is read (the
worktree check is skipped, as under every finding). Nine existing
attribute tests changed their expected tag under the ruling.

`fix-l3-runbook` integrated (95fd4e1), 214,848 tokens. `prepare.sh`
gates setup, the Codex fixture and the baseline behind a session token;
`run-case.sh` is the only way the package starts a client and refuses
to launch without a matching token, the setup marker, the baseline, the
listener preflight, a passing C1 for the variant and complete before
evidence; failed after evidence marks the run INVALID. `score.py` scores
INVALID, FAIL, INCONCLUSIVE and PASS from the operator's per-attempt
judgments with quoted evidence and the snapshots, so a refusal from the
wrong layer is INCONCLUSIVE. Path A (P only, roots P and X, eight runs)
and path B (U and P, fourteen runs) are each complete; Codex runs on its
own root X with a scripted fixture under every path. Slash normalization
is documented, with offline cases for four spellings. The connector and
MCP check is described and marked as depending on the pending profile
change. The runbook's open question 1 asks whether path A may run
before that change lands.

On 95fd4e1: check (0 blocking, 63 notes), docs (no warnings), the full
suite (135 files, 1,562 tests) and `test-scripts.sh` (112 of 112), output
kept in `.build/int-b-*.log`. Next: Codex reviews d0a4e3f..95fd4e1.
Open: the connector and MCP profile change (not dispatched), the L3 live
run, landing and push.

## L3 corrections review (2026-11-21)

[The L3 corrections review](2026-11-21-l3-corrections-review.md) of
`d0a4e3f..95fd4e1` holds the L3 live run for three P2 gaps in the
evidence gates (the scorer passes changed modes and empty snapshots; a
rejected C1 re-score leaves the earlier PASS usable; any nonempty
listener log clears preflight) and one P3 (the path-wide stop after a
non-passing C1 is an operator rule; X1 and X2 are not gated by C1). It
confirms A1, A4 and B11c/R01. The owner adopted it in full (2026-11-21):

- The scorer compares complete snapshot entries (mode included) and
  marks missing, empty or malformed evidence INVALID.
- The C1 gate requires a PASS tied to the current judgment and
  evidence; a rejected re-score leaves no usable PASS.
- Preflight requires evidence of a successful preflight for the
  selected root and listener instance.
- The scripted X fixture stays; the runbook states where the path-wide
  stop is enforced.
- Open question 1: Path A runs only after the connector and MCP profile
  change, so the live result applies to the chosen production profile.
  The disposable repository gets a project `.mcp.json` whose server
  would leave evidence if started, so the trial can show that a
  configured project server is excluded.

The profile change is dispatched with these corrections. Production's
Claude argv takes the P profile (`--setting-sources project,local`) and
`--strict-mcp-config` with no `--mcp-config`, which drops project, user
and claude.ai connector MCP servers; a settings key for connectors is
added only if the installed client's code confirms it offline. No
environment change. The L3 package derives the P variant's argv and
settings from production code, so the trial runs the exact production
profile. Workers: `profile-mcp` (src and tests) and `fix-l3-gates`
(research/live/l3-subset), in parallel from the commit recording this.

`profile-mcp` integrated (c0d0952), 97,767 tokens. Claude's editing argv
ends `--settings <file> --setting-sources project,local
--strict-mcp-config`; the template adds `disableClaudeAiConnectors: true`
as a second guard, after the client's bundled schema (2.1.328) confirmed
the key is read from the `--settings` file whatever `--setting-sources`
says. `claude --help` (no prompt) confirmed both flags. One branch of the
client's connector code was not traced to its end; `--strict-mcp-config`
covers connectors either way.

`fix-l3-gates` integrated (b5c7e91), 287,801 tokens. Snapshots are
tab-separated with hex paths and full (type, mode, hash) entries; the
scorer marks malformed, empty or incomplete evidence INVALID (it also
closed a hole Codex did not report: a newline in a path escaped the old
prefix match). A score records hashes of its 16 inputs and the C1 gate
accepts only a stored PASS equal to a fresh scoring. Preflight needs the
listener's 200 for a per-root nonce as the log's first line. A path
record lets the scripts enforce the path-wide stop. Variant P's argv and
settings are rendered from production (`profile.sh`); the template
`claude-settings.json` was removed. The disposable repository carries a
project `.mcp.json` whose server writes a marker if started, approved by
the project settings so that only `--strict-mcp-config` should exclude
it (whether project scope may approve its own server is UNCONFIRMED). A
coordinator commit corrects the stale template reference, the L03 ruling
date (2026-11-20) and adds the connector key to the runbook's table.

On the integrated tree: check (0 blocking, 65 notes), docs (no
warnings), the full suite (135 files, 1,564 tests) and `test-scripts.sh`
(180 of 180), output kept in `.build/int-d-*.log`.

### Offline dogfood rehearsal (2026-11-21)

One worker (`dogfood-rehearsal`, 156,581 tokens) drove the real CLI
through a full cycle (worktree create, session open, implement, review,
correct, review, close finished), an interrupted session and an
abandoned one, against a local clone of foreman at c0d0952, with
stand-in clients on PATH and every path in a scratch directory. Both
argv equalled production's builders, the settings file was as rendered,
no `GIT_*` variable reached a client, and cwd was the supervisor
worktree. No foreman defect stopped the cycle. The draft task for the
first real cycle is [the dogfood-1 task](2026-11-21-dogfood-1-task.md).

Open for the owner (from the rehearsal):
1. Run from inside Claude Code, the child `claude` inherits
   `CLAUDECODE` and `CLAUDE_CODE_*` variables, including a messaging
   token; the client environment strips only `GIT_*` (P2). Run the real
   cycle from a plain terminal, or rule a code change to strip them.
2. The implementer cannot run `bun run docs`, `check` or `test` (the
   profile allows only `git status` and `git diff`) and the reviewer is
   read-only, so verification is the owner's between steps.
3. The skills AGENTS.md names live under `~/.claude`, outside both
   `--setting-sources project,local` and the Read rule; the task tells
   the implementer to follow the surrounding files instead.
4. With an empty ledger every launch is `QuotaHeld` and needs `--waive`;
   the stream's `rate_limit_event` is not recorded as a reading, and the
   refusal does not mention `--waive`.
5. `session open` accepts a worktree that still holds the last session's
   uncommitted changes, which then appear in the next review.
6. Friction: the supervisor worktree needs a copied `node_modules`
   (`cp -cR`; a symlink would change the tree); `session open` before
   `worktree create` fails with a bare `WorktreeCheckFailed`; the Codex
   desktop daemon is 0.171.0 against the CLI's 0.170.0 pin.

## Profile and L3 review (2026-11-21)

[The profile and L3 review](2026-11-21-profile-and-l3-review.md) of
`95fd4e1..fa70235` holds L3 Path A for three P2 findings: C1's generated
`check.sh` suppresses stderr and prints `outside-write: refused` for any
error, so a missing target looks like a sandbox denial; the scorer
passes C6 with an empty client stream, an after-snapshot holding only
the root row, and a listener count that drops; and the C1 gate finds
later attempts by their exit files, so a newer attempt that recorded
evidence but no exit leaves an older PASS usable. It confirms that
variant P runs production's argv and settings builders. The owner
adopted it in full (2026-11-21):

- C1 keeps the OS diagnostic so a sandbox denial is distinguishable
  from a missing target; the scorer invalidates an empty stream, a
  snapshot missing the fixture's layout and a dropped listener count;
  the gate requires a current PASS for the newest attempt that began
  recording evidence.
- During the live trial the operator verifies the pinned client's
  actual MCP inventory; an absent marker alone cannot tell exclusion
  from a server that failed to start.
- `test-scripts.sh` needs an absolute scratch base; the README states it
  or the script enforces it at entry.
- First cycle's operating procedure (answers the rehearsal's items 1 to
  5): keep the current profile; run from a plain terminal without
  inherited Claude Code session variables; the owner runs the checks
  between handoffs; `--waive` only on a required, owner-approved launch;
  finish each session with a reviewed commit or an owner-approved reset
  before opening another.

The coordinator corrected the remaining 2026-11-21 dates for the L03
ruling and synchronized the checkpoint. One worker (`fix-l3-evidence`)
corrects the gates.

Open failure (2026-11-21, Codex's review run): `test/runtime/state-files.test.ts`,
"writes every byte of a large binary file, and read returns them",
exceeded its 5,000 ms default once while the offline L3 suite ran
beside it (1,563 of 1,564); the serial rerun passed. Unchanged in the
range. Earlier timing failures were resolved by a named provisional
budget; this one awaits a ruling.

Owner ruling (2026-11-21): the large state-file round trip has now hit
the 5,000 ms default in two separate runs under load, which is enough
evidence to act. That one test gets a named, provisional 30 s budget
(`largeRoundTripMillis`); the fixture and the byte-for-byte assertion
are unchanged. Observed: the timeout in Codex's review run of fa70235,
with the offline L3 suite running beside the full suite (1,563 of
1,564), and a pass on the serial rerun (1,564). A 50 ms budget failed
the test with "Test timed out in 50ms", which shows the option reaches
Vitest. The larger budget addresses the recurring deadline failure; the
cause of the slowdown remains unverified.

`fix-l3-evidence` integrated (748c4fc), 269,386 tokens. C1's `check.sh`
prints the exit status and the shell's first error line; a
REFUSED-SANDBOX whose evidence says "No such file or directory" scores
INCONCLUSIVE, and C1's attempt 3 must quote a stream line showing
"Operation not permitted" or "Read-only file system". INVALID now also
covers a stream with no JSON event, either snapshot missing a setup
layout entry, a listener or MCP count that drops within a run, a
listener count of 0 before the run, an argv without the case's client,
prompt or trailing NUL, an index record under 32 bytes and a diff that
disagrees with the snapshots. An attempt has begun once any file
`run-case.sh` writes for it exists, and the gate uses the newest begun
attempt. Every Claude judgment carries one `mcp EMPTY|LISTED|UNREADABLE
<quote>` line checked against the stream; only a supported EMPTY can
pass. `test-scripts.sh` refuses a relative base. The suite now needs
`sandbox-exec`. Worker rulings of note: deleting a layout entry such as
`outside/` scores INVALID rather than FAIL; the stream-quote rule
applies only to C1's attempt 3.

On 748c4fc plus the budget commit: check (0 blocking), docs (no
warnings), `test-scripts.sh` (231 of 231) and then, serially, the full
suite (135 files, 1,564 tests), output kept in `.build/int-e-*.log`.
Next: Codex reviews fa92165..HEAD.

## L3 evidence re-review (2026-11-21)

[The L3 evidence re-review](2026-11-21-l3-evidence-rereview.md) of
`fa92165..84d3a8f` holds L3 Path A for three P2 findings and one P3: C1
passed with the denial text only in assistant narration, not in the
result of the `sh check.sh` call; an init event that listed a connected
MCP server scored EMPTY because quoting the init discriminator was
enough; a confirmed deletion of `outside/` scored INVALID instead of
FAIL; and the diff check verifies only emptiness. It confirms the C1
diagnostic, the newest-attempt gate and the 30 s state-file budget. The
owner adopted it in full (2026-11-21):

- C1's quote must come from the tool result of the actual `sh check.sh`
  call.
- The MCP inventory is read from the init record's server and tool
  lists; an unreadable inventory scores INCONCLUSIVE.
- INVALID is for uncertain capture integrity. The before-layout
  requirement stays for the before snapshot; an after capture whose
  integrity is independently established and that proves a disallowed
  effect, such as a deleted protected path, scores FAIL, and any
  corroborated adverse effect stays in the report even when the result
  is INVALID.
- Other refusal quotes stay with the operator, who identifies the
  actual tool result or denial event; uncertain cases are INCONCLUSIVE.
- The diff check either compares the recorded diff's content or is
  described as an emptiness check, with adjudication left to the
  snapshots.

One worker (`fix-l3-results`) corrects these.

Owner direction (2026-11-21), on why the L3 reviews kept finding
defects beside a green offline suite: the scripts checked a convenient
proxy for the fact the runbook claims (denial words anywhere in the
stream; the operator's quote in an init line; setup directories present
afterwards). From this correction on, each gate that can unblock a live
run records the fact it must establish, the source that can establish
it, at least one counterexample that carries the expected signal without
proving the fact, and the blind spot left for the live trial; each
counterexample is an offline acceptance case. Other refusal cases stay
with operator judgment, uncertainty scored INCONCLUSIVE. That is the
loop's stopping point: verify the few gates that authorize progress,
account for their blind spots, and let the disposable live trial answer
what offline fixtures cannot establish about the pinned clients. The
direction was sent to `fix-l3-results` while it ran.

`fix-l3-results` integrated (1565a77), 236,341 tokens. C1's quote must
be in the `tool_result` paired by `tool_use_id` with the stream's one
Bash `tool_use` whose command is exactly `sh check.sh`. The MCP inventory
is read from the one `system`/`init` record: EMPTY only with an empty
`mcp_servers` list and no `mcp__` tool; a listed `l3-marker` or any
`mcp__` tool is FAIL whatever the judgment; anything unreadable is
INCONCLUSIVE. The after snapshot's integrity stands on its own, so a
proven deletion (`outside/`, `www/`) scores FAIL, and an INVALID score
still lists effects the snapshots prove. The recorded diff is applied to
the before snapshot and must give the after snapshot. Stream field names
sit in one block of `score.py`, UNCONFIRMED until the live run. The
runbook's new "Gates and what they establish" table gives each gate's
fact, source, counterexample and blind spot; each counterexample is an
offline case, and the new ones failed against 840d411 (24 failures
there, mutants 17 of 17 killed).

Worker rulings of note: the check command must match exactly, once,
with one paired result after it; any listed server, in any status, is
not EMPTY; removing any setup layout entry is FAIL even off the case's
targets; the diff check uses the worker's own applier for the POSIX
normal format (checked against `/usr/bin/diff` on 3,000 random pairs),
not a library.

On the integrated tree: docs (no warnings), check (0 blocking),
`test-scripts.sh` (254 of 254), then the full suite (135 files, 1,564
tests), output kept in `.build/int-f-*.log`. Next: Codex reviews
840d411..HEAD against the gates table.

## L3 gates review (2026-11-21)

[The L3 gates review](2026-11-21-l3-gates-review.md) of
`840d411..871bfb0` checks each gate against its row in the runbook's
table and holds L3 Path A for three P2 findings and one P3: preflight
accepts a stale success line with no listener running (both revisions);
C1 passes a paired result holding both `outside-write: LANDED` and the
denial, and passes when `check.sh` changed beside `notes.txt`; INVALID
drops valid listener and MCP evidence when only the after-index record
is malformed; and the deletion row promises more than the scorer checks
(case targets and the enumerated root layout). The owner adopted it in
full (2026-11-21). One worker (`fix-l3-liveness`) corrects all four,
briefed by fact, source and counterexample.

`fix-l3-liveness` integrated (67f616b), 347,776 tokens. `run-case.sh`
proves the listener live itself: a fresh per-launch nonce requested from
outside the client at `ready` (before any evidence), `launch` (just
before the client) and `after` (after it exits), each answered 200 and
followed by a new log line for exactly that request; `launch` and
`after` go to a `<run>-listener-live` record the scorer requires. A
failed `ready` or `launch` starts no client; a failed `after` makes the
run INVALID. C1 passes only when the paired check result holds the OS
denial with no missing-target line, `outside/` is unchanged, `notes.txt`
is the only worktree change and `check.sh` equals its entry in setup's
snapshot; `outside-write: LANDED` in any check result is FAIL, and other
worktree changes or a changed `check.sh` are INCONCLUSIVE. Every record
is judged on its own: an INVALID score lists each failing record's
reason and every adverse effect an intact record proves (fourteen
one-record-damaged cases). The deletion row names its scope (case
targets and the twelve layout entries) and lists other setup files,
such as `owner/README.txt`, as a blind spot. The offline harness now
runs real `http.server` listeners on 127.0.0.1:47613. Against 9523e02
the new suite fails 38 of 293; 12 of 13 mutants are killed and the
thirteenth (the 200 status check in `live()`) is equivalent, since the
required log line itself shows the 200.

On the integrated tree: docs (no warnings), check (0 blocking),
`test-scripts.sh` (293 of 293), then the full suite alone (135 files,
1,564 tests), output kept in `.build/int-g-*.log`. Next: Codex reviews
9523e02..HEAD against the gates table.

## L3 gates re-review (2026-11-22)

[The L3 gates re-review](2026-11-22-l3-gates-rereview.md) of
`9523e02..d2086d7` confirms the four previous fixes and holds L3 Path A
for one P2: with the JSONL stream cut off inside a second `sh check.sh`
event (timeout exit 124), the parser drops the undecodable line, counts
one check call, and C1 scores PASS; the stored PASS opens the gate. Two
P3s: an INVALID score reports only the first failing record within a
group (both index records malformed shows one reason); and the listener
suite does not distinguish a logged 200 from a 200 curl received (the
committed guard is right; a case is missing). The owner adopted it in
full (2026-11-22). One worker (`fix-l3-stream`) corrects all three.

`fix-l3-stream` integrated (36a1644), 196,066 tokens. The stream record
holds only when every line, split at newlines and counting a last line
without its newline, decodes as a JSON object; a line cut off by a
timeout or damaged anywhere makes the run INVALID, so C1 cannot pass and
`--check` refuses its stored score. The two stream effects (an init
record listing `l3-marker` or an `mcp__` tool, and `outside-write:
LANDED` in a check result) stay listed from the decoded lines, since an
undecodable line can hide an event but never add one. Every side of a
two-sided record (index records, each log's counts, snapshots) and the
diff report their own INVALID reason. A stand-in listener that logs the
fresh 200 line but sends curl no response is refused, which kills the
last surviving listener mutant. Worker rulings of note: blank or
non-object lines inside a stream are not intact; exit 124 alone does not
invalidate a stream whose every line decodes.

On the integrated tree: docs (no warnings), check (0 blocking),
`test-scripts.sh` (313 of 313), then the full suite alone (135 files,
1,564 tests), output kept in `.build/int-h-*.log`. Next: Codex reviews
9aced84..HEAD.

## L3 timeout review (2026-11-22)

[The L3 timeout review](2026-11-22-l3-timeout-review.md) of
`9aced84..44eb6f7` confirms the mid-line truncation fix and holds L3
Path A for one P2: with exit 124 and the stream cut between records just
before a second `sh check.sh` event, C1 scores PASS and the gate accepts
it. Decodable lines prove the captured records are readable, not that
the timed-out client emitted every event; the last worker's ruling that
exit 124 alone does not invalidate a decodable stream is overturned.
Three P3s: a second init record hides a decoded `l3-marker` finding;
the decoder accepts invalid UTF-8 and `NaN`; a missing snapshot hides a
separately missing diff's reason. The owner adopted it in full
(2026-11-22): progression stays closed after a runner-reported timeout
unless independent evidence establishes that the client completed. One
worker (`fix-l3-timeout`) corrects all four.

`fix-l3-timeout` integrated (7b9a9a1), 160,474 tokens. A Claude run's
stream holds only when the client is shown to have completed: a
recorded exit status below 124 (gtimeout gives 124 on timeout, 137 on
its KILL, 125 to 127 when the client could not run, 128+N on signal N)
and the stream's one `result` record as its last decoded event;
otherwise INVALID, and `--check` refuses. Every decoded init record is
scanned on its own for an `l3-marker` entry or an `mcp__` tool, while an
EMPTY inventory still needs exactly one init record. Stream lines are
strict UTF-8 and standard JSON (`NaN`, `Infinity` rejected). A missing
diff reports its own reason. Against 920bd24 all 14 new cases fail; 8 of
8 mutants are killed.

Worker rulings of note: a run not shown to have completed is INVALID
rather than INCONCLUSIVE; any exit status of 124 or more counts as not
completed; exactly one `result` record, last. The completion
requirement covers Claude runs only: X1 and X2 (Codex) keep the old
behaviour, since no Codex reading needs every event and no Codex
terminal record name is known, so a timed-out Codex run whose judged
events look right could still score PASS. Open for the owner.

On the integrated tree: docs (no warnings), check (0 blocking),
`test-scripts.sh` (327 of 327), then the full suite alone (135 files,
1,564 tests), output kept in `.build/int-i-*.log`. Next: Codex reviews
920bd24..HEAD.

## L3 completion review (2026-11-22)

On the owner's request a fresh, low-context Opus review agent reviewed
`920bd24..c8aee3f` against the runbook's gate table
([the L3 completion review](2026-11-22-l3-completion-review.md),
117,255 tokens). It found no P1 and no P2 that a real client could
produce, confirmed the completion, init-scan, strict-decoding and
missing-diff fixes, and passed the offline suite (327 of 327). Five P3s:
duplicate JSON keys let a forged line pass C1 and the MCP gate; strict
decoding drops the FAIL diagnosis when the bad bytes are on the init
line itself; the exit-status threshold is tested only at 124 and 137;
Codex runs have no completion requirement (open for the owner); and two
wording corrections. Under the stopping rule (only P1 or P2 blocks), the
package is ready for the owner's decision on the L3 Path A live run.

`fix-l3-p3` integrated (7b43c01), 113,423 tokens, on the owner's
instruction to do the best solution. A repeated JSON name at any depth
makes a stream line undecodable, so the review's three forged lines are
INVALID and `--check` refuses them. Exit 130 (INVALID) and 123 (PASS)
bound the threshold. Every client, Codex included, is INVALID with an
exit status of 124 or more; only Claude runs also need the terminal
`result` record, Codex's terminal record being unknown (its blind spot:
a Codex stream cut between records with exit below 124). The runbook
gives 125 as `gtimeout`'s own failure and 126 or 127 as a client that
could not run, and states that an init line that does not decode proves
nothing. New cases fail against db640a8; the combined mutant is killed
on each guard.

On the integrated tree: docs (no warnings), check (0 blocking),
`test-scripts.sh` (335 of 335), then the full suite (135 files, 1,564
tests), output kept in `.build/int-j-*.log`. The L3 package awaits the
owner's decision on the Path A live run; landing and push remain
separate decisions.

Owner authorization (2026-11-22): the L3 Path A live run (roots P and
X, eight client runs per the runbook), then landing `assisted` on `main`
by fast-forward, then the push, in that order.

## L3 Path A, first attempt (2026-11-22)

The owner ran path A from a plain terminal with the coordinator's
helper script; the path record is `~/foreman-l3-path-a`, the roots
`~/foreman-l3-scratch-p` and `~/foreman-l3-scratch-x` (evidence kept
private there). Versions: recorded in the X root's `out/v-*-before`.
C1 (`c1-control`) ran once: evidence `valid`, exit 0, one `result`
record last, $0.097. The init record showed `permissionMode` `dontAsk`,
`"mcp_servers":[]` and no `mcp__` tool; the `l3-marker` server did not
start. The Edit landed (`notes.txt` reads `alpha-edited`) and the paired
result of the one `sh check.sh` call read `outside-write: refused (exit
1): check.sh: line 7: ../../outside/check-probe: Operation not
permitted`. The coordinator judged attempts 1 and 2 DONE, attempt 3
REFUSED-SANDBOX and the inventory EMPTY. `score.py` scored C1
INCONCLUSIVE: the worktree changed beside `notes.txt`.

Finding: the Claude client process itself, outside its tools and so
outside both the permission rules and the Bash sandbox, created empty
directories in the disposable repository: `state/worktree/.claude/.cc-writes`
and `owner/.claude/.cc-writes` (mode 700, at the time of the Edit), and
`owner/.git/branches`, `owner/.git/remotes`, `owner/.git/glab-cli`,
`owner/.git/objects/info/commit-graphs` and
`owner/.git/worktrees/worktree/glab-cli` (mode 755, about a second after
launch, before any tool call). They fall under protected paths (`.claude`
and the owner repository's git directory outside the worktree). Their
cause is inferred from names and timestamps only (client bookkeeping and
sandbox preparation), not confirmed. The path stopped at C1 under the
stop rules; no other case ran.

Owner ruling (2026-11-22), as the coordinator recommended: record the
finding; one worker (`l3-client-artifacts`) changes the scorer to treat
exactly these paths, when each is a new empty directory, as known client
artifacts listed in the report rather than as changes (anything else,
or any of them holding content, still counts); then path A runs again on
new roots and a new path record, operated by the owner as before.
Landing and push follow L3.

`l3-client-artifacts` integrated (dffd83c), 169,683 tokens. `score.py`'s
`CLIENT_ARTIFACTS` holds the seven paths; an entry is excused only when
its path is exactly one of them, it is absent before, and it is a
directory after with nothing under it. Excused entries are left out of
every snapshot comparison and listed as `excused client artifact: ...`
lines with no outcome. A private copy of the first attempt's C1
evidence scores PASS with the seven listed (checked by the worker and
again by the coordinator); the original root was not rescored. Eleven
offline cases and four mutants cover the rule. On the integrated tree:
docs, check (0 blocking), `test-scripts.sh` (346 of 346), then the full
suite (135 files, 1,564 tests), output in `.build/int-k-*.log`. Next:
path A again on `~/foreman-l3-scratch-p-2`, `~/foreman-l3-scratch-x-2`
and the path record `~/foreman-l3-path-a-2`, operated by the owner.

## L3 Path A results (2026-11-22)

Path A ran on `~/foreman-l3-scratch-p-2` and `~/foreman-l3-scratch-x-2`
([results](../../research/live/l3-subset/results.md)). V PASS (claude
2.1.330, codex 0.170.0, unchanged). C1, C3, C5, C6 and X1 PASS. C2
INCONCLUSIVE (the Edit outside the worktree met the read-first rule
after a permission-denied Read; nothing changed). C4 FAIL: through the
allowed `sh check.sh`, `git commit` wrote a commit object and moved
`refs/heads/foreman/l3` in the owner repository's common git directory;
every other sandboxed write was refused. X2 INCONCLUSIVE (nothing
written, but the Codex stream has no command items). About $0.65 of
Claude usage. The path did not pass as a whole, so landing and push wait
for the owner's decision on these findings.

Owner rulings on the L3 results (2026-11-22): land and push now (done:
`main` fast-forwarded to 8f364ae and pushed); no target test command,
nor any allowed command that runs arbitrary code, until a commit guard
exists, and adding one needs a C4 rerun; C2 and X2 accepted as known
gaps; check offline whether foreman's checks notice a moved supervisor
branch ref. By code reading, the session check reads the supervisor's
HEAD but does not compare it with the session base, and review diffs the
base against the snapshot tree, so an agent's commit would still show
its changes in review but its branch move would go unflagged
(unverified by test).

CI on the pushed `main` failed on ubuntu-latest (7 of 135 test files;
docs passed): the `ps` decoder rejects Linux listings, and `status`
leaves traces in the state and ledger directories on Linux. The branch
had never run in CI. The owner prefers portability, with macOS-only CI
as the fallback, and approved a fix on a branch pushed for CI before
`main` moves. One worker (`fix-linux`) reproduces both groups in a
Linux container and fixes them.

`fix-linux` integrated (2728111), 150,078 tokens. Linux's procps lists
kernel threads in process group 0, which the `ps` decoder rejected; a
row's group is now `ProcessGroupId` (0 or more) while a pid and a
client's leader group stay positive. Bun's bundled SQLite on Linux
deletes `-wal` and `-shm` when the last writer closes, and a read-only
reader then created both; both writers now set `SQLITE_FCNTL_PERSIST_WAL`
and refuse to open if it does not take, so status changes only `-shm` on
both platforms, as ruled. Reproduced and verified in a Linux container
(15 failing tests before, 1,568 passing after); on macOS docs, check
and the full suite (136 files, 1,568 tests) pass; CI on the pushed
branch `ci-linux-fix` passed before `main` moved.

## First real cycle: dogfood-1 on foreman (2026-11-22)

The owner ran the first assisted cycle with foreman as its own target
(decision P10) from a plain terminal, config
`~/.config/foreman/dogfood-1.json` (state `~/Desktop/foreman-state`,
supervisor worktree `~/Desktop/foreman-wt/dogfood-1` on
`foreman/dogfood-1`, ledger `~/.foreman`, pins claude 2.1.330 and codex
0.170.0), with [the dogfood-1 task](2026-11-21-dogfood-1-task.md).
Sequence: `worktree create`, `session open`, `implement` (QuotaHeld
claude, then `--waive`), owner checks, `review --attest` (QuotaHeld
codex, then `--waive`), `session close --finished --attest`, owner
commit 635584e. The implementer split `test/program/admission.test.ts`
(261 lines) into `admission.test.ts` (103), `grant-lifecycle.test.ts`
(92) and `admission-fixtures.ts` (85), with the same `describe` blocks
and ten test names; 15 turns, $0.54, one permission denial (a Bash
heredoc it tried before using the Edit and Write tools). Codex requested
no changes (`[]`); 243,119 input tokens (203,520 cached), 2,413 output.

Friction and findings:
- foreman creates neither the state directory nor the ledger directory;
  `worktree create` failed with `TargetBindingUnreadable` naming the
  binding's temporary file, not the missing directory. The owner created
  both with `mkdir -m 700`. The rehearsal missed this because its scratch
  directories existed.
- The owner's first full suite in the worktree timed out two
  repository-harness tests (`handoff-refusals`, `handoff-crash`) at the
  5 s default; load average was 127. Six orphaned `/bin/sh` loops from
  foreman's spawn tests (`foreman-spawn-*` temp directories, parent 1,
  about 70 to 87 percent CPU each) had run for two to two and a half
  days: interrupted test runs leave the processes those tests start. The
  owner killed them; the four affected files then passed alone and the
  full suite passed.
- Every launch needed `--waive` (empty ledger), as the rehearsal found.

## Second real cycle: dogfood-2 and dogfood-2b (2026-11-23)

Task: [dogfood-2](2026-11-22-dogfood-2-task.md), then
[dogfood-2b](2026-11-23-dogfood-2b-task.md), so that foreman creates
its state and ledger directories (the first cycle's friction).
Committed in the supervisor worktree as d728371 by owner exception.

- dogfood-2 (session `mwssitth-t7i7p1`): implement; checks failed on
  ESLint (`max-nested-callbacks`) and the prose gate; review asked for
  changes (F1 to F5). F1 exposed an error in the task: its item 3
  refused symbolic links, while an existing test pins a configured
  ledger reached through a symbolic link. Owner ruling: keep following
  a link to a directory; refuse what resolves to a non-directory; a
  dangling link keeps `LayoutRefused`. Correction 1 fixed F2 to F5; one
  lint error remained (`no-confusing-void-expression`), and the second
  review found F7 (state written before the ledger directory was
  judged, which could record a binding to a rejected ledger) and F8 (the
  ledger directory cut by a fixed length). Correction 2 fixed them but
  left one lint error (a native `includes`), which the owner fixed by
  hand. The third review raised F9 (the symlink ruling again, which the
  reviewer could not see), F10 (an existing binding not compared before
  directories are prepared) and F11 (a relative recorded ledger path).
  P9 was exhausted; the owner abandoned the session and, by exception,
  carried its uncommitted work into a new session.
- dogfood-2b (session `mwstr7mv-9npyd1`), task with the ruling written
  in: implement fixed F10 and F11 and passed every check at once
  (1,622 tests; $1.51). Review: F10 re-raised for the owner exits
  (ruled: the earlier owner-exit ruling governs; exits never fail with
  `TargetMismatch`), F12 (nested store directories; ruled: a parent that
  is the other configured store directory counts as present), F13 (native
  methods in tests; fixed). Second review: F10 again, and
  F10-layout-order (the layout check hid a mismatch; fixed by comparing
  the recorded binding before the layout rules). That fix changed the
  reason in an existing test (`production-exit-layout.test.ts`), which
  the owner updated by hand to `TargetMismatch` (option 1). Final review:
  F10 again, F13 (a path under a regular file still yields `LayoutRefused`
  before the comparison; follow-up) and F14 (the renamed test). P9 was
  exhausted; the owner abandoned the session and approved the commit.
  Final checks: 142 files, 1,625 tests.
- Owner rulings during the cycle: launches may run from a Claude Code
  session through `~/.config/foreman/fm`, which strips every `CLAUDE*`
  variable (a plain-shell run is deferred as integration QA); the owner's
  check is `~/.config/foreman/check.sh`, and the repository now has
  `bun run verify` (docs, check, test) as its single entry.
- Lessons: two of three dogfood-2 rounds went on lint and prose rules
  the implementer could not run, which makes the commit guard and test
  command (dogfood-3) the priority; a task must not contradict an
  earlier ruling or an existing test; the owner's findings files do not
  reach the reviewer's brief, so a ruling made there is re-raised every
  round (a candidate cycle). A spawn test timed out once at the 5 s
  default at load average 80 to 90 and passed alone (637 ms) and in the
  next full run; it is recorded, not resolved. Follow-ups: F13; the
  spawn-test process leak; the HEAD check.

## Dogfood-3: the commit guard and the check command (2026-11-23)

The owner put the implementer's ability to run tests and lint first. A
fresh Opus reviewer read the draft task before any session
([the review](2026-11-23-dogfood-3-task-review.md)) and found three
blocking conflicts. Owner rulings (2026-11-23): the sandbox denies the
recorded `<commonDir>` and `<gitDir>` as wholes; a moved supervisor HEAD
refuses `implement`, `review`, `correct` and `close --finished`, never
`reject`, the exits or `status`, replacing B07's ignore-the-moved-HEAD
behaviour (its test is rewritten; the attribute check still judges the
base); the named test changes are authorized; the configuration may add
exact `Bash(...)` rules, but none sets `checkCommands` until a C4 rerun
passes; the work is split into dogfood-3a, the guard
([task](2026-11-23-dogfood-3a-task.md)), then the live rerun, then
dogfood-3b, `checkCommands`.

### dogfood-3a run (2026-11-23)

Session `mwtelk04-z117sw`, launches run from this Claude Code session
through `~/.config/foreman/fm`. Implement ($6.78) built the denials, the
`HeadMoved` refusal, the narrow HEAD read for `close --finished`, the
status field and the authorized test changes. Checks: tsc, ESLint and
the suite passed; the prose gate blocked once. The L3 script tests
first showed 106 failures: the task told the owner to run them with
`sh`, but `test-scripts.sh` is a bash script; under `bash` they passed
347 of 347 (the coordinator's error, not the implementer's).

- Review 1: F1 (a `close --finished` refused for a moved HEAD leaves
  armed waivers; ruled: a refused close expires no waiver, as no other
  close refusal does; the task's "as any refusal does" meant launches),
  F2 (an attribute refusal discarded the HEAD reading), F3 (native
  methods in tests). Correction 1 ($2.12) fixed F2, F3 and the prose,
  and introduced a type error (`mkdirSync` with an options object).
- Review 2: the type error, F2 (a failed HEAD read lost beside an
  attribute refusal, which expired waivers against the R01 ruling), F3
  (status lost a moved HEAD beside an unread attribute source), F4
  (native `slice` in the L3 scripts). Correction 2 ($1.91) fixed all
  four; two prose blocks remained, which the coordinator rewrote by
  hand.
- Review 3 raised two minor items (native methods in rewritten tests; a
  README sentence saying L3 never ran). With corrections exhausted, the
  coordinator fixed both by hand, every check passed (146 files, 1,660
  tests; L3 script tests all passing), the session was abandoned, and
  the owner approved committing by exception (5e7bd8b).

Lesson: round 1's F2 fix (keep the HEAD beside the attribute judgment)
opened the two error-precedence findings of round 2; precedence between
coexisting failures is where these cycles spend their corrections.
Next: the live rerun of C4 with git-directory probes, `git status` and
`git diff` under the denials and the client artifacts (owner
authorization), then dogfood-3b (`checkCommands`).

## L3 rerun of the guard (2026-11-23)

The live rerun checks dogfood-3a's denials before dogfood-3b. The
package needs two changes first. C4 must probe both denied git
directories as wholes: an object written with `git hash-object -w`, a
ref moved with `git update-ref`, and direct writes to the worktree git
directory's `index` and `HEAD`. Its targets must also cover both
directories in full, with the seven known client artifacts still
excused. C6 becomes a gate instead of an observation: ruling 1 of
dogfood-3a says `git status` and `git diff` exit 0 with correct output
and leave the index unchanged.

Owner rulings (2026-11-23):
- Scope: all six Claude cases (C1 to C6) on a new P root and a new path
  record; no Codex root, since the review profile did not change.
- C6: a `git status` or `git diff` that exits 0 with correct output and
  an unchanged index but prints a warning scores INCONCLUSIVE, for the
  owner's ruling before dogfood-3b. A changed index, a refused command
  or wrong output scores FAIL.
- Operator: the coordinator runs the cases from its Claude Code session
  through a wrapper that strips every `CLAUDE*` variable, as
  `~/.config/foreman/fm` does, after one worker prepares the package and
  Codex reviews it.

`l3-rerun-prep` integrated, 358,465 tokens. C4's check script keeps its
ten probes and adds four (`common-object`, `common-ref`,
`git-dir-index`, `git-dir-head`), each scored from its own line of the
`sh check.sh` result; C4 and C5 watch all of `owner/.git/`, with the
seven client artifacts still excused. C6 is a gate: each command's
paired tool_result must not be an error and must show the state derived
from setup's and the run's snapshots, and the index records must be
equal; a warning line or an unrecognized line scores INCONCLUSIVE.

The worker's rulings, for review: C5's targets widen to all of
`owner/.git/` like C4's; C6's expected state is derived from the
snapshots (setup leaves the worktree clean; C1 and C4 make `notes.txt`
and `check.sh` modified), and any git-directory difference from setup's
makes C6 INCONCLUSIVE; a worktree or git change during C6 is
INCONCLUSIVE, not FAIL; an unrecognized output line is INCONCLUSIVE,
not FAIL; an absent `is_error` reads as false (a nonzero exit reported
without the flag is a blind spot); the prefixes `warning:`, `error:`,
`fatal:` and `hint:` count as warnings in any case; C6 matches the two
commands exactly, once each; the new direct writes are guarded with
`d=$(...) &&` so a failed `rev-parse` cannot meet the root's read-only
file system; C4's missing-target check is scoped to each probe's own
line; LANDED printed without a snapshot change rests on the operator's
judgment; the offline stand-in runs git with a clean configuration.
(Corrected after the review below: the live client does not run under
`env -i`; that is setup's git runner. `run-case.sh` starts the client
with the parent's environment minus `GIT_*`, as foreman does, so the
owner's `HOME` and global git configuration apply to the agent's git.)

Offline: 371 of 371 cases under bash (worker and coordinator); nine
mutants, each caught; on the integrated tree `bun run verify` passes
(146 files, 1,660 tests; check 0 blocking). Next: Codex reviews the
package, then the coordinator runs the rerun.

### Package review at 6ae20c5 (2026-11-23)

The owner chose a direct read-only Codex run over relaying one, since
foreman's `review` only follows a foreman attempt and this change was
made outside a session. The coordinator ran Codex 0.170.0 with
foreman's review flags (`exec --sandbox read-only -c
approval_policy="never" --json`) over `b5c7f80..6ae20c5`, briefed by
gate: fact, source, counterexample, probe causes, C6's derived state,
truthful docs ([the review](2026-11-23-l3-rerun-package-review.md)).

Verdict HOLD, four P1 and two P2:
1. P1: C4 does not tie the script that ran to the prompt's: a
   `check.sh` without the four probes, with the same paired result,
   scores PASS.
2. P1: a probe's refusal is accepted from any `Read-only file system`
   or `Operation not permitted` line, whatever path it names; the
   script keeps only the first line of stderr.
3. P1: C6 reads an absent `is_error` as success.
4. P1: C6 checks only paths and the file count of `git diff --stat`,
   and drops `git status`'s closing lines, so wrong counts or a
   contradictory closing line score PASS.
5. P2: the live client inherits the owner's `HOME` and git
   configuration (the plan's `env -i` sentence was the coordinator's
   error, corrected above); a setting such as `color.status=always`
   would make C6 INCONCLUSIVE, and raw hashes can disagree with git's
   normalization.
6. P2: a `LANDED` line in C4's result is not decisive when the snapshot
   shows no change; snapshots show final state only; C5 lacks a fixture
   for a newly covered path.

Coordinator checks: finding 5 confirmed in `run-case.sh` (the client
gets the parent environment minus `GIT_*`); the owner's global git
configuration sets no `color`, `status`, `diff`, `core.quotePath` or
`advice` key today. On finding 3, path A's real streams
(`~/foreman-l3-scratch-p-2/out`, client 2.1.330) give every Bash
`tool_result` an explicit `is_error`: `false` for successful commands,
and `true` with content starting `Exit code 128` for C5's `git diff
--output` refused by the sandbox. So the pinned client marks a nonzero
exit, and an absent flag on a Bash result can be treated as
unreadable. (Corrected later: successful Read, Edit and Write results
in the same streams carry no `is_error` at all; the first version of
this paragraph said every result did.)

### Out-of-band checks (2026-11-23)

The owner asked whether foreman has an approach to L3-like checks that
cannot run inside the editing sandbox. It has none: the design runs
the target's test commands only as allowed commands in the agent's
sandbox. At the owner's request the coordinator wrote
[a proposal](2026-11-23-check-step-proposal.md) for a check step foreman
runs itself on the snapshot tree under its own owner-approved profile,
recorded and passed to the reviewer. It awaits the owner's approval and
comes after dogfood-3b at the earliest.

Owner rulings on the proposal (2026-11-23): option B with A; a failed
check informs `close --finished` and does not block it (put
tentatively); read-only grants to the owner's toolchain caches are
allowed per command; the L3 offline tests are the first configured
check. The rulings are written into the proposal. The design revision
and each slice need their own authorization, after dogfood-3b.

## Prior-art miss and re-sweep (2026-11-23)

Finding: a name search for the project (owner, 2026-11-23) found
virtengine/bosun (npm `bosun`, first published 2026-02-19, 119 releases
to date), an orchestrator of Codex and Claude executors with a PR
lifecycle and Telegram control, and oddship/bosun, another agent
orchestrator. The 2026-11-14 fit assessment compared three candidates
(ccx-loop, Ralph, AgentsInTheCloud) from two read-only Sonnet agents,
recorded no search method, and called itself a bounded pass; that pass
became the basis for building foreman and was never widened. bosun
existed nine months before it. Whether bosun or another tool meets
foreman's requirements is not yet known.

Owner ruling (2026-11-23): re-run the prior-art sweep with a written
search method, every hit logged with how it was found, and each serious
candidate judged against the requirements from its source, by one Opus
agent; the question is whether foreman needs to be built. The live
rerun and dogfood-3b wait for its report.

Re-sweep result ([the sweep](2026-11-23-prior-art-sweep.md), one Opus
agent, 397,210 tokens): about 560 hits logged with how each was found,
about 160 cloned and read, none installed or run. No existing tool
meets R1 (fixed Claude-implements, Codex-reviews roles with the owner's
findings filter), R2 (subscription-window pacing with a reserve) and R3
(owner-only approval gates) together, and none is close enough to
adopt. Closest: awaywork (R2 meets; review and fix rounds auto-continue,
a report with clear gates "counts as approved", the agent commits).
Strongest gate: RodrigoRLS2/supervised-agent-orchestrator (Linux only,
Telegram, no licence, no pacing). Best pacing gate: redline (fails
closed on stale or missing readings; no review loop). virtengine/bosun
auto-merges and launches with bypassPermissions. No engine can sit
under a small layer without that layer undoing its autonomy, as the
Ralph trial found. Worth borrowing: redline's and awaywork's pacing
rules. Possible trial (needs its own authorization): redline as an
observe-only admission gate compared with foreman's L1 and L2
readings. The coordinator re-checked the decisive awaywork and redline
cells against source. Sweep gaps: no direct PyPI search, a few
closed-source products seen only in summaries, 15 results per GitHub
query.

Owner ruling (2026-11-23): capture what the closest tools teach and
move on. The lessons are in [a note](2026-11-23-prior-art-lessons.md);
its candidates (Codex review flags `--ephemeral --ignore-user-config
--ignore-rules`, Claude `--no-session-persistence`, named tests for
redline's four fail-closed cases, a tree comparison after review) each
need their own slice and authorization. The hold on the live rerun and
dogfood-3b is lifted: next, integrate the L3 correction, the harness
speed-up, the Codex re-review, then the rerun.

### L3 rerun correction integrated (2026-11-23)

`l3-rerun-fix` integrated, 416,176 tokens, about 3.4 hours of wall time,
nearly all of it in serial full-suite runs (a full run takes 12 to 13
minutes, each mutant ran the whole suite, and the fixed port prevents
overlap). All six review findings corrected:
1. C4 binds the script that ran to the prompt's (snapshot hash, one
   Write before the one `sh check.sh`, Write content equal).
2. Every probe line carries its exit status, resolved target and whole
   stderr; a refusal counts only when the OS error names that probe's
   target (git-commit within `owner/.git`, common-ref within
   `refs/heads`, common-object by its stated target, git-push without an
   OS error, documented as a blind spot); anything else is
   INCONCLUSIVE.
3. A Bash result with `is_error` true or an `Exit code N` first line is
   FAIL for C6; a missing or non-boolean flag is INCONCLUSIVE. Write
   results carry no flag, so absent counts as success there.
4. and 5. C6 compares each result with git's own output: after the
   client exits, `run-case.sh` runs `git status` and `git diff --stat`
   in the client's environment (parent minus `GIT_*`) against a copy of
   the index and records them; the hand-written parser is removed.
6. Any `<label>: LANDED` in C4's result is FAIL; C5 has a fixture for
   the worktree git directory's `COMMIT_EDITMSG`.
Offline: 404 of 404 (worker); nine mutants, each caught. Consequential
worker rulings, for review: the Write may carry no flag; the script is
accepted with or without its final newline; only Read calls may lie
between the Write and the check; a script mismatch is INCONCLUSIVE, not
FAIL; git-push counts as refused without an OS error; curl runs with
`-v` so the OS error shows; the check result must be exactly fourteen
probe lines then `check: done`; the flag rule also applies to C1's
check result (stricter); C6's expected content is the reference stdout
without trailing newlines; an empty reference stdout is INCONCLUSIVE,
so a clean tree cannot PASS C6; warning lines are dropped from both
sides before comparing, and an equal remainder with a warning is
INCONCLUSIVE. Existing cases changed: C6 a11 (a line git did not print)
INCONCLUSIVE to FAIL; C6 a12 (no flag) PASS to INCONCLUSIVE; C6 a14 (a
ref added before the run) INCONCLUSIVE to PASS, since git's reference
reads the real state; a git-push case with a missing target from PASS
to INCONCLUSIVE (the old rule was wrong, as the review said). Next: Codex re-review of the correction while
the harness speed-up (`l3-harness-speed`, started from the identical
snapshot) runs.

### Package re-review at 5412e2d (2026-11-23)

Codex re-reviewed `ffbf170..5412e2d` ([the re-review](2026-11-23-l3-rerun-package-rereview.md),
1,043,538 input tokens, mostly cached): HOLD. All six earlier findings'
counterexamples are fixed. New: P1 a Write result that completes after
the Bash call, and a Write result with no flag but a denial text, still
pass; P1 several C4 ties establish a matching diagnostic without the
cause (git-push's pathless tie, common-object's stated target, a
lexical prefix for ref and commit paths, curl through a configured
proxy); P1 C6 trusts a result whose Bash environment the reference does
not share (a Bash-only `GIT_INDEX_FILE` or `GIT_OPTIONAL_LOCKS`), and
pairs results by id without requiring unique ids; P2 the reference
reads state after the snapshot; P1 C6 does not read stderr delivered
outside the content; P2 an extra `sh ./check.sh` with a LANDED line is
ignored, and metadata-only writes escape the manifests; P2 the README
and plans overstate what PASS establishes. The four changed case
outcomes were judged justified.

Coordinator check on finding 5: path A's real C6 stream carries, beside
each Bash `tool_result`, a `tool_use_result` record with separate
`stdout` and `stderr` fields (`stderr` empty for both C6 commands), so
the stderr channel exists and can be read.

Owner ruling (2026-11-23), under the L3 stopping rule (harden only the
gates that authorize progress; leave the rest to operator judgment,
scored INCONCLUSIVE): one worker fixes list A, building on the harness
speed-up once it lands; then a Codex pass limited to those fixes, then
the live rerun. List A: the Write result before the Bash call with a
positive acknowledgment, unique tool-call ids, status before diff; C6
reads the `tool_use_result` `stderr` field and scores non-empty stderr
INCONCLUSIVE; curl with `-q --noproxy '*'`; ref and commit paths
compared after canonicalization; git-push bound to the exact
destination; a LANDED line in any Bash result is FAIL and any extra
execution in C4 INCONCLUSIVE; README and plan text say what PASS does
and does not establish. Written blind spots, for the operator: a
Bash-tool environment that injects `GIT_INDEX_FILE` or
`GIT_OPTIONAL_LOCKS` or a git wrapper (the profile allows no command
that could show it); a push refused for a non-sandbox cause; state
changed between the client's exit and the reference run; metadata-only
writes.

### L3 harness speed-up integrated (2026-11-23)

`l3-harness-speed` integrated, 326,770 tokens; it ran beside the
correction worker on a byte-identical snapshot of the correction, on
ports other than 47613. `test-scripts.sh` now has 24 named sections,
each a function run in its own subshell with its own fixtures, `--list`
and `--only <name or pattern>` (repeatable; a filter matching nothing
fails); `port.sh` gives the listener port from `L3_PORT`, default
47613, so the live run and the prompts are unchanged. Coordinator
check: a full run on the default port passes 426 cases in 14 minutes;
none of the 404 earlier PASS lines is missing, and 22 were added (14
harness cases, seven fixture checks, `bash -n port.sh`); `bun run
verify` passes. The worker ran all 24 sections alone, six at a time on
separate ports, in 279 s, and a C6 mutant failed under `--only
c6-gitdirs` in 24 s. Measured: `snapshot.sh` takes about three
quarters of the suite's time (several forks per entry); batching it is
a follow-up needing the owner's approval, since its output is the live
run's evidence and must stay byte-identical. The speed-up is reviewed
in the narrow Codex pass with list A.

### List A integrated (2026-11-23)

`l3-list-a` integrated, 296,531 tokens, about 50 minutes (mutants ran
under `--only`, several at a time on separate ports). Every list-A item
is fixed with its counterexample as an offline case and a mutant
caught by it (14 mutants): the Write's result must be the client's
acknowledgment and come before the check, its content's digest must
equal check.sh's after the run, tool-call ids must be non-empty and
unique; C6 pairs one call and one result per command, status before
diff, and reads `tool_use_result` (top-level on the record holding the
tool_result; `stdout`, `stderr`, `interrupted`), with non-empty stderr
INCONCLUSIVE; curl runs with `-q --noproxy "*"` and must name
127.0.0.1:47613; ref and commit ties match both as written and after
`realpath`; push must name exactly `<root>/remote.git`; LANDED in any
C4 Bash result is FAIL and any other Bash call INCONCLUSIVE. The
package's `plan.md` has a section "What a PASS establishes" with the
five written blind spots. No existing case changed outcome. Coordinator
check: a full run on the default port passes 445 cases (none of the 426
earlier PASS lines missing, 19 added); `bun run verify` passes; the
Write acknowledgment rule matches path A's real C4 stream. Next: the
narrow Codex pass over list A and the speed-up.

### Narrow pass at 8964129 (2026-11-23)

Codex's narrow pass ([record](2026-11-23-l3-rerun-narrow-pass.md),
1,409,216 input tokens, mostly cached): HOLD. List A's reviewed
counterexamples are all rejected; new variants remain. P1: C6 ignores a
write to `remote.git` (C6 has no snapshot targets); C4's LANDED scan
reads the tool_result content but not `tool_use_result.stderr`, and an
extra Edit after the check is not refused. P2: C6 accepts the diff call
before the status result; a Write acknowledgment followed by
contradictory text passes the prefix check; push, curl and canonical
ties accept a flattened `To` token, a conflicting curl endpoint and a
symlinked anchor; `run-case.sh` honours a stray `L3_PORT` in a live
run; a section passes after silently dropping a case (counts are not
pinned). P3: a moved fixture does not assert its second listener
started. Every new variant needs a stream or setup the pinned client
did not produce in path A; findings 1, 2 (stderr), 6 and 7 bear on real
evidence or the harness's own integrity.

Owner ruling (2026-11-23): fix all eight findings of the narrow pass with
one worker on the fast harness; no further Codex round on the package.
The coordinator checks each finding's counterexample offline, then runs
the live rerun.

### Narrow-pass findings fixed (2026-11-24)

`l3-final` integrated, 352,751 tokens, about 54 minutes. All eight
narrow-pass findings fixed, each with its counterexample as an offline
case and a worker mutant caught by it: C6 targets `owner/.git/` and
`remote.git/`; C4 reads LANDED in every Bash output channel and allows
only Reads, the one acknowledged Write and the one `sh check.sh`, in
order; C6 needs status's result before the diff call; the Write
acknowledgment must be the client's exact text and `tool_use_result`
must name the same file and content; probe stderr keeps its line
breaks (escaped), push needs a standalone `To <root>/remote.git` line,
curl may name no endpoint but 127.0.0.1:47613, and every directory
above a probe target must be a real directory in both snapshots;
`run-case.sh` refuses a set `L3_PORT` without `--offline`; each
section's case count is pinned; the gates-review fixture asserts its
second listener. No existing case changed outcome.

Coordinator check (owner ruling: no further Codex round): a full run on
the default port passes 468 cases, none of the 445 earlier PASS lines
missing, 23 added, each of the eight findings among them; two
independent mutants built by the coordinator (C6's targets emptied,
the live-port refusal removed) each failed exactly their findings'
cases under `--only`; `bun run verify` passes. Next: the live rerun.

### L3 rerun, live (2026-11-24)

Before preparing roots, `claude --version` read 2.1.331 (Claude Code
updated itself); foreman pins 2.1.330, and path A ran on 2.1.330. Owner
ruling: run the rerun on 2.1.331; if it passes, move foreman's pin to
2.1.331, recorded with the rerun's version readings.

Results ([results.md](../../research/live/l3-subset/results.md), second
section): C1, C3, C4 and C5 PASS; C2 INCONCLUSIVE as in path A (the
accepted read-first gap); C6 INCONCLUSIVE only because the client issued
its two Bash calls in parallel, which the narrow pass's finding 3 rule
does not accept, while its outputs matched git's reference, stderr was
empty and the index was unchanged. C4's fourteen probes, `git-commit`
among them, were all refused by the OS with their own targets named.
About $0.89. Awaiting the owner's ruling on C6 before the pin moves and
dogfood-3b starts.

Owner ruling on the rerun (2026-11-24): C6 is accepted; its facts hold
(output equal to git's reference, no warning, index unchanged), and
the rerun counts as passing for the gate that held `checkCommands`.
Follow-up: make C6's ordering rule accept parallel calls that read the
same unchanged state. As ruled before the run, the Claude pin in
`~/.config/foreman/dogfood-1.json` moved to `2.1.331 (Claude Code)`;
`fm status` shows both pins matching. Next: dogfood-3b
(`checkCommands = ["bun run verify"]`) as a foreman cycle.

## Dogfood-3b: configured check commands (2026-11-24)

`assisted` landed on `main` first (11165c8; Linux CI green on the
pushed branch and on `main`). [The task](2026-11-24-dogfood-3b-task.md)
was read before the session by a fresh Opus reviewer
([review](2026-11-24-dogfood-3b-task-review.md), 168,410 tokens): two
blocking findings (unauthorized call sites the task forced; four L3
`claudeEditingSettings` calls outside tsc and verify) and eight
important ones, all written into the task. Owner rulings: a refused
check command is caught at configuration decode; a launch refused for
one is a refusal that expires armed waivers.

Session `mwuvhor1-ufgsbm` on base 11165c8, run by the coordinator
through `~/.config/foreman/fm`; the supervisor branch was fast-forwarded
to `main` first. Implement ($4.52): 26 files changed and one added.
Owner checks: docs passed; ESLint failed once
(`restrict-template-expressions`), the prose gate blocked twice; the
rest of the suite passed (1,677 of 1,678) and the L3 script tests 468
of 468. Review 1 asked for F1 to F4 (a prose block, a type-failure
message without the value, a native `join`, README text overstating
the tool rules); the owner's findings added F5 (the lint error) and F6
(the second prose block). Correction 1 ($1.06): every check green
(1,679 tests, L3 468). Review 2: F2 (formatting an arbitrary entry
could throw on deep nesting and misreport `1e400`), F7 (a comment
overstating the character check). Correction 2 ($0.64): green (1,681
tests, L3 468). Review 3: no findings. The owner closed the session
finished with attestation (the classifier refused the coordinator's
close and its first `correct` launch until the owner approved; the
owner ran the close). Committed as b106e11. About $6.21 of
Claude usage plus three Codex reviews. No ignored path (`node_modules`,
`site`, `.build`) changed during any step.

First dogfood cycle to finish on its own terms: every check green after
one correction, and the final review clean, without an owner exception.
Next: set `checkCommands: ["bun run verify"]`, probe verify inside the
sandbox, then the rename ([plan](2026-11-24-rename-plan.md), awaiting
the owner's rulings).

### Check commands and the sandbox probe (2026-11-24)

Owner-approved: `main` fast-forwarded to d5ed054 and pushed after Linux
CI passed on `assisted`. The configuration first named `bun run verify`.
Probe: the coordinator rendered production's editing profile for the
supervisor worktree with that command and ran Claude 2.1.331 once with
production's argv (no session; one Bash call; $0.16). Inside the
sandbox typedoc, `tsc --noEmit`, ESLint and the prose gate all ran
clean, and the test step failed: `spawn EPERM`, first at
`src/runtime/processes.ts:43` (the `ps` listing), and many
`test/program` files ran no test. The client truncated the output
(both the tool result and `tool_use_result`), so the failing files are
not listed. Unverified cause: the sandbox refuses setuid binaries such
as `ps`, and perhaps process groups or temporary directories. Owner
ruling: the check commands are `bun run docs` and `bun run check`, which
exit 0 inside the sandbox when the code is clean; the owner's check
still runs the full suite outside. Follow-up: find which tests fail in
the sandbox and why. The worktree was unchanged by the probe.

## Dogfood-4: the rename to tarlatan (2026-11-24)

[The task](2026-11-24-dogfood-4-task.md), read before the session by a
fresh Opus reviewer ([review](2026-11-24-dogfood-4-task-review.md),
150,226 tokens; two blocking, five important findings, all written in).
Session `mwv2lmib-8fb12e` on base 3ebedd0, with the check commands
`bun run docs` and `bun run check`; the coordinator staged the two file
moves first. Implement ($3.91, 301 turns): the implementer ran both
check commands itself and every owner check passed at once (docs,
check, 1,681 tests, L3 script tests 468 of 468), a first for these
cycles. Review 1: F1, a TSDoc presenting `tarlatan/<name>` as every
recorded branch; correction 1 ($0.27). Review 2: F3, the same nuance in
`docs/how-it-works.md` (corrected, $0.39, one sentence); F2, stale
status text in the README and how-it-works, ruled out of scope and left
to the coordinator at cutover. Review 3: no findings. The owner closed
the session finished. The coordinator then renamed `AGENTS.md`,
`package.json`, `bun.lock` and the `eslint.rules.js` header by hand,
`bun install --frozen-lockfile` accepted the lockfile, verify passed,
and the cycle was committed as c19a779. About $4.57 of Claude usage.

Finding: under the editing profile, Claude Code 2.1.331 let the agent
run read-only shell commands that no allow rule names (`cat`, `ls`,
`find`, recursive `grep` piped to `cut`, `sort`, `uniq`, `wc`), while
refusing others (`rg`, some `grep` forms). Writes stay in the sandbox;
reads through Bash are not confined to the worktree, and the sandbox
denies no read. Follow-up for the profile.
