// Child fixture: takes the project lock at argv[0] with the production
// `tryLock` (src/runtime/project-lock.ts), writes the ready file at
// argv[1], then holds the lock. With a bound in argv[2] it waits, for at
// most that many milliseconds, for the parent's go file (argv[1] +
// ".go"), which the parent writes only after its own attempt was refused;
// once the go file is there it releases the lock through tryLock's scope,
// writes argv[1] + ".released" and waits, still alive, until it is
// killed. If the go file never comes it writes no released file, so the
// parent's wait for that file fails. Without a bound it holds the lock
// until it is killed. It is an entrypoint, so it runs the Effect with
// Effect.runSync, which the lint permits in this one file
// (eslint.rules.js, `lockChildEntrypoint`).
import { Effect } from "effect"
import { writeFileSync } from "node:fs"
import { tryLock } from "../../../src/runtime/project-lock.ts"
import { awaitGo, blockForever, withArgs } from "./child-args.ts"

/** Holds until the go file comes within `millis` milliseconds, whether it came; or until killed when `millis` is 0. */
const hold = (ready: string, millis: number): boolean => {
  if (millis > 0) return awaitGo(ready, millis)
  blockForever()
  return false
}

/** Takes the lock, signals ready and holds; the scope's end releases it. Whether the go file came. */
const holdLock = (lockPath: string, ready: string, millis: number) =>
  Effect.scoped(
    Effect.andThen(
      tryLock(lockPath),
      Effect.sync(() => {
        writeFileSync(ready, "locked")
        return hold(ready, millis)
      }),
    ),
  )

/** The file written once the child has released the lock. */
const releasedFile = (ready: string) => `${ready}.released`

withArgs((lockPath, ready, millis) => {
  if (Effect.runSync(holdLock(lockPath, ready, millis))) writeFileSync(releasedFile(ready), "released")
  blockForever()
})
