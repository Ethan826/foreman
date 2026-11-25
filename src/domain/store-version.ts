// The format version of tarlatan's two SQLite stores, the shared usage
// ledger and each project's event log (dogfood-5; owner rulings P1 to P6,
// 2026-11-24). Runtime keeps it in SQLite's `PRAGMA user_version` header
// field (sqlite.org/pragma.html#pragma_user_version). v0.1.0 never wrote
// the field, so a store it wrote reads 0 and already has format 1. This
// module holds the version this release knows, the pure decision from a
// version read to what a store may do with it, and the refusal of a store
// stamped by a newer release. Runtime reads the pragma and branches on the
// decision; it never compares versions itself.
import { Schema } from "effect"

/**
 * The store format version this release reads and writes. A new store is
 * created at it, and a store at 0 (written by v0.1.0, the same format) is
 * stamped with it on its first read-write open.
 */
export const knownStoreVersion = 1

/** The store reads 0: written by v0.1.0, or new; its format is 1, and a writer stamps it 1. */
export class StoreUnstamped extends Schema.TaggedClass<StoreUnstamped>()("StoreUnstamped", {}) {}

/** The store is stamped with {@link knownStoreVersion}: this release reads and writes it as it is. */
export class StoreCurrent extends Schema.TaggedClass<StoreCurrent>()("StoreCurrent", {}) {}

/**
 * The store is stamped `found`, above {@link knownStoreVersion}: a newer
 * release wrote a format this one may misread, so it is neither read nor
 * written.
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
export const StoreVersionDecision = Schema.Union([StoreUnstamped, StoreCurrent, StoreNewer, StoreVersionInvalid])
/** What a store's version read allows; see {@link StoreVersionDecision}. */
export type StoreVersionDecision = typeof StoreVersionDecision.Type

/** The two decisions under which a store is neither read nor written. */
export type StoreVersionRefusal = StoreNewer | StoreVersionInvalid

/**
 * Decides what a store whose `user_version` reads `version` (an integer)
 * allows: below 0 is {@link StoreVersionInvalid}, 0 is
 * {@link StoreUnstamped}, {@link knownStoreVersion} is
 * {@link StoreCurrent}, and anything above is {@link StoreNewer}. Its input
 * is SQLite's `user_version`, a signed 32-bit integer, which Runtime
 * decodes with `Schema.Int` before calling it. The decision is total over
 * that range, from -2147483648 to 2147483647. A number that is not an
 * integer (`NaN`, 0.5) is outside the contract: the outcome's `Schema.Int`
 * field rejects it, and constructing {@link StoreNewer} or
 * {@link StoreVersionInvalid} raises a defect. No outcome lets a writer
 * lower a version: only an unstamped store is ever stamped.
 */
export const decideStoreVersion = (version: number): StoreVersionDecision =>
  version < 0
    ? new StoreVersionInvalid({ found: version })
    : version === 0
      ? new StoreUnstamped()
      : version === knownStoreVersion
        ? new StoreCurrent()
        : new StoreNewer({ found: version })

/**
 * The reason a store whose version reads `found`, below 0, is refused,
 * carried by the store's own error (`LedgerError` or `ProjectLogError`;
 * ruling P2).
 */
export const invalidVersionReason = (found: number): string =>
  `store format version ${String(found)} is not one tarlatan writes`

/**
 * The store at `path` is stamped with format version `found`, above the
 * version `known` this release knows ({@link knownStoreVersion}). A newer
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
