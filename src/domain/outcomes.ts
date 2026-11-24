// Outcomes: how a step ends (design "Operations, checkpoints and
// recovery"), how a commit ends, and how a tranche ends (design "Scope",
// ruling 1).
import { Record, Schema } from "effect"
import { Revision } from "./ids.ts"
import { Window } from "./window.ts"

const nonEmpty = Schema.String.check(Schema.isNonEmpty())

/** The step finished successfully. */
export class Success extends Schema.TaggedClass<Success>()("Success", {}) {}
/** The review step asked for changes. */
export class ChangesRequested extends Schema.TaggedClass<ChangesRequested>()(
  "ChangesRequested",
  {},
) {}
/**
 * The step hit a rate limit. `windows` holds the windows the rate-limit
 * event names; an empty list means the event named none (guess to confirm;
 * design "Holds", Quota row).
 */
export class RateLimited extends Schema.TaggedClass<RateLimited>()(
  "RateLimited",
  { windows: Schema.Array(Window) },
) {}
/** The client could not authenticate. */
export class AuthFailed extends Schema.TaggedClass<AuthFailed>()(
  "AuthFailed",
  {},
) {}
/** The client was denied a permission it needed. */
export class PermissionDenied extends Schema.TaggedClass<PermissionDenied>()(
  "PermissionDenied",
  {},
) {}
/** The step stopped at its turn limit. */
export class MaxTurns extends Schema.TaggedClass<MaxTurns>()("MaxTurns", {}) {}
/** The client process died; `signal` names the signal (never empty). */
export class Crashed extends Schema.TaggedClass<Crashed>()("Crashed", {
  signal: nonEmpty,
}) {}
/** The step ended in a way none of the other outcomes describes. */
export class Unclassified extends Schema.TaggedClass<Unclassified>()(
  "Unclassified",
  {},
) {}

/**
 * How a step ends: the design's classification under "Operations,
 * checkpoints and recovery" (success, changesRequested, rateLimited,
 * authFailed, permissionDenied, maxTurns, crashed(signal), unclassified).
 */
export const StepOutcome = Schema.Union([
  Success,
  ChangesRequested,
  RateLimited,
  AuthFailed,
  PermissionDenied,
  MaxTurns,
  Crashed,
  Unclassified,
])
/** How a step ends; see {@link StepOutcome}. */
export type StepOutcome = typeof StepOutcome.Type

/** A commit was made at `revision`, changing `changedPaths` (none empty). */
export class Committed extends Schema.TaggedClass<Committed>()("Committed", {
  revision: Revision,
  changedPaths: Schema.Array(nonEmpty),
}) {}
/** The step left nothing to commit. */
export class NothingToCommit extends Schema.TaggedClass<NothingToCommit>()(
  "NothingToCommit",
  {},
) {}
/** Why tarlatan refused a commit: a protected path changed, or HEAD moved. */
export const CommitRefusals = {
  ProtectedPath: "protectedPath",
  HeadMoved: "headMoved",
} as const
/** Schema for a commit refusal reason, one of {@link CommitRefusals}. */
export const CommitRefusal = Schema.Literals(Record.values(CommitRefusals))
/** A commit refusal reason, one of the values of {@link CommitRefusals}. */
export type CommitRefusal = typeof CommitRefusal.Type

/** Tarlatan refused to commit, for `reason`. */
export class CommitRefused extends Schema.TaggedClass<CommitRefused>()(
  "CommitRefused",
  { reason: CommitRefusal },
) {}
/** The commit was attempted and failed; `error` describes it (never empty). */
export class CommitFailed extends Schema.TaggedClass<CommitFailed>()(
  "CommitFailed",
  { error: nonEmpty },
) {}

/** How a commit ends: Committed, NothingToCommit, CommitRefused or CommitFailed. */
export const CommitOutcome = Schema.Union([
  Committed,
  NothingToCommit,
  CommitRefused,
  CommitFailed,
])
/** How a commit ends; see {@link CommitOutcome}. */
export type CommitOutcome = typeof CommitOutcome.Type

/** The tranche passed review. */
export class Passed extends Schema.TaggedClass<Passed>()("Passed", {}) {}
/** The tranche was abandoned. */
export class Abandoned extends Schema.TaggedClass<Abandoned>()(
  "Abandoned",
  {},
) {}
/** The tranche ended without converging on a passing review. */
export class NotConverged extends Schema.TaggedClass<NotConverged>()(
  "NotConverged",
  {},
) {}

/** How a tranche ends: passed, abandoned or notConverged (design "Scope", ruling 1). */
export const TrancheEnd = Schema.Union([Passed, Abandoned, NotConverged])
/** How a tranche ends; see {@link TrancheEnd}. */
export type TrancheEnd = typeof TrancheEnd.Type
