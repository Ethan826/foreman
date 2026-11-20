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
  requested, `--attest` is given, and the snapshot still equals the
  reviewed one.
- Every close runs the settle step and appends `WaiverExpired` for an
  armed waiver. It releases no hold, deletes no file and changes no
  grant except through settlement.

`status` never takes the lock and never writes. It shows the session
state, every incomplete attempt with its grant, holds, armed waivers, the
pin check, the worktree check, report integrity and the advisory process
evidence.

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
