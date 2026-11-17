// Child fixture: takes the project lock at argv[0] the way
// src/runtime/project-lock.ts does (SQLite exclusive locking mode,
// busy_timeout 0, BEGIN EXCLUSIVE), writes the ready file at argv[1],
// then holds the lock until it is killed. It cannot call tryLock itself:
// that returns an Effect, and the lint lets no test file run one.
import { Database } from "bun:sqlite"
import { writeFileSync } from "node:fs"
import { blockForever, withArgs } from "./child-args.ts"

withArgs((lockPath, ready) => {
  const db = new Database(lockPath, { create: true })
  db.exec("PRAGMA busy_timeout=0")
  db.exec("PRAGMA locking_mode=EXCLUSIVE")
  db.exec("BEGIN EXCLUSIVE")
  writeFileSync(ready, "locked")
  blockForever()
})
