// A usage reading (design "Pacing": `{provider, window, usedPercent,
// resetsAt, observedAt, source}`). `resetsAt` may be absent (R-P4): the
// encoded key is optional and decodes to an Option, so absence inside the
// core is Option.none().
// Times are epoch milliseconds on the supervisor's local clock.
//
// The design also lists `ingestedSeq`; it matters to quota-hold release
// (a runtime and event-log concern), not to pace, so it is left out here.
// TODO(design "Pacing", "Clock basis"): add it with the event log.
import { Schema } from "effect"
import { Client } from "./roles.ts"
import { Window } from "./window.ts"

export const ObservationSource = Schema.Literals([
  "claudeRateLimitEvent",
  "claudeStatusline",
  "claudeUsagePrompt",
  "codexAppServer",
])
export type ObservationSource = typeof ObservationSource.Type

const epochMillis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const Observation = Schema.Struct({
  provider: Client,
  window: Window,
  usedPercent: Schema.Number.check(
    Schema.isBetween({ minimum: 0, maximum: 100 }),
  ),
  resetsAt: Schema.OptionFromOptionalKey(epochMillis),
  observedAt: epochMillis,
  source: ObservationSource,
})
export type Observation = typeof Observation.Type
