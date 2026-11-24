// A usage reading (design "Pacing" and its definitions table).
import { Record, Schema } from "effect"
import { Client } from "./clients.ts"
import { MonoStamp } from "./clock.ts"
import { LedgerSeq } from "./ids.ts"
import { Window } from "./window.ts"

/** Where a reading came from. */
export const ObservationSources = {
  ClaudeRateLimitEvent: "claudeRateLimitEvent",
  ClaudeStatusline: "claudeStatusline",
  ClaudeUsagePrompt: "claudeUsagePrompt",
  CodexAppServer: "codexAppServer",
} as const

/** Schema for a reading source, one of {@link ObservationSources}. */
export const ObservationSource = Schema.Literals(Record.values(ObservationSources))
/** A reading source, one of the values of {@link ObservationSources}. */
export type ObservationSource = typeof ObservationSource.Type

const epochMillis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** A whole window in percent: the top of every percent range. */
export const wholeWindowPercent = 100

/**
 * One usage reading of a provider window.
 *
 * - `usedPercent`: the provider's reported use, 0 to 100 percent.
 * - `resetsAt`: the window's reset time in epoch milliseconds. It may be
 *   absent (R-P4); the encoded key is optional and decodes to
 *   `Option.none()`.
 * - `observedAt`: the wall clock at observation, in epoch milliseconds,
 *   kept for display only.
 * - `observedMono`: the monotonic stamp at observation. A reading without
 *   one is never fresh.
 * - `seq`: the ledger sequence number assigned at ingestion.
 *
 * Freshness says how recently tarlatan observed a reading, never when the
 * provider captured it.
 */
export const Observation = Schema.Struct({
  provider: Client,
  window: Window,
  usedPercent: Schema.Number.check(
    Schema.isBetween({ minimum: 0, maximum: wholeWindowPercent }),
  ),
  resetsAt: Schema.OptionFromOptionalKey(epochMillis),
  observedAt: epochMillis,
  observedMono: Schema.OptionFromOptionalKey(MonoStamp),
  seq: LedgerSeq,
  source: ObservationSource,
})
/** One usage reading; see {@link Observation}. */
export type Observation = typeof Observation.Type
