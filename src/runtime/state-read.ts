// Read-only access to a project's stores for `status` (plan "Commands and
// their prerequisites": status never takes the lock and never writes;
// review item B11). A store whose file is missing is none, and nothing is
// created: the files are opened read-only and only when present. The
// log is read in one statement. The ledger is read inside a deferred
// read transaction, which never takes the write lock, so it is a
// consistent snapshot while another connection writes (WAL readers do
// not block writers, sqlite.org/wal.html). As in every WAL reader, SQLite
// records the reader's mark in the shared-memory index (`-shm`); the
// database and its WAL file are not written.
import { Database } from "bun:sqlite"
import { Effect, Option } from "effect"
import type { Scope } from "effect"
import { existsSync } from "node:fs"
import { type LoggedEvent, LogPosition, ProjectLogError } from "../domain/events.ts"
import { LedgerBusy, LedgerError, type LedgerSnapshot } from "../domain/ledger.ts"
import { readAll } from "./ledger-sqlite.ts"
import { readFromDb } from "./project-log.ts"
import { isSqliteBusy, sqliteReason, transaction, type TxConnection } from "./sqlite.ts"

/** A project log opened only to read. */
export interface LogReader {
  /** Every event after `position`, in order. */
  readonly readFrom: (position: LogPosition) => Effect.Effect<ReadonlyArray<LoggedEvent>, ProjectLogError>
}

/** The ledger opened only to read. */
export interface LedgerReader {
  /** Every stored row, read in one deferred transaction. */
  readonly read: Effect.Effect<LedgerSnapshot, LedgerError | LedgerBusy>
}

/**
 * Opens the project log at `path` read-only for the scope, or gives none
 * when no file is there; creates nothing.
 */
export const openLogReader = (
  path: string,
  busyTimeoutMillis: number,
): Effect.Effect<Option.Option<LogReader>, ProjectLogError, Scope.Scope> =>
  presentOpen(path, busyTimeoutMillis, (error) => new ProjectLogError({ reason: sqliteReason(error) }), (db) => ({
    readFrom: (position: LogPosition) => readFromDb(db, position),
  }))

/**
 * Opens the ledger at `path` read-only for the scope, or gives none when
 * no file is there; creates nothing and never takes the write lock.
 */
export const openLedgerReader = (
  path: string,
  busyTimeoutMillis: number,
): Effect.Effect<Option.Option<LedgerReader>, LedgerError | LedgerBusy, Scope.Scope> =>
  presentOpen(path, busyTimeoutMillis, ledgerFailure, (db) => ({
    read: transaction(readConnection(db), readAll(db)),
  }))

/** Maps a thrown SQLite error to LedgerBusy (a lock held too long) or LedgerError. */
const ledgerFailure = (error: unknown): LedgerError | LedgerBusy =>
  isSqliteBusy(error) ? new LedgerBusy() : new LedgerError({ reason: sqliteReason(error) })

/**
 * Opens the database at `path` read-only with `busy_timeout` set, closes
 * it when the scope ends, and builds `reader` over it; none, with nothing
 * opened, when no file is at `path`.
 */
const presentOpen = <A, E>(
  path: string,
  busyTimeoutMillis: number,
  failure: (error: unknown) => E,
  reader: (db: Database) => A,
): Effect.Effect<Option.Option<A>, E, Scope.Scope> =>
  existsSync(path)
    ? Effect.map(
        Effect.acquireRelease(
          Effect.try({
            try: () => {
              const db = new Database(path, { readonly: true })
              db.exec(`PRAGMA busy_timeout=${String(busyTimeoutMillis)}`)
              return db
            },
            catch: failure,
          }),
          (db) =>
            Effect.sync(() => {
              db.close()
            }),
        ),
        (db) => Option.some(reader(db)),
      )
    : Effect.succeed(Option.none())

/** A read transaction's steps: `BEGIN` (deferred), which takes no write lock. */
const readConnection = (db: Database): TxConnection<LedgerError | LedgerBusy> => ({
  begin: attempt(() => {
    db.exec("BEGIN")
  }),
  commit: attempt(() => {
    db.exec("COMMIT")
  }),
  rollback: attempt(() => {
    db.exec("ROLLBACK")
  }),
  active: attempt(() => db.inTransaction),
})

/** Runs a synchronous SQLite call, mapping a thrown error. */
const attempt = <A>(use: () => A) => Effect.try({ try: use, catch: ledgerFailure })
