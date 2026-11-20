# Program

See [how it works](../../docs/how-it-works.md).

May import: `domain`, `features`, `format`, `runtime`.

Per the [design](../../docs/plans/2026-11-14-agent-supervisor-design.md) ("Architecture"), this layer will wire the Runtime capabilities into use cases, using Features and Format. It is the only layer that sees all of them, which is why the layer table lets it import all four. It will hold no logic of its own.

## Admission and settling

[`admission.ts`](admission.ts) runs each ledger decision in one transaction and leaves the deciding to Features. `admit` reads every row and passes them to `decideAdmission` ([`features/admission.ts`](../features/admission.ts)). It writes any spend-down expiries the decision returns, then the request's `Grant` if admitted. `cancelLostRace` cancels a grant whose `Intended` lost the log's compare-and-append. `applySettle` writes what `settleActions` decides. If a transaction fails, it writes nothing. Admission bounds foreman's own launches and reservations; it does not keep the provider's count below the cap.

## Worktree startup check

[`worktree.ts`](worktree.ts) wires the supervisor worktree. `createWorktree` sequences creation. It first requires an absolute path. It reads the owner's HEAD and common directory, then runs the attribute check of [`attribute-sources.ts`](attribute-sources.ts) on the base and the owner's repository, which fails with `AttributeSourcesRefused` before `git worktree add` (plan B11c). It reads the branch probe and the path's `stat` through Runtime, decodes with Format, and gives the results to the Features prechecks. Then it runs the add, decodes the reads taken after it, and runs `checkCreated`. It lives here because Runtime may not import Features. `identifyWorktree` lists the worktrees from the recorded common directory, reads the recorded directory, decodes both and passes them to `checkWorktree`; when that passes, it runs the attribute check inside the supervisor worktree against the recorded base, so a `core.attributesFile` in that worktree's `config.worktree` is seen. Neither cleans up, prunes or unlocks anything. Production gets both from `worktreeProgram(home)`, which builds both runners of [`runtime/git.ts`](../runtime/git.ts) over the empty home directory the caller owns. `worktreeProgram` is `worktreeProgramWith(startGit)`, and the coverage tests drive the same factory with a recording process call. `createWorktreeWith` takes any `RunGit`, and `identifyWorktreeWith` takes a `RunGit` and a `PinGit`, for tests.

### Which git commands are pinned

Only the startup attribute check runs through the pinned runner (plan B11d), built from the recorded `WorktreeCreated` after `checkWorktree` passes, with the supervisor worktree as its directory. Its four commands get `GIT_DIR`, `GIT_WORK_TREE` and `GIT_COMMON_DIR` from the record: `git ls-tree --full-tree -r -t -z <base>`, `git cat-file blob <object>` for each `.gitattributes` blob, `git config --get core.attributesFile` and `git config --get-regexp '^includeif\.'`. Every other command stays on the clean runner. That covers all of creation: the owner's `rev-parse` reads, its attribute check, the branch probe, `worktree add` and the reads after it. It also covers the startup check's `worktree list` and its two identity `rev-parse` reads; `stat` is not a git command. Those identity reads must discover the repository on their own: pinned to the recorded values they would print those values back and could not see a moved `.git` file or another repository at the path. Later supervisor-worktree commands are to use the pinned runner when their slices add them.
