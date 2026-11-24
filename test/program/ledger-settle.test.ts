// The owner's `ledger settle` (plan Task B4) against real lock, log and
// ledger files: refused while another holder has the project lock; settles
// orphans and finished steps; lists in-flight steps with their pgid. The
// command is given only the lock path, the log and the ledger, so it has
// no way to signal a process or run git.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Option, Schema } from "effect"
import type { Scope } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { Clients } from "../../src/domain/clients.ts"
import { Finished, Intended, Launched, LockHeld, LogPosition, type ProjectLog } from "../../src/domain/events.ts"
import { GrantId, OpId, ProjectId, Revision, TrancheId } from "../../src/domain/ids.ts"
import { Charged, Grant, GrantCanceled, type LedgerStore } from "../../src/domain/ledger.ts"
import { Success } from "../../src/domain/outcomes.ts"
import { Roles } from "../../src/domain/roles.ts"
import { Windows } from "../../src/domain/window.ts"
import { ledgerSettle } from "../../src/program/ledger-settle.ts"
import { openLedger } from "../../src/runtime/ledger-sqlite.ts"
import { openProjectLog } from "../../src/runtime/project-log.ts"
import { tryLock } from "../../src/runtime/project-lock.ts"

const busyMillis = 50
const alpha = ProjectId.make("alpha")
const estimate = [{ window: Windows.FiveHour, points: 15 }]
const grant = (n: number) =>
  new Grant({
    grantId: GrantId.make(`g-${String(n)}`),
    project: alpha,
    opId: OpId.make(`op-${String(n)}`),
    provider: Clients.Claude,
    points: estimate,
    issuedAt: 0,
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

interface Files {
  readonly lockPath: string
  readonly log: ProjectLog
  readonly store: LedgerStore
}

const removeDir = (dir: string) =>
  Effect.sync(() => {
    rmSync(dir, { recursive: true, force: true })
  })
const openAll = (dir: string) =>
  Effect.gen(function* () {
    const log = yield* openProjectLog(`${dir}/log.sqlite`, busyMillis)
    const store = yield* openLedger(`${dir}/ledger.sqlite`, busyMillis)
    return { lockPath: `${dir}/project.lock`, log, store }
  })
const withFiles = <A, E>(use: (files: Files) => Effect.Effect<A, E, Scope.Scope>) => {
  const dir = mkdtempSync(`${tmpdir()}/tarlatan-settle-`)
  return Effect.ensuring(Effect.scoped(Effect.flatMap(openAll(dir), use)), removeDir(dir))
}
const seed = (files: Files) =>
  Effect.gen(function* () {
    yield* files.store.transact((tx) => tx.append([grant(1), grant(2), grant(3)]))
    yield* files.log.append(LogPosition.make(0), [
      intended(1),
      new Finished({ opId: OpId.make("op-1"), outcome: new Success(), endedAt: 900 }),
      intended(2),
      new Launched({ opId: OpId.make("op-2"), pgid: 777, leaderStartedAt: Option.none() }),
    ])
  })
const rowsOf = (store: LedgerStore) =>
  store.transact((tx) => Effect.map(tx.read, (s) => Arr.map(s.entries, (e) => e.row)))

const settlesAndLists = (files: Files) =>
  Effect.gen(function* () {
    yield* seed(files)
    const inFlight = yield* ledgerSettle(files.lockPath, files.log, files.store, alpha)
    expect(inFlight).toEqual([{ opId: "op-2", grantId: "g-2", pgid: Option.some(777) }])
    const rows = yield* rowsOf(files.store)
    expect(Arr.map(Arr.filter(rows, Schema.is(Charged)), (c) => [c.grantId, c.endedAt])).toEqual([["g-1", 900]])
    expect(Arr.map(Arr.filter(rows, Schema.is(GrantCanceled)), (c) => c.grantId)).toEqual(["g-3"])
  })

const refusedWhileLocked = (files: Files) =>
  Effect.gen(function* () {
    yield* seed(files)
    yield* tryLock(files.lockPath)
    const refused = yield* Effect.flip(ledgerSettle(files.lockPath, files.log, files.store, alpha))
    expect(refused).toEqual(new LockHeld({ path: files.lockPath }))
    expect(Arr.length(yield* rowsOf(files.store))).toBe(3)
  })

describe("ledger settle", () => {
  it.effect("settles orphans and finished steps and lists in-flight ones with their pgid", () =>
    withFiles(settlesAndLists),
  )
  it.effect("is refused, writing nothing, while another holder has the project lock", () =>
    withFiles(refusedWhileLocked),
  )
})
