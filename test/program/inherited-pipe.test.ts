// A descendant that keeps the client's stdout open after the leader
// exits (limit L01; owner ruling of 2026-11-20). Tarlatan keeps waiting
// for the pipes to close and never signals, so the command does not
// return while the descendant lives. The owner's way out is to interrupt
// tarlatan: the attempt is left incomplete, `status` shows it, and
// `step-ended` and `session close --interrupted` close it. A real `sh`
// leader starts a background `sh` that inherits stdout, then exits.
//
// The order holds by construction (dogfood-6e, owner ruling 4 of
// 2026-11-27): the descendant sets its deadline, writes its pid to a
// started marker, then waits, sleeping between checks, for a release file that the test
// creates only after its watch. Before it watches, the test sees, in one
// listing that `ps` gave and that decoded, the leader gone and the
// descendant in the leader's process group, so no clock decides whether
// the command is still waiting. The descendant ends on its own after
// `waitBoundSeconds` if never released, accepts a release only when a
// clock read taken after it saw the release file is still before that
// deadline, so expiry wins once it has passed, and
// writes in its done marker, at the moment its wait ends, whether the
// release or the expiry ended it; both tests require the release.
import { describe, expect, it } from "@effect/vitest"
import {
  Array as Arr,
  Duration,
  Effect,
  Exit,
  Fiber,
  Number as Num,
  Option,
  Schedule,
  Schema,
  String as Str,
} from "effect"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { SessionClosed } from "../../src/domain/events.ts"
import type { ProcessRow } from "../../src/domain/process.ts"
import { CloseKinds } from "../../src/domain/session.ts"
import { decodePs } from "../../src/format/ps.ts"
import { implement } from "../../src/program/implement.ts"
import type { SessionContext } from "../../src/program/session-context.ts"
import { closeSession, stepEnded } from "../../src/program/session.ts"
import { status } from "../../src/program/status.ts"
import { readProcesses } from "../../src/runtime/processes.ts"
import type { RunningClient } from "../../src/runtime/spawn.ts"
import { clientStartMillis, startRealClient } from "../runtime/client-start.ts"
import { eventsOf, type Harness, withHarness } from "./session-harness.ts"
import { firstIntent, opened } from "./session-steps.ts"

/** How long the command is watched after the leader exited, to see that it still waits, in milliseconds. */
const watchMillis = 400

/**
 * The bound on every wait in these tests, in seconds, and so the longest
 * the descendant waits for its release before it ends on its own.
 */
const waitBoundSeconds = 15

/** The poll interval of the bounded waits and of the descendant's checks for its release file, in milliseconds. */
const pollMillis = 100

/** Milliseconds in a second, for the descendant's `sleep`, which takes seconds. */
const millisPerSecond = 1_000

/** What the descendant writes in its done marker when the release file let it end. */
const releasedText = "released"

/** What the descendant writes in its done marker when it ended on its own, never released. */
const expiredText = "expired"

/** The descendant's script, next to the markers in the harness directory. */
const descendantPathOf = (harness: Harness) => `${harness.dir}/descendant.sh`

/** The descendant's pid, which it writes as it starts. */
const startedPathOf = (harness: Harness) => `${harness.dir}/descendant-started`

/** The file whose existence lets the descendant end. */
const releasePathOf = (harness: Harness) => `${harness.dir}/descendant-release`

/** Whether the descendant was released or expired, which it writes just before it ends. */
const donePathOf = (harness: Harness) => `${harness.dir}/descendant-done`

/** The done marker's text as it is written, renamed into place whole. */
const doneDraftPathOf = (harness: Harness) => `${harness.dir}/descendant-done.draft`

/** The descendant's lines that record `text` as what ended its wait, in the done marker, whole, and end it. */
const endsWith = (harness: Harness, text: string) =>
  `    echo ${text} > "${doneDraftPathOf(harness)}"; mv "${doneDraftPathOf(harness)}" "${donePathOf(harness)}"; exit 0`

/**
 * The descendant: reads the clock and sets its deadline `waitBoundSeconds`
 * ahead, and only then writes its pid, so the deadline cannot start later
 * than the test learns of it (dogfood-6e, correction 2, finding F2). Then,
 * keeping the inherited stdout open and never writing to it, it checks
 * every poll interval, sleeping in between, for the release file and then
 * whether the deadline has passed. It accepts the release only if a fresh
 * clock read, taken after it has seen the release file, is still before
 * the deadline; otherwise it records the expiry (dogfood-6f, finding F2).
 * So a release file written after the deadline never counts, even when
 * the shell was descheduled between any two of its checks. The check that
 * ends the wait writes its condition, `expired` or `released`, to the done
 * marker at that moment.
 * Every `date`, `sleep` and `mv` it starts ends before the next step, so
 * nothing it starts outlives it.
 */
const descendantScript = (harness: Harness) =>
  Arr.join(
    [
      `end=$(( $(date +%s) + ${String(waitBoundSeconds)} ))`,
      `echo $$ > "${startedPathOf(harness)}"`,
      "while :; do",
      `  if [ -e "${releasePathOf(harness)}" ]; then`,
      `    if [ "$(date +%s)" -lt "$end" ]; then`,
      `  ${endsWith(harness, releasedText)}`,
      "    fi",
      endsWith(harness, expiredText),
      "  fi",
      `  if [ "$(date +%s)" -ge "$end" ]; then`,
      endsWith(harness, expiredText),
      "  fi",
      `  sleep ${String(pollMillis / millisPerSecond)}`,
      "done",
      "",
    ],
    "\n",
  )

/**
 * The leader's script: start the descendant in the background, where it
 * inherits stdout, then exit at once. The leader's exit does not close
 * the pipe, because the descendant still holds it.
 */
const leaderScript = (harness: Harness) => `/bin/sh "${descendantPathOf(harness)}" & exit 0`

/** The real starter, running the leader script in place of the client's argv, keeping each client it starts. */
const realLeader = (harness: Harness, started: Array<RunningClient>): SessionContext => ({
  ...harness.context,
  capabilities: {
    ...harness.context.capabilities,
    startClient: (launch) =>
      Effect.tap(
        startRealClient({
          ...launch,
          argv: ["/bin/sh", "-c", leaderScript(harness)],
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

/**
 * Fails until `read` succeeds with a value, which it returns; a failed
 * `read` is retried as a missing value is, every poll interval, bounded.
 */
const eventuallySome = <A, E>(read: Effect.Effect<Option.Option<A>, E>) =>
  Effect.timeout(
    Effect.retry(
      Effect.flatMap(read, (found) => Effect.fromOption(found)),
      Schedule.spaced(Duration.millis(pollMillis)),
    ),
    Duration.seconds(waitBoundSeconds),
  )

/** One process listing, decoded; fails when `ps` fails or its output does not decode. */
const readListing = () => Effect.flatMap(readProcesses(), (text) => Effect.fromResult(decodePs(text)))

/** The process group of `pid` in a decoded listing; none when the listing does not show it. */
const groupIn = (rows: ReadonlyArray<ProcessRow>, pid: number) =>
  Option.map(Arr.findFirst(rows, (row) => row.pid === pid), (row) => row.pgid)

/**
 * A listing that `ps` gave and that decoded, once it no longer shows
 * `pid`, the leader. A failed or undecodable listing is never taken as
 * the leader gone: it is retried.
 */
const leaderGoneListing = (pid: number) =>
  eventuallySome(Effect.map(readListing(), (rows) => (Option.isNone(groupIn(rows, pid)) ? Option.some(rows) : Option.none())))

/** The pid the descendant wrote to its started marker, once it is there and whole. */
const descendantPid = (harness: Harness) =>
  Effect.sync(() =>
    existsSync(startedPathOf(harness))
      ? Option.filter(Num.parse(Str.trim(readFileSync(startedPathOf(harness), "utf8"))), (pid) => pid > 0)
      : Option.none<number>(),
  )

/** Lets the descendant end; harmless when it already ended. */
const release = (harness: Harness) =>
  Effect.sync(() => {
    writeFileSync(releasePathOf(harness), "")
  })

/** Runs `use` over `harness`, releasing the descendant afterwards however `use` ends. */
const releasingAfter = (use: (harness: Harness) => Effect.Effect<void, unknown>) => (harness: Harness) =>
  Effect.ensuring(use(harness), release(harness))

/**
 * Starts `implement` with the real leader, and returns once the leader has
 * exited while the descendant, in the leader's process group, is still
 * listed and unreleased, and the command has been watched for
 * `watchMillis`.
 */
const leaderExited = (harness: Harness) =>
  Effect.gen(function* () {
    writeFileSync(descendantPathOf(harness), descendantScript(harness))
    yield* opened(harness)
    const started: Array<RunningClient> = []
    const command = yield* Effect.forkChild(implement(realLeader(harness, started), { waive: true }))
    yield* eventually(Effect.sync(() => Arr.isReadonlyArrayNonEmpty(started) || command.pollUnsafe() !== undefined))
    if (command.pollUnsafe() !== undefined) yield* Effect.die(command.pollUnsafe())
    const running = yield* Effect.fromOption(Arr.head(started))
    const descendant = yield* eventuallySome(descendantPid(harness))
    const withoutLeader = yield* leaderGoneListing(running.pid)
    expect(groupIn(withoutLeader, descendant)).toEqual(Option.some(running.pgid))
    expect(existsSync(releasePathOf(harness))).toBe(false)
    expect(existsSync(donePathOf(harness))).toBe(false)
    yield* Effect.sleep(Duration.millis(watchMillis))
    expect(groupIn(yield* readListing(), descendant)).toEqual(Option.some(running.pgid))
    return { command, running }
  })

/** Whether `fiber` has not finished yet. */
const stillRunning = (fiber: Fiber.Fiber<unknown, unknown>) =>
  Effect.sync(() => Option.isNone(Option.fromNullishOr(fiber.pollUnsafe())))

/** Whether the descendant has written its done marker, which it does just before it ends. */
const descendantDone = (harness: Harness) => Effect.sync(() => existsSync(donePathOf(harness)))

/** What the descendant wrote in its done marker. */
const doneText = (harness: Harness) => Effect.sync(() => Str.trim(readFileSync(donePathOf(harness), "utf8")))

const commandWaits = (harness: Harness) =>
  Effect.gen(function* () {
    const { command } = yield* leaderExited(harness)
    expect(yield* descendantDone(harness)).toBe(false)
    expect(yield* stillRunning(command)).toBe(true)
    expect(yield* stillRunning(command)).toBe(true)
    yield* release(harness)
    const exit = yield* Effect.timeout(Fiber.await(command), Duration.seconds(waitBoundSeconds))
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(yield* descendantDone(harness)).toBe(true)
    expect(yield* doneText(harness)).toBe(releasedText)
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
    expect(yield* descendantDone(harness)).toBe(false)
    yield* release(harness)
    yield* Effect.timeout(Effect.exit(running.exit), Duration.seconds(waitBoundSeconds))
    expect(yield* descendantDone(harness)).toBe(true)
    expect(yield* doneText(harness)).toBe(releasedText)
  })

describe("a descendant holding the client's inherited stdout", () => {
  it.live("keeps the command waiting after the leader exits, until the descendant ends", () =>
    withHarness({}, releasingAfter(commandWaits)), clientStartMillis,
  )
  it.live("leaves an incomplete attempt that status, step-ended and close --interrupted handle when tarlatan is interrupted", () =>
    withHarness({}, releasingAfter(interruptLeavesIncomplete)), clientStartMillis,
  )
})
