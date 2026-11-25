// Stores in a given format-version state, made with `bun:sqlite` directly
// (dogfood-5). Every raw connection asks SQLite to keep the WAL files
// (`keepWalFiles`): under Bun's bundled SQLite on Linux, a raw connection
// that is the last to close a WAL-mode store deletes its `-wal` and `-shm`
// files, and a later read-only open would create them. A version is read
// with `PRAGMA user_version` on a fresh connection, never from the file's
// bytes, since in WAL mode page 1 can sit in the WAL.
import { Database } from "bun:sqlite"
import { Effect, Schema } from "effect"
import { existsSync } from "node:fs"
import { keepWalFiles } from "../../src/runtime/sqlite.ts"

/** Runs `use` on a fresh raw connection to `path` that keeps the WAL files, then closes it. */
const withRaw = <A>(path: string, use: (db: Database) => A): A => {
  const db = new Database(path, { create: true })
  keepWalFiles(db)
  const result = use(db)
  db.close()
  return result
}

const UserVersion = Schema.Struct({ user_version: Schema.Int })
const DataVersion = Schema.Struct({ data_version: Schema.Int })

/** The store's `user_version`, read on a fresh connection. */
export const versionOf = (path: string) =>
  Effect.sync(() => withRaw(path, (db) => db.query("PRAGMA user_version").get())).pipe(
    Effect.flatMap((row) => Schema.decodeUnknownEffect(UserVersion)(row)),
    Effect.map((row) => row.user_version),
  )

/** Sets the store's `user_version` to `version` on a raw connection. */
export const setVersion = (path: string, version: number) =>
  Effect.sync(() => {
    withRaw(path, (db) => {
      db.exec(`PRAGMA user_version = ${String(version)}`)
    })
  })

/** Runs `sql` on a raw connection to the store. */
export const rawExec = (path: string, sql: string) =>
  Effect.sync(() => {
    withRaw(path, (db) => {
      db.exec(sql)
    })
  })

/**
 * A rollback-journal store at `path` (no `-wal`, no `-shm`) at `version`,
 * holding one table that is not tarlatan's and none of tarlatan's tables.
 * Its bytes can be compared, since nothing of it sits in a WAL.
 */
export const rollbackStoreAt = (path: string, version: number) =>
  Effect.sync(() => {
    const db = new Database(path, { create: true })
    db.exec("CREATE TABLE unrelated (note TEXT)")
    db.exec("INSERT INTO unrelated (note) VALUES ('kept')")
    db.exec(`PRAGMA user_version = ${String(version)}`)
    db.close()
  })

/** Whether the store at `path` has a `-wal` or a `-shm` file beside it. */
export const hasWalFiles = (path: string) => existsSync(`${path}-wal`) || existsSync(`${path}-shm`)

/**
 * A raw connection to `path`, kept open for the scope, that reads
 * `PRAGMA data_version`: the value changes between two reads on it when
 * another connection committed a change in between
 * (sqlite.org/pragma.html#pragma_data_version).
 */
export const dataVersionWatch = (path: string) =>
  Effect.map(
    Effect.acquireRelease(
      Effect.sync(() => {
        const db = new Database(path)
        keepWalFiles(db)
        return db
      }),
      (db) =>
        Effect.sync(() => {
          db.close()
        }),
    ),
    (db) =>
      Effect.sync(() => db.query("PRAGMA data_version").get()).pipe(
        Effect.flatMap((row) => Schema.decodeUnknownEffect(DataVersion)(row)),
        Effect.map((row) => row.data_version),
      ),
  )
