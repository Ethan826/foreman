# Agent supervisor: short design

2026-11-14. Status: DRAFT. Revision 6 (awaiting re-review), 2026-11-15.
Revision 6 applies the owner's ruling recorded in
[the admission contract](2026-11-15-admission-contract.md): admission is
pacing over foreman's own records; a safety guarantee in provider
terms is outside the design. It bounds foreman's launches and reservations, given its records;
it does not keep the provider's count below the cap or preserve the
reserve. At the defaults, without the owner's `ledger retire`, foreman
makes at most 4 Claude launches on the five-hour window until a retire
(about 2 per period), about 2 to 4 in an unattended night, and at most 4
in a weekend on the weekly window ("Unattended launches", under
"Admission rule"). The conditional-safety analysis is research only
("Research: conditional admission safety (not a design claim)"). "How
revision 6 answers the admission contract", at the end, maps each ruling
point and contract item to its change. The re-review of revision 5.2
found it not ready (see "Re-review 2026-11-15 (revision 5.2)"). The
re-review of revision 5.1 found it not ready (see "Re-review
2026-11-15 (revision 5.1)"); "How revision 5.2 answers the re-review",
at the end, maps each of its findings and each of the owner's
requirements for revision 5.2 to its change and check, or says why it
stays open. A passing model check supports only the rules it models,
within its bounds, and a `bun run check` pass says nothing about whether
the design is ready. The re-review of revision 5 found it not ready (see "Re-review 2026-11-15
(revision 5)"); "How revision 5.1 answers the re-review", at the end,
maps each finding to its change and check, under the owner's terms for
revision 5.1. Revision 4's final review found it not ready (see "Final
review 2026-11-15 (revision 4)"); "How revision 5 answers the final
review" maps each finding to its change and check. Revision 1
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
The owner has approved only a first code slice (project setup, Domain
types, Format decoders and the pure pacing function; see `AGENTS.md`). No
other implementation, live model call or message send is approved.
Decision record: [standalone direction](2026-11-14-agent-supervisor-decision.md).

Labels used throughout, by where each is defined:

- S1-S12 and N2: the decision record's ledger. First-review finding IDs
  (S1-S7, D1-D4, P1-P6) are prefixed "R-" to keep the two apart; their
  texts are in the appendix.
- Ruling 1 to ruling 3: the owner's rulings of 2026-11-14 on the first
  review, summarized in the table under "How revision 2 answers the
  review". Fix 1 to fix 9: the required fixes listed under "Re-review
  2026-11-14 (revision 2)".
- E1-E7: "Research results used here". L1-L4, L3c and L3r: "Live tests
  needed before relying on the design". F1 and F2: "Later improvements".
- C1-C22, D and L: "Claims ledger". H1: "Holds". M2 to M5.2: the model
  checks (M2 is kept in `research/model/check2.py`; M3, M4, M5, M5.1 and
  M5.2 have sections under the claims ledger).
- Revision 5.1: rule P is under "Reconciling readings, grants and
  charges" (its assumptions A1-A4 moved to the research section in
  revision 6); owner decisions O1-O6 are under "Open
  items"; properties AS, LK and ND are M5.1's.
- Revision 5.2: rule P is restated under "Reconciling readings, grants
  and charges"; owner decisions O7-O9 are under "Open items"; property
  TC is M5.2's.
- Revision 6: assumptions A1-A5, properties AS and TC, counterexamples
  T1, T2 and T2s and candidates R1 and R2 are under "Research:
  conditional admission safety (not a design claim)"; contract items
  M1-M6 are the admission contract's "Text and model mismatches"; owner
  decisions O10-O13 are under "Open items"; C22 is in the claims
  ledger.

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
| E2 | Claude has no documented usage read that is guaranteed not to start a model turn. Statusline input has `rate_limits.five_hour` and `seven_day` (`used_percentage`, `resets_at`) after responses; stream-json has `rate_limit_event`. | statusline doc (fields checked); agent SDK TypeScript reference. |
| E3 | `/usage` sent as a prompt returns a structured `usage_report` (experimental shape) only with a login that has profile scope; a `setup-token` credential does not qualify by default. Whether it spends allowance is undocumented. | agent SDK TypeScript reference (checked). |
| E4 | Codex app-server documents `account/rateLimits/read` (used percent, window length, reset time) as an account method separate from turns. Not run. | learn.chatgpt.com/docs/app-server (method checked). |
| E5 | Claude `-p` defaults to manual mode, which denies unapproved actions; `dontAsk`, `--permission-prompts none`, allow/deny rules and an OS sandbox with `failIfUnavailable` are documented. Codex documents `--sandbox read-only / workspace-write` and approval policy `never`. | permission-modes and sandboxing docs (checked); Codex approvals doc. |
| E6 | Exit codes do not distinguish rate-limit exhaustion on either CLI. Classification must use result subtype, error fields and rate-limit events. | headless doc; Codex non-interactive doc. |
| E7 | Git runs repository-configured programs even with hooks and fsmonitor disabled: a clean filter ran during `git status` and `git add`; `gpg.program` ran during `git commit --no-verify`. A clean environment with `GIT_ATTR_SOURCE` set to the empty tree, `commit.gpgsign=false` and `core.fsmonitor=false` stopped all of them except a filter declared in `.git/info/attributes`. | Probes on git 2.50.1 (Apple Git-155), 2026-11-14, in a scratch repository; listed under "Git probes". |

## Architecture (S9)

- Domain: identifiers (`TrancheId`, `OpId`, `Revision`, `WaiverId`),
  steps, outcomes, observations, holds, requests, events. Plain data.
- Features: one pure function `decide(state, event) -> (state,
  commands)` plus the pure pacing and classification functions below.
  Total over every state and event. The protected-path rule is a pure
  function of the approval record, the recorded protected digest and the
  current one. Revision 4 adds pure functions for scheduling and
  admission (see the revision-4 sections below); the rate fit's update is
  pure too, and its state lives in the ledger (revision 5).
- Format: decoders for Claude stream-json and Codex JSONL, the
  handoff file, and the stored event records.
- Runtime (Effect): process launch in a new process group, SQLite
  event store with the conditional append, the instance lock, clock, the
  protected-set walk and digest, worktree creation, git reads and the
  commit/reset procedures (all in the clean git environment below, against
  the supervisor worktree), the notifier (a log notifier in the first
  version), and, from revision 4, the shared ledger store and the review
  worktree, which gets the same clean check and drift rule as the
  supervisor worktree (revision 5).
- Program: wires capabilities into use cases.
- Facade: CLI commands `status`, `approve` (optionally `--base`), `reconcile`, `waive`,
  `release`, `release-protected`, `adopt`, `restore` (with `--review`
  from revision 5), `run`, and from revision 4 `backlog`, `roles`,
  `spend-down` and `ledger` (with `ledger settle` from revision 5).
  Converts input
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

- Where it lives. `<stateDir>/worktree`, where `<stateDir>` is the
  directory that holds the SQLite database and the lock file
  (configuration). It is outside the owner's checkout: a linked worktree
  nested inside the checkout shows up there as an untracked directory
  (probe), and Claude would load the owner's checkout's `CLAUDE.md` as a
  parent-directory file (see "Context per step").
- Branch. `foreman/<name>`, `<name>` from configuration. Git refuses
  to check out that branch in another worktree and refuses `git branch
  -f` on it while the supervisor worktree has it checked out (probe), so
  the owner cannot move it by accident from their checkout; `git
  update-ref` on it is not refused and is caught as drift (probe).
- Creation. The first `run` for a repository, after taking the lock
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
- How git is run against it. Every shell git command for the
  supervisor's tree runs with `GIT_DIR=<gitDir> GIT_WORK_TREE=<path>
  GIT_COMMON_DIR=<commonDir>` from `WorktreeCreated`, added to the clean
  environment under "Git environment". In a linked worktree `.git` is a
  file naming the git directory; with these variables a rewritten `.git`
  file does not redirect the shell (probe: plain git followed the
  rewritten file, git with the variables did not). The owner's checkout
  is only read: `rev-parse HEAD` at creation. Revision names given to
  `approve --base` are resolved in the common directory, which shares
  refs with the owner's checkout.
- Startup check. Each startup checks that `git worktree list
  --porcelain` lists the recorded path on the recorded branch, locked; if
  not, `run` stops and reports.
- Removal. The supervisor never removes the worktree or its branch.
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
| `Quota(provider, windows, heldAt)` | pacing says Hold or Unknown at a launch attempt (`windows` = the policy windows without a usable allowing reading), or a `rateLimited` outcome (`windows` = the window the rate-limit event names, else every policy window of the provider) | for every window in `windows`, the newest reading of that window is post-hold (`observedMono` after the hold's `heldMono` in the same boot, and its ledger `seq` above the hold's `ledgerSeq`; see "Pacing") and allows; or `Waived(provider, waiverId)` from the CLI (fix 8). Revision 5.1: the release at a passed reset time is not adopted (owner decision O4) |
| `Uncertain(opId)` | startup finds an unsettled operation (rules below) | completion of `reconcile <opId> discard` or `abandon`, or `Reconciled(opId, accept)`, naming that held opId (fix 2) |
| `Failure(opId, class)` | a classified failure other than rate limit, a refused commit (head moved), or a commit failure | `Released(opId)` from the CLI |
| `Drift(worktree, expected, head, dirty)` | a launch attempt finds the supervisor worktree's HEAD different from the recorded revision, or that worktree dirty; or, before a review, finds the review worktree's HEAD different from the revision under review, or that worktree dirty (revision 5; the owner's checkout is never consulted) | for the supervisor worktree, `Adopted(revision)` or the completion of a `restore` request that found the tree clean; for the review worktree, the completion of a `restore --review` request (reset to the revision under review and clean), since a review worktree's HEAD is never adopted |
| `Protected(paths)` | a protected-digest compare finds a change the tranche does not permit (fix 1) | `release-protected`: re-digests and releases if the files match the recorded digest again; `release-protected --accept` records the current digest as the new baseline and releases |

Clock ticks and notifier timeouts never release any hold. Revision 3.1
made one exception, a quota hold dropping a named window once its reset
time passed; revisions 5.1 and 5.2 do not adopt it (owner decision O4 in open
items). A quota hold now ends only by a post-hold reading that allows,
which after a reset means a reading of the new period, or by a waiver. An approval
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
2. Settle this project's grants (revision 5.1; see "Grant lifecycle"):
   cancel each grant whose `grantId` no `Intended` names, and charge each
   grant whose operation has `Finished` and no `Charged`, at the amount
   "Grant lifecycle" gives. This touches only the ledger and runs no git
   command. If the ledger write fails, the attempt ends with nothing
   launched and the next attempt retries.
3. If any hold other than a quota hold exists, append a refusal. The
   armed waiver, if any, expires.
4. Compare the protected digest (no git command has run yet). On a change
   not permitted, create `Protected` and stop.
5. Read the supervisor worktree's HEAD and tree state against the
   recorded revision (below). If HEAD differs or the tree is not clean,
   create `Drift` and stop. When the candidate the scheduler would try
   first is a review, check the review worktree the same way against the
   revision under review after checking it out (revision 5).
6. If a waiver is armed for provider `p`, the attempt launches the first
   candidate of provider `p` in deadline order with the waiver: rules 1
   and 2 of the admission rule are not checked, and the launch still
   takes a `Grant` at its estimate, so its use counts against every later
   admission. If the project has no candidate of `p` (roles may have
   changed since the waiver), the waiver expires unused and the attempt
   goes on to step 7.
7. Otherwise the scheduler (see "Stages, review queue and scheduler")
   takes the candidates in order, skips those under a quota hold for
   their provider, and launches the first that passes the admission rule;
   if none passes, it creates `Quota` for the first refused by rule 1
   (naming the blocking windows), or waits.

Steps 3-7 each consume or expire the armed waiver.

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

- `adopt` records the supervisor worktree's current HEAD as the
  expected revision (`Adopted(revision)`). It compares the protected
  digest first and is refused while that tree is dirty: whoever changed
  it commits or restores first. The current step continues on the
  adopted revision; a review then reviews that commit too.
- `restore` appends `RestoreRequested(expected, atHead)` (fix 3). The
  lock holder performs it in the supervisor worktree: digest compare,
  `git reset --hard <expected>` and `git clean -fd`, then the clean check
  again. A clean tree appends `Restored(expected, atHead)`, which releases
  the hold; `atHead` keeps the moved HEAD findable (also in the
  supervisor branch's reflog).
- Restore that leaves a dirty tree (fix 7). `git clean -fd` leaves
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
step of that provider, its `Intended` record holds the `waiverId` and
pacing is not consulted; if the attempt is refused (another hold, a
protected change, drift), the waiver expires unused. A crash or restart
does not expire it, because it is a fact in the log and no launch attempt
has happened; this lets the user waive while `run` is stopped and then
start it. It never lasts past one attempt.

The waiver names a provider, and it is applied only to a step of that
provider (launch attempt step 6). Revision 4's argument for this, that no
event changes the step while a hold exists, is false since quota holds
became per provider and roles can change by `RolesSet`: a Claude step may
launch under `Quota(codex)`, and a swap can leave the project with no
candidate of the waived provider. Revision 5 therefore binds the waiver
to its provider explicitly; with no candidate of that provider the waiver
expires unused. A waived launch takes a `Grant` like any other, and it
skips every part of rule 1, including the check that the reading's
period has not passed. `waive` is refused while a waiver is already
armed. Only a hold other than a quota hold stops a waived launch; a
quota hold on another provider does not. M3's
counter W and its N15 argument covered the 3.1 rules only; M5 (scope
stages5, property WV) checks the revision-5 rule with per-provider holds
and swaps. Waivers do not name an opId, because the opId does not exist
until `Intended` is appended.

## Pacing (S3, S4)

Revision 6 follows the owner's ruling of 2026-11-15, recorded with the
contract review that led to it in
[the admission contract](2026-11-15-admission-contract.md): admission is
pacing based on observations, estimates and reservations. It bounds
foreman's own launches and reservations, given foreman's records. It
does not keep the provider's count below the cap, and it does not
preserve the reserve for the owner's own use. "What admission bounds and
what it does not", under "Admission rule", states both halves, and the
unattended-launch estimates follow it. The analysis of when admission
would be safe in provider terms is research only (see "Research:
conditional admission safety (not a design claim)").

`pace(observations, now, policy, provider, estimate) -> Allow | Hold |
Unknown`, pure.

Definitions (from the admission contract; each names its clock):

| Term | Definition | Clock |
|---|---|---|
| Capture (as-of) | The moment the provider took the count. Foreman cannot see it: `rate_limits`, `rate_limit_event` and the Codex read include no as-of time. | Provider time |
| Observation | Foreman (stream line, Codex response) or the statusline script receives the reading and records `observedMono`, the boot id and `observedAt`. | `CLOCK_MONOTONIC` plus `kern.bootsessionuuid`; the wall clock for display only |
| Ingestion | The ledger write that gives the reading its `seq`. | Ledger `seq` |
| Freshness | `nowMono − observedMono ≤ F` (F = 10 minutes), same boot | Monotonic |
| Period membership | A later reset time (by more than `resetTolerance`) opens a period, an earlier one is dropped, and anything else joins the current period. | Provider reset time against the Mac wall clock (A4) |

Freshness measures how recently foreman observed a reading. It says
nothing about when the provider captured it: a fresh reading may report
a count taken at any earlier time, and no reading includes that time. The
wall clock enters in two places only, both of which can only tighten: a
reading whose reset time has passed (`now ≥ resetsAt`) is unusable, and
reset times sort readings into periods.

- An observation is `{provider, window, usedPercent, resetsAt,
  observedAt, observedMono, bootId, seq, source}`. `resetsAt` may be
  absent (R-P4).
- The windows checked are the provider's windows listed in policy
  (default Claude: five-hour and weekly; Codex: from live test L2) rather
  than the windows that happen to have readings (R-P1). With no
  observations the result is Unknown.
- For each window, the reading used is the highest `usedPercent` among
  the readings of the window's current period, stale ones included. A
  late reading that is lower than one already ingested therefore never
  lowers the figure. If the provider's count can fall within a period
  (A3 fails; the vendors do not document it either way), the highest
  reading overstates the count, which only refuses launches.
- The window is usable when its current period has at least one fresh
  reading and the period's recorded reset time, if any, has not passed.
  A reading without `observedMono` and the boot id, or from another
  boot, is recorded and may raise the period's highest reading, and is
  never fresh. How foreman and the statusline script read the monotonic
  clock is a proposal (see "Proposal: clock acquisition (awaiting owner
  approval)"); that the clock agrees across processes on one boot is
  unverified and belongs to L4.
- Allow iff every policy window is usable and the level (see
  "Reconciling readings, grants and charges") plus `estimate(window)` is
  at most the cap. Hold if a usable window fails that test. Otherwise
  Unknown.
- `estimate(window)` is per role and per window (R-P3): take the role's
  last five finished steps; among those measured in that window, the
  largest measured increase; if none of the five is measured in that
  window, `initialEstimate` (default 15 points). A step is measured in a
  window when a usable reading observed before the step started and one
  observed after it ended both have `resetsAt` and share the same value
  (no reset in between). "Before" and "after" compare `observedMono`
  with the step's own monotonic start and end stamps in the same boot,
  never the wall clock (contract item M6; finding 5 of the re-review of
  5.2); a step with a bracketing reading from another boot is
  unmeasured. A running agent can still use more than its estimate.
- Policy is configuration, read at startup and recorded with every
  pacing decision: windows per provider, reserve per provider and window
  (defaults 30 percent of the five-hour window, 40 percent of the weekly
  window), freshness (default 10 minutes) and `initialEstimate` (default
  15 points). Defaults confirmed by the user on 2026-11-14; the reserve
  must stay configurable. Revision 4 moves the reserve to the shared
  ledger, where a spend-down can set another cap for one period (see
  "Usage ledger"). The reserve is a margin in the cap, `100 − reserve`;
  it is not room set aside that foreman can promise to leave unused.

Clock basis (fix 9; revisions 5.2 and 6). Freshness and the post-hold
test use the monotonic clock with the boot id, and ledger order uses
`seq`. A reading counts as post-hold only if its `observedMono` is later
than the hold's `heldMono` in the same boot and its ledger `seq` is
greater than the hold's `ledgerSeq`: the ledger's newest `seq`, read
just before the hold is appended and recorded in it. After a reboot no
reading is post-hold until a new one is observed. `observedAt` is for
display.

Quota-hold release (R-S1, fix 8): see the holds table. A reading
observed before the hold, even one ingested after it (a late statusline
line), never releases it. A reading of another window never releases
it. The clock never releases it (revision 3.1's release at a passed
reset time is owner decision O4, which revision 6 does not adopt).

Feedback loop (requested by the user on 2026-11-14):

- Every observation and every launch decision is an event in the log.
  For each finished step the shell records, per window, the usage
  reading closest before and after it (by the monotonic clock, as above),
  so each step leaves a measured cost per window (or "unmeasured" under
  the rule above).
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

- Codex: `account/rateLimits/read` through a short-lived app-server
  process before each Codex launch (E4), pending the live test L2.
- Claude (source b approved by the user on 2026-11-14): (a)
  `rate_limit_event` from the supervisor's own stream-json output (shape
  to be recorded in L1; until then it is decoded only as "rate limited,
  window not named"); (b) an opt-in line added to the user's statusline
  script that appends `rate_limits`, with the script's own observation
  stamps, to an observation file each time any interactive session
  responds; (c) `/usage` as a prompt, only if live test L1 shows it
  spends nothing.

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
  `periods`, `reserves`, `allocations`, `spendDowns`,
  `spendDownCancellations`, `grants`, `charges`, `grantCancellations`,
  `retirements`, `rateUpdates`; revision 6 names `retirements`, which
  revision 5.2 used without listing it). `charges` and `grantCancellations` each have a unique
  key on `grantId`, and a grant may appear in only one of the two (checked
  inside the writing transaction). Each project's log keeps its own
  review queue, backlog, roles and suggestions.
- Ledger order (finding 2 of the re-review). Each row in each ledger
  table has a `seq` column, a ledger-wide sequence number. The writing
  transaction reads the one-row table `ledgerSeq`, gives its rows the
  next numbers, and updates `ledgerSeq`, all inside its `BEGIN
  IMMEDIATE` transaction. SQLite allows one writer at a time: `BEGIN
  IMMEDIATE` takes the database's write lock when it starts, and holds
  it to commit or rollback, so no two transactions that write the ledger
  overlap. Each therefore reads the `ledgerSeq` its predecessor
  committed, and `seq` order is the order in which transactions
  committed, a total order over every row of every table. A rolled-back
  transaction leaves no rows and no gap in use. Row ids are not used for
  ordering: SQLite numbers them per table. Wherever this design orders a
  ledger row against a hold or another ledger row, it compares `seq`.
- Every ledger write is one `BEGIN IMMEDIATE` transaction. SQLite takes
  the write lock when such a transaction begins, so two instances'
  admissions run one after the other: each reads the totals and appends
  its grant inside the same transaction. No instance leads; an instance
  waits for another only on that lock (`busy_timeout`, default 5
  seconds; a timeout ends the launch attempt with nothing launched, and
  the next attempt tries again).
- Admission reserves before it spends (the escrow method below). The
  instance appends `Grant(grantId, project, opId, provider, estimate per
  window, period sequence numbers, issuedAt)` to the ledger, then
  `Intended(..., grantId)` to its own log. The two databases share no
  transaction (SQLite does not make a commit across attached databases
  atomic in WAL mode). "Grant lifecycle" below says how every grant is
  settled, including when the second append fails or the process dies
  between the two.
- The ledger has no log-position check: each transaction re-reads
  everything it decides on. The project log keeps its lock and
  compare-and-append as in 3.1.

### Grant lifecycle (revision 5.1)

A grant is *open* from its `Grant` row until it is *settled* by exactly
one of `Charged(grantId, endedAt, tokens, amount per window)` or
`GrantCanceled(grantId, cause)`. `endedAt` is the shell's wall clock when
the step's process was known to have ended: when it exited (copied from
`Finished`), or, for a process that was killed, when `kill(-pgid, 0)`
first reported the group gone. A canceled grant counts nothing, because
its step never launched.

The charge amount (revision 5.1, owner's term 1). `amount` is the step's
actual use only when its run report supplies an authoritative measurement
in the quota's own units (percent of that window). Token counts and
dollar costs are not such a measurement, and no run report is known to
include one: L1 and L2 are to look. Until one is found, `amount` is the
grant's estimate in every mode, so a `Charged` row never lowers the
level below what the open grant counted. The token counts are still
recorded, for the fit. This is the conservative choice; what it costs is
under "Reconciling readings, grants and charges". If L1 or L2 finds an
authoritative field, `amount` becomes that field and nothing else changes.

Grant and operation identifiers (finding 6). Every grant
has a fresh `grantId`, and every admission decision mints a fresh `opId`
with it, so no two grants share an `opId`. The orphan test is by
`grantId`: a grant of project `j` is an orphan when no `Intended` in
`j`'s log has its `grantId`.

Every path that leaves a grant open is closed by a rule that runs in
ordinary operation as well as at restart:

| Path | Rule | When it runs |
|---|---|---|
| `Intended`'s compare-and-append loses a race (another writer appended to the project log after the fold) | Before re-folding, the instance appends `GrantCanceled(grantId, lostRace)` in its own ledger transaction. If that succeeds it decides again, and a new launch takes a new grant and a new `opId`. | At once, in the same launch attempt |
| That cancellation fails (busy timeout or another write error) | The launch attempt ends with nothing launched. No `Intended` has the grant's `grantId`, so the settle step of the next launch attempt cancels it as `orphan`. | Step 2 of the next launch attempt (also startup) |
| The process dies after the lost race and before the cancellation | The same orphan, canceled by startup's settle step, or by `ledger settle` if the project is never restarted. | Startup step 5, or the owner's `ledger settle` |
| Crash between `Grant` and `Intended` | An orphan, as above. | Startup step 5, then every launch attempt |
| Crash between `Finished` and `Charged`, or the charge write fails | `Finished` records `endedAt` and the token counts, so the settle step appends `Charged` from it. The unique key on `grantId` makes a repeated charge a no-op. A failed charge ends nothing else: the cycle goes on, and the next launch attempt (or the final settle step when `run` has no work left, below) retries. | Step 2 of the next launch attempt, startup, `ledger settle` |
| Crash between `Intended` and `Finished` | Startup kills the process group and waits until it is gone (step 1), then charges the grant at its estimate with that `endedAt` (charges are estimates in every case). Step 1's kill has the identifier-reuse hazard noted under "Startup recovery". The operation is still held `Uncertain` for its git effect, but the grant no longer waits for `reconcile`. | Startup step 5 |
| The project's `run` is stopped for good with a grant open, including a crash mid-step that is never restarted (finding 7) | `ledger settle <project>` (owner command) takes that project's lock with `LOCK_NB` and is refused while a `run` holds it. Revision 5.2: it signals no process (the owner has not approved cross-instance termination; see "Proposal: cross-instance process termination (awaiting owner approval)"). It cancels orphans and charges each `Finished` without `Charged`. An `Intended` without `Finished` stays open, counted at its estimate, because its process may still run; the command lists it, with its recorded process group, so the owner can end the process by hand and restart the project. The command appends no hold and runs no git command. | On the owner's command; no timer settles a grant, because settling frees room and timers may only tighten |

`run` also runs the settle step once more before it exits with no work
left, so a charge that failed on the last step is retried; if the ledger
stays unwritable it reports the open grants and exits, and `ledger
settle` settles them later. A settle step whose own ledger write fails
(busy timeout or another write error) writes nothing: at a launch
attempt the attempt ends with nothing launched; at startup, step 5
stops startup and reports; `ledger settle` reports and exits.

What revision 5.2 leaves open without cross-instance termination. A
project that crashed mid-step and is never restarted keeps that step's
grant open, at its estimate, until the project starts again (startup
step 1 kills its own recorded groups, step 5 charges the grant). While
open it counts in every period at its estimate, so it costs room. If
the process is still running, its use is real and may exceed the
estimate; if it has ended, the grant overstates use until the restart.
Startup step 1 signals the recorded process group without an identity
check, which has the identifier-reuse hazard described there.

The settle step of project `j` reads `j`'s own log and the ledger, and
never another project's log. Only `j`'s lock holder (or `ledger settle`
holding `j`'s lock) issues or settles grants for `j`, so at the start of
a launch attempt any grant of `j` that no `Intended` names is an orphan;
none can belong to an admission still in progress.

Claim C20 states the result. Model check M5.1 (scope grants51, property
LK) checks it with a crash at every point listed above, a lost race
followed by a crash, failed cancel and charge writes, and `ledger settle`
on a project that never restarts; M5.2 (scope leaks52) adds two
operations per project, crashes of both projects at any point, failed
writes by the settle step itself, and `ledger settle` without
termination.

### Reconciling readings, grants and charges (revisions 5.1, 5.2 and 6)

Admission counts foreman's own reservations on top of the reading,
because the reading may not show them. It never subtracts a step the
reading may already show. Revision 5 tried that with a reflection test
(a reading taken `reflectLag` after a step's end was taken to include
it); the re-review of revision 5 showed that elapsed time is not
evidence that the provider has counted a step, and revision 5.1 removed
the test.

What would count as evidence that a reading includes a step: evidence
that the provider has counted it. Foreman has none today. The
statusline's `rate_limits`, the `rate_limit_event` and Codex's account
read report a usage figure and a reset time, with no request or step
they cover and no capture time. Neither elapsed time nor a clock reading
is evidence. One candidate is a provider that counts each request before
it answers a later request from the same account; L1 and L2 record what
can be observed, and owner decision O5 holds the proposal. Until the
owner adopts a reflection rule on such evidence, **no reading reflects
any grant**.

Which grants count (rule P, revision 5.2, unchanged in substance). For
provider `p` and window `w`, a grant of `p` *counts* when it is neither
canceled nor retired from `w`. Nothing but the owner retires a grant: no
scheduled reset time, no clock reading, no usage drop and no new period.

`ledger retire <provider> <window> --through <seq>` is an owner
attestation. It records the owner's statement that the charged grants of
`p` with `seq` at most the given value had all their use counted by the
provider in an earlier provider period, and retires them from `w`. It is
refused while any of those grants is open. Foreman cannot check the
statement and does not treat it as evidence: no reading includes a
capture time or a list of the steps it covers, so no record shows when the
provider counted a step, and without a bound on the provider's delay no
sound criterion exists for the owner either (contract, "Retirement and
unattended cost"). `status` lists each retirement as the owner's
attestation. If the owner does not issue it, the charged grants keep
counting, and foreman's unattended launches are those under
"Unattended launches" below. How a charged grant could stop counting
without the owner is decision O7; the command's form is O8.

The level. With `r` the reading pacing uses (the highest of the current
period; see "Pacing"),

    level(p, w) = r.usedPercent + Σ amount(g, w)  over grants g of p, from every project, that count

where `amount` is the estimate for an open grant and the charged amount
(the estimate, until an authoritative measurement exists) for a charged
one. Grants of every project sharing the provider account count, because
the reading is the account's. The level is a figure over foreman's own
records: one reading plus foreman's reservations. It is not the
provider's count.

What this costs (revision 5.2, finding 3 of the re-review of 5.1).
Every step counts at its estimate until the owner retires it, and a
reading that already shows a step adds the step's real use again. Take
one period with foreman's real use `u` and the sum of its estimates `E`
(`E ≥ u` while no step exceeds its estimate). Near the cap the reading
shows about `u` of foreman's use (plus outside use) and the level adds
`E`, so rule 1 refuses once `u + E` reaches foreman's room: foreman's
real use is bounded by its share times `u / (u + E)`. That is half its
share only when estimates are exact (`E = u`), and less when estimates
exceed real use, which is the usual case, since an estimate is the
largest of the role's last five steps: with estimates twice the real
use, a third of the share. Grants still open when a period ends, and
charged grants not yet retired, count in the next period too; without
`ledger retire`, charged grants accumulate across periods until no
launch fits (figures under "Unattended launches"). The cost falls only
if the owner adopts a reflection rule backed by evidence (O5), an
automatic retirement rule (O7), or an authoritative per-run measurement
is found.

The level replaces revision 4's "newest reading plus this launch's
estimate" in rule 1 of the admission rule, in ledger mode and in
fallback alike. Revision 5.2 also stated assumptions A1-A5 here and a
provider-side property TC; revision 6 moves them, with the assumptions
the contract review added, to the research section, and no design claim
rests on them.

### Periods

A period is one instance of a provider's window, keyed by a sequence
number per provider and window, `(provider, window, periodSeq)`, with
its reset time recorded beside it.

- A new period opens only when an ingested reading has a reset time
  later than the current period's by more than `resetTolerance` (default
  5 minutes). The opening appends `PeriodOpened(provider, window,
  periodSeq, resetsAt, mode)`, with `periodSeq` one more than the
  current one and `mode` the rate mode for the whole period (see
  "Measurement").
- Period membership follows the definition under "Pacing": a reading
  whose reset time is earlier than the current period's by more than
  `resetTolerance` belongs to an earlier period and is recorded and never
  used; any other reading that opens no period joins the current one,
  with or without `resetsAt`, and can only raise that period's highest
  reading.
- A usage drop opens no period. A reading of the current period lower
  than its highest by more than `dropTolerance` (default 5 points) is
  recorded and shown by `status` as a possible reset; the window keeps
  the period's highest reading. A drop cannot tell a reset from a
  delayed reading arriving late. For a provider whose readings lack a
  reset time, the window keeps its highest reading until a reading with
  a later reset time arrives; the owner's paths meanwhile are a waiver
  or a spend-down (decision O9).
- What a new period changes. The level's reading term becomes the new
  period's highest reading. Nothing else changes: a reset, a new period,
  a drop or a passing reset time frees no accounting room. Every grant
  that counted before still counts, and only a canceled grant or an
  owner's `ledger retire` stops one counting.
- The clock passing a reset time can only tighten: readings of the old
  period become unusable (as under "Pacing"), a loosening spend-down for
  that period ends, a role-swap suggestion that depends on it expires,
  and launches for that window wait for a reading of the new period.
  Nothing ends or is released on the clock if that would loosen policy;
  a tightening spend-down ends only at a new period or by `--cancel`.
  This is the owner's rule that timers may only tighten policy.
- No quota hold is released by the clock. Revision 3.1 released one
  once the reset time of every window it names had passed; that is owner
  decision O4, which the body does not adopt. The hold is released by a post-hold reading
  that allows, as for any other post-hold reading.

Revision 6 removes the owner command `ledger reset`. In revision 5.2 it
opened a period on the owner's word, which let the window's reading term
start over; the contract review showed that this loosened on readings
captured before the reset (T1), and its candidate repair R1 made the
command loosen nothing. A command that changes no decision is a marker,
and a marker adds a record kind, a membership exception (readings
observed before the command) and a claim with nothing to gain. Removing
it is simpler: only a reading with a later reset time opens a period.
The owner's own word still has two paths that are explicitly
loosening and logged as such, a waiver for one launch and a spend-down
for one period.

### Allocations, reserve and borrowing

These settings live in the ledger, so every instance reads one copy.
`ledger reserve <provider> <window> <percent>` and `ledger allocate
<project> <provider> <window> <percent> [--ceiling <percent>]` append
them.

- `reserve(p, w)` is the share of window `w` of provider `p` meant for
  personal use outside foreman. It lowers foreman's cap; foreman cannot
  keep it free, since it neither sees the owner's use in time nor
  bounds a step's use. The 3.1 per-project reserve moves here,
  with the same defaults (30 percent of the five-hour window, 40 percent
  of the weekly window).
- `alloc(j, p, w)` is project `j`'s share. The transaction refuses a
  change that would make the allocations of `p, w` plus its reserve exceed
  100.
- `ceiling(j, p, w)` is the most project `j` may use in a period,
  borrowing included: `alloc ≤ ceiling ≤ 100 − reserve`. It defaults to
  the allocation, which means no borrowing.
- `use(j, p, w)` is the sum of the amounts of project `j`'s grants that
  count in the current period under rule P ("Reconciling readings, grants
  and charges"; revision 5.1, finding 8): the estimate of each open grant
  and the charged amount of each charged one, including grants from
  earlier periods that the owner has not retired (revision 6; finding 6
  of the re-review of 5.2). Foreman's use is the sum over projects.

A project borrows when its use goes above its allocation. It may do so
while its use stays within its ceiling and foreman's use stays within the
sum of allocations, so borrowing only takes allocation that other
projects' grants do not count against. No project's ceiling exceeds the
cap `100 − reserve`. The reserve is a margin in that cap over foreman's
records; it is not a guarantee that the owner's own use fits. Two owner commands can spend it: a waiver (one launch, 3.1) and a
spend-down (one period, below). A lender gets no protection: allocation
borrowed early in a period stays counted until the owner retires the
borrower's grants (restrictions table). The owner ruled for lender protection by readiness leases; the
lease design and its alternatives are in "Proposal: readiness leases
(awaiting owner approval)", and none of it is part of this design until
the owner approves it.

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
  every foreman step, from every project, that ran entirely between the
  two readings (started after the first reading's `observedAt` and ended
  at least `fitLag` before the second's), plus the elapsed hours; `e` is
  noise. A pair that overlaps any foreman step not entirely inside it is
  left out of the fit. Revision 4 credited a step's tokens to the interval
  it finished in, which puts usage from one interval into another and
  biases θ; dropping overlapping pairs avoids that at the cost of fewer
  pairs while steps run back to back (this selection rule is invented;
  flagged). `fitLag` is revision 5's `reflectLag`, renamed in revision
  5.1 because it now serves only the fit: a pair it admits wrongly biases
  an estimate and never decides an admission. Its value is owner
  decision O3. The fit is recursive least squares with forgetting factor λ
  (default 0.99), one update per pair. The token coefficients convert
  tokens to percent; the elapsed-hours coefficient is the average rate of
  outside usage.
- Where the fit lives (revision 5). The fit's state (θ, the matrix P,
  the noise estimate, the pair count) is in the ledger, so every instance
  reads one copy. The instance that ingests a reading completing a pair
  appends `RateUpdated(provider, window, pairId, θ, P, σ², n)` in the
  same transaction; `pairId` is unique, so a pair is fitted once
  whichever instance sees it.
- Residual: for each pair, `Δu − θ_tokens · x_tokens` is the usage
  outside foreman in that interval (the owner's own sessions on the same
  account). `status` shows it per period.
- Convergence: a provider window's rates are used once at least
  `minPairs` (default 10) pairs with nonzero tokens have been fitted, every
  token coefficient is positive, and the relative standard error of the
  predicted charge of a typical step is at most `maxRelError` (default
  0.2). The covariance of θ is taken as `σ² · P`, where `σ²` is the
  exponentially weighted mean, with the same λ, of the squared a-priori
  prediction errors. Scaling P by a residual variance is the usual RLS
  practice (Ljung and Söderström, 1983); the choice of this estimate, the
  "typical step" and the three thresholds together form an invented test
  (flagged).
- Mode per period (revision 5). Whether a window is in ledger mode or in
  fallback is decided when its period opens, from the newest
  `RateUpdated`, and recorded in `PeriodOpened(..., mode)`; it does not
  change within the period. Convergence reached mid-period takes effect
  at the next period, so ledger mode never starts with every project's
  use near zero after uncharged fallback launches; a convergence that
  later breaks also takes effect at the next period. All instances read
  the same row, so they agree on the mode.
- Fallback: a window in fallback is admitted by rule 1 alone (the level
  under "Reconciling readings, grants and charges", against the ledger's
  reserve). Grants are still taken and settled, at the estimate, so
  rule 1 sees every project's steps that count under rule P; allocations
  and ceilings are not checked for that window. Steps still record their
  tokens, so the fit keeps learning.
- Charge and estimate (revision 5.1): a finished step's charge is its
  grant's estimate in every mode (see "Grant lifecycle");
  `θ_tokens(w) · tokens` estimates its use, is shown by `status`, and is
  never charged. The admission estimate is the
  charge of the largest token count among the role's last five finished
  steps (3.1's sliding maximum, now taken over tokens), or
  `initialEstimate` when there are none.

Budget caps per step. Where a client accepts a budget for one run, the
step is launched with one. Claude documents a budget limit for print-mode
runs; L1 records the flag, its unit and whether it stops a step
mid-turn. If the cap's unit is one the run report also gives, foreman
fits it like tokens and sets the cap to `capFactor` (default 1.5) times
the step's admitted headroom (the smallest remaining room over the
provider's windows), converted with the learned rate. This sizing rule
is invented (flagged); the budget flag itself is the client's. A dollar
budget does not measure subscription allowance (owner's term for
revision 5.1): it may stop a runaway step, and its figure is never
charged as use. Otherwise no cap is
set and admission bounds the launch only, as in 3.1. Codex has no known
cap until L2. A step stopped by its cap is classified `budgetExceeded`,
which creates a `Failure` hold.


### Admission rule

A step of project `j` for provider `p` may launch only if, for every
policy window `w` of `p`:

1. Pacing allows with cap `cap(p, w)`: pacing has a usable reading `r`
   (otherwise the answer is Unknown) and `level(p, w) + est(w) ≤ cap(p,
   w)`. The level is the highest reading of the current period plus the
   estimate of every unretired, uncanceled grant of `p`, from every
   project (see "Reconciling readings, grants and charges"). `cap(p, w)`
   is the level of a spend-down active for that window, and otherwise
   `100 − reserve(p, w)`.
2. Allocation, only when `w` is in ledger mode for its current period
   and no loosening spend-down is active on it (one whose level is above
   `100 − reserve(p, w)`): `use(j, p, w) + est(w) ≤ ceiling(j, p, w)`, and
   foreman's use plus `est(w)` is at most the sum of allocations of `p, w`.

The holds must also allow it (see "Holds"). A failure of rule 1 creates a
`Quota` hold, as in 3.1. A failure of rule 2 creates no hold; the
scheduler tries its next candidate, and if none passes the project waits.

What admission bounds and what it does not (revision 6). Given foreman's
records, admission bounds foreman's own launches and reservations: no
launch other than a waived one is admitted unless the highest usable
reading of the current period, plus the estimate of every grant that
counts, plus this launch's estimate, is within the cap. A grant stops
counting only when it is canceled (its step never launched) or the owner
retires it. Admission does not bound:

- The provider's count. A reading may have been captured long before
  foreman observed it, and the owner's own use after the capture is in
  no record, so the provider's count at launch can exceed the level by
  any amount.
- A step's use. A running step can use more than its estimate, and
  charges are estimates, so the excess is never recorded.
- The reserve. The reserve lowers the cap; whether the owner's own use
  fits in it depends on the provider's delay and on the owner, and
  foreman can neither observe nor enforce either.

The research section states the assumptions under which the provider's
count would stay within the cap, and the counterexamples to the weaker
versions; none of them is adopted.

Unattended launches (from the admission contract; figures at the
defaults: five-hour cap 100 − 30 = 70, weekly cap 100 − 40 = 60,
estimate 15). A launch needs `r + 15n + 15 ≤ cap`, where `n` counts
unretired grants across all projects and periods, and `r` is the
window's reading:

- Five-hour window: `n ≤ (55 − r)/15`, so at most 4 launches in total
  until the owner issues `ledger retire`, however many periods pass.
  Within one period, with sequential steps whose real use equals the
  estimate, 2 launches; at half the estimate, 3.
- An unattended night: about 2 to 4 Claude launches, mostly in the
  first period.
- Weekly window: `n ≤ (45 − r_w)/15`, so 4 launches at `r_w = 0`, 3 at
  15, 2 at 30, none above 45. This applies to a whole weekend, so a
  weekend gets at most 4 Claude launches, and fewer once the owner's own
  weekly use shows.

These are the price of counting every step at its estimate until the
owner attests that it is retired. A waiver or a spend-down raises them
for one launch or one period on the owner's word.

What frees room (revision 6). Rule 1 starts passing again through a new
reading (which may be a reading of a new period), a canceled grant, an
owner's `ledger retire`, a loosening spend-down or the cancel of a
tightening one. Rule 2 starts passing again through a canceled grant, a
`ledger retire`, an allocation change or a loosening spend-down. A
`Charged` row frees nothing while charges are estimates, and a new
period frees no accounting room (see "Periods"). Each is a ledger row.
An instance notices another instance's commit through SQLite's `PRAGMA
data_version`, which changes when another connection commits; it polls
that value every `dataVersionPoll` (1 second proposed, unapproved, under
O3), a timer that only asks and decides nothing, and its scheduler runs
again when the ledger's newest `seq` has changed (a row id is numbered
per table and cannot stand for the ledger's last change). Readings need
a source, so while a project has a candidate waiting on rule 1 or 2 or
under a quota hold, its lock holder asks for a reading where one exists
without a model turn: Codex's `account/rateLimits/read` every
`readInterval` (its value is owner decision O3: 5 minutes is proposed
and unapproved; L2 confirms the read starts no turn). A reading may
loosen policy; the timer that asks for it decides nothing. Claude has no
such read (E2), so a waiting Claude step wakes only on a statusline
line, another project's ledger row, or the owner (waiver, spend-down,
allocation change, retirement). Liveness in M4 and M5 assumes readings
keep arriving; for Claude that holds only while the owner uses Claude
interactively.

### Spend-down override

`spend-down <provider> [--window <w>] --to <percent>` appends
`SpendDown(provider, window, level, periodSeq)` to the ledger. `window`
defaults to the provider's longest policy window and `periodSeq` is that
window's current period. The command is refused when the window has no
usable reading or a spend-down is already active on it. While it is
active, rule 1 uses `level` as that window's cap. A level above `100 −
reserve` loosens: rule 2 is skipped for that window, since the owner has
chosen to spend foreman's share down regardless of allocations. A level
at or below `100 − reserve` tightens, and rule 2 stays in force, so a
tightening spend-down never lets a project borrow beyond its ceiling.

A spend-down is active only while the window's current period is
`periodSeq`. A tightening spend-down does not end on the clock (revision
5.1, finding 4); a loosening one also ends when the clock passes that
period's reset time, since ending it tightens. A spend-down therefore
ends at a new period (opened by a reading with a later reset time), at
the reset time if it loosens, or with `spend-down <provider> [--window <w>] --cancel`,
which appends `SpendDownCanceled(provider, window, periodSeq)` (refused
when none is active; `window` defaults as above). Canceling a loosening
spend-down tightens; canceling a tightening one loosens, and only the
owner can do it. The provider's other windows keep their rules: a weekly
spend-down leaves the five-hour reserve in force. M5 (scope stages5,
property SD5) checks the two kinds and `--cancel`; M5.1 runs the same
scope with the revision-5.1 end rule.

## Stages, review queue and scheduler (revision 4)

### Review queue

Each project has a review queue: tranche results waiting for review,
oldest first, each `(tranche, trancheBase, revision)`. A successful
implement step's commit (or its `NothingToCommit`) appends
`ReviewQueued`; a correction's commit replaces its tranche's entry at the
head. The queue is a fold of the project log, so it survives a crash as
the rest of the log does.

Bound and backpressure. `reviewQueueBound` is 1 by default and may be
set to 2 per project (owner ruling on revision 4). An implement step may
launch only while the queue length plus one is at most the bound. With
bound 1, the default, the cycle is 3.1's: the next tranche starts only
after the previous one has left the queue, and nothing is ever stacked or
unwound. With bound 2 one pre-approved tranche may be implemented,
stacked on the previous tranche's unreviewed result, while that result
waits for review; the owner would choose it for a spend-down across
providers whose reset times differ.

Review worktree. Reviews run in a second linked worktree,
`<stateDir>/review`, detached at the revision under review. It is created
like the supervisor worktree (`git worktree add --lock --detach`), and
before each review the lock holder checks out the revision there in the
clean git environment, with the review worktree's own recorded `GIT_DIR`,
`GIT_WORK_TREE` and `GIT_COMMON_DIR`, and runs the clean check. Its
`.git` file and its per-worktree git directory join the protected set.
Stacking needs this worktree: the supervisor worktree's HEAD can be ahead
of the tranche under review. Every review runs there, with bound 1 too,
so one rule covers both bounds. The reviewer's working directory is the
review worktree, whichever client reviews, and its profile stays
read-only. A review worktree whose HEAD is not the revision under review,
or whose tree is dirty, creates `Drift(review, ...)` at launch attempt
step 5; `restore --review` resets it (holds table). Its path is not the
supervisor worktree's, so a client's auto-memory keyed by path differs
between the two (see "Context per step").

Unwinding. When the review of the head tranche requests changes, ends in
`notConverged`, or the tranche is abandoned, every tranche stacked above
it is unwound before anything else runs. The lock holder performs
`UnwindRequested(target, atHead)`, where `target` is the head tranche's
latest revision, exactly as a restore (digest compare, HEAD guard, `git
reset --hard`, `git clean -fd`), then appends `Unwound(tranches, atHead,
target)`. The unwound tranches leave the queue, their pre-approvals are
armed again, and their commits stay findable through the log and the
reflog. The correction runs next, or the approval hold stands. With bound
1, the default, nothing is ever stacked and nothing is unwound.

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

Order: by provider reset time. A candidate's key is its provider's
reset time for the longest policy window, the period whose unused share
is lost at the reset; the earliest key goes first. A provider without a
known reset time sorts last, and a tie goes to the review, which drains
the queue. This resembles earliest deadline first, but it is not that
algorithm: EDF orders jobs by each job's own deadline, and here every
candidate of a provider shares that provider's reset time, which is a
deadline for unused allowance rather than for any job. The rule is an
invented heuristic (flagged), and no optimality result carries over. The scheduler
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

Sources: grants are escrow reservations (O'Neil, "The Escrow
Transactional Method", 1986); the bounded queue with backpressure is the
bounded buffer (Dijkstra, 1965), a work-in-progress limit in Kanban
terms; the rates are recursive least squares (Plackett, 1950; Ljung and
Söderström, 1983). Allocations and ceilings borrow the names rate and
ceil from the hierarchical token bucket (Devera, HTB, 2002) but not its
behavior: an HTB class borrows bandwidth its parent has spare at that
moment, and tokens refill, so the lender loses nothing; here a borrower
takes part of a per-period budget that does not refill, which the lender
may need later in the period. Borrowing under a per-period budget is
therefore invented (flagged). The candidate order is an invented
heuristic (above).

## Pre-approved backlog (revision 4)

The owner may approve upcoming tranches before they start: `backlog add
<tranche> [--allow-protected] [--stop-before]` appends
`PreApproved(tranche, permits, stopBefore)` to the project log. The
backlog holds at most `backlogMax` (default 3) entries, in order. `backlog
remove <tranche>` appends `BacklogRemoved(tranche)` and withdraws an
entry whose implement step has not been intended; it is refused for a
tranche that has started (the owner stops later work at the next approval
hold instead, or with `reconcile abandon`). Revision 4 let `remove` unwind
a stacked tranche; with bound 1 as the default nothing is stacked, and
the refusal keeps removal free of git effects. Removal withdraws only the
entry, of either kind; a live approval already given for that tranche
still stands. A tranche has at most one entry, and `--stop-before`
entries count toward `backlogMax`. An unwind re-arms a stacked tranche
as a plain entry, without `--stop-before`.

- Each tranche still needs its own approval to start: a live `Approved`
  (3.1) that releases the previous tranche's approval hold, or its own
  `PreApproved` entry without `--stop-before`. No tranche starts unless
  the owner named it.
- A `--stop-before` entry is never an implement candidate by itself
  (revision 5, finding 6): with bound 2 it is not stacked before the
  previous review passes. The passing review of the tranche before it
  creates the approval hold, and the live approval of that hold uses the
  entry; the tranche then starts as approved live.
- Which `permits` apply when a live approval and a pre-approval both
  cover a tranche: the live approval's, since it is the owner's later
  word. A live approval uses up the tranche's backlog entry.
- A tranche that ends with a passing review creates no approval hold if
  the next tranche is pre-approved without `--stop-before` or has already
  started; the next tranche starts, or carries on if stacked. Otherwise
  the 3.1 approval hold is created.
- `notConverged` and `abandon` always create the approval hold, whatever
  the backlog holds, and unwind stacked tranches. The backlog stays, but
  nothing starts until the live approval.
- A pre-approval is used when its tranche's implement step is intended.
  An unwind arms it again, and so does `Reconciled(opId, discard)` of
  that implement step (revision 5, finding 11): the discarded step is
  relaunched under a new opId, and it needs an unused approval like any
  implement launch. The same holds for a live approval.

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
has not approved. With the default bound 1 no tranche runs on an
unreviewed base. A project set to bound 2 runs approved work on an
unreviewed base, and an unwind can discard that work; the owner chooses
this per project (ruling on revision 4).

## Role-swap suggestions (revision 4)

The scheduler computes a suggestion at each launch attempt of a project,
from the same ledger view. It suggests swapping the implementer (with the
corrector) and the reviewer when all of these hold:

1. One provider B is the bottleneck: the project has a candidate for B
   that failed admission or sits under a `Quota(B)` hold, or the review
   queue is full and B is the reviewer.
2. The other provider A's longest-window reset comes before B's.
3. A's headroom in that window, its cap minus its level (revision 6;
   revision 4 used the newest reading), is at
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
is unchanged by a swap. A swap needs four profiles in all (see
"Permissions"): Claude editing and Codex read-only for the default
roles, Codex editing and Claude read-only for the swapped ones. Each is
marked verified in configuration only after its live test (L3, L3c, L3r).

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
  `hooks/`, `info/` (probe: a filter declared in the common
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

- Prevention: the editing profile denies `Edit`/`Write` on the
  protected set and allows `Edit`/`Write` only inside the supervisor
  worktree; the
  Bash sandbox's write allowlist excludes them. Whether the sandbox can
  exclude a subdirectory of the working directory is to be shown by L3.
- Detection: the digest compare above. A change without permission is
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
| owner: `git merge --ff-only foreman/t`, `main` unmoved | fast-forward |
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
   and reports it; `run` does not continue. This step is not safe as
   written (finding 7 of the re-review of 5.2; admission contract,
   "Startup signaling"): `Launched` records only the pgid, with no
   identity check, and a process group id is reused once the group is
   gone, so a startup after a reboot or long after the crash can signal
   an unrelated process group, or another project's live agent. The
   identity rules that would fix it (leader pid, start time and boot id,
   or a per-operation `flock` marker; no signal after a different boot;
   per-pid signals after enumeration; report and hold when identity
   cannot be verified) are a proposal awaiting the owner (see "Proposal:
   startup signaling identity (awaiting owner approval)"), and the
   hazard is open item O12. C10 and C20 rest on this step.
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
5. Settle this project's ledger grants (revision 5.1; see "Grant
   lifecycle"): cancel each grant whose `grantId` no `Intended` names;
   charge each grant whose operation has `Finished` and no `Charged`,
   whatever its class and whether or not a commit outcome follows; and
   charge each grant whose operation has `Intended` and no `Finished` at
   its estimate, with `endedAt` the moment step 1 found its process
   group gone. A successful mutating step with `Finished` and no commit
   outcome is therefore held `Uncertain` in step 3 for its git effect and
   charged here, because its use is over (finding 9). After this step no
   grant of the project is open. If a ledger write fails, startup stops
   and reports, as step 1 does.

The shell may show the commit with that `Op-Id` as evidence, but it
does not resolve the hold itself. `reconcile <opId> <resolution>` is
accepted only for an opId that currently has an `Uncertain` hold and no
pending request:

All three act on the supervisor worktree and branch. None of them
writes the ledger (revision 5.1): startup step 5 has already charged
the operation's grant (revision 5.2: `ledger settle` leaves a grant
without `Finished` open, so startup step 5 charges it).

- `discard`: a request (below) to `git reset --hard <baseRevision>` and
  `git clean -fd`; its completion appends `Reconciled(opId, discard)` and
  the step runs again under a new opId. A discarded correction relaunched
  is the same round. A discarded implement step's approval is armed again
  (see "Pre-approved backlog").
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
  with the review worktree as working directory (revision 5; revision 4
  named the supervisor worktree here).
- Codex implement and correct, after a swap only: `codex exec --sandbox
  workspace-write -c approval_policy="never"` in the supervisor worktree,
  verified by L3c before use.
- Claude review, after a swap only: `--permission-mode dontAsk
  --permission-prompts none`, allow `Read` inside the review worktree,
  `git status`, `git diff` and `git log`; deny `Edit`, `Write`, web tools
  and `curl`; sandbox as for the editing profile with no writable path.
  Verified by L3r before use.
- No bypass flag anywhere.

### Pinned client versions (R-P6)

The pinned versions live in one place, the supervisor's configuration
file (`clients.claude.version`, `clients.codex.version`). The supervisor
runs each client's `--version` at startup and refuses to start when it
differs. Documents cite the configuration rather than a number. The research
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
`<stateDir>` and above; the owner's checkout and its parents are not among them. And
Claude's auto-memory is keyed to the worktree's path, apart from the
owner's interactive sessions (L3 confirms both). The review worktree has
its own path, so a client that both implements and, after a swap,
reviews uses two auto-memory directories; neither is the owner's. The protected set covers
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
npm tarball; paths are under its `src/`. Revision 5 checked every file
and line citation below against the installed `node_modules/effect`
(version 4.1.4, `src/` present): eighteen matched, and two were corrected
in place (the SQLite insert and the SQLite lock rows).

Semantics found:

- Activities run at least once. The engine stores each activity call
  as a persisted request whose primary key is `name/attempt`
  (`cluster/ClusterWorkflowEngine.ts:948-957`, key built at `:1057`). The
  SQL storage ignores a second insert with the same key (`INSERT OR
  IGNORE` for SQLite, `cluster/SqlMessageStorage.ts:418-424`; `:393` is
  the Postgres form), and a stored reply is replayed
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
  retried while its attempt count is at most 10, with exponential backoff
  capped at 10 seconds between tries (`Activity.ts:193-217`).
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
  (`cluster/SqlRunnerStorage.ts:213`, inserted at `:355-361`; the header
  at `:1-10` covers only Postgres, MySQL and PGlite); with in-memory runner storage two
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

## Defaults

Every default the design names, in one place (the owner's ruling on
revision 4 confirmed those of revision 4; the rows marked revision 5 are
new and need the owner's confirmation). All are configuration.

| Setting | Default | Where |
|---|---|---|
| `maxCorrectionRounds` | 2 | Scope |
| reserve, five-hour window | 30 percent | Pacing, Usage ledger |
| reserve, weekly window | 40 percent | Pacing, Usage ledger |
| freshness | 10 minutes | Pacing |
| `initialEstimate` | 15 points | Pacing |
| ledger path | `~/.foreman/` | Usage ledger |
| `busy_timeout` | 5 seconds | Usage ledger |
| `resetTolerance` | 5 minutes | Periods |
| `dropTolerance` | 5 points (a drop is only shown by `status`) | Periods |
| λ | 0.99 | Measurement |
| `minPairs` | 10 | Measurement |
| `maxRelError` | 0.2 | Measurement |
| `capFactor` | 1.5 | Measurement |
| `reviewQueueBound` | 1, per project 2 allowed | Review queue (owner ruling on revision 4) |
| `backlogMax` | 3 | Pre-approved backlog |
| `swapThreshold` | 20 points | Role-swap suggestions |
| `fitLag` (revision 5's `reflectLag`, which revision 5.1 no longer uses for admission) | not set: 5 minutes proposed, owner decision O3 | Measurement |
| `readInterval` | not set: 5 minutes proposed, owner decision O3 | Admission rule |
| `dataVersionPoll` | not set: 1 second proposed, owner decision O3 | Admission rule |

## Proposal: readiness leases (awaiting owner approval)

The owner ruled on revision 4 for lender protection by readiness leases.
Nothing in this section is part of the design yet: the body above still
describes borrowing without lender protection, and no claim, model or
restriction depends on a lease. The section sets out the lease design
next to standard alternatives so the owner can choose.

The problem. Under "Allocations, reserve and borrowing", project B may
borrow project A's unused allocation while A has nothing ready. The
budget is per period and does not refill, so if A gets work later in the
same period, the allocation B used is gone until the reset.

Option 1, no lender protection (the current body). Borrowing is limited
only by the borrower's ceiling and the sum of allocations. Source: none
needed beyond the allocation rule. Cost: a lender can be starved for the
rest of a period by early borrowing; the ceiling bounds how much.

Option 2, no borrowing (static partitioning). Set every ceiling equal to
its allocation, which the design already allows. Source: fixed
partitioning of a shared resource, the textbook baseline. Cost: any
allocation a project does not use is lost at the reset; nothing new to
build or check.

Option 3, accrual by token bucket. Each project's allocation becomes
available gradually over the period, as a token bucket refilled at the
allocation divided by the period length (Turner, 1986; the leaky and
token bucket of traffic shaping), and others may borrow only what has
accrued and is unused. Source: published. Cost: the refill is a timer
that makes room, which the owner's rule that timers only tighten
forbids; adopting it needs an explicit exception. It also limits a
lender's own early work.

Option 4, readiness leases (the ruled direction). Invented (flagged); the
parts and their sources:

- A project whose scheduler has a candidate for provider `p` that the
  holds allow appends `Lease(project, provider, window, amount,
  periodSeq)` to the ledger, with `amount` the candidate's estimate,
  capped by the project's unused allocation. This is a reservation in
  the sense of admission control (resource reservation before use, as in
  RSVP, Zhang et al., 1993), but RSVP's reservations are soft state that
  expires on a timer, which this design cannot use. Invented adaptation.
- Rule 2 then also refuses a borrowing launch (one that takes the
  borrower's use above its allocation) whose estimate exceeds the sum of
  allocations minus foreman's use minus every other project's unused
  lease. The lease amount comes out of what borrowers may take, and never
  out of the reserve. Invented.
- A lease ends only through an event: its holder's launch (the grant
  replaces it), its holder's next launch attempt finding no candidate for
  `p`, a new period, or `ledger settle <project>` for a stopped project.
  It never ends on a timer, because ending it makes room. A lease is
  not a lease in the sense of Gray and Cheriton (1989), whose leases
  expire by time; only the name is shared.
- Cost: a ready project that cannot launch for another reason (a quota
  hold on its other window, its own ceiling) keeps borrowers out while it
  waits, so allocation may go unused at the reset; a crashed project's
  lease blocks borrowing until it restarts or the owner runs `ledger
  settle`. It adds a ledger table, an admission clause, two release
  rules, a claim and a model scope.

What approval would need: the owner's choice among the four; for Option 4
or 3, a claim, model check properties (a lender with a lease is never
refused for lack of room that a borrower took; no lease or refill timer
loosens anything except as approved) and mutants, before the body
changes.

## Proposal: cross-instance process termination (awaiting owner approval)

Nothing in this section is part of the design until the owner approves
it. The owner ruled on 2026-11-15 that `ledger settle` may not kill
another instance's process groups. Revision 5.1 had it do so with only
`Launched(opId, pgid)` recorded, and the re-review of 5.1 (finding 2)
showed why that is unsafe: a process group id is reused once the group
is gone, so a kill days later can hit an unrelated process or another
project's live agent, and nothing was written to the project's log, so
its next startup would signal the same id again. The body of revision
5.2 has `ledger settle` signal nothing. These are the requirements a
proposal would have to meet.

Process identity. macOS has no pidfd, so a pid or pgid alone never
identifies a process over time. Two published ways to bind one:

- The leader's pid plus its start time, read with `proc_pidinfo(pid,
  PROC_PIDTBSDINFO)` (`pbi_start_tvsec`, `pbi_start_tvusec`), recorded
  in `Launched` with the boot id. A process matches only if pid, start
  time and boot id all match.
- A per-operation marker file, `<stateDir>/ops/<opId>.lock`, opened by
  the launched leader and held with `flock(LOCK_EX)` for its lifetime
  (inherited by its children only if they keep the descriptor). A
  process that holds the marker's lock is the operation's; the lock
  vanishes with the last holder, so a reused pid cannot hold it. The
  cost: it needs a small wrapper as the group leader, and a child that
  closes inherited descriptors drops out of the test.

Ownership and locking. Only the holder of the owning project's lock may
signal that project's groups: `ledger settle <project>` takes the
project's lock with `LOCK_NB` and is refused while a `run` holds it
(lock contention means a live `run` owns the processes, which then
settle them itself). The ledger and the project log are read under that
lock, so no new `Launched` can appear meanwhile.

Signaling. Before any signal, enumerate the group's members
(`proc_listpids(PROC_PGRP_ONLY, pgid)`) and verify every member: under
the first option, the leader by pid, start time and boot id, and each
other member by a start time no earlier than the leader's and a parent
chain into the group; under the second, each member holds the
operation's marker lock (checked with `proc_pidinfo` file descriptor
listing or by a `flock` probe that fails). On any mismatch, signal
nothing, report the operation and the mismatching pids, and leave the
grant open. Only then send `SIGKILL` to each verified pid (not to
`-pgid`, which would reach members that joined after verification) and
wait until none is left, with a timeout that stops and reports.

Durable end record. Before signaling, append `EndRequested(opId,
identity)` to the owning project's log; after the group is gone, append
`Ended(opId, endedAt)` there, and only then charge the grant in the
ledger. Startup step 1 skips every operation with `Ended`, so it never
signals the same identity again, and treats an `EndRequested` without
`Ended` as a kill to redo with the same verification.

Failure and recovery cases a proposal must cover:

- A crash during the kill: `EndRequested` without `Ended`; the next
  `ledger settle` or startup verifies again and finishes, or reports a
  mismatch.
- A partial kill (some members gone, one survives the timeout): no
  `Ended`; the grant stays open and the report lists the survivor.
- Lock contention: the command is refused and signals nothing.
- Reused identifiers: the identity check fails; the command signals
  nothing and reports the operation; the owner decides whether the step's
  process is gone and may append `Ended` with an explicit command.
- A failed charge after `Ended`: the settle step retries it, as for any
  `Finished` without `Charged`.

Model work before approval: extend scope leaks52 with pid reuse, a crash
between `EndRequested` and `Ended`, and a member that fails
verification, with properties "no signal reaches a process outside the
operation" and LK. M5.2's second leaks52 run (amendment 7) checked the
revision-5.1 kill-and-charge rule without reuse; it is not evidence for
this proposal.

## Proposal: clock acquisition (awaiting owner approval)

Nothing in this section is part of the design until the owner approves
it (owner ruling 2026-11-15: the clock helpers and the `bun:ffi`
dependency are proposals). The body needs `observedMono` and the boot
id on every reading and every hold; this is how the admission contract
proposes to get them, measured with Bun 1.3.6 on the owner's Mac
(evidence in `research/model/contract-2026-11-15/`, `clock-run.txt`):

- In Bun: `bun:ffi` `dlopen` of `/usr/lib/libSystem.B.dylib`, then
  `clock_gettime_nsec_np(6)` (`_CLOCK_MONOTONIC`). Calls after the first
  are effectively free. `bun:ffi` would be a new dependency and needs a
  dependency-intake record.
- In the statusline script: a ten-line C helper (`mono.c`) at about 1.9
  ms per call including fork, printing the monotonic value and the boot
  id. `python3 -c` costs about 32 ms.
- Boot id: `sysctl -n kern.bootsessionuuid`, read once per process.
- Forbidden for ordering or freshness: `process.hrtime` (it counts from
  about process start under Bun), `performance.now`, `Date` and the
  shell's `date`.
- Agreement across processes is unverified and belongs in L4.

Until a mechanism is approved, no reading has `observedMono`, so no
reading is fresh and every launch is Unknown (a waiver per launch). This
is open item O11.

## Proposal: startup signaling identity (awaiting owner approval)

Nothing in this section is part of the design until the owner approves
it. Startup recovery step 1 sends `SIGKILL` to a recorded process group
with no identity check. The admission contract ("Startup signaling")
proposes the rules of the termination proposal below for it:

- Record the leader's pid, its start time (`proc_pidinfo`
  `PROC_PIDTBSDINFO`) and the boot id in `Launched`, or hold a
  per-operation `flock` marker.
- Never signal a recorded group after a different boot.
- List members with `proc_listpids(PROC_PGRP_ONLY)` and signal each
  verified pid, never `-pgid`.
- When the leader has died and its children were reparented, start-time
  and parent-chain checks cannot succeed; only the marker identifies
  them. Without a marker, report and hold.
- The window between check and signal cannot be closed on macOS.
  Re-read the start time after signaling and report a mismatch, or rely
  on the marker, whose lock vanishes with its holder.
- When identity cannot be verified: signal nothing, write an
  `Uncertain` hold, leave the grant open (it keeps counting), and stop
  `run` until the owner records the step as ended. `EndRequested` and
  `Ended` records keep a later startup from signaling the same identity
  twice.

The last rule changes C20: a grant could then stay open after startup
until the owner records the step as ended. Model work before approval is
the same as the termination proposal's (pid reuse, a crash between
`EndRequested` and `Ended`, a member that fails verification). Open item
O12.

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
| Pacing against windows with a reserve | None found; threshold admission control over reported usage | Invented; flagged. Revision 6 claims only a bound over foreman's records |
| Quota release per named window by a post-hold reading, or by a waiver (revision 6: the release at a reset time is O4, which stays open) | None found; follows from the pacing rule | Invented; flagged |
| Estimate as maximum of recent measured costs | Sliding-window maximum (textbook) | Faithful |
| Waiver bound to the next launch attempt | None found; a one-shot capability token consumed on use | Invented; flagged |
| Drift check, `adopt`, `restore` | `git ls-tree`, `git hash-object`, `git ls-files`, `git reset --hard`, `git clean` | Faithful use of git |
| Commit through a temporary index and `update-ref` with the old value | Git plumbing; compare-and-swap on a reference | Faithful use of git |
| Protected-change detection | File-integrity checking against a recorded baseline of digests (Kim and Spafford's Tripwire, 1994), over a direct filesystem walk | Adapted: the baseline is updated by the shell after its own git effects and by permitted steps |
| Git environment hardening | Git's documented environment variables and `-c` overrides | Faithful use of git; coverage shown only by the probes listed |
| Agent containment by process group, with a kill verified at startup | POSIX process groups (`setpgid`, `kill(-pgid)`) | Faithful; a child that leaves the group escapes it (restriction) |
| Agents in a separate, locked linked worktree on the supervisor's branch | `git worktree add --lock -b`, `git worktree list --porcelain` (git documentation) | Faithful use of git |
| Shell git pinned to the recorded directories | `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR` (git(1) environment variables) | Faithful use of git; shown by the worktree probes |
| Worktree creation as intent, effect, completion | Write-ahead logging (ARIES), as for steps | Adapted: redo only when nothing exists yet; any other leftover stops startup |
| Delivery by the owner | `git merge --ff-only`, `git cherry-pick` or `git rebase --onto` | Faithful use of git; the supervisor runs none of them |
| Warning that a new base lacks the tranche's commits | `git cherry` (patch-id equivalence) | Faithful use of git; a warning only |
| Next tranche's base chosen at approval and applied as a lock-holder request | None found; the restore request with another target, carried by the approval | Invented composition of two rules above; flagged; M3 amendment 8 |
| Shared usage ledger; admission as one `BEGIN IMMEDIATE` transaction that reads the totals and appends a grant (revision 4) | SQLite transactions (writers serialized by the database lock); escrow reservations (O'Neil, 1986) | Adapted: grant and intent live in two databases, joined by the settle step (revision 5) |
| Grant lifecycle: cancel after a lost race, settle step at every launch attempt and startup, charge redone from `Finished` (revision 5) | Write-ahead logging with idempotent redo (ARIES); unique key as the idempotency guard | Adapted; the composition is ours; flagged |
| Admission level: reading plus every grant that counts in the period under rule P, with no reflection (revision 5.1) | Escrow accounting (O'Neil, 1986): every reservation counts until its period ends | Faithful escrow plus the reading; retirement only by the owner's attestation (revision 5.2) is ours, simple; flagged. Revision 5's reflection test is removed |
| Ledger order by a `seq` column assigned inside `BEGIN IMMEDIATE` (revision 5.1) | A log sequence number assigned under the single writer lock (ARIES); SQLite's write lock serializes writers | Faithful |
| Allocations with borrowing ceilings; a reserve no project borrows | Names from the hierarchical token bucket's rate and ceil (Devera, 2002) | Invented: HTB borrows spare bandwidth that refills, while here a borrower takes a per-period budget the lender may need later; flagged; no lender protection (see the lease proposal) |
| Periods keyed by reset time, opened only by a reading with a later reset time (revision 6) | None found | Invented; flagged |
| Timers only tighten | None found; a monotonicity rule over policy | Invented rule, simple; flagged |
| Tokens to window percent, outside usage as the residual | Recursive least squares with forgetting factor (Plackett, 1950; Ljung and Söderström, 1983) | Faithful for the fit; scaling P by a residual variance follows Ljung and Söderström; invented are the noise estimate, the convergence test (pair count, positive coefficients, relative standard error) and the rule that drops pairs overlapping a step; flagged |
| Fit state and mode in the ledger, mode fixed per period (revision 5) | None found | Invented; flagged |
| Fallback to launch-time pacing until rates converge | 3.1 pacing | Invented composition; flagged |
| Spend-down override that ends with its period | None found | Invented; flagged |
| Scheduler: candidates ordered by their provider's reset time | None; resembles earliest deadline first (Liu and Layland, 1973; Jackson, 1955), which orders jobs by their own deadlines | Invented heuristic: a shared reset time is not a job deadline, and no EDF result applies; flagged |
| Review queue with a bound and backpressure | Bounded buffer (Dijkstra, 1965); work-in-progress limit (Kanban) | Faithful |
| Stacking a pre-approved tranche on an unreviewed result, unwound when the review below asks for changes | None found; resembles stacked branches and a pipeline flush after a misprediction | Invented composition; flagged |
| Review worktree detached at the reviewed revision | `git worktree add --lock --detach` (git documentation) | Faithful use of git |
| Pre-approved backlog, `--stop-before`, re-arming after an unwind or a discard | None found; a queue of one-shot approvals used at intent | Invented; flagged |
| Role-swap suggestion | None found | Invented heuristic, advisory only; flagged |
| Budget cap per step | The client's documented run budget for the flag; the cap value (`capFactor` times admitted headroom) is ours | Flag: faithful use of the client once L1 confirms it. Sizing rule: invented; flagged |
| Readiness leases | Proposal only; see "Proposal: readiness leases (awaiting owner approval)" | Invented; flagged; not part of the design |
| Codex reading on an interval while a step waits (revision 5) | The vendor's account read (E4) | The polling rule is ours, simple; flagged |

### Standard alternatives to the parts flagged in revision 5

Each invented part of revision 5, with the closest standard choice and
what that choice would cost:

| Invented part | Standard alternative | Cost of the alternative |
|---|---|---|
| Candidate order by provider reset time | First in, first out, or a fixed priority with reviews first | Allowance that expires at a provider's reset goes unused while the other provider's work runs first |
| Borrowing a per-period budget | No borrowing: ceiling equal to allocation (static partitioning) | Any allocation a project leaves unused is lost at the reset |
| Reflection test for charged grants (`reflectLag` and the ingestion guard); removed in revision 5.1 | Pure escrow: count every grant of the period (revision 5.1 adopts this, with the reading added) | Every finished step is counted twice for the rest of its period, so foreman stops well below the cap; see "Reconciling" |
| Rule P: a finished step counts in a later period unless it ended before the previous period's reset time (revision 5.1) | Count every grant in its own period and in the next one, whatever its end time | A step that ended early in a period still takes room from the next one |
| Dropping rate pairs that overlap a step | Prorating a step's tokens by elapsed time across pairs | Assumes steady consumption within a step, which bursts of tool use break; the bias moves rather than goes away |
| Rate mode fixed per period | Mode switching at once, as revision 4 wrote | Instances can disagree within a period, and ledger mode starts with use near zero after uncharged fallback launches |
| `capFactor` sizing of a step's budget cap | No cap; admission bounds the launch only (3.1) | A runaway step is stopped only by the provider's own limit |
| Readiness leases | See the proposal section | See the proposal section |

## Claims ledger

A model check backs a claim only for the rules it models, within its
stated bounds. Passing M3, M4, M5, M5.1 or M5.2 says nothing about a rule none
of them models; each model's section lists what it leaves out. `bun run
check` passing (TypeScript, ESLint and the prose gate) says nothing about
the design; it does not clear a review finding.

Revision 6. No claim cites TC (M5.2) or AS (M5.1); both are provider-side
properties and live in "Research: conditional admission safety (not a
design claim)". What still backs a revision-6 claim: every M3 and M4
property cited below; M5 stages5's SB, BR, WV and SD5; M5.1 grants51's
LK and ND and its stages5 rerun (SD5); M5.2 leaks52's LK and ND. These
are properties of foreman's own records and decisions. Research only:
M5.1's AS and its overshoot run; M5.2 periods52's TC, its `--no-a5` run
and the mutants killed only by TC (GA8, PA1-PA5, PA7, PA9-PA12), and the
classifications of PA6 and PA8. M5 grants' RS5, DC and QR checked
revision 5's reflection rule, which is gone, and back nothing now; the
restatement checks DC, K and UK are not evidence for any claim. Where a
claim below says "argument only", no check backs it yet, and the open
items list the check it needs.

| ID | Claim | Backing |
|---|---|---|
| C1 | No launch happens while a request or a hold that blocks the step exists (a quota hold blocks only its provider's steps, revision 4), and every launch is made by the lock holder on an unchanged log position. | M3 (C1, K); M4 (C1) for quota holds per provider. |
| C2 | An approval hold is released only by an approval for the same tranche and revision; a matching approval is never refused. Revision 4: a tranche's implement step launches only with an unused approval for that tranche (live, or its own pre-approval without `--stop-before`); a passing review creates the approval hold exactly when the next tranche is neither so approved nor started; `notConverged` always creates it. Revision 5: a `--stop-before` entry alone never starts its tranche; a removed entry starts nothing; a discarded implement step's approval is armed again. | M3 (C2, K); M4 (BK); M5 stages5 (SB, BR). Re-arming after a discard: argument (no model has both crashes and approvals). |
| C3 | Ticks never release a hold and never turn Unknown into Allow; a quota hold is released only when every window it names has a newest post-hold allowing reading (post-hold by the monotonic clock and the ledger `seq`, revision 5.2), or by a waiver (revision 5.1; the release at a passed reset time is owner decision O4, which this revision does not adopt). | M3 (C3, K), with readings arriving out of order. Monotonic post-hold test: argument. Pacing arithmetic: unit and property tests later, argument for now. |
| C4 | Every launch is preceded by a durable intent; a crash with an operation unsettled produces an Uncertain hold for that opId at the next startup and no launch until it is reconciled; a reconciled operation is settled. | M3 (C4), crash at every point, including between `git commit` and `Committed`, and between a request's git effect and its completion. |
| C5 | At most one operation is in flight. | M3 (C5), with two `run` instances and late appends. |
| C6 | In a tranche, a correction is launched only after the 1st to `maxCorrectionRounds`-th change-requesting review; the review after the last correction that still requests changes ends the tranche in an approval hold, and nothing launches until that approval. | M3 (C6, C2). |
| C7 | A launch is allowed only if pacing allows it (rule 1 of the admission rule) and, for a window in ledger mode, the allocation rule allows it (rule 2), except a launch whose `Intended` records a waiver armed since the previous launch attempt. The reserve lowers the cap over foreman's records; it bounds neither usage nor the provider's count, since a running agent can overshoot and a reading can be old (revision 6). | M3 (C7). Reserve arithmetic: argument only. |
| C8 | Fresh processes load no earlier transcript; they still load the files listed under "Context per step". | Argument from E5 and the docs; L3 to confirm. Handoff sufficiency is unverified. |
| C9 | Agents cannot push, use the network, or change protected paths without the tranche's permission; no shell git command runs a repository hook, filter, fsmonitor or signing program, or runs while an unpermitted protected change is on disk. | Git part: probes (E7) and M3 (P, P2). Agent part: argument from docs; live test L3 required. |
| C10 | No agent process acts after a startup that follows a crash. | M3 (F4) for the kill-and-verify rule; L4 for macOS behavior. Revision 6: startup step 1 signals the recorded pgid without an identity check, so this claim says nothing about an unrelated process that reuses that id (open item O12). |
| D | No launch while the recorded revision differs from the supervisor worktree's HEAD or that worktree is dirty; every launch's base is the recorded revision; git effects requested from the CLI (including `approve --base`) run only by the lock holder, with HEAD at the request's HEAD or target. | M3 (D, G), with amendment 8 for `--base`; mutants R10a, R10b. The model's HEAD and tree are the supervisor worktree's. |
| C11 | Nothing the owner does in their own checkout, committed or not, enters a step's commit or a step's inputs; no supervisor process writes the owner's checkout or branches. | Argument: steps and shell git run only in the supervisor worktree with the recorded git directories, and the commit procedure moves only the supervisor branch. Worktree probes (owner's `main` and `git status` unchanged; branch protections). Not in M3, which has one tree. L3 and L4 to confirm with real agents. Exception: the shared common directory (protected digest). |
| C12 | A tranche's work reaches the owner's branch only through a git command the owner runs; approval moves only the supervisor branch, and only through a `--base` request. | Argument from the text (no supervisor command writes the owner's refs); M3 amendment 8 for the request; worktree probes for the delivery commands. |
| C13 | Pacing (revision 6): no launch other than a waived one is admitted unless every policy window of its provider has a usable reading and the highest reading of the window's current period, plus the amount of every grant of the provider, from every project, that is neither canceled nor retired, plus the launch's estimate, is at most the cap (`100 − reserve`, or the level of a spend-down active for that window's period). No reading is taken to reflect a grant; only the owner's `ledger retire` retires a grant, on the owner's attestation; no reading of an earlier period, or of a period whose reset time has passed, is used; Unknown never launches. This bounds foreman's own launches and reservations, given its records. It claims nothing about the provider's count or the reserve (see "What admission bounds and what it does not"). | Argument only: the claim restates the admission rule over foreman's records. Open checks (O13): unit and property tests of the level against a brute-force oracle over generated readings and grants, and a model scope over foreman's records alone for the revision-6 period rules. Passed reset time: M4 (RS) for revision 4's rules. Waivers: M3 (C7), M5 stages5 (WV). M5.2's TC and M5.1's AS back no part of this claim. |
| C14 | Allocations: for a window in ledger mode with no active spend-down, no launch takes its project's use above the project's ceiling, or foreman's use above the sum of allocations. While the window is in fallback, allocations are not enforced. | M4 (AL). |
| C15 | A spend-down is accepted only with a usable reading and when none is active. It is in effect only in the period it was recorded in and until `--cancel`; a loosening one also ends when that period's reset time passes, and a tightening one does not end on the clock (revision 5.1). A tightening spend-down keeps rule 2 in force. | M4 (SD, RS); M5 stages5 (SD5) for tightening levels and `--cancel`; M5.1 stages5 with the revision-5.1 end rule. |
| C16 | Periods (revision 6): only a reading with a reset time later than the current period's by more than `resetTolerance` opens a period; a usage drop opens none; a timer only tightens. A new period changes only the level's reading term: a reset, a new period, a drop or a passing reset time frees no accounting room, and every grant that counted still counts. A reading of an earlier period is never used. | Argument only. M5.2 periods52 exercised these rules but checked them only through TC (research); M4 (PD) checked revision 4's period rules, which differ. Open check: the model scope under C13 (O13). |
| C17 | The review queue never exceeds its bound, and an implement step launches only with room for its result. A change request at the head unwinds exactly the tranches stacked above it, and their pre-approvals are armed again. | M4 (QB, UW, BK). |
| C18 | Roles change only by an owner command; every launch's client follows the last owner-set roles, and its profile follows its role (editing for implementer and corrector, read-only for reviewer). | M4 (SW). |
| C19 | The scheduler launches the first candidate in earliest-deadline order that is not under a quota hold for its provider and passes admission, refuses only when none passes, and creates at most one quota hold per attempt, for the first candidate refused by pacing. | M4 (ED, H1). |
| C20 | Restated in revision 5.2. Admissions by different projects' instances are serialized by the ledger. After every settle step that succeeds, of every launch attempt of project `j` and at the end of every startup of `j`, no grant of `j` is open (no step of `j` is in flight at those points); after `ledger settle` of `j` only grants whose `Intended` has no `Finished` may stay open (no cross-instance termination); no grant is both charged and canceled; none is charged twice; none is charged while its process may still run. A lost race, a failed cancel, charge or settle write, a crash of either project at any point (including after a lost race and before its cancel) and a crash that is never followed by a restart therefore leave a grant open only until `j`'s next successful launch attempt or startup; while it is open it counts at its estimate. | M5.2 leaks52 (LK, ND) with two operations per project, both projects crashing at any point, every kind of failed write including the settle step's own, and `ledger settle` without termination (see "Model check M5.2" for the mutants); M5.1 grants51 for one operation per project with spending; serialization: argument from SQLite's `BEGIN IMMEDIATE`, modeled as an atomic admission; L4 for real crashes. Revision 6: LK and ND are properties of foreman's own records and still back this claim. ND's "none is charged while its process may still run" assumes startup step 1's kill reaches the step's process and nothing else; with its identity hazard (O12) that part is argument plus L4. |
| C21 | Rates are used only after convergence; a window's mode is fixed for each period from the fit in the ledger, so every instance sees the same mode; in fallback, admission is rule 1 alone. | Argument; unit and property tests of the fit later (RLS against a batch least-squares oracle on generated data). M4 models convergence as a one-way event that applies at once; the per-period mode is not modeled. |
| C22 | Unattended launches (revision 6, from the admission contract): at the defaults (five-hour cap 70, weekly cap 60, estimate 15), with no `ledger retire`, waiver or spend-down, foreman admits at most 4 launches of a provider on the five-hour window in total, however many periods pass (2 per period when real use equals the estimate, 3 at half); and on the weekly window 4 at a weekly reading of 0, 3 at 15, 2 at 30 and none above 45. | Argument only: arithmetic on `r + 15n + 15 ≤ cap` (admission contract, "Retirement and unattended cost"). Open check: unit tests with these figures as fixtures (O13). |
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

- recovery: one window per provider, every other event family
  (crashes, two instances, surviving agents, protected changes, requests,
  nested repositories), one real tranche, revisions 0..2, no permission.
- quota: two Claude windows and one Codex window, readings of every
  age, reset times; no protected changes or surviving agents.
- tranches: two real tranches, permission granted or not, instance A
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
and branch. `UserCommit` and `UserEdit` now stand for anything other
than the shell changing that worktree or branch. The owner's commits on
their own branch change no modeled variable. The one rule the ruling adds
is `approve --base`, so the grammar gains `Approve(t, r, a, b)` with `b` a
fresh revision (the owner's commit) or none; an accepted `--base`
approval appends a request that the lock holder performs through the
existing digest compare, the HEAD guard, the reset and its crash points, and whose
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
  - N15 (a waiver used by another provider's step) changes behavior
    only at a launch attempt whose armed waiver names another provider.
    Counter W counts every launch attempt in that situation (a superset
    of the attempts reaching the changed line): 0 in all scopes. Counter
    `uncertain_and_quota` (states holding a quota hold together with an
    uncertain or approval hold, the only holds whose release changes the
    step): 0, which is the reason W is 0.
  - N19 (Release of a failure also clears drift) changes behavior
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
itself (C21); crashes between `Grant` and `Intended` (C20, L4). M4 also
counts in-flight grants at their estimates, so it checked the escrowed
form of rule 1 that revision 5 now writes; M5 adds the rules M4 left out
(see "Model check M5").

### Model check M5 (revision 5)

`research/model/check5.py`, with `check3.py` and `check4.py` kept
unchanged; outputs `research/model/check5-run.txt` and
`research/model/mutate5-run.txt`. Same method as M4: grammar and bounds
fixed in the file's header before the first run, a monitor `check(m, ev,
out)` written from this text that sees events and outputs only, amendments
labeled with their before and after results. Passing M5 supports only the
rules it models, within these bounds.

- Scope grants: two projects with two operations each on one provider
  in fallback, so rule 1 alone decides; U = 5, reserve 1, estimate 1,
  costs 1 or 2 (project 0) and 1 (project 1), outside usage at most 1,
  one reset. Admission and its grant are one atomic step; then `Intended`
  or a lost race and its cancellation, `Finished`, `Charged`, a crash at
  any point (project 0, once), startup with the settle step and
  `Uncertain` holds, `reconcile`, readings that reflect every finished
  step and readings within `reflectLag` that reflect nothing new, stale
  readings and the reset-time release. Properties RS5 (the level never
  leaves out foreman's use), DC (the model refuses exactly when the
  written level refuses), LK (C20), QR and UK.
- Scope stages5: M4's stages scope with rates converged and allocation
  and ceiling 2 per provider so rule 2 binds, plus `--stop-before`
  entries, `backlog remove`, waivers under per-provider holds and swaps,
  tightening (level 5) and loosening (level 7) spend-downs and `--cancel`.
  Properties SB, BR, WV and SD5 beside M4's.

Five amendments: grants timed out twice (the crash and the lost race were
then limited to one project each, a reset only after the timer, and
overshoot to project 0); stages5 timed out, then reported a BR violation
whose trace was a live approval given before a removal, which the text
allows, so the monitor's BR expectation was corrected (the model was not
changed) and the rule above now says so; it then timed out twice more,
so manual resets were dropped and spend-downs and waivers limited to
Claude.

| Scope | States | Launch transitions | Violations | Liveness / strict | Coverage counters (all above zero) |
|---|---|---|---|---|---|
| grants | 2,540,706 | 92,112 | none | 0 / 325,334 | launches with another project's grant open 43,757; with an unreflected charge counted 49,298; on a lagged reading 64,187; uncertain holds 38,165; settle-step cancellations 38,165 and charges 107,099; reset-time releases 92,669 |
| stages5 | 2,685,064 | 342,508 | none | 0 / 0 | waived launches 159,792 (after a swap 75,444); expired waivers 278,440; launches under a tightening spend-down 7,388; stop-before holds 50,312; removals 666,976; unwinds 61,456 |

Strict liveness in grants counts states where the one modeled reset is
used up and the window is full, which is intended. Liveness assumes
readings and restarts keep coming (see "Admission rule").

Mutation test (`research/model/mutate5.py`): 21 mutants of the model part
only. 19 killed: other projects' open grants ignored, a lagged reading
taken as reflecting, a reflected charge counted again, no cancellation
after a lost race, startup not charging a finished step, a double charge
on redo, a launch after the reset-time release without a reading, Unknown
taken as Allow, no orphan cancellation at startup, no `Uncertain` hold,
a stop-before entry used as an approval, a live approval not using the
entry, a waiver for another provider's step, a waiver outliving its
attempt, a waiver without a hold, a tightening spend-down skipping rule
2, a loosening one keeping it, `--cancel` ignored, a removed entry used.
2 missed, both equivalent within the bounds, with state counts and
counters identical to the faithful model: GA9 (no settle step at
ordinary launch attempts; in the grammar every cancellation and charge
is written before the instance goes idle, and a crash leads to startup,
which settles, so the step never finds work; it matters only when a
ledger write times out, which M5 does not model) and BR2 (removal
accepted for a started tranche; no entry for a started tranche is
reachable). A bound-1 variant of stages5 (scope queue5) was written but
not run unmutated, and BR2's run in it timed out.

Not covered by M5: rule 2 together with the grant rules (scope grants is
fallback only); an open grant carried across a reset (the model counts
only grants of the current period, which is weaker than the text's rule
above); a ledger write that times out; Codex spend-downs and waivers;
manual resets in stages5; re-arming after `reconcile discard`; the
per-period rate mode; two windows per provider; the review worktree.

### Model check M5.1 (revision 5.1)

`research/model/check51.py`, with `check4.py` and `check5.py` and their
outputs kept unchanged; outputs `research/model/check51-run.txt` and
`research/model/mutate51-run.txt`. Same method as M4 and M5: grammar and
bounds fixed in the file's header before the first run, amendments
labeled with their before and after results, a monitor that sees events
and outputs only. New in M5.1, under the owner's term 2: the monitor
keeps its own count of the provider's use, built from the environment
events (a step using a unit, outside use, the provider's reset, a
snapshot of the count, its later ingestion), and the safety property AS
is checked against that count, apart from anything foreman records.
Passing M5.1 supports only the rules it models, within its bounds.

- Scope grants51: two projects with one operation each on one provider,
  U = 3, reserve 1, cap 2, estimate 1. Each step uses at most its
  estimate (A1), in units that the provider counts as they are used; the
  provider's period can reset once while steps run; a reading is a
  snapshot of the provider's count that foreman ingests after any number
  of other events (A2); outside use at most 1 unit. Foreman: admission
  with the level of rule P, `Intended` or a lost race (project 1) and its
  cancel, a cancel write that fails (project 1), `Finished`, `Charged` at
  the estimate, a charge write that fails (project 0), a crash at any
  point (project 0) and after a lost race before its cancel (project 1),
  a process that keeps running after its instance crashed, startup with
  kill and settle, `ledger settle` on a project that stays down, and
  `reconcile`. Properties: AS (admission safety in provider terms; see
  "Reconciling"), LK (C20), ND (no double charge, no charge while the
  process may still run), and the restatement checks DC, K and UK.
- Scope stages5: M5's scope, rerun with the revision-5.1 end rule for
  spend-downs (a tightening one survives the reset time).

Four amendments, all in scope grants51: the first three runs did not
finish (the state space grew past 3.6 million states and 2.7 GB on a
shared machine), so stale readings were dropped, project 0 lost its
second operation and the cap fell to 2, outside use was limited to one
unit in all, and project 1 crashes only after a lost race; the fourth
changed only the monitor (AS is checked at every launch, also one on an
unusable reading, and UK is labeled a restatement).

| Scope | States | Launch transitions | Violations | Liveness / strict | Coverage counters (all above zero unless marked) |
|---|---|---|---|---|---|
| grants51 | 1,636,070 | 28,506 | none | 0 / 30,293 | launches with another project's grant open 15,121; with a step from the previous period carried by rule P 4,075; on a delayed reading 18,292; quota holds refused only because finished steps are counted twice 9,687; failed cancel writes 14,627 and failed charge writes 231,702 (edges); crashes after a lost race 14,627; spending by a process whose instance crashed 10,417; kills at startup 40,646 and at `ledger settle` 40,646; settle-step cancels 14,627 and charges 231,702 at ordinary attempts; `ledger settle` 181,486; reconciles 57,858; earlier-period readings dropped 0 (not exercised) |
| stages5 (revision-5.1 end rule) | 2,685,064 | 342,508 | none | 0 / 0 | the same counts as M5's run: while a reset time has passed, rule 1 refuses every launch on that provider, so the two end rules differ only in whether `--cancel` is accepted then; launches under a tightening spend-down 7,388 |

Overshoot run (`--overshoot`, A1 dropped: project 0's step may use twice
its estimate): AS fails after 72 states. Trace: a reading of 0, project
0 launches (level 0 plus 1 is within the cap of 2), project 1 launches
(level 0 plus project 0's open grant plus 1 is 2); project 0's step can
then use 2, and the provider's count reaches 3. No admission rule can
prevent this without a per-run limit in quota units, so C13 depends on
A1, and L1 and L2 must measure it.

Mutation test (`research/model/mutate51.py`, scope grants51): 15 mutants
of the model part only, each run with `--safety-only`, so a mutant counts
as killed only by AS, LK, ND or liveness, never by a restatement check
(finding 10). Killed by AS: other projects' open grants left out of the
level (GA1); a charged step taken as reflected by the reading (GA2,
revision 5's reflection test at its loosest); an open grant counted only
in its own period (GB1); a step spanning the reset not carried (GB2,
revision 5's rule); startup charging before the kill (GB4; the check that kills it is
tagged AS in check51.py but is ND's condition, no charge while the
process may still run; corrected in revision 5.2, nit 8). Killed by
LK: startup not charging a finished step (GA5); no settle step at
ordinary attempts (GA9, which M5 missed: a failed write now leaves a
grant open in ordinary operation); startup not canceling orphans (GA10);
`ledger settle` leaving a mid-step grant open (GB3, revision 5's rule).
Killed by ND: a grant charged again on redo (GA6). Missed, each with its
reason: GA4 (no cancel after a lost race) is equivalent for safety and
leaks, because the next settle step cancels the orphan; the immediate
cancel only frees room sooner. GA7 (a reading of a passed provider
period stays usable) is equivalent for AS in this abstraction, because
such a reading overstates the new period's use; the rule is a
tightening one, and only UK (a restatement) sees it. GA8 (no
reading taken as zero use, that is Unknown as Allow) is missed by AS,
which counts only the outside use a reading saw; with no reading it has
nothing to protect, and the Unknown rule, which guards outside use
foreman has not seen, is checked only by UK (a restatement; M5 killed
the same mutant with it). GA11 (no
`Uncertain` hold at startup) changes no ledger quantity; the hold
protects git state, which M3 checks (C4). GA12 (orphan test by
operation instead of `grantId`) is equivalent within the grammar: a
failed cancel ends the attempt, and every attempt settles before it can
append a new `Intended` for that operation, so a stale grant is always
unnamed when the settle step looks; the `grantId` test is the one that
stays right if that ordering changes. The stages mutants of M5 (SB, WV,
SD, BR) were not rerun (cut for time); their rules are unchanged except
the spend-down end rule, which the stages5 rerun checks unmutated.

Not covered by M5.1: rule 2 together with the grant rules (scope
grants51 has one window and no allocations); two windows per provider;
a reading of an earlier period arriving after a later one (the model
holds one pending snapshot, so the period-membership rule is argued
only; counter zero); periods opened by a usage drop or `ledger reset`
(rule P's no-reset-time branch); clock skew (rule P's `resetTolerance`
margin is abstracted to exact times); the `seq` order (the model's
ledger is one atomic store); a project that launches twice; stale
readings; Codex; waivers in scope grants51.

### Model check M5.2 (revision 5.2)

`research/model/check52.py` and `research/model/mutate52.py`, outputs
`research/model/check52-run.txt` and `research/model/mutate52-run.txt`;
check4.py, check5.py and check51.py and their outputs are unchanged.
Grammar and bounds are fixed in the file's header; eight amendments
follow it, each labeled with its before and after results. Passing M5.2
supports only the rules it models, within its bounds. Two scopes, run
one at a time; one combined model did not fit in memory.

- Scope periods52 (owner requirement 2): one provider and window, two
  projects with one operation each (amendment 1: two for project 0 did
  not fit), U = 3, reserve 1, cap 2, estimate 1. Provider resets on
  schedule or early (one in all); a backward clock step; readings with
  or without a reset time, at most two, ingested late and in either
  order; staleness on the monotonic clock; outside use up to reserve +
  1 = 2 units; the owner's `ledger retire` and `ledger reset`. Property
  TC (see "Reconciling readings, grants and charges"), computed from the
  monitor's own record of the provider's count and outside use.
- Scope leaks52 (owner requirement 3): M5.1's grant lifecycle with two
  operations per project, both projects crashing at any point, a lost
  race (project 1), failed cancel, charge and settle-step writes, and
  `ledger settle` without termination (amendment 7); no units are spent
  (amendment 6), so it checks LK and ND and not the provider count.

| Scope | States | Launch transitions | Violations | Liveness / strict | Coverage counters (all above zero) |
|---|---|---|---|---|---|
| periods52 (run 6) | 1,347,706 | 52,386 | none | 0 / 37,713 | launches after an early reset 32,724; with a carried charge 920; after a backward clock step 36,802; with outside use above the reserve 24,646; on a delayed reading 28,052; with an older snapshot still pending 16,640; refusals while Unknown 155,862 and only because of carried charges 13,188; earlier-period readings dropped 113,848; out-of-order ingests 157,632; false drops kept in the period 16,936; readings without a reset time 244,954 |
| leaks52 (fourth run) | 838,192 | 160,834 | none | 0 / 0 | launches of a second operation or after a lost race 117,934; with another project's grant open 108,282; failed settle writes at a launch attempt 143,150, at startup 116,204 and at `ledger settle` 75,228; crashes after a lost race 5,212; `ledger settle` 173,664 |

Strict liveness in periods52 counts states where no snapshot is left,
which no rule can leave; in leaks52, with no reset, the one-reset credit
covers every state, so strict liveness is the meaningful figure there,
and it is 0. Peak memory: leaks52 1.8 GB; periods52 was not measured in
its final run (run 3, before the search was slimmed, reached 3.1 GB).

Runs that found something. Run 4 of periods52 found a TC violation that
showed A5 missing from the design: a delayed reading arrived already
missing two outside units (amendment 4; `--no-a5` reproduces it in six
steps). Run 5 found a design defect: after `ledger reset`, a delayed
reading of the same provider period, lower than one already ingested,
became the new period's highest. Revision 5.2 now refuses readings
observed before the command (amendment 5, "Periods").

Mutation test: 24 mutants of the model parts only, killed only by a
property or by liveness (leaks52 with `--safety-only`). Each mutant that
survives has exactly one classification, printed by `mutate52.py`.

| Mutant | Result | Classification if missed |
|---|---|---|
| PA1 revision 5.1's rule P (scheduled reset time decides) | killed by TC | |
| PA2 a usage drop opens a period | killed by TC | |
| PA3 newest reading by wall stamp | killed by TC | |
| PA4 highest among fresh readings only | killed by TC | |
| PA5 freshness on the wall clock | killed by TC | |
| PA6 an earlier period's reading joins | missed | safety-only equivalent: it can only raise the period's highest reading, so it refuses more |
| GA8 Unknown treated as Allow | killed by TC | |
| PA7 freshness ignored | killed by TC | |
| PA8 a reading usable after its reset time passed | missed | safety-only equivalent under A5: the old reading plus every unretired grant still bounds the new period; it costs only liveness |
| PA9 every charged step retired at a new period | killed by TC | |
| PA10 open grants left out | killed by TC | |
| PA11 charged grants left out (reflection) | killed by TC | |
| PA12 readings observed before `ledger reset` join | killed by TC | |
| GA4 no cancel after a lost race | missed | safety-only equivalent: the next settle step cancels the orphan; in the text the open grant can cause a spurious Quota hold |
| GA5 startup does not charge a finished step | killed by LK | |
| GA6 charged again on redo | killed by ND | |
| GA9 no settle step at ordinary attempts | killed by LK | |
| GA10 startup does not cancel orphans | killed by LK | |
| GA11 no Uncertain hold at startup | missed | separate coverage: M3 (C4) checks the git state the hold protects |
| GA12 orphan test by opId | missed | equivalent: every grant has a fresh opId in the written design |
| GB4 startup charges before the kill | killed by ND | |
| GB5 `ledger settle` charges a step that may still run | killed by ND | |
| GL1 a failed settle write does not end the attempt | killed by strict liveness | |
| GL2 a startup whose settle write fails goes on | killed by LK | |

No mutant is classified missing coverage. GA8 is killed by TC, a safety
property, because TC charges foreman for outside use no reading excuses.
Mutants of M5.1 not repeated here keep their M5.1 results (GA1, GA2,
GB1, GB2 for revision 5.1's rule P; GA7 is replaced by PA8). The stages
mutants of M5 were not rerun; their rules are unchanged.

Not covered by M5.2: rule 2 and allocations with the period rules; two
windows; a late reset and a forward clock step (amendment 3; argued:
both only make readings unusable); a third reading in one run
(amendment 2); outside use of reserve + 2; a project's second launch
against its own carried charge in periods52 (leaks52 has second
launches, without units); a process spending after its instance crashed
with two operations (M5.1 covers one); the `seq` order; clock skew
within `resetTolerance`; spend-downs and waivers with the new period
rules; the monotonic clock across processes (L4); `ledger retire` given
wrongly by the owner (the model takes the owner's word as true).

check51.py's header text below its amendments still describes M5.1's
scope before amendment 2 (nit 7 of the re-review of 5.1); the
amendments above it govern, and the file stays unedited under the
owner's requirement 9 for revision 5.2.

## Research: conditional admission safety (not a design claim)

Nothing in this section is part of the design, and no claim in the
claims ledger cites it. It keeps the analysis of when admission would
keep the provider's count within the cap, so it can be resumed. No
theorem is approved (owner ruling 2026-11-15; [the admission
contract](2026-11-15-admission-contract.md) holds the review, the
evidence paths and the ruling). Revisions 5.1 and 5.2 stated this
analysis in "Reconciling readings, grants and charges" and in C13;
revision 6 moves it here.

The properties. M5.1 checked AS: at every launch, the outside use the
reading saw, plus everything foreman's steps have used or may still use
in the provider's current period, plus the new estimate, is at most the
cap. M5.2 checked the stronger TC on the provider's total count: at
every launch, the provider's count in its current period (outside use
seen or not, and foreman's use), plus what every running step may still
use, plus the new estimate, is at most the cap plus the outside use
counted after the newest reading foreman has ingested, that last term
capped at the reserve. Both are computed from the model monitor's own
record of the provider's count, apart from foreman's ledger.

Assumptions as revision 5.2 stated them: A1, a step uses at most its
estimate in each window; A2, a reading reports the provider's count as
of some earlier moment, by any delay; A3, the provider's count in a
period never decreases; A4, a reading's reset time is the provider's,
and the Mac's clock is within `resetTolerance` of it; A5, the outside
use the provider counts after the as-of moment of the newest reading
foreman has ingested is at most the reserve, for as long as foreman
holds a fresh reading. The contract review found that list incomplete
and A5 circular. The full table, from the contract:

| Assumption | Kind | Source or enforcement point | What a live test can and cannot show |
|---|---|---|---|
| A1: a step uses at most its estimate | Unverified environmental | Nothing enforces it (no per-run budget in quota units) | Can show how often bracketed steps exceed their estimates; cannot bound future overshoot |
| A2: any reporting delay | Conservative modeling stance | None needed | Nothing to show |
| A3: the count never decreases within a period | Provider behavior; the vendor does not document it (unverified) | Highest-reading rule | Can catch a violation; cannot establish the property |
| A4: provider reset times and the Mac clock agree within `resetTolerance` | Unverified environmental | NTP; period membership | Can measure skew at one time |
| A5 as revision 5.2 states it | Circular: mixes foreman state into an environmental bound | None | Not testable as written |
| A5 on the provider side (not adopted): delay at most D, and outside use in any interval of length F + D at most the reserve | Unverified environmental | None in the design; the model's `Ingest` guard encodes it | Can measure the observed lag from a known request to the reading that shows it; cannot prove a maximum D. The outside-use half depends on the owner's behavior |
| Retirement attestation: retired steps' usage was all counted in an earlier provider period | Owner attestation; foreman cannot check it | `ledger retire` (the model's `Retire` takes it as true) | Cannot be checked |
| One monotonic clock across processes in one boot | Unverified platform property | The clock helper and FFI call (proposal) | Can catch disagreement; cannot prove agreement |
| Usage counted in the period of the request's time | Unverified provider behavior | Needed by any retirement criterion | Partly observable around a reset |
| Readings keep arriving for Claude | Environmental (depends on the owner's use) | None | Observable only |

What the models found. M5.1's overshoot run (A1 dropped) breaks AS in
72 states: two launches within the cap, one step using twice its
estimate. M5.2's `--no-a5` run breaks TC in six steps: a delayed
reading arrives already missing two outside units. Both stay true as
statements about the provider, and they are why revision 6 claims
nothing about the provider's count.

Counterexamples and candidate corrections (contract, replayed by
`fix.py` against check52.py's own functions):

- T1 (finding 1 of the re-review of 5.2): under revision 5.2's rule, a
  reading captured before `ledger reset` but observed after it joins the
  new period, and TC is violated. The model excluded by capture order,
  the text by observation order (contract item M1). Revision 6 removes
  `ledger reset`, so T1 has no counterpart in the body.
- Candidate R1 (not adopted): a period opened by `ledger reset` starts
  with the highest reading, and its freshness stamps, of the readings
  ingested since the last period-opening ingestion. On T1 it refuses
  the launch and TC holds; T1b launches and TC holds; T1c is excluded
  only by A5. Under R1 `ledger reset` loosens nothing.
- T2 (the PA6 mutant, finding 2): an earlier period's reading joins and
  refreshes freshness; TC is violated under the text's A5. PA6's
  classification as safety-only equivalent is wrong.
- T2s: Snap, Snap, Ingest 2, Stale, Outside, Outside, Ingest 1 (same
  period, joins, refreshes freshness), Run 0, Run 1. The unmodified
  revision-5.2 rules with the text's A5 violate TC (4 > 3), so the
  defect is in the freshness rule itself: without a delay bound, no
  reading shows that it is recent, and "refresh only on a non-lower
  reading" fails T2s, where the values are equal.
- Candidate R2 (not adopted): the provider-side A5 above. It excludes T2
  and T2s, and it is what the model's `Ingest` guard already encoded,
  which is why the model passed while the text failed (contract item
  M2).

Contract items M3-M6 record the remaining text and model mismatches:
the model stamps the wall clock at capture (M3), merges observation and
ingestion (M4), and gives the owner perfect knowledge for `LedgerReset`
and `Retire` (M5); the estimate rule's clock (M6) is fixed in the body
of revision 6.

Not done: a full periods52 run with R1 and R2 substituted, and the
reclassification of PA6 and PA8 that depends on it. Until both are done
and reviewed, TC has no standing even as a conditional result.

Feasibility (the contract's conclusion). The available observations cannot
support "no admitted launch takes the provider's count over the cap" as
an operational guarantee. No reading includes an as-of time or step
attribution. TC holds only under A1, which version 1 cannot enforce,
together with a provider-side bound on delay and outside use that no
vendor documents and no live test can establish as a maximum, and it
also depends on A3, A4, the clock behavior and the owner's retirement
attestations.

## Restrictions table

| Restriction | Why believed harmless | Challenge example |
|---|---|---|
| One operation in flight; one `run` instance | The workflow is sequential | The user wants a review of tranche N while N+1 is implemented; refused by design |
| Observation unusable after `resetsAt` | The user's other work may start a new window | Supervisor idles overnight; every first launch needs a waiver or a fresh observation |
| A reading lacking `resetsAt` is usable on freshness alone | It joins the current period and can only raise its highest reading | A window resets two minutes after the reading; the reading overstates the new period's use, which only refuses launches |
| Window set from policy; readings add none | A missing reading must not read as Allow | Codex adds a window; until policy lists it, it is not checked |
| Estimate from the last five steps per role and window | Steps of one role are similar in cost | A large tranche after small ones overshoots its estimate, and the excess is never charged |
| Quota hold released only by post-hold readings of the windows it names | A reading from before the hold cannot know the limit was hit | The user's session reports usage just before the hold, low; the hold stays until a newer reading |
| `resetsAt` compared with the local wall clock (it only makes readings unusable or sorts them into periods) | Providers and the Mac both use network time; a passed reset time only tightens | The clock runs ahead or steps forward; readings become unusable before the provider resets and launches wait for a reading of the new period. A backward step keeps the old period's reading usable past the reset; the level is still that reading plus every unretired grant, and no claim says the provider's count stays within the cap |
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
| A lender is not protected within a period | Ceilings bound each borrower; no ceiling exceeds `100 − reserve` | Project A borrows its full ceiling in the morning; project B finds its allocation partly used for the rest of the period (the lease proposal would change this, if approved) |
| Admission counts every step at its estimate until the owner retires it, and no reading reflects a step (revisions 5.1 and 5.2) | Counting a step twice only delays launches; leaving it out would pace on a figure lower than foreman's own records support, and nothing shows that a reading reflects a step or when the provider really reset | Late in a busy period the reading already shows foreman's steps and the level adds them again; foreman's real use is bounded by its share times u/(u + E), a third of the share when estimates are twice the real use; after a reset the previous period's charges still count until `ledger retire` |
| Charges are estimates until a run report gives an authoritative measurement in quota units (revision 5.1) | Token counts and dollar costs do not measure subscription allowance | A step that used far less than its estimate still counts at the estimate for the rest of its period |
| A step may use more than its estimate; revision 6 does not assume A1 | The estimate is the largest recent cost of the role; L1 and L2 measure how often it is exceeded | A step uses twice its estimate; the excess is never charged, and later launches are paced on a level that omits it (M5.1's overshoot run shows the provider-side trace) |
| Only the owner retires a charged grant (revision 5.2; revision 5.1 compared a step's `endedAt` with the scheduled reset time) | The retirement is the owner's attestation, which foreman cannot check (revision 6). A scheduled reset time, a clock value or a usage drop does not show when the provider really reset (early resets, A2) | The owner forgets `ledger retire` for a week; charges accumulate and every launch is refused until the owner retires them (O7 lists automatic options); the unattended figures are under "Admission rule" |
| No owner command opens a period; revision 6 removes `ledger reset` | Under the contract's repair R1 the command would loosen nothing, so it would change no decision | A provider without reset times resets; the window keeps its old highest reading until a reading with a later reset time arrives, and the owner uses a waiver or a spend-down meanwhile (O9) |
| A ledger write that keeps failing leaves grants open (revision 5.1) | An open grant counts at its estimate, which overstates use unless the step exceeded its estimate | The ledger disk is full; grants stay open, other projects wait, and `run` reports the open grants when it exits |
| `ledger settle` signals no process; a grant without `Finished` stays open until its project restarts (revision 5.2) | Cross-instance termination is not approved | A project crashed mid-step and its owner never restarts it; its grant counts at its estimate in every period until the restart or until the proposal is approved |
| Freshness on the monotonic clock of the current boot (revision 5.2) | A wall-clock age shrinks when the clock steps back | A statusline script that does not record `observedMono` and the boot id gives readings that are never fresh; after a reboot every window is Unknown until a new reading; until a clock mechanism is approved (O11), no reading is fresh |
| Freshness shows when foreman observed a reading, never when the provider captured it (revision 6) | No reading includes a capture time | The provider's figure lags by an hour while the owner works heavily; a fresh reading misses that use, and launches paced on it can take the account past its limit. Admission claims nothing about the provider's count |
| A waiting Claude step wakes only on a reading, a ledger row or the owner | Claude has no read without a model turn (E2) | The owner stops using Claude interactively overnight; a Claude step refused by rule 1 waits for a waiver |
| `backlog remove` is refused for a started tranche | Removal stays free of git effects | With bound 2, the owner wants a stacked tranche gone; they wait for the approval hold or abandon |
| Allocations are not enforced while a window is in fallback, and the mode changes only at a new period | Per-project charges need converged rates; the cap still bounds every launch over foreman's records | Early on, one busy project uses most of foreman's share before the fit converges; after convergence, the rest of that period stays in fallback |
| Rates are biased when outside usage coincides with steps | The elapsed-hours term absorbs steady outside usage | The owner works only while steps run; rates overstate foreman's cost, which charges projects more and understates the residual |
| A usage drop opens no period (revision 5.2) | A drop cannot tell a reset from a delayed reading (false drop) | A provider without reset times resets; the window keeps the old highest reading until a reading with a later reset time arrives; the owner's paths are a waiver or a spend-down (O9) |
| One operation at a time per project, even with a review worktree | Keeps C5 and the model; projects still run in parallel | In a single project Codex idles while Claude implements |
| Stacking can discard approved work (bound 2) | Bounded by the queue bound; the commits stay in the log and reflog | Tranche N's review asks for changes; tranche N+1, already implemented on top, is unwound and redone |
| A pre-approved tranche's base is the previous tranche's result | An approval names what it approves | The owner delivers mid-backlog; the next pre-approved tranche does not see the delivered commit unless its entry was `--stop-before` |
| A swap that makes a client the implementer needs that client's editing profile verified | The read-only profile does not exercise prevention | Codex has headroom but no L3 run; the suggestion is not made |
| The deadline uses only the longest window's reset | That window's unused share is what a reset loses | A five-hour window about to reset with unused room does not raise its provider's priority |
| A loosening spend-down ends when the clock passes the reset time; a tightening one ends only at a new period or by `--cancel` (revision 5.1) | Timers may only tighten | The provider resets late; the loosening override ends early and launches wait for a reading of the new period. With no reading after a reset, a tightening override stays in force |

## Live tests needed before relying on the design

Each needs separate approval because it spends allowance or uses a login.

- L1: `claude -p "/usage" --output-format json` under the subscription
  login. Does it return `usage_report`, and do the usage bars move? Also
  record the exact shape of a `rate_limit_event` in stream-json: whether
  the event identifies the window, and whether it has a timestamp, a usage figure and a reset
  time (fix 9).
- L1, revision 4: also record the `result` message's `usage` object
  (token classes) under the subscription login, and the print-mode budget
  limit: flag name, unit, whether the run report gives the same unit, and
  whether reaching it stops the run mid-turn and how that is reported.
- L2: `account/rateLimits/read` through `codex app-server`: window
  shapes for the user's plan, and whether a turn is started. Revision 4:
  whether `codex exec --json` reports token usage per run and in which
  event, and whether Codex has any per-run budget option.
- L3: one implement step on a disposable repository, run in the
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
  through the Edit tool, the Write tool and a Bash command; a symbolic link to a file outside the
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
- L4: one full cycle in a supervisor worktree of a disposable
  repository, killed at each step boundary (including between `git
  worktree add` and `WorktreeCreated`, between `update-ref` and
  `Committed`, between a restore's reset and `Restored`, and between a
  `--base` reset and `Rebased`). Check that restart produces the
  expected holds, that the supervisor branch is at the expected commit
  and the owner's branch never moved; the owner commits on their own
  branch and edits their checkout during a step (expected: no drift, no
  hold and nothing of theirs in the step's commit), then delivers with
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
- L1 and L2, revision 5.1 (replaces revision 5's `reflectLag`
  measurement): (a) look for an authoritative per-run measurement in the
  quota's own units in the run report; until one is found, charges stay
  estimates. (b) Assumption A1: from readings that bracket one step with
  no other use, record how often a step's use exceeds its estimate, and
  by how much. (c) Delay (A2) and evidence: record how long after a step
  ends its use appears in a reading, whether the statusline's
  `rate_limits` is fresh for each script run or cached from the last
  API response, and whether a reading can be matched to a request sent
  after a given step ended (the one candidate kind of evidence that a
  reading includes a step;
  see "Reconciling"). (d) A4: compare reported reset times with the
  Mac's clock.
- L3r (revision 5, only if a swap that makes Claude the reviewer is
  wanted): a review step with Claude's read-only profile in the review
  worktree, with a task that attempts an Edit, a Write, a Bash write, a
  push and a network fetch. Expected: each is denied and the review
  worktree stays clean; its result decides whether Claude's read-only
  profile is marked verified.
- L4, revision 5 additions: kill an instance between `Finished` and
  `Charged` and check that the next launch attempt or startup charges
  the grant once; force a lost race on `Intended` (a CLI append between
  fold and append) and check that the grant is canceled at once; stop a
  project for good with a grant open and run `ledger settle`.
  Revision 5.1 additions: make a ledger write fail (hold the database
  write lock past `busy_timeout`) during a cancel and during a charge,
  and check the next launch attempt settles the grant; kill an instance
  after a lost race and before its cancel; kill an instance mid-step,
  leave the project stopped, run `ledger settle`, and check that the
  agent's process group is gone and the grant is charged at its
  estimate.
- L4, revision 6 additions: whether `CLOCK_MONOTONIC` read by the
  supervisor and by the statusline script agree on one boot (only once
  a mechanism under O11 is approved); and, before startup step 1 is
  relied on, a startup after the recorded process group has gone and its
  id has been reused, to confirm the hazard under O12. The revision-5.1
  `ledger settle` kill test above no longer applies: since revision 5.2
  `ledger settle` signals nothing.

## Later improvements (logged; outside the first version)

Accepted by the user on 2026-11-14 as first-version behavior, with these
fixes recorded for later:

- F1, automatic replay of read-only steps. A crash during a review
  currently waits for reconciliation. Replaying it automatically is safe
  in principle, because the review runs in a read-only sandbox; it needs
  evidence that the sandbox held (live test L3) before adoption.
- F2, adopting the user's own commits automatically. HEAD drift of
  the supervisor branch during a tranche currently holds until the user
  runs `adopt` or `restore` (with the worktree ruling, a user commit
  there is rare; the owner commits on their own branch). A later version could adopt a commit made by the user
  (identified by author and the absence of an `Op-Id` trailer) without
  the command, still refusing drift it cannot attribute.

## Open items

Decisions the owner still needs to make. Revision 6 adopts none of
them; where the body needed a choice, it takes the most conservative
option and lists the others here.

- O1, lender protection: choose among the four options in "Proposal:
  readiness leases (awaiting owner approval)". The ruling on revision 4
  chose leases; the proposal flags them as invented and lists the
  alternatives and costs. Until the owner approves one, the body has no
  lender protection.
- O2, the backlog-removal policy ("Pre-approved backlog": `backlog
  remove` withdraws only the entry, is refused for a started tranche,
  and leaves a live approval standing).
- O3, the values of `readInterval`, `fitLag` (revision 5's
  `reflectLag`) and `dataVersionPoll`: 5 minutes, 5 minutes and 1
  second proposed, none approved. Revision 5.1 proposes that `fitLag`
  affect only the fit and that elapsed time never be taken to show
  that a reading reflects a step.
- O4, revision 3.1's release of a quota hold at a passed reset time.
  The body does not adopt it: the hold ends only by a post-hold allowing
  reading (after a reset, a reading of the new period) or a waiver. The
  proposal is to drop it; the cost is little in liveness, since the
  released hold was always followed by Unknown and a new hold until such
  a reading arrived.
- O5, a reflection rule. Counting every finished step until it is
  retired reduces foreman's usable share (below). A proposal for later:
  if L1 or L2 shows that a provider counts a request before answering a
  later one from the same account, a reading carried by a response to a
  request sent after a step's process exited reflects that step. Not
  adopted.
- O7, what lets a charged grant stop counting without the owner. The
  body: nothing; only `ledger retire` retires a grant. Options, with
  their costs:
  (a) keep the body (owner only). Cost: charges accumulate across
  periods, and the unattended figures under "Admission rule" apply.
  (b) the new period's own reset time: under a new assumption A6 (a
  period lasts exactly the window's length W, so the period with reset
  time `R_k` began at `R_k − W`, also after an early reset), a charged
  grant with `endedAt + resetTolerance ≤ R_k − W` used nothing in
  period `k` and is retired when a reading with `R_k` opens it. Cost:
  A6 must hold for each provider and window (L1, L2), and the Mac's
  clock decides again, within `resetTolerance`.
  (c) a bounded provider delay `D`: a charged grant is retired once a
  reading of a later period, observed at least `D` after the grant's
  end, exists. The contract notes an unreviewed candidate of this kind
  under the provider-side A5. Cost: `D` must be measured, and no live
  test can establish it as a maximum.
  (d) an as-of time or a per-request counter from the provider, if L1
  or L2 finds one. Cost: none known; it exists only if a provider
  supplies it.
  Revision 5.1's rule (the previous period's scheduled reset time) is
  not an option: an early reset breaks it.
- O8, the `ledger retire` command itself: its form (`--through <seq>`,
  per provider and window) and that it rests on the owner's
  attestation, which foreman cannot check. The body needs some owner
  path while O7 is open; the owner may prefer another form.
- O9, a provider whose readings lack a reset time. The body: a drop
  is shown by `status` and opens nothing, and the window keeps its old
  highest reading until a reading with a later reset time; the owner's
  paths are a waiver or a spend-down (revision 6 removes `ledger reset`,
  O10). Options: (a) keep the body; cost: such a provider needs the
  owner after every reset. (b) a drop confirmed by two readings
  observed at least `freshness` apart, both below the old highest by
  more than `dropTolerance`, with no higher reading in between; cost: a
  delayed reading can repeat, so this rests on a bounded delay as in
  O7(c). (c) treat a drop as a reset only when the provider also
  reports a later reset time, which is the body's rule.
- O10 (new in revision 6): confirm that `ledger reset` goes. Revision 6 removes
  the command (see "Periods" for why). The alternative is to keep it as
  a marker that, under the contract's R1, loosens nothing. The owner
  may want it back for another purpose, such as a `status` annotation.
- O11 (new in revision 6), the clock mechanism: "Proposal: clock
  acquisition (awaiting owner approval)", including the `bun:ffi`
  dependency and the C helper for the statusline script. Until one is
  approved, no reading is fresh and every launch needs a waiver.
- O12 (new in revision 6), startup signaling: startup recovery step 1
  sends `SIGKILL` to a recorded pgid with no identity check, which can
  reach an unrelated process that reuses the id. "Proposal: startup
  signaling identity (awaiting owner approval)" sets out the contract's
  rules; until the owner decides, the hazard stands, and C10 and C20
  depend on the step as written.
- O13 (new in revision 6), checks for the revision-6 claims that are
  argument only: unit and property tests of the level and the
  unattended figures (C13, C22), and a model scope over foreman's
  records alone for the period rules (C16). No model file is written in
  revision 6.
- The reduced usable share: foreman's real use is bounded by its share
  times `u / (u + E)`; see "What this costs" under "Usage ledger".
- Cross-instance process termination: see "Proposal: cross-instance
  process termination (awaiting owner approval)". Not adopted.
- Conditional admission safety: whether to pursue it at all. The
  research section lists what it would need. Two pieces of that work
  are not done: rerunning the corrected model, and reclassifying PA6
  and PA8. Revision 6 does not depend on it.
- For L1 and L4: whether the statusline script can record
  `observedMono` and the boot id (depends on O11), and whether
  `CLOCK_MONOTONIC` agrees across processes on one boot.
- Removed in revision 6: O6 (rule P's two conservative choices). It
  described revision 5.1's rule P, which revision 5.2 replaced (nit 9 of
  the re-review of 5.2), and its second half concerned periods opened by
  a drop or by `ledger reset`, neither of which exists in revision 6.
- The suggestion statistic for the feedback loop (see "Pacing").
- The default `<stateDir>` and supervisor branch name.

Open, waiting on live tests:

- Whether the Bash sandbox can deny writes to subdirectories of the
  working directory, and whether it lets the agents' `git status`
  refresh `<gitDir>/index` (L3). If writes cannot be denied there,
  prevention for `.git/` and `.claude/` rests on permission rules and
  detection only.
- Codex's window list for the pacing policy, its run report, whether its
  rate-limit read starts a turn, and any per-run budget (L2); Claude's
  budget flag and run report shape (L1).
- The profiles a role swap needs: Codex editing (L3c) and Claude
  read-only (L3r).

Open design questions:

- A `deliver` command (fast-forward or cherry-pick run by the supervisor
  in the owner's checkout) is not in the first version; no command
  re-requests a base during a tranche after a `BaseRequested` went stale.
- A review worktree would allow a review and an implement step of one
  project to run at once; that drops C5 within a project and is not in
  revision 5.
- A Claude step waiting on rule 1 or 2 wakes only on a reading, a ledger
  row or an owner command (see "Admission rule"); whether a Claude read
  without a model turn exists is L1's question.
- Not covered by any model: re-arming an approval after `reconcile
  discard` (argued only), the per-period rate mode, two windows per
  provider in the ledger rules, and the rate fit itself.
- If the durable-engine question is reopened: a DBOS crash test with
  `max_recovery_attempts=0` and a Temporal worker kill under
  `maximumAttempts: 1` (see "Durable-execution engines").

Decided since revision 4 and removed from this list: the review-queue
bound (1, per project 2), the durable layer (hand-built log kept), the
revision-4 defaults, the repository (S1: `~/Desktop/foreman`), the
Effect intake (effect 4.1.4 installed under `docs/dependency-intake.md`),
the first-review finding texts (appendix), user edits during a step
(the supervisor worktree), and 3.1's question of how the backlog meets
`approve --base` (answered in "Pre-approved backlog").

## Review 2026-11-14

An independent reviewer (fresh Opus agent, adversarial-procedure-review)
rejected this draft as written. Artifacts: `research/model/review-2026-11-14/`.
The coordinator reproduced the C6 counterexample: removing one monitor
line that read model state (`c6_unmasked.py`) yields a third correction
in one tranche after notConverged plus Release.

Blocking:

- C6 false. The monitor masked it. Release of notConverged is
  undefined in the design; the model reset rounds.
- C9 bypass (argued). Edit is not path-limited and the sandbox covers
  only Bash, so an agent can write `.git/hooks`, `.git/config`,
  `.claude/settings.json`, CLAUDE.md or AGENTS.md; the shell's unsandboxed
  `git commit` then runs the hook, and the next agent inherits the
  settings and instructions.
- Drift deadlock (confirmed in the extended model). Released only
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
| R-S5, R-S6, R-S7 | Finding text not saved in this repository. The first review's summary covers, without these IDs, the C6, C9 and drift-deadlock findings above. It also covers the findings below about the monitor's independence, its missing liveness property and the missed mutants. The decision record's ledger S5-S7 (fresh contexts, intent before effect, distinct holds) are answered by the sections "Context per step", "Operations, checkpoints and recovery" and "Holds". | Needs the coordinator's confirmation (open items). |
| R-D1, R-D3 | Finding text not saved in this repository. | Needs the coordinator's confirmation (open items). |
| R-D2 nothing-to-commit / commit failure has no outcome class | `NothingToCommit`, `CommitRefused`, `CommitFailed`. | Settledness defined including `Reconciled` (fix 2). |
| R-P1 "every known window" vacuously Allow | Window set from policy. | Unchanged. |
| R-P2, R-P5 | Finding text not saved in this repository; `review-2026-11-14/pace_literal.py` tested pacing edge cases on the literal rule. | Needs the coordinator's confirmation (open items). |
| R-P3 / R-P4 estimate per window; spanning resets; all-unmeasured; missing `resetsAt`; multiple readings | Estimate per role and window; latest `observedAt` wins. | Estimate wording made consistent; arrival order modeled (fixes 8, 9). |
| R-P6 version pins disagree | One source of truth in configuration. | Unchanged. |
| C7 waivers bypass the reserve | C7 restated with the waiver exception. | Unchanged; M3 (C7). |
| C8 fresh processes still load instruction files and settings, as well as auto-memory | C8 restated. | Full load list (fix 9). |
| Monitor not independent; no liveness; mutants missed | `check(m, ev, out)`; liveness; mutation results. | Launch expectation rewritten from the text (M3); equivalence arguments backed by counters. |

## Re-review 2026-11-14 (revision 2)

A second independent reviewer (fresh Opus agent) returned **approve with
fixes**. Artifacts: `research/model/review2-2026-11-14/` (variants T1, T2,
E1 built from check2 by `mk.py`). The coordinator reproduced T2.

Fixes required before approval, in the reviewer's priority order:

1. Protected-change detection reads the filesystem instead of git status: ignored
   files (`.claude/settings.local.json`), skip-worktree entries, `.git/index`,
   `CLAUDE.local.md`, `.mcp.json`, `.codex/`, `.gitattributes`, `.gitmodules`,
   linked-worktree and submodule git dirs, `include.path` targets, symlinks
   leaving the repo. Compare after every mutating step whatever its outcome,
   at startup and after CLI git effects. (E1, confirmed: a `.git/config`
   change from a failed step persists; `gpg.program` and filter drivers run
   despite disabled hooks.)
2. Startup recovery treats a reconciled operation as settled; `reconcile`
   takes an opId that is currently held. (T2, confirmed.)
3. CLI commands with git effects (restore, discard, abandon) run intent-first
   under the lock instead of effect-then-append.
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
| 1. Filesystem digest; full protected set; compare before any git command, after every step, at startup, around CLI effects; symlinks; index flags; filters and signing | "Protected paths", "Git environment", "Git probes", "Drift and the clean-tree rule", "Commit procedure", E7, L3 | Live probes (E7 table) for git behavior; M3 properties P2 (no git while an unpermitted change is on disk) and K (each compare point holds), with the E1 scenario in the grammar (counter e1); mutants R1a-R1h, N7; L3 for agents. The walk itself: argument until implemented. |
| 2. Reconciled is settled; `reconcile` takes a held opId | "Startup recovery" step 3 and `reconcile` | M3 C4 ("startup held a settled operation", "unjustified reconcile"); T2 scenario counted (counter t2); mutants R2a, R2b. |
| 3. Intent-first CLI git effects | "Single instance", "Requests" | M3 G (reset only by the lock holder for a pending request with the HEAD guard), C1 (no launch while a request is pending), crash between effect and completion in the grammar; mutants R3a-R3d. |
| 4. Process group, with kill verified | "Operations" steps 2-3, "Startup recovery" step 1, L4 | M3 F4 (no surviving agent acts after a startup), mutant R4a; macOS behavior: L4. |
| 5. Waiver lifetime across restart; wording | "Waivers" | M3: the T1 scenario is in the grammar (counter t1) and the monitor expects the waiver to be used; counter W for the other-provider wording; mutants R5a and N14. |
| 6. One-hold invariant | "Holds" (H1; the global one-hold claim is dropped) | M3 H1 property and mutant R6a; most-holds counter (2). Rerun after fixes 2 and 4: M15 now killed; N15 and N19 missed and equivalent, backed by counters W, `uncertain_and_quota`, `fail_and_drift` (all 0). |
| 7. Anchor to `baseRevision`; user edits; incomplete restore | "Commit procedure", "User edits during a step", "Drift and the clean-tree rule" | Anchor and incomplete restore: M3 (nested outcome in the grammar, counter nested; D and liveness), mutant R7a. User edits: not fixed in revision 3; closed in revision 3.1 by the supervisor worktree (owner ruling 2026-11-15; "Supervisor worktree", "Commit procedure", C11, C12, worktree probes, M3 amendment 8 for `--base`, L3 and L4). Remaining: writes into the supervisor worktree itself during a step are still committed as the step's (restrictions table). |
| 8. Quota release per named window, reset time or waiver; observation order | Holds table, "Pacing" | M3 C3 and K with out-of-order readings (quota scope); mutants R8a-R8d. |
| 9. Wording | R-P3 in "Pacing"; L1; "Clock basis"; "Context per step"; provenance table; finding table | Reading. The finding table cites every first-review ID; seven of them lack saved text (open items). |

## Appendix: first-review finding texts (recorded 2026-11-14)

The first review's full report was returned as text and not saved. The
coordinator recorded these findings from it, in the reviewer's words
condensed:

- R-S5 (confirmed): notConverged followed by Release allowed a third
  correction in one tranche; under the literal text Release re-ran the
  review, so the reviewer could be re-rolled until it approved. The model's
  monitor masked it with a line that read model state.
- R-S6 (argued): C9 bypass. Edit was not path-limited and the sandbox
  covered only Bash, so an agent could write `.git/hooks` or `core.hooksPath`
  and the shell's unsandboxed `git commit` would run it with network access;
  it could also write `.claude/settings.json`, CLAUDE.md or AGENTS.md to
  change the next agent's hooks, permissions and instructions.
- R-S7 (argued): an abandoned commit laundered into the next tranche:
  impl success, git commit, crash, reconcile abandon left the approval hold at
  the base while HEAD was the agent's commit; approve, drift, and an adopting
  release built the next tranche on abandoned work with no record.
- R-D1 (confirmed): a drift hold could never be cleared: release removed
  the hold, the next launch re-detected drift, and no command adopted or
  restored HEAD.
- R-D3 (argued): notConverged had no defined way forward; abandon applied
  only to Uncertain holds and Release was unspecified.
- R-P2: waivers bypass the reserve, so C7's "allowed only if the estimate
  fits" was false as stated.
- R-P5: an observation that releases a hold must postdate the hold
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

- Per-project allocations of each provider's usage windows, expressed as
  percent of that provider's windows, with an unallocated reserve for
  personal use outside foreman. Unused allocation may be borrowed up to a
  configurable ceiling; the reserve is never borrowable.
- One foreman per target repository, all instances sharing one usage
  ledger.
- Periods per provider and window, each identified by its reset time;
  providers have independent reset times; detected or manual resets open a
  new period. Timers may only tighten policy, never loosen it.
- Spend-down: a recorded override such as "Claude to 95% by its reset",
  per provider, ending automatically at that provider's reset.
- Decoupled stages: a durable, bounded queue between implementation and
  review per project, so whichever provider has headroom keeps working; the
  scheduler is deadline-aware per provider (earliest reset first) within
  each provider's short-window rate.
- Role-swap suggestions: foreman may suggest swapping implementer and
  reviewer when one provider's headroom expires sooner and the other is the
  bottleneck; a swap takes effect only on a recorded owner command.
- Running ahead uses a pre-approved backlog (option a): the owner may
  approve a short queue of upcoming tranches; approval still gates each
  tranche, ahead of time; no speculative work.
- Durable workflows: evaluate `effect/workflow` (Workflow, Activity,
  DurableQueue, DurableDeferred, DurableClock) with `effect/cluster`'s
  SingleRunner and SQL storage as the durable layer, replacing hand-built
  log and recovery where it fits. The owner accepts that these modules are
  marked `@stability unstable` in effect 4.1.x; their journey to stability
  must be tracked (see AGENTS.md).
- Measurement: per-step token usage from each client's run report,
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

## Final review 2026-11-15 (revision 4)

An independent reviewer (Opus, fresh context, read-only) found revision 4
not ready: the body has not caught up with two of the owner's revision-4
rulings, and admission rule 1 has a concurrency gap that M4 cannot see.
The reviewer reran check4.py in all three scopes; every count matches
check4-run.txt (stages 933,192 states, queue1 1,840,192, ledger 2,084,092;
no violations; liveness 0 in each scope). The coordinator confirmed
findings 1 to 4 and 13 against the text. Each finding below stays open
until revision 5 answers it.

Blocking:

1. Admission rule 1 ("Admission rule") compares the newest reading plus
   this launch's estimate with the cap and ignores other projects' open
   grants. Two instances that both see 68 against a cap of 70 with
   estimate 2 both launch, and the account ends at 72; in fallback mode
   rule 2 does not apply, so nothing stops it. M4's `used` includes
   in-flight grants at their estimates, so the model checks the escrowed
   rule, not the written one, and C13's backing is stronger than the text.
2. The review-queue ruling (default 1, configurable per project to 2) is
   not applied: "Review queue" still says default 2, and "Pre-approved
   backlog" and "Open items" still list the bound as an owner decision.
3. Readiness leases (ruled under "Owner rulings 2026-11-15 on revision 4")
   are not designed: no ledger table, admission clause, expiry rule,
   claim or M4 property. The body still says lenders get no protection
   ("Allocations, reserve and borrowing", the restrictions table,
   provenance). A lease is invented machinery and must be flagged; its
   expiry must not loosen anything.
4. A `Grant` is committed before `Intended`'s compare-and-append. When
   that append loses a race, the grant stays open until the next startup,
   so a long `run` leaks one grant per lost race and can stall rule 2. A
   crash between `Finished` and `Charged` also leaves an open grant that
   startup step 5 does not settle. C20 rests on argument only and the
   argument misses both paths.

Should fix:

5. The rate fit (θ, convergence state, ledger-or-fallback mode) is not in
   the ledger, so instances can disagree on a window's mode and on
   charges. The text lets convergence revert; M4 models only `Converge`.
   Fallback launches are uncharged, so a switch to ledger mode mid-period
   starts every project's use near zero.
6. With bound 2, a `--stop-before` entry is an implement candidate and can
   be stacked before the previous review passes, which skips the hold.
   The holds table and C2 omit `--stop-before`; M4's `PreApprove` has no
   such flag.
7. "Waivers" says no event changes the step while a hold exists; per-
   provider holds and `RolesSet` make that false. Launch attempt step 5
   applies a waiver only to the first candidate in deadline order, and
   whether a waived launch takes a `Grant` is unspecified. M3's N15
   argument rests on the false premise; M4 leaves waivers out.
8. The review worktree is not carried into Permissions (Codex's working
   directory), Launch attempt step 4 and the Drift hold (only the
   supervisor worktree is checked), Context per step (auto-memory is keyed
   by path), or the four client profiles the role swap needs.
9. A project refused by rule 2 has no wake-up: period changes need a
   reading, and Codex readings come only at launch. The list of what frees
   room omits a `Charged` below the estimate. M4's liveness assumes
   `Run`, `Observe` and `ResetSeen` are always enabled.
10. Period keys `(provider, window, resetsAt)` repeat when a usage drop
    opens a period with the same `resetsAt`, so a spend-down survives a
    detected reset. Readings without `resetsAt` have no period. Key
    periods by a sequence number.
11. After `reconcile discard` the rerun of a pre-approved implement step
    has no unused approval under C2. Neither M3 nor M4 covers this.
12. Contradictions: "Clock ticks never release any hold" against the quota
    hold's release at reset time; which `permits` applies when a live and
    a pre-approval both cover a tranche; `spend-down --cancel` has no
    window argument or table; the ruling cites a defaults table that does
    not exist.
13. AGENTS.md ("Dependency watch") and docs/dependency-intake.md say the
    owner accepted building on effect/workflow, which the revision-4
    ruling reverses. README cites check.py instead of check3.py and
    check4.py.
14. The effect 4.1.4 file and line citations are unverified (no
    node_modules here).

Invented or mis-cited machinery: the scheduler's deadline rule (Liu and
Layland and Jackson order jobs by their own due dates, not a shared
expiry); borrowing under a per-period budget takes the lender's share,
which HTB does not; the `capFactor` budget-cap rule is listed as faithful
use of the client; the convergence test does not say which noise-variance
estimate scales P; attributing a step's tokens to the interval it finished
in biases θ; readiness leases.

Not modeled in M4: stop-before, backlog removal, suggestion conditions and
expiry, tightening spend-downs and `--cancel`, reading staleness and
Unknown, quota release at reset time.

Open items: decided but still listed are the queue bound, lender
protection, the durable layer, the defaults, S1, the Effect intake, and
the first-review finding texts (now in the appendix). Open but not listed
are the readiness-lease design, where the rate fit lives, review-worktree
drift, and the wake-up after a rule-2 wait.

Prose: tell_lint.py reports 117 findings, 94 blocking (49 bold labels).
The revision-4 sections are nearly clean; the heaviest are the revision-4
rulings, Live tests, the appendix, M3, Architecture and Supervisor
worktree. The header still says "awaiting final review"; "cancelled" and
`GrantCancelled` use British spelling.

### Durable-execution engines (answers the DBOS question)

No engine both runs embedded on local storage and documents that it never
re-executes an in-flight step after a crash. Temporal documents at-most-once
for a normal activity with `maximumAttempts: 1`; after a worker crash the
workflow sees only a timeout, which cannot tell "never ran" from "ran,
result lost", and Temporal needs a server
(https://temporal.io/blog/idempotency-and-durable-execution). AWS Step
Functions Standard never reruns a task without `Retry` but is a cloud
service. DBOS Python runs in-process on SQLite, but its steps are
at-least-once ("tried at least once but are never re-executed after they
complete", https://docs.dbos.dev/python/tutorials/workflow-tutorial), and
it records a step only after the body returns (dbos-transact-py
`dbos/_core.py` `record_step_result`, checked by the coordinator), so a
crash leaves no trace of a started step; its `max_recovery_attempts` is a
workflow-level dead-letter queue, untested at 0; DBOS TypeScript requires
Postgres. Restate, Inngest, Cloudflare Workflows, Azure Durable Functions
and effect/workflow rerun an interrupted step; Trigger.dev's docs and
source disagree on crashes. Every candidate would still need foreman's own
write-ahead intent record, so the decision to keep the hand-built log
stands. Two tests would settle the remaining unknowns if the question is
reopened: a DBOS crash with `max_recovery_attempts=0`, and a Temporal
worker kill under `maximumAttempts: 1`.

## How revision 5 answers the final review

Each row names the finding of "Final review 2026-11-15 (revision 4)", the
sections changed, and the check behind the change. A model check backs
only the rules it models (see "Claims ledger").

| Finding | Change | Check |
|---|---|---|
| 1. Rule 1 ignores other projects' open grants | New "Reconciling readings, grants and charges": the level counts the reading, every project's open grants and the charges the reading does not reflect, with `reflectLag` and the ingestion guard; ambiguous cases count the grant, and the cost is stated. Rule 1 in "Admission rule" uses the level in both modes; C13 restated. | M5 scope grants: RS5 (foreman's use never left out), DC (the model follows the written level), with readings that do and do not reflect a finished step; mutants. |
| 2. Queue bound ruling not applied | "Review queue" (default 1, per project 2), "Pre-approved backlog", "Open items", "Defaults". | Text. M4's queue1 scope already checks bound 1. |
| 3. Readiness leases not designed | New "Proposal: readiness leases (awaiting owner approval)" with three alternatives, sources and costs; the lease is flagged invented. The body, claims and models keep borrowing without lender protection and point to the proposal, as the owner's terms for revision 5 require. | Open: needs the owner's choice; the proposal lists the checks an approved option would need. |
| 4. Grant leaks; C20 on argument only | New "Grant lifecycle": cancellation after a lost race, a settle step at every launch attempt and at startup, `Charged` redone from `Finished` under a unique key, settlement at reconciliation, `ledger settle` for a stopped project. Launch attempt step 2, startup step 5, `reconcile`; C20 restated. | M5 scope grants: LK with a crash or a lost race at every point named; mutants. L4 additions for real crashes. |
| 5. Rate fit not in the ledger; mode may revert; fallback uncharged | "Measurement": fit state in `RateUpdated` rows, one update per pair; mode fixed per period in `PeriodOpened`; fallback launches take and settle grants. C21 restated. | Argument; the per-period mode is not modeled (open items). |
| 6. `--stop-before` can be stacked | "Pre-approved backlog": a stop-before entry is never an implement candidate; C2 restated. | M5 scope stages5: SB; mutant. |
| 7. Waiver premise false under per-provider holds | "Waivers" and launch attempt step 6: the waiver is bound to its provider, applies to that provider's first candidate, takes a grant, and expires if none exists. | M5 scope stages5: WV with per-provider holds and swaps; mutants. |
| 8. Review worktree not carried through | Holds table (`Drift(worktree, ...)`, `restore --review`), launch attempt step 5, "Review queue", "Permissions" (Codex review directory, Claude read-only profile, Codex editing profile), "Context per step", "Role-swap suggestions" (four profiles), L3r. | Text; L3, L3c, L3r. Not modeled. |
| 9. No wake-up after a rule-2 wait | "Admission rule", "What frees room": adds `Charged` below the estimate and canceled grants; Codex read every `readInterval`; Claude's limit stated. | Text; the liveness assumption is stated in "Admission rule" and in the M5 section. |
| 10. Period keys repeat | "Periods": keyed by `periodSeq`; readings without `resetsAt` belong to the current period; spend-downs name `periodSeq`. | Text; M4 and M5 model periods as a counter, which is this rule. |
| 11. Discard rerun has no approval | "Pre-approved backlog" and `reconcile discard`: the approval is armed again. C2 restated. | Argument; open items list it as not modeled. |
| 12. Contradictions | "Holds": the reset-time exception to "clock ticks never release"; "Pre-approved backlog": the live approval's `permits` apply; "Spend-down override": `--cancel` with a window and `SpendDownCanceled`; new "Defaults" table. | M5: QR for the reset-time release, SD5 for `--cancel`. |
| 13. AGENTS.md, dependency intake, README | `AGENTS.md` "Dependency watch" and `docs/dependency-intake.md` state the revision-4 ruling (hand-built log kept, tripwire stays); `README.md` names check3, check4 and check5. | Text. |
| 14. effect citations unverified | "Durable layer": every citation read against the installed effect 4.1.4; 18 matched; the SQLite insert (`SqlMessageStorage.ts:418-424`) and lock rows (`SqlRunnerStorage.ts:213`, `:355-361`) corrected; the retry backoff's 10-second cap added. | Read of `node_modules/effect/src`, 2026-11-15. |
| Invented or mis-cited machinery | Scheduler order relabeled an invented heuristic; borrowing relabeled invented (HTB names only); `capFactor` sizing labeled invented; the noise estimate defined and the convergence test labeled invented; token attribution changed to whole steps only, labeled invented; leases in the proposal, labeled invented. "Provenance of components" and the new table of standard alternatives. | Text. |
| Not modeled in M4 | M5 adds the rules listed in its section. | See "Model check M5" for what it covers and leaves out. |
| Open items | Rewritten: decided items removed; the lease choice, new defaults, review-worktree drift (now designed), the wake-up rule (now designed) and the unmodeled rules listed. | Text. |
| Prose | Whole document: `tell_lint.py` blocking findings from 96 at the start of revision 5 (94 at the review) to 0 by rewording, with no keep entries; status header; a label legend; American spelling (`GrantCanceled`). | `tell_lint.py`, `bun run check`. |

## Re-review 2026-11-15 (revision 5)

An independent reviewer (Opus, fresh context, read-only, no model runs)
found revision 5 not ready. The coordinator confirmed finding 1 against
the text and check5.py. Each finding stays open until a later revision
answers it.

Blocking:

1. In fallback the text charges a finished step its grant's estimate
   ("Grant lifecycle"), while check5.py's grants scope (`Charge`) charges
   the actual cost, so the written rule and the model disagree. Under the
   text a step can overrun the cap: cap 60, reading 40; step A, estimate
   10, costs 20 and is charged 10; B asks before a reading reflects A,
   level 50 plus 10 is within the cap, B launches, and true use is 70.
   "Reconciling" says such excess appears in the step's charge and that
   rule 1 never admits what true use would refuse; both are false in
   fallback. RS5 measures accounted use rather than provider truth, so it
   cannot see this.

Should fix:

2. The ingestion guard compares SQLite row ids across tables; rowids are
   per table, so the comparison orders nothing. The wake-up rule "the
   ledger's last row id changes" has the same flaw. Use a ledger-wide
   sequence column.
3. The reflection test guards against a backward clock step but not a
   forward one: after an NTP step forward, a reading seconds after
   `Charged` passes `endedAt + reflectLag`. Also require ingestion at
   least `reflectLag` after the `Charged` row on a monotonic clock.
   Unverified: whether the statusline's `rate_limits` is fresh per script
   run or cached from the last API response (record in L1).
4. A tightening spend-down ends when the clock passes the reset time,
   which loosens policy on a timer. A reading without `resetsAt`, or one
   within `resetTolerance` of the old reset time, stays usable, so the cap
   returns to its loose value with no new period. The same gap makes
   "Periods" contradict "Pacing", and the reset-time quota-release
   exception rests on it. End a tightening spend-down only at a new period
   or `--cancel`; make old-period readings unusable by period membership.
5. C20's model evidence overclaims: only project 1 races and only project
   0 crashes, so a crash after a lost race and before the cancel is not in
   the grammar, and no ledger-write timeout is modeled. Mutant GA9 (no
   settle step at ordinary attempts) survives because of this, so leak
   repair in ordinary operation has no model support. Add a write timeout
   and a race-then-crash path so GA9 dies.
6. Lifecycle row 2 tests orphans by opId; launch-attempt step 2 and the
   model test by grantId. If a failed cancel is followed by a re-decision
   with the same opId, the first grant looks owned and stays open. Test by
   grantId; say whether the attempt ends on a failed cancel and whether
   opId is fresh per grant.
7. A project that crashed mid-step and is never restarted leaks its grant:
   `ledger settle` leaves Intended-without-Finished open and `reconcile`
   needs an `Uncertain` hold that only `run` startup creates. That is the
   restart-only cleanup the owner excluded.
8. `use(j, p, w)` counts only current-period grants, so a step that spans
   a reset uses next-period allowance that no project is charged for under
   rule 2. M5's truth abstraction adds nothing when a prior-period step
   finishes, so DC ("refuses exactly when the written level refuses") is
   false for that case; it is disclosed under "Not covered" and DC's
   description needs the qualification.
9. NIT. Startup step 5 says both "charge it" and "stay open until
   reconcile" for a successful mutating Finished with no commit outcome.
10. NIT. Several mutants (GA1-3, GA5, GA6, GA10) are killed by the
    monitor's restatement checks rather than the safety properties. BR2 is
    equivalent only because re-arming after `reconcile discard` is outside
    the grammar.

Clean on the reviewer's checks: leases appear only in the proposal and in
pointers to it; the queue default is 1 throughout; two instances cannot
both pass rule 1 on stale totals; no double charge. The six provenance
corrections were not re-checked against their sources.

## How revision 5.1 answers the re-review

Each row names a finding of "Re-review 2026-11-15 (revision 5)", the
sections changed under the owner's terms for revision 5.1, and the check
behind the change. A model check backs only the rules it models, within
its bounds (see "Claims ledger" and "Model check M5.1"), and `bun run
check` passing clears no finding.

| Finding | Change | Check |
|---|---|---|
| 1 (blocking). Fallback charges the estimate; the model charged actual cost; a step can overrun the cap | "Grant lifecycle": a charge is the step's actual use only when the run report gives an authoritative measurement in quota units; none is known, so every charge is the grant's estimate, in both modes, and token counts and dollar costs are never charged ("Measurement"). "Reconciling readings, grants and charges": the reflection test is removed, no reading reflects a grant, and every grant that may have used the period counts (rule P). The provider's count is modeled apart from the ledger, with assumptions A1-A4 stated. The reviewer's trace (a step costing twice its estimate) breaks A1; no admission rule can stop it without a per-run limit in quota units, and the text now says so (C13, "Admission rule", restrictions). Cost: up to half of foreman's share in the worst case | M5.1 grants51: AS, checked against the monitor's own provider count with delayed readings, at every launch; DC; mutants GA1 and GA2 killed by AS. The overshoot run (A1 dropped) finds the AS violation, which shows the result depends on A1. L1 and L2 (revision 5.1) measure A1 |
| 2. Row ids compared across tables | "Where the ledger lives": a ledger-wide `seq` column assigned in the writing `BEGIN IMMEDIATE` transaction, a total order because SQLite admits one writer at a time. "Clock basis" and the holds table compare a reading's `seq` with the `ledgerSeq` a hold records; "What frees room" wakes on `PRAGMA data_version` and a changed `seq` | Argument from SQLite's locking (stated in the text). Not modeled: M5.1's ledger is one atomic store |
| 3. Forward clock step defeats the reflection test | The reflection test is gone, so no clock value or elapsed time decides that a reading includes a step. What evidence could, and why none exists today, is under "Reconciling"; L1 records whether the statusline's `rate_limits` is fresh per run. `reflectLag` survives only as `fitLag`, for the rate fit | M5.1 has no reflection; GA2 (a charged step taken as reflected) is killed by AS |
| 4. Tightening spend-down ends on a timer; old-period readings stay usable; reset-time release | "Spend-down override" and "Periods": a tightening spend-down ends only at a new period or by `--cancel`; a loosening one may also end at the reset time, which tightens. "Periods" adds period membership: a reading of an earlier period is never used. "Holds", "Pacing" and C3: the clock releases no quota hold; revision 3.1's release at a passed reset time is owner decision O4, with a proposal to drop it | M5.1 stages5 (SD5 with the new end rule); M5.1 grants51 has no timer release, and AS holds; GA7 (a passed-period reading kept usable) is equivalent for AS (see "Model check M5.1"). Period membership by reset time is in the text; M5.1's single reading slot never meets an earlier-period reading (counter zero), so that rule is argued only |
| 5. C20 overclaims; no write timeout; no race-then-crash; GA9 survives | Grant lifecycle table: failed cancel and charge writes, a crash after a lost race, the final settle step before `run` exits; C20 restated | M5.1 grants51 with failed writes and a race-then-crash path; GA9 killed by LK in a run that ignores the restatement checks |
| 6. Orphan test by opId | "Grant lifecycle": the test is by `grantId`; `opId` is fresh for every grant; a failed cancel ends the attempt. Launch attempt step 2 and startup step 5 say `grantId` | M5.1: GA12 (test by operation) is missed, equivalent within the grammar because every attempt settles before it can append a new `Intended` for the same operation; the `grantId` test is argued as the one that stays right if that ordering changes. LK holds with the failed cancel and the relaunch under a new grant |
| 7. A crashed, never-restarted project leaks its grant | `ledger settle` now kills the recorded process groups as startup does and charges each `Intended` without `Finished` at its estimate, without restarting the project and without a hold; startup step 5 does the same, so no grant waits for `reconcile` | M5.1: LedgerSettle on a project that stays down; LK; GB3 (revision 5's rule) killed by LK |
| 8. A step spanning a reset is uncharged in the new period; DC overstated | Rule P ("Reconciling"): an open grant counts in every period, and a charged one counts in the next period unless it ended at least `resetTolerance` before the previous reset time; `use(j, p, w)` uses the same rule, so rule 2 counts it too. M5.1's truth is the monitor's own provider count, and DC is labeled a restatement | M5.1: AS with steps that span the reset (counter `launch_spanning_carried`); GB2 (revision 5's own-period rule) killed by AS |
| 9 (nit). Startup step 5 contradiction | Startup step 5: a successful mutating `Finished` with no commit outcome is held `Uncertain` for its git effect and its grant is charged; `reconcile` no longer touches the ledger | Text |
| 10 (nit). Mutants killed by restatement checks; BR2 | `mutate51.py` runs every mutant with `--safety-only`, which drops the restatement checks DC, K and UK too, and reports the property that kills each. BR2 and the stages mutants were not rerun (cut for time); their M5 results stand for the unchanged rules | `research/model/mutate51-run.txt`; see "Model check M5.1" |
| Owner's terms 7 and 8 | O1-O6 listed in open items; the leases stay a proposal; the review-queue default stays 1; single `BEGIN IMMEDIATE` admission and the unique key are unchanged | Text |

## Owner ruling 2026-11-15 on revision 5.1 (before its re-review)

- `ledger settle` killing another instance's process groups is not
  authorized. It stays a proposal, which needs process-identity
  validation, ownership rules and protection against reused process
  identifiers.
- Reserve safety remains conditional on estimates being upper bounds
  (A1). Conservative double counting does not repair an underestimated
  step; the demonstrated overshoot stays prominent.
- The reduced M5.1 grammar narrows the evidence for delayed accounting and
  accumulating leaks; equivalent mutants are reported separately from
  missing coverage.
- No decision yet on the reduced usable share, O5, O6 or the earlier open
  items (O1 to O4).

## Re-review 2026-11-15 (revision 5.1)

An independent reviewer (Opus, fresh context, read-only, no model runs)
gave "approve with fixes" but reported one blocking finding, so the
coordinator records revision 5.1 as not ready. The coordinator confirmed
finding 1 against the text and check51.py.

Blocking:

1. Rule P undercounts when a usage drop opens a period. It skips a charged
   step of period k−1 when `endedAt + resetTolerance ≤ R`, with R the
   scheduled reset time, which can be well after the provider's real
   boundary. Trace with A1 holding: the provider resets early at t0; step
   A ends at t1 > t0 having used new-period allowance and is charged with
   `endedAt` before R − tolerance; a reading as of just after t0 shows the
   drop and opens k; A is not counted and the reading omits it, so AS
   fails. Second route: a delayed old-period reading without `resetsAt`
   becomes the current period's highest reading, the next genuine reading
   looks like a drop, and a spurious period starts rule 2's allocations
   over and drops every charged step from the level. "Not covered", O6
   and the restrictions row name the wrong branch. check51.py has no drop
   event. Fix: in a period opened by a drop or `ledger reset`, count every
   non-canceled grant of k−1; a reading observed before a period opened
   cannot set that period's highest; model a drop-opened period or label
   the rule argued only.

Should fix:

2. `ledger settle` (a proposal; see the owner ruling above) records only
   `Launched(opId, pgid)`: no process-identity check and no guard against
   a reused pgid, so a kill days later can hit an unrelated process or
   another project's live agent. It appends nothing to the project's log,
   so that project's next startup kills the same pgid again. The model
   kills only rows marked alive and hides both. A proposal needs the
   leader pid with its start time (macOS has no pidfd), verification of
   each group member before signaling (or a per-operation flock'd marker),
   refusal on mismatch, the project's lock, and an `Ended` record in the
   project's log.
3. The worst-case cost is understated. The level counts the reading (real
   use u) plus the estimate E, so foreman's real use is bounded by
   share · u/(u + E); half only when estimates are exact, and less when
   E > u, which is normal since estimates are the largest of the last
   five steps. Open grants carried into the next period add to the cost.
4. Pacing still picks the newest reading by `observedAt`; after a backward
   clock step an older, lower reading wins. Use the highest `usedPercent`
   among usable readings in the period (tightest bound under A3).
   Freshness is wall-clock based, so a backward step lengthens a
   reading's usability.
5. AS counts only outside use a reading saw, and amendment 3 allows one
   outside unit in total, so no safety property guards the Unknown rule;
   GA8 (Unknown treated as Allow) survives. Add a property on the
   provider's total count with unseen outside use bounded by the reserve,
   and allow at least reserve + 1 outside units.
6. On the owner's focus: the overshoot is prominent in C13, the
   restrictions table and M5.1, but the admission rule names A1 without
   the run, and "it appears in later readings and makes every project's
   later steps wait" implies readings repair an underestimate; under A2
   they may not, and launches admitted meanwhile are unsafe. "The safe
   direction" in two restrictions rows holds only under A1.
7. NIT. Stale text: the restrictions row on a skewed clock releasing a
   rate-limit hold early; "Revision 5 made one exception" (O4 says 3.1);
   check51.py's header body still describes the pre-amendment scope.
8. NIT. GB4 is killed by ND's check, not AS. C20 claims failed-write
   coverage, but the settle step's own write failures are not modeled.
   `PRAGMA data_version` has no polling interval in the text.

Missed mutants, separated as the owner asked. Equivalent within the full
written design: GA12 (opId is fresh per grant, so the two tests agree);
GA4 for safety only (in the text it can cause a spurious Quota hold,
which the model cannot see). Missing coverage: GA7 and GA8 (AS by
definition excludes unseen outside use; only the restatement UK sees
them); GA11 (git safety, outside grants51; M3 covers it). Every amendment
narrows coverage and proves nothing equivalent: stale readings dropped
(freshness unchecked), charge-write failure only for project 0, one
operation per project and cap 2 (accumulating leaks and a project
counting its own earlier step untested), one outside unit (GA8), project
1 crashing only after a lost race. Amendment 4 (AS at every launch) is a
sound strengthening.

Found sound: AS is computed from the monitor's own events, independent of
the ledger, at every launch; GA9 is killed by LK; the `seq` total order
holds for local WAL under `BEGIN IMMEDIATE`, and no cross-table row-id
comparison remains; hold release needs both `observedAt` and `seq`; no
elapsed time or clock jump counts as reflection; charges are always the
estimate; O1 to O4 remain open; queue default 1, single-transaction
admission and the unique key are unchanged; historical text preserved.
Unverified: whether real providers reset early.

## How revision 5.2 answers the re-review

Each row names a finding of "Re-review 2026-11-15 (revision 5.1)" or one
of the owner's requirements for revision 5.2, the sections changed, and
the check behind the change, or why it stays open. A passing model check
supports only the rules it models, within its bounds ("Model check
M5.2" lists what it leaves out), and `bun run check` passing does not
establish that the design is ready.

| Item | Change | Check, or why open |
|---|---|---|
| Finding 1 (blocking): rule P undercounts after an early reset or a drop-opened period | "Reconciling": rule P counts every grant not canceled or retired; only the owner's `ledger retire` retires one. "Periods": a usage drop opens no period; a reading observed before `ledger reset` never joins the period it opens. Automatic retirement and drop confirmation are proposals O7 and O9 | M5.2 periods52, TC with early resets, late readings that arrive out of order, and false drops; PA1 (revision 5.1's rule) and PA2 (a drop opens a period) killed by TC |
| Finding 2: `ledger settle` kills without process identity | `ledger settle` signals nothing ("Grant lifecycle"); the requirements are in "Proposal: cross-instance process termination (awaiting owner approval)" | Body: M5.2 leaks52 (LK after `ledger settle` allows only steps that may still run; GB5 killed by ND). Proposal: not modeled; the model work it needs is listed there |
| Finding 3: worst-case share understated | "What this costs": share times u/(u + E); a third when estimates are twice real use; open and unretired grants lower the next period's room. Restrictions row corrected | Argument (arithmetic in the text); counter `refused_only_by_carried_charges` |
| Finding 4: newest reading by `observedAt`; wall-clock freshness | "Pacing": the highest `usedPercent` of the period's readings; freshness and post-hold on the monotonic clock with the boot id; "Clock basis" | PA3 (newest by wall stamp), PA5 (wall-clock freshness), PA7 (freshness ignored) killed by TC. Cross-process monotonic clock: L4 |
| Finding 5: no safety property guards Unknown; GA8 survives | Property TC on the provider's total count; outside use up to reserve + 1; assumption A5 stated | GA8 killed by TC in periods52, a safety property and not a restatement |
| Finding 6: wording implies readings repair an overshoot | "Admission rule" now states A1 and A5, M5.1's overshoot run and M5.2's `--no-a5` run, and that launches admitted before a reading shows an excess are unsafe; A1's bullet says the estimate does not prevent overshoot; two restrictions rows say "safe direction only under A1 (and A5)" | Text |
| Nit 7: stale text | Restrictions row on `resetsAt` rewritten; "Revision 3.1 made one exception" under "Holds"; check51.py's header noted under "Model check M5.2" (the file stays unedited, requirement 9) | Text |
| Nit 8: GB4's killer; settle-write failures; `data_version` polling | M5.1 section corrected (ND's condition); check52 tags it ND; settle-step write failures modeled (RunSF, StartSF, LedgerSettleSF); `dataVersionPoll` proposed at 1 second under O3 | leaks52 (GB4 killed by ND; GL1, GL2 killed) |
| Requirement 1: repair without adopting O5 or O6 | Most conservative option in the body (owner-only retirement, no drop-opened periods); O7 and O9 list the options with costs. O5 and O6 stay open; O6's revision-5.1 rule is replaced in the body by the stricter one, and O6 itself stays unadopted | periods52 TC |
| Requirement 2: model cases and TC | periods52 covers early resets, late readings that arrive out of order, false drops, a backward clock step, readings without reset times and Unknown. It adds TC, allows outside use of reserve + 1, and checks the new reading selection and freshness | periods52 run 6: no violation, liveness 0; GA8 killed by TC |
| Requirement 3: accumulating leaks | leaks52: two operations per project, separate from periods52, each with its limits stated | leaks52 fourth run: no violation, strict liveness 0 |
| Requirement 4: usable share and wording | As findings 3 and 6 | Text |
| Requirement 5: classify surviving mutants | "Model check M5.2" table and `mutate52.py` output: PA6, PA8, GA4 safety-only equivalent; GA11 separate coverage; GA12 equivalent; none missing coverage | `research/model/mutate52-run.txt` |
| Requirement 6: cross-instance termination stays unapproved | Proposal section with identity, locking, signaling, end record and failure cases; body text no longer has `ledger settle` kill; what that leaves open is under "Grant lifecycle" | Proposal not modeled |
| Requirement 7: nits | As nits 7 and 8 | |
| Requirement 8: decisions stay open | O1-O9, the reduced share and termination listed under "Open items"; none adopted. New: O7, O8 (`ledger retire`'s form), O9, `dataVersionPoll`, the statusline's monotonic stamp | Text |
| Requirement 9: history preserved; new model files | Historical reviews and rulings unchanged; check4.py, check5.py, check51.py, mutate5.py, mutate51.py and their outputs unchanged; check52.py, mutate52.py and their outputs added | `git diff` shows no change to those files |
| Requirement 10: status, this table, prose gate | Header says revision 5.2 and that it awaits re-review | `tell_lint.py` on new text; `bun run check` |

Still open after revision 5.2: whether A1 and A5 hold (L1, L2); whether
`CLOCK_MONOTONIC` is comparable across processes (L4); O1-O9; the
termination proposal; and every item under "Not covered by M5.2".

## Re-review 2026-11-15 (revision 5.2)

An independent reviewer (Opus, fresh context, read-only) found revision
5.2 not ready, with two blocking findings. It replayed both traces with
check52.py's own `p_decide`, `p_events` and `pm_check`; the coordinator
reran both replays and saw the same results (the written rule and the
PA6 mutant each give a TC violation; the unmodified model refuses). The
replays and their outputs are kept in research/model/review52-2026-11-15.

Blocking:

1. The rule for readings after `ledger reset` breaks TC under A1-A5.
   "Periods" excludes a reading observed (monotonic clock) before the
   command; check52.py excludes by snapshot index (`idx <= s["lobs"]`),
   and `Snap` is the provider's capture, so the model orders by as-of
   moment, which foreman cannot observe. Amendment 5's claim that
   snapshot indices stand for observation order is false. Trace: Reset,
   Outside, Snap(B, with reset time, 1 unit), Outside, Snap(A, no reset
   time, 2 units), Ingest A, LedgerReset, Ingest B (observed after the
   command, so it joins under the written rule), Run: level 1 + 1 within
   cap 2, launch; provider count 2 plus estimate 1 exceeds cap plus
   min(unseen, reserve) = 2. A1 and A5 hold. Fix: a period opened by
   `ledger reset` uses the highest of every reading ingested since the
   last period-opening reading, or stays unusable until a reading with a
   later reset time arrives; model observation separately from capture.
2. The model enforces a stronger A5 than the text: its Ingest guard
   blocks every pending reading after more than the reserve of outside
   use, while the text's A5 constrains only the newest ingested reading,
   and under A2 an old reading may arrive at any time. PA6 is therefore
   misclassified as safety-only equivalent: a joined old reading also
   sets freshness. Trace: Snap1 (period 0), Reset, Snap2, Ingest 2,
   Stale, Outside, Outside, Ingest 1 (joins, refreshes freshness), Run 0,
   Run 1; the second launch breaks TC (4 > 3). A5 is also circular ("for
   as long as foreman holds a fresh reading"). Fix: state A5 on the
   provider side (delay at most D; outside use in any interval of length
   freshness + D at most the reserve), guard only the newest reading,
   rerun and reclassify PA6 and PA8. A live test can measure the lag from
   a known outside request to the reading that shows it.

Should fix:

3. `ledger retire` rests on an attestation no one can make under A2; in
   practice the owner will retire at the scheduled reset, which is 5.1's
   unsound rule done by hand. C13 and TC say "under A1-A5" without it.
   Add it as an assumption and say no sound criterion exists under A2.
   State the cost in numbers: with cap 70 and estimate 15, each
   five-hour reset stops launches until the owner retires, so an
   unattended night gets about one period.
4. The monotonic clock is sound on macOS (`CLOCK_MONOTONIC` continues
   through sleep; consistent across processes; `kern.bootsessionuuid`
   exists), but Bun's `process.hrtime.bigint()` counts from process
   start and a shell statusline script cannot read `CLOCK_MONOTONIC`.
   Name the call (FFI or a helper binary), forbid hrtime and
   `performance.now` in Bun, and add this to L4.
5. The estimate rule ("a usable reading before it and one after it") and
   the feedback loop do not say which clock orders readings against
   steps; a backward wall-clock step shrinks the measured increase and
   the estimate, making A1 likelier to fail. Use the monotonic clock and
   ledger `seq`.
6. Stale text: "What frees room" still lists a new period and omits
   `ledger retire`; `use` still speaks of a step that "may have run into"
   this period; borrowed allocation "stays used for the rest of" the
   period is now true until a retire.
7. Startup recovery step 1 sends SIGKILL to the recorded `-pgid` with no
   identity check; 5.2's answer for a never-restarted project is to
   restart it, possibly days later. Apply the proposal's identity check
   or record the hazard as open.
8. NIT. Termination proposal: when the leader has died and children are
   reparented, the leader and parent-chain checks always fail, so a
   common orphan can never be ended; the check-then-signal window should
   be named. Otherwise confined to its section and sound on locking,
   crash between `EndRequested` and `Ended`, partial kill and contention.
9. NIT. O6 still describes 5.1's rule as live; the M5.2 heading "all
   above zero" sits over a leaks52 run with seven zero counters;
   check52.py's grammar header still lists `ClockPass` and three outside
   units.

Mutant spot checks: PA6 wrong (finding 2); PA8 acceptable only under the
circular A5; GA4 safety-only equivalent, correct; GA12 equivalent,
correct; GA11 separate coverage, plausible (unverified that M3 includes
this startup path). Amendments' losses are stated accurately; none drops
a case in requirement 2; requirement 3 is met in part (leaks52 spends no
units, and periods52 has no second launch against a project's own
carried charge), both stated.

Found sound: TC tracks the provider's whole count independently of the
ledger at every launch; the `--no-a5` trace reproduces; rule P discards
nothing on a scheduled reset, drop or new period; a drop opens no period;
highest-reading selection is sound under A3; termination is not adopted
in the body; O1-O9, the usable share and termination stay open; review
and ruling sections are unchanged; the usable-share formula and the
overshoot wording meet requirement 4.

## How revision 6 answers the admission contract

Revision 6 answers the owner's ruling of 2026-11-15 and the contract
review recorded in [the admission contract](2026-11-15-admission-contract.md).
No implementation is part of it, no model file was written and no file
under `research/` was changed. `bun run check` passing says nothing about
whether the design is ready.

The owner's ruling:

| Ruling point | Change in revision 6 |
|---|---|
| Admission is pacing; no claim that it keeps provider usage below the cap or preserves a reserve | Header; "Pacing" (opening paragraph); "What admission bounds and what it does not" under "Admission rule"; C7 and C13 restated; reserve wording under "Allocations, reserve and borrowing"; restrictions rows on overshoot, on freshness, and on the wall clock |
| Conditional safety stays research with its complete assumptions | "Research: conditional admission safety (not a design claim)", with the contract's full assumption table (A1-A5, the provider-side A5, the retirement attestation, the clock, the request-time period, readings arriving); the claims ledger cites neither TC nor AS |
| Simplify around the operational limits. Remove any implication that freshness proves capture recency, that a reset frees accounting room, or that an attestation is evidence. Keep the unattended estimates prominent | Freshness defined as observation recency ("Pacing"); "What a new period changes" under "Periods" and "What frees room"; `ledger retire` described as an unverified owner attestation; "Unattended launches" under "Admission rule", the header and C22. Grants, charges at estimate, cancel, settle at launch attempts and startup, `seq` order under `BEGIN IMMEDIATE`, the holds, the review-queue default of 1 and every owner decision are unchanged |
| Clock helpers, `bun:ffi` and the signaling procedure are proposals | "Proposal: clock acquisition (awaiting owner approval)" (O11); "Proposal: startup signaling identity (awaiting owner approval)" (O12); startup recovery step 1 states its hazard |
| Normalized paths in future outputs | New text names evidence by repository-relative paths only; no output file was written |

The contract's items:

| Contract item | Change, or why it stays open |
|---|---|
| Definitions (capture, observation, ingestion, freshness, period membership, with clocks) | The table under "Pacing", without the model column |
| M1 (exclusion after `ledger reset`: observation order in the text, capture order in the model) | Moot in the body: `ledger reset` is removed. Kept in the research section with T1 |
| M2 (A5 circular in the text, provider-side in the model) | Research section; neither form of A5 is adopted |
| M3, M4, M5 (wall stamp at capture; observation merged with ingestion; the model's owner knows the truth) | Research section. The body now says the retirement attestation is unchecked. The model files are not changed (no new model files in this revision) |
| M6 (clock ordering readings against steps) | The estimate rule under "Pacing" uses the monotonic clock in one boot |
| Assumptions table | Research section, complete |
| T1, T1b, T1c and R1 | Research section; R1 not adopted; `ledger reset` removed (O10) |
| T2, T2s and R2 | Research section; R2 not adopted. The body no longer treats freshness as evidence of recency, so no design claim depends on them |
| Full periods52 rerun with R1 and R2; PA6 and PA8 reclassification | Not done; stated in the research section |
| Clock acquisition | Proposal section and O11; until approved no reading is fresh |
| Retirement and unattended cost | `ledger retire` under "Usage ledger"; "Unattended launches"; C22. O7 and O8 stay open |
| Startup signaling | Startup recovery step 1, the proposal section and O12 |
| Feasibility conclusion | Research section; the body follows it |

What revision 6 removes, and why:

- Assumptions A1-A5 and properties AS and TC as design text: their only
  purpose was the provider-side safety claim, which the ruling
  withdraws. They are kept in the research section.
- `ledger reset` and its membership exception (a reading observed
  before the command never joins the period it opens): under the
  contract's repair R1 the command would loosen nothing, so as a marker
  it would change no decision while adding a record kind, a membership
  exception and a claim. Removing it is simpler than keeping a marker;
  the owner keeps the waiver and the spend-down as explicit loosening
  paths. O10 asks the owner to confirm.
- The paragraph saying the reserve's safety holds under A1 and A5, and
  "costs room and never costs safety" under "Grant lifecycle": both
  stated a provider-side property.
- The Defaults row naming `resetTolerance` as rule P's clock-skew bound:
  rule P reads no clock since revision 5.2.
- Owner decision O6: it described revision 5.1's rule P, replaced in
  revision 5.2, and periods opened by a drop or by `ledger reset`, which
  no longer exist.

Kept although the safety claim is gone, because pacing over foreman's
records still uses them: the highest-reading rule (a late lower reading
never lowers the figure), freshness on the monotonic clock (the
contract's definition; a wall-clock age shrinks when the clock steps
back), the post-hold test, the rule that an earlier period's reading is
never used, and the rule that a passed reset time makes readings
unusable (it only tightens).

The re-review of revision 5.2:

| Finding | Status in revision 6 |
|---|---|
| 1 (`ledger reset` breaks TC) | Moot: the command is removed and TC is research |
| 2 (A5 stronger in the model; PA6 misclassified) | Research section; rerun and reclassification not done |
| 3 (`ledger retire` attestation; cost in numbers) | Attestation stated; figures under "Unattended launches" and C22 |
| 4 (monotonic clock acquisition) | Proposal section; forbidden sources listed; L4 item |
| 5 (clock in the estimate rule) | Fixed under "Pacing" |
| 6 (stale text on freeing room, `use` and borrowing) | Fixed in "What frees room" and "Allocations, reserve and borrowing" |
| 7 (startup SIGKILL without identity) | Hazard stated in step 1; proposal; O12 |
| 8 (termination proposal: reparented children, check-to-signal race) | Named in the startup signaling proposal, from the contract; the termination proposal's own text is unchanged and still open |
| 9 (O6 stale; M5.2 counter heading; check52.py header) | O6 removed. The M5.2 section is history and `research/` is not edited, so the other two stay as they are |

Claims that changed backing: C13 and C16 are argument only (they cited
TC and periods52); C22 is new and argument only; C7's reserve
arithmetic is argument only; C10 and C20 depend on startup step 1,
whose signaling hazard is open. The checks they need are O13.

## Re-review 2026-11-15 (revision 6)

An independent reviewer (Opus, fresh context, read-only, about 101k
tokens against a 100k budget, 17 tool calls) gave "approve with fixes"
with finding 1 marked borderline blocking. The coordinator confirmed all
seven findings against the text and records finding 1 as blocking,
because the headline unattended figures that the owner asked to keep
prominent state launches that the design's own O11 rules out.

1. Blocking. O11's consequence ("until one is approved, no reading is
   fresh and every launch needs a waiver") appears only in the clock
   proposal, the restrictions table, Open items and the answer section.
   Pacing's usability bullet and the admission rule do not state it, and
   "Liveness" says only that "the first Claude launch after a quiet
   period may be Unknown". The header, "Unattended launches" and C22 say
   foreman "makes" about 2 to 4 launches in an unattended night; without
   a waiver the number under O11 is zero. Even after O11, Claude
   readings come from the statusline during the owner's interactive use
   and freshness is 10 minutes, so an unattended night probably gets
   about one launch. The figures are accounting ceilings, not expected
   launches.
2. Should fix. "Pacing" says the wall clock enters in two places, both
   tightening, including "reset times sort readings into periods".
   Opening a period compares provider reset times with each other, and a
   new period can lower the reading term, which loosens; "What frees
   room" lists it. The membership row of the definitions table says
   "against the Mac wall clock (A4)".
3. Should fix. Provenance calls the admission level "Faithful escrow"
   with "every reservation counts until its period ends"; in revision 6
   grants carry across periods until an owner attestation, which is a
   departure.
4. Nit. Rule 1 and "What admission bounds" say "estimate" where the
   level and C13 use `amount` (the estimate for an open grant, the
   charged amount for a charged one).
5. Nit. The label legend still points to O1-O6; O6 is removed.
6. Nit. M5 stages5 models the reading as the exact provider count
   (check51.py `used = Σ spend + out`); SB, BR and WV are about foreman's
   decisions, but SD5's backing is against an idealized reading. The
   claims ledger's "properties of foreman's own records" needs that note.
7. Nit. The Defaults intro refers to "rows marked revision 5"; none is
   marked.

Found sound: no residual claim about provider usage, the reserve,
capture recency, a reset freeing room, or `ledger retire` as evidence;
the unattended arithmetic matches the Defaults table; the grant
lifecycle, periods and "What frees room" agree apart from findings 2 and
4; every claim names a check or says argument only and none cites TC or
AS; LK, ND, WV and SB check foreman's own records; startup step 1 states
its hazard and the proposals are confined to their sections; `ledger
reset`'s removal is put to the owner as O10; no new invented machinery.
