// Decoders for Codex output: `codex exec --json` events and the app-server
// `account/rateLimits/read` response (design E4, E6; live test L2).
//
// Documented in the design: the event names thread.started, turn.started,
// turn.completed (with usage), turn.failed and error, and that
// account/rateLimits/read returns used percent, window length and reset
// time. The design uses `usedPercent` and `resetsAt` for readings.
//
// Optional because undocumented in the evidence (all unverified until live
// test L2):
//   thread.started:  no fields decoded (the id's field name is unverified)
//   turn.completed:  usage (kept opaque; its inner fields are not named)
//   turn.failed:     error (kept opaque)
//   error:           message
//   response:        rateLimits, with primary and secondary (names from the
//                    app-server method, not from the design evidence), each
//                    with usedPercent, windowDurationMins and resetsAt
// Unknown extra fields are ignored; other event types fail to decode.
import { Schema } from "effect"

// The wire tags of the events decoded here.
export const CodexEventTypes = {
  ThreadStarted: "thread.started",
  TurnStarted: "turn.started",
  TurnCompleted: "turn.completed",
  TurnFailed: "turn.failed",
  Error: "error",
} as const

const opaqueObject = Schema.Record(Schema.String, Schema.Unknown)

export const CodexThreadStarted = Schema.Struct({
  type: Schema.Literal(CodexEventTypes.ThreadStarted),
})
export const CodexTurnStarted = Schema.Struct({
  type: Schema.Literal(CodexEventTypes.TurnStarted),
})
export const CodexTurnCompleted = Schema.Struct({
  type: Schema.Literal(CodexEventTypes.TurnCompleted),
  usage: Schema.optionalKey(opaqueObject),
})
export const CodexTurnFailed = Schema.Struct({
  type: Schema.Literal(CodexEventTypes.TurnFailed),
  error: Schema.optionalKey(opaqueObject),
})
export const CodexError = Schema.Struct({
  type: Schema.Literal(CodexEventTypes.Error),
  message: Schema.optionalKey(Schema.String),
})

export const CodexEvent = Schema.Union([
  CodexThreadStarted,
  CodexTurnStarted,
  CodexTurnCompleted,
  CodexTurnFailed,
  CodexError,
])
export type CodexEvent = typeof CodexEvent.Type

export const CodexRateLimitWindow = Schema.Struct({
  usedPercent: Schema.optionalKey(Schema.Number),
  windowDurationMins: Schema.optionalKey(Schema.Number),
  resetsAt: Schema.optionalKey(Schema.Number),
})
export type CodexRateLimitWindow = typeof CodexRateLimitWindow.Type

export const CodexRateLimitsResponse = Schema.Struct({
  rateLimits: Schema.optionalKey(
    Schema.Struct({
      primary: Schema.optionalKey(CodexRateLimitWindow),
      secondary: Schema.optionalKey(CodexRateLimitWindow),
    }),
  ),
})
export type CodexRateLimitsResponse = typeof CodexRateLimitsResponse.Type

export const decodeCodexEvent = Schema.decodeUnknownResult(CodexEvent)
export const decodeCodexRateLimitsResponse = Schema.decodeUnknownResult(
  CodexRateLimitsResponse,
)
