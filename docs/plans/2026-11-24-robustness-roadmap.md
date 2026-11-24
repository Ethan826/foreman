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
