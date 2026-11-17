// The project log's events (design "Operations, checkpoints and
// recovery", "Holds (S7)", "Supervisor worktree", "Stages, review queue and
// scheduler", "Pre-approved backlog"). Each project has its own
// append-only log; holds, the review queue, the backlog and recovery are
// folds of it. A step's outcome and a commit's outcome reuse Domain's
// outcome types, and a hold's creation carries the hold itself.
import { Record, Schema } from "effect"
import type { Effect } from "effect"
import { Client } from "./clients.ts"
import { Hold, WorktreeKind } from "./holds.ts"
import { GrantId, OpId, Revision, TrancheId, WaiverId } from "./ids.ts"
import { CommitOutcome, StepOutcome, TrancheEnd } from "./outcomes.ts"
import { Step } from "./roles.ts"

const epochMillis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const pathText = Schema.String.check(Schema.isNonEmpty())

/**
 * Written before a step launches, after its grant (design "Operations",
 * step 1; "Grant lifecycle"). Names the grant that reserved the launch, so
 * a grant no `Intended` names is an orphan.
 */
export class Intended extends Schema.TaggedClass<Intended>()("Intended", {
  opId: OpId,
  tranche: TrancheId,
  step: Step,
  baseRevision: Revision,
  grantId: GrantId,
  client: Client,
  waiverId: Schema.OptionFromOptionalKey(WaiverId),
}) {}

/** The step's process started as the leader of process group `pgid`. */
export class Launched extends Schema.TaggedClass<Launched>()("Launched", {
  opId: OpId,
  pgid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
}) {}

/** The step's process ended at `endedAt` (wall clock) with `outcome`. */
export class Finished extends Schema.TaggedClass<Finished>()("Finished", {
  opId: OpId,
  outcome: StepOutcome,
  endedAt: epochMillis,
}) {}

/** The outcome of committing the step's changes. */
export class CommitRecorded extends Schema.TaggedClass<CommitRecorded>()(
  "CommitRecorded",
  { opId: OpId, outcome: CommitOutcome },
) {}

/**
 * The owner's live approval of `tranche` at `revision`; releases the
 * matching approval hold. `permits` is the protected-path permission for
 * the next tranche; `base`, when given, also asks to move the base.
 */
export class Approved extends Schema.TaggedClass<Approved>()("Approved", {
  tranche: TrancheId,
  revision: Revision,
  permits: Schema.Array(pathText),
  base: Schema.OptionFromOptionalKey(Revision),
}) {}

/**
 * A pre-approval in the backlog. With `stopBefore`, it never starts its
 * tranche alone: a live approval is still needed.
 */
export class PreApproved extends Schema.TaggedClass<PreApproved>()(
  "PreApproved",
  { tranche: TrancheId, permits: Schema.Array(pathText), stopBefore: Schema.Boolean },
) {}

/** The owner's waiver of one launch for `provider`. */
export class Waived extends Schema.TaggedClass<Waived>()("Waived", {
  provider: Client,
  waiverId: WaiverId,
}) {}

/** The owner released the failure hold of operation `opId`. */
export class Released extends Schema.TaggedClass<Released>()("Released", {
  opId: OpId,
}) {}

/** The owner adopted `revision` as the supervisor worktree's HEAD. */
export class Adopted extends Schema.TaggedClass<Adopted>()("Adopted", {
  revision: Revision,
}) {}

/** How the owner resolved an uncertain operation. */
export const Reconciliations = {
  Accept: "accept",
  Discard: "discard",
  Abandon: "abandon",
} as const

/** Schema for a reconciliation, one of {@link Reconciliations}. */
export const Reconciliation = Schema.Literals(Record.values(Reconciliations))
/** A reconciliation; see {@link Reconciliations}. */
export type Reconciliation = typeof Reconciliation.Type

/** The owner reconciled uncertain operation `opId`. */
export class Reconciled extends Schema.TaggedClass<Reconciled>()(
  "Reconciled",
  { opId: OpId, resolution: Reconciliation },
) {}

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

/** Any project log event. */
export const ProjectEvent = Schema.Union([
  Intended,
  Launched,
  Finished,
  CommitRecorded,
  Approved,
  PreApproved,
  Waived,
  Released,
  Adopted,
  Reconciled,
  ReviewQueued,
  Unwound,
  TrancheEnded,
  LedgerBound,
  WorktreeIntended,
  WorktreeCreated,
  Rebased,
  BaseRequested,
  UnwindRequested,
  RestoreRequested,
  RequestCompleted,
  HoldCreated,
])
/** Any project log event; see {@link ProjectEvent}. */
export type ProjectEvent = typeof ProjectEvent.Type

/**
 * A position in a project log: the number of events written so far. An
 * empty log is at 0; the first event is written at 1.
 */
export const LogPosition = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("LogPosition"),
)
/** A log position; see {@link LogPosition}. */
export type LogPosition = typeof LogPosition.Type

/** An event with the position it was written at. */
export interface LoggedEvent {
  readonly position: LogPosition
  readonly event: ProjectEvent
}

/**
 * The log moved past the position the writer last read: another writer
 * appended first. Nothing was written; the writer re-reads and decides
 * again (design "Operations", compare-and-append).
 */
export class PositionMoved extends Schema.TaggedError<PositionMoved>()(
  "PositionMoved",
  { expected: LogPosition, actual: LogPosition },
) {}

/** The project log could not be read or written. */
export class ProjectLogError extends Schema.TaggedError<ProjectLogError>()(
  "ProjectLogError",
  { reason: Schema.String },
) {}

/** Another holder has the project's lock (another `run` or command). */
export class LockHeld extends Schema.TaggedError<LockHeld>()("LockHeld", {
  path: Schema.String,
}) {}

/** A project's append-only event log as a capability. */
export interface ProjectLog {
  /**
   * Appends `events` only if the log is still at `expected`, and returns
   * the new position; otherwise fails with {@link PositionMoved} and writes
   * nothing.
   */
  readonly append: (
    expected: LogPosition,
    events: ReadonlyArray<ProjectEvent>,
  ) => Effect.Effect<LogPosition, PositionMoved | ProjectLogError>
  /** Every event written after `position`, in order. */
  readonly readFrom: (
    position: LogPosition,
  ) => Effect.Effect<ReadonlyArray<LoggedEvent>, ProjectLogError>
}
