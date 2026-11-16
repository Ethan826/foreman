// Decoders for Claude Code output: the `--output-format json` result object
// and the stream-json events the design uses (design "Research results used
// here" E2, E6, "Operations": classification uses the result subtype, error
// fields and rate-limit events; "Pacing": rate_limit_event, live test L1).
//
// Documented in the design and decision record: the names `type`, result
// `subtype`, `is_error`, `session_id`, `rate_limit_event` with
// `rate_limit_info`, and `system` with subtype `api_retry`.
//
// Optional because undocumented in that evidence (the design says the exact
// shape of rate_limit_event is unknown until live test L1): every field
// except `type` (and `subtype` on api_retry, which identifies the event):
//   result:           subtype, is_error, session_id
//   rate_limit_event: rate_limit_info, session_id
//
// rate_limit_info follows the shape live test L1 observed on 2026-11-16
// (research/live/results-2026-11-16.md): `unifiedWindows` maps a window
// name to `{ utilization, resetsAt, status }`, with utilization a fraction
// from 0 to 1 and resetsAt in Unix seconds. Every field is optional; other
// fields of rate_limit_info (status, resetsAt, rateLimitType, overage
// fields) are kept opaque. `claudeWindowReadings` turns the two windows
// foreman tracks (five_hour, seven_day) into readings, in percent and
// epoch milliseconds. Windows are taken one at a time: an untracked window
// is never examined, and a tracked window that is malformed or has no
// utilization yields no reading without affecting the other.
//   system/api_retry: session_id
// Unknown extra fields are ignored. Any other event type fails to decode;
// the shell decides what an undecodable line means.
import { Array as Arr, Option, pipe, Record, Schema } from "effect"
import { type Window, Windows } from "../domain/window.ts"

// The wire tags of the events decoded here.
export const ClaudeEventTypes = {
  Result: "result",
  RateLimitEvent: "rate_limit_event",
  System: "system",
} as const
export const ClaudeSystemSubtypes = { ApiRetry: "api_retry" } as const

const opaqueObject = Schema.Record(Schema.String, Schema.Unknown)

export const ClaudeResult = Schema.Struct({
  type: Schema.Literal(ClaudeEventTypes.Result),
  subtype: Schema.optionalKey(Schema.String),
  is_error: Schema.optionalKey(Schema.Boolean),
  session_id: Schema.optionalKey(Schema.String),
})
export type ClaudeResult = typeof ClaudeResult.Type

// The wire names of the windows foreman tracks, and the window each is.
const ClaudeWireWindows = {
  FiveHour: "five_hour",
  SevenDay: "seven_day",
} as const
const wireWindow: ReadonlyArray<readonly [string, Window]> = [
  [ClaudeWireWindows.FiveHour, Windows.FiveHour],
  [ClaudeWireWindows.SevenDay, Windows.Weekly],
]

export const ClaudeUnifiedWindow = Schema.Struct({
  utilization: Schema.optionalKey(
    Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  ),
  resetsAt: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
  status: Schema.optionalKey(Schema.String),
})
export type ClaudeUnifiedWindow = typeof ClaudeUnifiedWindow.Type

// unifiedWindows is decoded as an opaque object; each tracked window is
// validated on its own in claudeWindowReadings, so an untracked or
// malformed window never removes another window's reading.
export const ClaudeRateLimitInfo = Schema.StructWithRest(
  Schema.Struct({ unifiedWindows: Schema.optionalKey(opaqueObject) }),
  [opaqueObject],
)
export type ClaudeRateLimitInfo = typeof ClaudeRateLimitInfo.Type

export const ClaudeRateLimitEvent = Schema.Struct({
  type: Schema.Literal(ClaudeEventTypes.RateLimitEvent),
  rate_limit_info: Schema.optionalKey(ClaudeRateLimitInfo),
  session_id: Schema.optionalKey(Schema.String),
})
export type ClaudeRateLimitEvent = typeof ClaudeRateLimitEvent.Type

export const ClaudeApiRetry = Schema.Struct({
  type: Schema.Literal(ClaudeEventTypes.System),
  subtype: Schema.Literal(ClaudeSystemSubtypes.ApiRetry),
  session_id: Schema.optionalKey(Schema.String),
})
export type ClaudeApiRetry = typeof ClaudeApiRetry.Type

export const ClaudeEvent = Schema.Union([
  ClaudeResult,
  ClaudeRateLimitEvent,
  ClaudeApiRetry,
])
export type ClaudeEvent = typeof ClaudeEvent.Type

export const decodeClaudeResult = Schema.decodeUnknownResult(ClaudeResult)
export const decodeClaudeRateLimitEvent =
  Schema.decodeUnknownResult(ClaudeRateLimitEvent)
export const decodeClaudeApiRetry = Schema.decodeUnknownResult(ClaudeApiRetry)
export const decodeClaudeEvent = Schema.decodeUnknownResult(ClaudeEvent)


const decodeUnifiedWindow = Schema.decodeUnknownOption(ClaudeUnifiedWindow)

// One window's reading from a rate_limit_event, before the shell adds the
// observation stamps and the ledger seq.
export interface ClaudeWindowReading {
  readonly window: Window
  readonly usedPercent: number
  readonly resetsAt: Option.Option<number>
}

// Fraction to percent, rounded to a hundredth of a point so that 0.07
// gives 7 rather than 7.000000000000001.
const toPercent = (fraction: number): number =>
  Math.round(fraction * 10_000) / 100

const secondsToMillis = (seconds: number): number => seconds * 1000

// The reading for one tracked window, if the entry is present, valid and
// has a utilization.
const readingFor =
  (windows: Record.ReadonlyRecord<string, unknown>) =>
  ([wire, window]: readonly [string, Window]): Option.Option<ClaudeWindowReading> =>
    Option.gen(function* () {
      const entry = yield* pipe(
        Record.get(windows, wire),
        Option.flatMap(decodeUnifiedWindow),
      )
      const fraction = yield* Option.fromNullishOr(entry.utilization)
      return {
        window,
        usedPercent: toPercent(fraction),
        resetsAt: pipe(
          Option.fromNullishOr(entry.resetsAt),
          Option.map(secondsToMillis),
        ),
      }
    })

export const claudeWindowReadings = (
  event: ClaudeRateLimitEvent,
): ReadonlyArray<ClaudeWindowReading> => {
  const windows = pipe(
    Option.fromNullishOr(event.rate_limit_info),
    Option.flatMap((info) => Option.fromNullishOr(info.unifiedWindows)),
    Option.getOrElse(() => ({})),
  )
  return Arr.getSomes(Arr.map(wireWindow, readingFor(windows)))
}
