// What the Runtime's SQLite stores share: recognizing a lock timeout and
// reading an error's message without `instanceof` (bun:sqlite throws a
// SQLiteError with a `code` and a `message`), opening a writer in WAL
// mode whose WAL files stay on close, and the store format version
// (dogfood-5, owner rulings P1 to P3). The version lives in SQLite's
// `PRAGMA user_version` header field; this module reads it, decodes it
// with a Schema and hands it, with the store's own known version, to
// Domain's `decideStoreVersion`. A writer's open (`openWriter`) checks it
// on a read-only connection first, then again inside the
// `BEGIN IMMEDIATE` transaction that creates the tables and stamps an
// unstamped store 1 (`firstStoreVersion`), whatever the store's known
// version; only the project log's raise (`project-log.ts`) writes a later
// one.
import { constants, Database } from "bun:sqlite"
import { Array as Arr, Effect, Exit, Match, Option, Result, Schema } from "effect"
import { existsSync } from "node:fs"
import {
  decideStoreVersion,
  firstStoreVersion,
  invalidVersionReason,
  type StoreVersionDecision,
  StoreVersionNewer,
  type StoreVersionRefusal,
} from "../domain/store-version.ts"

/** SQLite's result code for a lock held past `busy_timeout`. */
const SqliteCodes = { Busy: "SQLITE_BUSY" } as const

/** SQLite's numeric result code for success, `SQLITE_OK`. */
const sqliteOk = 0

/** The value that switches a boolean file control on. */
const switchedOn = 1

/** The refusal when SQLite keeps another journal mode. */
const walModeNotTaken = "WAL journal mode did not take effect"

/** The refusal when SQLite will not keep the WAL files on close. */
const walFilesNotKept = "SQLite refused to keep the WAL files on close"

/** Whether a thrown error is SQLite's SQLITE_BUSY (a lock held too long). */
export const isSqliteBusy = Schema.is(
  Schema.Struct({ code: Schema.Literal(SqliteCodes.Busy) }),
)

const messageOf = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }))

/** The message of a thrown error, or a fixed text when it has none. */
export const sqliteReason = (error: unknown): string =>
  Option.match(messageOf(error), {
    onNone: () => "unknown SQLite error",
    onSome: ({ message }) => message,
  })

/** The steps of a write transaction on one connection, as effects. */
export interface TxConnection<E> {
  readonly begin: Effect.Effect<void, E>
  readonly commit: Effect.Effect<void, E>
  readonly rollback: Effect.Effect<void, E>
  /** Whether a transaction is still open on the connection. */
  readonly active: Effect.Effect<boolean, E>
}

/** Rolls back if a transaction is still open; reports a failed ROLLBACK. */
const rollbackIfActive = <E>(conn: TxConnection<E>) =>
  Effect.flatMap(conn.active, (active) => (active ? conn.rollback : Effect.void))

/**
 * Runs `body` inside one write transaction and never leaves it open
 * (review finding F1). The bracket is uninterruptible except for `body`
 * itself. If `body` fails or is interrupted, the transaction is rolled
 * back and the body's failure is returned. If COMMIT fails, the
 * transaction is rolled back if still open and the COMMIT failure is
 * returned. A failed ROLLBACK is returned rather than swallowed, since the
 * connection's state is then unknown.
 */
export const transaction = <A, E, EB>(
  conn: TxConnection<E>,
  body: Effect.Effect<A, EB>,
): Effect.Effect<A, E | EB> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      yield* conn.begin
      const outcome = yield* Effect.exit(restore(body))
      if (Exit.isFailure(outcome)) {
        yield* rollbackIfActive(conn)
        return yield* Effect.failCause(outcome.cause)
      }
      const committed = yield* Effect.exit(conn.commit)
      if (Exit.isFailure(committed)) {
        yield* rollbackIfActive(conn)
        return yield* Effect.failCause(committed.cause)
      }
      return outcome.value
    }),
  )

const JournalMode = Schema.Struct({ journal_mode: Schema.String })
const decodeJournalMode = Schema.decodeUnknownOption(JournalMode)

/** The journal mode SQLite's journal-mode pragma reports for WAL. */
const walMode = "wal"

/**
 * Whether a `PRAGMA journal_mode=WAL` result row reports WAL. SQLite keeps
 * another mode silently where WAL cannot apply (an in-memory database, some
 * network filesystems), and the stores rely on WAL.
 */
export const isWal = (row: unknown): boolean =>
  Option.exists(decodeJournalMode(row), (r) => r.journal_mode === walMode)

/**
 * Asks SQLite to keep the WAL and shared-memory (`-shm`) files when this
 * connection closes (`SQLITE_FCNTL_PERSIST_WAL`,
 * sqlite.org/c3ref/c_fcntl_begin_atomic_write.html); true when SQLite
 * accepted. Every writer sets it, so the last one to close checkpoints
 * the WAL but leaves both files in place. Without it, the WAL files are
 * deleted on close, and a later read-only connection (`status`) creates
 * both and cannot delete them, which writes to the state directory
 * (review item B11). Apple's system SQLite, which Bun uses on macOS,
 * already keeps them; Bun's bundled SQLite on Linux does not.
 */
export const keepWalFiles = (db: Database): boolean =>
  db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, switchedOn) === sqliteOk

/**
 * Why a newly opened writer cannot be used: none when its journal mode is
 * WAL (`mode` is the `PRAGMA journal_mode=WAL` row) and SQLite agreed to
 * keep the WAL files ({@link keepWalFiles}), otherwise the reason.
 */
export const walRefusal = (mode: unknown, walKept: boolean): Option.Option<string> =>
  isWal(mode)
    ? keptRefusal(walKept)
    : Option.some(walModeNotTaken)

/** None when SQLite keeps the WAL files, otherwise the refusal. */
const keptRefusal = (walKept: boolean): Option.Option<string> =>
  walKept ? Option.none() : Option.some(walFilesNotKept)

/** The `PRAGMA user_version` result row, decoded as a signed integer. */
const UserVersion = Schema.Struct({ user_version: Schema.Int })
const decodeUserVersion = Schema.decodeUnknownEffect(UserVersion)

/** A store's format version as `PRAGMA user_version` read it, and what Domain decided it allows. */
export interface StoreVersionRead {
  /** The header's `user_version` as read; 0 for a store v0.1.0 wrote. */
  readonly version: number
  /** Domain's decision for that version. */
  readonly decision: StoreVersionDecision
}

/**
 * Reads `PRAGMA user_version` on `db`, decodes it with a Schema into an
 * integer and asks Domain's `decideStoreVersion` what it allows for a
 * store whose known version is `known` (`knownLedgerVersion` or
 * `knownLogVersion`). A thrown SQLite error or a row that does not decode
 * becomes the store's own error through `failure`. Reads only. Inside a
 * transaction the read is the transaction's, since the field is in the
 * header on page 1.
 */
export const readStoreVersion = <E>(
  db: Database,
  known: number,
  failure: (error: unknown) => E,
): Effect.Effect<StoreVersionRead, E> =>
  Effect.flatMap(
    Effect.try({ try: () => db.query("PRAGMA user_version").get(), catch: failure }),
    (row) =>
      Effect.map(
        Effect.mapError(decodeUserVersion(row), failure),
        (decoded): StoreVersionRead => ({
          version: decoded.user_version,
          decision: decideStoreVersion(decoded.user_version, known),
        }),
      ),
  )

/**
 * Whether a store with `decision` may be read and written: an unstamped,
 * older readable or current store may, and a newer or negative one is
 * refused with its decision.
 */
export const usableVersion = (decision: StoreVersionDecision): Result.Result<void, StoreVersionRefusal> =>
  Match.value(decision).pipe(
    Match.withReturnType<Result.Result<void, StoreVersionRefusal>>(),
    Match.tag("StoreUnstamped", "StoreOlderReadable", "StoreCurrent", () => Result.void),
    Match.tag("StoreNewer", (newer) => Result.fail(newer)),
    Match.tag("StoreVersionInvalid", (invalid) => Result.fail(invalid)),
    Match.exhaustive,
  )

/**
 * The failure of the store at `path`, whose known version is `known`, for
 * a refused version: a newer one is `StoreVersionNewer` carrying `known`,
 * and a negative one is the store's own error, built by `refused` from
 * ruling P2's reason.
 */
export const refusalFailure =
  <E>(path: string, known: number, refused: (reason: string) => E) =>
  (refusal: StoreVersionRefusal): E | StoreVersionNewer =>
    Result.match(refusalOutcome(path, known, refusal), {
      onSuccess: (newer): E | StoreVersionNewer => newer,
      onFailure: refused,
    })

/**
 * A refusal of the store at `path`, whose known version is `known`, before
 * the store's own error is built: `StoreVersionNewer` for a newer store,
 * or ruling P2's reason for one below 0.
 */
const refusalOutcome = (
  path: string,
  known: number,
  refusal: StoreVersionRefusal,
): Result.Result<StoreVersionNewer, string> =>
  Match.value(refusal).pipe(
    Match.withReturnType<Result.Result<StoreVersionNewer, string>>(),
    Match.tag("StoreNewer", (newer) => Result.succeed(new StoreVersionNewer({ path, found: newer.found, known }))),
    Match.tag("StoreVersionInvalid", (invalid) => Result.fail(invalidVersionReason(invalid.found))),
    Match.exhaustive,
  )

/** Succeeds when `decision` lets `store` be used; otherwise fails as {@link refusalFailure} says. */
const requireUsable = <E>(store: StoreWriter<E>, decision: StoreVersionDecision) =>
  Effect.mapError(
    Effect.fromResult(usableVersion(decision)),
    refusalFailure(store.path, store.knownVersion, store.refused),
  )

/** What {@link openWriter} needs to know about one store, its own error mapping included. */
export interface StoreWriter<E> {
  /** The store's database file. */
  readonly path: string
  /**
   * The store's own known format version (`knownLedgerVersion` or
   * `knownLogVersion`), which its version reads are decided against. The
   * open never stamps it: an unstamped store is stamped 1.
   */
  readonly knownVersion: number
  /** How long a statement waits for another connection's lock, in milliseconds. */
  readonly busyTimeoutMillis: number
  /** The `CREATE ... IF NOT EXISTS` statements (and any seed row) that make the store's tables. */
  readonly schemaSql: ReadonlyArray<string>
  /** Maps a thrown SQLite error, or a version row that does not decode, to the store's error. */
  readonly failure: (error: unknown) => E
  /** Builds the store's error for a refusal with `reason`: WAL not taken, or a negative version. */
  readonly refused: (reason: string) => E
  /** The connection's transaction steps, with the store's error mapping. */
  readonly connection: (db: Database) => TxConnection<E>
}

/** Runs a synchronous SQLite call for `store`, mapping a thrown error. */
const attempt = <A, E>(store: StoreWriter<E>, use: () => A) => Effect.try({ try: use, catch: store.failure })

/** Closes `db`. */
const closed = (db: Database) =>
  Effect.sync(() => {
    db.close()
  })

/** Sets `busy_timeout` on `db` for `store`. */
const timed = <E>(store: StoreWriter<E>, db: Database) =>
  attempt(store, () => {
    db.exec(`PRAGMA busy_timeout=${String(store.busyTimeoutMillis)}`)
  })

/** Sets `busy_timeout` on the read-only connection `db` and reads its version. */
const timedVersion =
  <E>(store: StoreWriter<E>) =>
  (db: Database) =>
    Effect.andThen(timed(store, db), readStoreVersion(db, store.knownVersion, store.failure))

/**
 * Ruling P1, step 1: when the store's file exists, reads its version on a
 * separate read-only connection, closes that connection and refuses a
 * newer or negative store. A refused store therefore never gets a
 * read-write connection: no journal-mode change, no table and no
 * checkpoint on close. A missing file is left to step 2 to create.
 */
const checkedBeforeWrite = <E>(store: StoreWriter<E>) =>
  Effect.suspend(() =>
    existsSync(store.path)
      ? Effect.flatMap(
          Effect.acquireUseRelease(
            attempt(store, () => new Database(store.path, { readonly: true })),
            timedVersion(store),
            closed,
          ),
          (read) => requireUsable(store, read.decision),
        )
      : Effect.void,
  )

/**
 * Ruling P1, step 2: sets `busy_timeout`, keeps the WAL files on close
 * ({@link keepWalFiles}) and takes WAL mode, refusing when either does not
 * take. The journal mode cannot change inside a transaction, so this runs
 * before step 3's.
 */
const walTaken = <E>(store: StoreWriter<E>, db: Database) =>
  Effect.flatMap(
    Effect.andThen(
      timed(store, db),
      attempt(store, () => {
        const walKept = keepWalFiles(db)
        return walRefusal(db.query("PRAGMA journal_mode=WAL").get(), walKept)
      }),
    ),
    (refusal) =>
      Option.match(refusal, {
        onNone: () => Effect.void,
        onSome: (reason) => Effect.fail(store.refused(reason)),
      }),
  )

/** Runs the store's `CREATE ... IF NOT EXISTS` statements; each writes nothing on a store that has its tables. */
const tablesCreated = <E>(store: StoreWriter<E>, db: Database) =>
  attempt(store, () => {
    Arr.forEach(store.schemaSql, (sql) => {
      db.exec(sql)
    })
  })

/**
 * Stamps the store with Domain's `firstStoreVersion` (1), its format, only
 * when `decision` says it read 0; never with the store's known version
 * (v0.2.0 design, "Constraints"). A store at 1 or above is not written, so
 * opening it commits nothing, and a version a newer release set is never
 * lowered (ruling P1).
 */
const stampedIfUnstamped = <E>(
  store: StoreWriter<E>,
  db: Database,
  decision: StoreVersionDecision,
): Effect.Effect<void, E> =>
  Match.value(decision).pipe(
    Match.tag("StoreUnstamped", () =>
      attempt(store, () => {
        db.exec(`PRAGMA user_version = ${String(firstStoreVersion)}`)
      }),
    ),
    Match.orElse(() => Effect.void),
  )

/**
 * Ruling P1, step 3, the body of one `BEGIN IMMEDIATE` transaction: reads
 * the version again and decides on this read, refuses a newer or negative
 * store, creates any missing table and stamps a store that read 0. The
 * read, the decision, the tables and the stamp all run under the write
 * lock, so no other writer can stamp the store between them, and
 * `user_version` is on page 1, so the stamp commits and rolls back with
 * the transaction.
 */
const preparedInTransaction = <E>(store: StoreWriter<E>, db: Database) =>
  Effect.gen(function* () {
    const read = yield* readStoreVersion(db, store.knownVersion, store.failure)
    yield* requireUsable(store, read.decision)
    yield* tablesCreated(store, db)
    yield* stampedIfUnstamped(store, db, read.decision)
  })

/** Steps 2 and 3 of ruling P1 on the read-write connection `db`, closing it if either fails. */
const preparedOrClosed =
  <E>(store: StoreWriter<E>) =>
  (db: Database) =>
    Effect.as(
      Effect.onExit(
        Effect.andThen(walTaken(store, db), transaction(store.connection(db), preparedInTransaction(store, db))),
        (exit) => (Exit.isFailure(exit) ? closed(db) : Effect.void),
      ),
      db,
    )

/**
 * Opens a store's writer connection in the order of ruling P1. (1) When
 * the file exists, its version is read on a read-only connection, and a
 * newer or negative store is refused before anything else. (2) A
 * read-write connection is opened, creating a missing file, with
 * `busy_timeout`, kept WAL files and WAL mode. (3) One `BEGIN IMMEDIATE`
 * transaction reads the version again, refuses on that read, creates the
 * tables and stamps a store that read 0. A newer store fails with
 * `StoreVersionNewer`; every other failure is the store's own error, and
 * a lock held past `busy_timeout` at step 3 fails as the store's
 * `failure` maps SQLITE_BUSY. The connection is closed on any failure; on
 * success the caller owns it.
 */
export const openWriter = <E>(store: StoreWriter<E>): Effect.Effect<Database, E | StoreVersionNewer> =>
  Effect.andThen(
    checkedBeforeWrite(store),
    Effect.flatMap(attempt(store, () => new Database(store.path, { create: true })), preparedOrClosed(store)),
  )
