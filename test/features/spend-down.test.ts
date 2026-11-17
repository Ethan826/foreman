// Spend-down (plan Task B7; design "Spend-down override", C15): active only
// in its period and until canceled; a loosening one also ends at the
// period's reset time; rule 2 is skipped only under a loosening one.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Option } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { LedgerSeq, PeriodSeq } from "../../src/domain/ids.ts"
import {
  type LedgerEntry,
  type LedgerRow,
  SpendDown,
  SpendDownCanceled,
  SpendDownEndCauses,
} from "../../src/domain/ledger.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"
import { Windows } from "../../src/domain/window.ts"
import {
  activeSpendDown,
  capFor,
  spendDownsToExpire,
  skipsAllocations,
  spendDownAccepted,
} from "../../src/features/spend-down.ts"

const reset = 10_000
const period = (seq: number, resetsAt: Option.Option<number> = Option.some(reset)) => ({
  periodSeq: PeriodSeq.make(seq),
  resetsAt,
})
const snapshotOf = (rows: ReadonlyArray<LedgerRow>) => ({
  entries: Arr.map(rows, (row, i): LedgerEntry => ({ seq: LedgerSeq.make(i + 1), row })),
})
const spendDown = (level: number, periodSeq = 1) =>
  new SpendDown({ provider: Clients.Claude, window: Windows.FiveHour, levelPercent: level, periodSeq: PeriodSeq.make(periodSeq) })
const cancel = (seq: number) =>
  new SpendDownCanceled({
    provider: Clients.Claude,
    window: Windows.FiveHour,
    spendDownSeq: LedgerSeq.make(seq),
    cause: SpendDownEndCauses.Owner,
  })
const active = (rows: ReadonlyArray<LedgerRow>, current = period(1), now = 5_000) =>
  Option.map(activeSpendDown(snapshotOf(rows), Clients.Claude, Windows.FiveHour, Option.some(current), now, defaultPolicy), (s) => s.levelPercent)

describe("activeSpendDown", () => {
  it("is active in its period until canceled", () => {
    expect(active([spendDown(50)])).toEqual(Option.some(50))
    expect(active([spendDown(50), cancel(1)])).toEqual(Option.none())
  })

  it("ends at a new period, loosening or tightening", () => {
    expect(active([spendDown(50)], period(2))).toEqual(Option.none())
    expect(active([spendDown(90)], period(2))).toEqual(Option.none())
  })

  it("ends a loosening one when the clock passes the period's reset time", () => {
    expect(active([spendDown(90)], period(1), reset)).toEqual(Option.none())
  })

  it("never ends a tightening one on the clock", () => {
    expect(active([spendDown(50)], period(1), reset + 1_000_000)).toEqual(Option.some(50))
  })

  it("is inactive with no current period", () => {
    expect(
      activeSpendDown(snapshotOf([spendDown(50)]), Clients.Claude, Windows.FiveHour, Option.none(), 0, defaultPolicy),
    ).toEqual(Option.none())
  })
})

describe("capFor and skipsAllocations", () => {
  const caps = (rows: ReadonlyArray<LedgerRow>) =>
    capFor(snapshotOf(rows), Clients.Claude, () => Option.some(period(1)), 5_000, defaultPolicy)

  it("uses the spend-down level as the cap, else 100 minus the reserve", () => {
    expect([caps([spendDown(50)])(Windows.FiveHour), caps([])(Windows.FiveHour), caps([spendDown(50)])(Windows.Weekly)]).toEqual([50, 70, 60])
  })

  it("skips allocations only under a loosening spend-down", () => {
    const skips = (rows: ReadonlyArray<LedgerRow>) =>
      skipsAllocations(snapshotOf(rows), Clients.Claude, Windows.FiveHour, Option.some(period(1)), 5_000, defaultPolicy)
    expect([skips([spendDown(90)]), skips([spendDown(70)]), skips([spendDown(50)]), skips([])]).toEqual([true, false, false, false])
  })
})

describe("spendDownAccepted", () => {
  it("needs a usable reading and no active spend-down", () => {
    expect(spendDownAccepted(true, Option.none())).toBe(true)
    expect(spendDownAccepted(false, Option.none())).toBe(false)
    expect(spendDownAccepted(true, Option.some(spendDown(50)))).toBe(false)
  })
})

describe("spendDownsToExpire", () => {
  const expire = (rows: ReadonlyArray<LedgerRow>, now: number) =>
    spendDownsToExpire(snapshotOf(rows), Clients.Claude, () => Option.some(period(1)), now, defaultPolicy)
  const expired = new SpendDownCanceled({
    provider: Clients.Claude,
    window: Windows.FiveHour,
    spendDownSeq: LedgerSeq.make(1),
    cause: SpendDownEndCauses.ResetPassed,
  })

  it("expires an active loosening spend-down once the reset time has passed", () => {
    expect(expire([spendDown(90)], reset)).toEqual([expired])
  })

  it("expires nothing before the reset time, nothing tightening, nothing already canceled", () => {
    expect(expire([spendDown(90)], reset - 1)).toEqual([])
    expect(expire([spendDown(50)], reset + 1)).toEqual([])
    expect(expire([spendDown(90), cancel(1)], reset + 1)).toEqual([])
  })

  it("keeps an expired spend-down ended when the clock is set back", () => {
    expect(active([spendDown(90), expired], period(1), reset - 1_000)).toEqual(Option.none())
  })
})
