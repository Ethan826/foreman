// The project lock (design "Single instance (R-S3)"): one holder at a
// time, refused at once rather than waited for. Bun exposes no `flock`, so
// the lock is SQLite's own exclusive lock on a dedicated lock file: the
// holder keeps `BEGIN EXCLUSIVE` open in exclusive locking mode with
// `busy_timeout` 0. SQLite's unix locks are POSIX advisory locks, which
// the operating system releases when the holding process dies, as it does
// for `flock`.
import { Database } from "bun:sqlite"
import { Effect, Exit } from "effect"
import type { Scope } from "effect"
import { LockHeld, ProjectLogError } from "../domain/events.ts"
import { isSqliteBusy, sqliteReason } from "./sqlite.ts"

/**
 * The part of a SQLite connection the lock uses. `bun:sqlite`'s
 * `Database` is one; a test injects one whose statements fail.
 */
export interface LockConnection {
  /** Runs one SQL statement; throws when SQLite refuses it. */
  readonly exec: (sql: string) => void
  /** Closes the connection; throws when it cannot be closed. */
  readonly close: () => void
}

/** Opens the connection to the lock file at a path, or throws. */
export type OpenLockConnection = (path: string) => LockConnection

/** Opens the lock file with `bun:sqlite`, creating it when missing. */
const openSqlite: OpenLockConnection = (path) => new Database(path, { create: true })

/** A thrown SQLite error as the lock's typed failure. */
const lockFailure = (path: string) => (error: unknown) =>
  isSqliteBusy(error)
    ? new LockHeld({ path })
    : new ProjectLogError({ reason: sqliteReason(error) })

/** Takes the exclusive lock on an open connection, or throws. */
const take = (conn: LockConnection) => {
  conn.exec("PRAGMA busy_timeout=0")
  conn.exec("PRAGMA locking_mode=EXCLUSIVE")
  conn.exec("BEGIN EXCLUSIVE")
}

/**
 * Closes the connection after a failed acquisition. A failing close is a
 * typed failure too, so the cause keeps it beside the acquisition's own
 * failure, which stays first.
 */
const closeAfterFailure = (conn: LockConnection) =>
  Effect.try({
    try: () => { conn.close() },
    catch: (error) => new ProjectLogError({ reason: sqliteReason(error) }),
  })

/** Takes the lock on an open connection, closing it if that fails. */
const lockOrClose = (path: string) => (conn: LockConnection) =>
  Effect.as(
    Effect.onExit(
      Effect.try({ try: () => { take(conn) }, catch: lockFailure(path) }),
      (exit) => (Exit.isFailure(exit) ? closeAfterFailure(conn) : Effect.void),
    ),
    conn,
  )

/** Opens the lock file and takes its lock, failing with the typed error. */
const acquire = (open: OpenLockConnection, path: string) =>
  Effect.flatMap(
    Effect.try({ try: () => open(path), catch: lockFailure(path) }),
    lockOrClose(path),
  )

/**
 * Rolls back and closes. The close runs even when ROLLBACK throws; a
 * release cannot fail in its type, so each throw is a defect, and a
 * failing close is reported beside a failed ROLLBACK, not instead of it.
 */
const release = (conn: LockConnection) =>
  Effect.ensuring(
    Effect.sync(() => { conn.exec("ROLLBACK") }),
    Effect.sync(() => { conn.close() }),
  )

/**
 * {@link tryLock} over an injected way to open the lock file's
 * connection, so a test can make a statement or the close fail.
 */
export const tryLockWith =
  (open: OpenLockConnection) =>
  (path: string): Effect.Effect<void, LockHeld | ProjectLogError, Scope.Scope> =>
    Effect.asVoid(Effect.acquireRelease(acquire(open, path), release))

/**
 * Takes the project lock at `path` for the scope, or fails at once with
 * {@link LockHeld} when another holder has it. The lock is released when
 * the scope ends or the process dies.
 */
export const tryLock: (
  path: string,
) => Effect.Effect<void, LockHeld | ProjectLogError, Scope.Scope> = tryLockWith(openSqlite)
