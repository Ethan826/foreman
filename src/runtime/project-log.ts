// A project's event log on SQLite (design "Operations, checkpoints and
// recovery": the event store with its conditional append). One table of
// events numbered from 1; an append names the position it read, and runs
// in one `BEGIN IMMEDIATE` transaction that refuses it, writing nothing,
// if another writer appended first.
import { Database } from "bun:sqlite"
import { Array as Arr, Effect, Option, Schema, Semaphore } from "effect"
import type { Scope } from "effect"
import {
  type LoggedEvent,
  LogPosition,
  PositionMoved,
  ProjectEvent,
  type ProjectLog,
  ProjectLogError,
} from "../domain/events.ts"
import { isSqliteBusy, keepWalFiles, sqliteReason, transaction, type TxConnection, walRefusal } from "./sqlite.ts"

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
 * Opens the database, sets `busy_timeout`, keeps the WAL files on close
 * ({@link keepWalFiles}), takes WAL mode and creates any missing table.
 */
const open = (path: string, busyTimeoutMillis: number) =>
  Effect.flatMap(
    withDb(() => {
      const db = new Database(path, { create: true })
      db.exec(`PRAGMA busy_timeout=${String(busyTimeoutMillis)}`)
      const walKept = keepWalFiles(db)
      return { db, refusal: walRefusal(db.query("PRAGMA journal_mode=WAL").get(), walKept) }
    }),
    ({ db, refusal }) =>
      Option.match(refusal, {
        onNone: () =>
          withDb(() => {
            Arr.forEach(schemaSql, (sql) => {
              db.exec(sql)
            })
            return db
          }),
        onSome: (reason) =>
          Effect.andThen(
            Effect.sync(() => {
              db.close()
            }),
            Effect.fail(new ProjectLogError({ reason })),
          ),
      }),
  )

/**
 * Opens (creating if needed) the project log at `path` for the scope, in
 * WAL mode with `busy_timeout` set, and closes it when the scope ends.
 */
export const openProjectLog = (
  path: string,
  busyTimeoutMillis: number,
): Effect.Effect<ProjectLog, ProjectLogError, Scope.Scope> =>
  Effect.map(
    Effect.acquireRelease(open(path, busyTimeoutMillis), (db) =>
      Effect.sync(() => {
        db.close()
      }),
    ),
    (db) => logOf(db, Semaphore.makeUnsafe(1)),
  )
