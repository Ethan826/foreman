// Admission against a real ledger file (plan Task B3; design "Admission
// rule"). The lost-race cancel and the settle step are in
// `grant-lifecycle.test.ts`.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Schema } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { PeriodSeq } from "../../src/domain/ids.ts"
import { Grant, type LedgerStore, SpendDown, SpendDownCanceled } from "../../src/domain/ledger.ts"
import { Windows } from "../../src/domain/window.ts"
import { Refused } from "../../src/features/admission.ts"
import { admit, Admitted } from "../../src/program/admission.ts"
import { context, estimate, now, request, rowsOf, seedReadings, withLedger } from "./admission-fixtures.ts"

const admitsAndAppendsGrant = (store: LedgerStore) =>
  Effect.gen(function* () {
    yield* seedReadings(store, 10)
    const result = yield* admit(store, request(1), context)
    expect(Schema.is(Admitted)(result)).toBe(true)
    const grants = Arr.filter(yield* rowsOf(store), Schema.is(Grant))
    expect(Arr.map(grants, (g) => [g.grantId, g.points])).toEqual([["g-1", estimate]])
  })

const refusesAndWritesNothing = (store: LedgerStore) =>
  Effect.gen(function* () {
    yield* seedReadings(store, 60)
    const result = yield* admit(store, request(1), context)
    expect(Schema.is(Refused)(result)).toBe(true)
    expect(Arr.filter(yield* rowsOf(store), Schema.is(Grant))).toEqual([])
  })

const countsOtherProjectsGrants = (store: LedgerStore) =>
  Effect.gen(function* () {
    yield* seedReadings(store, 25)
    // 25 + 15 = 40, then 25 + 15 + 15 = 55, then 70: three fit, the fourth does not.
    const results = yield* Effect.forEach([1, 2, 3, 4], (n) =>
      admit(store, request(n, n % 2 === 0 ? "beta" : "alpha"), context),
    )
    expect(Arr.map(results, Schema.is(Admitted))).toEqual([true, true, true, false])
  })

const waivedStillTakesGrant = (store: LedgerStore) =>
  Effect.gen(function* () {
    yield* seedReadings(store, 60)
    const result = yield* admit(store, request(1, "alpha", true), context)
    expect(Schema.is(Admitted)(result)).toBe(true)
    expect(Arr.length(Arr.filter(yield* rowsOf(store), Schema.is(Grant)))).toBe(1)
  })

const otherProvidersWaiverIgnored = (store: LedgerStore) =>
  Effect.gen(function* () {
    yield* seedReadings(store, 60)
    const result = yield* admit(store, request(1, "alpha", true, Clients.Codex), context)
    expect(Schema.is(Refused)(result)).toBe(true)
    expect(Arr.filter(yield* rowsOf(store), Schema.is(Grant))).toEqual([])
  })

const grantCoversEveryPolicyWindow = (store: LedgerStore) =>
  Effect.gen(function* () {
    yield* seedReadings(store, 10)
    yield* admit(store, { ...request(1), estimate: [{ window: Windows.FiveHour, points: 5 }] }, context)
    const grants = Arr.filter(yield* rowsOf(store), Schema.is(Grant))
    expect(Arr.map(grants, (g) => g.points)).toEqual([
      [
        { window: Windows.FiveHour, points: 5 },
        { window: Windows.Weekly, points: 15 },
      ],
    ])
  })

const spendDownExpiryIsDurable = (store: LedgerStore) =>
  Effect.gen(function* () {
    yield* seedReadings(store, 60)
    yield* store.transact((tx) =>
      tx.append([
        new SpendDown({ provider: Clients.Claude, window: Windows.FiveHour, levelPercent: 90, periodSeq: PeriodSeq.make(1) }),
      ]),
    )
    const pastReset = { ...request(1), now: now + 3_600_000 }
    expect(Schema.is(Refused)(yield* admit(store, pastReset, context))).toBe(true)
    expect(Arr.length(Arr.filter(yield* rowsOf(store), Schema.is(SpendDownCanceled)))).toBe(1)
    const clockSetBack = { ...request(2), now }
    expect(Schema.is(Refused)(yield* admit(store, clockSetBack, context))).toBe(true)
  })

describe("admission", () => {
  it.effect("admits within the cap and appends a grant at the estimate", () =>
    withLedger(admitsAndAppendsGrant),
  )
  it.effect("refuses beyond the cap and writes nothing", () => withLedger(refusesAndWritesNothing))
  it.effect("counts every project's open grants", () => withLedger(countsOtherProjectsGrants))
  it.effect("admits a waived launch and still takes its grant", () =>
    withLedger(waivedStillTakesGrant),
  )
  it.effect("ignores a waiver armed for another provider", () =>
    withLedger(otherProvidersWaiverIgnored),
  )
  it.effect("records the grant in every policy window pacing checked", () =>
    withLedger(grantCoversEveryPolicyWindow),
  )
  it.effect("writes a loosening spend-down's expiry so a clock set back cannot revive it", () =>
    withLedger(spendDownExpiryIsDurable),
  )
})
