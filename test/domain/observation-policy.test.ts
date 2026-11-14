import { describe, expect, it } from "@effect/vitest"
import { Result, Schema, Struct } from "effect"
import { Observation } from "../../src/domain/observation.ts"
import { defaultPolicy, Policy } from "../../src/domain/policy.ts"

const decodeObservation = Schema.decodeUnknownResult(Observation)
const base = {
  provider: "claude",
  window: "fiveHour",
  usedPercent: 12.5,
  observedAt: 1_000,
  source: "claudeStatusline",
}

describe("Observation", () => {
  it("accepts a reading with and without resetsAt", () => {
    expect(Result.isSuccess(decodeObservation(base))).toBe(true)
    expect(
      Result.isSuccess(decodeObservation({ ...base, resetsAt: 9_000 })),
    ).toBe(true)
  })

  it.each([
    { usedPercent: -1 },
    { usedPercent: 101 },
    { usedPercent: Number.NaN },
    { provider: "gemini" },
    { window: "daily" },
    { observedAt: 1.5 },
    { resetsAt: "soon" },
    { source: "guess" },
  ])("rejects %j", (patch) => {
    expect(Result.isFailure(decodeObservation({ ...base, ...patch }))).toBe(true)
  })

  it("rejects a missing observedAt", () => {
    const rest = Struct.omit(base, ["observedAt"])
    expect(Result.isFailure(decodeObservation(rest))).toBe(true)
  })
})

describe("Policy", () => {
  const decode = Schema.decodeUnknownResult(Policy)

  it("defaults: 30 and 40 percent reserve, 10 minutes, 15 points", () => {
    expect(defaultPolicy.freshnessMillis).toBe(10 * 60 * 1000)
    expect(defaultPolicy.initialEstimate).toBe(15)
    expect(defaultPolicy.providers.claude.windows).toEqual([
      { window: "fiveHour", reservePercent: 30 },
      { window: "weekly", reservePercent: 40 },
    ])
  })

  it("the defaults are themselves valid policy data", () => {
    expect(Result.isSuccess(decode(defaultPolicy))).toBe(true)
  })

  it.each([
    { freshnessMillis: 0 },
    { freshnessMillis: -5 },
    { initialEstimate: -1 },
    { initialEstimate: 101 },
  ])("rejects %j", (patch) => {
    expect(Result.isFailure(decode({ ...defaultPolicy, ...patch }))).toBe(true)
  })

  it("rejects a reserve outside 0..100", () => {
    const bad = {
      ...defaultPolicy,
      providers: {
        ...defaultPolicy.providers,
        claude: { windows: [{ window: "fiveHour", reservePercent: 120 }] },
      },
    }
    expect(Result.isFailure(decode(bad))).toBe(true)
  })

  it("rejects a window listed twice for one provider", () => {
    const twice = {
      ...defaultPolicy,
      providers: {
        ...defaultPolicy.providers,
        claude: {
          windows: [
            { window: "weekly", reservePercent: 40 },
            { window: "weekly", reservePercent: 10 },
          ],
        },
      },
    }
    expect(Result.isFailure(decode(twice))).toBe(true)
  })
})
