// Monotonic time (design "Pacing", definitions table; admission contract,
// "Clock acquisition"). Freshness and post-hold tests compare monotonic
// stamps from one boot; the wall clock decides only `now >= resetsAt`.
//
// `micros` is CLOCK_MONOTONIC in whole microseconds, which keeps years of
// uptime inside JavaScript's exact integer range (nanoseconds overflow
// 2^53 after about 104 days). How a process reads the clock is an open
// owner decision (O11); this module only names the value.
import { Schema } from "effect"

export const BootId = Schema.String.check(Schema.isNonEmpty()).pipe(
  Schema.brand("BootId"),
)
export type BootId = typeof BootId.Type

export const MonoStamp = Schema.Struct({
  bootId: BootId,
  micros: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type MonoStamp = typeof MonoStamp.Type
