// The expiries of the one-attempt waiver rule in a launch command
// (design "Waivers"; review item B15). An admitted attempt expires, in
// batch I, every armed waiver its `Intended` does not name. A refused
// attempt (`CommandRefused`, `QuotaHeld`, `WaiverRefused` or `LostRace`)
// decides with the waivers as it read them, then, still under the lock,
// appends a `WaiverExpired` for every waiver armed at that point. So a
// retry after batch W that launches still uses its waiver; a crash
// writes nothing and expires nothing.
import { Array as Arr, Effect, Option, Schema } from "effect"
import { WaiverExpired } from "../domain/events.ts"
import type { WaiverId } from "../domain/ids.ts"
import type { ArmedWaivers } from "../domain/session-state.ts"
import { foldSession } from "../features/session.ts"
import { unusedWaivers } from "../features/waiver.ts"
import { readLog } from "./command-start.ts"
import type { SessionContext } from "./session-context.ts"
import { CommandRefused, LostRace, QuotaHeld, WaiverRefused } from "./session-errors.ts"

/** Whether a launch command's failure is a refusal, after which the attempt launched nothing. */
const isRefusal = (error: unknown): boolean =>
  Schema.is(CommandRefused)(error) ||
  Schema.is(QuotaHeld)(error) ||
  Schema.is(WaiverRefused)(error) ||
  Schema.is(LostRace)(error)

/** A `WaiverExpired` for every waiver in `armed` but `used`. */
export const expiriesBeside = (armed: ArmedWaivers, used: Option.Option<WaiverId>): ReadonlyArray<WaiverExpired> =>
  Arr.map(unusedWaivers(armed, used), (waiverId) => new WaiverExpired({ waiverId }))

/**
 * Runs `attempt`; when it fails with a refusal, appends a
 * `WaiverExpired` for every waiver armed in the log as it is now, then
 * fails with the refusal. Must run under the project lock. A failed
 * append fails with its own error instead.
 */
export const expiringOnRefusal = <A, E, R>(context: SessionContext, attempt: Effect.Effect<A, E, R>) =>
  Effect.tapError(attempt, (error) => (isRefusal(error) ? expireArmed(context) : Effect.void))

/** Appends a `WaiverExpired` for every armed waiver, if any. */
const expireArmed = (context: SessionContext) =>
  Effect.gen(function* () {
    const read = yield* readLog(context.capabilities.log)
    const expiries = expiriesBeside(foldSession(read.events).armedWaivers, Option.none())
    if (Arr.isReadonlyArrayNonEmpty(expiries)) yield* context.capabilities.log.append(read.position, expiries)
  })
