// Child fixture: takes the write lock of the ledger at argv[0] with
// BEGIN IMMEDIATE, writes the ready file at argv[1], holds the lock for
// argv[2] milliseconds, then rolls back and exits.
import { Database } from "bun:sqlite"
import { writeFileSync } from "node:fs"
import { blockFor, withArgs } from "./child-args.ts"

withArgs((path, ready, holdMillis) => {
  const db = new Database(path)
  db.exec("BEGIN IMMEDIATE")
  writeFileSync(ready, "locked")
  blockFor(holdMillis)
  db.exec("ROLLBACK")
  db.close()
})
