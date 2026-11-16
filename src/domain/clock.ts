// Monotonic time (design "Pacing", definitions table; admission contract,
// "Clock acquisition"). Freshness and post-hold tests compare monotonic
// stamps from one boot; the wall clock decides only `now >= resetsAt`.
// How a process reads the clock is an open owner decision (O11); this
// module only names the value.
import { Schema } from "effect"

/**
 * Identifies one boot of the machine. Monotonic stamps are comparable only
 * when their boot ids are equal. Never empty.
 */
export const BootId = Schema.String.check(Schema.isNonEmpty()).pipe(
  Schema.brand("BootId"),
)
/** Identifies one boot of the machine; see {@link BootId}. */
export type BootId = typeof BootId.Type

/**
 * A reading of the monotonic clock: the boot it was taken in and
 * CLOCK_MONOTONIC in whole microseconds (a non-negative integer).
 *
 * Microseconds keep years of uptime inside JavaScript's exact integer
 * range; nanoseconds would pass 2^53 after about 104 days. Two stamps from
 * different boots are not ordered.
 */
export const MonoStamp = Schema.Struct({
  bootId: BootId,
  micros: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
/** A monotonic clock reading; see {@link MonoStamp}. */
export type MonoStamp = typeof MonoStamp.Type
