// The format version of tarlatan's two SQLite stores, the shared usage
// ledger and each project's event log (dogfood-5; owner rulings P1 to P6,
// 2026-11-24; v0.2.0 design "Constraints", dogfood-6). Runtime keeps it in
// SQLite's `PRAGMA user_version` header field
// (sqlite.org/pragma.html#pragma_user_version). v0.1.0 never wrote the
// field, so a store it wrote reads 0 and already has format 1. Each store
// has its own known version: the ledger 1 and the project log 2. This
// module holds those versions, the pure decision from a version read to
// what a store may do with it, the refusal of a store stamped by a newer
// release, and which log events raise the log from 1 to 2. Runtime reads
// the pragma and branches on the decision; it never compares versions
// itself.
import { Match, Schema } from "effect"
import type { ProjectEvent } from "./events.ts"

/**
 * The version a store is stamped with when it is unstamped (reads 0) or
 * new: format 1, the format v0.1.0 and v0.1.1 wrote. Neither store is
 * ever stamped with a later version; only the log's raise writes one.
 */
export const firstStoreVersion = 1

/**
 * The usage ledger's format version this release reads and writes. The
 * ledger's format has not changed since v0.1.0, so it stays at 1 and is
 * never raised (v0.2.0 design, "Constraints").
 */
export const knownLedgerVersion = 1

/**
 * The project log's format version this release reads and writes: 2, the
 * format whose events v0.1.1 does not decode. A log at 1 is read as it is
 * and raised to 2 by the first append that holds such an event, in that
 * append's transaction (see {@link raisesLogFormat}).
 */
export const knownLogVersion = 2

/** The store reads 0: written by v0.1.0, or new; its format is 1, and a writer stamps it 1. */
export class StoreUnstamped extends Schema.TaggedClass<StoreUnstamped>()("StoreUnstamped", {}) {}

/**
 * The store is stamped `found`, from 1 up to, not including, its known
 * version: an older format this release reads as it is. Only the project
 * log can be in this state (at 1); its first event that needs the newer
 * format raises it.
 */
export class StoreOlderReadable extends Schema.TaggedClass<StoreOlderReadable>()("StoreOlderReadable", {
  found: Schema.Int,
}) {}

/** The store is stamped with its known version: this release reads and writes it as it is. */
export class StoreCurrent extends Schema.TaggedClass<StoreCurrent>()("StoreCurrent", {}) {}

/**
 * The store is stamped `found`, above its known version: a newer release
 * wrote a format this one may misread, so it is neither read nor written.
 */
export class StoreNewer extends Schema.TaggedClass<StoreNewer>()("StoreNewer", {
  found: Schema.Int,
}) {}

/**
 * The store is stamped `found`, below 0. `user_version` is a signed
 * 32-bit integer and no tarlatan release writes a negative one (ruling
 * P2), so the store is neither read nor written, and it is not reported
 * as newer.
 */
export class StoreVersionInvalid extends Schema.TaggedClass<StoreVersionInvalid>()("StoreVersionInvalid", {
  found: Schema.Int,
}) {}

/** What a store's version read allows; see {@link decideStoreVersion}. */
export const StoreVersionDecision = Schema.Union([
  StoreUnstamped,
  StoreOlderReadable,
  StoreCurrent,
  StoreNewer,
  StoreVersionInvalid,
])
/** What a store's version read allows; see {@link StoreVersionDecision}. */
export type StoreVersionDecision = typeof StoreVersionDecision.Type

/** The two decisions under which a store is neither read nor written. */
export type StoreVersionRefusal = StoreNewer | StoreVersionInvalid

/**
 * Decides what a store whose `user_version` reads `version` (an integer)
 * allows, given the store's own known version `known`
 * ({@link knownLedgerVersion} or {@link knownLogVersion}): below 0 is
 * {@link StoreVersionInvalid}, 0 is {@link StoreUnstamped}, from 1 up to,
 * not including, `known` is {@link StoreOlderReadable}, `known` is
 * {@link StoreCurrent}, and anything above is {@link StoreNewer}. Its
 * input is SQLite's `user_version`, a signed 32-bit integer, which
 * Runtime decodes with `Schema.Int` before calling it. The decision is
 * total over that range, from -2147483648 to 2147483647. A number that is
 * not an integer (`NaN`, 0.5) is outside the contract: the outcome's
 * `Schema.Int` field rejects it, and constructing a decision that carries
 * it raises a defect. No outcome lets a writer lower a version: a store
 * is stamped 1 when unstamped, and raised only by the first event that
 * needs the newer format.
 */
export const decideStoreVersion = (version: number, known: number): StoreVersionDecision =>
  version < 0
    ? new StoreVersionInvalid({ found: version })
    : version === 0
      ? new StoreUnstamped()
      : version < known
        ? new StoreOlderReadable({ found: version })
        : version === known
          ? new StoreCurrent()
          : new StoreNewer({ found: version })

/** An event v0.1.1 decodes, so it leaves the log's format as it is. */
const keepsFormat = () => false

/** An event v0.1.1 does not decode, so it raises a log at 1 to 2. */
const needsNewFormat = () => true

/**
 * Whether appending `event` raises a project log at format 1 to
 * {@link knownLogVersion}: true exactly for the events v0.1.1 does not
 * decode, which today is `FindingsRecorded` alone (v0.2.0 design,
 * "Constraints"). The match names every event tag, so a new event fails
 * to compile until it is classified here.
 */
export const raisesLogFormat = (event: ProjectEvent): boolean =>
  Match.valueTags(event, {
    Intended: keepsFormat,
    Launched: keepsFormat,
    Finished: keepsFormat,
    CommitRecorded: keepsFormat,
    Approved: keepsFormat,
    PreApproved: keepsFormat,
    Waived: keepsFormat,
    Released: keepsFormat,
    Adopted: keepsFormat,
    Reconciled: keepsFormat,
    ReviewQueued: keepsFormat,
    Unwound: keepsFormat,
    TrancheEnded: keepsFormat,
    LedgerBound: keepsFormat,
    WorktreeIntended: keepsFormat,
    WorktreeCreated: keepsFormat,
    Rebased: keepsFormat,
    BaseRequested: keepsFormat,
    UnwindRequested: keepsFormat,
    RestoreRequested: keepsFormat,
    RequestCompleted: keepsFormat,
    HoldCreated: keepsFormat,
    ProtectedReleased: keepsFormat,
    WaiverExpired: keepsFormat,
    SessionOpened: keepsFormat,
    ReportRecorded: keepsFormat,
    SnapshotTaken: keepsFormat,
    HandoffApproved: keepsFormat,
    HandoffRejected: keepsFormat,
    ReviewChecked: keepsFormat,
    StepEndedByOwner: keepsFormat,
    SessionClosed: keepsFormat,
    BriefRecorded: keepsFormat,
    FindingsRecorded: needsNewFormat,
  })

/**
 * The reason a store whose version reads `found`, below 0, is refused,
 * carried by the store's own error (`LedgerError` or `ProjectLogError`;
 * ruling P2).
 */
export const invalidVersionReason = (found: number): string =>
  `store format version ${String(found)} is not one tarlatan writes`

/**
 * The store at `path` is stamped with format version `found`, above the
 * version `known` this release knows for that store
 * ({@link knownLedgerVersion} or {@link knownLogVersion}). A newer
 * release wrote it, so no row was read, no table created and nothing
 * stamped. A writer usually refuses at its first check, on a read-only
 * connection, before any read-write connection opens. If a newer release
 * stamps the store after that check, the writer refuses at its second
 * check, inside its `BEGIN IMMEDIATE` transaction (owner ruling P1, step
 * 3). Its read-write connection is then already open in WAL mode, and the
 * transaction rolls back before the connection closes.
 */
export class StoreVersionNewer extends Schema.TaggedError<StoreVersionNewer>()("StoreVersionNewer", {
  path: Schema.String,
  found: Schema.Int,
  known: Schema.Int,
}) {}
