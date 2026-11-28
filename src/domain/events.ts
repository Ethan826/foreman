// The project log's events (design "Operations, checkpoints and
// recovery", "Holds (S7)", "Supervisor worktree", "Stages, review queue and
// scheduler", "Pre-approved backlog"). Each project has its own
// append-only log; holds, the review queue, the backlog and recovery are
// folds of it. A step's outcome and a commit's outcome reuse Domain's
// outcome types, and a hold's creation carries the hold itself.
// The members live in step-events.ts, owner-events.ts,
// worktree-events.ts and session-events.ts; this module holds the union,
// positions, errors and the log capability, and re-exports every member
// so importers see one module.
import { Schema } from "effect"
import type { Effect } from "effect"
import {
  Adopted,
  Approved,
  PreApproved,
  ProtectedReleased,
  Reconciled,
  Released,
  Waived,
  WaiverExpired,
} from "./owner-events.ts"
import {
  BriefRecorded,
  FindingOverruled,
  FindingsRecorded,
  HandoffApproved,
  HandoffRejected,
  ReportRecorded,
  ReviewChecked,
  RulingAdded,
  SessionClosed,
  SessionOpened,
  SnapshotTaken,
  StepEndedByOwner,
} from "./session-events.ts"
import { CommitRecorded, Finished, Intended, Launched } from "./step-events.ts"
import {
  BaseRequested,
  HoldCreated,
  LedgerBound,
  Rebased,
  RequestCompleted,
  RestoreRequested,
  ReviewQueued,
  TrancheEnded,
  Unwound,
  UnwindRequested,
  WorktreeCreated,
  WorktreeIntended,
} from "./worktree-events.ts"

/** The step events; see step-events.ts. */
export {
  Intended,
  Launched,
  Finished,
  CommitRecorded,
} from "./step-events.ts"

/** The owner events; see owner-events.ts. */
export {
  Approved,
  PreApproved,
  Waived,
  WaiverExpired,
  Released,
  Adopted,
  Reconciliations,
  Reconciliation,
  Reconciled,
  ProtectedReleased,
} from "./owner-events.ts"

/** The worktree, queue and request events; see worktree-events.ts. */
export {
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
} from "./worktree-events.ts"

/** The assisted session's events; see session-events.ts. */
export {
  SessionOpened,
  BriefRecorded,
  ReportRecorded,
  SnapshotTaken,
  HandoffApproved,
  HandoffRejected,
  ReviewChecked,
  StepEndedByOwner,
  SessionClosed,
  FindingsRecorded,
  RulingAdded,
  FindingOverruled,
} from "./session-events.ts"

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
  ProtectedReleased,
  WaiverExpired,
  SessionOpened,
  ReportRecorded,
  SnapshotTaken,
  HandoffApproved,
  HandoffRejected,
  ReviewChecked,
  StepEndedByOwner,
  SessionClosed,
  BriefRecorded,
  FindingsRecorded,
  RulingAdded,
  FindingOverruled,
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

/**
 * A project's append-only event log as a capability.
 *
 * The busy-wait contract, which every implementation must meet: each log
 * is opened with a busy timeout, in milliseconds. A write that meets
 * another writer's lock on the same log (in this process or another)
 * waits for it up to that timeout; if the lock is released in time the
 * write goes ahead, and if not it fails with {@link ProjectLogError}
 * whose reason is "project log busy", and writes nothing. An
 * implementation states how it meets this and what its evidence is
 * (dogfood-6f, owner ruling of 2026-11-28).
 */
export interface ProjectLog {
  /**
   * Appends `events` only if the log is still at `expected`, and returns
   * the new position; otherwise fails with {@link PositionMoved} and writes
   * nothing. Under another writer's lock it waits as the log's busy-wait
   * contract says, and fails with {@link ProjectLogError} ("project log
   * busy"), writing nothing, once the busy timeout has passed.
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
