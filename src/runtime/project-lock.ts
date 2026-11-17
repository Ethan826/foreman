// The project lock (design "Single instance (R-S3)"): one holder at a
// time, refused at once rather than waited for. Bun exposes no `flock`, so
// the lock is SQLite's own exclusive lock on a dedicated lock file: the
// holder keeps `BEGIN EXCLUSIVE` open in exclusive locking mode with
// `busy_timeout` 0. SQLite's unix locks are POSIX advisory locks, which
// the operating system releases when the holding process dies, as it does
// for `flock`.
import { Database } from "bun:sqlite"
import { Effect } from "effect"
import type { Scope } from "effect"
import { LockHeld, ProjectLogError } from "../domain/events.ts"
import { isSqliteBusy, sqliteReason } from "./sqlite.ts"

/** Opens the lock file and takes its exclusive lock, or throws. */
const take = (path: string): Database => {
  const db = new Database(path, { create: true })
  db.exec("PRAGMA busy_timeout=0")
  db.exec("PRAGMA locking_mode=EXCLUSIVE")
  db.exec("BEGIN EXCLUSIVE")
  return db
}

const release = (db: Database) =>
  Effect.sync(() => {
    db.exec("ROLLBACK")
    db.close()
  })

/**
 * Takes the project lock at `path` for the scope, or fails at once with
 * {@link LockHeld} when another holder has it. The lock is released when
 * the scope ends or the process dies.
 */
export const tryLock = (
  path: string,
): Effect.Effect<void, LockHeld | ProjectLogError, Scope.Scope> =>
  Effect.asVoid(
    Effect.acquireRelease(
      Effect.try({
        try: () => take(path),
        catch: (error) =>
          isSqliteBusy(error)
            ? new LockHeld({ path })
            : new ProjectLogError({ reason: sqliteReason(error) }),
      }),
      release,
    ),
  )
