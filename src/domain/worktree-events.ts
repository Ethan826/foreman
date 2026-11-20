// The worktree, queue and request events of the project log (design
// "Supervisor worktree", "Stages, review queue and scheduler", "Holds
// (S7)"): the review queue, tranche ends, the ledger binding, the
// supervisor worktree's creation and moves, owner requests and their
// completion, and hold creation, which carries the hold itself.
// Re-exported by events.ts, which holds the union.
import { Schema } from "effect"
import { Hold, WorktreeKind } from "./holds.ts"
import { Revision, TrancheId } from "./ids.ts"
import { TrancheEnd } from "./outcomes.ts"

const pathText = Schema.String.check(Schema.isNonEmpty())

/**
 * A tranche result waiting for review: implemented from `trancheBase` to
 * `revision` (design "Review queue").
 */
export class ReviewQueued extends Schema.TaggedClass<ReviewQueued>()(
  "ReviewQueued",
  { tranche: TrancheId, trancheBase: Revision, revision: Revision },
) {}

/**
 * Tranches above a change request at the head of the queue were discarded:
 * the worktree was reset from `atHead` to `target`.
 */
export class Unwound extends Schema.TaggedClass<Unwound>()("Unwound", {
  tranches: Schema.Array(TrancheId),
  atHead: Revision,
  target: Revision,
}) {}

/** A tranche ended: passed, abandoned or not converged. */
export class TrancheEnded extends Schema.TaggedClass<TrancheEnded>()(
  "TrancheEnded",
  { tranche: TrancheId, end: TrancheEnd },
) {}

/** The project is bound to the ledger at `path` (design "Where the ledger lives"). */
export class LedgerBound extends Schema.TaggedClass<LedgerBound>()(
  "LedgerBound",
  { path: pathText },
) {}

/** About to create the supervisor worktree at `path` on `branch` from `base`. */
export class WorktreeIntended extends Schema.TaggedClass<WorktreeIntended>()(
  "WorktreeIntended",
  { path: pathText, branch: pathText, base: Revision },
) {}

/** The supervisor worktree exists, with its resolved git directories. */
export class WorktreeCreated extends Schema.TaggedClass<WorktreeCreated>()(
  "WorktreeCreated",
  {
    path: pathText,
    branch: pathText,
    gitDir: pathText,
    commonDir: pathText,
    base: Revision,
  },
) {}

/** The supervisor worktree was moved onto `base`. */
export class Rebased extends Schema.TaggedClass<Rebased>()("Rebased", {
  base: Revision,
}) {}

/** A request to move the base to `base`, made while HEAD was `atHead`. */
export class BaseRequested extends Schema.TaggedClass<BaseRequested>()(
  "BaseRequested",
  { base: Revision, atHead: Revision },
) {}

/** A request to unwind the queue to `target`, made while HEAD was `atHead`. */
export class UnwindRequested extends Schema.TaggedClass<UnwindRequested>()(
  "UnwindRequested",
  { target: Revision, atHead: Revision },
) {}

/** A request to restore a worktree to its recorded revision, clean. */
export class RestoreRequested extends Schema.TaggedClass<RestoreRequested>()(
  "RestoreRequested",
  { worktree: WorktreeKind },
) {}

/** The request written at log `position` completed. */
export class RequestCompleted extends Schema.TaggedClass<RequestCompleted>()(
  "RequestCompleted",
  { position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)) },
) {}

/** A hold was created. Each hold is removed only by its own release event. */
export class HoldCreated extends Schema.TaggedClass<HoldCreated>()(
  "HoldCreated",
  { hold: Hold },
) {}
