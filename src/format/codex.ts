// Decoders for Codex output: `codex exec --json` events and the app-server
// `account/rateLimits/read` response (design E4, E6; live test L2).
//
// Documented in the design: the event names thread.started, turn.started,
// turn.completed (with usage), turn.failed and error, and that
// account/rateLimits/read returns used percent, window length and reset
// time. The design uses `usedPercent` and `resetsAt` for readings. Every
// other field is optional because the evidence does not document it; all
// of it is unverified until live test L2. Unknown extra fields are
// ignored; other event types fail to decode.
import { Array as Arr, Schema } from "effect"
import { streamLineWith } from "./stream-line.ts"

/** The wire tags of the Codex events decoded here. */
export const CodexEventTypes = {
  ThreadStarted: "thread.started",
  TurnStarted: "turn.started",
  TurnCompleted: "turn.completed",
  TurnFailed: "turn.failed",
  Error: "error",
} as const

const opaqueObject = Schema.Record(Schema.String, Schema.Unknown)

/** A `thread.started` event. No fields are decoded; the id's field name is unverified. */
export const CodexThreadStarted = Schema.Struct({
  type: Schema.Literal(CodexEventTypes.ThreadStarted),
})
/** A `turn.started` event. */
export const CodexTurnStarted = Schema.Struct({
  type: Schema.Literal(CodexEventTypes.TurnStarted),
})
/** A `turn.completed` event. `usage` is optional and opaque; its inner fields are not named. */
export const CodexTurnCompleted = Schema.Struct({
  type: Schema.Literal(CodexEventTypes.TurnCompleted),
  usage: Schema.optionalKey(opaqueObject),
})
/** A `turn.failed` event. `error` is optional and opaque. */
export const CodexTurnFailed = Schema.Struct({
  type: Schema.Literal(CodexEventTypes.TurnFailed),
  error: Schema.optionalKey(opaqueObject),
})
/** An `error` event. `message` is optional. */
export const CodexError = Schema.Struct({
  type: Schema.Literal(CodexEventTypes.Error),
  message: Schema.optionalKey(Schema.String),
})

/** Any `codex exec --json` event decoded here. */
export const CodexEvent = Schema.Union([
  CodexThreadStarted,
  CodexTurnStarted,
  CodexTurnCompleted,
  CodexTurnFailed,
  CodexError,
])
/** Any decoded Codex event; see {@link CodexEvent}. */
export type CodexEvent = typeof CodexEvent.Type

/**
 * One rate-limit window from `account/rateLimits/read`: `usedPercent`,
 * `windowDurationMins` (window length in minutes) and `resetsAt`, each
 * optional. The decoder checks only that each is a number; ranges and the
 * unit of `resetsAt` are unverified until live test L2.
 */
export const CodexRateLimitWindow = Schema.Struct({
  usedPercent: Schema.optionalKey(Schema.Number),
  windowDurationMins: Schema.optionalKey(Schema.Number),
  resetsAt: Schema.optionalKey(Schema.Number),
})
/** One Codex rate-limit window; see {@link CodexRateLimitWindow}. */
export type CodexRateLimitWindow = typeof CodexRateLimitWindow.Type

/**
 * The `account/rateLimits/read` response: optional `rateLimits` with
 * optional `primary` and `secondary` windows. Those two names come from
 * the app-server method, not from the design evidence.
 */
export const CodexRateLimitsResponse = Schema.Struct({
  rateLimits: Schema.optionalKey(
    Schema.Struct({
      primary: Schema.optionalKey(CodexRateLimitWindow),
      secondary: Schema.optionalKey(CodexRateLimitWindow),
    }),
  ),
})
/** A decoded `account/rateLimits/read` response; see {@link CodexRateLimitsResponse}. */
export type CodexRateLimitsResponse = typeof CodexRateLimitsResponse.Type

/** Decodes an unknown value as any {@link CodexEvent}; other event types fail. */
export const decodeCodexEvent = Schema.decodeUnknownResult(CodexEvent)
/** Decodes an unknown value as a {@link CodexRateLimitsResponse}. */
export const decodeCodexRateLimitsResponse = Schema.decodeUnknownResult(
  CodexRateLimitsResponse,
)

/** The event types that bear a run's outcome: a completed or failed turn, and an error. */
const outcomeTypes: ReadonlyArray<string> = [
  CodexEventTypes.TurnCompleted,
  CodexEventTypes.TurnFailed,
  CodexEventTypes.Error,
]

/** The event types that report a failed run. */
const failureTypes: ReadonlyArray<string> = [CodexEventTypes.TurnFailed, CodexEventTypes.Error]

/**
 * Reads one `--json` line for classification (review item B13): a
 * `turn.completed`, `turn.failed` or `error` event must decode; any
 * other event object is passed over; anything else is malformed.
 */
export const codexStreamLine = streamLineWith(outcomeTypes, decodeCodexEvent)

/**
 * Whether an event reports a completed turn. Classification receives
 * this answer, not the wire tag (review item M05).
 */
export const reportsCompletedTurn = (event: CodexEvent): boolean => event.type === CodexEventTypes.TurnCompleted

/** Whether an event reports a failed run: `turn.failed` or `error`. */
export const reportsFailure = (event: CodexEvent): boolean => Arr.contains(failureTypes, event.type)
