// The assisted session's events in the project log (plan "Events"): a
// session's opening and close, each attempt's recorded brief and report, the
// snapshots and handoffs between attempts, the review check, the
// owner's attestation that a step ended, a usable review's findings, and
// the owner's rulings, overrules and granted rounds (v0.2.0).
// Re-exported by events.ts, which holds the union.
import { Schema } from "effect"
import { Findings } from "./findings.ts"
import { GrantId, OpId, Revision, RulingId, TrancheId } from "./ids.ts"
import { Role } from "./roles.ts"
import {
  Attestation,
  CloseKind,
  GrantNote,
  RecordedGitIdentity,
  RoundCount,
  SessionId,
  Sha256,
} from "./session.ts"

const pathText = Schema.String.check(Schema.isNonEmpty())
const epochMillis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const nonEmptyText = Schema.String.check(Schema.isNonEmpty())

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

/**
 * The findings of review `reviewOpId` in session `sessionId`, in the
 * reviewer's order, as decoded from its findings block (v0.2.0 design,
 * "Commands and events"). Appended in batch F after the review's
 * `Finished` and `ReportRecorded`, only when the review's outcome is
 * usable (`Success`, with an empty list, or `ChangesRequested`); a review
 * whose block repeats an id is `Unclassified` and records none. The log,
 * not the findings file, is what later command rules read. v0.1.1 does
 * not decode it, so it raises a log at format 1 to 2.
 */
export class FindingsRecorded extends Schema.TaggedClass<FindingsRecorded>()(
  "FindingsRecorded",
  { sessionId: SessionId, reviewOpId: OpId, findings: Findings },
) {}

/**
 * The owner's ruling `rulingId` in session `sessionId` (v0.2.0 design,
 * "Commands and events"): its `text`, non-empty and kept as given, line
 * breaks included, and the earlier ruling it `supersedes`, if any. Every
 * later brief of the session lists it. Appended by `ruling add`, and by
 * `overrule` beside its `FindingOverruled`. v0.1.1 does not decode it,
 * so it raises a log at format 1 to 2.
 */
export class RulingAdded extends Schema.TaggedClass<RulingAdded>()("RulingAdded", {
  sessionId: SessionId,
  rulingId: RulingId,
  text: nonEmptyText,
  supersedes: Schema.OptionFromOptionalKey(RulingId),
}) {}

/**
 * The owner overruled finding `findingId` of review `reviewOpId` in
 * session `sessionId`, with `note`, non-empty, saying why; `rulingId` is
 * the ruling appended in the same batch, whose text quotes the finding
 * (v0.2.0 design, "Commands and events", "Closing after overrules"). A
 * finding id names a finding within its review only, so the pair of
 * `reviewOpId` and `findingId` names it. An overrule stands once
 * recorded, whatever later supersedes its ruling. v0.1.1 does not decode
 * it, so it raises a log at format 1 to 2.
 */
export class FindingOverruled extends Schema.TaggedClass<FindingOverruled>()("FindingOverruled", {
  sessionId: SessionId,
  reviewOpId: OpId,
  findingId: nonEmptyText,
  rulingId: RulingId,
  note: nonEmptyText,
}) {}

/**
 * The owner granted `count` more correction rounds to session
 * `sessionId`, with `note`, never empty or blank, saying why (v0.2.0
 * design, "The correction limit"; owner ruling of 2026-11-25). `count` is
 * a safe integer of at least 1. The session's correction limit is
 * `maxCorrections` plus the counts of its grants; a grant counts only in
 * its own session. Appended by `rounds grant`. v0.1.1 does not decode
 * it, so it raises a log at format 1 to 2.
 */
export class RoundsGranted extends Schema.TaggedClass<RoundsGranted>()("RoundsGranted", {
  sessionId: SessionId,
  count: RoundCount,
  note: GrantNote,
}) {}

/**
 * The exact brief attempt `opId` was launched with (review item B14):
 * its bytes, published at `briefPath` before this record, and their
 * SHA-256. Appended in batch I, right after the attempt's `Intended`, so
 * an attempt that may have started always has its brief on record.
 */
export class BriefRecorded extends Schema.TaggedClass<BriefRecorded>()(
  "BriefRecorded",
  {
    sessionId: SessionId,
    opId: OpId,
    briefPath: pathText,
    briefSha256: Sha256,
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
