// Child fixture: takes the project lock at argv[0] with the production
// `tryLock` (src/runtime/project-lock.ts), writes the ready file at
// argv[1], then holds the lock. With a hold time in argv[2] it releases
// the lock through tryLock's scope after that many milliseconds, writes
// argv[1] + ".released" and waits, still alive, until it is killed;
// without one it holds the lock until it is killed. It is an entrypoint, so it runs
// the Effect with Effect.runSync, which the lint permits in this one file
// (eslint.rules.js, `lockChildEntrypoint`).
import { Effect } from "effect"
import { writeFileSync } from "node:fs"
import { tryLock } from "../../../src/runtime/project-lock.ts"
import { blockFor, blockForever, withArgs } from "./child-args.ts"

/** Holds for `millis` milliseconds, or until killed when it is 0. */
const hold = (millis: number) => {
  if (millis > 0) blockFor(millis)
  else blockForever()
}

/** Takes the lock, signals ready and holds; the scope's end releases it. */
const holdLock = (lockPath: string, ready: string, millis: number) =>
  Effect.scoped(
    Effect.andThen(
      tryLock(lockPath),
      Effect.sync(() => {
        writeFileSync(ready, "locked")
        hold(millis)
      }),
    ),
  )

/** The file written once the child has released the lock. */
const releasedFile = (ready: string) => `${ready}.released`

withArgs((lockPath, ready, millis) => {
  Effect.runSync(holdLock(lockPath, ready, millis))
  writeFileSync(releasedFile(ready), "released")
  blockForever()
})
