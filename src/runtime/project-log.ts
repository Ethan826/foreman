// A project's event log on SQLite (design "Operations, checkpoints and
// recovery": the event store with its conditional append). One table of
// events numbered from 1; an append names the position it read, and runs
// in one `BEGIN IMMEDIATE` transaction that refuses it, writing nothing,
// if another writer appended first. The file's format version is SQLite's
// `user_version` header field (dogfood-5): `open` reads it before it opens
// the file for writing, and again inside a `BEGIN IMMEDIATE` transaction
// that creates the table and stamps a log at 0 with 1, so every open takes
// the write lock briefly; a log stamped newer than `knownLogVersion` (2),
// or below 0, is refused and left untouched (`openWriter` in `sqlite.ts`).
// A log at 1 is read and appended to as it is. The one raise (v0.2.0
// design, "Constraints"): an append holding an event that v0.1.1 does not
// decode (`raisesLogFormat`) sets a log at 1 to 2 inside its own
// transaction, so the raise commits and rolls back with the inserts.
//
// Domain's busy-wait contract (`ProjectLog`: a write that meets another
// writer's lock waits up to the configured busy timeout, then fails with
// `ProjectLogError` "project log busy" and writes nothing) is met by
// setting `PRAGMA busy_timeout` to the configured value on every
// connection the open makes, the read-only version check and the writer
// alike. SQLite documents that behaviour: a statement that finds a table
// locked sleeps and retries until at least that many milliseconds have
// passed, then returns SQLITE_BUSY
// (sqlite.org/pragma.html#pragma_busy_timeout,
// sqlite.org/c3ref/busy_timeout.html), which this module maps to "project
// log busy"; an append's `BEGIN IMMEDIATE` meets it before anything is
// written. That documented behaviour is the evidence; no test observes the
// wait, since `bun:sqlite` offers no way to see that a write met the lock.
// The tests check that the connection the production open makes carries
// the configured value (read with `busyTimeoutOf` through
// `openProjectLogWith`). Another database would supply its own
// evidence against the Domain contract (dogfood-6f, owner ruling of
// 2026-11-28).
import type { Database } from "bun:sqlite"
import { Array as Arr, Effect, Match, Schema, Semaphore } from "effect"
import type { Scope } from "effect"
import {
  type LoggedEvent,
  LogPosition,
  PositionMoved,
  ProjectEvent,
  type ProjectLog,
  ProjectLogError,
} from "../domain/events.ts"
import {
  knownLogVersion,
  raisesLogFormat,
  type StoreVersionNewer,
} from "../domain/store-version.ts"
import {
  type ConnectSqlite,
  connectSqlite,
  isSqliteBusy,
  openWriter,
  readStoreVersion,
  sqliteReason,
  type StoreVersionRead,
  transaction,
  type TxConnection,
} from "./sqlite.ts"

const toError = (error: unknown) =>
  new ProjectLogError({
    reason: isSqliteBusy(error) ? "project log busy" : sqliteReason(error),
  })

/** Runs a synchronous SQLite call, mapping a thrown error. */
const withDb = <A>(use: () => A) => Effect.try({ try: use, catch: toError })

const schemaFailure = (context: string) => (issue: { readonly message: string }) =>
  new ProjectLogError({ reason: `${context}: ${issue.message}` })

const EventJson = Schema.fromJsonString(ProjectEvent)
const encodeEvent = (event: ProjectEvent) =>
  Effect.mapError(Schema.encodeEffect(EventJson)(event), schemaFailure("encode"))
const decodeEvent = (body: string) =>
  Effect.mapError(Schema.decodeUnknownEffect(EventJson)(body), schemaFailure("decode"))

const StoredEvents = Schema.Array(Schema.Struct({ position: LogPosition, body: Schema.String }))
const decodeStored = (rows: unknown) =>
  Effect.mapError(Schema.decodeUnknownEffect(StoredEvents)(rows), schemaFailure("stored"))
const Last = Schema.Struct({ last: LogPosition })
const decodeLast = (row: unknown) =>
  Effect.mapError(Schema.decodeUnknownEffect(Last)(row), schemaFailure("position"))

const schemaSql: ReadonlyArray<string> = [
  "CREATE TABLE IF NOT EXISTS events (position INTEGER PRIMARY KEY, body TEXT NOT NULL)",
]

/** The position of the last event written (0 for an empty log). */
const lastPosition = (db: Database) =>
  Effect.map(
    Effect.flatMap(
      withDb(() => db.query("SELECT COALESCE(MAX(position), 0) AS last FROM events").get()),
      decodeLast,
    ),
    ({ last }) => last,
  )

/** Inserts the encoded events after `from` and returns the new position. */
const insertAfter = (db: Database, from: LogPosition, bodies: ReadonlyArray<string>) =>
  withDb(() => {
    Arr.forEach(bodies, (body, offset) => {
      db.query("INSERT INTO events (position, body) VALUES (?, ?)").run(from + offset + 1, body)
    })
    return LogPosition.make(from + Arr.length(bodies))
  })

/** Fails with PositionMoved unless the log is at `expected`. */
const requireAt = (actual: LogPosition, expected: LogPosition) =>
  actual === expected
    ? Effect.void
    : Effect.fail(new PositionMoved({ expected, actual }))

/**
 * The append's refusal when the version its transaction read, `found`, is
 * newer than {@link knownLogVersion} or below 0: another connection
 * stamped the log after this one opened it. Nothing is written.
 */
const unwritableVersion = (found: number) =>
  new ProjectLogError({
    reason: `project log format version ${String(found)} is not one this release appends to (it knows ${String(knownLogVersion)})`,
  })

/** Sets the log's `user_version` to {@link knownLogVersion}, inside the caller's transaction. */
const raised = (db: Database) =>
  withDb(() => {
    db.exec(`PRAGMA user_version = ${String(knownLogVersion)}`)
  })

/**
 * The log's version step inside the append's transaction, on the version
 * `read` there: a log at 1, or at 0 (only
 * after a raw reset, treated as 1), is raised to {@link knownLogVersion}
 * when `events` holds one that needs it ({@link raisesLogFormat}) and is
 * left as it is otherwise; a current log is left as it is; a newer or
 * negative one fails the append with {@link unwritableVersion}.
 */
const versionStep = (
  db: Database,
  events: ReadonlyArray<ProjectEvent>,
  read: StoreVersionRead,
): Effect.Effect<void, ProjectLogError> =>
  Match.value(read.decision).pipe(
    Match.withReturnType<Effect.Effect<void, ProjectLogError>>(),
    Match.tag("StoreUnstamped", "StoreOlderReadable", () =>
      Arr.some(events, raisesLogFormat) ? raised(db) : Effect.void,
    ),
    Match.tag("StoreCurrent", () => Effect.void),
    Match.tag("StoreNewer", "StoreVersionInvalid", () => Effect.fail(unwritableVersion(read.version))),
    Match.exhaustive,
  )

/**
 * The body of one append's `BEGIN IMMEDIATE` transaction: encodes the
 * events, refuses with `PositionMoved` unless the log is at `expected`,
 * reads the version and takes {@link versionStep} on it (the raise), then
 * inserts. The raise and the inserts commit or roll back together, since
 * `user_version` is on page 1.
 */
const appendTx = (
  db: Database,
  expected: LogPosition,
  events: ReadonlyArray<ProjectEvent>,
) =>
  Effect.gen(function* () {
    const bodies = yield* Effect.forEach(events, encodeEvent)
    yield* requireAt(yield* lastPosition(db), expected)
    yield* versionStep(db, events, yield* readStoreVersion(db, knownLogVersion, toError))
    return yield* insertAfter(db, expected, bodies)
  })

/** The connection's transaction steps, with SQLite errors mapped. */
const connectionOf = (db: Database): TxConnection<ProjectLogError> => ({
  begin: withDb(() => {
    db.exec("BEGIN IMMEDIATE")
  }),
  commit: withDb(() => {
    db.exec("COMMIT")
  }),
  rollback: withDb(() => {
    db.exec("ROLLBACK")
  }),
  active: withDb(() => db.inTransaction),
})

/** Every event after `position` on the connection `db`, in order; a status read uses it too. */
export const readFromDb = (db: Database, position: LogPosition) =>
  Effect.gen(function* () {
    const rows = yield* Effect.flatMap(
      withDb(() =>
        db.query("SELECT position, body FROM events WHERE position > ? ORDER BY position").all(position),
      ),
      decodeStored,
    )
    return yield* Effect.forEach(rows, ({ position: at, body }) =>
      Effect.map(decodeEvent(body), (event): LoggedEvent => ({ position: at, event })),
    )
  })

/**
 * The log over one connection. Appends on the same log queue on a
 * one-permit semaphore, since a connection holds one transaction at a time.
 */
const logOf = (db: Database, lock: Semaphore.Semaphore): ProjectLog => ({
  append: (expected, events) =>
    Semaphore.withPermits(lock, 1)(transaction(connectionOf(db), appendTx(db, expected, events))),
  readFrom: (position) => readFromDb(db, position),
})

/**
 * Opens the log's writer connection in the order of ruling P1
 * (`openWriter` in `sqlite.ts`) with the log's error mapping: a lock
 * timeout is `ProjectLogError` ("project log busy"), as are a refused
 * journal mode and a negative format version, and a newer version is
 * `StoreVersionNewer`.
 */
const open = (connect: ConnectSqlite, path: string, busyTimeoutMillis: number) =>
  openWriter<ProjectLogError>({
    path,
    connect,
    knownVersion: knownLogVersion,
    busyTimeoutMillis,
    schemaSql,
    failure: toError,
    refused: (reason) => new ProjectLogError({ reason }),
    connection: connectionOf,
  })

/**
 * {@link openProjectLog} with its read-write connection made by `connect`
 * (`ConnectSqlite` in `sqlite.ts`) instead of the production
 * `connectSqlite`; everything else, `busy_timeout` included, is set by the
 * open as in {@link openProjectLog}. Production uses
 * {@link openProjectLog}; a test passes a `connect` that records the
 * connection, to read its busy timeout after the open (dogfood-6f, owner
 * ruling of 2026-11-28).
 */
export const openProjectLogWith =
  (connect: ConnectSqlite) =>
  (
    path: string,
    busyTimeoutMillis: number,
  ): Effect.Effect<ProjectLog, ProjectLogError | StoreVersionNewer, Scope.Scope> =>
    Effect.map(
      Effect.acquireRelease(open(connect, path, busyTimeoutMillis), (db) =>
        Effect.sync(() => {
          db.close()
        }),
      ),
      (db) => logOf(db, Semaphore.makeUnsafe(1)),
    )

/**
 * Opens (creating if needed) the project log at `path` for the scope, in
 * WAL mode with `busy_timeout` set to `busyTimeoutMillis` on every
 * connection it makes, and closes it when the scope ends. That is how it
 * meets Domain's busy-wait contract ({@link ProjectLog}): an append that
 * meets another writer's lock waits up to `busyTimeoutMillis`, as SQLite
 * documents for `busy_timeout` (sqlite.org/pragma.html#pragma_busy_timeout,
 * sqlite.org/c3ref/busy_timeout.html), and then fails with
 * `ProjectLogError` ("project log busy") and writes nothing. SQLite's
 * documented behaviour is the evidence for the wait; no test observes it.
 * The open takes the write lock briefly, so it can wait up to
 * `busyTimeoutMillis` and then fail with "project log busy". A log at
 * format version 0 (written by v0.1.0) is stamped 1 and a new one is
 * created at 1; the open never writes 2. A log stamped above
 * `knownLogVersion` (2) by a newer release fails with
 * `StoreVersionNewer`, and one stamped below 0 with `ProjectLogError`;
 * either is left as it was, read and written by nothing. An append raises
 * a log at 1 to 2 when it holds an event that needs the newer format, and
 * fails with `ProjectLogError`, writing nothing, when its transaction
 * reads a version newer than 2 or below 0.
 */
export const openProjectLog: (
  path: string,
  busyTimeoutMillis: number,
) => Effect.Effect<ProjectLog, ProjectLogError | StoreVersionNewer, Scope.Scope> =
  openProjectLogWith(connectSqlite)
