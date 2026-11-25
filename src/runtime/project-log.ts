// A project's event log on SQLite (design "Operations, checkpoints and
// recovery": the event store with its conditional append). One table of
// events numbered from 1; an append names the position it read, and runs
// in one `BEGIN IMMEDIATE` transaction that refuses it, writing nothing,
// if another writer appended first. The file's format version is SQLite's
// `user_version` header field (dogfood-5): `open` reads it before it opens
// the file for writing, and again inside a `BEGIN IMMEDIATE` transaction
// that creates the table and stamps a log at 0 with 1, so every open takes
// the write lock briefly; a log stamped newer, or below 0, is refused and
// left untouched (`openWriter` in `sqlite.ts`).
import type { Database } from "bun:sqlite"
import { Array as Arr, Effect, Schema, Semaphore } from "effect"
import type { Scope } from "effect"
import {
  type LoggedEvent,
  LogPosition,
  PositionMoved,
  ProjectEvent,
  type ProjectLog,
  ProjectLogError,
} from "../domain/events.ts"
import type { StoreVersionNewer } from "../domain/store-version.ts"
import { isSqliteBusy, openWriter, sqliteReason, transaction, type TxConnection } from "./sqlite.ts"

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

const appendTx = (
  db: Database,
  expected: LogPosition,
  events: ReadonlyArray<ProjectEvent>,
) =>
  Effect.gen(function* () {
    const bodies = yield* Effect.forEach(events, encodeEvent)
    yield* requireAt(yield* lastPosition(db), expected)
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
const open = (path: string, busyTimeoutMillis: number) =>
  openWriter<ProjectLogError>({
    path,
    busyTimeoutMillis,
    schemaSql,
    failure: toError,
    refused: (reason) => new ProjectLogError({ reason }),
    connection: connectionOf,
  })

/**
 * Opens (creating if needed) the project log at `path` for the scope, in
 * WAL mode with `busy_timeout` set, and closes it when the scope ends.
 * The open takes the write lock briefly, so it can wait up to
 * `busyTimeoutMillis` and then fail with "project log busy". A log at
 * format version 0 (written by v0.1.0) is stamped 1 and a new one is
 * created at 1. A log stamped by a newer release fails with
 * `StoreVersionNewer`, and one stamped below 0 with `ProjectLogError`;
 * either is left as it was, read and written by nothing.
 */
export const openProjectLog = (
  path: string,
  busyTimeoutMillis: number,
): Effect.Effect<ProjectLog, ProjectLogError | StoreVersionNewer, Scope.Scope> =>
  Effect.map(
    Effect.acquireRelease(open(path, busyTimeoutMillis), (db) =>
      Effect.sync(() => {
        db.close()
      }),
    ),
    (db) => logOf(db, Semaphore.makeUnsafe(1)),
  )
