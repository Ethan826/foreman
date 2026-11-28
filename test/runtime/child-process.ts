// Test helper for cross-process tests: starts a Bun child fixture the
// test owns, waits (bounded) for its ready file, and kills and reaps it
// in a finalizer on every path. It signals only the child it started.
import { spawn, type Subprocess } from "bun"
import { Duration, Effect, Schedule } from "effect"
import { existsSync, writeFileSync } from "node:fs"
import { goFileOf } from "./fixtures/child-args.ts"

/**
 * The bound on each wait here, in milliseconds: the parent's for the
 * child's ready file and exit, and a child fixture's for the parent's go
 * file, after which it ends its hold on its own.
 */
export const waitBoundMillis = 10_000

const readyPoll = Schedule.spaced(Duration.millis(10))
const readyTimeout = Duration.millis(waitBoundMillis)
const exitTimeout = Duration.millis(waitBoundMillis)

/**
 * Writes the go file of the child whose ready file is `ready`, which lets
 * a fixture that waits for it release what it holds. The parent writes
 * it only after it has seen the hold (test/runtime/fixtures/child-args.ts).
 */
export const letGo = (ready: string) =>
  Effect.sync(() => {
    writeFileSync(goFileOf(ready), "")
  })

/**
 * The time budget, in milliseconds, of every test that starts a fixture
 * with {@link startChild} (dogfood-6e, owner ruling of 2026-11-27), save
 * status-read-only's "answers while another process holds the ledger's
 * write lock", whose own speed claim the owner keeps apart. These tests
 * claim nothing about speed; a Bun child's start under a load average of
 * 75 to 200 can take seconds. Since dogfood-6f (finding F1) the ledger
 * test no longer starts a child, so the tests it covers are project-lock's
 * two cross-process tests.
 *
 * What it bounds, counted from the code: the longest test of this kind,
 * project-lock's "refuses while a child holds it and is acquired after
 * the child releases it, the child still running", starts one Bun child
 * and no git and no `ps`. The test waits, each wait bounded at
 * {@link waitBoundMillis}, for the child's ready file and then for its
 * released file (the child waits at most as long for the go file, inside
 * the second wait), and its scope's end kills the child and waits as long
 * again for its exit, so its bounded waits come to at most 30 s. Idle
 * duration: awaiting the coordinator's measurement on the dogfood-6f
 * snapshot; the earlier measurements predate the go-file handshake
 * (dogfood-6e, finding F3) and no longer hold.
 */
export const childMillis = 30_000

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

/**
 * Waits, polling and bounded by the ready timeout, until a child has
 * written the file at `path`.
 */
export const waitForFile = (path: string) =>
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
