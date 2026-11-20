// Decoders for Claude Code output: the `--output-format json` result object
// and the stream-json events the design uses (design "Research results used
// here" E2, E6, "Operations": classification uses the result subtype, error
// fields and rate-limit events; "Pacing": rate_limit_event, live test L1).
//
// Documented in the design and decision record: the names `type`, result
// `subtype`, `is_error`, `session_id`, `rate_limit_event` with
// `rate_limit_info`, and `system` with subtype `api_retry`. Every other
// field is optional because that evidence does not document it (the
// design says the exact shape of rate_limit_event is unknown until live
// test L1). Unknown extra fields are ignored. Any other event type fails
// to decode; the shell decides what an undecodable line means.
import { Array as Arr, Duration, Option, pipe, Record, Schema } from "effect"
import { type Window, Windows } from "../domain/window.ts"
import { streamLineWith } from "./stream-line.ts"

/** The wire tags of the Claude events decoded here. */
export const ClaudeEventTypes = {
  Result: "result",
  RateLimitEvent: "rate_limit_event",
  System: "system",
} as const
/** The `system` event subtypes decoded here: only `api_retry`. */
export const ClaudeSystemSubtypes = { ApiRetry: "api_retry" } as const

const opaqueObject = Schema.Record(Schema.String, Schema.Unknown)

/**
 * The final `result` object. `subtype`, `is_error`, `session_id` and
 * `result`, the run's final message, are optional. The stream live test
 * L1 kept (research/live/l1-2026-11-16) has no `result` field, so its
 * name is unverified until a live run records it; a run without it gives
 * an empty handoff.
 */
export const ClaudeResult = Schema.Struct({
  type: Schema.Literal(ClaudeEventTypes.Result),
  subtype: Schema.optionalKey(Schema.String),
  is_error: Schema.optionalKey(Schema.Boolean),
  session_id: Schema.optionalKey(Schema.String),
  result: Schema.optionalKey(Schema.String),
})
/** A decoded `result` object; see {@link ClaudeResult}. */
export type ClaudeResult = typeof ClaudeResult.Type

/**
 * The final message of a `result` object, which an implementer's or
 * corrector's handoff file holds (plan "Events", `ReportRecorded`);
 * none when the object has no `result` field.
 */
export const resultText = (result: ClaudeResult): Option.Option<string> =>
  Option.fromNullishOr(result.result)

// The wire names of the windows foreman tracks, and the window each is.
const ClaudeWireWindows = {
  FiveHour: "five_hour",
  SevenDay: "seven_day",
} as const
const wireWindow: ReadonlyArray<readonly [string, Window]> = [
  [ClaudeWireWindows.FiveHour, Windows.FiveHour],
  [ClaudeWireWindows.SevenDay, Windows.Weekly],
]

/**
 * One entry of `rate_limit_info.unifiedWindows`, in the shape live test L1
 * observed on 2026-11-16 (research/live/results-2026-11-16.md):
 * `utilization` is a fraction from 0 to 1 and `resetsAt` is in Unix
 * seconds. Every field is optional.
 */
export const ClaudeUnifiedWindow = Schema.Struct({
  utilization: Schema.optionalKey(
    Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  ),
  resetsAt: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
  status: Schema.optionalKey(Schema.String),
})
/** One unified window entry; see {@link ClaudeUnifiedWindow}. */
export type ClaudeUnifiedWindow = typeof ClaudeUnifiedWindow.Type

/**
 * The `rate_limit_info` object. `unifiedWindows`, which maps a window name
 * to a {@link ClaudeUnifiedWindow}, is optional and decoded as an opaque
 * object; each tracked window is validated on its own in
 * {@link claudeWindowReadings}, so an untracked or malformed window never
 * removes another window's reading. Other fields (status, resetsAt,
 * rateLimitType, overage fields) are kept opaque.
 */
export const ClaudeRateLimitInfo = Schema.StructWithRest(
  Schema.Struct({ unifiedWindows: Schema.optionalKey(opaqueObject) }),
  [opaqueObject],
)
/** A decoded `rate_limit_info`; see {@link ClaudeRateLimitInfo}. */
export type ClaudeRateLimitInfo = typeof ClaudeRateLimitInfo.Type

/** A `rate_limit_event`. `rate_limit_info` and `session_id` are optional. */
export const ClaudeRateLimitEvent = Schema.Struct({
  type: Schema.Literal(ClaudeEventTypes.RateLimitEvent),
  rate_limit_info: Schema.optionalKey(ClaudeRateLimitInfo),
  session_id: Schema.optionalKey(Schema.String),
})
/** A decoded `rate_limit_event`; see {@link ClaudeRateLimitEvent}. */
export type ClaudeRateLimitEvent = typeof ClaudeRateLimitEvent.Type

/**
 * A `system` event with subtype `api_retry`; the subtype is required
 * because it identifies the event. `session_id` is optional.
 */
export const ClaudeApiRetry = Schema.Struct({
  type: Schema.Literal(ClaudeEventTypes.System),
  subtype: Schema.Literal(ClaudeSystemSubtypes.ApiRetry),
  session_id: Schema.optionalKey(Schema.String),
})
/** A decoded `api_retry` event; see {@link ClaudeApiRetry}. */
export type ClaudeApiRetry = typeof ClaudeApiRetry.Type

/** Any Claude event decoded here: a result, a rate-limit event or an api_retry. */
export const ClaudeEvent = Schema.Union([
  ClaudeResult,
  ClaudeRateLimitEvent,
  ClaudeApiRetry,
])
/** Any decoded Claude event; see {@link ClaudeEvent}. */
export type ClaudeEvent = typeof ClaudeEvent.Type

/** Decodes an unknown value as a {@link ClaudeResult}. */
export const decodeClaudeResult = Schema.decodeUnknownResult(ClaudeResult)
/** Decodes an unknown value as a {@link ClaudeRateLimitEvent}. */
export const decodeClaudeRateLimitEvent =
  Schema.decodeUnknownResult(ClaudeRateLimitEvent)
/** Decodes an unknown value as a {@link ClaudeApiRetry}. */
export const decodeClaudeApiRetry = Schema.decodeUnknownResult(ClaudeApiRetry)
/** Decodes an unknown value as any {@link ClaudeEvent}; other event types fail. */
export const decodeClaudeEvent = Schema.decodeUnknownResult(ClaudeEvent)

/**
 * Reads one stream-json line for classification (review item B13): a
 * `result` event must decode as a {@link ClaudeResult}; any other event
 * object is passed over; anything else is malformed.
 */
export const claudeStreamLine = streamLineWith([ClaudeEventTypes.Result], decodeClaudeResult)


const decodeUnifiedWindow = Schema.decodeUnknownOption(ClaudeUnifiedWindow)

/**
 * One window's reading from a `rate_limit_event`, before the shell adds
 * the observation stamps and the ledger seq. `usedPercent` is in percent
 * (0 to 100); `resetsAt` is in epoch milliseconds, `Option.none()` when
 * the event gave no reset time.
 */
export interface ClaudeWindowReading {
  readonly window: Window
  readonly usedPercent: number
  readonly resetsAt: Option.Option<number>
}

/** Hundredths of a point in a whole fraction (1.0): 100 percent of 100. */
const hundredthsPerWhole = 10_000
/** Hundredths of a point in one percentage point. */
const hundredthsPerPoint = 100

/**
 * Fraction to percent, rounded to a hundredth of a point so that 0.07
 * gives 7 rather than 7.000000000000001.
 */
const toPercent = (fraction: number): number =>
  Math.round(fraction * hundredthsPerWhole) / hundredthsPerPoint

/** Unix seconds to Unix milliseconds, through Effect's Duration. */
const secondsToMillis = (seconds: number): number =>
  Duration.toMillis(Duration.seconds(seconds))

/**
 * The reading for one tracked window: `Option.none()` unless the entry is
 * present, decodes as a {@link ClaudeUnifiedWindow} and has a utilization.
 * Converts utilization to percent and `resetsAt` from Unix seconds to
 * epoch milliseconds.
 */
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

/**
 * The readings a `rate_limit_event` gives for the two windows foreman
 * tracks: `five_hour` (the five-hour window) and `seven_day` (the weekly
 * window), in that order. Windows are taken one at a time: an untracked
 * window is never examined, and a tracked window that is malformed or has
 * no utilization yields no reading without affecting the other. An event
 * without `rate_limit_info` or `unifiedWindows` gives no readings.
 */
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
