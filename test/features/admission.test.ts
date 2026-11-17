// The pure admission decision (owner ruling 2026-11-17: decisions live in
// Features): the spend-down cap and its durable expiry (review finding
// F5), and rule 2 per window, skipped only under a loosening spend-down.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Option, Schema } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { BootId } from "../../src/domain/clock.ts"
import { GrantId, LedgerSeq, OpId, PeriodSeq, ProjectId } from "../../src/domain/ids.ts"
import {
  type LedgerEntry,
  type LedgerRow,
  ReadingRow,
  SpendDown,
  SpendDownCanceled,
  SpendDownEndCauses,
} from "../../src/domain/ledger.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"
import { type Window, Windows } from "../../src/domain/window.ts"
import {
  Admit,
  type AdmissionContext,
  type AdmissionRequest,
  AllocationRefused,
  allocationsInFallback,
  decideAdmission,
  Refused,
} from "../../src/features/admission.ts"
import { ownerOnly } from "../../src/features/counting.ts"

const boot = BootId.make("boot-a")
const minuteMicros = 60_000_000
const reset = 10_000_000
const reading = (window: Window, usedPercent: number) =>
  new ReadingRow({
    provider: Clients.Claude,
    window,
    usedPercent,
    resetsAt: Option.some(reset),
    observedAt: 0,
    observedMono: Option.some({ bootId: boot, micros: 29 * minuteMicros }),
    source: "claudeRateLimitEvent",
  })
const spendDown = (window: Window, level: number) =>
  new SpendDown({ provider: Clients.Claude, window, levelPercent: level, periodSeq: PeriodSeq.make(1) })
const snapshotOf = (rows: ReadonlyArray<LedgerRow>) => ({
  entries: Arr.map(rows, (row, i): LedgerEntry => ({ seq: LedgerSeq.make(i + 1), row })),
})
const request = (now: number): AdmissionRequest => ({
  project: ProjectId.make("alpha"),
  opId: OpId.make("op-1"),
  grantId: GrantId.make("g-1"),
  provider: Clients.Claude,
  estimate: [
    { window: Windows.FiveHour, points: 5 },
    { window: Windows.Weekly, points: 5 },
  ],
  now,
  nowMono: Option.some({ bootId: boot, micros: 30 * minuteMicros }),
  waiver: Option.none(),
})
const context = (allocations = allocationsInFallback): AdmissionContext => ({
  policy: defaultPolicy,
  retirement: ownerOnly,
  allocations,
})
const base = [reading(Windows.FiveHour, 70), reading(Windows.Weekly, 0)]
const decide = (rows: ReadonlyArray<LedgerRow>, now: number, ctx = context()) =>
  decideAdmission(snapshotOf(rows), request(now), ctx)

describe("decideAdmission: spend-down cap and expiry", () => {
  it("lets a loosening spend-down raise the cap before its reset time", () => {
    const result = decide([...base, spendDown(Windows.FiveHour, 90)], reset - 1)
    expect(Schema.is(Admit)(result.verdict)).toBe(true)
    expect(result.expire).toEqual([])
  })

  it("expires it once the reset time is reached and uses the default cap", () => {
    const result = decide([...base, spendDown(Windows.FiveHour, 90)], reset)
    expect(result.expire).toEqual([
      new SpendDownCanceled({
        provider: Clients.Claude,
        window: Windows.FiveHour,
        spendDownSeq: LedgerSeq.make(3),
        cause: SpendDownEndCauses.ResetPassed,
      }),
    ])
    expect(Schema.is(Refused)(result.verdict)).toBe(true)
  })

  it("never brings an expired spend-down back when the clock is set back", () => {
    const expired = new SpendDownCanceled({
      provider: Clients.Claude,
      window: Windows.FiveHour,
      spendDownSeq: LedgerSeq.make(3),
      cause: SpendDownEndCauses.ResetPassed,
    })
    const result = decide([...base, spendDown(Windows.FiveHour, 90), expired], reset - 1_000)
    expect(Schema.is(Refused)(result.verdict)).toBe(true)
  })
})

describe("decideAdmission: rule 2 per window", () => {
  const refuseWeekly = context((_snapshot, _request, window) => window !== Windows.Weekly)
  const low = [reading(Windows.FiveHour, 10), reading(Windows.Weekly, 0)]

  it("refuses when rule 2 refuses any window", () => {
    expect(decide(low, 0, refuseWeekly).verdict).toEqual(new AllocationRefused())
  })

  it("skips rule 2 for a window under a loosening spend-down only", () => {
    expect(Schema.is(Admit)(decide([...low, spendDown(Windows.Weekly, 90)], 0, refuseWeekly).verdict)).toBe(true)
    expect(decide([...low, spendDown(Windows.Weekly, 50)], 0, refuseWeekly).verdict).toEqual(
      new AllocationRefused(),
    )
  })
})
