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
//   rate_limit_event: rate_limit_info (kept opaque; its inner fields are
//                     not named anywhere in the evidence), session_id
//   system/api_retry: session_id
// Unknown extra fields are ignored. Any other event type fails to decode;
// the shell decides what an undecodable line means.
import { Schema } from "effect"

const opaqueObject = Schema.Record(Schema.String, Schema.Unknown)

export const ClaudeResult = Schema.Struct({
  type: Schema.Literal("result"),
  subtype: Schema.optionalKey(Schema.String),
  is_error: Schema.optionalKey(Schema.Boolean),
  session_id: Schema.optionalKey(Schema.String),
})
export type ClaudeResult = typeof ClaudeResult.Type

export const ClaudeRateLimitEvent = Schema.Struct({
  type: Schema.Literal("rate_limit_event"),
  rate_limit_info: Schema.optionalKey(opaqueObject),
  session_id: Schema.optionalKey(Schema.String),
})
export type ClaudeRateLimitEvent = typeof ClaudeRateLimitEvent.Type

export const ClaudeApiRetry = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("api_retry"),
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
