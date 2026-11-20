# B11d: pinned git environment

Status: proposed for the next tranche. The owner asked to approve another
tranche after the B11c push and its checks complete. This scope is ready
for that decision; no implementation or worker launch has started.

## Purpose and boundary

Build the recorded-identity runner from the approved design's
"Supervisor worktree" and "Git environment (E7)" sections. It adds
GIT_DIR, GIT_WORK_TREE and GIT_COMMON_DIR from the recorded worktree to
B11b's clean environment, preserving its three command overrides.
Use it for the existing startup attribute check after identity
verification, giving this slice a real consumer.

The owner-checkout reads and creation remain on the existing clean
runner. The existing startup listing, stat and identity-verification
reads also remain on their current path in this slice. Pinning those
identity queries to the expected values could make them stop detecting
a different repository or rewritten .git file. Their existing refusal
tests must remain meaningful and pass without weaker assertions.

This is staged adoption of the pinned runner, not a claim that every
git command already uses it. Later supervisor-worktree operations must
use the pinned runner when those slices introduce them. Any redesign
of identity verification is outside this slice.

## Deliverable

- Runtime git runner: build an explicit environment from the five clean
  variables plus exactly GIT_DIR=recorded.gitDir,
  GIT_WORK_TREE=recorded.path and GIT_COMMON_DIR=recorded.commonDir.
  Take those values as explicit typed input; do not discover them from
  the current directory, .git file or parent environment. Keep the
  StartGit injection seam and existing output/error behavior.
- Program: construct the pinned runner from the verified recorded
  worktree for the startup attribute check. Its cwd remains the
  supervisor path so config.worktree is still read correctly. Creation
  has no recorded identity yet and keeps its existing clean runner.
- Preserve the empty, private HOME dependency and the unchanged clean
  environment for non-pinned discovery and creation commands. Inject
  implementations rather than selecting behavior with a flag.
- Update the unit and production-path recording tests to distinguish
  commands that receive the five-variable environment from the startup
  attribute commands that receive all eight. Preserve exact argument,
  environment and command-sequence assertions.
- Document the runner and the staged consumer in TSDoc and the Runtime
  and Program READMEs. List precisely which commands are pinned.

Likely files: src/runtime/git.ts, src/program/worktree.ts,
test/runtime/git.test.ts, test/program/git-coverage.test.ts, focused
real-repository tests, and the two layer READMEs. Exact exports and test
file splits can be settled in the implementation brief; they must follow
the existing architecture and file-size rules.

## Acceptance evidence

Tests go first and use only disposable repositories:

1. The process-boundary unit test requires exactly eight environment
   variables for a pinned invocation, with the recorded identity and
   the unchanged three -c overrides before the command arguments.
2. A real git read continues to target the recorded supervisor repository
   when its .git file points elsewhere. The control using the plain
   clean runner demonstrates the redirection. No owner checkout or
   unrelated repository is written by this probe.
3. An inherited GIT_DIR, GIT_WORK_TREE or GIT_COMMON_DIR cannot replace
   the recorded values. The child's environment contains no extra
   parent variable.
4. The startup attribute check uses the pinned runner on its actual
   production path. The existing config.worktree, conditional-include
   and attribute-source refusal cases still pass.
5. Existing missing-path, unrelated-repository and other identity
   refusal tests remain unchanged in meaning. Do not make a pinned
   rev-parse query count as verification of the identity it was given.
6. Show detection by removing or substituting each recorded identity
   variable in an isolated copy. Report exactly which assertions fail;
   do not claim that one mutant establishes all three variables.

Run bun run docs (no warnings), bun run check and the full bun run test
suite. Read failures and nonzero exits keep the existing typed behavior.
No live model calls or real target repositories are involved.

## Provenance and review limits

| Component | Source | Fidelity |
|---|---|---|
| Recorded git environment | Git's documented GIT_DIR, GIT_WORK_TREE and GIT_COMMON_DIR; approved design's worktree probes | Faithful use of the CLI |
| Explicit environment and overrides | B11b's clean runner and its existing process-boundary tests | Reuse |
| Startup sequencing | Existing Program identity verification followed by B11c's attribute check | Adds the pinned runner only at the latter boundary |

No custom resolver or new matching algorithm is proposed. The real-repo
redirection and per-variable mutants above are the required evidence for
this composition; they have not been run for an implementation that does
not yet exist. The pinned environment prevents this command-discovery
redirection; it does not replace protected digests or prove absence of
all repository-configured effects.

## Exclusions and handoff

Excluded: protected digests, commit/reset procedures, the review worktree,
recovery and event-log changes, process control, permissions, the CLI,
new dependencies, config overrides beyond the existing three, HOME
creation/ownership machinery, and the deferred mechanical cleanups.
No weakening of existing gates or tests, and no automatic landing or push.

Planning estimate: about 200k worker tokens plus a focused review, with
high uncertainty. Recent initial slices measured about 204k and 223k;
even the simpler B11c exceeded its original estimate. This is an
estimate, not an enforceable cap; correction rounds are not preapproved.
Use one fresh worker, a short file-specific brief, no delegation, and a
stop at completion or the first scope conflict. Report measured usage
afterward. Keep existing command timeouts.

Launch prerequisite: the B11c batch ending in 601c776 must be pushed and
both check and docs workflows must succeed for that SHA. At preparation
time, local main is 601c776 and the latest visible successful remote
workflows are for 9e9e5ce. The prerequisite is not yet verified.
