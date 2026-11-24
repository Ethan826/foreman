// The project lock across processes (review finding F2): a child Bun
// process holds the lock, this process is refused at once, and once the
// test kills the child with SIGKILL the operating system drops its lock
// and this process acquires it. The child runs the production tryLock, so
// a second test also checks its release: once the child has ended
// tryLock's scope, and while it is still running, this process acquires.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { LockHeld } from "../../src/domain/events.ts"
import { tryLock } from "../../src/runtime/project-lock.ts"
import { awaitExit, startChild, waitForFile } from "./child-process.ts"

const withDir = <A, E>(use: (dir: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(`${tmpdir()}/tarlatan-lock-`)),
    use,
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

const refusedThenAcquiredAfterKill = (dir: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const lockPath = `${dir}/project.lock`
      const child = yield* startChild("hold-lock.ts", lockPath, `${dir}/ready`)
      const refused = yield* Effect.exit(Effect.scoped(tryLock(lockPath)))
      expect(refused).toEqual(Exit.fail(new LockHeld({ path: lockPath })))
      child.kill("SIGKILL")
      yield* awaitExit(child)
      expect(child.signalCode).toBe("SIGKILL")
      yield* Effect.scoped(tryLock(lockPath))
    }),
  )

const refusedThenAcquiredAfterRelease = (dir: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const lockPath = `${dir}/project.lock`
      const child = yield* startChild("hold-lock.ts", lockPath, `${dir}/ready`, ["300"])
      const refused = yield* Effect.exit(Effect.scoped(tryLock(lockPath)))
      expect(refused).toEqual(Exit.fail(new LockHeld({ path: lockPath })))
      yield* waitForFile(`${dir}/ready.released`)
      expect(child.exitCode).toBeNull()
      yield* Effect.scoped(tryLock(lockPath))
    }),
  )

describe("project lock across processes", () => {
  it.live("refuses while a child holds it and is acquired after the child is killed", () =>
    withDir(refusedThenAcquiredAfterKill),
  )

  it.live("refuses while a child holds it and is acquired after the child releases it, the child still running", () =>
    withDir(refusedThenAcquiredAfterRelease),
  )
})
