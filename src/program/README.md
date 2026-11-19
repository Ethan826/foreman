# Program

See [how it works](../../docs/how-it-works.md).

May import: `domain`, `features`, `format`, `runtime`.

Per the [design](../../docs/plans/2026-11-14-agent-supervisor-design.md) ("Architecture"), this layer will wire the Runtime capabilities into use cases, using Features and Format. It is the only layer that sees all of them, which is why the layer table lets it import all four. It will hold no logic of its own.

## Admission and settling

[`admission.ts`](admission.ts) runs each ledger decision in one transaction and leaves the deciding to Features. `admit` reads every row and passes them to `decideAdmission` ([`features/admission.ts`](../features/admission.ts)). It writes any spend-down expiries the decision returns, then the request's `Grant` if admitted. `cancelLostRace` cancels a grant whose `Intended` lost the log's compare-and-append. `applySettle` writes what `settleActions` decides. If a transaction fails, it writes nothing. Admission bounds foreman's own launches and reservations; it does not keep the provider's count below the cap.

## Worktree startup check

[`worktree.ts`](worktree.ts) wires the supervisor worktree. `createWorktree` sequences creation. It first requires an absolute path. It reads the owner's HEAD, the branch probe and the path's `stat` through Runtime, decodes with Format, and gives the results to the Features prechecks. Then it runs the add, decodes the reads taken after it, and runs `checkCreated`. It lives here because Runtime may not import Features. `identifyWorktree` lists the worktrees from the recorded common directory, reads the recorded directory, decodes both and passes them to `checkWorktree`. Neither cleans up, prunes or unlocks anything. Both take the empty home directory and run every git command through the clean runner of [`runtime/git.ts`](../runtime/git.ts); `createWorktreeWith` and `identifyWorktreeWith` take any `RunGit`, for tests.
