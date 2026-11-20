import { describe, expect, it } from "@effect/vitest"
import { Option, Result } from "effect"
import {
  decodeClaudeApiRetry,
  decodeClaudeEvent,
  decodeClaudeRateLimitEvent,
  decodeClaudeResult,
  resultText,
} from "../../src/format/claude.ts"

// Fixtures are hand-written from the field names the design and decision
// record cite (result subtype, session_id, is_error, rate_limit_event's
// rate_limit_info, system/api_retry). They are not captured output. The
// shape of rate_limit_info that live test L1 observed is tested in
// claude-rate-limit.test.ts; extra fields such as this fixture's are kept.
const resultFixture = {
  type: "result",
  subtype: "success",
  is_error: false,
  session_id: "11111111-2222-3333-4444-555555555555",
}
const rateLimitFixture = {
  type: "rate_limit_event",
  rate_limit_info: { anything: "an extra field" },
}
const apiRetryFixture = { type: "system", subtype: "api_retry" }

describe("Claude result object (--output-format json)", () => {
  it("decodes a result", () => {
    const decoded = decodeClaudeResult(resultFixture)
    expect(Result.isSuccess(decoded)).toBe(true)
    expect(Result.getOrUndefined(decoded)).toMatchObject({
      subtype: "success",
      is_error: false,
    })
  })

  it("decodes a result that carries only its type (every field optional)", () => {
    expect(Result.isSuccess(decodeClaudeResult({ type: "result" }))).toBe(true)
  })

  it("rejects a result with a non-boolean is_error", () => {
    const bad = { ...resultFixture, is_error: "yes" }
    expect(Result.isFailure(decodeClaudeResult(bad))).toBe(true)
  })

  it("rejects another event type", () => {
    expect(Result.isFailure(decodeClaudeResult(rateLimitFixture))).toBe(true)
  })

  it("decodes the final message in `result` as the handoff text", () => {
    const decoded = decodeClaudeResult({ ...resultFixture, result: "Done.\nChanged greet.ts." })
    expect(Result.map(decoded, resultText)).toEqual(Result.succeed(Option.some("Done.\nChanged greet.ts.")))
  })

  it("gives no handoff text for a result without `result`", () => {
    expect(Result.map(decodeClaudeResult(resultFixture), resultText)).toEqual(Result.succeed(Option.none()))
  })

  it("rejects a result whose `result` is not a string", () => {
    expect(Result.isFailure(decodeClaudeResult({ ...resultFixture, result: 3 }))).toBe(true)
  })
})

describe("Claude stream-json events", () => {
  it("decodes rate_limit_event and keeps unknown rate_limit_info fields", () => {
    expect(Result.isSuccess(decodeClaudeRateLimitEvent(rateLimitFixture))).toBe(
      true,
    )
    expect(
      Result.isSuccess(decodeClaudeRateLimitEvent({ type: "rate_limit_event" })),
    ).toBe(true)
  })

  it("rejects rate_limit_event whose rate_limit_info is not an object", () => {
    const bad = { type: "rate_limit_event", rate_limit_info: "soon" }
    expect(Result.isFailure(decodeClaudeRateLimitEvent(bad))).toBe(true)
  })

  it("decodes system/api_retry", () => {
    expect(Result.isSuccess(decodeClaudeApiRetry(apiRetryFixture))).toBe(true)
  })

  it("rejects a system event with another subtype", () => {
    const other = { type: "system", subtype: "init" }
    expect(Result.isFailure(decodeClaudeApiRetry(other))).toBe(true)
  })

  it("the event union takes each of the three and nothing else", () => {
    ;[resultFixture, rateLimitFixture, apiRetryFixture].forEach((fixture) => {
      expect(Result.isSuccess(decodeClaudeEvent(fixture))).toBe(true)
    })
    expect(Result.isFailure(decodeClaudeEvent({ type: "assistant" }))).toBe(true)
    expect(Result.isFailure(decodeClaudeEvent("result"))).toBe(true)
  })
})
