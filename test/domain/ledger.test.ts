import { describe, expect, it } from "@effect/vitest"
import { Result, Schema } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { LedgerRow, LedgerRowKinds } from "../../src/domain/ledger.ts"
import { Windows } from "../../src/domain/window.ts"

const rows = [
  {
    _tag: "Grant",
    grantId: "g-1",
    project: "alpha",
    opId: "op-1",
    provider: Clients.Claude,
    points: [{ window: Windows.FiveHour, points: 15 }],
    issuedAt: 1_000,
  },
  {
    _tag: "Charged",
    grantId: "g-1",
    endedAt: 2_000,
    points: [{ window: Windows.FiveHour, points: 15 }],
  },
  { _tag: "GrantCanceled", grantId: "g-2", cause: "orphan" },
  {
    _tag: "ReadingRow",
    provider: Clients.Claude,
    window: Windows.Weekly,
    usedPercent: 24,
    resetsAt: 9_000,
    observedAt: 1_500,
    source: "claudeRateLimitEvent",
  },
  { _tag: "Retirement", provider: Clients.Claude, window: Windows.FiveHour, throughSeq: 7 },
  { _tag: "Reserve", provider: Clients.Claude, window: Windows.Weekly, reservePercent: 40 },
] as const

describe("LedgerRow", () => {
  const decode = Schema.decodeUnknownResult(LedgerRow)
  const encode = Schema.encodeUnknownResult(LedgerRow)

  it.each(rows)("round-trips %j", (row) => {
    expect(Result.flatMap(decode(row), encode)).toEqual(Result.succeed(row))
  })

  it("rejects a charge with negative points and an unknown cancel cause", () => {
    expect(
      Result.isFailure(decode({ ...rows[1], points: [{ window: Windows.FiveHour, points: -1 }] })),
    ).toBe(true)
    expect(Result.isFailure(decode({ ...rows[2], cause: "timeout" }))).toBe(true)
  })

  it("names every row kind once", () => {
    expect(new Set(Object.values(LedgerRowKinds)).size).toBe(Object.keys(LedgerRowKinds).length)
  })
})
