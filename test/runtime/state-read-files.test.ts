// The read-only readers create and write no file (review item B11; the
// owner's ruling of 2026-11-20). A writer opens a store, writes and
// closes; the store's directory then keeps its entries, its time and
// every byte through a read, except SQLite's shared-memory index (`-shm`),
// where every WAL reader records its read mark. This holds only when the
// writer leaves the WAL and `-shm` files in place on close: otherwise a
// read-only connection creates both and cannot remove them.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Option } from "effect"
import type { Scope } from "effect"
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { LedgerBound, LogPosition } from "../../src/domain/events.ts"
import { Windows } from "../../src/domain/window.ts"
import { openLedger } from "../../src/runtime/ledger-sqlite.ts"
import { openProjectLog } from "../../src/runtime/project-log.ts"
import { openLedgerReader, openLogReader } from "../../src/runtime/state-read.ts"
import { reading } from "../program/session-harness.ts"

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

describe("the read-only readers after a writer has closed", () => {
  it.live("read the project log and leave its directory as it was, apart from -shm", () =>
    withDir(logReadLeavesFiles),
  )
  it.live("read the ledger and leave its directory as it was, apart from -shm", () =>
    withDir(ledgerReadLeavesFiles),
  )
})
