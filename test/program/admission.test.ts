// Admission, the lost-race cancel and the settle step against a real
// ledger file (plan Task B3; design "Admission rule", "Grant lifecycle").
import { describe, expect, it } from "@effect/vitest"
import { Database } from "bun:sqlite"
import { Array as Arr, Effect, Option, Schema } from "effect"
import type { Scope } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { Clients } from "../../src/domain/clients.ts"
import { BootId } from "../../src/domain/clock.ts"
import { Finished, Intended, type ProjectEvent } from "../../src/domain/events.ts"
import { GrantId, OpId, ProjectId, Revision, TrancheId, WaiverId } from "../../src/domain/ids.ts"
import {
  Charged,
  Grant,
  GrantCanceled,
  LedgerBusy,
  type LedgerStore,
  ReadingRow,
} from "../../src/domain/ledger.ts"
import { Success } from "../../src/domain/outcomes.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"
import { Roles } from "../../src/domain/roles.ts"
import { Windows } from "../../src/domain/window.ts"
import { ownerOnly } from "../../src/features/counting.ts"
import { defaultCap } from "../../src/features/pace.ts"
import {
  admit,
  Admitted,
  type AdmissionRequest,
  allocationsInFallback,
  applySettle,
  cancelLostRace,
  Refused,
} from "../../src/program/admission.ts"
import { openLedger } from "../../src/runtime/ledger-sqlite.ts"

const busyMillis = 50
const boot = BootId.make("boot-a")
const minuteMicros = 60_000_000
const now = 1_000_000
const nowMono = { bootId: boot, micros: 30 * minuteMicros }
const context = {
  policy: defaultPolicy,
  retirement: ownerOnly,
  allocations: allocationsInFallback,
  cap: defaultCap(defaultPolicy, Clients.Claude),
}
const estimate = [
  { window: Windows.FiveHour, points: 15 },
  { window: Windows.Weekly, points: 15 },
]
const request = (n: number, project = "alpha", waiver = false): AdmissionRequest => ({
  project: ProjectId.make(project),
  opId: OpId.make(`op-${String(n)}`),
  grantId: GrantId.make(`g-${String(n)}`),
  provider: Clients.Claude,
  estimate,
  now,
  nowMono: Option.some(nowMono),
  waiverId: waiver ? Option.some(WaiverId.make("w-1")) : Option.none(),
})
const readingRow = (window: (typeof Windows)[keyof typeof Windows], usedPercent: number) =>
  new ReadingRow({
    provider: Clients.Claude,
    window,
    usedPercent,
    resetsAt: Option.some(now + 3_600_000),
    observedAt: now,
    observedMono: Option.some({ bootId: boot, micros: 29 * minuteMicros }),
    source: "claudeRateLimitEvent",
  })
const intended = (n: number) =>
  new Intended({
    opId: OpId.make(`op-${String(n)}`),
    tranche: TrancheId.make("t-1"),
    step: { role: Roles.Implementer, round: 0 },
    baseRevision: Revision.make("a".repeat(40)),
    grantId: GrantId.make(`g-${String(n)}`),
    client: Clients.Claude,
    waiverId: Option.none(),
  })
const finished = (n: number) =>
  new Finished({ opId: OpId.make(`op-${String(n)}`), outcome: new Success(), endedAt: 700 })

const removeDir = (dir: string) =>
  Effect.sync(() => {
    rmSync(dir, { recursive: true, force: true })
  })
const withLedger = <A, E>(
  use: (store: LedgerStore, path: string) => Effect.Effect<A, E, Scope.Scope>,
) => {
  const dir = mkdtempSync(`${tmpdir()}/foreman-admit-`)
  const path = `${dir}/ledger.sqlite`
  return Effect.ensuring(
    Effect.scoped(Effect.flatMap(openLedger(path, busyMillis), (store) => use(store, path))),
    removeDir(dir),
  )
}
const holdWriteLock = (path: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const db = new Database(path)
      db.exec("BEGIN IMMEDIATE")
      return db
    }),
    (db) =>
      Effect.sync(() => {
        db.exec("ROLLBACK")
        db.close()
      }),
  )
const rowsOf = (store: LedgerStore) =>
  store.transact((tx) => Effect.map(tx.read, (s) => Arr.map(s.entries, (e) => e.row)))
const seedReadings = (store: LedgerStore, fiveHour: number) =>
  store.transact((tx) => tx.append([readingRow(Windows.FiveHour, fiveHour), readingRow(Windows.Weekly, 0)]))

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

const lostRaceCanceledAtOnce = (store: LedgerStore) =>
  Effect.gen(function* () {
    yield* seedReadings(store, 0)
    yield* admit(store, request(1), context)
    yield* cancelLostRace(store, GrantId.make("g-1"))
    expect(Arr.filter(yield* rowsOf(store), Schema.is(GrantCanceled))).toEqual([
      new GrantCanceled({ grantId: GrantId.make("g-1"), cause: "lostRace" }),
    ])
  })

const settleLifecycle = (store: LedgerStore) =>
  Effect.gen(function* () {
    yield* seedReadings(store, 0)
    yield* Effect.forEach([1, 2, 3], (n) => admit(store, request(n), context))
    const log: ReadonlyArray<ProjectEvent> = [intended(2), finished(2), intended(3)]
    yield* applySettle(store, log, ProjectId.make("alpha"))
    const rows = yield* rowsOf(store)
    expect(Arr.filter(rows, Schema.is(GrantCanceled))).toEqual([
      new GrantCanceled({ grantId: GrantId.make("g-1"), cause: "orphan" }),
    ])
    expect(Arr.map(Arr.filter(rows, Schema.is(Charged)), (c) => [c.grantId, c.endedAt])).toEqual([
      ["g-2", 700],
    ])
    const before = Arr.length(rows)
    yield* applySettle(store, log, ProjectId.make("alpha"))
    expect(Arr.length(yield* rowsOf(store))).toBe(before)
  })

const settleBusyWritesNothing = (store: LedgerStore, path: string) =>
  Effect.gen(function* () {
    yield* seedReadings(store, 0)
    yield* admit(store, request(1), context)
    const before = yield* rowsOf(store)
    const failure = yield* Effect.scoped(
      Effect.flatMap(holdWriteLock(path), () =>
        Effect.flip(applySettle(store, [], ProjectId.make("alpha"))),
      ),
    )
    expect(failure).toEqual(new LedgerBusy())
    expect(yield* rowsOf(store)).toEqual(before)
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
})

describe("grant lifecycle", () => {
  it.effect("cancels a lost race at once", () => withLedger(lostRaceCanceledAtOnce))
  it.effect("settles orphans and finished steps once, leaving in-flight grants open", () =>
    withLedger(settleLifecycle),
  )
  it.effect("writes nothing when the settle cannot get the lock", () =>
    withLedger(settleBusyWritesNothing),
  )
})
