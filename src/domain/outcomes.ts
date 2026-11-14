// Outcomes. The step classification is the design's list under
// "Operations, checkpoints and recovery": success, changesRequested,
// rateLimited, authFailed, permissionDenied, maxTurns, crashed(signal),
// unclassified. Commit outcomes: Committed, NothingToCommit,
// CommitRefused(protectedPath | headMoved), CommitFailed. A tranche ends as
// passed, abandoned or notConverged (design "Scope", ruling 1).
//
// Guess to confirm: RateLimited carries the windows the rate-limit event
// names; an empty list means "window not named" (design "Holds", Quota row).
import { Record, Schema } from "effect"
import { Revision } from "./ids.ts"
import { Window } from "./window.ts"

const nonEmpty = Schema.String.check(Schema.isNonEmpty())

export class Success extends Schema.TaggedClass<Success>()("Success", {}) {}
export class ChangesRequested extends Schema.TaggedClass<ChangesRequested>()(
  "ChangesRequested",
  {},
) {}
export class RateLimited extends Schema.TaggedClass<RateLimited>()(
  "RateLimited",
  { windows: Schema.Array(Window) },
) {}
export class AuthFailed extends Schema.TaggedClass<AuthFailed>()(
  "AuthFailed",
  {},
) {}
export class PermissionDenied extends Schema.TaggedClass<PermissionDenied>()(
  "PermissionDenied",
  {},
) {}
export class MaxTurns extends Schema.TaggedClass<MaxTurns>()("MaxTurns", {}) {}
export class Crashed extends Schema.TaggedClass<Crashed>()("Crashed", {
  signal: nonEmpty,
}) {}
export class Unclassified extends Schema.TaggedClass<Unclassified>()(
  "Unclassified",
  {},
) {}

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
export type StepOutcome = typeof StepOutcome.Type

export class Committed extends Schema.TaggedClass<Committed>()("Committed", {
  revision: Revision,
  changedPaths: Schema.Array(nonEmpty),
}) {}
export class NothingToCommit extends Schema.TaggedClass<NothingToCommit>()(
  "NothingToCommit",
  {},
) {}
export const CommitRefusals = {
  ProtectedPath: "protectedPath",
  HeadMoved: "headMoved",
} as const
export const CommitRefusal = Schema.Literals(Record.values(CommitRefusals))
export type CommitRefusal = typeof CommitRefusal.Type

export class CommitRefused extends Schema.TaggedClass<CommitRefused>()(
  "CommitRefused",
  { reason: CommitRefusal },
) {}
export class CommitFailed extends Schema.TaggedClass<CommitFailed>()(
  "CommitFailed",
  { error: nonEmpty },
) {}

export const CommitOutcome = Schema.Union([
  Committed,
  NothingToCommit,
  CommitRefused,
  CommitFailed,
])
export type CommitOutcome = typeof CommitOutcome.Type

export class Passed extends Schema.TaggedClass<Passed>()("Passed", {}) {}
export class Abandoned extends Schema.TaggedClass<Abandoned>()(
  "Abandoned",
  {},
) {}
export class NotConverged extends Schema.TaggedClass<NotConverged>()(
  "NotConverged",
  {},
) {}

export const TrancheEnd = Schema.Union([Passed, Abandoned, NotConverged])
export type TrancheEnd = typeof TrancheEnd.Type
