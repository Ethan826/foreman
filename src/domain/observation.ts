// A usage reading (design "Pacing" and its definitions table).
// `resetsAt` may be absent (R-P4): the encoded key is optional and decodes
// to an Option, so absence inside the core is Option.none().
//
// Clocks: `observedAt` is the wall clock at observation, kept for display
// only. `observedMono` is the monotonic stamp at observation; a reading
// without one is never fresh. `seq` is the ledger sequence number assigned
// at ingestion. Freshness says how recently foreman observed a reading,
// never when the provider captured it.
import { Record, Schema } from "effect"
import { Client } from "./clients.ts"
import { MonoStamp } from "./clock.ts"
import { LedgerSeq } from "./ids.ts"
import { Window } from "./window.ts"

export const ObservationSources = {
  ClaudeRateLimitEvent: "claudeRateLimitEvent",
  ClaudeStatusline: "claudeStatusline",
  ClaudeUsagePrompt: "claudeUsagePrompt",
  CodexAppServer: "codexAppServer",
} as const

export const ObservationSource = Schema.Literals(Record.values(ObservationSources))
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
  observedMono: Schema.OptionFromOptionalKey(MonoStamp),
  seq: LedgerSeq,
  source: ObservationSource,
})
export type Observation = typeof Observation.Type
