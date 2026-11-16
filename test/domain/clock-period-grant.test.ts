import { describe, expect, it } from "@effect/vitest"
import { Option, Result, Schema, Struct } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { BootId, MonoStamp } from "../../src/domain/clock.ts"
import {
  GrantCancelCause,
  GrantCancelCauses,
  GrantPoints,
} from "../../src/domain/grant.ts"
import { GrantId, LedgerSeq, PeriodSeq } from "../../src/domain/ids.ts"
import { Observation } from "../../src/domain/observation.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"

const ok = (
  schema: Schema.Top & { readonly DecodingServices: never },
  input: unknown,
) => Result.isSuccess(Schema.decodeUnknownResult(schema)(input))

const reading = {
  provider: Clients.Claude,
  window: "fiveHour",
  usedPercent: 12,
  observedAt: 1_000,
  source: "claudeRateLimitEvent",
  seq: 3,
}

describe("MonoStamp", () => {
  it("accepts a boot id and non-negative integer microseconds", () => {
    expect(ok(MonoStamp, { bootId: "B-1", micros: 0 })).toBe(true)
    expect(ok(MonoStamp, { bootId: "B-1", micros: 9_007_199_254 })).toBe(true)
  })

  it.each([
    { bootId: "B-1", micros: -1 },
    { bootId: "B-1", micros: 1.5 },
    { bootId: "", micros: 1 },
  ])("rejects %j", (input) => {
    expect(ok(MonoStamp, input)).toBe(false)
  })

  it("brands the boot id", () => {
    expect(ok(BootId, "8F2C")).toBe(true)
    expect(ok(BootId, "")).toBe(false)
  })
})

describe("sequence numbers and grant ids", () => {
  it.each([
    [LedgerSeq, 1, true],
    [LedgerSeq, 0, false],
    [LedgerSeq, 2.5, false],
    [PeriodSeq, 1, true],
    [PeriodSeq, 0, false],
    [GrantId, "g-1", true],
    [GrantId, "no spaces", false],
  ] as const)("%# decodes as expected", (schema, input, expected) => {
    expect(ok(schema, input)).toBe(expected)
  })
})

describe("Observation, revision 6.1 fields", () => {
  const decode = Schema.decodeUnknownResult(Observation)

  it("decodes a missing observedMono to Option.none()", () => {
    expect(Result.map(decode(reading), (r) => r.observedMono)).toEqual(
      Result.succeed(Option.none()),
    )
  })

  it("decodes a present observedMono to Option.some", () => {
    const stamp = { bootId: "B-1", micros: 5 }
    const decoded = Result.map(
      decode({ ...reading, observedMono: stamp }),
      (r) => r.observedMono,
    )
    expect(Result.map(decoded, Option.isSome)).toEqual(Result.succeed(true))
  })

  it("requires a ledger seq", () => {
    expect(Result.isFailure(decode(Struct.omit(reading, ["seq"])))).toBe(true)
    expect(Result.isFailure(decode({ ...reading, seq: 0 }))).toBe(true)
  })
})

describe("GrantPoints and cancel causes", () => {
  it("decodes one grant's points for one window", () => {
    const input = {
      grantId: "g-1",
      provider: Clients.Claude,
      window: "weekly",
      points: 15,
    }
    expect(ok(GrantPoints, input)).toBe(true)
    expect(ok(GrantPoints, { ...input, points: -1 })).toBe(false)
  })

  it("names the two cancel causes", () => {
    expect(ok(GrantCancelCause, GrantCancelCauses.LostRace)).toBe(true)
    expect(ok(GrantCancelCause, GrantCancelCauses.Orphan)).toBe(true)
    expect(ok(GrantCancelCause, "timeout")).toBe(false)
  })
})

describe("Policy, revision 6.1 defaults", () => {
  it("has the design's tolerances", () => {
    expect(defaultPolicy.resetToleranceMillis).toBe(300_000)
    expect(defaultPolicy.dropTolerancePoints).toBe(5)
  })
})
