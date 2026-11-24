// The project log's compare-and-append and the project lock, against real
// files in a temporary directory.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Exit } from "effect"
import type { Scope } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import {
  Adopted,
  LedgerBound,
  LockHeld,
  LogPosition,
  PositionMoved,
  type ProjectLog,
  Released,
} from "../../src/domain/events.ts"
import { OpId, Revision } from "../../src/domain/ids.ts"
import { openProjectLog } from "../../src/runtime/project-log.ts"
import { tryLock } from "../../src/runtime/project-lock.ts"

const busyMillis = 50
const at = (n: number) => LogPosition.make(n)
const bound = new LedgerBound({ path: "/ledger/ledger.sqlite" })
const released = new Released({ opId: OpId.make("op-1") })
const adopted = new Adopted({ revision: Revision.make("a".repeat(40)) })

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
