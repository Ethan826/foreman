// What a read-only command may not change (review item B11; owner ruling
// of 2026-11-20 in the assisted-cycle plan, "Correction re-review"):
// "status writes nothing" means no application state, database or WAL
// change. SQLite's own shared-memory coordination file (`-shm`) may
// change, since every WAL reader records its read mark there
// (sqlite.org/wal.html). These helpers compare everything else byte for
// byte and name that one exception.
import { Array as Arr } from "effect"
import { readdirSync, readFileSync, statSync } from "node:fs"

/** The one exception the owner's B11 ruling allows: SQLite's `-shm` coordination file. */
export const sqliteCoordinationSuffix = "-shm"

/**
 * Every entry below `dir`, depth first, with its modification time and
 * each file's bytes; a file ending in {@link sqliteCoordinationSuffix} is
 * listed by name only, per the owner's B11 ruling.
 */
export const treeOf = (dir: string): ReadonlyArray<unknown> =>
  Arr.flatMap(readdirSync(dir).sort(), (name) => {
    const path = `${dir}/${name}`
    if (name.endsWith(sqliteCoordinationSuffix)) return [{ path }]
    const entry = statSync(path, { bigint: false })
    if (entry.isDirectory()) return [{ path, mtime: entry.mtimeMs }, ...treeOf(path)]
    return [{ path, mtime: entry.mtimeMs, bytes: Array.from(readFileSync(path)) }]
  })
