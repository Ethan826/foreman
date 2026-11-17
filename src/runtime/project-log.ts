// A project's event log on SQLite (design "Operations, checkpoints and
// recovery": the event store with its conditional append). One table of
// events numbered from 1; an append names the position it read, and runs
// in one `BEGIN IMMEDIATE` transaction that refuses it, writing nothing,
// if another writer appended first.
import { Database } from "bun:sqlite"
import { Array as Arr, Effect, Schema } from "effect"
import type { Scope } from "effect"
import {
  type LoggedEvent,
  LogPosition,
  PositionMoved,
  ProjectEvent,
  type ProjectLog,
  ProjectLogError,
} from "../domain/events.ts"
import { isSqliteBusy, sqliteReason } from "./sqlite.ts"

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
  "PRAGMA journal_mode=WAL",
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

const runInTransaction = <A, E>(db: Database, body: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    yield* withDb(() => {
      db.exec("BEGIN IMMEDIATE")
    })
    const result = yield* Effect.onError(body, () =>
      Effect.ignore(
        withDb(() => {
          db.exec("ROLLBACK")
        }),
      ),
    )
    yield* withDb(() => {
      db.exec("COMMIT")
    })
    return result
  })

const readFromDb = (db: Database, position: LogPosition) =>
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

const logOf = (db: Database): ProjectLog => ({
  append: (expected, events) => runInTransaction(db, appendTx(db, expected, events)),
  readFrom: (position) => readFromDb(db, position),
})

const open = (path: string, busyTimeoutMillis: number) =>
  withDb(() => {
    const db = new Database(path, { create: true })
    db.exec(`PRAGMA busy_timeout=${String(busyTimeoutMillis)}`)
    Arr.forEach(schemaSql, (sql) => {
      db.exec(sql)
    })
    return db
  })

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
    logOf,
  )
