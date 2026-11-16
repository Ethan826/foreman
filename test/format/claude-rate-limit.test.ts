// rate_limit_event's rate_limit_info, in the shape live test L1 observed on
// 2026-11-16 (research/live/l1-2026-11-16/l1-stream.jsonl): unifiedWindows
// with five_hour and seven_day, each with utilization as a fraction,
// resetsAt in Unix seconds, and status.
import { describe, expect, it } from "@effect/vitest"
import { Option, Result } from "effect"
import { Windows } from "../../src/domain/window.ts"
import {
  claudeWindowReadings,
  decodeClaudeRateLimitEvent,
} from "../../src/format/claude.ts"

const observed = {
  type: "rate_limit_event",
  rate_limit_info: {
    status: "allowed",
    resetsAt: 1794872400,
    rateLimitType: "five_hour",
    overageStatus: "rejected",
    overageDisabledReason: "org_level_disabled",
    isUsingOverage: false,
    unifiedWindows: {
      five_hour: { utilization: 0.05, resetsAt: 1794872400, status: "allowed" },
      seven_day: { utilization: 0.23, resetsAt: 1795244400, status: "allowed" },
    },
  },
}

const readingsOf = (input: unknown) =>
  Result.map(decodeClaudeRateLimitEvent(input), claudeWindowReadings)

const withWindows = (unifiedWindows: unknown) => ({
  type: "rate_limit_event",
  rate_limit_info: { status: "allowed", unifiedWindows },
})

describe("Claude rate_limit_event readings", () => {
  it("reads both windows, as percentages with reset times in milliseconds", () => {
    expect(readingsOf(observed)).toEqual(
      Result.succeed([
        {
          window: Windows.FiveHour,
          usedPercent: 5,
          resetsAt: Option.some(1794872400_000),
        },
        {
          window: Windows.Weekly,
          usedPercent: 23,
          resetsAt: Option.some(1795244400_000),
        },
      ]),
    )
  })

  it("keeps fractions without float noise", () => {
    expect(
      readingsOf(withWindows({ five_hour: { utilization: 0.07 } })),
    ).toEqual(
      Result.succeed([
        { window: Windows.FiveHour, usedPercent: 7, resetsAt: Option.none() },
      ]),
    )
  })

  it("yields nothing when rate_limit_info or unifiedWindows is absent", () => {
    expect(readingsOf({ type: "rate_limit_event" })).toEqual(Result.succeed([]))
    expect(
      readingsOf({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } }),
    ).toEqual(Result.succeed([]))
  })

  it("keeps a window without utilization absent", () => {
    expect(
      readingsOf(
        withWindows({
          five_hour: { resetsAt: 1794872400, status: "allowed" },
          seven_day: { utilization: 0.4 },
        }),
      ),
    ).toEqual(
      Result.succeed([
        { window: Windows.Weekly, usedPercent: 40, resetsAt: Option.none() },
      ]),
    )
  })

  it("ignores windows foreman does not track", () => {
    expect(
      readingsOf(withWindows({ seven_day_fable: { utilization: 0.1 } })),
    ).toEqual(Result.succeed([]))
  })

  it.each([
    { five_hour: { utilization: 1.2 } },
    { five_hour: { utilization: -0.1 } },
    { five_hour: { utilization: "5%" } },
    { five_hour: { utilization: 0.1, resetsAt: 1.5 } },
    { five_hour: "full" },
  ])("rejects a malformed window %j", (windows) => {
    expect(Result.isFailure(decodeClaudeRateLimitEvent(withWindows(windows)))).toBe(true)
  })
})
