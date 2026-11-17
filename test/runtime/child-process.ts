// Test helper for cross-process tests: starts a Bun child fixture the
// test owns, waits (bounded) for its ready file, and kills and reaps it
// in a finalizer on every path. It signals only the child it started.
import { spawn, type Subprocess } from "bun"
import { Duration, Effect, Schedule } from "effect"
import { existsSync } from "node:fs"

const readyPoll = Schedule.spaced(Duration.millis(10))
const readyTimeout = Duration.seconds(10)
const exitTimeout = Duration.seconds(10)

/** Waits, bounded, for the child to exit and be reaped. */
export const awaitExit = (child: Subprocess) =>
  Effect.timeout(
    Effect.tryPromise({ try: () => child.exited, catch: () => "child exit failed" as const }),
    exitTimeout,
  )

const killAndReap = (child: Subprocess) =>
  Effect.ignore(
    Effect.andThen(
      Effect.sync(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      }),
      awaitExit(child),
    ),
  )

const waitForFile = (path: string) =>
  Effect.timeout(
    Effect.retry(
      Effect.flatMap(Effect.sync(() => existsSync(path)), (found) =>
        found ? Effect.void : Effect.fail("not ready" as const),
      ),
      readyPoll,
    ),
    readyTimeout,
  )

/**
 * Starts `fixture` (a path relative to test/runtime/fixtures) with the
 * arguments `target`, `ready` and then `rest`, and returns once the child has
 * written its ready file. The child is killed with SIGKILL, if still
 * running, and reaped when the scope ends.
 */
export const startChild = (
  fixture: string,
  target: string,
  ready: string,
  rest: ReadonlyArray<string> = [],
) =>
  Effect.tap(
    Effect.acquireRelease(
      Effect.sync(() =>
        spawn([process.execPath, `${import.meta.dirname}/fixtures/${fixture}`, target, ready, ...rest], {
          stdin: "ignore",
          stdout: "inherit",
          stderr: "inherit",
        }),
      ),
      killAndReap,
    ),
    () => waitForFile(ready),
  )
