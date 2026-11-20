// The assisted session's events in the project log (plan "Events"): a
// session's opening and close, each attempt's recorded report, the
// snapshots and handoffs between attempts, the review check, and the
// owner's attestation that a step ended. Re-exported by events.ts, which
// holds the union.
import { Schema } from "effect"
import { GrantId, OpId, Revision, TrancheId } from "./ids.ts"
import { Role } from "./roles.ts"
import {
  Attestation,
  CloseKind,
  RecordedGitIdentity,
  SessionId,
  Sha256,
} from "./session.ts"

const pathText = Schema.String.check(Schema.isNonEmpty())
const epochMillis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * A session opened for tranche `tranche` on the task file `taskPath`
 * (hash `taskSha256`), from `baseRevision`, in the supervisor worktree
 * recorded as `worktree`.
 */
export class SessionOpened extends Schema.TaggedClass<SessionOpened>()(
  "SessionOpened",
  {
    sessionId: SessionId,
    tranche: TrancheId,
    taskPath: pathText,
    taskSha256: Sha256,
    baseRevision: Revision,
    worktree: RecordedGitIdentity,
  },
) {}

/**
 * Attempt `opId`'s report files, published before this record: the raw
 * output and the handoff (an empty file when the client gave none), each
 * with its SHA-256. Appended in one batch with the attempt's `Finished`.
 */
export class ReportRecorded extends Schema.TaggedClass<ReportRecorded>()(
  "ReportRecorded",
  {
    sessionId: SessionId,
    opId: OpId,
    role: Role,
    rawPath: pathText,
    rawSha256: Sha256,
    handoffPath: pathText,
    handoffSha256: Sha256,
  },
) {}

/** The worktree's covered contents as tree `tree`, after attempt `forOpId`. */
export class SnapshotTaken extends Schema.TaggedClass<SnapshotTaken>()(
  "SnapshotTaken",
  { sessionId: SessionId, forOpId: OpId, tree: Revision },
) {}

/**
 * The owner approved handing attempt `fromOpId`'s result on to `toRole`
 * at tree `tree`, attesting `attests`. `findingsSha256` is the hash of the
 * findings file a correction receives; other handoffs have none.
 */
export class HandoffApproved extends Schema.TaggedClass<HandoffApproved>()(
  "HandoffApproved",
  {
    sessionId: SessionId,
    fromOpId: OpId,
    toRole: Role,
    tree: Revision,
    findingsSha256: Schema.OptionFromOptionalKey(Sha256),
    attests: Attestation,
  },
) {}

/** The owner refused to hand attempt `fromOpId`'s result on; `note` says why. */
export class HandoffRejected extends Schema.TaggedClass<HandoffRejected>()(
  "HandoffRejected",
  { sessionId: SessionId, fromOpId: OpId, note: Schema.String },
) {}

/**
 * The tree review `reviewOpId` was given, `reviewedTree`, compared with a
 * fresh snapshot, `currentTree`, at the next handoff. Written only when
 * they are equal; equality shows only that the covered contents match at
 * both ends.
 */
export class ReviewChecked extends Schema.TaggedClass<ReviewChecked>()(
  "ReviewChecked",
  {
    sessionId: SessionId,
    reviewOpId: OpId,
    reviewedTree: Revision,
    currentTree: Revision,
  },
) {}

/**
 * The owner attests that attempt `opId`, reserved by grant `grantId`, has
 * ended, at `endedAt` (epoch milliseconds; the plan's `at`, named like
 * `Finished.endedAt` because the house lint reserves `.at` for arrays).
 * Its grant is then charged at its estimate; no `Finished` and no
 * outcome is written for it.
 */
export class StepEndedByOwner extends Schema.TaggedClass<StepEndedByOwner>()(
  "StepEndedByOwner",
  { opId: OpId, grantId: GrantId, endedAt: epochMillis },
) {}

/**
 * The session closed, `how`, with the owner's `note`. `attests` is the
 * attestation a `finished` close requires; the command rules refuse a
 * `finished` close without it.
 */
export class SessionClosed extends Schema.TaggedClass<SessionClosed>()(
  "SessionClosed",
  {
    sessionId: SessionId,
    how: CloseKind,
    note: Schema.String,
    attests: Schema.OptionFromOptionalKey(Attestation),
  },
) {}
