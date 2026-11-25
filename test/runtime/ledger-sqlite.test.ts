// The SQLite ledger store against real database files in a temporary
// directory: seq order, rollback, the settle rules and the write lock.
import { describe, expect, it } from "@effect/vitest"
import { Database } from "bun:sqlite"
import { Array as Arr, Effect, Exit, Option, Order } from "effect"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { Clients } from "../../src/domain/clients.ts"
import { GrantId, OpId, ProjectId } from "../../src/domain/ids.ts"
import {
  Charged,
  Grant,
  GrantCanceled,
  GrantSettled,
  LedgerBusy,
  LedgerError,
  type LedgerRow,
  type LedgerSnapshot,
  type LedgerStore,
  type LedgerTx,
  ReadingRow,
  Reserve,
} from "../../src/domain/ledger.ts"
import { StoreVersionNewer } from "../../src/domain/store-version.ts"
import { Windows } from "../../src/domain/window.ts"
import { openLedger } from "../../src/runtime/ledger-sqlite.ts"
import { startChild } from "./child-process.ts"
import { dataVersionWatch, hasWalFiles, rollbackStoreAt, setVersion, versionOf } from "./store-version-fixtures.ts"

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
  const dir = mkdtempSync(`${tmpdir()}/tarlatan-ledger-`)
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

// A batch whose first row is valid and whose second is refused (a charge
// of a grant canceled in an earlier transaction) writes neither row.
const failedBatchWritesNothing = (store: LedgerStore) =>
  Effect.gen(function* () {
    yield* appendIn(store, [grant("g-1"), canceled("g-1")])
    const refused = yield* Effect.flip(appendIn(store, [grant("g-2"), charged("g-1")]))
    expect(refused).toEqual(new GrantSettled({ grantId: GrantId.make("g-1") }))
    expect(yield* rowsOf(store)).toEqual([grant("g-1"), canceled("g-1")])
    expect(yield* appendIn(store, [reading])).toEqual([3])
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

// A child process holds the write lock for this long, well inside the
// busy timeout this test opens its store with.
const childHoldMillis = 300
const waitingBusyMillis = 10_000

// The write starts while a child process holds the lock (its ready file
// is written after BEGIN IMMEDIATE) and succeeds once the child releases
// it. A second process is needed: SQLite's busy wait is synchronous and
// would block this process's event loop, so the lock holder could not
// release from here.
const waitsThenSucceeds = (dir: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const path = `${dir}/ledger.sqlite`
      const store = yield* openLedger(path, waitingBusyMillis)
      yield* startChild("hold-ledger-write.ts", path, `${dir}/ready`, [String(childHoldMillis)])
      expect(yield* appendIn(store, [grant("g-1")])).toEqual([1])
      expect(yield* rowsOf(store)).toEqual([grant("g-1")])
    }),
  )

const withDir = <A, E>(use: (dir: string) => Effect.Effect<A, E>) => {
  const dir = mkdtempSync(`${tmpdir()}/tarlatan-ledger-`)
  return Effect.ensuring(use(dir), removeDir(dir))
}

describe("SQLite ledger store across processes", () => {
  it.live("waits within busy_timeout for another process's write lock, then writes", () =>
    withDir(waitsThenSucceeds),
  )
})

// The ledger's format version (dogfood-5, owner rulings P1 and P2).
const ledgerIn = (dir: string) => `${dir}/ledger.sqlite`

/** Opens the ledger at `path` for a scope of its own and runs `use` on it. */
const openedOnce = <A, E>(path: string, use: (store: LedgerStore) => Effect.Effect<A, E>) =>
  Effect.scoped(Effect.flatMap(openLedger(path, busyMillis), use))

const newLedgerAtOne = (dir: string) =>
  Effect.gen(function* () {
    yield* openedOnce(ledgerIn(dir), () => Effect.void)
    expect(yield* versionOf(ledgerIn(dir))).toBe(1)
  })

const unstampedLedgerStamped = (dir: string) =>
  Effect.gen(function* () {
    const path = ledgerIn(dir)
    yield* openedOnce(path, (store) => appendIn(store, [grant("g-1"), reading, charged("g-1")]))
    yield* setVersion(path, 0)
    expect(yield* versionOf(path)).toBe(0)
    const rows = yield* openedOnce(path, rowsOf)
    expect(yield* versionOf(path)).toBe(1)
    expect(rows).toEqual([grant("g-1"), reading, charged("g-1")])
  })

const newerLedgerUntouched = (dir: string) =>
  Effect.gen(function* () {
    const path = ledgerIn(dir)
    yield* rollbackStoreAt(path, 2)
    const before = readFileSync(path)
    const refused = yield* Effect.flip(openedOnce(path, () => Effect.void))
    expect(refused).toEqual(new StoreVersionNewer({ path, found: 2, known: 1 }))
    expect(readFileSync(path)).toEqual(before)
    expect(hasWalFiles(path)).toBe(false)
  })

const negativeLedgerUntouched = (dir: string) =>
  Effect.gen(function* () {
    const path = ledgerIn(dir)
    yield* rollbackStoreAt(path, -1)
    const before = readFileSync(path)
    const refused = yield* Effect.flip(openedOnce(path, () => Effect.void))
    expect(refused).toEqual(new LedgerError({ reason: "store format version -1 is not one tarlatan writes" }))
    expect(readFileSync(path)).toEqual(before)
    expect(hasWalFiles(path)).toBe(false)
  })

// A current ledger's open commits nothing: another connection's
// `data_version` is the same before and after it. The control at the end
// shows the watch sees a commit: an unconditional `user_version = 1`
// from another connection, as a stamp without the condition would run,
// changes it.
const currentLedgerCommitsNothing = (dir: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const path = ledgerIn(dir)
      yield* openedOnce(path, (store) => appendIn(store, [grant("g-1")]))
      const dataVersion = yield* dataVersionWatch(path)
      const before = yield* dataVersion
      yield* openedOnce(path, () => Effect.void)
      expect(yield* dataVersion).toBe(before)
      yield* setVersion(path, 1)
      expect(yield* dataVersion).not.toBe(before)
    }),
  )

describe("SQLite ledger store format version", () => {
  it.effect("creates a new ledger at version 1", () => withDir(newLedgerAtOne))
  it.effect("stamps a ledger at 0 with 1 and keeps every row", () => withDir(unstampedLedgerStamped))
  it.effect("refuses a newer ledger with StoreVersionNewer and leaves its bytes and no WAL files", () =>
    withDir(newerLedgerUntouched),
  )
  it.effect("refuses a ledger below 0 with LedgerError and leaves its bytes and no WAL files", () =>
    withDir(negativeLedgerUntouched),
  )
  it.effect("commits nothing when it opens a current ledger", () => withDir(currentLedgerCommitsNothing))
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
  it.effect("writes no row of a batch whose second row is refused, the first included", () =>
    withLedger(failedBatchWritesNothing),
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
