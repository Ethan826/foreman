# Roadmap: from dogfooding to running reliably in another repository

Status: proposal, 2026-11-24, written at the owner's request. Each item
needs its own task and authorization. Order is a recommendation.

To reach dogfooding quickly, the assisted cycle was built with edge
cases left to the owner and the coordinator. This lists what remains,
split by what reliable assisted use in a second repository needs (the
owner still approves each step) and what the design's unattended mode
needs. Sizes are rough: S is one foreman cycle like dogfood-3b or 4, M
is two or three, L is more, with a design revision first.

## A. Assisted use in another repository

### A1. Repositories tarlatan refuses today

| Item | Today | Needed | Size |
|---|---|---|---|
| Attribute sources | The allowance admits no line or Waxwing's one line (ruling B06); any other `.gitattributes`, `core.attributesFile` or `includeIf` refuses `worktree create` (B11c). | A general allowance: which attribute lines are safe under the clean environment, decided per target and recorded in the binding. Needs a design revision. | M |
| Repository shapes | Gitlinks, nested repositories, special files and non-SHA-1 object formats refuse the snapshot (B08, M14). | Decide which to support (submodules most likely) and how the snapshot covers them. | M |
| The target's toolchain in the sandbox | Tarlatan's own tests cannot spawn processes inside the editing sandbox (`spawn EPERM`, 2026-11-24 probe), so its check commands are `bun run docs` and `bun run check` only. | A probe per target before its first cycle, recorded with the target, and a list of in-sandbox failures the task can name. Find which tests fail here and why (follow-up). | S per target |

### A2. Manual steps in every cycle

| Item | Today | Needed | Size |
|---|---|---|---|
| Pacing | `nowMono` is not wired and no usage reading is taken automatically, so every launch needs `--waive` (O11). L1 and L2 showed both clients' readings can be read. | Wire the monotonic clock and the Claude and Codex readings into admission; enter the Codex windows into the default policy. Borrow the fail-closed rules noted in the prior-art lessons. | M |
| Commit and branch movement | The owner (or coordinator) commits in the supervisor worktree, fast-forwards the owner's branch and `main`, and fast-forwards the supervisor branch before the next session. | B11's commit procedure: a temporary index, `update-ref` with the old value, the protected digest, and a recorded step that advances the supervisor branch to a new base. | M |
| Tests and checks | The owner's `check.sh` runs the full suite outside tarlatan, unsandboxed, in a worktree whose ignored paths no reviewer saw. | The approved check step ([proposal](2026-11-23-check-step-proposal.md)): tarlatan runs configured checks on a fresh checkout of the snapshot tree under its own profile, records them and passes them to the reviewer. | L |
| Rulings re-raised in review | The owner's findings file and rulings reach the corrector but not the reviewer, so a ruling is raised again each round (dogfood-2, 2b, 3a). | Carry the session's owner rulings (and the previous findings file) into the review brief. | S |
| Corrections budget | Each cycle allows two corrections; precedence between coexisting failures used most of them. | Revisit after the rulings item, with data from the next cycles. | S |

### A3. Containment gaps

| Item | Today | Needed | Size |
|---|---|---|---|
| Bash reads | Claude Code 2.1.331 runs read-only shell commands no allow rule names (`cat`, `ls`, `find`, recursive `grep`), and the sandbox denies no read, so files outside the worktree are readable (dogfood-4 finding). | `sandbox.filesystem.denyRead` for secrets (`~/.ssh`, tokens, `~/.claude`, the state directory), plus an L3 case for reads. | S |
| Codex review configuration | The review loads the owner's `~/.codex/config.toml` and rules files. | `--ephemeral --ignore-user-config --ignore-rules` ([prior-art lessons](2026-11-23-prior-art-lessons.md)), with an X-case rerun. | S |
| Nested protected names | Protected names below the top level are denied to the Edit tool only, not to code run in the sandbox. | Deny them in the sandbox too, or snapshot-check them. | S |
| Ignored paths | `node_modules`, `site` and `.build` never reach review, and the owner's check runs them. | Covered by the check step's fresh checkout (A2). | with A2 |
| Claude session persistence | Sessions are saved to disk and resumable. | `--no-session-persistence` (prior-art lessons). | S |

### A4. Process control

| Item | Today | Needed | Size |
|---|---|---|---|
| Ending a step | Tarlatan never signals; an interrupted or hung launch leaves its processes (orphans ran for days in November); the owner's rule is manual. | B12: each step in its own process group that tarlatan can end; B14: startup recovery that checks for survivors with a signal-0 probe and holds. | M |

### A5. Client drift

| Item | Today | Needed | Size |
|---|---|---|---|
| Pinned versions | Claude updated itself once (2.1.330 to 2.1.331); the pin refuses until the owner moves it, and the evidence for a new version was a full L3 rerun. | A cheap compatibility smoke (stream shape, profile flags, one sandbox denial) run before a pin moves, with the full L3 kept for profile changes. | S |

## B. The unattended design

B13 (the launch loop as `run`), B15 (requests: reconcile, restore,
approve against a new base), B17 (allocations and the rate fit), B18
(alerts to the owner's phone), the review worktree, and L4 (crash and
restart, live). Each is in the [implementation plan](2026-11-15-implementation-plan.md).

## Recommended order

1. Waxwing onboarding: its configuration, its sandbox probe, a first
   real task (A1's toolchain item for Waxwing; W1 covers its attribute
   line).
2. Rulings in the review brief (A2), small and saves rounds at once.
3. Pacing (A2), so launches stop needing waivers.
4. The containment items of A3, in one profile change with one L3
   rerun.
5. Process control (A4).
6. The check step (A2).
7. The commit procedure (A2).
8. The general attribute allowance and repository shapes (A1), before
   a second repository with `.gitattributes` or submodules.

Items 1 to 3 make Waxwing work comfortable; 4 to 8 are what "pretty
reliably in another repository" needs.

## Progress

### Waxwing onboarding (2026-11-24)

- Waxwing's checkout was on `r005b-replan`, whose commits are all on
  Waxwing's `main`. The unlanded work was `scope-a-impl` (Scope A,
  2026-11-14). With the owner's approval the coordinator merged `main`
  and `research/effect-kinds` into it as `integrate/scope-a`, carried
  the loose notes over and moved non-Waxwing files to
  `~/Desktop/waxwing-loose/`. The merge does not build: `main` renamed
  `Add` to `Arith` and three Scope A modules still match `Add`.
- Tarlatan for Waxwing runs from a release: tag `v0.1.0` (1c564bd,
  local), checked out at `~/Desktop/tarlatan-release/v0.1.0`, through
  `~/.config/tarlatan/tl-waxwing` with `waxwing.json` (project
  `waxwing`, state `~/Desktop/waxwing-state`, supervisor
  `~/Desktop/waxwing-wt/work` on `tarlatan/work`, base faf4c6bb, the
  shared ledger `~/.tarlatan`). Dogfooding stays on the checkout with
  `tl`. The ledger has no schema version, so a ledger change needs a
  new release and, first, a version check (follow-up).
- `worktree create` accepted Waxwing's attribute line and its 15
  symbolic links.
- Sandbox probe (production's profile and argv, Claude 2.1.331, one
  run, $0.20): `node scripts/build.mjs` (spago and purs),
  `node scripts/width.mjs`, `purs-tidy check src tools/style/src`,
  `node --test test/width.test.mjs` and `go run bootstrap/answer.go`
  all ran in the sandbox; only the build failed, on the three known
  errors. The worktree was unchanged. The check commands are the first
  three. Correction (found by the durable-effect session): the probe's
  command used `\|` alternation in a basic sed regex, which macOS sed
  does not support, so it stripped no `CLAUDE*` or `GIT_*` variable and
  the probe ran with the coordinator session's environment. The
  cycles, launched through `tl`, ran the same three commands in the
  sandbox, so the conclusion stands. The reusable
  `~/.config/tarlatan/probe.sh` uses `sed -E` and is fixed. The full
  `verify` runs outside through
  `~/.config/tarlatan/check-waxwing.sh` (logs in
  `~/Desktop/waxwing-checks/`).
- First task: [waxwing-1](2026-11-24-waxwing-1-task.md), the build
  fix. Implement succeeded ($1.58). The owner interrupted the review
  (its output streams through `tl`'s stdout and would flood the
  coordinator's context), and the session could only close
  interrupted. Getting back to review cost a second session,
  [waxwing-1b](2026-11-24-waxwing-1b-task.md), and an implement launch.

### New items from Waxwing-1 (owner, 2026-11-24)

| Item | Today | Needed | Size |
|---|---|---|---|
| Retry and back up | An owner-ended attempt leaves only `session close --interrupted`; a step cannot be re-run. | After `step-ended`, the session returns to its state before that attempt, so the step can run again. Each step's snapshot is kept as a commit on a private ref (`refs/tarlatan/<session>/<opId>`), so a session can resume or back up to any logged step. Design with the commit procedure (A2). Needs a design revision. | M |
| Quiet stdout | `tl` passes the client's event stream through to stdout. | Print only tarlatan's result; keep the stream in the state directory, as the raw files already are. | S |
| Ledger version | Done in v0.1.1 (dogfood-5 and 5b): both stores carry `PRAGMA user_version`; a newer store is refused, `status` reports versions. | | S |
| Task review and structured rulings (includes "rulings reach the reviewer") | The task file is drafted and reviewed outside `tl`: no log entry, no admission, no record tying the approved task to the review it passed. The owner's findings file reaches the corrector, not the reviewer; in waxwing-1b the third review flagged the owner's ruling O4 as a major violation of the task's O1, and with corrections spent the session could only end abandoned. The pre-session task review caught three blocking problems in waxwing-1's draft. | (1) `tl task review <draft>`: a fresh read-only reviewer against the base, its findings recorded and the draft hashed; `session open` requires a reviewed draft of that hash, or the owner's waiver. (2) Rulings as structured data: a section `tl` parses and carries into every brief (implement, review, correct), and a logged command for adding a ruling mid-session that reaches the next reviewer; an owner override cites a ruling by id. Drafting the task and approving it stay with the owner and the coordinator (no approval by a model). A design note first, citing the prior-art lessons. Owner ruling needed on the form. | M |
| Owner overrules a finding | Only a review with no findings allows `close --finished`, so a finding the owner overrules forces `--abandoned` and a commit by exception (dogfood-2, 3a, waxwing-1b, durable-effect de-1). The two-correction limit (`maxCorrections`) has no override either: dogfood-5 hit `CorrectionsExhausted` on a minor finding and needed a second session. | A recorded owner override, such as `close --finished --overrule <finding> --note`, logged with its reason. Owner design ruling needed: which findings may be overruled, and whether the override needs a fresh review. | S-M |
| Pin selects the binary | The pin is checked against whatever `claude` is first on PATH. Claude Code updated itself mid-session; the check refused the launch (fail closed), and recovery needed a PATH entry in the wrapper. | The pin names the executable (a path or a version directory), so tarlatan launches that build and checks it. | S |
| Agent-run tests | Check commands are exact Bash rules, so the agent cannot run one test file, and the full suite outruns a Bash call. Six of waxwing-1's failures surfaced only in the owner's verify. | With the check step (A2): an allowed argument pattern for a test runner, limited to the target's test files, examined for containment first. | M |

Recommended order: retry and back up, then task review and structured
rulings and the owner override, before item 2 below. The fresh task
review before each session caught three blocking problems in
waxwing-1's draft and stays part of the procedure.

### Stage 1: the store version check (2026-11-25)

Dogfood-5 and 5b built the version check and shipped it as v0.1.1
(record in the assisted-cycle plan). Lessons for the items above:

- The pre-session task review (Opus, 145k tokens) found eight
  important problems and no blocking ones; one proposed ruling came
  back from review 2 as wrong (an equality check between two version
  reads), and the coordinator replaced it mid-session.
- The reviewer cannot see what the coordinator verified outside the
  loop: review 3 asked again for a mutation run the coordinator had
  already done. This belongs with "rulings reach the reviewer".
- Neither the implementer nor the reviewer could run a test in the
  sandbox (`EPERM` on temporary directories, or the command refused),
  so every mutation check ran in the coordinator's isolated copy. This
  strengthens "Agent-run tests".
- The supervisor worktree lost its copied `node_modules`, and the first
  implement step ran without checks. A preflight in `session open` or
  `implement` should refuse a worktree whose check commands cannot
  start (A2).
- The owner gave a standing authorization for the non-automated loop
  (review and correct to exhaustion without per-step approval), which
  removes most of the friction until the run loop exists.

### Feedback from durable-effect (2026-11-24 and 25)

The durable-effect session's log
(`~/Desktop/tarlatan-feedback/durable-effect.md`, ten items) ranks:
(1) an owner override at close, which has now forced an abandoned close
on every target ("Owner overrules a finding"); (2) mid-session rulings
the reviewer and corrector see ("Task review and structured rulings");
(3) read-only text tools in the editing profile: the profile blocks
`sed` and `awk`, so de-1's agent retyped 1,101 lines of a verbatim move
and could not check its own column limit (new item, S); (4) long checks
outside the Bash limit ("Agent-run tests"); (5) a model-free probe (the
probe cost $1.16 against a $0.20 estimate) and `tl init` and
`tl config check` for onboarding (A2).

## Staging and releases (owner, 2026-11-24)

Three streams share the owner's attention and the usage windows:
tarlatan's own cycles, and Waxwing and durable-effect as targets.

- Targets run a tagged release, never the checkout, and upgrade only
  between sessions, with no session open.
- Frictions found on a target go to its feedback log
  (`~/Desktop/tarlatan-feedback/`) and into this roadmap in batches.
  Tarlatan changes through its own dogfood cycles.
- At most two live cycles at once. A step whose result depends on
  timing (a performance run, a growth proof) needs the machine to
  itself: on 2026-11-24 Waxwing's `partialfirst-growth` proof measured
  2.995 against 3 while another session's checker held load1 near 40.
  Sequence those by hand until tarlatan can express it.
- Count frictions per target cycle as new or repeated. When a couple of
  cycles bring mostly repeats, build instead of gathering.

| Stage | Tarlatan | Targets |
|---|---|---|
| 0 | The waxwing-1 record; this plan | Waxwing-1 finished; durable-effect onboarded, its first tranche; all on v0.1.0 |
| 1 (v0.1.1) | The ledger version check first (rulings in the assisted-cycle plan, "Waxwing-1 and the stage-1 rulings"), then quiet stdout and the pin naming the binary | Waxwing's next task and durable-effect's second tranche on v0.1.0; upgrade at a session boundary |
| 2 (v0.2.0) | One design note for retry and back-up, task review with structured rulings, and the owner override, which all change the session state machine; then three or four cycles | Continue on v0.1.x and log friction against the design |
| 3 | Pacing: the clock and the readings wired into admission | Three streams make waivers the main toil |

### Versioning

Tarlatan follows semantic versioning, 0.x for now. Its compatibility
surface is the CLI (commands, flags, exit codes and printed JSON), the
configuration schema, and what it writes to disk (the project log, the
shared ledger, the target binding and the state files). Briefs and the
published profile are not a compatibility surface, but changes to them
go in the changelog.

- A patch release reads and writes the same on-disk formats and makes
  no incompatible change to the CLI or configuration, so a target may
  take it between sessions.
- A minor release may change formats or commands, with a migration or
  an explicit refusal: a release refuses a log or ledger written by a
  newer one and never misreads it. The ledger version check makes this
  enforced rather than conventional.
- 1.0 follows when the formats and the session model have held across
  several cycles on both targets.

Each release bumps `package.json`, adds a `CHANGELOG.md` entry (formats,
CLI, configuration, behaviour), is tagged on `main` after Linux CI
passes, and gets a release worktree at `~/Desktop/tarlatan-release/<tag>`.
Tags are pushed only with the owner's leave.

