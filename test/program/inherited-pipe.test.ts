// A descendant that keeps the client's stdout open after the leader
// exits (limit L01; owner ruling of 2026-11-20). Tarlatan keeps waiting
// for the pipes to close and never signals, so the command does not
// return while the descendant lives. The owner's way out is to interrupt
// tarlatan: the attempt is left incomplete, `status` shows it, and
// `step-ended` and `session close --interrupted` close it. A real `sh`
// leader starts a background `sh` that inherits stdout, then exits; the
// descendant ends on its own, and each test waits for it.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Duration, Effect, Exit, Fiber, Option, Result, Schedule, Schema } from "effect"
import { existsSync } from "node:fs"
import { SessionClosed } from "../../src/domain/events.ts"
import { CloseKinds } from "../../src/domain/session.ts"
import { decodePs } from "../../src/format/ps.ts"
import { startTimeOf } from "../../src/format/ps.ts"
import { implement } from "../../src/program/implement.ts"
import type { SessionContext } from "../../src/program/session-context.ts"
import { closeSession, stepEnded } from "../../src/program/session.ts"
import { status } from "../../src/program/status.ts"
import { readProcesses } from "../../src/runtime/processes.ts"
import { type RunningClient, startClientWith } from "../../src/runtime/spawn.ts"
import { eventsOf, type Harness, withHarness } from "./session-harness.ts"
import { firstIntent, opened } from "./session-steps.ts"

/** How long the descendant keeps stdout open after the leader exits, in seconds. */
const descendantSeconds = 2

/** How long the command is watched after the leader exited, to see that it still waits, in milliseconds. */
const watchMillis = 400

/** The bound on every wait in these tests, in seconds. */
const waitBoundSeconds = 15

/** The test timeout, in milliseconds: above every bounded wait. */
const testTimeoutMillis = 30_000

/** The poll interval of the bounded waits, in milliseconds. */
const pollMillis = 25

/**
 * The leader's script: start a descendant that inherits stdout, sleeps and
 * writes `done`, then exit at once. The leader's exit does not close the
 * pipe, because the descendant still holds it.
 */
const leaderScript = (dir: string) =>
  `(sleep ${String(descendantSeconds)}; echo done > ${dir}/descendant-done) & exit 0`

/** The real starter, running the leader script in place of the client's argv, keeping each client it starts. */
const realLeader = (harness: Harness, started: Array<RunningClient>): SessionContext => ({
  ...harness.context,
  capabilities: {
    ...harness.context.capabilities,
    startClient: (launch) =>
      Effect.tap(
        startClientWith(readProcesses, startTimeOf)({
          ...launch,
          argv: ["/bin/sh", "-c", leaderScript(harness.dir)],
          cwd: harness.dir,
          env: { PATH: "/bin:/usr/bin" },
        }),
        (running) => Effect.sync(() => started.push(running)),
      ),
  },
})

/** Fails until `check` holds; retried every poll interval, bounded. */
const eventually = (check: Effect.Effect<boolean>) =>
  Effect.timeout(
    Effect.retry(
      Effect.flatMap(check, (holds) => (holds ? Effect.void : Effect.fail("not yet" as const))),
      Schedule.spaced(Duration.millis(pollMillis)),
    ),
    Duration.seconds(waitBoundSeconds),
  )

/** Whether the process listing no longer shows `pid`, the leader. */
const leaderGone = (pid: number) =>
  Effect.map(Effect.result(readProcesses()), (listing) =>
    Result.match(Result.flatMap(listing, decodePs), {
      onFailure: () => false,
      onSuccess: (rows) => !Arr.some(rows, (row) => row.pid === pid),
    }),
  )

/** Starts `implement` with the real leader, and waits until the leader has exited. */
const leaderExited = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    const started: Array<RunningClient> = []
    const command = yield* Effect.forkChild(implement(realLeader(harness, started), { waive: true }))
    yield* eventually(Effect.sync(() => Arr.isReadonlyArrayNonEmpty(started) || command.pollUnsafe() !== undefined))
    if (command.pollUnsafe() !== undefined) yield* Effect.die(command.pollUnsafe())
    const running = yield* Effect.fromOption(Arr.head(started))
    yield* eventually(leaderGone(running.pid))
    yield* Effect.sleep(Duration.millis(watchMillis))
    return { command, running }
  })

/** Whether `fiber` has not finished yet. */
const stillRunning = (fiber: Fiber.Fiber<unknown, unknown>) =>
  Effect.sync(() => Option.isNone(Option.fromNullishOr(fiber.pollUnsafe())))

/** Whether the descendant has written its marker, which it does just before it ends. */
const descendantDone = (harness: Harness) => Effect.sync(() => existsSync(`${harness.dir}/descendant-done`))

const commandWaits = (harness: Harness) =>
  Effect.gen(function* () {
    const { command } = yield* leaderExited(harness)
    expect(yield* descendantDone(harness)).toBe(false)
    expect(yield* stillRunning(command)).toBe(true)
    expect(yield* stillRunning(command)).toBe(true)
    const exit = yield* Effect.timeout(Fiber.await(command), Duration.seconds(waitBoundSeconds))
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(yield* descendantDone(harness)).toBe(true)
  })

const interruptLeavesIncomplete = (harness: Harness) =>
  Effect.gen(function* () {
    const { command, running } = yield* leaderExited(harness)
    expect(yield* stillRunning(command)).toBe(true)
    yield* Effect.timeout(Fiber.interrupt(command), Duration.seconds(waitBoundSeconds))
    const intent = yield* firstIntent(harness)
    const report = yield* status(harness.status)
    expect(report.state).toMatchObject({ _tag: "AttemptIncomplete" })
    expect(report.incomplete).toEqual([{ opId: intent.opId, grantId: intent.grantId }])
    expect(report.launches).toMatchObject([{ opId: intent.opId, finished: false, launched: { _tag: "Some" } }])
    yield* stepEnded(harness.context, { opId: intent.opId, grantId: intent.grantId })
    yield* closeSession(harness.context, { how: CloseKinds.Interrupted, note: "a descendant held the pipe" })
    expect(Arr.filter(yield* eventsOf(harness), Schema.is(SessionClosed))).toMatchObject([
      { how: CloseKinds.Interrupted },
    ])
    yield* Effect.timeout(Effect.exit(running.exit), Duration.seconds(waitBoundSeconds))
    expect(yield* descendantDone(harness)).toBe(true)
  })

describe("a descendant holding the client's inherited stdout", () => {
  it.live("keeps the command waiting after the leader exits, until the descendant ends", () =>
    withHarness({}, commandWaits), testTimeoutMillis,
  )
  it.live("leaves an incomplete attempt that status, step-ended and close --interrupted handle when tarlatan is interrupted", () =>
    withHarness({}, interruptLeavesIncomplete), testTimeoutMillis,
  )
})
