// An incomplete attempt made through the production CLI, as the owner
// meets one (owner ruling on L01, 2026-11-20): `implement` starts a fake
// Claude that sleeps, and foreman is interrupted once the launch is
// recorded. The fake ends on its own; foreman never signals.
import { Duration, Effect, Fiber, Schedule, Schema } from "effect"
import { existsSync } from "node:fs"
import { cli, type Layout, openedSession, recorded } from "./production-harness.ts"

/** How long the fake implementer sleeps before it answers, in seconds. */
const implementerSeconds = 3

/** The bound on every wait here, in seconds. */
const waitBoundSeconds = 15

/** The poll interval of the bounded waits, in milliseconds. */
const pollMillis = 50

/** How long to wait after the launch is seen, so batch L is recorded, in milliseconds. */
const settleMillis = 500

/** Fails until `check` holds; retried every poll interval, bounded. */
export const eventually = (check: () => boolean) =>
  Effect.timeout(
    Effect.retry(
      Effect.suspend(() => (check() ? Effect.void : Effect.fail("not yet" as const))),
      Schedule.spaced(Duration.millis(pollMillis)),
    ),
    Duration.seconds(waitBoundSeconds),
  )

/** The one incomplete attempt `status` shows: its operation and grant. */
const Incomplete = Schema.Struct({
  report: Schema.Struct({ incomplete: Schema.Tuple([Schema.Struct({ opId: Schema.String, grantId: Schema.String })]) }),
})

/**
 * Opens a session and starts `implement` with a fake Claude that sleeps,
 * then interrupts foreman once the launch is recorded. Returns the
 * incomplete attempt `status` shows.
 */
export const interruptedAttempt = (layout: Layout) =>
  Effect.gen(function* () {
    yield* openedSession(layout)
    const env = { FAKE_EDIT: `sleep ${String(implementerSeconds)}; echo done > ${layout.record}/implementer-done` }
    const command = yield* Effect.forkChild(cli(layout, ["implement", "--waive"], { env }))
    yield* eventually(() => recorded(layout, "claude-launches") !== undefined)
    yield* Effect.sleep(Duration.millis(settleMillis))
    yield* Fiber.interrupt(command)
    const shown = yield* cli(layout, ["status"])
    const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Incomplete))(shown.out.join("\n"))
    return decoded.report.incomplete[0]
  })

/** Waits until the sleeping fake implementer has ended on its own. */
export const implementerEnded = (layout: Layout) =>
  eventually(() => existsSync(`${layout.record}/implementer-done`))
