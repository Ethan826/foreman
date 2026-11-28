// The project log's compare-and-append and the project lock, against real
// files in a temporary directory.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Exit, Option } from "effect"
import type { Scope } from "effect"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import {
  Adopted,
  FindingsRecorded,
  LedgerBound,
  LockHeld,
  LogPosition,
  PositionMoved,
  type ProjectLog,
  ProjectLogError,
  Released,
} from "../../src/domain/events.ts"
import { OpId, Revision } from "../../src/domain/ids.ts"
import { SessionId } from "../../src/domain/session.ts"
import { knownLogVersion, StoreVersionNewer } from "../../src/domain/store-version.ts"
import { openProjectLog, openProjectLogWith } from "../../src/runtime/project-log.ts"
import { tryLock } from "../../src/runtime/project-lock.ts"
import { expectConfiguredBusyTimeout } from "./recording-connect.ts"
import {
  dataVersionWatch,
  hasWalFiles,
  rawExec,
  rollbackStoreAt,
  setVersion,
  versionOf,
} from "./store-version-fixtures.ts"

const busyMillis = 50
const at = (n: number) => LogPosition.make(n)
const bound = new LedgerBound({ path: "/ledger/ledger.sqlite" })
const released = new Released({ opId: OpId.make("op-1") })
const adopted = new Adopted({ revision: Revision.make("a".repeat(40)) })
/** The event that raises the log's format to 2 (v0.2.0, dogfood-6). */
const findingsRecorded = new FindingsRecorded({
  sessionId: SessionId.make("s-1"),
  reviewOpId: OpId.make("op-2"),
  findings: [
    { id: "F1", severity: "major", file: Option.some("src/a.ts"), summary: "Wrong." },
    { id: "F2", severity: "minor", file: Option.none(), summary: "Unclear." },
  ],
})

const removeDir = (dir: string) =>
  Effect.sync(() => {
    rmSync(dir, { recursive: true, force: true })
  })

// Runs `use` with a fresh temporary directory.
const withDir = <A, E>(use: (dir: string) => Effect.Effect<A, E, Scope.Scope>) => {
  const dir = mkdtempSync(`${tmpdir()}/tarlatan-log-`)
  return Effect.ensuring(Effect.scoped(use(dir)), removeDir(dir))
}
const withLog = <A, E>(use: (log: ProjectLog, dir: string) => Effect.Effect<A, E, Scope.Scope>) =>
  withDir((dir) => Effect.flatMap(openProjectLog(`${dir}/log.sqlite`, busyMillis), (log) => use(log, dir)))

const eventsOf = (log: ProjectLog) =>
  Effect.map(log.readFrom(at(0)), (logged) => Arr.map(logged, (l) => [l.position, l.event]))

const appendsInOrder = (log: ProjectLog) =>
  Effect.gen(function* () {
    expect(yield* log.append(at(0), [bound, released])).toBe(2)
    expect(yield* log.append(at(2), [adopted])).toBe(3)
    expect(yield* eventsOf(log)).toEqual([
      [1, bound],
      [2, released],
      [3, adopted],
    ])
    expect(Arr.map(yield* log.readFrom(at(2)), (l) => l.position)).toEqual([3])
  })

const staleAppendRefused = (log: ProjectLog) =>
  Effect.gen(function* () {
    yield* log.append(at(0), [bound])
    const moved = yield* Effect.flip(log.append(at(0), [released, adopted]))
    expect(moved).toEqual(new PositionMoved({ expected: at(0), actual: at(1) }))
    expect(yield* eventsOf(log)).toEqual([[1, bound]])
  })

const secondHolderRefused = (dir: string) =>
  Effect.gen(function* () {
    const path = `${dir}/project.lock`
    yield* tryLock(path)
    const refused = yield* Effect.flip(Effect.scoped(tryLock(path)))
    expect(refused).toEqual(new LockHeld({ path }))
  })

const lockFreedAtScopeEnd = (dir: string) =>
  Effect.gen(function* () {
    const path = `${dir}/project.lock`
    yield* Effect.scoped(tryLock(path))
    yield* Effect.scoped(tryLock(path))
  })

// Two appends at the same expected position, run concurrently on one log:
// one wins, the other fails with PositionMoved, and nothing else fails.
const overlappingAppendsSerialize = (log: ProjectLog) =>
  Effect.gen(function* () {
    const exits = yield* Effect.all(
      [Effect.exit(log.append(at(0), [bound])), Effect.exit(log.append(at(0), [released]))],
      { concurrency: 2 },
    )
    expect(Arr.map(exits, (e) => (Exit.isSuccess(e) ? "ok" : "moved"))).toEqual(["ok", "moved"])
    expect(Arr.length(yield* log.readFrom(at(0)))).toBe(1)
  })

// The log's format version (dogfood-5, owner rulings P1 and P2).
const logIn = (dir: string) => `${dir}/log.sqlite`

/** Opens the log at `path` for a scope of its own and runs `use` on it. */
const openedOnce = <A, E>(path: string, use: (log: ProjectLog) => Effect.Effect<A, E>) =>
  Effect.scoped(Effect.flatMap(openProjectLog(path, busyMillis), use))

const newLogAtOne = (dir: string) =>
  Effect.gen(function* () {
    yield* openedOnce(logIn(dir), () => Effect.void)
    expect(yield* versionOf(logIn(dir))).toBe(1)
  })

const unstampedLogStamped = (dir: string) =>
  Effect.gen(function* () {
    const path = logIn(dir)
    yield* openedOnce(path, (log) => log.append(at(0), [bound, released, adopted]))
    yield* setVersion(path, 0)
    expect(yield* versionOf(path)).toBe(0)
    const events = yield* openedOnce(path, eventsOf)
    expect(yield* versionOf(path)).toBe(1)
    expect(events).toEqual([
      [1, bound],
      [2, released],
      [3, adopted],
    ])
  })

const newerLogUntouched = (dir: string) =>
  Effect.gen(function* () {
    const path = logIn(dir)
    yield* rollbackStoreAt(path, knownLogVersion + 1)
    const before = readFileSync(path)
    const refused = yield* Effect.flip(openedOnce(path, () => Effect.void))
    expect(refused).toEqual(new StoreVersionNewer({ path, found: 3, known: 2 }))
    expect(readFileSync(path)).toEqual(before)
    expect(hasWalFiles(path)).toBe(false)
  })

const negativeLogUntouched = (dir: string) =>
  Effect.gen(function* () {
    const path = logIn(dir)
    yield* rollbackStoreAt(path, -1)
    const before = readFileSync(path)
    const refused = yield* Effect.flip(openedOnce(path, () => Effect.void))
    expect(refused).toEqual(new ProjectLogError({ reason: "store format version -1 is not one tarlatan writes" }))
    expect(readFileSync(path)).toEqual(before)
    expect(hasWalFiles(path)).toBe(false)
  })

// A current log's open commits nothing: the log is seeded at format 2
// (the known version) by appending `FindingsRecorded`, and another
// connection's `data_version` is the same before and after the open. The
// control at the end shows the watch sees a commit: an unconditional
// `user_version = 2` from another connection, the same version, as a
// write on open without a condition would run, changes it.
const currentLogCommitsNothing = (dir: string) =>
  Effect.gen(function* () {
    const path = logIn(dir)
    yield* openedOnce(path, (log) => log.append(at(0), [bound, findingsRecorded]))
    expect(yield* versionOf(path)).toBe(knownLogVersion)
    const dataVersion = yield* dataVersionWatch(path)
    const before = yield* dataVersion
    yield* openedOnce(path, () => Effect.void)
    expect(yield* dataVersion).toBe(before)
    yield* setVersion(path, knownLogVersion)
    expect(yield* dataVersion).not.toBe(before)
  })

// An older-readable log's open commits nothing either: the log is seeded
// at format 1 with existing events only, and another connection's
// `data_version` is the same before and after the open. A writer that
// rewrote `user_version = 1` on every open at 1 would keep the header
// value the same and pass the header-value tests; this watch catches it.
// The control is the same as above: an unconditional `user_version = 1`
// from another connection, the same version, changes it.
const olderReadableLogCommitsNothing = (dir: string) =>
  Effect.gen(function* () {
    const path = logIn(dir)
    yield* openedOnce(path, (log) => log.append(at(0), [bound, released]))
    expect(yield* versionOf(path)).toBe(1)
    const dataVersion = yield* dataVersionWatch(path)
    const before = yield* dataVersion
    yield* openedOnce(path, () => Effect.void)
    expect(yield* dataVersion).toBe(before)
    yield* setVersion(path, 1)
    expect(yield* dataVersion).not.toBe(before)
  })

// The raise (v0.2.0, dogfood-6): a log at 1 is raised to 2 by the first
// append that holds an event v0.1.1 does not decode, inside that append's
// transaction, and by nothing else.

/** The message of the append's refusal when its transaction reads `found`. */
const unwritableReason = (found: number) =>
  `project log format version ${String(found)} is not one this release appends to (it knows 2)`

const existingEventsKeepOne = (dir: string) =>
  Effect.gen(function* () {
    const path = logIn(dir)
    yield* openedOnce(path, (log) =>
      Effect.andThen(log.append(at(0), [bound, released]), log.append(at(2), [adopted])),
    )
    expect(yield* versionOf(path)).toBe(1)
  })

const findingsRaiseToTwo = (dir: string) =>
  Effect.gen(function* () {
    const path = logIn(dir)
    yield* openedOnce(path, (log) =>
      Effect.gen(function* () {
        yield* log.append(at(0), [bound])
        expect(yield* versionOf(path)).toBe(1)
        yield* log.append(at(1), [released, findingsRecorded])
        expect(yield* versionOf(path)).toBe(2)
        expect(yield* eventsOf(log)).toEqual([
          [1, bound],
          [2, released],
          [3, findingsRecorded],
        ])
      }),
    )
    expect(yield* versionOf(path)).toBe(2)
  })

const movedAppendKeepsOne = (dir: string) =>
  Effect.gen(function* () {
    const path = logIn(dir)
    const moved = yield* openedOnce(path, (log) =>
      Effect.andThen(log.append(at(0), [bound]), Effect.flip(log.append(at(0), [findingsRecorded]))),
    )
    expect(moved).toEqual(new PositionMoved({ expected: at(0), actual: at(1) }))
    expect(yield* versionOf(path)).toBe(1)
  })

const failedInsertKeepsOne = (dir: string) =>
  Effect.gen(function* () {
    const path = logIn(dir)
    const failed = yield* openedOnce(path, (log) =>
      Effect.gen(function* () {
        yield* log.append(at(0), [bound])
        yield* rawExec(path, "CREATE TRIGGER t BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'x'); END")
        return yield* Effect.flip(log.append(at(1), [findingsRecorded]))
      }),
    )
    expect(failed).toEqual(new ProjectLogError({ reason: "x" }))
    expect(yield* versionOf(path)).toBe(1)
  })

const stampedNewerAfterOpen = (dir: string) =>
  Effect.gen(function* () {
    const path = logIn(dir)
    const events = yield* openedOnce(path, (log) =>
      Effect.gen(function* () {
        yield* log.append(at(0), [bound])
        yield* setVersion(path, knownLogVersion + 1)
        const refused = yield* Effect.flip(log.append(at(1), [released]))
        expect(refused).toEqual(new ProjectLogError({ reason: unwritableReason(3) }))
        const raising = yield* Effect.flip(log.append(at(1), [findingsRecorded]))
        expect(raising).toEqual(new ProjectLogError({ reason: unwritableReason(3) }))
        return yield* eventsOf(log)
      }),
    )
    expect(events).toEqual([[1, bound]])
    expect(yield* versionOf(path)).toBe(3)
  })

const resetToZeroRaised = (dir: string) =>
  Effect.gen(function* () {
    const path = logIn(dir)
    yield* openedOnce(path, (log) =>
      Effect.gen(function* () {
        yield* log.append(at(0), [bound])
        yield* setVersion(path, 0)
        yield* log.append(at(1), [findingsRecorded])
      }),
    )
    expect(yield* versionOf(path)).toBe(2)
  })

const raisedLogReopened = (dir: string) =>
  Effect.gen(function* () {
    const path = logIn(dir)
    yield* openedOnce(path, (log) => log.append(at(0), [findingsRecorded]))
    const events = yield* openedOnce(path, (log) => Effect.andThen(log.append(at(1), [bound]), eventsOf(log)))
    expect(events).toEqual([
      [1, findingsRecorded],
      [2, bound],
    ])
    expect(yield* versionOf(path)).toBe(2)
  })

describe("project log format raise", () => {
  it.effect("leaves a log at 1 after appending only events v0.1.1 decodes", () => withDir(existingEventsKeepOne))
  it.effect("raises a log at 1 to 2 with the append that holds FindingsRecorded", () => withDir(findingsRaiseToTwo))
  it.effect("leaves a log at 1 when that append is refused with PositionMoved", () => withDir(movedAppendKeepsOne))
  it.effect("rolls the raise back with an insert that fails in the same transaction", () =>
    withDir(failedInsertKeepsOne),
  )
  it.effect("fails an append with ProjectLogError naming 3 when the log was stamped 3 after the open", () =>
    withDir(stampedNewerAfterOpen),
  )
  it.effect("treats a log reset to 0 after the open as 1 and raises it", () => withDir(resetToZeroRaised))
  it.effect("reopens and appends to a log at 2 without changing its version", () => withDir(raisedLogReopened))
})

describe("project log format version", () => {
  it.effect("creates a new log at version 1", () => withDir(newLogAtOne))
  it.effect("stamps a log at 0 with 1 and keeps every event", () => withDir(unstampedLogStamped))
  it.effect("refuses a newer log with StoreVersionNewer and leaves its bytes and no WAL files", () =>
    withDir(newerLogUntouched),
  )
  it.effect("refuses a log below 0 with ProjectLogError and leaves its bytes and no WAL files", () =>
    withDir(negativeLogUntouched),
  )
  it.effect("commits nothing when it opens a current log", () => withDir(currentLogCommitsNothing))
  it.effect("commits nothing when it opens a log at 1, which it reads without raising", () =>
    withDir(olderReadableLogCommitsNothing),
  )
})

/**
 * The busy-wait contract (Domain's `ProjectLog`; dogfood-6f, owner ruling
 * of 2026-11-28): the adapter meets it by setting SQLite's `busy_timeout`
 * to the configured value, and SQLite's documented behaviour is the
 * evidence for the wait. This checks the adapter's half: the connection
 * the production open (`openProjectLogWith`, which `openProjectLog` is
 * with the real connect function) makes carries each configured value.
 */
const busyTimeoutConfigured = (dir: string) => expectConfiguredBusyTimeout(openProjectLogWith, `${dir}/log.sqlite`)

describe("project log busy-wait contract", () => {
  it.effect("opens its connection with busy_timeout set to the configured value", () =>
    withDir(busyTimeoutConfigured),
  )
})

describe("project log", () => {
  it.effect("appends at the expected position and reads back in order", () => withLog(appendsInOrder))
  it.effect("refuses an append at a stale position and writes nothing", () =>
    withLog(staleAppendRefused),
  )
  it.effect("serializes overlapping appends on one log", () => withLog(overlappingAppendsSerialize))
})

describe("project lock", () => {
  it.effect("refuses a second holder", () => withDir(secondHolderRefused))
  it.effect("is free again when its holder's scope ends", () => withDir(lockFreedAtScopeEnd))
})
