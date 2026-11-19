# B11b scope review, 2026-11-18

Status: recommendation for the owner; implementation is not authorized
by this review. Source: B11b's scope in implementation-plan commit
1f35d61, checked against the design's "Git environment (E7)" section and
the current git runner and test helper.

Recommendation: authorize B11b alone with the test clarification below.
It removes inherited git configuration and environment from the existing
B11a paths and addresses R8 before more git operations are added.

## Finding: separate hazard activation from command coverage

Status: PROPOSED clarification of B11b's acceptance criteria.

The scope lists worktree add, listing, identity reads and the branch
probe, then requires each test to fail with the inherited runner for six
hazards. This can be read as requiring every command to activate every
hazard. A read such as rev-parse does not exercise commit signing, and
an inherited GIT_DIR redirects repository selection rather than
necessarily writing a marker. The test matrix needs to distinguish
these effects. This is a scope-review argument; no hostile-runner
experiment was run in this review.

Proposed acceptance wording:

- Check that all existing production git paths receive the exact clean
  environment and required config overrides.
- For each executable hazard, use a disposable-repository command that
  activates it. Show the test detecting the effect with the inherited
  runner and preventing it with the clean runner. The test helper's
  empty commit can exercise signing without adding a production commit
  procedure.
- For inherited GIT_DIR, assert that the intended repository is selected.
  For hostile global config, assert that it cannot affect the run.
- Keep B11a's tests and replace the English-message assertion as scoped.

Keep the existing exclusions. One Claude implementation unit, no
delegation and no automatic follow-up; then return the diff, test
evidence and measured usage for Codex review. The plan estimates about
150k tokens for implementation and about 400k if separate review and
correction units follow. Neither estimate is a cap or a commitment to
those extra units.

## Review of the preceding status commit

87a878a: no findings. The status text agrees with the implementation
record, and policy.ts changes only a comment. Fresh checks during this
review session: bun run check passed with 0 blocking prose findings and
29 advisory notes; bun run test passed, 47 files and 515 tests.

## Follow-up: docs build failure on 87a878a

Status: QUEUED recommendation for Claude to correct before B11b.
Evidence: GitHub Actions run 44447662844, job 135303630717, and a local
bun run docs reproduction both exit 4 with the same 10 warnings.
Deployment was skipped because the docs build failed. Check and test
passing did not cover this separate command; the earlier review omitted
the docs build.

TypeDoc expands src and includes the ambient Node modules declared in
src/runtime/node-child-process.d.ts. TypeScript merges those with the
declarations in test/lint/child-process.d.ts and test/runtime/node-fs.d.ts,
so the test declarations also appear in the documentation validation.

Missing documentation: spawnSync; statSync's returned isDirectory method;
mkdtempSync, existsSync, mkdirSync, writeFileSync, symlinkSync, chmodSync
and rmSync; and LedgerStore.transact. The interface-level comment on
LedgerStore does not document its transact property for TypeDoc.

Recommended correction: add useful TSDoc at all 10 reported declarations,
keeping validation and warnings-as-errors intact. Run bun run docs,
bun run check and bun run test before returning the correction for review.
Do not mix this correction with B11b or rerun the failed workflow as a
substitute for fixing the reproduced failure. No implementation or remote
action was performed by this investigation.

## Review of 592de98 (TSDoc fix)

Status: one Minor correction requested before landing. Reviewed in a
temporary archive of 592de98, without switching the shared checkout from
b11b-git-env. Fresh validation: docs exits 0 with no warnings; check exits
0 with 29 advisory prose notes; test passes, 47 files and 515 tests.
TypeDoc configuration and executable code are unchanged.

T1, PROPOSED correction: src/domain/ledger.ts:237-241 promises that a
failed body returns its own error and that an I/O failure writes nothing.
src/runtime/sqlite.ts explicitly propagates a failed rollback instead of
the body's error and calls the connection state unknown. The existing
test/runtime/sqlite-transaction.test.ts case "reports a failed ROLLBACK
rather than swallowing it" verifies the replacement error. Qualify the
comment: when rollback succeeds, the original failure is returned and
the transaction's writes are discarded; if rollback fails, report that
failure and treat the connection state as unknown. No code change is
requested. After this correction and successful validation, recommend
landing the docs fix independently of B11b.

## Review of c30e9bf (B11b)

Verdict: ready with fixes; recommend one targeted correction pass before
landing. No production behavior defect was found in the current clean
runner or its Program wiring. No branch was changed, merged or pushed.

Reviewed all 16 changed files. The runner supplies exactly the five
environment entries and the three overrides before command arguments.
The inherited runner is confined to the hazard tests. Removed convenience
exports had no remaining callers; injected counterparts remain. The
English-stderr test now checks the raw failure details. No dependency,
lockfile, lint config, tsconfig or TypeDoc config changed.

Verification used a temporary archive of merge-tree
abbdcb3a995c3be11b9730aeb39f80b07bf073d7, combining current main f72e161
with c30e9bf. This tests their combined content without rebasing either
branch. Check passed (0 blocking prose findings, 29 advisory notes), test
passed (51 files, 598 tests), and docs passed without warnings. The
reported docs failure on the unrebased branch is addressed by main's
existing TSDoc fixes, not by weakening validation.

### Findings

| ID | Severity | Status | Finding and correction |
|---|---|---|---|
| B11b-R1 | Important | QUEUED | test/program/git-coverage.test.ts:35-38 records a clean runner supplied directly to the With functions. It does not observe createWorktree(home) or identifyWorktree(home). Observe the actual production wrappers at the process boundary, or enforce their construction equivalently, and demonstrate detection of an extra environment variable inserted only in those wrappers. Narrow the syntax-gate claim to what it checks. |
| B11b-R2 | Minor | QUEUED | test/runtime/git-process-gate.test.ts:71-79 ignores parse diagnostics. Malformed TypeScript can return an empty findings list. Reject parse failures with a named diagnostic and add a permanent malformed-input fixture; keep the gate's scope and stated blind spots explicit. |
| B11b-R3 | Minor | QUEUED | test/program/git-hazards.test.ts is 272 lines. The adopted readable-functional-code skill sets a hard 250-line module limit, including tests. Split the hazard groups or their fixtures without reducing assertions or compressing the prose. |

R1 evidence: in the temporary copy only, changed both exported production
wrappers to construct their runner with cleanGitWith and a process call
that invokes startGit with `{ ...invocation.env, EXTRA: "leaked" }`.
Removed the now-unused cleanGit import. All 598 tests and the full check
still passed. This violates the exact-five-variable contract while
passing both the purported coverage test and the syntax gate. The
production source was then restored byte for byte from the archive.
This is an acceptance-test gap, not evidence that the committed wrappers
currently supply an extra variable.

R2 evidence: a temporary Vitest probe parsed `const broken = ;`, asserted
that TypeScript reported parse diagnostics, then asserted that
processFindings returned an empty list. It passed (63 tests including
the imported gate suite). The project type check remains a separate
defense; the new checker itself does not fail closed on malformed input.

### Answers to the four questions

1. Parent-environment changes are acceptable with the current sequential
   tests and restoration bracket. Vitest runs files in isolated workers;
   the full run reported 51 workers. Do not make these tests concurrent
   in one process without changing how the controls supply their env.
2. Keep empty-home ownership with the eventual Runtime caller. The runner
   accepts the injected directory as documented. Before the first real
   consumer, give the caller a scoped private temporary directory and
   cleanup; checking emptiness alone would not establish ownership or
   prevent later writes. This is a proposed integration requirement, not
   additional implementation requested in B11b.
3. One freshly created home per test file with afterAll cleanup is
   acceptable here. Current tests do not write into it, and afterAll runs
   after that file's tests finish.
4. Direct startGit calls with arbitrary env are outside the syntax gate.
   The claim that the coverage test catches this is false for the exported
   production wrappers, as R1 demonstrates. Correct that specific gap;
   do not attempt a universal process-flow analyzer in this slice.

### Handoff recommendation

Claude should rebase onto f72e161, fix R1 to R3, record the result and
consumption in the implementation plan, and rerun check, test and docs.
Keep the correction bounded to these findings; no additional B11 features.
AGENTS.md also requires reusable new gate rules to be lifted into their
owning skill with a check; include the corresponding skill work or its
reviewable local draft in the handoff rather than silently omitting it.
No remote filing or skills-repository write is authorized by this review.
After targeted review of the corrections, recommend landing B11b before
scoping the next remaining B11 deliverable.

Worker consumption, reported by the owner: 203,829 measured tokens,
62 tool calls, about 14.5 minutes. This is about 36 percent above the
150k estimate, not a breached cap. The owner's verification and this
review are not included in that measured total. The owner's first two
mutant attempts ran no tests due to shell argument handling and supply
no evidence; their subsequent successful attempts are reported evidence,
not rerun by this reviewer.

## Correction review of 04c9ca4..4d6511e

Verdict: no code blockers; B11b-R1, R2 and R3 are closed by the
corrections. Recommend rebasing onto current main 83870d8, finishing the
landing records, and fast-forwarding locally after validation. No merge,
rebase or push was performed by this review.

The production entry points are now worktreeProgramWith(startGit).
The factory records the exact invocation sequence under a recording
StartGit, a real-process test compares production's environment with
that factory's, and a syntax-tree assertion pins the production
definition. The narrower API is acceptable: both operations share one
constructed runner, and there are no production callers to migrate.
The check pins a specific construction; it is not a general proof about
every future git path.

The process gate now returns syntax diagnostics as findings, with three
malformed-input cases. The hazard split and additional worktree-create
split preserve every preexisting effect-test title; changed TypeScript
files are all within 250 lines. The additional split fixes the same
reported pattern without adding behavior or dropping tests.

Fresh verification ran on temporary merge-tree
8e0c084d1d01b9cc4a450fc7bc5f6b036574e904, combining 4d6511e and 83870d8:
check passed (0 blocking prose findings, 29 notes), test passed
(53 files, 604 tests), and docs passed without warnings. This validates
the combined content without changing the shared checkout.

Independent mutant checks in that temporary copy:

- Adding EXTRA only in the production definition failed exactly two
  coverage tests: the pinned definition and the real-process environment
  comparison.
- Removing parseFindings from the gate failed exactly the three malformed
  input cases.
- Both files were restored byte for byte against 4d6511e afterward.

Landing housekeeping, not another worker round:

- The B11b heading says authorized, but its next paragraph still says
  "not yet authorized". Mark that paragraph as the historical scoping
  state or update it. Update AGENTS.md and the checkpoint to the landed
  state when landing actually happens.
- Preserve this review record with the implementation record so the plan
  does not link to an absent untracked file.
- The already-recorded 261-line admission.test.ts issue remains a
  separate proposed mechanical cleanup after landing; it does not block
  B11b and was not silently waived or fixed in this review.
- The required owning-skill lift remains a handoff item. No evidence of
  a skill change is in this branch. The local draft below makes the
  reusable lesson reviewable without writing to another repository.

### Local draft for the owning skill

Proposed destination: gate-integrity, contract-test obligations.

A test that injects a compliant helper proves the injected path, but
does not prove the production entry point constructs that helper. Drive
the same construction used in production and observe its external
boundary. Where a path has no observable output for the contract,
pin its production construction with a parsed check whose limits are
stated. Demonstrate detection by breaking only the production binding;
breaking the shared helper alone does not establish this property.

Proposed owning-skill check: a fixture with a correct injected helper and
a production-only extra environment variable must fail the contract
suite. Include the startup-only binding variant, since a creation-path
probe cannot establish the startup path's environment. The working
project examples are git-coverage.test.ts's production-definition and
environment tests; mutations above provide the detection evidence.
