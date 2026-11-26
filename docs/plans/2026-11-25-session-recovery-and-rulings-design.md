# Session recovery and owner rulings (design for v0.2.0)

Status: approved by the owner (2026-11-25). Approach 1 chosen
by the owner on 2026-11-25.

## Intent

A session today ends badly in three ways when the work itself is fine,
and each costs a new session, an implement launch, or a commit outside
the loop:

1. An interrupted step cannot run again. After `step-ended` the only
   exit is `session close --interrupted` (Waxwing-1: the owner stopped a
   review that was flooding the coordinator's context; a second session
   and an implement launch followed).
2. A ruling made after the task was drafted reaches only the corrector,
   through the findings file. The reviewer never sees it and raises the
   settled point again (waxwing-1b; durable-effect de-1; dogfood-5,
   whose third review asked for a mutation run the coordinator had
   already done).
3. The owner cannot overrule a finding or grant more rounds. Only a
   review with no findings allows `close --finished`, and a session
   allows two corrections. Overruled findings and the limit forced
   `--abandoned` plus a commit by exception in dogfood-2, dogfood-3a,
   waxwing-1b and de-1, and a second session in dogfood-5.

This design gives the owner logged commands for each, so the loop can
run to a review with no findings inside one session, with every owner
decision in the project log where `status`, the briefs and a later
reader can see it.

## Goals

- G1. Rulings: the owner records a ruling at any point between steps;
  every later brief (implement, review, correct) carries every ruling
  of the session, each with a stable id.
- G2. Overrule: the owner overrules a finding of the review awaiting
  handoff with a reason. The reason is a ruling, so later reviewers see it.
- G3. Rounds: the owner grants more corrections within the session
  (owner ruling of 2026-11-25, which reopens ruling 1 of 2026-11-14).
- G4. Retry: after `step-ended`, the owner re-runs the ended step on the
  tree it started from.
- G5. Back-up: the owner returns the session to the point just after
  any earlier usable step on its current line (below), worktree and
  state together.
- G6. Every new command is an owner command: logged before it takes
  effect, refused with a reason when the session state does not allow
  it, and visible in `status`.

## Non-goals

- The run loop (B12 to B18): nothing here launches a step on its own.
- Changing what a finding is or how a reviewer reports one.
- Editing or deleting a ruling. A ruling is superseded by a later ruling
  that says so; the log stays append-only.
- Pre-session task review as a `tl` command (`tl task review`) and
  rulings parsed from the task file. Both stay on the roadmap item
  "Task review and structured rulings"; this design covers its
  mid-session half only. Task-file rulings keep reaching every brief
  through the task text, as now.

## Anti-goals

- A model approves anything: no override, grant, retry or back-up is
  taken by an agent. The briefs tell agents about rulings; agents cannot
  make them.
- A finding disappears silently: an overruled finding stays in the log
  with its reason.
- Back-up loses work outside its scope: it never touches ignored files,
  the git directory, files outside the worktree, or commits.
- A restore that half-worked is reported as done.

## Constraints

- Decision-core layering (AGENTS.md): events and states in Domain, the
  fold and command rules in Features, git in Runtime, wiring in Program.
- Closed vocabularies: new event and state tags are `Schema.TaggedClass`
  names, not string vocabularies; any new string vocabulary goes into
  `closedNames` with its fixture.
- Formats: new events change the project log's contents. A v0.1.x
  release folding a log with an event it does not know fails to decode
  it. So the project log's format becomes version 2, and v0.1.1 then
  refuses such a log with `StoreVersionNewer` instead of failing on the
  decode. The ledger does not change and stays at 1. Today one constant,
  `knownStoreVersion` (`src/domain/store-version.ts:17`), versions both
  stores, and a writer stamps only an unstamped store; v0.2.0 gives each
  store its own known version (ledger 1, log 2) and adds one raise rule:
  a log at 1 is raised to 2 in the same transaction that first appends
  an event v0.1.1 would not decode to the same meaning. Existing event
  shapes therefore do not change: the start and end snapshots are a new
  event, `SnapshotKept { sessionId, opId, end, tree, ref }`, and
  `SnapshotTaken` keeps today's meaning (a review's tree). Since
  `session open` under v0.2.0 appends `SnapshotKept`, the raise happens
  at the first session opened by v0.2.0; until then the owner can still
  run v0.1.1 on that log. The decision in `src/domain/store-version.ts`
  changes with this, on purpose: today any positive version other than
  the known one is `StoreNewer`, and the stamp writes the known version
  (`src/runtime/sqlite.ts:319`). v0.2.0 adds a fifth outcome,
  `StoreOlderReadable` (a version from 1 up to, not including, the known
  one, which this release reads and may raise), stamps an unstamped log
  1 (its format), never the known version, and creates a new log at 1;
  only the raise rule writes 2. The docstring's "only an unstamped
  store is ever stamped" becomes "a store is stamped when unstamped and
  raised only by its first changed event". v0.1.1 cannot read the log concurrently and
  miss the raise: the project lock admits one command at a time, and
  v0.1.1's `status` re-reads the version in each snapshot. (Versioning: a minor release with an explicit
  refusal.)
- A session opened under v0.1.x has no kept snapshots and no recorded
  findings: `retry`, `back-up` and `overrule` are refused for it with a
  reason that says to close it first; `ruling add` and `rounds grant`
  work.
- The assisted rung's quiescence holds: every new command runs only
  when no attempt is incomplete, except `retry`, which runs only in
  `Interrupted`, where the owner has attested the attempt ended. The
  assisted rung has no protected digest; its stand-in is the owner's
  `--attest` (quiescence and inspection, `src/domain/session.ts:56-68`),
  which `retry` and `back-up` require, since both delete worktree files.

## Approaches

1. **Owner commands as logged events (chosen).** New owner events in
   the project log; the fold derives rulings, overruled findings, the
   correction limit and the attempt each step starts from; briefs render
   the rulings; snapshots are kept by ref so a back-up can restore them.
2. **A rulings file and a configured limit.** Cheaper, but no record of
   which rulings a reviewer saw, the limit changes behaviour through
   configuration (AGENTS.md: "never select behavior with a flag"), and
   intent is not recorded before the effect. Rejected.
3. **Approach 1 without retry and back-up.** Smaller; leaves item 1 of
   the intent unsolved. Rejected by the owner in favour of 1.

## Commands and events

Each command appends its event only after the command rules allow it,
in the same transaction as the read that decided it (the log's
conditional append, as every owner command does today).

| Command | Event | Allowed in | Effect |
|---|---|---|---|
| `ruling add --text <t> [--supersedes <id>]` | `RulingAdded { rulingId, text, supersedes? }` | any open state with no incomplete attempt | ids are `R1`, `R2`, ... in session order; carried in every later brief |
| `overrule <findingId> --note <reason>` | `FindingOverruled { reviewOpId, findingId, rulingId, note }` | `AwaitingHandoff` for a review that asked for changes (`ChangesRequested`) whose recorded findings include `findingId` | also adds ruling `Rn` whose text quotes the finding and the reason |
| `rounds grant <n> --note <reason>` | `RoundsGranted { count, note }` | any open state with no incomplete attempt | the session's correction limit becomes `maxCorrections` plus every grant |
| `retry --note <reason> --attest` | `RetryRequested { endedOpId, tree }`, then `StepRetried` or `RetryIncomplete { paths }` | `Interrupted` | worktree restored to the ended attempt's start tree; the session returns to the state before that attempt |
| `back-up <target> [--keep-count] --note <reason> --attest` | `BackUpRequested { target, tree, keepCount }`, then `BackedUp` or `BackUpIncomplete { paths }` | any open state with no incomplete attempt; `target` is a usable finished attempt on the session's current line, or `open` | worktree restored to the target's end tree; the session returns to `AwaitingHandoff` for that attempt, or to `OpenNoAttempt` for `open` |
| (the review step itself) | `FindingsRecorded { reviewOpId, findings }` | appended with the `Finished` of a usable review (`Success` or `ChangesRequested`); a findings block that repeats an id makes the outcome `Unclassified` and records nothing | each finding's id, severity, file and summary, decoded from the reviewer's block; the log, not a file, is what the rules read |

Ids: a finding id is the id the reviewer gave it in its JSON block
(`F1`, ...), qualified by its review's opId, since ids repeat across
reviews. Today the findings live only in the reviewer's last-message
file (`ChangesRequested` has no fields, `src/domain/outcomes.ts:13-16`),
so the review step now also appends `FindingsRecorded`: the fold and
the command rules decide `overrule` and the close from the log alone,
and the overrule ruling quotes the finding from it.

### Closing after overrules

`session close --finished` is allowed when the attempt awaiting
handoff is a usable review and either it succeeded (no findings, as
today) or it asked for changes and every one of its recorded findings
has been overruled. An unusable review (crashed, out of turns,
unclassified) never allows it. The overrule itself is the owner's decision on the finding;
a further review is optional. The owner may instead run `review` again
on the same tree (allowed after an overrule, see below), and that
review's brief carries the overrule rulings.

`review` after an overrule: today `review` needs a usable implement or
correct awaiting handoff. It is also allowed after a review that asked
for changes when at least one of its findings is overruled and the
tree is the reviewed tree (the `ReviewChecked` comparison). That gives
the "additional review rounds" the owner asked for without a
correction in between. These reviews are not limited: each is the
owner's launch, and the correction limit counts corrections only.

### The correction limit

`maxCorrections` (2) stays the default. The command rules compare the
session's corrections with `maxCorrections + Σ RoundsGranted.count`.
When a review asks for changes at the limit, the session stays in
`AwaitingHandoff` as today; `correct` is refused with
`CorrectionsExhausted`, which now names `rounds grant` in its message,
and `session close --unconverged` (a new `CloseKinds` value,
`unconverged`, the design's `notConverged`; added to `closedNames` with
its fixture) closes it with that outcome instead of `--abandoned`. It is
allowed only when the attempt awaiting handoff is a review that asked
for changes, not every one of its findings is overruled, and the
corrections counted (below) have reached the limit.

## Briefs

`src/format/brief.ts` gains one section, "Owner rulings", in every
brief (implement, review, correct), placed after the task. It lists
every ruling of the session in order: id, text, and, when it supersedes
one, which. Superseded rulings are shown struck as "superseded by Rn".
For an overrule ruling the text names the review and the finding. The
review brief tells the reviewer that a ruling settles its point: a
finding that contradicts a ruling must cite the ruling and say why the
ruling does not cover the case, or be left out. The brief's hash
(`BriefRecorded`) therefore covers the rulings each agent saw.

## Retry and back-up

### The session's line

Each attempt's parent is the session's position when it was launched:
the attempt awaiting handoff then, or `open` for the first. The
position is the last finished attempt, except that `StepRetried` puts
it back where the withdrawn attempt started and `BackedUp` moves it to
the target. The current line is the chain of parents from the position
back to `open`. Attempts off the current line are superseded; a
withdrawn attempt is on no line.

- **Targets.** `back-up` accepts only a usable finished attempt on the
  current line, or `open`. A superseded attempt is not a target, so
  the owner cannot return to a superseded line and its corrections
  (review finding 2).
- **Corrections counted** toward the limit: the corrections on the
  current line, plus every correction superseded by a `BackedUp` whose
  `keepCount` was set. Whether a correction stays counted is decided
  by the first `BackedUp` that supersedes it; later back-ups do not
  change it (finding 3).
- **Reviewed tree.** After `BackedUp`, `reviewedTree` is the tree handed
  to the nearest review at or before the target on the line (its
  `HandoffApproved` to the reviewer), and none for `open` or a target
  with no review before it (finding 1). `correct`, `close --finished`
  and review after an overrule compare against that tree.
- **Round numbers** in briefs count the corrections counted, as above,
  so after a refund a round number can repeat; each brief's hash
  still tells the briefs apart (finding 13).

### What is kept

Today only `review` takes a snapshot, for the edit it reviews
(`src/program/review.ts:101`), and its tree is an unreferenced git
object that `git gc` may prune. Every attempt now takes two snapshots:
one when it starts (in the batch that appends `Intended`) and one when
it finishes (in the batch that appends `Finished`; for a review the two
are equal, since it runs read-only). `session open` takes one more, the
tree the session starts from (dogfood-5b opened on a dirty worktree, so
the base revision alone is not that tree). Each is kept as a commit
(`git commit-tree <tree> -p <base>`, message naming the session, opId
and end) on a ref written by `update-ref` with the old value required
absent, before the log batch that records it (so a recorded tree is
always referenced; a crash between the two leaves an orphan ref, which
`status` lists by scanning `refs/tarlatan/<sessionId>/` and the next
snapshot of that opId never needs, since the opId is not reused): `refs/tarlatan/<sessionId>/open`,
`refs/tarlatan/<sessionId>/<opId>/start` and `.../<opId>/end`. Every
launch has a fresh opId, including a retried step and a second review,
so no ref is written twice. The event records the tree and which
end it is, as `SnapshotKept` (see Constraints). Refs are removed when the session closes `finished`; on
other closes they stay, so the work is findable, and `status` lists
them.

### Retry

`retry` is allowed only in `Interrupted`, where every incomplete
attempt has the owner's `StepEndedByOwner`; that attestation, with the
command's `--attest`, stands in for the quiescence check. The ended
attempt's grant is already charged by `step-ended`. The worktree may
hold the ended step's partial edits, so `retry` restores the ended
attempt's start tree: it appends `RetryRequested { endedOpId, tree }`,
runs the restore below, and appends `StepRetried` when the restore is
complete or `RetryIncomplete { paths }` when it is not; then the
session stays `Interrupted` and the owner fixes the paths and runs
`retry` again. A crash after `RetryRequested` is redone from the
restore, and `StepRetried` is appended then. `StepRetried` makes the
fold treat the ended attempt as withdrawn: the state becomes what it
was before its `Intended` (the previous `AwaitingHandoff`, or
`OpenNoAttempt`), with `reviewedTree` given by the line rule above. A
waiver the ended attempt used is not re-armed: its grant was charged,
and under a quota hold the retried launch needs a new `waive`. A
`back-up` is refused in `Interrupted` (an incomplete attempt exists);
to reach an earlier point the owner runs `retry`, then `back-up`, or
closes `--interrupted`. The fold counts corrections by `Intended` today
(`src/features/session.ts:149-157`); it now skips withdrawn attempts,
so a correction that was ended and retried counts once.

### Back-up

`back-up <opId>` restores the worktree to that attempt's end tree and
returns the session to `AwaitingHandoff` for that attempt, as if the
later attempts had not happened; `back-up open` restores the session's
open tree and returns to `OpenNoAttempt`. Backing up to a review
restores the tree it was given and puts its findings back in front of
the owner. The later attempts stay in the log, marked superseded by the
`BackedUp` event, and their grants stay charged. Corrections among them
are refunded by default: the limit counts only corrections that are not
superseded (owner ruling 2026-11-25). `back-up --keep-count` instead
keeps them counted; the choice is recorded in the event
(`BackUpRequested.keepCount`), so it is the owner's decision as data in
the log, not a configured behaviour. Rulings and
overrules made after the target stay in force, since they are the
owner's, not the agents'. A rejection is the owner's decision about one
attempt: `BackedUp` clears any rejection, whether of a later attempt
(now superseded) or of the target itself, and a back-up is how the
owner recovers from a `reject`.

While a back-up or retry is requested and not complete (no result yet,
or `BackUpIncomplete`, `RetryIncomplete` or `RestoreUnverified` last),
the session is held: every launch and handoff is refused. Only these
run: `status`; the same command again, which must name the recorded
request's target and `keepCount` (another target is refused) and
repeats step 1's pre-checks and `--attest` before redoing steps 3 and
4; and a close: `--abandoned` while a back-up is held, `--interrupted`
while a retry is held (the session is still `Interrupted`, where
`--abandoned` is refused) (findings 4 and 6).

### The restore

Back-up and retry restore a snapshot tree of uncommitted work onto the
supervisor worktree, with HEAD left at the session's base. The
procedure follows the design's `restore` for a drift hold, with a tree
as the target:

1. Check quiescence (for `back-up`, no incomplete attempt; for
   `retry`, the `Interrupted` state) and require the owner's `--attest`.
   Then refuse, touching nothing, when either pre-check finds a path
   (the refusal lists them; the owner moves them and runs the command
   again):
   - **Ignore rules differ.** Any `.gitignore` file differs between a
     fresh snapshot of the worktree and the target tree (present in one
     and not the other, or a different blob). Under different rules,
     `git clean -fd` judges "ignored" by the target's rules and deletes
     a file the current rules ignore (oracle, below).
   - **Ignore sources outside the tree differ.** The digest of
     `.git/info/exclude` is recorded with each `SnapshotKept`; the
     restore refuses when the current digest differs from the target's.
     It also refuses when any `.gitignore` in the worktree is itself
     ignored, since such a file is in no snapshot and the first check
     cannot see it. (Production git has a private `HOME`, so no global
     excludes file applies.)
   - **An ignored file collides.** An ignored file in the worktree
     (`git ls-files --others --ignored --exclude-standard`) whose own
     path is in the target, or one of whose ancestor paths is a
     non-directory entry of the target. `git read-tree --reset -u`
     removes such a file without aborting ("updates leading to loss of
     working tree changes or untracked files or directories will not
     abort", git-read-tree(1)).
2. Append the request event, `BackUpRequested` or `RetryRequested`
   (intent before effect).
3. In the supervisor worktree, with the pinned git: `git read-tree
   --reset -u <tree>` (worktree files of the tree written, tracked
   files not in it removed), then `git clean -fd` (untracked files not
   in the tree removed; ignored files kept), then `git read-tree HEAD`
   so the index again matches HEAD and the restored changes show as
   unstaged, as they were.
   A git command in this step that fails (for example `git clean`
   cannot remove a file in a read-only directory) does not end the
   procedure: step 4 still runs, and the failure's message goes into the
   result.
4. Take a fresh snapshot. Equal to `tree`: append `BackedUp` (or
   `StepRetried`). Not equal: append `BackUpIncomplete { paths }` (or
   `RetryIncomplete`), the differing paths; the session is held (above),
   and `status` lists the paths. If the fresh snapshot cannot be taken
   (a raw-check refusal, a special file, an unreadable file), append
   `RestoreUnverified { reason }`: the session is held the same way,
   since nothing shows the tree is right. The owner fixes them and runs the
   command again. A nested repository, which `git clean -fd` leaves,
   makes the snapshot preflight refuse before it builds a tree
   (`src/program/snapshot.ts`); its refusal's paths are reported the
   same way.
5. A crash between 2 and 4 leaves a requested back-up or retry with no
   result; the session is held, and running the same command again
   redoes it from step 3 (the design's at-least-once redo of requests).
   Steps 3 and 4 are idempotent: run on any intermediate worktree they
   reach the same tree or the same incomplete paths. `status` never
   redoes anything.

## Status

`status` gains, for an open session: the rulings (id, text,
superseded), the overruled findings with their rulings, the correction
limit and corrections used, a pending or incomplete back-up with its
paths, and the kept snapshot refs.

## Provenance

| Component | Source | Fidelity |
|---|---|---|
| Owner decisions as appended events, state by fold | The design's event log and fold (revision 6.1), event sourcing | Faithful |
| Conditional append that decides and records in one transaction | The project log's `append(expected, ...)` | Faithful |
| Snapshot kept as a commit on a private ref | `git stash` (worktree state as a commit on `refs/stash`), `git commit-tree`, `git update-ref` | Adapted: a ref per snapshot under `refs/tarlatan/`, parent the session base |
| Restore of a tree onto the worktree | `git read-tree --reset -u`, `git clean -fd`, the design's drift `restore` and `RestoreIncomplete` | Adapted: the target is a tree, not a commit; the index is reset to HEAD afterwards |
| Intent before effect, redo after a crash | The design's requests performed by the lock holder | Faithful |
| Correction limit as default plus grants | None found | Invented, trivial: a sum. Flagged |
| Rulings in briefs, superseding by later ruling | Architecture decision records (Nygard): append-only decisions, superseded rather than edited | Adapted |
| Overrule recorded with a reason, finding kept | pr-cockpit's per-finding ticking (prior-art lessons, "Approval, holds and recovery") | Adapted: a logged event with a reason, not a UI tick |

The prior-art lessons' "Approval, holds and recovery" rows apply: an
unknown outcome holds for a human (back-up incomplete stays put);
intent is recorded before the effect; an approval is void when its
tree changes (a back-up changes the tree, so the next review reviews
the restored tree). The counterexamples apply too: no auto-continue
after review rounds (a grant is the owner's), no approval by a model.

## Tests the builder must provide (facts, not mechanisms)

| Fact | Counterexample that must not pass |
|---|---|
| A back-up refunds superseded corrections, and with `--keep-count` keeps them. | A back-up past no correction, which cannot tell the two apart. |
| A superseded attempt is refused as a back-up target. | A test that backs up only along one line. |
| After a back-up to a review, `correct` runs against that review's tree. | A back-up to the latest review, where the old and new reviewed trees coincide. |
| A held retry can close `--interrupted`, and a held back-up `--abandoned`. | A held state whose restore completes on the rerun. |
| A ruling reaches every later brief of every role. | A test of the review brief only. |
| A brief's hash changes when a ruling is added. | Comparing brief text without the recorded hash. |
| `close --finished` is allowed exactly when every finding of the last review is overruled. | A test with one finding, which cannot tell "every" from "any". |
| A grant raises the limit by its count and only within its session. | A test that grants and corrects once, which passes with an unlimited counter. |
| Retry restores the tree the ended attempt started from, and the retried correction counts once. | Checking state only, without the worktree's tree. |
| Back-up restores the snapshot tree exactly, keeps ignored files, and leaves HEAD and the base unchanged. | A restore checked only by `git status` (index flags hide edits). |
| A back-up that cannot remove a path reports it and moves nothing in the session. | A test whose every path is removable. |
| A crash after `BackUpRequested` is redone, not lost or doubled. | No crash injected. |
| v0.1.1 refuses a v0.2.0 log with `StoreVersionNewer`, not a decode error. | A log at version 2 with only old events, which v0.1.1 would also decode. |
| A v0.1.1 log at 1 opens under v0.2.0 as `StoreOlderReadable`, a v0.1.0 log at 0 is stamped 1 (not 2), and a new log is created at 1. | A test of a new log only. |
| A restore whose fresh snapshot is refused appends `RestoreUnverified` and holds. | A restore whose snapshot always succeeds. |
| A log stays at 1 until the first new event kind, and is raised to 2 in that event's transaction. | Checking the version only after a new event, which an open-time raise also passes. |
| Every attempt has a start and an end ref, and none is written twice across retry and a second review. | A session with one implement and one review only. |
| A held back-up refuses every launch and handoff. | Testing only `review`. |
| `overrule` is decided from `FindingsRecorded` in the log. | Reading the reviewer's file in the test. |

## Left to the builder

- Command spelling within the CLI's conventions, and the exact texts of
  refusals.
- Where each fold rule lives in Features, within the layering.
- The order of sections in `status`.

## Calls made by the coordinator after the builder check

A fresh builder read the first draft against the code (2026-11-25).
These answers to its questions are the coordinator's calls, each the
stricter option or the one that keeps the fold reading the log alone:
findings recorded in the log (`FindingsRecorded`); two snapshots per
attempt, kept by ref, so every finished attempt and `open` is a back-up
target and no ref repeats; `retry` and `back-up` require `--attest` (no
protected digest exists on the assisted rung); a requested or
incomplete restore holds the session; a back-up supersedes a later
rejection; `close --unconverged` only at the limit; one known version
per store, the log raised to 2 by its first new event kind; sessions
opened under v0.1.x refuse `retry`, `back-up` and `overrule`.

## Adversarial review

### Claims ledger

| Claim | Backing |
|---|---|
| C1. The restore reproduces the target tree exactly on covered files, or refuses, or reports the differing paths. | Oracle (below); builder's tests (exactness, incomplete) |
| C2. The restore never deletes an ignored file. | Oracle, after the pre-checks were added; builder's test of each pre-check |
| C3. The restore never moves HEAD or the base. | Oracle; `read-tree` and `clean` move no ref (argument) |
| C4. An interrupted restore is redone to the same result. | Argument: steps 3 and 4 depend only on the target and the worktree, and end in the target or a report; builder's crash test |
| C5. After `StepRetried` the session state equals the state before the withdrawn attempt's `Intended`, except `reviewedTree` (line rule) and armed waivers (not re-armed). | Second review (no break found beyond finding 9, folded in); builder's fold property test |
| C6. After `BackedUp` the state is `AwaitingHandoff` for the target (or `OpenNoAttempt`), with rulings, overrules and grants kept, rejections cleared, `reviewedTree` by the line rule, and corrections counted by the line rule. | Second review (findings 1 to 3, folded in); builder's fold property test |
| C7. No ref is written twice. | Argument: refs are keyed by unique opIds, `update-ref` requires the old value absent; builder's test across retry and a second review |
| C8. v0.1.1 never misreads a v0.2.0 log. | Argument: version 2 is stamped in the transaction of the first changed event; v0.1.1 refuses version 2 at open and per snapshot (v0.1.1 tests); the project lock |

### Restrictions

| Restriction | Why believed harmless | Challenge example |
|---|---|---|
| Restore refuses when any `.gitignore` differs between the worktree and the target | Attempts rarely change ignore rules; the owner can move the file | An attempt adds `build/` to `.gitignore` and the owner backs up past it: refused until the owner restores `.gitignore` by hand |
| Restore resets the worktree's index to HEAD | Agents cannot stage (only `git status` and `git diff`) | The owner had staged a change in the supervisor worktree: the staging is lost, the content is restored |
| Ignored files and empty directories are outside every snapshot | They are outside today's review coverage too | An attempt's ignored build output survives a back-up and changes what the next check runs on |
| A session opened under v0.1.x gets no retry, back-up or overrule | Such sessions end within a day | The owner upgrades mid-session and must close first |
| Case-only differences are invisible on a case-insensitive filesystem | The snapshot has the same blind spot today (`core.ignorecase`), so a review cannot see them either | The target has `Readme.md`, the worktree `README.md`: the restore reports exact and the disk keeps `README.md` (coordinator's case 4) |
| One incomplete attempt at a time (assisted rung) | The CLI launches one step at a time | None on this rung; the run loop (B12 to B18) must revisit C5 |

### Oracle

Grammar, fixed before the first run: paths `a`, `b`, `d/x`, `d/y`, `e`
(a file, or a directory holding `e/z`), ignored `k.log` and `d/k.log`;
each plain path absent, a file with content v1 or v2, an executable
file, or a symbolic link. Each trial: a random base commit, a random
state S1 snapshotted as T1 (temporary index, `add -A`, `write-tree`),
a random state S2, the restore of T1, a fresh snapshot. Scripts in
`research/v0.2.0-restore-oracle/`.

- Run 1 (grammar v1, 300 trials): exact 300, no ignored file lost,
  HEAD never moved.
- Grammar v2, changed after run 1: adds an ignored `e/k.log` and a
  `.gitignore` of `*.log` or `*.log` plus `b`. Run 2 (600 trials):
  exact 600, but ignored files lost. Two classes: an ignored file in a
  directory the target has as a file (removed by `read-tree --reset -u`),
  and a file ignored by the current rules but not by the target's
  (removed by `clean -fd`, which runs under the target's rules).
- A clean-first order (`clean -fd` before `read-tree`) was tried and
  rejected: it lost exactness in cases the original order handled.
- With both pre-checks (grammar v2, 1,200 trials, seeds 3 and 4): exact
  549, refused 651, no mismatch, no ignored file lost. 434 refusals
  would not have lost a file: the `.gitignore` rule is conservative.

Targeted cases (`restore_cases.py`, run by the coordinator after the
independent review): a mode-only change, a symbolic link in the target
where the worktree has a directory, and a directory in the target where
the worktree has a symbolic link to a directory outside it (the outside
files kept) all restored exactly. A nested `.gitignore` added after the
target and an `.git/info/exclude` change both gave a reported mismatch,
not a loss, and the pre-checks now refuse them first. A case-only
rename restored "exactly" by snapshot while the disk kept the other
case (restrictions table). An unremovable untracked file made
`git clean` fail; step 3 now continues to step 4, which reports it.

Bounds: six paths, one directory level of conflict, no nested
repositories, no case-only renames (the default macOS filesystem is
case-insensitive; untested), no file-mode change without content
change. The evidence is bounded and not a proof.

### Findings of the independent review (2026-11-25)

A fresh adversarial reviewer read the design and the code (it stopped
early; see the plan's record). Its findings and what became of them:

- F1, confirmed: the store version decision had no outcome for an
  older readable version, and the stamp wrote the known version, so
  every v0.1.1 log would have been refused or stamped 2 at once. The
  Constraints now define `StoreOlderReadable` and the stamp rules.
  Closed by the builder's test rows on the raise.
- S1, suspected: the fresh snapshot after a restore can be refused (for
  example `core.autocrlf` in the repository's config makes checkout
  write CRLF that the raw check refuses). Step 4 now has a third
  result, `RestoreUnverified`, which holds the session. A startup
  refusal of `core.autocrlf`, `core.eol` and filter configuration, as
  B11c does for attribute sources, is a follow-up for the plan.
- S2, suspected: ignore sources outside the tree (`.git/info/exclude`,
  a self-ignored `.gitignore`) could make a restore report incomplete
  for ever. The pre-check now covers both.
- S3, suspected: the ref and the event live in different stores. The
  ref is now written before the batch that records it.

### Findings of the second review, the fold rules (2026-11-25)

A fresh reviewer read the session rules against the fold, read-only.
Confirmed and folded in: (1) a back-up to a review left `reviewedTree`
at a later review's tree; (2) "superseded" was undefined, so backing up
onto a superseded attempt refunded corrections without a grant; (3)
mixed `--keep-count` across two back-ups was ambiguous; (4) a held
retry had no close; (5) the close after overrules admitted an unusable
review; (6) a rerun while held was undefined and skipped the
pre-checks; (7) `--unconverged` named "the last review" ambiguously;
(8) the goals and the table disagreed on targets. Suspicions folded in
as stated rules: (9) waivers are not re-armed by retry; (10) back-up is
refused in `Interrupted`; (11) duplicate finding ids are `Unclassified`;
(12) reviews after an overrule are unlimited; (13) round numbers count
the line; (14) G2 names the awaited review. Checked with no break:
back-up from `Rejected` to the rejected attempt, back-up across a
grant, retry after a back-up, the order of `FindingsRecorded` and
`Finished`.

### Open items

- C5 and C6 rest on argument until the builder's fold property tests
  exist; they are the plan's first tests.
- Case-only renames on a case-insensitive filesystem are untested.
- The fold claims rest on argument and two readings until the builder's
  property tests exist; they are the plan's first tests, with
  generated event sequences checked against a reference model of the
  line.

## Owner rulings on the open questions (2026-11-25)

1. `close --finished` is allowed once every finding of the last review
   is overruled, with no further review.
2. Corrections superseded by a back-up are refunded by default;
   `--keep-count` keeps them counted.
