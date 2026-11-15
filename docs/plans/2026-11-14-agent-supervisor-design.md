# Agent supervisor: short design

2026-11-14. Status: DRAFT (revision 4), awaiting final review. Revision 1
was rejected by adversarial review (see "Review 2026-11-14" at the end).
Revision 2 was approved with nine required fixes by a second review (see
"Re-review 2026-11-14 (revision 2)", with the table of how revision 3
answers each fix). Revision 3.1 (2026-11-15) applies the owner ruling
that agents run in a supervisor-owned linked worktree (see "Owner ruling
2026-11-15" near the end; the new rules are under "Supervisor worktree"). Revision 4
(2026-11-15) designs the owner rulings on a shared usage ledger,
scheduling and durable workflows (last section): new sections "Usage
ledger", "Stages, review queue and scheduler", "Pre-approved backlog",
"Role-swap suggestions" and "Durable layer", model check M4, and edits
to the scope, holds, launch attempt, claims, restrictions, provenance,
live tests and open items.
No repository, dependency install, build, live model call or message send
is approved.
Decision record: [standalone direction](2026-11-14-agent-supervisor-decision.md).
Ledger IDs S1-S12 refer to that record; first-review finding IDs (S1-S7,
D1-D4, P1-P6) are prefixed "R-" below to keep the two apart.

## Scope

One supervisor process per target repository on the user's Mac drives
that repository through tranches; the processes for different
repositories share one usage ledger (see "Usage ledger"). A tranche is a unit of work the user names, written as
a task file in the target repository. Inside a tranche the cycle is:

1. Claude implements (fresh `claude -p` process).
2. Codex reviews (fresh `codex exec`, read-only sandbox).
3. If the review asks for changes, Claude corrects, then Codex reviews
   again, at most `maxCorrectionRounds` times (default 2).
4. The tranche ends in an approval hold: after a passing review, after
   abandonment, or when a review still asks for changes after
   `maxCorrectionRounds` corrections (recorded as `notConverged`; ruling
   1, 2026-11-14: no extra rounds). Nothing further runs until the user
   approves, unless the next tranche was approved ahead of time (see
   "Pre-approved backlog").

Which client fills each role (implementer, reviewer, corrector) is
configuration, decided by the user on 2026-11-14; Claude implements and
corrects and Codex reviews by default. Pacing, permissions and output
decoding are chosen per client, so each client needs both an
editing profile and a read-only profile. The reviewer must still be a
separate fresh process from the implementer; configuring the same client
for both roles is allowed.

Every step runs in the supervisor's own linked worktree of the target
repository, on the supervisor's branch, never in the owner's checkout
(owner ruling 2026-11-15; see "Supervisor worktree"). Below, "the tree",
"HEAD" and "the recorded revision" mean that worktree and branch unless
the owner's checkout is named.

In each project one operation runs at a time, and one `run` instance at
a time (see "Single instance"); projects run in parallel and meet only
in the ledger. No parallel graph, web UI, multi-user service or
phone channel in the first version.

## Research results used here

Two read-only agents read vendor docs and the installed `--help` output
on 2026-11-14. The coordinator checked the quotes marked (checked)
against the fetched pages. The client versions they saw disagree (see
"Pinned client versions").

| ID | Result | Evidence |
|---|---|---|
| E1 | Using the unmodified Claude Code binary with one's own subscription login is permitted; Anthropic restricts third-party products that offer or route Claude.ai login, including Agent SDK products. | code.claude.com/docs/en/legal-and-compliance (checked). Personal-automation wording is not explicit; OpenAI's terms were not read. |
| E2 | Claude has no documented usage read that is guaranteed not to start a model turn. Statusline input carries `rate_limits.five_hour` and `seven_day` (`used_percentage`, `resets_at`) after responses; stream-json carries `rate_limit_event`. | statusline doc (fields checked); agent SDK TypeScript reference. |
| E3 | `/usage` sent as a prompt returns a structured `usage_report` (experimental shape) only with a login carrying profile scope; a `setup-token` credential does not qualify by default. Whether it spends allowance is undocumented. | agent SDK TypeScript reference (checked). |
| E4 | Codex app-server documents `account/rateLimits/read` (used percent, window length, reset time) as an account method separate from turns. Not run. | learn.chatgpt.com/docs/app-server (method checked). |
| E5 | Claude `-p` defaults to manual mode, denying unapproved actions; `dontAsk`, `--permission-prompts none`, allow/deny rules and an OS sandbox with `failIfUnavailable` are documented. Codex documents `--sandbox read-only / workspace-write` and approval policy `never`. | permission-modes and sandboxing docs (checked); Codex approvals doc. |
| E6 | Exit codes do not distinguish rate-limit exhaustion on either CLI. Classification must use result subtype, error fields and rate-limit events. | headless doc; Codex non-interactive doc. |
| E7 | Git runs repository-configured programs even with hooks and fsmonitor disabled: a clean filter during `git status` and `git add`, and `gpg.program` during `git commit --no-verify`. A clean environment with `GIT_ATTR_SOURCE` set to the empty tree, `commit.gpgsign=false` and `core.fsmonitor=false` stopped all of them except a filter declared in `.git/info/attributes`. | Probes on git 2.50.1 (Apple Git-155), 2026-11-14, in a scratch repository; listed under "Git probes". |

## Architecture (S9)

- **Domain:** identifiers (`TrancheId`, `OpId`, `Revision`, `WaiverId`),
  steps, outcomes, observations, holds, requests, events. Plain data.
- **Features:** one pure function `decide(state, event) -> (state,
  commands)` plus the pure pacing and classification functions below.
  Total over every state and event. The protected-path rule is a pure
  function of the approval record, the recorded protected digest and the
  current one. Revision 4 adds pure functions for scheduling, admission
  and the rate fit (see the revision-4 sections below).
- **Format:** decoders for Claude stream-json and Codex JSONL, the
  handoff file, and the stored event records.
- **Runtime (Effect):** process launch in a new process group, SQLite
  event store with the conditional append, the instance lock, clock, the
  protected-set walk and digest, worktree creation, git reads and the
  commit/reset procedures (all in the clean git environment below, against
  the supervisor worktree), the notifier (a log notifier in the first
  version), and, from revision 4, the shared ledger store and the review
  worktree.
- **Program:** wires capabilities into use cases.
- **Facade:** CLI commands `status`, `approve` (optionally `--base`), `reconcile`, `waive`,
  `release`, `release-protected`, `adopt`, `restore`, `run`, and from
  revision 4 `backlog`, `roles`, `spend-down` and `ledger`. Converts input
  to events; makes no decisions.

State is a fold over an append-only event log in SQLite. Commands are
executed by the shell, and their results come back as events. Every
append, from `run` or from a CLI command, is conditional on the log
position the writer folded (below).

## Single instance (R-S3)

- `run` takes an exclusive advisory lock (`flock(2)` with `LOCK_EX |
  LOCK_NB`) on a lock file next to the database and holds it for its
  lifetime. A second `run` fails to start. The OS drops the lock when the
  process dies, so a crash never leaves a stale lock.
- Every append is a compare-and-append: inside one SQLite `BEGIN
  IMMEDIATE` transaction the writer checks that the log's last sequence
  number equals the one it folded, then appends; otherwise it re-folds
  and decides again. This is the expected-version check of event stores
  (optimistic concurrency control). It covers the CLI commands and
  observations appended while `run` decides.
- Only the lock holder runs git commands that change the supervisor
  worktree or its branch (fix 3), and no supervisor process writes the
  owner's checkout or branches. A CLI command with a git effect
  (`restore`, `reconcile discard`, `reconcile abandon`, `approve --base`)
  appends a request and nothing else; the
  lock holder performs it (see "Requests"). If no `run` holds the lock,
  the CLI command takes it with `LOCK_NB`, performs its own request and
  releases it; if the lock is held, it leaves the request for `run`.
- The lock alone does not order the CLI's appends against `run`'s; the
  position check alone does not stop two processes from both issuing git
  commands outside the log. Both are kept.

## Supervisor worktree (owner ruling 2026-11-15)

Agents never work in the owner's checkout. The supervisor keeps one
linked worktree (`git worktree`) of the target repository on its own
branch, and every step, every clean check and every shell git effect
acts on it. Probes for this section are listed under "Worktree probes".

- **Where it lives.** `<stateDir>/worktree`, where `<stateDir>` is the
  directory that holds the SQLite database and the lock file
  (configuration). It is outside the owner's checkout: a linked worktree
  nested inside the checkout shows up there as an untracked directory
  (probe), and Claude would load the owner's checkout's `CLAUDE.md` as a
  parent-directory file (see "Context per step").
- **Branch.** `foreman/<name>`, `<name>` from configuration. Git refuses
  to check out that branch in another worktree and refuses `git branch
  -f` on it while the supervisor worktree has it checked out (probe), so
  the owner cannot move it by accident from their checkout; `git
  update-ref` on it is not refused and is caught as drift (probe).
- **Creation.** The first `run` for a repository, after taking the lock
  and before startup recovery, appends `WorktreeIntended(path, branch,
  base)`, where `base` is `git rev-parse HEAD` in the owner's checkout
  (or a configured start revision), then runs `git worktree add --lock
  --reason foreman -b <branch> <path> <base>`, resolves `git rev-parse
  --absolute-git-dir --git-common-dir` in the new worktree, and appends
  `WorktreeCreated(path, branch, gitDir, commonDir, base)`. The starting
  approval hold is at `base`. A crash in between leaves `WorktreeIntended`
  alone; the next startup appends `WorktreeCreated` if `git worktree list
  --porcelain` shows `path` on `refs/heads/<branch>` at `base`, runs the
  add again if neither the path nor the branch exists, and otherwise
  stops and reports (no automatic cleanup). An existing branch of the
  same name makes `worktree add -b` fail; startup stops and reports.
- **How git is run against it.** Every shell git command for the
  supervisor's tree runs with `GIT_DIR=<gitDir> GIT_WORK_TREE=<path>
  GIT_COMMON_DIR=<commonDir>` from `WorktreeCreated`, added to the clean
  environment under "Git environment". In a linked worktree `.git` is a
  file naming the git directory; with these variables a rewritten `.git`
  file does not redirect the shell (probe: plain git followed the
  rewritten file, git with the variables did not). The owner's checkout
  is only read: `rev-parse HEAD` at creation. Revision names given to
  `approve --base` are resolved in the common directory, which shares
  refs with the owner's checkout.
- **Startup check.** Each startup checks that `git worktree list
  --porcelain` lists the recorded path on the recorded branch, locked; if
  not, `run` stops and reports.
- **Removal.** The supervisor never removes the worktree or its branch.
  Because it is locked, `git worktree prune` keeps its administrative
  directory even while the path is missing, and `git worktree remove`
  refuses it (probe). The owner retires it after stopping `run` for good:
  `git worktree unlock <path>` and `git worktree remove <path>`; a later
  `run` with the same database then stops at the startup check.

What counts as drift. The owner works in their own checkout and does not
touch the supervisor worktree. Drift is now a supervisor-worktree HEAD
different from the recorded revision, or a dirty supervisor worktree.
Its possible sources are an agent action that got past prevention, a
surviving agent, someone working in the supervisor worktree against the
rule, and `git update-ref` on the supervisor branch from elsewhere. The
owner's commits on their own branches and edits in their own checkout are
not drift: they change neither the worktree's files nor its HEAD (probe:
the commit procedure moved only the supervisor branch, and the owner's
`git status` stayed empty). What the two checkouts do share is the common
git directory: objects, refs, and the `config`, `hooks/` and `info/`
that the protected digest covers. An owner's `git config` change or hook
install in their own checkout therefore creates a `Protected` hold, which
the owner releases with `release-protected --accept`.

Delivery. Approval never moves the owner's branch, and neither does a
timer. While `Approval(tranche, revision)` stands, `status` shows the
revision, the tranche's commits (`<trancheBase>..<revision>`, each with
its `Op-Id`) and the commands the owner may run in their own checkout:

- `git merge --ff-only <revision>` when their branch has not moved since
  `trancheBase`;
- otherwise `git cherry-pick <trancheBase>..<revision>` (or an equivalent
  `git rebase --onto`), which replays the commits without a merge commit;
  the commit messages, and so the `Op-Id` trailers, are copied.

The owner may deliver before or after approving. The supervisor makes no
merge commits and offers no `deliver` command in the first version (open
items).

Next tranche's base. `approve <tranche> <revision>` starts the next
tranche from `revision` on the supervisor branch. `approve <tranche>
<revision> --base <commit>` starts it from another commit, typically the
owner's branch after delivery, so the agents see the owner's commits:

1. The CLI resolves `<commit>`, refuses it if its attribute files
   declare conversions (the startup rule under "Git environment", read
   from the commit's blobs), and prints the tranche commits with no
   patch-equivalent in it (`git cherry <commit> <revision> <trancheBase>`
   lists them with `+`; probe). The warning does not refuse: the owner
   may mean to drop the work, which stays findable through the log and
   the branch's reflog.
2. It appends `Approved(tranche, revision, permits, base)` and
   `BaseRequested(base, atHead)` in one compare-and-append. The command
   is refused while another request is pending.
3. The lock holder performs it like a restore (see "Requests"): digest
   compare, HEAD guard, `git reset --hard <base>` and `git clean -fd` in
   the supervisor worktree, and the new protected digest becomes the
   baseline, since the owner chose that commit. It then appends
   `Rebased(base)`, and `base` is the recorded revision. A nested
   repository left behind makes the next launch attempt hold for drift.

If the owner's branch moves during a tranche, nothing happens: the tranche
continues on its base, and the owner's new commits reach the agents only
through a later `--base` approval. Uncommitted owner work never reaches
them.

## Holds (S7)

A launch is allowed only when no hold blocks it and no request is
pending. A `Quota(provider, ...)` hold blocks only that provider's steps
(revision 4); every other hold blocks every launch. Holds are keyed by reason, and each is removed only by its own
release event. Several can exist at once: a failed step that also changed
a protected file gets a `Failure` and a `Protected` hold, and a restart
after a crash can create `Uncertain` and `Protected` together. Model check
M3 reaches two holds at once (counter "maxholds"). Each release command
removes only its own hold.

| Hold | Created by | Released only by |
|---|---|---|
| `Approval(tranche, revision)` | the tranche ended: passing review when the next tranche is neither pre-approved nor started (revision 4), `notConverged`, or `abandon`; and at first start, for the starting tranche at the initial revision | `Approved(tranche, revision, permits, base?)` from the CLI with both fields matching the hold. `permits` is the protected-path permission for the next tranche (below); `base`, if given, also appends a `BaseRequested` request (see "Supervisor worktree"). |
| `Quota(provider, windows, heldAt)` | pacing says Hold or Unknown at a launch attempt (`windows` = the policy windows without a usable allowing reading), or a `rateLimited` outcome (`windows` = the window the rate-limit event names, else every policy window of the provider) | for every window in `windows`, either the newest reading of that window has `observedAt > heldAt` and allows, or the reset time reported for that window has passed; or `Waived(provider, waiverId)` from the CLI (fix 8) |
| `Uncertain(opId)` | startup finds an unsettled operation (rules below) | completion of `reconcile <opId> discard` or `abandon`, or `Reconciled(opId, accept)`, naming that held opId (fix 2) |
| `Failure(opId, class)` | a classified failure other than rate limit, a refused commit (head moved), or a commit failure | `Released(opId)` from the CLI |
| `Drift(expected, head, dirty)` | a launch attempt finds the supervisor worktree's HEAD different from the recorded revision, or that worktree dirty (the owner's checkout is never consulted) | `Adopted(revision)` or the completion of a `restore` request that found the tree clean |
| `Protected(paths)` | a protected-digest compare finds a change the tranche does not permit (fix 1) | `release-protected`: re-digests and releases if the files match the recorded digest again; `release-protected --accept` records the current digest as the new baseline and releases |

Clock ticks and notifier timeouts never release any hold. An approval
for one tranche and revision does not release a hold for another.
`notConverged` creates only the approval hold; there is no failure hold
to release and no way to add rounds within the tranche (ruling 1).

Hold creation rule H1 (fix 6, checked by M3; revision 4 by M4): a launch
attempt creates at most one hold, and only when it found none that
blocks every launch (a quota hold for one provider does not stop an
attempt from holding the other). Other holds come from the
outcome of the operation in flight, from startup, or from a compare
point.

### Launch attempt

The lock holder, at a fresh log position, with no operation of its own in
flight:

1. If a request is pending, perform it (see "Requests"); this is not a
   launch attempt.
2. If any hold other than a quota hold exists, append a refusal. The
   armed waiver, if any, expires.
3. Compare the protected digest (no git command has run yet). On a change
   not permitted, create `Protected` and stop.
4. Read the supervisor worktree's HEAD and tree state against the
   recorded revision (below). If HEAD differs or the tree is not clean, create `Drift` and
   stop.
5. If a waiver is armed for the provider of the scheduler's first
   candidate, launch that candidate with it.
6. Otherwise the scheduler (see "Stages, review queue and scheduler")
   takes the candidates in deadline order, skips those under a quota hold
   for their provider, and launches the first that passes the admission
   rule; if none passes, it creates `Quota` for the first refused by rule
   1 (naming the blocking windows), or waits.

Steps 2-6 each consume or expire the armed waiver.

### Drift and the clean-tree rule (R-S2, ruling 2)

The clean check reads the supervisor worktree's files, not `git status`
(fix 1, fix 7); "Supervisor worktree" says what counts as drift now:
tracked paths are compared with the tree of the recorded revision
(`git ls-tree -r -z <revision>` against `git hash-object --no-filters` of
each file on disk), and untracked paths come from `git ls-files --others
--exclude-standard -z`. Index flags (skip-worktree, assume-unchanged) are
therefore never consulted; the probe confirmed that a skip-worktree entry
hides an edit from `git status`. Ignored files are not part of the clean
check, except those in the protected set, which the digest covers
(restriction table).

Two user commands release a drift hold (ruling 2). Both act on the
supervisor worktree and branch, never on the owner's; to build on the
owner's branch, the owner uses `approve --base` at the next approval.

- **`adopt`** records the supervisor worktree's current HEAD as the
  expected revision (`Adopted(revision)`). It compares the protected
  digest first and is refused while that tree is dirty: whoever changed
  it commits or restores first. The current step continues on the
  adopted revision; a review then reviews that commit too.
- **`restore`** appends `RestoreRequested(expected, atHead)` (fix 3). The
  lock holder performs it in the supervisor worktree: digest compare,
  `git reset --hard <expected>` and `git clean -fd`, then the clean check
  again. A clean tree appends `Restored(expected, atHead)`, which releases
  the hold; `atHead` keeps the moved HEAD findable (also in the
  supervisor branch's reflog).
- **Restore that leaves a dirty tree** (fix 7). `git clean -fd` leaves
  nested repositories (probe), and some files may not be removable. The
  holder then appends `RestoreIncomplete(paths)`; the drift hold stays and
  `status` lists the paths. The user removes or moves them and runs
  `restore` again; or runs `restore --remove-nested`, which uses `git
  clean -ffd` and deletes nested repositories after listing them; or
  commits them and runs `adopt`.

Automatic adoption of the user's commits (F2) stays deferred.

### Waivers (R-S4, R-D4, fix 5)

`waive <provider> [--id <waiverId>]` is accepted only while a `Quota`
hold for that provider exists. It removes that hold and appends
`Waived(provider, waiverId)` (user-chosen id; generated when omitted).
The waiver is armed from that record until the next launch attempt by any
`run` instance, whatever that attempt's result: if the attempt launches a
step of that provider, its `Intended` record carries the `waiverId` and
pacing is not consulted; if the attempt is refused (another hold, a
protected change, drift), the waiver expires unused. A crash or restart
does not expire it, because it is a fact in the log and no launch attempt
has happened; this lets the user waive while `run` is stopped and then
start it. It never carries past one attempt.

The waiver cannot meet a step of another provider: a `Quota` hold for a
provider is created only by an attempt for that provider's step or by
its `rateLimited` outcome, and no event changes the step while a hold
exists. M3 counts launch attempts made with a waiver for another
provider's step (counter W): 0. Waivers do not name an opId, because the
opId does not exist until `Intended` is appended.

## Pacing (S3, S4)

`pace(observations, now, policy, provider, estimate) -> Allow | Hold |
Unknown`, pure.

- An observation is `{provider, window, usedPercent, resetsAt,
  observedAt, ingestedSeq, source}`. `resetsAt` may be absent (R-P4).
- The windows checked are the provider's windows **listed in policy**
  (default Claude: five-hour and weekly; Codex: from live test L2), not
  the windows that happen to have readings (R-P1). With no observations
  the result is Unknown.
- For each window, the reading used is the one with the latest
  `observedAt`, whatever order readings arrive in; among readings with
  equal `observedAt`, the highest `usedPercent` (R-P4).
- That reading is usable when `now - observedAt <= freshness` (default 10
  minutes) and either `resetsAt` is present and `now < resetsAt`, or
  `resetsAt` is absent (then freshness alone limits it).
- Allow iff every policy window has a usable reading with `usedPercent +
  estimate(window) <= 100 - reserve(window)`. Hold if any usable reading
  fails that test. Otherwise Unknown.
- `estimate(window)` is per role and per window (R-P3): take the role's
  last five finished steps; among those measured in that window, the
  largest measured increase; if none of the five is measured in that
  window, `initialEstimate` (default 15 points). A step is measured in a
  window when a usable reading before it and one after it both carry
  `resetsAt` and share the same value (no reset in between); otherwise it
  is unmeasured in that window. A running agent can still overshoot;
  there is no hard reserve guarantee.
- Policy is configuration, read at startup and recorded with every
  pacing decision: windows per provider, reserve per provider and window
  (defaults 30 percent of the five-hour window, 40 percent of the weekly
  window), freshness (default 10 minutes) and `initialEstimate` (default
  15 points). Defaults confirmed by the user on 2026-11-14; the reserve
  must stay configurable. Revision 4 moves the reserve to the shared
  ledger, where a spend-down can raise the cap for one period (see "Usage
  ledger").

Clock basis (fix 9). `heldAt` and `now` are the supervisor's local wall
clock. `observedAt` is the local wall clock of the process that took the
reading: the statusline script when it ran, the supervisor when it read a
`rate_limit_event` line or a Codex response. All run on the same Mac.
Because a wall clock can step backwards, a reading counts as post-hold
only if both `observedAt > heldAt` and it was ingested after the hold was
appended (`ingestedSeq` greater than the hold's log position). `resetsAt`
comes from the provider and is compared with the local clock; skew is a
restriction.

Quota-hold release (R-S1, fix 8): see the holds table. A reading taken
before the hold, even one appended after it (a late statusline line),
never releases it. A reading of another window never releases it. When
the reset time of a named window passes, that window drops out of the
hold; when none is left, the hold is released, and the next launch
attempt runs pacing again (with no fresh reading it is Unknown, so a new
hold follows).

Feedback loop (requested by the user on 2026-11-14):

- Every observation and every launch decision is an event in the log.
  For each finished step the shell records, per window, the usage
  reading closest before and after it, so each step leaves a measured
  cost per window (or "unmeasured" under the rule above).
- Readings taken while no step runs measure the user's other usage;
  their rate shows how fast a reading goes stale.
- `estimate` is refined automatically from measured step costs, as
  above. The policy never loosens itself: freshness and reserve change
  only by editing configuration. `status` reports what the records
  suggest for each (for example, the largest drift seen within ten
  minutes of idle time) so the user can decide.
- How to turn the records into a suggestion (largest recent value, a
  high quantile, or a moving average) is an open design choice; each is
  a published statistic, and the design review should pick one.

Observation sources:

- **Codex:** `account/rateLimits/read` through a short-lived app-server
  process before each Codex launch (E4), pending the live test L2.
- **Claude** (source b approved by the user on 2026-11-14): (a)
  `rate_limit_event` from the supervisor's own stream-json output (shape
  to be recorded in L1; until then it is decoded only as "rate limited,
  window not named"); (b) an opt-in line added to the user's statusline
  script that appends `rate_limits` with the script's own timestamp to an
  observation file each time any interactive session responds; (c)
  `/usage` as a prompt, only if live test L1 shows it spends nothing.

Because Claude has no confirmed preflight read (E2), the first Claude
launch after a quiet period may be Unknown. The supervisor then holds,
and the user can `waive` one launch. Unknown never becomes Allow by
waiting.

## Usage ledger (revision 4)

The owner rulings of 2026-11-15 (end of this document) add a usage ledger
that every foreman instance on the Mac shares. There is one foreman per
target repository. A *project* below is one such repository with its own
`<stateDir>`, event log, lock and supervisor worktree; everything in
revision 3.1 stays per project, and the ledger is the only state the
projects share.

### Where the ledger lives and how instances coordinate

- One SQLite database, `<ledgerDir>/ledger.sqlite` (configuration, default
  `~/.foreman/`), in WAL mode. At its first start a project appends
  `LedgerBound(path)` to its own log; a later start with another ledger
  path stops and reports, so a project cannot move to another ledger
  unnoticed.
- The ledger holds append-only tables, one per record kind (`readings`,
  `periods`, `reserves`, `allocations`, `spendDowns`, `grants`, `charges`,
  `grantCancellations`). Each project's log keeps its own review queue
  and backlog, and its roles and suggestions.
- Every ledger write is one `BEGIN IMMEDIATE` transaction. SQLite takes
  the write lock when such a transaction begins, so two instances'
  admissions run one after the other: each reads the totals and appends
  its grant inside the same transaction. No instance leads; an instance
  waits for another only on that lock (`busy_timeout`, default 5
  seconds; a timeout ends the launch attempt with nothing launched, and
  the next attempt tries again).
- Admission reserves before it spends (the escrow method below). The
  instance appends `Grant(grantId, project, opId, provider, estimate per
  window, period keys)` to the ledger, then `Intended(..., grantId)` to its
  own log. The two databases share no transaction (SQLite does not make a
  commit across attached databases atomic in WAL mode), so a crash
  between the two appends leaves a grant with no `Intended`. The project's
  next startup cancels its own such grants (`GrantCancelled`); until then
  the grant counts at its estimate, which overstates use. A finished
  operation's grant is settled by `Charged(grantId, tokens, charge per
  window)`. An operation held `Uncertain` keeps its grant at the estimate
  until it is reconciled; one with no run report is charged its estimate.
- The ledger has no log-position check: each transaction re-reads
  everything it decides on. The project log keeps its lock and
  compare-and-append as in 3.1.

### Periods

A period is one instance of a provider's window, keyed by its reset time:
`(provider, window, resetsAt)`.

- A new period opens when an ingested reading has a reset time later
  than the current key by more than `resetTolerance` (default 5 minutes);
  when a reading of the current period shows usage lower than that
  period's highest reading by more than `dropTolerance` (default 5
  points); or on the owner command `ledger reset <provider> <window>`.
  Each appends `PeriodOpened(provider, window, key, cause)`.
- Opening a period loosens policy, since use starts over against every
  allocation and ceiling. Only a reading or an owner command opens one.
  The clock passing a reset time can only tighten: readings of the old
  period become unusable (as under "Pacing"), a spend-down for that period
  ends, a role-swap suggestion that depends on it expires, and launches
  for that window wait for a reading of the new period. This is the
  owner's rule that timers may only tighten policy.
- The 3.1 rule that a quota hold is released once the reset time of every
  window it names has passed fits this rule. The release only leads to a
  new pacing check, which needs a fresh reading. With none, the answer
  is Unknown and the hold returns.

### Allocations, reserve and borrowing

These settings live in the ledger, so every instance reads one copy.
`ledger reserve <provider> <window> <percent>` and `ledger allocate
<project> <provider> <window> <percent> [--ceiling <percent>]` append
them.

- `reserve(p, w)` is the share of window `w` of provider `p` kept for
  personal use outside foreman. The 3.1 per-project reserve moves here,
  with the same defaults (30 percent of the five-hour window, 40 percent
  of the weekly window).
- `alloc(j, p, w)` is project `j`'s share. The transaction refuses a
  change that would make the allocations of `p, w` plus its reserve exceed
  100.
- `ceiling(j, p, w)` is the most project `j` may use in a period,
  borrowing included: `alloc ≤ ceiling ≤ 100 − reserve`. It defaults to
  the allocation, which means no borrowing.
- `use(j, p, w)` is the sum of project `j`'s charges and open grants in
  the current period. Foreman's use is the sum over projects.

A project borrows when its use goes above its allocation. It may do so
while its use stays within its ceiling and foreman's use stays within the
sum of allocations, so borrowing only takes allocation that other
projects have not used in this period. No project ever borrows from the
reserve. Two owner commands can spend it: a waiver (one launch, 3.1) and a
spend-down (one period, below). A lender gets no protection: allocation
borrowed early in a period stays used for the rest of it (restrictions
table, open items).

### Measurement

- Tokens per step: the shell takes each step's token counts from the
  client's run report and records them in `Finished` and `Charged`.
  Claude's stream-json `result` message includes a `usage` object (input,
  output, cache-creation and cache-read tokens); L1 confirms the shape
  under the subscription login. What Codex reports per run is to be
  recorded in L2.
- Rates: for each provider and window, foreman fits `Δu = θ · x + e`
  over consecutive pairs of readings within one period. `Δu` is the
  change in `usedPercent`; `x` holds the token counts by class summed over
  every foreman step, from every project, charged between the two
  readings, plus the elapsed hours; `e` is noise. The fit is recursive
  least squares with forgetting factor λ (default 0.99), one update per
  pair. The token coefficients convert tokens to percent; the
  elapsed-hours coefficient is the average rate of outside usage.
- Residual: for each pair, `Δu − θ_tokens · x_tokens` is the usage
  outside foreman in that interval (the owner's own sessions on the same
  account). `status` shows it per period.
- Convergence: a provider window's rates are used once at least
  `minPairs` (default 10) pairs with nonzero tokens have been fitted, every
  token coefficient is positive, and the relative standard error of the
  predicted charge of a typical step, taken from the fit's covariance
  matrix, is at most `maxRelError` (default 0.2). Until then, and again
  whenever a later update breaks the condition, that window is in
  fallback.
- Fallback: a window in fallback is admitted by launch-time pacing
  alone, 3.1's `pace` (`src/features/pace.ts`) with the ledger's reserve.
  Steps are not charged to projects, and no allocation or ceiling is
  checked for that window. The reserve still bounds every launch against
  the provider's total reading. Steps still record their tokens,
  so the fit keeps learning.
- Charge and estimate: in ledger mode, a finished step's charge in
  window `w` is `θ_tokens(w) · tokens`. The admission estimate is the
  charge of the largest token count among the role's last five finished
  steps (3.1's sliding maximum, now taken over tokens), or
  `initialEstimate` when there are none.

Budget caps per step. Where a client accepts a budget for one run, the
step is launched with one. Claude documents a budget limit for print-mode
runs; L1 records the flag, its unit and whether it stops a step
mid-turn. If the cap's unit is one the run report also gives, foreman
fits it like tokens and sets the cap to `capFactor` (default 1.5) times
the step's admitted headroom (the smallest remaining room over the
provider's windows), converted with the learned rate. Otherwise no cap is
set and admission bounds the launch only, as in 3.1. Codex has no known
cap until L2. A step stopped by its cap is classified `budgetExceeded`,
which creates a `Failure` hold.

### Admission rule

A step of project `j` for provider `p` may launch only if, for every
policy window `w` of `p`:

1. **Pacing** (3.1) allows with cap `cap(p, w)`: the newest usable reading
   has `usedPercent + est(w) ≤ cap(p, w)`, where `cap(p, w)` is the level
   of a spend-down active for that window's current period, and otherwise
   `100 − reserve(p, w)`.
2. **Allocation**, only when `w` is in ledger mode and no spend-down is
   active on it: `use(j, p, w) + est(w) ≤ ceiling(j, p, w)`, and foreman's
   use plus `est(w)` is at most the sum of allocations of `p, w`.

The holds must also allow it (see "Holds"). A failure of rule 1 creates a
`Quota` hold, as in 3.1. A failure of rule 2 creates no hold; the
scheduler tries its next candidate, and if none passes the project waits.
Rule 2 can start passing again only through a new period, a spend-down,
an allocation change or a cancelled grant. Each is a ledger row, and each
instance's scheduler runs again when the ledger's last row id changes.

Admission bounds launches. Usage itself is unbounded: a running step can
use more than its estimate; the excess is charged to its project and may make the
project's later steps wait.

### Spend-down override

`spend-down <provider> [--window <w>] --to <percent>` appends
`SpendDown(provider, window, level, periodKey)` to the ledger. `window`
defaults to the provider's longest policy window and `periodKey` is that
window's current period. The command is refused when the window has no
usable reading or a spend-down is already active on it. While it is
active, rule 1 uses `level` as that window's cap and rule 2 is skipped
for that window. It is active only while the window's current period key
equals `periodKey` and the clock is before `periodKey`. It therefore ends
at a detected or manual reset, when the clock passes the reset time, or
with `spend-down <provider> --cancel`. A level below `100 − reserve`
tightens. The provider's other windows keep their rules: a weekly
spend-down leaves the five-hour reserve in force.

## Stages, review queue and scheduler (revision 4)

### Review queue

Each project has a review queue: tranche results waiting for review,
oldest first, each `(tranche, trancheBase, revision)`. A successful
implement step's commit (or its `NothingToCommit`) appends
`ReviewQueued`; a correction's commit replaces its tranche's entry at the
head. The queue is a fold of the project log, so it survives a crash as
the rest of the log does.

Bound and backpressure. `reviewQueueBound` (default 2). An implement step
may launch only while the queue length plus one is at most the bound.
With bound 1 the cycle is 3.1's: the next tranche starts only after the
previous one has left the queue. With bound 2 one pre-approved tranche
may be implemented, stacked on the previous tranche's unreviewed result,
while that result waits for review.

Review worktree. Reviews run in a second linked worktree,
`<stateDir>/review`, detached at the revision under review. It is created
like the supervisor worktree (`git worktree add --lock --detach`), and
before each review the lock holder checks out the revision there in the
clean git environment, with the review worktree's own recorded `GIT_DIR`,
`GIT_WORK_TREE` and `GIT_COMMON_DIR`, and runs the clean check. Its
`.git` file and its per-worktree git directory join the protected set.
Stacking needs this worktree: the
supervisor worktree's HEAD can be ahead of the tranche under review. The
reviewer's working directory is the review worktree and its profile stays
read-only.

Unwinding. When the review of the head tranche requests changes, ends in
`notConverged`, or the tranche is abandoned, every tranche stacked above
it is unwound before anything else runs. The lock holder performs
`UnwindRequested(target, atHead)`, where `target` is the head tranche's
latest revision, exactly as a restore (digest compare, HEAD guard, `git
reset --hard`, `git clean -fd`), then appends `Unwound(tranches, atHead,
target)`. The unwound tranches leave the queue, their pre-approvals are
armed again, and their commits stay findable through the log and the
reflog. The correction runs next, or the approval hold stands. With bound
1 nothing is ever stacked and nothing is unwound.

### Scheduler

`schedule(project, ledgerView, now) -> Launch(step) | Hold(reason) |
Wait(reasons)`, pure. One operation runs at a time per project (C5), so
the scheduler picks its own project's next step. Projects run in
parallel, one instance each, and meet only in the ledger.

Candidates, when no hold blocks every launch and no request is pending:

- the correction of the head tranche, if its last review requested
  changes and rounds remain (it is then the only candidate);
- the review of the head tranche;
- the implement step of the next tranche, if that tranche is approved
  (live or pre-approved) and the bound allows it.

Order: earliest deadline first. A candidate's deadline is its provider's
reset time for the longest policy window, the period whose unused share
is lost at the reset. A provider without a known reset time sorts last,
and a tie goes to the review, which drains the queue. The scheduler
launches the first candidate in that order that is not under a quota
hold for its provider and passes the admission rule. If none does, it
creates a `Quota` hold for the first candidate refused by rule 1 (H1: at
most one hold per attempt), or else waits.

The short window enters through admission. The five-hour window has its
own reserve and allocations, so a provider's short-window rate caps every
project's launches whatever the deadlines say.

Quota holds now block only their provider's steps: under `Quota(codex)` a
Claude implement step may still launch. Every other hold still blocks
every launch (holds table).

Published sources: earliest deadline first (Liu and Layland, 1973;
Jackson's rule for one machine, 1955), applied to the admissible
candidates; allocations and ceilings are the rate and ceil of a
hierarchical token bucket class (Devera, HTB, 2002), with a budget per
period in place of token refill; grants are escrow reservations (O'Neil,
"The Escrow Transactional Method", 1986); the bounded queue with
backpressure is the bounded buffer (Dijkstra, 1965), a work-in-progress
limit in Kanban terms; the rates are recursive least squares (Plackett,
1950; Ljung and Söderström, 1983).

## Pre-approved backlog (revision 4)

The owner may approve upcoming tranches before they start: `backlog add
<tranche> [--allow-protected] [--stop-before]` appends
`PreApproved(tranche, permits, stopBefore)` to the project log. The
backlog holds at most `backlogMax` (default 3) entries, in order. `backlog
remove <tranche>` withdraws an entry that has not started; a stacked one
is unwound first.

- Each tranche still needs its own approval to start: a live `Approved`
  (3.1) that releases the previous tranche's approval hold, or its own
  `PreApproved` entry. No tranche starts unless the owner named it.
- A tranche that ends with a passing review creates no approval hold if
  the next tranche is pre-approved without `--stop-before` or has already
  started; the next tranche starts, or carries on if stacked. Otherwise
  the 3.1 approval hold is created.
- `notConverged` and `abandon` always create the approval hold, whatever
  the backlog holds, and unwind stacked tranches. The backlog stays, but
  nothing starts until the live approval.
- A pre-approval is used when its tranche's implement step is intended.
  An unwind arms it again.

Base. A pre-approved tranche always starts on the previous tranche's
latest revision on the supervisor branch; `--base` exists only on a live
approval. An approval names what it approves, and a commit the owner has
not yet delivered to does not exist when the pre-approval is written. A
symbolic base resolved later, such as "the tip of the owner's branch when
the tranche starts", would let commits the owner never named reach the
agents, and it would skip the `git cherry` warning that the base lacks
tranche commits, which the owner must see when approving. To move the
work onto a delivered commit, the owner marks the next entry
`--stop-before`. The tranche before it then ends in an approval hold, and
the owner approves with `--base` after delivering. That approval also
releases the `--stop-before` entry, which then starts as if approved live.

Reading of "no speculative work" used here: no work on a tranche the owner
has not approved. Stacking (bound 2) runs approved work on an unreviewed
base, and an unwind can discard that work; bound 1 never does (decision
for the owner, open items).

## Role-swap suggestions (revision 4)

The scheduler computes a suggestion at each launch attempt of a project,
from the same ledger view. It suggests swapping the implementer (with the
corrector) and the reviewer when all of these hold:

1. One provider B is the bottleneck: the project has a candidate for B
   that failed admission or sits under a `Quota(B)` hold, or the review
   queue is full and B is the reviewer.
2. The other provider A's longest-window reset comes before B's.
3. A's headroom in that window, its cap minus its newest reading, is at
   least `swapThreshold` (default 20 points).
4. Making A the implementer requires A's editing profile to be marked
   verified in configuration (an L3 run for that client), since a
   reviewer's read-only profile does not exercise it.

The scheduler appends `SwapSuggested(id, project, proposedRoles,
evidence)` when the proposal differs from the last open one, and the
notifier reports it; `status` shows it with its figures. It expires when
the earlier of the two resets passes (a timer that only withdraws an
option). Roles change only through an owner command: `roles swap
--accept <id>` (refused once expired) or `roles set implementer=<client>
reviewer=<client>`, each appending `RolesSet(roles, suggestionId?)`. The
new roles apply from the next launch attempt; a step in flight keeps its
role and profile.

Permission profiles follow the role. Each `Intended` records the role,
the client and the profile: the client's editing profile for the
implementer and the corrector, its read-only profile for the reviewer. A
swap therefore changes which profile each client runs under; a client
never edits in the reviewer role. The tranche's protected-path permission
is unchanged by a swap.

## Operations, checkpoints and recovery (S5, S6)

For each step:

1. Append `Intended(opId, tranche, step, baseRevision, waiverId?,
   protectedDigest)`, with `grantId`, `role`, `client` and `profile` from
   revision 4 (compare-and-append; the transaction commits before step
   2). The ledger's `Grant` is appended first (see "Usage ledger").
2. Launch a fresh process as the leader of a new process group
   (`posix_spawn` with `POSIX_SPAWN_SETPGROUP`) and append
   `Launched(opId, pgid)` (fix 4). Its working directory is the
   supervisor worktree (for a review, the review worktree; revision 4). Its inputs are the task file, the previous step's
   handoff file and that worktree at `baseRevision`, which the launch
   attempt found clean. No `--resume` or `--continue`.
3. On exit, send `SIGKILL` to the process group (children of the agent
   that outlived it), classify the result (below) and append
   `Finished(opId, class, evidence)`.
4. Compare the protected digest, whatever the class (fix 1). A change the
   tranche does not permit creates `Protected(paths)`; for a successful
   mutating step it also appends `CommitRefused(opId, protectedPath)` and
   nothing is committed. A permitted change is recorded as the new
   baseline.
5. For a successful implement or correct step, the shell runs the commit
   procedure:
   1. Compute the changed-path list against `baseRevision` from the
      filesystem (fix 7), as in the clean check.
   2. If it is empty, append `NothingToCommit(opId)` (R-D2). The step's
      result is its base revision; the cycle moves on (a correction that
      changes nothing still used its round).
   3. Otherwise commit (below). If HEAD no longer equals `baseRevision`
      (a commit landed on the supervisor branch during the step), the
      reference update fails and the shell appends `CommitRefused(opId,
      headMoved)` and a `Failure` hold; the tree is left as it is for the
      user. If another
      git step fails, append `CommitFailed(opId, error)` and a `Failure`
      hold.
   4. On success append `Committed(opId, revision, changedPaths)`. The
      next step's base is that revision.

Commit procedure (ruling 3, fixes 1 and 7). Every shell git command runs
in the clean git environment (below), with the supervisor worktree's
recorded `GIT_DIR`, `GIT_WORK_TREE` and `GIT_COMMON_DIR`, and only after a
digest compare that matched. The shell builds the commit from disk
without trusting the worktree's index: `GIT_INDEX_FILE=<temp> git
read-tree <baseRevision>`, `git add -A` into that temporary index, `git
write-tree`, `git commit-tree -p <baseRevision>` with an `Op-Id: <opId>`
trailer, then `git update-ref HEAD <new> <baseRevision>`, which moves the
supervisor branch (through the worktree's HEAD) only if it still equals
`baseRevision` (git's compare-and-swap on a reference; probe: a second
update with the stale old value was refused, and the owner's branch and
checkout were unchanged). Finally the worktree's own index (in
`<gitDir>`) is reset to the new HEAD (`git reset -q`) and the protected
digest is recorded as the new baseline.

User edits during a step (fix 7, closed by the owner ruling of
2026-11-15). The owner edits and commits in their own checkout, which no
step reads and no commit procedure touches, so the owner's work can no
longer be committed as an agent's step. A commit on the supervisor branch
during the step is still caught by the reference update above. What
remains: anything that writes into the supervisor worktree during a step
(someone working there against the rule, or a process the agent started)
cannot be told apart from the agent and is committed as part of the step;
`Committed` lists every changed path and the following review sees them
(restrictions table).

### Protected paths (ruling 3, fix 1)

Agents may not change the protected set unless the approval that started
the tranche permits it (`Approved(..., permits)`; `approve <tranche>
<revision> --allow-protected`). The permission lasts one tranche and is
recorded in the log.

The protected set, resolved at startup and re-resolved at each compare:

- In any directory of the supervisor worktree, tracked, untracked or
  ignored: `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/**`,
  `.codex/**`, `.mcp.json`, `.gitattributes`, `.gitmodules`; and the
  worktree's top-level `.git` file, which names its git directory.
- In the worktree's git directory and the common directory (recorded in
  `WorktreeCreated` from `git rev-parse --absolute-git-dir
  --git-common-dir`; the probe showed it runs no filter or fsmonitor; in
  a linked worktree the two differ, the git directory being
  `<commonDir>/worktrees/<name>`): `config`, `config.worktree`,
  `hooks/**`, `info/**` (probe: a filter declared in the common
  directory's `info/attributes` ran in the linked worktree), `modules/**`,
  the worktree's `commondir`, `gitdir` and `locked` files, and every file
  that an `include.path` or `includeIf` entry in those configs names
  (followed recursively). The common directory is shared with the
  owner's checkout, so an owner's change there is a protected change too
  (see "Supervisor worktree").
- Every symbolic link in the supervisor worktree whose target resolves
  outside it, and every symbolic link inside the protected set (the
  link text is digested, so a new link or a changed target is a change).

The worktree's index (`<gitDir>/index`) is not in the digest, because git
rewrites it during the agents' permitted `git status` and `git diff`. It is never trusted
instead: the clean check and the changed-path list read files from disk,
and the commit uses a temporary index built from `baseRevision`.

The digest is SHA-256 over the sorted list of (path, file type, mode,
content or link target) read directly from the filesystem. It is
compared at startup (after the process-group kill), before every shell
git command, after every step whatever its outcome, and before and after
every CLI git effect. After the shell's own git effects, the new digest
is recorded as the baseline.

Enforcement has two layers:

- **Prevention:** the editing profile denies `Edit`/`Write` on the
  protected set and allows `Edit`/`Write` only inside the supervisor
  worktree; the
  Bash sandbox's write allowlist excludes them. Whether the sandbox can
  exclude a subdirectory of the working directory is to be shown by L3.
- **Detection:** the digest compare above. A change without permission is
  a `Protected` hold, whatever the prevention layer did, and no git
  command runs while it stands.

Git environment (E7). Every shell git command runs as `env -i
PATH=/usr/bin:/bin HOME=<empty directory> GIT_CONFIG_NOSYSTEM=1
GIT_CONFIG_GLOBAL=/dev/null GIT_ATTR_SOURCE=4b825dc642cb6eb9a060e54bf8d69288fbe24904
git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c
commit.gpgsign=false ...` (the hash is git's empty tree), with
`--no-verify` where it applies, and, for the supervisor's tree, the
recorded `GIT_DIR`, `GIT_WORK_TREE` and `GIT_COMMON_DIR` (see "Supervisor
worktree"). Each part answers a probe: the empty
attribute source stops filters declared in `.gitattributes` (but not in
`.git/info/attributes`, which the digest covers), `commit.gpgsign=false`
stops `gpg.program`, and the override stops a configured fsmonitor. The
repository's own `.git/config` cannot be switched off; the digest makes
sure it is the one the user approved. Because the empty attribute source
also drops line-ending and encoding conversion, startup refuses a
repository whose attribute files declare `filter`, `text`, `eol`,
`ident` or `working-tree-encoding` (restriction table), and `approve
--base` refuses a base commit whose attribute files do.

### Git probes (2026-11-14, git 2.50.1, Apple Git-155)

Scratch repository with a clean/smudge filter driver from `.gitattributes`
and `.git/config`, `commit.gpgsign=true` with a marker-writing
`gpg.program`, and a marker-writing `core.fsmonitor`. Deleted afterwards.

| Command | Result |
|---|---|
| `git -c core.hooksPath=/dev/null -c core.fsmonitor=false status` after a same-second edit | clean filter ran (4 times) |
| same overrides, `git add` | clean filter ran |
| same overrides, `git commit --no-verify` | `gpg.program` ran; commit failed |
| plus `-c commit.gpgsign=false` | `gpg.program` did not run |
| `--attr-source=<empty tree>` or `GIT_ATTR_SOURCE`, `add` and `reset --hard` | no filter ran |
| the same with the filter declared in `.git/info/attributes` | filter ran |
| `-c core.attributesFile=/dev/null` | filter ran |
| `-c filter.x.clean= -c filter.x.smudge=` | no filter ran (needs the driver names) |
| plain `git status` with `core.fsmonitor` set in `.git/config` | fsmonitor ran; not with the override |
| full clean environment above: racy `status`, `add`, `commit` | no filter, fsmonitor or gpg ran |
| `git rev-parse --absolute-git-dir --git-common-dir --show-toplevel` | nothing ran |
| `git update-index --skip-worktree f; edit f; git status --porcelain` | empty output |
| nested repository, `git clean -fd` | left in place; `git clean -ffd` removed it |
| symlink to `/etc/hosts` | `git status` lists it as untracked only |
| `include.path` in `.git/config` | followed |

### Worktree probes (2026-11-15, git 2.50.1, Apple Git-155)

Scratch repository with an owner checkout on `main` and a linked worktree
outside it, every command in the clean environment above. Deleted
afterwards.

| Command | Result |
|---|---|
| `git worktree add --lock --reason foreman -b foreman/t <path> HEAD` | worktree created and locked; its `.git` is a file `gitdir: <common>/worktrees/wt`; that directory holds `HEAD`, `index`, `commondir`, `gitdir`, `locked` |
| `git rev-parse --absolute-git-dir --git-common-dir --show-toplevel` in the worktree | `<common>/worktrees/wt`, `<common>`, the worktree path |
| owner checkout: `git checkout foreman/t`; `git branch -f foreman/t HEAD` | both refused ("already used by worktree"; "cannot force update the branch used by worktree") |
| commit procedure in the worktree with `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`; `update-ref HEAD <new> <base>` twice | first moved `foreman/t`; second refused (stale old value); owner's `main` unchanged, owner `git status` empty |
| `.git` file rewritten to point at another repository | plain git in the worktree followed it; git with the three variables used the recorded directories and HEAD |
| owner checkout: `git update-ref refs/heads/foreman/t <base>` | accepted; the worktree's HEAD moved and its tree showed the step's file as untracked (drift) |
| owner: `git merge --ff-only foreman/t`, `main` not moved | fast-forward |
| the same after a commit on `main` | refused ("Not possible to fast-forward") |
| `git cherry main <tip> <base>` before and after `git cherry-pick <base>..<tip>` on `main` | `+ <commit>`, then `- <commit>`; no merge commit on `main` |
| in the worktree: `git reset --hard <main tip>`, `git clean -fd` | worktree on `main`'s tip, still on branch `foreman/t`, clean |
| filter declared in `<common>/info/attributes` with the driver in the common `config`; `git add` in the worktree | filter ran (so `info/**` of the common directory is protected) |
| worktree path moved away, `git worktree prune`; `git worktree remove` on the locked worktree | not pruned; remove refused while locked |
| linked worktree created inside the owner's checkout | owner's `git status` lists it as untracked |

### Startup recovery (fixes 2 and 4)

On startup, after taking the lock, the shell first completes or checks
the supervisor worktree (see "Supervisor worktree": creation after a
crash, and the startup check); then:

1. For every operation with `Launched` and no `Finished`, send `SIGKILL`
   to its process group and wait until `kill(-pgid, 0)` reports no such
   group. If the group does not go away within a timeout, startup stops
   and reports it; `run` does not continue.
2. Compare the protected digest (a surviving or crashed agent may have
   changed protected files).
3. Hold each unsettled operation. An operation is settled when it has
   `Reconciled`, or `Finished` with a class other than success, or a
   successful mutating `Finished` with a commit outcome (`Committed`,
   `NothingToCommit`, `CommitRefused`, `CommitFailed`), or is a review
   with `Finished`. Every other operation with `Intended` gets
   `Uncertain(opId)`. Review steps run read-only; the first version still
   holds them rather than replaying (F1 deferred).
4. Perform any pending request (below).
5. Cancel this project's ledger grants that no `Intended` names (revision
   4).

The shell may show the commit carrying that `Op-Id` as evidence, but it
does not resolve the hold itself. `reconcile <opId> <resolution>` is
accepted only for an opId that currently has an `Uncertain` hold and no
pending request:

All three act on the supervisor worktree and branch.

- `discard`: a request (below) to `git reset --hard <baseRevision>` and
  `git clean -fd`; its completion appends `Reconciled(opId, discard)` and
  the step runs again under a new opId. A discarded correction relaunched
  is the same round.
- `accept`: mutating steps only. Appends `Reconciled(opId, accept)` and
  records the current HEAD as the step's result (the user has checked
  it); the cycle moves to review. No git effect. If the tree is dirty,
  the next launch attempt holds for drift.
- `abandon`: a request like `discard`; its completion appends
  `Reconciled(opId, abandon)` and ends the tranche in an approval hold at
  `baseRevision` (R-S2).

No exactly-once claim.

### Requests (fix 3)

A CLI command with a git effect is intent-first: it appends
`RestoreRequested(target, atHead)`, `ReconcileRequested(opId,
resolution, target, atHead)` or, with `approve --base`,
`BaseRequested(base, atHead)` under the position check and runs no git
command. `atHead` is the supervisor worktree's HEAD as the CLI saw it
(`git rev-parse HEAD` in the clean environment with the recorded
variables). At most one request is pending, and a pending request
blocks launches like a hold. The lock holder performs it:

1. Compare the protected digest; on a change, create `Protected` and
   leave the request pending.
2. If HEAD is neither `atHead` nor `target`, append `RequestStale` and
   drop the request; the hold it was for stays, and the user issues the
   command again after looking. This stops a repeated reset from
   discarding a commit the user made after the request.
3. Run `git reset --hard <target>` and `git clean -fd` in the supervisor
   worktree, check the tree, and append the completion record
   (`Restored`, `RestoreIncomplete`, `Reconciled`, `Rebased`).

Revision 4 adds `UnwindRequested(target, atHead)`, which `run` appends
itself after a change request with tranches stacked above the head (see
"Stages, review queue and scheduler"); it is performed by the same three
steps and completed by `Unwound`. A stale one is dropped like the
others; the moved HEAD then holds for drift, and the unwind is requested
again after `adopt` or `restore`.

A stale `BaseRequested` is dropped like any other: the approval stands,
the tranche keeps the approved revision as its base, and the moved HEAD
makes the next launch attempt hold for drift. No command re-requests a
base during a tranche (open items).

A crash between step 3's git commands and the completion record leaves
the request pending; the next lock holder performs it again. The reset is
idempotent, and the HEAD guard in step 2 covers a user commit in between.

Classification (no catch-all into retry): `success`, `changesRequested`
(review), `rateLimited` -> Quota hold, `authFailed`, `permissionDenied`,
`maxTurns`, `budgetExceeded` (revision 4), `crashed(signal)`,
`unclassified` -> Failure hold. Commit
outcomes: `Committed`, `NothingToCommit`, `CommitRefused(protectedPath |
headMoved)`, `CommitFailed`; `headMoved` and `CommitFailed` -> Failure,
`protectedPath` -> Protected. A review requesting changes after
`maxCorrectionRounds` corrections ends the tranche: `notConverged` ->
Approval hold (ruling 1).

Releasing a `Failure` hold only removes it. If the failed step left the
tree dirty, the next launch attempt creates a `Drift` hold, and the user
chooses `restore` or commits and `adopt`s.

## Permissions (N2)

- Claude implement and correct, started with the supervisor worktree as
  working directory: `--permission-mode dontAsk
  --permission-prompts none`, allow `Read`, `Edit` and `Write` only on
  paths inside the supervisor worktree (not the owner's checkout or the
  git directories), the target's test commands, `git status`
  and `git diff`; deny `Edit`/`Write` on the protected set unless the
  tranche permits it; deny `git push`, `git commit`, `git config`
  (the shell commits), web tools and `curl`; sandbox enabled with
  `failIfUnavailable: true`, `allowUnsandboxedCommands: false`, no
  allowed domains. The sandbox covers only Bash; the Edit and Read tools
  rely on permission rules, and the detection layer above backs both.
  The worktree's index lives in `<gitDir>`, outside the worktree, so a
  sandbox whose write allowlist is the worktree may stop `git status`
  from refreshing it; L3 records what happens.
- Codex review: `codex exec --sandbox read-only -c approval_policy="never"`,
  with the supervisor worktree as working directory.
- No bypass flag anywhere.

### Pinned client versions (R-P6)

The pinned versions live in one place, the supervisor's configuration
file (`clients.claude.version`, `clients.codex.version`). The supervisor
runs each client's `--version` at startup and refuses to start when it
differs. Documents cite the configuration, not a number. The research
for this design saw two different Claude versions (2.1.325 in the
agents' report used for revision 1, 2.1.322 in decision-record S12); the
pin is set from the `--version` output observed when live tests L1-L4
run, and recorded there.

## Context per step (C8)

Each step is a fresh process with no `--resume` or `--continue`, so no
earlier transcript is loaded. A fresh process still loads, by design of
the clients (fix 9, full list to be confirmed by L3):

- Claude: `CLAUDE.md` and `CLAUDE.local.md` from the repository and its
  parent directories, and files they import; `.claude/settings.json` and
  `.claude/settings.local.json`; project hooks defined in those settings;
  `.mcp.json`; `.claude/agents/`, `.claude/commands/` and
  `.claude/skills/`; user settings and files under `~/.claude/`; Claude's
  auto-memory for the project directory.
- Codex: `AGENTS.md` from the repository and its parents, `.codex/`
  project configuration where supported, and `~/.codex/`.

Those are inputs to every step. "The repository" here is the supervisor
worktree at the recorded revision, so agents load the committed copies,
never the owner's uncommitted edits to them. Its parent directories are
`<stateDir>` and above, not the owner's checkout and its parents, and
Claude's auto-memory is keyed to the worktree's path, apart from the
owner's interactive sessions (L3 confirms both). The protected set covers
the worktree's copies; the protected-path rule keeps agents from changing
them without permission. Parent-directory, user-level files and
auto-memory are outside the repository and outside this design's
control; the editing profile should disable auto-memory writes if the
client offers a setting for it (to be confirmed in L3).

## Alerts (S8)

Deferred by the user on 2026-11-14. The notifier is an injected
capability; the first implementation writes to the supervisor's log and
`status`. Holds are visible through `status`. Notes for later: Pushover
fits alerts only; Telegram is the only researched channel with tap
replies that identify the sender, if phone approval is wanted.

## Durable layer: effect/workflow evaluated (revision 4)

The owner asked whether `effect/workflow` (Workflow, Activity,
DurableQueue, DurableDeferred, DurableClock) on `effect/cluster`'s
`SingleRunner` and SQL storage should replace the hand-built log and
recovery. The source read is effect 4.1.4, the project's pin, from the
npm tarball; paths are under its `src/`.

Semantics found:

- Activities run at least once. The engine stores each activity call
  as a persisted request whose primary key is `name/attempt`
  (`cluster/ClusterWorkflowEngine.ts:948-957`, key built at `:1057`). The
  SQL storage ignores a second insert with the same key
  (`cluster/SqlMessageStorage.ts:393`), and a stored reply is replayed
  instead of re-running the body. A request with no reply counts as
  unprocessed (`cluster/MessageStorage.ts:161-175`; query at
  `SqlMessageStorage.ts:638-651`), and a runner clears the claims on the
  shards it acquires at startup (`cluster/Sharding.ts:657`). A crash
  after the activity's effect and before `saveReply`
  (`SqlMessageStorage.ts:771-777`) therefore re-runs the body. A claim
  older than ten minutes is also read again
  (`SqlMessageStorage.ts:429-434`, `:651`).
- Replay repeats suspended bodies. Only completed results are
  memoized. An activity that suspends runs again from its start on
  replay, and its side effects before the suspension can repeat
  (`workflow/Activity.ts:126-129`).
- Interrupted activities are retried. By default an interrupted activity is
  retried up to 10 times with exponential backoff (`Activity.ts:193-217`).
- Idempotency keys: `Activity.idempotencyKey(name)` hashes the
  execution id and the name, optionally with the attempt
  (`Activity.ts:276-292`); a workflow's execution id hashes its tag and
  the payload's idempotency key (`workflow/Workflow.ts:345`). The engine
  deduplicates its own requests by these keys; an external effect is
  protected only if it uses them itself.
- For `DurableDeferred` the first completion wins. Completion is a
  persisted request keyed by the deferred's name
  (`ClusterWorkflowEngine.ts:971-980`), so a later `done` for the same
  name is a duplicate. There is no comparison with any other state.
- `DurableQueue` is unbounded and delivers at least once. An item that
  exhausts its attempts (default 10, `persistence/PersistedQueue.ts:180`,
  `:267`) is dead-lettered; the waiting workflow then stays parked until
  someone requeues the item by hand (`workflow/DurableQueue.ts:11-17`).
  `PersistedQueue.make` has no capacity parameter, and `process` retries the offer until it is stored
  (`DurableQueue.ts:221-245`). It is a call to a worker that the workflow
  awaits.
- `DurableClock` sleeps for a duration. The wake-up time is computed
  once as now plus the duration (`ClusterWorkflowEngine.ts:889-903`), and
  durations at or below `InMemoryThreshold` run as an in-memory sleep
  activity (`workflow/DurableClock.ts:119-127`; the threshold reference
  appeared in 4.1.3).
- `SingleRunner` wires sharding to SQL message storage and to SQL or
  in-memory runner storage (`cluster/SingleRunner.ts:61-79`). For SQLite
  the shard locks are rows in a locks table
  (`cluster/SqlRunnerStorage.ts:1-10`); with in-memory runner storage two
  processes on one database would both claim the shards.
- Storage needs a `SqlClient` (for SQLite, an `@effect/sql-sqlite-*`
  package that has had no dependency intake) and a `Digest` service; the
  layers run their own migrations for the tables they use
  (`SqlMessageStorage.ts:11-14`).
- Every module is marked `@stability unstable` (`docs/dependency-intake.md`
  and its tripwire test).

| 3.1 or revision-4 rule | Workflow mechanism | How it fits | Recommendation |
|---|---|---|---|
| `Intended`, `Launched`, `Finished` around an agent step; `Uncertain` hold at restart | Activity | A crashed activity re-runs on its own; C4 forbids relaunching an agent step without the owner. To fit, the activity body would have to read the log and report "uncertain" instead of launching, which is the hand-built rule moved inside the activity. | Keep the hand-built records. |
| `Committed` (commit procedure with `update-ref` and the old value) | Activity | Already idempotent through git's compare-and-swap with the `Op-Id`. An activity would add replay of a stored result, which the fold already gives. | Keep. |
| Requests (restore, reconcile, base, unwind) redone by the lock holder | Activity, at-least-once redo | The closest fit: 3.1 redoes a request after a crash, guarded by the HEAD check, and an activity would need the same guard. Little to gain. | Keep. |
| Holds and their releases | No direct mechanism; one deferred per hold | Holds form a set with one release per reason and rule H1; refusing a command that does not match needs the current state at the CLI. | Keep. |
| Approvals as `DurableDeferred` | `DurableDeferred.done` | An approval must match the tranche and revision, or be refused. First completion wins, which gives neither a refusal nor a position check. Pre-approvals arrive before any deferred exists. | Keep `Approved` and `PreApproved` events. |
| Review queue as `DurableQueue` | `DurableQueue.process` and `worker` | No capacity; a dead letter parks the workflow; an at-least-once handler would re-run a review. The queue is a fold of the project log with an explicit bound. | Keep the fold. |
| Reset timers as `DurableClock` | `DurableClock.sleep(duration)` | Revision 4's timers only tighten and are evaluated from `now` at each decision (a spend-down is inactive once the clock passes its key); no wake-up has to survive a crash. A durable clock would also fix a duration at scheduling time from a reset time that can change. | Not needed. |
| Event log, compare-and-append, instance lock | Message storage with primary-key deduplication; shard locks | A journal of replies per workflow, with no expected-version append; the `flock` would still be needed with in-memory runner storage. | Keep. |
| Usage ledger | None | Each admission must read the totals and append its grant in one serialized transaction; `BEGIN IMMEDIATE` gives that directly. | Plain SQLite. |

Recommendation: replace nothing in the first version. The rules the
workflow modules could take over either need the opposite of
at-least-once re-execution (agent steps), need refusals and state checks
that a first-completion deferred lacks (approvals), or need a bound the
queue lacks; the remaining timers need no durability. Adopting the
modules would add three unstable modules, a SQLite driver package and a
determinism requirement on workflow code during replay, and the agent
step would still need reconciliation. The dependency-intake entry and the
stability tripwire stay, so the question can return if a later version
needs durable timers or messages between processes (the notifier's phone
replies, for example).

## Provenance of components

| Component | Source | Fidelity |
|---|---|---|
| State as a fold over an append-only log | Event sourcing (Fowler, "Event Sourcing", 2005) | Faithful |
| Compare-and-append on log position | Optimistic concurrency control (Kung and Robinson, 1981); expected-version append in event stores | Faithful |
| Single-instance lock | `flock(2)` advisory lock (BSD/POSIX) | Faithful |
| Intent before effect, reconcile on restart | Write-ahead logging (Mohan et al., ARIES, 1992) | Adapted: no automatic redo or undo of agent steps; the user reconciles |
| CLI git effects as logged requests performed by the lock holder, redone after a crash | Write-ahead logging with idempotent redo (ARIES); command pattern | Adapted: redo guarded by the HEAD check |
| Pure decide over events | Functional core, imperative shell (Bernhardt, 2012); decider pattern (Chassaing) | Faithful |
| Per-reason holds, each with its own release | None found as a named primitive; a set of independent guards (a conjunction of preconditions) | Invented composition, simple; flagged |
| Pacing against windows with a reserve | None found; threshold admission control over reported usage | Invented; flagged |
| Quota release per named window, reset time or waiver | None found; follows from the pacing rule | Invented; flagged |
| Estimate as maximum of recent measured costs | Sliding-window maximum (textbook) | Faithful |
| Waiver bound to the next launch attempt | None found; a one-shot capability token consumed on use | Invented; flagged |
| Drift check, `adopt`, `restore` | `git ls-tree`, `git hash-object`, `git ls-files`, `git reset --hard`, `git clean` | Faithful use of git |
| Commit through a temporary index and `update-ref` with the old value | Git plumbing; compare-and-swap on a reference | Faithful use of git |
| Protected-change detection | File-integrity checking against a recorded baseline of digests (Tripwire, Kim and Spafford, 1994), over a direct filesystem walk | Adapted: the baseline is updated by the shell after its own git effects and by permitted steps |
| Git environment hardening | Git's documented environment variables and `-c` overrides | Faithful use of git; coverage shown only by the probes listed |
| Agent containment by process group, kill and verify at startup | POSIX process groups (`setpgid`, `kill(-pgid)`) | Faithful; a child that leaves the group escapes it (restriction) |
| Agents in a separate, locked linked worktree on the supervisor's branch | `git worktree add --lock -b`, `git worktree list --porcelain` (git documentation) | Faithful use of git |
| Shell git pinned to the recorded directories | `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR` (git(1) environment variables) | Faithful use of git; shown by the worktree probes |
| Worktree creation as intent, effect, completion | Write-ahead logging (ARIES), as for steps | Adapted: redo only when nothing exists yet; any other leftover stops startup |
| Delivery by the owner | `git merge --ff-only`, `git cherry-pick` or `git rebase --onto` | Faithful use of git; the supervisor runs none of them |
| Warning that a new base lacks the tranche's commits | `git cherry` (patch-id equivalence) | Faithful use of git; a warning only |
| Next tranche's base chosen at approval and applied as a lock-holder request | None found; the restore request with another target, carried by the approval | Invented composition of two rules above; flagged; M3 amendment 8 |
| Shared usage ledger; admission as one `BEGIN IMMEDIATE` transaction that reads the totals and appends a grant (revision 4) | SQLite transactions (writers serialized by the database lock); escrow reservations (O'Neil, 1986) | Adapted: grant and intent live in two databases, joined by orphan-grant cleanup at startup |
| Allocations with borrowing ceilings; a reserve no project borrows | Hierarchical token bucket rate and ceil (Devera, 2002) | Adapted: a budget per period in place of token refill; no lender protection |
| Periods keyed by reset time, opened by a new reset time, a usage drop or an owner command | None found | Invented; flagged |
| Timers only tighten | None found; a monotonicity rule over policy | Invented rule, simple; flagged |
| Tokens to window percent, outside usage as the residual | Recursive least squares with forgetting factor (Plackett, 1950; Ljung and Söderström, 1983) | Faithful for the fit; the convergence test (pair count, positive coefficients, relative standard error) is invented; flagged |
| Fallback to launch-time pacing until rates converge | 3.1 pacing | Invented composition; flagged |
| Spend-down override that ends with its period | None found | Invented; flagged |
| Scheduler: earliest deadline first among admissible candidates | Earliest deadline first (Liu and Layland, 1973; Jackson, 1955) | Adapted: the deadline is the provider's reset time instead of a job's own; non-preemptive; flagged |
| Review queue with a bound and backpressure | Bounded buffer (Dijkstra, 1965); work-in-progress limit (Kanban) | Faithful |
| Stacking a pre-approved tranche on an unreviewed result, unwound when the review below asks for changes | None found; resembles stacked branches and a pipeline flush after a misprediction | Invented composition; flagged |
| Review worktree detached at the reviewed revision | `git worktree add --lock --detach` (git documentation) | Faithful use of git |
| Pre-approved backlog | None found; a queue of one-shot approvals used at intent and re-armed by an unwind | Invented; flagged |
| Role-swap suggestion | None found | Invented heuristic, advisory only; flagged |
| Budget cap per step | The client's documented run budget | Faithful use of the client once L1 confirms it |

## Claims ledger

| ID | Claim | Backing |
|---|---|---|
| C1 | No launch happens while a request or a hold that blocks the step exists (a quota hold blocks only its provider's steps, revision 4), and every launch is made by the lock holder on an unchanged log position. | M3 (C1, K); M4 (C1) for quota holds per provider. |
| C2 | An approval hold is released only by an approval naming the same tranche and revision; a matching approval is never refused. Revision 4: a tranche's implement step launches only with an unused approval for that tranche (live, or its own pre-approval); a passing review creates the approval hold exactly when the next tranche is neither approved nor started; `notConverged` always creates it. | M3 (C2, K); M4 (BK). |
| C3 | Ticks never release a hold and never turn Unknown into Allow; a quota hold is released only when every window it names has a newest post-hold allowing reading or a passed reset time, or by a waiver. | M3 (C3, K), with readings arriving out of order. Pacing arithmetic: unit and property tests later, argument for now. |
| C4 | Every launch is preceded by a durable intent; a crash with an operation unsettled produces an Uncertain hold for that opId at the next startup and no launch until it is reconciled; a reconciled operation is settled. | M3 (C4), crash at every point, including between `git commit` and `Committed` and between a request's git effect and its completion. |
| C5 | At most one operation is in flight. | M3 (C5), with two `run` instances and late appends. |
| C6 | In a tranche, a correction is launched only after the 1st to `maxCorrectionRounds`-th change-requesting review; the review after the last correction that still requests changes ends the tranche in an approval hold, and nothing launches until that approval. | M3 (C6, C2). |
| C7 | A launch is allowed only if pacing allows it (rule 1 of the admission rule) and, for a window in ledger mode, the allocation rule allows it (rule 2), except a launch whose `Intended` records a waiver armed since the previous launch attempt. The reserve bounds launches, not usage: a running agent can overshoot. | M3 (C7). Reserve arithmetic and overshoot: argument, not yet checked against live data. |
| C8 | Fresh processes carry no earlier transcript; they still load the files listed under "Context per step". | Argument from E5 and the docs; L3 to confirm. Handoff sufficiency is unverified. |
| C9 | Agents cannot push, use the network, or change protected paths without the tranche's permission; no shell git command runs a repository hook, filter, fsmonitor or signing program, or runs while an unpermitted protected change is on disk. | Git part: probes (E7) and M3 (P, P2). Agent part: argument from docs; live test L3 required. |
| C10 | No agent process acts after a startup that follows a crash. | M3 (F4) for the kill-and-verify rule; L4 for macOS behavior. |
| D | No launch while the recorded revision differs from the supervisor worktree's HEAD or that worktree is dirty; every launch's base is the recorded revision; git effects requested from the CLI (including `approve --base`) run only by the lock holder, with HEAD at the request's HEAD or target. | M3 (D, G), with amendment 8 for `--base`; mutants R10a, R10b. The model's HEAD and tree are the supervisor worktree's. |
| C11 | Nothing the owner does in their own checkout, committed or not, enters a step's commit or a step's inputs; no supervisor process writes the owner's checkout or branches. | Argument: steps and shell git run only in the supervisor worktree with the recorded git directories, and the commit procedure moves only the supervisor branch. Worktree probes (owner's `main` and `git status` unchanged; branch protections). Not in M3, which has one tree. L3 and L4 to confirm with real agents. Exception: the shared common directory (protected digest). |
| C12 | A tranche's work reaches the owner's branch only through a git command the owner runs; approval moves only the supervisor branch, and only through a `--base` request. | Argument from the text (no supervisor command writes the owner's refs); M3 amendment 8 for the request; worktree probes for the delivery commands. |
| C13 | Reserve: no launch leaves less than the reserve of a window, by the newest usable reading plus the estimate, unless a spend-down is active for that window's period or a waiver is armed; no launch uses a reading of a period whose reset time has passed. Overshoot by a running step is not bounded. | M4 (RS) without waivers; waivers: M3 (C7). |
| C14 | Allocations: for a window in ledger mode with no active spend-down, no launch takes its project's use above the project's ceiling, or foreman's use above the sum of allocations. While the window is in fallback, allocations are not enforced. | M4 (AL). |
| C15 | A spend-down is accepted only with a usable reading and when none is active. It is in effect only in the period it was recorded in, and only before that period's reset time. | M4 (SD, RS). |
| C16 | Periods: only a reading or the owner's `ledger reset` opens a period; a timer only tightens. A charge belongs to the period of its grant. | M4 (PD, through RS and AL); mutant PD2 killed; PD1 and SD2 equivalent (the stale-reading rule already blocks the window until a new period). |
| C17 | The review queue never exceeds its bound, and an implement step launches only with room for its result. A change request at the head unwinds exactly the tranches stacked above it, and their pre-approvals are armed again. | M4 (QB, UW, BK). |
| C18 | Roles change only by an owner command; every launch's client follows the last owner-set roles, and its profile follows its role (editing for implementer and corrector, read-only for reviewer). | M4 (SW). |
| C19 | The scheduler launches the first candidate in earliest-deadline order that is not under a quota hold for its provider and passes admission, refuses only when none passes, and creates at most one quota hold per attempt, for the first candidate refused by pacing. | M4 (ED, H1). |
| C20 | Admissions by different projects' instances are serialized by the ledger, and a crash between `Grant` and `Intended` leaves only an overstated use until that project's next startup. | Argument from SQLite's `BEGIN IMMEDIATE` (the write lock is taken at the start of the transaction); M4 treats an admission as atomic and interleaves two projects; L4 for the crash. |
| C21 | Rates are used only after convergence; before it, admission is 3.1's pacing with the ledger's reserve. | Argument; unit and property tests of the fit later (RLS against a batch least-squares oracle on generated data). M4 models convergence as a one-way event. |
| L | From every reachable state some sequence of events reaches a launch or an approval release. | M3 liveness and strict liveness; M4 liveness (with credit for states where a provider has used its one modeled reset). |

### Model check M3

`research/model/check3.py` (M2 and the review directories are kept
unchanged). Exhaustive search over the reachable states of a model of
these rules within the bounds in its header, fixed before the first run;
amendments are labeled in the file with their before and after results.
The monitor's signature is `check(m, ev, out)`; it sees events and the
outputs `decide` returns, never model state. Its launch-attempt
expectation (`mon_launch_attempt`) is written from the numbered "Launch
attempt" procedure above as a table of clauses, not from the model's
`decide_run`.

The grammar adds to M2's: opIds (modulo 2) on intents, finishes and
reconciliations; startup that kills the recorded process group, compares
the digest and holds unsettled operations; agents that survive a crash
and act until a startup; protected changes on disk at any time
(`UserProt`), restored (`ProtFix`) or accepted (`release-protected`);
intent-first restore, discard and abandon, performed by the lock holder in
two steps with a crash possible between; restores left dirty by a nested
repository; two Claude windows and one Codex window, with readings older
than the newest (ignored), newer but pre-hold, and post-hold, and reset
times.

Scenarios from the second review, each in the grammar:

- E1 (a failed or nothing-to-commit step leaves `.git/config` or an
  ignored protected file changed): `UserProt` during the step, then
  `Exit(failed)` or `Exit(nochange)`. Property P2 checks no git command
  runs while the change stands.
- T1 (waiver armed while `run` is stopped, then a restart): `Crash`,
  `Waive`, `Start`, launch attempt. The monitor expects the waiver to be
  used.
- T2 (restart after a reconciled operation): any reconcile, then `Crash`
  and `Start`. C4 fails if startup holds a settled operation.

M3 runs (all with `python3 -I`, `timeout 280`, one at a time). The full
grammar did not fit the time limit, so after seven amendments, each
labeled in the file with its before and after results, M3 is three
scopes of one model and one monitor:

- **recovery:** one window per provider, every other event family
  (crashes, two instances, surviving agents, protected changes, requests,
  nested repositories), one real tranche, revisions 0..2, no permission.
- **quota:** two Claude windows and one Codex window, readings of every
  age, reset times; no protected changes or surviving agents.
- **tranches:** two real tranches, permission granted or not, instance A
  with a split read and append (the log-position check); no crash, no
  second instance, no waiver, no nested repositories.

Not covered by any scope: two-window pacing together with protected
changes or surviving agents; a crash or a second instance in the second
tranche; a granted permission together with a crash. Revisions are
bounded at 0..2, so paths that need a third commit end in BOUNDED states.
States in the tranche after the last are explored for launch attempts
only (amendment 7). The first mutation pass found a monitor gap (a
tranche end was not required to emit its approval hold); it was fixed and
every run below was repeated.

| Scope | States | Launch transitions | Violations | Liveness / strict | Counters |
|---|---|---|---|---|---|
| recovery | 733,728 | 8,040 | none | 0 / 0 | most holds 2; W 0; T1 starts with a waiver armed 57,920; T2 starts after a reconciliation 185,088; E1 exits 1,728; nested restores 112,448; failure with drift 0; quota with uncertain or approval 0 |
| quota | 626,256 | 13,208 | none | 0 / 0 | most holds 1; W 0; failure with drift 0; quota with uncertain or approval 0 |
| tranches | 824,592 | 2,632 | none | 0 / 0 | most holds 2; W 0; E1 exits 1,728; failure with drift 0; quota with uncertain or approval 0 |

Revision 3.1 (amendment 8, labeled in the file with before and after
results). The model never named a checkout: HEAD, the tree and the
recorded revision were abstract and now denote the supervisor worktree
and branch, and `UserCommit` and `UserEdit` now stand for anything other
than the shell changing that worktree or branch. The owner's commits on
their own branch change no modeled variable. The one rule the ruling adds
is `approve --base`, so the grammar gains `Approve(t, r, a, b)` with `b` a
fresh revision (the owner's commit) or none; an accepted `--base`
approval appends a request that the lock holder performs through the
existing digest compare, HEAD guard, reset and crash points, and whose
completion sets the recorded revision. Offered in recovery and tranches;
quota's rules never touch requests or revisions. Reruns, same bounds:

| Scope | States | Launch transitions | Violations | Liveness / strict | Base completions |
|---|---|---|---|---|---|
| recovery | 738,912 | 8,040 | none | 0 / 0 | 192 |
| quota | 626,256 (unchanged) | 13,208 | none | 0 / 0 | 0 (not offered) |
| tranches | 831,120 | 2,632 | none | 0 / 0 | 2,496 |

Other counters are as in the first table except nested restores in
recovery (112,640). Launch transitions are unchanged because a completed
base request reaches the same model state as a commit in the supervisor
worktree followed by a drift hold and `adopt`.

Output: `research/model/check3-run.txt` (amendment 8 runs at the end).

Mutation test (`research/model/mutate3.py`, output
`research/model/mutate3-run.txt`): 68 mutants of the model part only,
each run first in the scope named for it and, if missed there, in the
other two. The 46 of M2 adapted (M19, "crash keeps the waiver", is now
the faithful rule under fix 5 and is replaced by R5a, the revision-2
text), plus 23 for the re-review fixes (R1a-R1h, R2a-R2b, R3a-R3d,
R4a-R4b, R5a, R6a, R7a, R8a-R8d); fix 9 is wording and has none.

- 66 killed. The first pass (before the monitor fix and amendment 7)
  missed M17 and N17 as well and errored on N11 (a model output was
  unhashable); those three are killed in the final pass. M15 (Release
  clears every hold) is now killed, because a failure hold and a
  protected hold can coexist.
- 2 missed, both equivalent within every scope, each backed by a counter
  and by identical state counts to the faithful model (733,728; 626,256;
  824,592):
  - **N15** (a waiver used by another provider's step) changes behavior
    only at a launch attempt whose armed waiver names another provider.
    Counter W counts every launch attempt in that situation (a superset
    of the attempts reaching the changed line): 0 in all scopes. Counter
    `uncertain_and_quota` (states holding a quota hold together with an
    uncertain or approval hold, the only holds whose release changes the
    step): 0, which is the reason W is 0.
  - **N19** (Release of a failure also clears drift) changes behavior
    only when a failure and a drift hold coexist. Counter
    `fail_and_drift`: 0 in all scopes. A drift hold is created only by a
    launch attempt that found no hold, and a failure hold only by an
    operation, which cannot start while the drift hold stands.

Amendment 8 added two mutants: R10a (a base completion keeps the old
revision) and R10b (`approve --base` resets at the CLI, with no request).
Both are killed in recovery. The 68 earlier mutants were not rerun; each
one's text pattern still matches the amended model exactly once
(checked).

Bounded evidence only. Pacing arithmetic, git behavior beyond the probes,
the permission layer, the process-group kill on macOS, worktree creation
and the separation of the owner's checkout (C11) are outside the model.

### Model check M4 (revision 4)

`research/model/check4.py`, with `check3.py` kept unchanged. M4 models the
revision-4 rules: the shared ledger (reserve, allocations, borrowing,
spend-down, periods, fallback until rates converge), the scheduler, the
review queue with stacking and unwind, the pre-approved backlog and role
swaps. It leaves out what M3 checks (crashes, a second instance of one
project, protected changes, drift, git requests, failures, waivers, the
log-position check). The two meet only through "a hold exists", and M4
gates every launch on the holds it has (approval holds and quota holds per
provider); the unwind reuses M3's restore request, which M4 performs in
one step. An admission is atomic, as the ledger's `BEGIN IMMEDIATE`
transaction makes it, and two projects' events interleave freely.

Grammar and bounds were fixed in the file's header before the first run.
Providers have one window each, usage is in integer units (U = 100
percent), every estimate is one unit, and each provider can reset once.
The monitor `check(m, ev, out)` sees events and outputs only; its
expectations (admission, candidates in deadline order, approval holds,
queue, roles) are written from the sections above; none is taken from
the model's `decide`.

- Scope ledger: two projects, one tranche each; U = 6, reserve 2,
  allocations 1 and 2, ceilings 2 and 2, spend-down level 5; Claude steps
  cost 1 or 2 (overshoot), outside usage on Claude.
- Scope stages: one project, two tranches, queue bound 2, one correction
  round, backlog of 2, role swaps; U = 8, reserve 2, spend-down level 7.
- Scope queue1 (amendment 5): as stages, with three tranches, queue
  bound 1 and a backlog of 1.

Five amendments, each labeled in the file with its before and after
results: (1) the first ledger run passed but never reached a borrowing
launch or a launch under a spend-down (counters 0), so project 0 got a
correction round; (2) the ledger scope then timed out, so only Claude
steps overshoot, outside usage is Claude's only, and project 1 has no
correction round; (3) the stages scope timed out, so it drops the
convergence event (with one project whose allocation and ceiling equal
`100 − reserve`, rule 2 follows from rule 1) and outside usage on Codex;
(4) the first mutation pass missed AL1 and AL3 because no ceiling and no
allocation sum ever bound in the ledger scope, so its allocations became
1 and 2 and its ceilings 2 and 2, and every mutant was rerun; (5) the
second pass missed QB1, BK1 and BK2, whose distinguishing cases need a
third tranche or a backlog of one, so scope queue1 was added.

| Scope | States | Launch transitions | Violations | Liveness | Coverage counters |
|---|---|---|---|---|---|
| ledger | 2,084,092 | 318,120 | none | 0 | borrowing launches 21,010; launches above `100 − reserve` under a spend-down 6,020; launches in fallback 161,630; overshooting exits 332,496 |
| stages | 933,192 | 98,999 | none | 0 | unwinds 38,324; stacked implement launches 5,560; passing reviews with no hold (backlog) 68,820; launches after an owner swap 49,322; suggestions 14,751; launches under another provider's quota hold 35,212; launches under a spend-down 1,687 |
| queue1 | 1,840,192 | 203,712 | none | 0 | passing reviews with no hold 119,336; launches after an owner swap 101,983; launches under another provider's quota hold 72,020; launches under a spend-down 4,844 |

Strict liveness (no credit for states where a provider has used its one
modeled reset) reports 229,872, 114,648 and 241,704 states (ledger,
stages, queue1); these are states where
a window is used up and only a further reset would let work continue,
which is the intended behavior. Output: `research/model/check4-run.txt`.

Mutation test (`research/model/mutate4.py`, output
`research/model/mutate4-run.txt`): 30 mutants of the model part only, at
least one per new rule (reserve RS1-RS2, periods PD1-PD2, allocations
AL1-AL5, spend-down SD1-SD4, queue QB1, unwind UW1-UW2, backlog and
approvals BK1-BK6, roles SW1-SW3, scheduler and holds ED1-ED3, H1a,
C1a). Each runs first in its named scope and, if missed, in the others.
The first pass was stopped after AL1 and AL3 were missed (amendment 4);
the second pass killed 25 and missed QB1, BK1, BK2, PD1 and SD2; after
amendment 5, QB1, BK1 and BK2 are killed in queue1.

- 28 killed.
- 2 missed, both equivalent in every scope. PD1 (the clock passing the
  reset time zeroes use) and SD2 (the spend-down survives the clock
  passing the reset time) change the model only between that moment and
  the next period. In that interval rule 1 refuses every launch of the
  provider (readings of a passed period are unusable, property RS) and a
  spend-down is refused; the next period resets use and ends the
  spend-down in the faithful model too. SD2 gives the faithful state
  counts in all three scopes; PD1 gives the faithful counts in stages and
  queue1 and more states in ledger (3,014,828), with no output that the
  monitor rejects. So the rule "timers only tighten" is enforced by the
  stale-reading rule; the explicit end of a spend-down at the reset time
  is kept for `status` and for clarity, and no check depends on it.

Not covered by M4: two windows per provider (rules 1 and 2 are a
conjunction over windows; M3's quota scope has two windows for pacing);
Codex overshoot and outside usage in the ledger scope; borrowing together
with stacking (the ledger scope has one tranche and bound 1); the rate fit
itself (C21); crashes between `Grant` and `Intended` (C20, L4).

## Restrictions table

| Restriction | Why believed harmless | Challenge example |
|---|---|---|
| One operation in flight; one `run` instance | The workflow is sequential | The user wants a review of tranche N while N+1 is implemented; refused by design |
| Observation unusable after `resetsAt` | The user's other work may start a new window | Supervisor idles overnight; every first launch needs a waiver or a fresh observation |
| A reading lacking `resetsAt` is usable on freshness alone | Freshness is 10 minutes, shorter than any window | A window resets two minutes after the reading; the reading overstates usage (safe direction) |
| Window set from policy, not from readings | A missing reading must not read as Allow | Codex adds a window; until policy lists it, it is not checked |
| Estimate from the last five steps per role and window | Steps of one role are similar in cost | A large tranche after small ones overshoots the reserve |
| Quota hold released only by post-hold readings of the windows it names | A reading from before the hold cannot know the limit was hit | The user's session reports usage just before the hold, low; the hold stays until a newer reading |
| `resetsAt` compared with the local clock | Providers and the Mac both use network time | A skewed clock releases a rate-limit hold early; the next launch attempt still runs pacing |
| Waiver lasts one launch attempt, across restarts | A waiver is consent for one launch | The user waives, then an approval hold refuses the next attempt; the user must waive again |
| Read-only review still needs reconciliation | Simplicity in the first version (F1 deferred) | A crash during a review always waits for the user, though replay would be safe |
| Drift and dirty trees hold until `adopt` or `restore` | The user decides what a change to the supervisor worktree means (F2 deferred) | A commit lands on the supervisor branch mid-tranche; the run waits for `adopt` |
| `adopt` refused on a dirty tree | Only committed state can be a recorded revision | Something edits the supervisor worktree without committing; it is committed there and adopted, or restored |
| Anything that writes into the supervisor worktree during a step is committed as the step's (narrowed by the worktree ruling: the owner's own checkout is separate) | Only agents work there; the owner works in their checkout | The owner opens a file in the supervisor worktree by mistake and saves it during a step; the change lands in the agent's commit, listed in `changedPaths` |
| The common git directory is shared with the owner's checkout | `config`, `hooks/` and `info/` are in the protected digest | The owner runs `git config` or installs a hook in their checkout; the supervisor holds `Protected` until `release-protected --accept` |
| Agents see the owner's work only when committed and named by `approve --base` | Agents must work from recorded revisions | The owner commits a fix mid-tranche; the agents do not see it until the next `--base` approval |
| The supervisor never delivers | Moving the owner's branch is the owner's decision; no merge commits | The owner approves with `--base main` without delivering; `git cherry` warns, and the tranche's commits stay only in the log and the reflog |
| `update-ref` on the supervisor branch from elsewhere is not prevented | Git refuses `checkout` and `branch -f` of it; `update-ref` is deliberate plumbing | A script moves `foreman/<name>`; the next launch attempt holds for drift |
| Worktree outside the owner's checkout | Keeps the owner's `git status` clean and the owner's `CLAUDE.md` out of agents' parent directories | Instruction files in the checkout's parent directories no longer reach the agents |
| The supervisor never removes its worktree | Removal could lose an agent's uncommitted work | Retired worktrees stay until the owner unlocks and removes them |
| `restore` leaves nested repositories | Deleting a nested repository loses data | `restore` reports them; the user moves them or runs `restore --remove-nested` |
| Ignored files outside the protected set are not checked and survive `git clean -fd` | Ignored files are build output and caches | An agent writes an ignored `.env` that changes the next step's tests; not detected |
| Protected set fixed (list above) | These steer later agents and the shell | A tool reads its configuration from a path not on the list (a new client feature); not protected until added |
| No attribute-driven conversion | The clean git environment drops attributes | A repository using Git LFS or `eol` conversion is refused at startup |
| A child that calls `setsid` leaves the agent's process group | Agents' tools do not normally daemonize | A test command starts a daemon that survives the kill; L4 looks for survivors |
| `NothingToCommit` advances the cycle | An unchanged tree is a legitimate result | A correction that changes nothing uses a round and the same review repeats |
| Shell commits, agents cannot | Gives each step a revision and Op-Id | An agent that needs history rewriting cannot do it |
| One ledger for every instance on the Mac, one account per provider (revision 4) | Readings and resets are per account | Two Claude logins on one Mac would mix readings; not supported |
| A lender is not protected within a period | Ceilings bound each borrower; the reserve is never borrowed | Project A borrows its full ceiling in the morning; project B finds its allocation partly used for the rest of the period |
| Allocations are not enforced while a window is in fallback | Per-project charges need converged rates; the reserve still bounds every launch | Early on, one busy project uses most of foreman's share before the fit converges |
| Rates are biased when outside usage coincides with steps | The elapsed-hours term absorbs steady outside usage | The owner works only while steps run; rates overstate foreman's cost, which charges projects more and understates the residual |
| A usage drop opens a period | Providers reset usage to zero | A provider corrects a reading down by more than `dropTolerance`; a period opens early and allocations start over, while rule 1 still uses the real reading |
| One operation at a time per project, even with a review worktree | Keeps C5 and the model; projects still run in parallel | In a single project Codex idles while Claude implements |
| Stacking can discard approved work (bound 2) | Bounded by the queue bound; the commits stay in the log and reflog | Tranche N's review asks for changes; tranche N+1, already implemented on top, is unwound and redone |
| A pre-approved tranche's base is the previous tranche's result | An approval names what it approves | The owner delivers mid-backlog; the next pre-approved tranche does not see the delivered commit unless its entry was `--stop-before` |
| A swap that makes a client the implementer needs that client's editing profile verified | The read-only profile does not exercise prevention | Codex has headroom but no L3 run; the suggestion is not made |
| The deadline uses only the longest window's reset | That window's unused share is what a reset loses | A five-hour window about to reset with unused room does not raise its provider's priority |
| A spend-down ends when the clock passes the reset time | Timers may only tighten | The provider resets late; the override ends early and launches wait for a reading of the new period |

## Live tests needed before relying on the design

Each needs separate approval because it spends allowance or uses a login.

- **L1:** `claude -p "/usage" --output-format json` under the subscription
  login. Does it return `usage_report`, and do the usage bars move? Also
  record the exact shape of a `rate_limit_event` in stream-json: whether
  it names the window, carries a timestamp, a usage figure and a reset
  time (fix 9).
- L1, revision 4: also record the `result` message's `usage` object
  (token classes) under the subscription login, and the print-mode budget
  limit: flag name, unit, whether the run report gives the same unit, and
  whether reaching it stops the run mid-turn and how that is reported.
- **L2:** `account/rateLimits/read` through `codex app-server`: window
  shapes for the user's plan, and whether a turn is started. Revision 4:
  whether `codex exec --json` reports token usage per run and in which
  event, and whether Codex has any per-run budget option.
- **L3:** one implement step on a disposable repository, run in the
  supervisor worktree created as under "Supervisor worktree", under the
  permission settings above, with a task that attempts each of: rewriting
  the worktree's `.git` file to point at another repository; writing
  `<gitDir>/config.worktree`, `<gitDir>/commondir` and the common
  directory's `config`, `hooks/` and `info/attributes`; an Edit, Write and
  Bash write in the owner's checkout; `git checkout` of another branch in
  the worktree; and a push;
  a network fetch; writing `.git/hooks/pre-commit`, `.git/config`
  (including `filter.*`, `gpg.program`, `commit.gpgsign`, `include.path`
  and `core.fsmonitor`), `.git/info/attributes`, `.gitattributes`,
  `.claude/settings.json`, `.claude/settings.local.json` (ignored),
  `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.mcp.json` and `.codex/`
  through Edit, Write and Bash; a symbolic link to a file outside the
  repository; `git update-index --skip-worktree` on a tracked file
  followed by an edit; an Edit outside the repository; `git commit` and
  `git config`; and a step that edits `.git/config` and then fails.
  Expected: each is denied or, if a write lands, the digest compare
  creates a `Protected` hold and no git command runs; the sandbox starts;
  the shell's git commands run no planted hook, filter, fsmonitor or
  signing program (each writes a marker file that must not appear); the
  owner's checkout is byte-identical before and after (C11). Also record
  which instruction and settings files the fresh process loaded from the
  worktree path and its parents, which auto-memory directory it used
  (C8), whether the sandbox let the agent's `git status` write
  `<gitDir>/index`, and the `--version` output for the pin.
- **L4:** one full cycle in a supervisor worktree of a disposable
  repository, killed at each step boundary (including between `git
  worktree add` and `WorktreeCreated`, between `update-ref` and
  `Committed`, between a restore's reset and `Restored`, and between a
  `--base` reset and `Rebased`), checking that restart produces the
  expected holds, that the supervisor branch is at the expected commit
  and the owner's branch never moved; the owner commits on their own
  branch and edits their checkout during a step (expected: no drift, no
  hold, nothing of theirs in the step's commit), then delivers with
  `merge --ff-only` or `cherry-pick` and approves with `--base`; `git
  worktree prune` from the owner's checkout while `run` is stopped leaves
  the worktree; an agent whose task starts a child process (`sleep`)
  and a grandchild, with the supervisor killed by `SIGKILL`: after
  restart, `ps` shows no survivor in the recorded group (fix 4); a second
  `run` started alongside is refused. Revision 4: two projects' `run`
  instances share one ledger; one is killed between `Grant` and
  `Intended`, and its restart cancels the orphan grant; a stacked tranche
  is unwound after a change request and the review worktree shows the
  reviewed revision.
- **L3c (revision 4, only if a swap that makes Codex the implementer is
  wanted):** L3's task with Codex in its editing profile (`--sandbox
  workspace-write`), with the same expectations; its result decides
  whether Codex's editing profile is marked verified.

## Later improvements (logged, not in the first version)

Accepted by the user on 2026-11-14 as first-version behavior, with these
fixes recorded for later:

- **F1, automatic replay of read-only steps.** A crash during a review
  currently waits for reconciliation. Replaying it automatically is safe
  in principle, because the review runs in a read-only sandbox; it needs
  evidence that the sandbox held (live test L3) before adoption.
- **F2, adopting the user's own commits automatically.** HEAD drift of
  the supervisor branch during a tranche currently holds until the user
  runs `adopt` or `restore` (with the worktree ruling, a user commit
  there is rare; the owner commits on their own branch). A later version could adopt a commit made by the user
  (identified by author and the absence of an `Op-Id` trailer) without
  the command, still refusing drift it cannot attribute.

## Open items

- Repository name and location for the sibling (S1).
- Dependency intake for Effect, its platform packages and a SQLite
  binding when installation is approved. The user chose Effect v4 on
  2026-11-14; an Effect v4 skill is being written for the skills
  repository.
- The suggestion statistic for the feedback loop (above).
- Whether the Bash sandbox can deny writes to subdirectories of the
  working directory (L3); if not, prevention for `.git/` and `.claude/`
  rests on permission rules and detection only.
- Codex's window list for the pacing policy (L2).
- User edits during a step (fix 7): closed by the owner ruling of
  2026-11-15 and "Supervisor worktree". Left open from it: a `deliver`
  command (fast-forward or cherry-pick run by the supervisor in the
  owner's checkout) is not in the first version; no command re-requests a
  base during a tranche after a `BaseRequested` went stale; the default
  `<stateDir>` and branch name; whether the agents' sandbox lets `git
  status` refresh `<gitDir>/index` (L3).
- Revision 3.1's question of how a pre-approved backlog meets `approve
  --base`: closed in "Pre-approved backlog" (a pre-approved tranche starts
  on the previous tranche's result; `--base` only on a live approval,
  reached through `--stop-before`).
- Decisions for the owner from revision 4:
  - the review-queue bound: 2 (stacking, which an unwind can discard) or
    1 (3.1's sequence); this also settles the reading of "no speculative
    work";
  - lender protection: none (as written), or refuse borrowing while
    another project with ready work is below its allocation, which needs
    readiness leases in the ledger;
  - the durable layer: keep the hand-built log (recommended) or adopt
    `effect/workflow` for requests only;
  - defaults: `resetTolerance` 5 minutes, `dropTolerance` 5 points, λ
    0.99, `minPairs` 10, `maxRelError` 0.2, `capFactor` 1.5, `backlogMax`
    3, `swapThreshold` 20 points, ledger path `~/.foreman/`.
- Codex's run report and budget option (L2), Claude's budget flag (L1),
  and Codex's editing profile (L3c) before a swap to Codex.
- A review worktree would allow a review and an implement step of one
  project to run at once; that drops C5 within a project and is not in
  revision 4.
- The text of first-review findings R-S5-R-S7, R-D1, R-D3, R-P2 and R-P5
  is not saved in this repository; their rows in the table under "How
  revision 2 answers the review" give the evidence available and need the
  coordinator's confirmation.

## Review 2026-11-14

An independent reviewer (fresh Opus agent, adversarial-procedure-review)
rejected this draft as written. Artifacts: `research/model/review-2026-11-14/`.
The coordinator reproduced the C6 counterexample: removing one monitor
line that read model state (`c6_unmasked.py`) yields a third correction
in one tranche after notConverged plus Release.

Blocking:

- **C6 false.** The monitor masked it. Release of notConverged is
  undefined in the design; the model reset rounds.
- **C9 bypass (argued).** Edit is not path-limited and the sandbox covers
  only Bash, so an agent can write `.git/hooks`, `.git/config`,
  `.claude/settings.json`, CLAUDE.md or AGENTS.md; the shell's unsandboxed
  `git commit` then runs the hook, and the next agent inherits the
  settings and instructions.
- **Drift deadlock (confirmed in the extended model).** Released only
  removes the hold; the next launch re-detects drift; no command adopts
  or restores HEAD.

Also found: stale observations can release a rate-limit hold (S1);
uncommitted edits and untracked files escape the HEAD-only drift check
(S2); no single-instance lock (S3); waivers outlive their launch and
cannot name an opId that does not yet exist (S4, D4); a step with nothing
to commit has no outcome class (D2); pacing's "every known window" is
vacuously Allow with no observations (P1); waivers bypass the reserve
(C7); fresh processes still load CLAUDE.md, AGENTS.md, project settings
and auto-memory (C8); version pins disagree between documents (P6). The
model's monitor was not independent of the model and had no liveness
property; 9 of 25 mutants were missed, several of them equivalent.

### How revision 2 answers the review

Revision 3 changes are noted in the last column where they replace
revision 2's answer.

| Finding | Revision 2 | Revision 3 |
|---|---|---|
| C6 false (Release of notConverged undefined; monitor masked it) | Ruling 1: `notConverged` ends the tranche in an approval hold; no failure hold, no extra rounds. C6 restated. M2's monitor counts change-requesting reviews from events. | Unchanged; M3 (C6). |
| C9 bypass via `.git/hooks`, `.git/config`, `.claude/settings.json`, `CLAUDE.md`, `AGENTS.md` and the shell's commit | Ruling 3: protected paths with per-tranche permission; detection after every step; hooks and fsmonitor disabled. | Fix 1: filesystem digest of a wider set, clean git environment, compare before every git command. |
| Drift hold deadlock | Ruling 2: `adopt` / `restore`. M2 liveness. | Restore is a request (fix 3); incomplete restore defined (fix 7). |
| R-S1 stale observation releases a rate-limit hold | `Quota(provider, heldAt)`; release needs `observedAt > heldAt`. | Per named window, plus ingestion order (fix 8, fix 9). |
| R-S2 uncommitted edits and untracked files escape the drift check | Clean check via `git status`; `discard` = reset + clean; `abandon` restores. | Clean check reads the filesystem against the recorded revision (fixes 1, 7). |
| R-S3 no single-instance lock | `flock` plus compare-and-append. | CLI git effects run only under the lock (fix 3). |
| R-S4 / R-D4 waivers outlive their launch; opId does not exist yet | `waiverId`, bound to the next launch attempt. | Lifetime across restart defined (fix 5). |
| R-S5, R-S6, R-S7 | Finding text not saved in this repository. The first review's summary covers, without these IDs, the C6, C9 and drift-deadlock findings above and the independence, liveness and mutant findings below; the decision record's ledger S5-S7 (fresh contexts, intent before effect, distinct holds) are answered by "Context per step", "Operations, checkpoints and recovery" and "Holds". | Needs the coordinator's confirmation (open items). |
| R-D1, R-D3 | Finding text not saved in this repository. | Needs the coordinator's confirmation (open items). |
| R-D2 nothing-to-commit / commit failure has no outcome class | `NothingToCommit`, `CommitRefused`, `CommitFailed`. | Settledness defined including `Reconciled` (fix 2). |
| R-P1 "every known window" vacuously Allow | Window set from policy. | Unchanged. |
| R-P2, R-P5 | Finding text not saved in this repository; `review-2026-11-14/pace_literal.py` tested pacing edge cases on the literal rule. | Needs the coordinator's confirmation (open items). |
| R-P3 / R-P4 estimate per window; spanning resets; all-unmeasured; missing `resetsAt`; multiple readings | Estimate per role and window; latest `observedAt` wins. | Estimate wording made consistent; arrival order modeled (fixes 8, 9). |
| R-P6 version pins disagree | One source of truth in configuration. | Unchanged. |
| C7 waivers bypass the reserve | C7 restated with the waiver exception. | Unchanged; M3 (C7). |
| C8 fresh processes still load instruction files, settings and auto-memory | C8 restated. | Full load list (fix 9). |
| Monitor not independent; no liveness; mutants missed | `check(m, ev, out)`; liveness; mutation results. | Launch expectation rewritten from the text (M3); equivalence arguments backed by counters. |

## Re-review 2026-11-14 (revision 2)

A second independent reviewer (fresh Opus agent) returned **approve with
fixes**. Artifacts: `research/model/review2-2026-11-14/` (variants T1, T2,
E1 built from check2 by `mk.py`). The coordinator reproduced T2.

Fixes required before approval, in the reviewer's priority order:

1. Protected-change detection reads the filesystem, not git status: ignored
   files (`.claude/settings.local.json`), skip-worktree entries, `.git/index`,
   `CLAUDE.local.md`, `.mcp.json`, `.codex/`, `.gitattributes`, `.gitmodules`,
   linked-worktree and submodule git dirs, `include.path` targets, symlinks
   leaving the repo. Compare after every mutating step whatever its outcome,
   at startup and after CLI git effects. (E1, confirmed: a `.git/config`
   change from a failed step persists; `gpg.program` and filter drivers run
   despite disabled hooks.)
2. Startup recovery treats a reconciled operation as settled; `reconcile`
   names an opId that is currently held. (T2, confirmed.)
3. CLI commands with git effects (restore, discard, abandon) run intent-first
   under the lock, not effect-then-append.
4. Agents run in their own process group, recorded in `Intended`, killed and
   verified at startup; L4 checks for survivors.
5. Waiver lifetime across restart: text and model disagree (T1, confirmed by
   the reviewer).
6. State the one-hold invariant as a checked rule or drop the equivalence
   argument for M15, N15, N19; rerun after fixes 2 and 4.
7. Anchor changed paths to `baseRevision`; handle user edits during a step;
   define `restore` when its re-check still finds a dirty tree (nested repos).
8. Release a `rateLimited` hold only on a reading of the limiting window, the
   reset time, or a waiver; model observation order.
9. Wording: R-P3, `rate_limit_event` shape in L1, clock basis, full C8 load
   list; first-review items S5-S7, D1, D3, P2, P5 are answered in the first
   review summary above and the finding table should cite them.

### How revision 3 answers the re-review

| Fix | Where addressed | How checked |
|---|---|---|
| 1. Filesystem digest; full protected set; compare before any git command, after every step, at startup, around CLI effects; symlinks; index flags; filters and signing | "Protected paths", "Git environment", "Git probes", "Drift and the clean-tree rule", "Commit procedure", E7, L3 | Live probes (E7 table) for git behavior; M3 properties P2 (no git while an unpermitted change is on disk) and K (each compare point holds), with the E1 scenario in the grammar (counter e1); mutants R1a-R1h and N7; L3 for agents. The walk itself: argument until implemented. |
| 2. Reconciled is settled; `reconcile` names a held opId | "Startup recovery" step 3 and `reconcile` | M3 C4 ("startup held a settled operation", "unjustified reconcile"); T2 scenario counted (counter t2); mutants R2a, R2b. |
| 3. Intent-first CLI git effects | "Single instance", "Requests" | M3 G (reset only by the lock holder for a pending request with the HEAD guard), C1 (no launch while a request is pending), crash between effect and completion in the grammar; mutants R3a-R3d. |
| 4. Process group, kill and verify | "Operations" steps 2-3, "Startup recovery" step 1, L4 | M3 F4 (no surviving agent acts after a startup), mutant R4a; macOS behavior: L4. |
| 5. Waiver lifetime across restart; wording | "Waivers" | M3: the T1 scenario is in the grammar (counter t1) and the monitor expects the waiver to be used; counter W for the other-provider wording; mutants R5a and N14. |
| 6. One-hold invariant | "Holds" (H1; the global one-hold claim is dropped) | M3 H1 property and mutant R6a; most-holds counter (2). Rerun after fixes 2 and 4: M15 now killed; N15 and N19 missed and equivalent, backed by counters W, `uncertain_and_quota` and `fail_and_drift` (all 0). |
| 7. Anchor to `baseRevision`; user edits; incomplete restore | "Commit procedure", "User edits during a step", "Drift and the clean-tree rule" | Anchor and incomplete restore: M3 (nested outcome in the grammar, counter nested; D and liveness), mutant R7a. User edits: not fixed in revision 3; closed in revision 3.1 by the supervisor worktree (owner ruling 2026-11-15; "Supervisor worktree", "Commit procedure", C11, C12, worktree probes, M3 amendment 8 for `--base`, L3 and L4). Remaining: writes into the supervisor worktree itself during a step are still committed as the step's (restrictions table). |
| 8. Quota release per named window, reset time or waiver; observation order | Holds table, "Pacing" | M3 C3 and K with out-of-order readings (quota scope); mutants R8a-R8d. |
| 9. Wording | R-P3 in "Pacing"; L1; "Clock basis"; "Context per step"; provenance table; finding table | Reading. The finding table cites every first-review ID; seven of them lack saved text (open items). |

## Appendix: first-review finding texts (recorded 2026-11-14)

The first review's full report was returned as text and not saved. The
coordinator recorded these findings from it, in the reviewer's words
condensed:

- **R-S5 (confirmed):** notConverged followed by Release allowed a third
  correction in one tranche; under the literal text Release re-ran the
  review, so the reviewer could be re-rolled until it approved. The model's
  monitor masked it with a line that read model state.
- **R-S6 (argued):** C9 bypass. Edit was not path-limited and the sandbox
  covered only Bash, so an agent could write `.git/hooks` or `core.hooksPath`
  and the shell's unsandboxed `git commit` would run it with network access;
  it could also write `.claude/settings.json`, CLAUDE.md or AGENTS.md to
  change the next agent's hooks, permissions and instructions.
- **R-S7 (argued):** an abandoned commit laundered into the next tranche:
  impl success, git commit, crash, reconcile abandon left the approval hold at
  the base while HEAD was the agent's commit; approve, drift, and an adopting
  release built the next tranche on abandoned work with no record.
- **R-D1 (confirmed):** a drift hold could never be cleared: release removed
  the hold, the next launch re-detected drift, and no command adopted or
  restored HEAD.
- **R-D3 (argued):** notConverged had no defined way forward; abandon applied
  only to Uncertain holds and Release was unspecified.
- **R-P2:** waivers bypass the reserve, so C7's "allowed only if the estimate
  fits" was false as stated.
- **R-P5:** an observation that releases a hold must postdate the hold
  (same mechanism as R-S1).

## Owner ruling 2026-11-15: agents run in a supervisor-owned linked worktree

The owner adopted the coordinator's recommendation to close fix 7's
remaining gap: foreman runs every agent step in its own linked worktree on
its own branch, separate from the owner's working copy, so the owner's
edits can never be committed as an agent's step. The owner brings a
tranche's work into their branch when approving it. Revision 3's text is
to be updated to match before the final review.

Applied in revision 3.1: "Scope", "Architecture", "Single instance", the
new "Supervisor worktree" (location, branch, creation, git variables,
startup check, removal, drift, delivery, next base), the holds table,
"Launch attempt", "Drift and the clean-tree rule", "Operations" (working
directory, commit procedure, user edits), "Protected paths" (`.git` file,
per-worktree files, shared common directory), "Git environment",
"Worktree probes", "Startup recovery", "Requests" (`BaseRequested`),
"Permissions", "Context per step", provenance, claims D, C11 and C12, M3
amendment 8, restrictions, L3, L4 and open items. On delivery the
supervisor moves nothing of the owner's: the owner fast-forwards or
cherry-picks, and `approve --base` sets where the next tranche starts.

## Owner rulings 2026-11-15: usage ledger, scheduling, durable workflows (for revision 4)

Requirements stated by the owner, to be designed in revision 4 together with
revision 3.1, then reviewed once:

- **Per-project allocations** of each provider's usage windows, expressed as
  percent of that provider's windows, with an unallocated reserve for
  personal use outside foreman. Unused allocation may be borrowed up to a
  configurable ceiling; the reserve is never borrowable.
- **One foreman per target repository**, all instances sharing one usage
  ledger.
- **Periods per provider and window**, each identified by its reset time;
  providers have independent reset times; detected or manual resets open a
  new period. Timers may only tighten policy, never loosen it.
- **Spend-down:** a recorded override such as "Claude to 95% by its reset",
  per provider, ending automatically at that provider's reset.
- **Decoupled stages:** a durable, bounded queue between implementation and
  review per project, so whichever provider has headroom keeps working; the
  scheduler is deadline-aware per provider (earliest reset first) within
  each provider's short-window rate.
- **Role-swap suggestions:** foreman may suggest swapping implementer and
  reviewer when one provider's headroom expires sooner and the other is the
  bottleneck; a swap takes effect only on a recorded owner command.
- **Running ahead uses a pre-approved backlog (option a):** the owner may
  approve a short queue of upcoming tranches; approval still gates each
  tranche, ahead of time; no speculative work.
- **Durable workflows:** evaluate `effect/workflow` (Workflow, Activity,
  DurableQueue, DurableDeferred, DurableClock) with `effect/cluster`'s
  SingleRunner and SQL storage as the durable layer, replacing hand-built
  log and recovery where it fits. The owner accepts that these modules are
  marked `@stability unstable` in effect 4.1.x; their journey to stability
  must be tracked (see AGENTS.md).
- **Measurement:** per-step token usage from each client's run report,
  converted to window percent with rates learned by recursive least squares
  from readings; the residual is outside usage. Per-step budget caps where
  the client supports them (Claude's run budget limit; Codex unknown until
  L2).

Applied in revision 4: "Usage ledger" (store and coordination, periods,
allocations and borrowing, measurement, budget caps, admission rule,
spend-down), "Stages, review queue and scheduler", "Pre-approved backlog"
(with the answer to 3.1's `--base` question), "Role-swap suggestions",
"Durable layer: effect/workflow evaluated" (recommendation: replace
nothing in the first version), and edits to "Scope", "Architecture",
"Holds", "Launch attempt", "Pacing", "Operations", "Startup recovery",
classification, provenance, claims C1, C2, C7 and C13-C21, model check
M4, restrictions, L1, L2, L3c, L4 and open items.

## Owner rulings 2026-11-15 on revision 4

- The owner approved revision 4 and agreed with the durable-layer
  finding: foreman keeps its hand-built log and recovery on SQLite.
  effect/workflow and effect/cluster run activities at least once with
  automatic retries, accept the first completion of a durable deferred
  without a match check, and give the durable queue no bound; foreman
  needs the opposite of each. The stability tripwire stays so the
  question can be reopened.
- The owner asked whether another engine (DBOS was named) would fit
  better. Open question for the final review: any durable-execution
  engine that replays steps after a crash conflicts with C4, because an
  agent step is an external effect that only the owner may rerun. The
  coordinator's recommendation is to build on the primitives already in
  the design (SQLite transactions, write-ahead intent, a single-writer
  lock) unless an engine is found that never replays a step on its own.
  DBOS's step semantics have not been checked against its source.
- Review queue bound: default 1 (no work on a tranche before the one
  below it is reviewed), configurable per project to 2, the setting the
  owner would use for a spend-down across providers with different reset
  times. Coordinator's recommendation, adopted pending the final review.
- Lender protection: adopt readiness leases in the ledger, so a project
  that is ready to launch can reserve its own allocation and other
  projects cannot borrow it at that moment.
- Defaults in revision 4's table are confirmed.
