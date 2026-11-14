import { describe, expect, it } from "@effect/vitest"
import { Result } from "effect"
import {
  decodeCodexEvent,
  decodeCodexRateLimitsResponse,
} from "../../src/format/codex.ts"

// Fixtures are hand-written from the event names the design cites
// (thread.started, turn.started, turn.completed with usage, turn.failed,
// error) and from the app-server method account/rateLimits/read (used
// percent, window length, reset time). They are not captured output; the
// inner field names are unverified until live test L2.
const events = [
  { type: "thread.started" },
  { type: "turn.started" },
  { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2 } },
  { type: "turn.failed", error: { message: "rate limited" } },
  { type: "error", message: "stream disconnected" },
]

describe("Codex exec --json events", () => {
  it.each(events)("decodes %j", (event) => {
    expect(Result.isSuccess(decodeCodexEvent(event))).toBe(true)
  })

  it("decodes turn.completed without usage (usage is optional)", () => {
    expect(Result.isSuccess(decodeCodexEvent({ type: "turn.completed" }))).toBe(
      true,
    )
  })

  it.each([
    { type: "turn.completed", usage: "many" },
    { type: "turn.failed", error: 7 },
    { type: "error", message: 7 },
    { type: "item.completed" },
    { turn: "started" },
  ])("rejects %j", (event) => {
    expect(Result.isFailure(decodeCodexEvent(event))).toBe(true)
  })
})

describe("Codex account/rateLimits/read response", () => {
  const response = {
    rateLimits: {
      primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_900_000 },
      secondary: { usedPercent: 7, windowDurationMins: 10_080 },
    },
  }

  it("decodes a response with both windows", () => {
    expect(Result.isSuccess(decodeCodexRateLimitsResponse(response))).toBe(true)
  })

  it("decodes an empty response (every field optional)", () => {
    expect(Result.isSuccess(decodeCodexRateLimitsResponse({}))).toBe(true)
  })

  it("rejects a non-numeric usedPercent and a non-object rateLimits", () => {
    const text = { rateLimits: { primary: { usedPercent: "42" } } }
    expect(Result.isFailure(decodeCodexRateLimitsResponse(text))).toBe(true)
    expect(
      Result.isFailure(decodeCodexRateLimitsResponse({ rateLimits: 1 })),
    ).toBe(true)
  })
})
