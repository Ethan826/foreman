// The lost-race cancel and the settle step against a real ledger file
// (plan Task B3; design "Grant lifecycle").
import { describe, expect, it } from "@effect/vitest"
import { Database } from "bun:sqlite"
import { Array as Arr, Effect, Option, Schema } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { Finished, Intended, type ProjectEvent } from "../../src/domain/events.ts"
import { GrantId, OpId, ProjectId, Revision, TrancheId } from "../../src/domain/ids.ts"
import { Charged, GrantCanceled, LedgerBusy, type LedgerStore } from "../../src/domain/ledger.ts"
import { Success } from "../../src/domain/outcomes.ts"
import { Roles } from "../../src/domain/roles.ts"
import { admit, applySettle, cancelLostRace } from "../../src/program/admission.ts"
import { context, request, rowsOf, seedReadings, withLedger } from "./admission-fixtures.ts"

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

describe("grant lifecycle", () => {
  it.effect("cancels a lost race at once", () => withLedger(lostRaceCanceledAtOnce))
  it.effect("settles orphans and finished steps once, leaving in-flight grants open", () =>
    withLedger(settleLifecycle),
  )
  it.effect("writes nothing when the settle cannot get the lock", () =>
    withLedger(settleBusyWritesNothing),
  )
})
