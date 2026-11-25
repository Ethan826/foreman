// The read-only readers create and write no file (review item B11; the
// owner's ruling of 2026-11-20). A writer opens a store, writes and
// closes; the store's directory then keeps its entries, its time and
// every byte through a read, except SQLite's shared-memory index (`-shm`),
// where every WAL reader records its read mark. This holds only when the
// writer leaves the WAL and `-shm` files in place on close: otherwise a
// read-only connection creates both and cannot remove them.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Option, Result } from "effect"
import type { Scope } from "effect"
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { LedgerBound, LogPosition, ProjectLogError } from "../../src/domain/events.ts"
import { LedgerError } from "../../src/domain/ledger.ts"
import { StoreNewer, StoreVersionNewer } from "../../src/domain/store-version.ts"
import { Windows } from "../../src/domain/window.ts"
import { openLedger } from "../../src/runtime/ledger-sqlite.ts"
import { openProjectLog } from "../../src/runtime/project-log.ts"
import { openLedgerReader, openLogReader } from "../../src/runtime/state-read.ts"
import { reading } from "../program/session-harness.ts"
import { rawExec, setVersion, versionOf } from "./store-version-fixtures.ts"

const busyMillis = 50

/**
 * The directory's time and, for each entry, its name; with its time and
 * bytes unless it is the `-shm` file, which the ruling lets change.
 */
const filesOf = (dir: string) => ({
  directory: mtimeOf(dir),
  entries: Arr.map(readdirSync(dir).sort(), (name) =>
    name.endsWith("-shm") ? { name } : { name, mtime: mtimeOf(`${dir}/${name}`), bytes: bytesOf(`${dir}/${name}`) },
  ),
})

const mtimeOf = (path: string) => statSync(path, { bigint: false }).mtimeMs
const bytesOf = (path: string) => Array.from(readFileSync(path))

const withDir = <A, E>(use: (dir: string) => Effect.Effect<A, E, Scope.Scope>) => {
  const dir = mkdtempSync(`${tmpdir()}/tarlatan-read-files-`)
  return Effect.ensuring(
    Effect.scoped(use(dir)),
    Effect.sync(() => {
      rmSync(dir, { recursive: true, force: true })
    }),
  )
}

const writtenLog = (path: string) =>
  Effect.scoped(
    Effect.flatMap(openProjectLog(path, busyMillis), (log) =>
      log.append(LogPosition.make(0), [new LedgerBound({ path: "/ledger/ledger.sqlite" })]),
    ),
  )

const writtenLedger = (path: string) =>
  Effect.scoped(
    Effect.flatMap(openLedger(path, busyMillis), (ledger) =>
      ledger.transact((tx) => tx.append([reading(Windows.FiveHour), reading(Windows.Weekly)])),
    ),
  )

const logReadLeavesFiles = (dir: string) =>
  Effect.gen(function* () {
    yield* writtenLog(`${dir}/log.sqlite`)
    const before = filesOf(dir)
    const events = yield* Effect.scoped(
      Effect.flatMap(Effect.flatMap(openLogReader(`${dir}/log.sqlite`, busyMillis), Effect.fromOption), (log) =>
        log.readFrom(LogPosition.make(0)),
      ),
    )
    expect(events).toHaveLength(1)
    expect(filesOf(dir)).toEqual(before)
  })

const ledgerReadLeavesFiles = (dir: string) =>
  Effect.gen(function* () {
    yield* writtenLedger(`${dir}/ledger.sqlite`)
    const before = filesOf(dir)
    const reader = yield* openLedgerReader(`${dir}/ledger.sqlite`, busyMillis)
    const snapshot = yield* Effect.flatMap(Effect.fromOption(reader), (ledger) => ledger.read)
    expect(Option.isSome(reader)).toBe(true)
    expect(Arr.isReadonlyArrayNonEmpty(snapshot.entries)).toBe(true)
    expect(filesOf(dir)).toEqual(before)
  })

// The readers and the store format version (dogfood-5): they expose the
// version as read and stamp nothing, and a newer or negative store fails
// the open before any row is read.
const logAt = (dir: string) => `${dir}/log.sqlite`
const ledgerAt = (dir: string) => `${dir}/ledger.sqlite`

/** A log and a ledger written by this release, then set back to `version` as v0.1.0 or a newer release would leave them. */
const storesAt = (dir: string, version: number) =>
  Effect.gen(function* () {
    yield* writtenLog(logAt(dir))
    yield* writtenLedger(ledgerAt(dir))
    yield* setVersion(logAt(dir), version)
    yield* setVersion(ledgerAt(dir), version)
  })

/**
 * Stores at `version` that each hold one row that would not decode, so a
 * reader that read rows before deciding would fail with a decode error.
 */
const undecodableStoresAt = (dir: string, version: number) =>
  Effect.gen(function* () {
    yield* storesAt(dir, version)
    yield* rawExec(logAt(dir), "INSERT INTO events (position, body) VALUES (2, 'not an event')")
    yield* rawExec(ledgerAt(dir), "INSERT INTO readings (seq, body, grantId) VALUES (99, 'not a row', NULL)")
  })

const readersStampNothing = (dir: string) =>
  Effect.gen(function* () {
    yield* storesAt(dir, 0)
    const versions = yield* Effect.scoped(
      Effect.gen(function* () {
        const log = yield* Effect.flatMap(openLogReader(logAt(dir), busyMillis), Effect.fromOption)
        const ledger = yield* Effect.flatMap(openLedgerReader(ledgerAt(dir), busyMillis), Effect.fromOption)
        yield* ledger.read
        return [log.version, ledger.version]
      }),
    )
    expect(versions).toEqual([0, 0])
    expect([yield* versionOf(logAt(dir)), yield* versionOf(ledgerAt(dir))]).toEqual([0, 0])
  })

const newerRefusedUnread = (dir: string) =>
  Effect.gen(function* () {
    yield* undecodableStoresAt(dir, 2)
    const log = yield* Effect.flip(openLogReader(logAt(dir), busyMillis))
    const ledger = yield* Effect.flip(openLedgerReader(ledgerAt(dir), busyMillis))
    expect(log).toEqual(new StoreVersionNewer({ path: logAt(dir), found: 2, known: 1 }))
    expect(ledger).toEqual(new StoreVersionNewer({ path: ledgerAt(dir), found: 2, known: 1 }))
  })

const negativeRefusedUnread = (dir: string) =>
  Effect.gen(function* () {
    yield* undecodableStoresAt(dir, -1)
    const reason = "store format version -1 is not one tarlatan writes"
    const log = yield* Effect.flip(openLogReader(logAt(dir), busyMillis))
    const ledger = yield* Effect.flip(openLedgerReader(ledgerAt(dir), busyMillis))
    expect(log).toEqual(new ProjectLogError({ reason }))
    expect(ledger).toEqual(new LedgerError({ reason }))
  })

/**
 * Gives the already-written stores at `dir` one row each that would not
 * decode and stamps them `version`, all through raw connections, so no
 * writer of this release opens them (review finding F2).
 */
const undecodableStampedRaw = (dir: string, version: number) =>
  Effect.gen(function* () {
    yield* rawExec(logAt(dir), "INSERT INTO events (position, body) VALUES (2, 'not an event')")
    yield* rawExec(ledgerAt(dir), "INSERT INTO readings (seq, body, grantId) VALUES (99, 'not a row', NULL)")
    yield* setVersion(logAt(dir), version)
    yield* setVersion(ledgerAt(dir), version)
  })

/**
 * Review findings F2 and F6: readers opened on stores at 1, then another
 * connection stamps the stores 2 and gives each a row that would not
 * decode. A read that took its rows before deciding on its own snapshot's
 * version would fail with a decode error; each read fails with
 * `StoreVersionNewer`, found 2, instead.
 */
const stampedAfterOpenRefused = (dir: string) =>
  Effect.gen(function* () {
    yield* storesAt(dir, 1)
    const log = yield* Effect.flatMap(openLogReader(logAt(dir), busyMillis), Effect.fromOption)
    const ledger = yield* Effect.flatMap(openLedgerReader(ledgerAt(dir), busyMillis), Effect.fromOption)
    yield* undecodableStampedRaw(dir, 2)
    expect([log.version, ledger.version]).toEqual([1, 1])
    expect(yield* Effect.flip(log.readFrom(LogPosition.make(0)))).toEqual(
      new StoreVersionNewer({ path: logAt(dir), found: 2, known: 1 }),
    )
    expect(yield* Effect.flip(ledger.read)).toEqual(new StoreVersionNewer({ path: ledgerAt(dir), found: 2, known: 1 }))
  })

/**
 * Review finding F6: the ledger's snapshot gives a refusal found in its
 * own read as a value, with the version that read found, and reads no
 * row; this is what status turns into its finding.
 */
const stampedAfterOpenSnapshot = (dir: string) =>
  Effect.gen(function* () {
    yield* storesAt(dir, 1)
    const ledger = yield* Effect.flatMap(openLedgerReader(ledgerAt(dir), busyMillis), Effect.fromOption)
    yield* undecodableStampedRaw(dir, 2)
    const read = yield* ledger.snapshot
    expect(read.version).toBe(2)
    expect(read.rows).toEqual(Result.fail(new StoreNewer({ found: 2 })))
  })

/**
 * Review finding F6: readers opened on stores at 0, which another
 * connection then stamps 1, the same format. Each read decides on its own
 * snapshot, so the rows read normally and the snapshot's version is 1,
 * while the version the open read stays 0.
 */
const stampedOneAfterOpenRead = (dir: string) =>
  Effect.gen(function* () {
    yield* storesAt(dir, 0)
    const log = yield* Effect.flatMap(openLogReader(logAt(dir), busyMillis), Effect.fromOption)
    const ledger = yield* Effect.flatMap(openLedgerReader(ledgerAt(dir), busyMillis), Effect.fromOption)
    const rowsAtZero = yield* ledger.read
    yield* setVersion(logAt(dir), 1)
    yield* setVersion(ledgerAt(dir), 1)
    const events = yield* log.versionedFrom(LogPosition.make(0))
    const versioned = yield* ledger.snapshot
    expect([log.version, ledger.version]).toEqual([0, 0])
    expect(events.version).toBe(1)
    expect(Arr.map(events.events, (logged) => logged.event)).toEqual([
      new LedgerBound({ path: "/ledger/ledger.sqlite" }),
    ])
    expect(Arr.isReadonlyArrayNonEmpty(rowsAtZero.entries)).toBe(true)
    expect(versioned.version).toBe(1)
    expect(versioned.rows).toEqual(Result.succeed(rowsAtZero))
    expect(yield* ledger.read).toEqual(rowsAtZero)
  })

describe("the read-only readers and the store format version", () => {
  it.live("refuse a read with StoreVersionNewer when the store was stamped 2 after the open", () =>
    withDir(stampedAfterOpenRefused),
  )
  it.live("give the ledger's refusal in a read as a value with the version that read found", () =>
    withDir(stampedAfterOpenSnapshot),
  )
  it.live("read the rows normally when the store was stamped from 0 to 1 after the open", () =>
    withDir(stampedOneAfterOpenRead),
  )
  it.live("expose a log and a ledger at 0 as 0 and leave both at 0", () => withDir(readersStampNothing))
  it.live("refuse a newer log and ledger with StoreVersionNewer before reading a row", () =>
    withDir(newerRefusedUnread),
  )
  it.live("refuse a log and a ledger below 0 with their own errors before reading a row", () =>
    withDir(negativeRefusedUnread),
  )
})

// Review finding F8: a reader holds one connection, and each read is a
// transaction on it, so two reads at once on one reader must queue. The
// stores hold enough rows that the reads' decoding yields and overlaps.
const manyRows = 30_000

/** A log holding `manyRows` events. */
const manyEventsLog = (path: string) =>
  Effect.scoped(
    Effect.flatMap(openProjectLog(path, busyMillis), (log) =>
      log.append(
        LogPosition.make(0),
        Arr.makeBy(manyRows, () => new LedgerBound({ path: "/ledger/ledger.sqlite" })),
      ),
    ),
  )

/** A ledger holding `manyRows` readings. */
const manyRowsLedger = (path: string) =>
  Effect.scoped(
    Effect.flatMap(openLedger(path, busyMillis), (ledger) =>
      ledger.transact((tx) => tx.append(Arr.makeBy(manyRows, () => reading(Windows.FiveHour)))),
    ),
  )

const concurrentLogReads = (dir: string) =>
  Effect.gen(function* () {
    yield* manyEventsLog(logAt(dir))
    const log = yield* Effect.flatMap(openLogReader(logAt(dir), busyMillis), Effect.fromOption)
    const [events, versioned] = yield* Effect.all(
      [log.readFrom(LogPosition.make(0)), log.versionedFrom(LogPosition.make(0))],
      { concurrency: "unbounded" },
    )
    expect(events).toHaveLength(manyRows)
    expect(versioned.events).toHaveLength(manyRows)
  })

const concurrentLedgerReads = (dir: string) =>
  Effect.gen(function* () {
    yield* manyRowsLedger(ledgerAt(dir))
    const ledger = yield* Effect.flatMap(openLedgerReader(ledgerAt(dir), busyMillis), Effect.fromOption)
    const [rows, versioned] = yield* Effect.all([ledger.read, ledger.snapshot], { concurrency: "unbounded" })
    expect(rows.entries).toHaveLength(manyRows)
    expect(versioned.rows).toEqual(Result.succeed(rows))
  })

describe("two reads at once on one reader", () => {
  it.live("both return every event of the log", () => withDir(concurrentLogReads), 60_000)
  it.live("both return every row of the ledger", () => withDir(concurrentLedgerReads), 60_000)
})

describe("the read-only readers after a writer has closed", () => {
  it.live("read the project log and leave its directory as it was, apart from -shm", () =>
    withDir(logReadLeavesFiles),
  )
  it.live("read the ledger and leave its directory as it was, apart from -shm", () =>
    withDir(ledgerReadLeavesFiles),
  )
})
