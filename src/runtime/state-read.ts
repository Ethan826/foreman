// Read-only access to a project's stores for `status` (plan "Commands and
// their prerequisites": status never takes the lock and never writes;
// review item B11). A store whose file is missing is none, and nothing is
// created: the files are opened read-only and only when present. Each
// open reads the store's format version, SQLite's `user_version` header
// field (dogfood-5), and stamps nothing: a reader exposes the version as
// read, so 0 means a store v0.1.0 wrote that no writer has opened since.
// A store stamped newer than this release knows, or below 0, fails the
// open, so none of its rows is read. Each read of rows runs inside a
// deferred read transaction, which never takes the write lock, so it is a
// consistent snapshot while another connection writes (WAL readers do not
// block writers, sqlite.org/wal.html). Its first statement reads the
// version again, and Domain's decision on that read governs the read
// (review finding F6). At 0 or 1, the same format, the rows are read; a
// store stamped newer or below 0 since the open is refused as at the open,
// before any row is read. So the rows and the version come from one
// snapshot, and `openLedgerReading` gives status that version with the
// rows or the refusal as a value. As in every WAL reader, SQLite records
// the reader's mark in the shared-memory index (`-shm`); the database and
// its WAL file are not written. No file is created either, because every
// writer keeps the WAL and `-shm` files when it closes (`keepWalFiles` in
// `sqlite.ts`). A reader's one connection holds one transaction at a time,
// so each reader's reads queue on a one-permit semaphore made at the open,
// as the writers' transactions do (review finding F8).
import { Database } from "bun:sqlite"
import { Effect, Option, Result, Semaphore } from "effect"
import type { Scope } from "effect"
import { existsSync } from "node:fs"
import { type LoggedEvent, LogPosition, ProjectLogError } from "../domain/events.ts"
import { LedgerBusy, LedgerError, type LedgerSnapshot } from "../domain/ledger.ts"
import type { StoreVersionNewer, StoreVersionRefusal } from "../domain/store-version.ts"
import { readAll } from "./ledger-sqlite.ts"
import { readFromDb } from "./project-log.ts"
import {
  isSqliteBusy,
  readStoreVersion,
  refusalFailure,
  sqliteReason,
  type StoreVersionRead,
  transaction,
  type TxConnection,
  usableVersion,
} from "./sqlite.ts"

/** A project log opened only to read. */
export interface LogReader {
  /**
   * The log's format version as its header read at the open, decoded as an
   * integer: 0 for a log v0.1.0 wrote and no writer has stamped since, 1
   * for the format this release knows. The reader stamps nothing. Each
   * read decides on the version its own snapshot reads, which another
   * connection may have changed since the open.
   */
  readonly version: number
  /**
   * Every event after `position`, in order, read in one deferred
   * transaction whose first statement reads the version and decides on it
   * (review finding F6). At 0 or 1, the same format, the events are read.
   * A newer log fails with `StoreVersionNewer` and one below 0 with
   * ProjectLogError (owner ruling P2), and no event is read.
   */
  readonly readFrom: (
    position: LogPosition,
  ) => Effect.Effect<ReadonlyArray<LoggedEvent>, ProjectLogError | StoreVersionNewer>
  /**
   * The events {@link LogReader.readFrom} reads after `position`, with the
   * version the same snapshot's header read, so status can report the
   * version the events came from (review finding F6). Fails as `readFrom`
   * does.
   */
  readonly versionedFrom: (
    position: LogPosition,
  ) => Effect.Effect<VersionedEvents, ProjectLogError | StoreVersionNewer>
}

/** Events read from a log, with the format version their snapshot's header read. */
export interface VersionedEvents {
  /** The header's `user_version` as the snapshot read it: 0 or 1. */
  readonly version: number
  /** The events, in order. */
  readonly events: ReadonlyArray<LoggedEvent>
}

/** The ledger opened only to read. */
export interface LedgerReader {
  /**
   * The ledger's format version as its header read at the open, decoded as
   * an integer: 0 for a ledger v0.1.0 wrote and no writer has stamped
   * since, 1 for the format this release knows. The reader stamps nothing.
   * Each read decides on the version its own snapshot reads, which another
   * connection may have changed since the open.
   */
  readonly version: number
  /**
   * The ledger's version and, when Domain's decision on it allows, every
   * stored row, both read in one deferred transaction (review finding F6).
   * A refusing version (newer, or below 0) is given as a value, and no row
   * is read.
   */
  readonly snapshot: Effect.Effect<VersionedRead<LedgerSnapshot>, LedgerError | LedgerBusy>
  /**
   * Every stored row, read as {@link LedgerReader.snapshot} reads them. A
   * newer ledger fails with `StoreVersionNewer` and one below 0 with
   * LedgerError (owner ruling P2), and no row is read.
   */
  readonly read: Effect.Effect<LedgerSnapshot, LedgerError | LedgerBusy | StoreVersionNewer>
}

/**
 * A store's file opened to read: the reader, or the version decision
 * that refused it (newer, or below 0) before any row was read.
 */
export type ReaderOpening<A> = Result.Result<A, StoreVersionRefusal>

/**
 * What one read of a store found, all from one snapshot (review finding
 * F6): the format `version` its header read, and either the `rows`, when
 * Domain's decision on that version allows reading (0 or 1, the same
 * format), or the decision that refused the store (newer, or below 0),
 * with no row read.
 */
export interface VersionedRead<A> {
  /** The header's `user_version` as the snapshot read it. */
  readonly version: number
  /** The rows, or the decision that refused the store. */
  readonly rows: Result.Result<A, StoreVersionRefusal>
}

/**
 * Opens the project log at `path` read-only for the scope, or gives none
 * when no file is there; creates nothing and stamps nothing. A log stamped
 * newer than this release knows fails with `StoreVersionNewer`, and one
 * stamped below 0 with `ProjectLogError`, before any event is read.
 */
export const openLogReader = (
  path: string,
  busyTimeoutMillis: number,
): Effect.Effect<Option.Option<LogReader>, ProjectLogError | StoreVersionNewer, Scope.Scope> =>
  Effect.flatMap(
    presentOpen(path, busyTimeoutMillis, logFailure, logReader(path)),
    refusedAsFailure(path, logRefused),
  )

/**
 * Opens the ledger at `path` read-only for the scope, or gives none when
 * no file is there; creates nothing, stamps nothing and never takes the
 * write lock. A ledger stamped newer than this release knows fails with
 * `StoreVersionNewer`, and one stamped below 0 with `LedgerError`, before
 * any row is read.
 */
export const openLedgerReader = (
  path: string,
  busyTimeoutMillis: number,
): Effect.Effect<Option.Option<LedgerReader>, LedgerError | LedgerBusy | StoreVersionNewer, Scope.Scope> =>
  Effect.flatMap(
    presentOpen(path, busyTimeoutMillis, ledgerFailure, ledgerReader(path)),
    refusedAsFailure(path, ledgerRefused),
  )

/**
 * Opens the ledger at `path` read-only for the scope and reads it once, as
 * {@link LedgerReader.snapshot} does; none when no file is there. Creates
 * nothing, stamps nothing and never takes the write lock. A ledger whose
 * version refuses it, at the open or in the read's snapshot, gives the
 * version found and the refusal as a value, and none of its rows is read;
 * status reports it as a finding (owner ruling P6, review finding F6).
 */
export const openLedgerReading = (
  path: string,
  busyTimeoutMillis: number,
): Effect.Effect<Option.Option<VersionedRead<LedgerSnapshot>>, LedgerError | LedgerBusy, Scope.Scope> =>
  Effect.flatMap(presentOpen(path, busyTimeoutMillis, ledgerFailure, ledgerReader(path)), (opened) =>
    Effect.transposeOption(Option.map(opened, snapshotOrRefusal)),
  )

/** The ledger's one read when the open accepted it, or the open's refusal with the version it found. */
const snapshotOrRefusal = (
  opening: ReaderOpening<LedgerReader>,
): Effect.Effect<VersionedRead<LedgerSnapshot>, LedgerError | LedgerBusy> =>
  Result.match(opening, {
    onSuccess: (reader) => reader.snapshot,
    onFailure: (refusal) => Effect.succeed(refusedRead<LedgerSnapshot>(refusal)),
  })

/** A read refused for its version: the version found, and no rows. */
const refusedRead = <A>(refusal: StoreVersionRefusal): VersionedRead<A> => ({
  version: refusal.found,
  rows: Result.fail(refusal),
})

/**
 * The reader of the log at `path` over `db`, which the open read at
 * `version`. Its reads queue on one semaphore (review finding F8).
 */
const logReader =
  (path: string) =>
  (db: Database, version: number): LogReader => {
    const lock = Semaphore.makeUnsafe(1)
    const versionedFrom = (position: LogPosition) =>
      Effect.flatMap(versionedRead(db, lock, logFailure, readFromDb(db, position)), eventsOrFailure(path))
    return {
      version,
      versionedFrom,
      readFrom: (position: LogPosition) => Effect.map(versionedFrom(position), (read) => read.events),
    }
  }

/** The events of a versioned read of the log at `path` with their version, or its refusal as a failure. */
const eventsOrFailure =
  (path: string) =>
  (versioned: VersionedRead<ReadonlyArray<LoggedEvent>>): Effect.Effect<VersionedEvents, ProjectLogError | StoreVersionNewer> =>
    Effect.map(
      rowsOrFailure<ReadonlyArray<LoggedEvent>, ProjectLogError>(path, logRefused)(versioned),
      (events): VersionedEvents => ({ version: versioned.version, events }),
    )

/**
 * The reader of the ledger at `path` over `db`, which the open read at
 * `version`. Its reads queue on one semaphore (review finding F8).
 */
const ledgerReader =
  (path: string) =>
  (db: Database, version: number): LedgerReader => {
    const lock = Semaphore.makeUnsafe(1)
    const snapshot = versionedRead(db, lock, ledgerFailure, readAll(db))
    return {
      version,
      snapshot,
      read: Effect.flatMap(snapshot, rowsOrFailure<LedgerSnapshot, LedgerError | LedgerBusy>(path, ledgerRefused)),
    }
  }

/** Maps a thrown SQLite error, or a version that does not decode, to ProjectLogError. */
const logFailure = (error: unknown) => new ProjectLogError({ reason: sqliteReason(error) })

/** The log's error for a refusal with `reason`. */
const logRefused = (reason: string) => new ProjectLogError({ reason })

/** Maps a thrown SQLite error to LedgerBusy (a lock held too long) or LedgerError. */
const ledgerFailure = (error: unknown): LedgerError | LedgerBusy =>
  isSqliteBusy(error) ? new LedgerBusy() : new LedgerError({ reason: sqliteReason(error) })

/** The ledger's error for a refusal with `reason`. */
const ledgerRefused = (reason: string) => new LedgerError({ reason })

/**
 * Reads the store's version and, when Domain's decision on it allows,
 * `rows`, in one deferred read transaction on `db`, so both come from one
 * snapshot (review finding F6). The decision is made on this read, not on
 * the open's: 0 and 1 are the same format, so a store another connection
 * stamped from 0 to 1 since the open reads normally, and one stamped newer
 * or below 0 since then is refused as a value before any row is read.
 * The whole transaction holds `lock`'s one permit, so concurrent reads on
 * the one connection queue instead of failing with "cannot start a
 * transaction within a transaction" (review finding F8).
 */
const versionedRead = <A, E>(
  db: Database,
  lock: Semaphore.Semaphore,
  failure: (error: unknown) => E,
  rows: Effect.Effect<A, E>,
): Effect.Effect<VersionedRead<A>, E> =>
  Semaphore.withPermits(
    lock,
    1,
  )(
    transaction(
      readConnection(db, failure),
      Effect.flatMap(readStoreVersion(db, failure), (read) => rowsIfUsable(read, rows)),
    ),
  )

/** Reads `rows` when the decision in `read` allows; otherwise gives the refusal and reads nothing. */
const rowsIfUsable = <A, E>(read: StoreVersionRead, rows: Effect.Effect<A, E>): Effect.Effect<VersionedRead<A>, E> =>
  Result.match(usableVersion(read.decision), {
    onSuccess: () => Effect.map(rows, (found) => readRows(read.version, found)),
    onFailure: (refusal) => Effect.succeed(refusedRead<A>(refusal)),
  })

/** A read whose snapshot's header read `version` and which read `rows`. */
const readRows = <A>(version: number, rows: A): VersionedRead<A> => ({ version, rows: Result.succeed(rows) })

/**
 * The rows of a versioned read, or its refusal as a failure:
 * `StoreVersionNewer` for a newer store, and the store's own error, built
 * by `refused`, for one below 0 (owner ruling P2).
 */
const rowsOrFailure =
  <A, E>(path: string, refused: (reason: string) => E) =>
  (versioned: VersionedRead<A>): Effect.Effect<A, E | StoreVersionNewer> =>
    Effect.mapError(Effect.fromResult(versioned.rows), refusalFailure(path, refused))

/**
 * A store opened to read, with a refusing version turned into the open's
 * failure: `StoreVersionNewer` for a newer store, and the store's own
 * error, built by `refused`, for one below 0 (owner ruling P2).
 */
const refusedAsFailure =
  <A, E>(path: string, refused: (reason: string) => E) =>
  (opened: Option.Option<ReaderOpening<A>>): Effect.Effect<Option.Option<A>, E | StoreVersionNewer> =>
    Effect.mapError(
      Effect.fromResult(
        Option.match(opened, {
          onNone: () => Result.succeed(Option.none<A>()),
          onSome: (opening) => Result.map(opening, (reader) => Option.some(reader)),
        }),
      ),
      refusalFailure(path, refused),
    )

/**
 * Opens the database at `path` read-only with `busy_timeout` set, closes
 * it when the scope ends, reads its format version and, when the version
 * allows, builds `reader` over it with that version; none, with nothing
 * opened, when no file is at `path`. A refusing version gives its
 * decision, and `reader` is never built, so no row is read.
 */
const presentOpen = <A, E>(
  path: string,
  busyTimeoutMillis: number,
  failure: (error: unknown) => E,
  reader: (db: Database, version: number) => A,
): Effect.Effect<Option.Option<ReaderOpening<A>>, E, Scope.Scope> =>
  Effect.suspend(() =>
    existsSync(path)
      ? Effect.map(
          Effect.flatMap(readOnly(path, busyTimeoutMillis, failure), checkedReader(failure, reader)),
          (opening) => Option.some(opening),
        )
      : Effect.succeed(Option.none<ReaderOpening<A>>()),
  )

/** Opens `path` read-only for the scope, closing it when the scope ends, and sets `busy_timeout`. */
const readOnly = <E>(path: string, busyTimeoutMillis: number, failure: (error: unknown) => E) =>
  Effect.flatMap(
    Effect.acquireRelease(Effect.try({ try: () => new Database(path, { readonly: true }), catch: failure }), (db) =>
      Effect.sync(() => {
        db.close()
      }),
    ),
    (db) =>
      Effect.try({
        try: () => {
          db.exec(`PRAGMA busy_timeout=${String(busyTimeoutMillis)}`)
          return db
        },
        catch: failure,
      }),
  )

/** Reads the version on `db` and builds `reader` over it when the version allows. */
const checkedReader =
  <A, E>(failure: (error: unknown) => E, reader: (db: Database, version: number) => A) =>
  (db: Database): Effect.Effect<ReaderOpening<A>, E> =>
    Effect.map(readStoreVersion(db, failure), (read) =>
      Result.map(usableVersion(read.decision), () => reader(db, read.version)),
    )

/**
 * A read transaction's steps on `db`: `BEGIN` (deferred), which takes no
 * write lock, with thrown errors mapped by `failure`. SQLite starts the
 * snapshot at the transaction's first read.
 */
const readConnection = <E>(db: Database, failure: (error: unknown) => E): TxConnection<E> => ({
  begin: attempt(failure, () => {
    db.exec("BEGIN")
  }),
  commit: attempt(failure, () => {
    db.exec("COMMIT")
  }),
  rollback: attempt(failure, () => {
    db.exec("ROLLBACK")
  }),
  active: attempt(failure, () => db.inTransaction),
})

/** Runs a synchronous SQLite call, mapping a thrown error with `failure`. */
const attempt = <A, E>(failure: (error: unknown) => E, use: () => A) => Effect.try({ try: use, catch: failure })
