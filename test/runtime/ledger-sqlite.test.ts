// The SQLite ledger store against real database files in a temporary
// directory: seq order, rollback, the settle rules and the write lock.
import { describe, expect, it } from "@effect/vitest"
import { Database } from "bun:sqlite"
import { Array as Arr, Effect, Exit, Option, Order } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { Clients } from "../../src/domain/clients.ts"
import { GrantId, OpId, ProjectId } from "../../src/domain/ids.ts"
import {
  Charged,
  Grant,
  GrantCanceled,
  GrantSettled,
  LedgerBusy,
  type LedgerRow,
  type LedgerSnapshot,
  type LedgerStore,
  type LedgerTx,
  ReadingRow,
  Reserve,
} from "../../src/domain/ledger.ts"
import { Windows } from "../../src/domain/window.ts"
import { openLedger } from "../../src/runtime/ledger-sqlite.ts"

const busyMillis = 50
const fiveHour = [{ window: Windows.FiveHour, points: 15 }]
const grant = (id: string) =>
  new Grant({
    grantId: GrantId.make(id),
    project: ProjectId.make("alpha"),
    opId: OpId.make(`op-${id}`),
    provider: Clients.Claude,
    points: fiveHour,
    issuedAt: 1_000,
  })
const charged = (id: string) =>
  new Charged({ grantId: GrantId.make(id), endedAt: 2_000, points: fiveHour })
const canceled = (id: string) =>
  new GrantCanceled({ grantId: GrantId.make(id), cause: "orphan" })
const reading = new ReadingRow({
  provider: Clients.Claude,
  window: Windows.FiveHour,
  usedPercent: 10,
  resetsAt: Option.some(9_000),
  observedAt: 1_500,
  observedMono: Option.none(),
  source: "claudeRateLimitEvent",
})
const reserve = new Reserve({
  provider: Clients.Claude,
  window: Windows.Weekly,
  reservePercent: 40,
})

const removeDir = (dir: string) =>
  Effect.sync(() => {
    rmSync(dir, { recursive: true, force: true })
  })

// Runs `use` against a ledger in a fresh temporary directory.
const withLedger = <A, E>(use: (store: LedgerStore, path: string) => Effect.Effect<A, E>) => {
  const dir = mkdtempSync(`${tmpdir()}/foreman-ledger-`)
  const path = `${dir}/ledger.sqlite`
  return Effect.ensuring(
    Effect.scoped(Effect.flatMap(openLedger(path, busyMillis), (store) => use(store, path))),
    removeDir(dir),
  )
}

// Holds the ledger's write lock from a second connection for the scope.
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

const appendIn = (store: LedgerStore, rows: ReadonlyArray<LedgerRow>) =>
  store.transact((tx) => tx.append(rows))
const seqsIn = (snapshot: LedgerSnapshot) => Arr.map(snapshot.entries, (e) => e.seq)
const rowsIn = (snapshot: LedgerSnapshot) => Arr.map(snapshot.entries, (e) => e.row)
const seqsOf = (store: LedgerStore) => store.transact((tx) => Effect.map(tx.read, seqsIn))
const rowsOf = (store: LedgerStore) => store.transact((tx) => Effect.map(tx.read, rowsIn))
const abandon = () => Effect.fail("abandon" as const)
const appendThenAbandon = (tx: LedgerTx) => Effect.flatMap(tx.append([grant("g-1")]), abandon)

const gapFreeAcrossTables = (store: LedgerStore) =>
  Effect.gen(function* () {
    const first = yield* appendIn(store, [grant("g-1"), reading])
    const second = yield* appendIn(store, [reserve, charged("g-1")])
    expect([...first, ...second]).toEqual([1, 2, 3, 4])
    expect(yield* seqsOf(store)).toEqual([1, 2, 3, 4])
    expect(yield* rowsOf(store)).toEqual([grant("g-1"), reading, reserve, charged("g-1")])
  })

const rollbackLeavesNoGap = (store: LedgerStore) =>
  Effect.gen(function* () {
    const failed = yield* Effect.exit(store.transact(appendThenAbandon))
    expect(Exit.isFailure(failed)).toBe(true)
    expect(yield* seqsOf(store)).toEqual([])
    expect(yield* appendIn(store, [grant("g-2")])).toEqual([1])
  })

const secondChargeSkipped = (store: LedgerStore) =>
  Effect.gen(function* () {
    yield* appendIn(store, [grant("g-1"), charged("g-1")])
    expect(yield* appendIn(store, [charged("g-1")])).toEqual([])
    expect(yield* seqsOf(store)).toEqual([1, 2])
  })

const chargeAfterCancelRefused = (store: LedgerStore) =>
  Effect.gen(function* () {
    yield* appendIn(store, [grant("g-1"), canceled("g-1")])
    const refused = yield* Effect.flip(appendIn(store, [reading, charged("g-1")]))
    expect(refused).toEqual(new GrantSettled({ grantId: GrantId.make("g-1") }))
    expect(yield* seqsOf(store)).toEqual([1, 2])
  })

const cancelAfterChargeRefused = (store: LedgerStore) =>
  Effect.gen(function* () {
    yield* appendIn(store, [grant("g-1"), charged("g-1")])
    const refused = yield* Effect.flip(appendIn(store, [canceled("g-1")]))
    expect(refused).toEqual(new GrantSettled({ grantId: GrantId.make("g-1") }))
  })

const busyWhileLocked = (store: LedgerStore, path: string) =>
  Effect.gen(function* () {
    const result = yield* Effect.scoped(
      Effect.flatMap(holdWriteLock(path), () => Effect.flip(appendIn(store, [grant("g-1")]))),
    )
    expect(result).toEqual(new LedgerBusy())
    expect(yield* seqsOf(store)).toEqual([])
  })

const secondConnectionContinues = (store: LedgerStore, path: string) =>
  Effect.gen(function* () {
    yield* appendIn(store, [grant("g-1")])
    const other = yield* Effect.scoped(
      Effect.flatMap(openLedger(path, busyMillis), (second) => appendIn(second, [grant("g-2")])),
    )
    expect(other).toEqual([2])
    expect(yield* seqsOf(store)).toEqual([1, 2])
  })

// Two transactions on one store whose bodies yield, run concurrently.
const appendAfterYield = (store: LedgerStore, id: string) =>
  store.transact((tx) => Effect.flatMap(Effect.yieldNow, () => tx.append([grant(id)])))

const overlappingTransactionsSerialize = (store: LedgerStore) =>
  Effect.gen(function* () {
    const results = yield* Effect.all([appendAfterYield(store, "g-1"), appendAfterYield(store, "g-2")], {
      concurrency: 2,
    })
    expect(Arr.sort(Arr.flatten(results), Order.Number)).toEqual([1, 2])
    expect(yield* rowsOf(store)).toHaveLength(2)
  })

describe("SQLite ledger store", () => {
  it.effect("assigns gap-free seqs ordered across tables", () => withLedger(gapFreeAcrossTables))
  it.effect("rolls back a failed transaction with no row and no gap", () =>
    withLedger(rollbackLeavesNoGap),
  )
  it.effect("skips a second charge of a grant", () => withLedger(secondChargeSkipped))
  it.effect("refuses a charge after a cancel and writes nothing", () =>
    withLedger(chargeAfterCancelRefused),
  )
  it.effect("refuses a cancel after a charge", () => withLedger(cancelAfterChargeRefused))
  it.effect("returns LedgerBusy with nothing written while another connection holds the lock", () =>
    withLedger(busyWhileLocked),
  )
  it.effect("continues seqs from another connection's commits", () =>
    withLedger(secondConnectionContinues),
  )
  it.effect("serializes overlapping transactions on one store", () =>
    withLedger(overlappingTransactionsSerialize),
  )
})
