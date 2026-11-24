// The settle step against a real ledger file for an owner-ended step
// (assisted-cycle plan, "Settlement for owner-ended steps", AC3): one
// `Charged` at the grant's estimate and the attestation's time; a repeat
// writes nothing.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect } from "effect"
import type { Scope } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { Clients } from "../../src/domain/clients.ts"
import { OpId, ProjectId } from "../../src/domain/ids.ts"
import { Charged, Grant, type LedgerStore } from "../../src/domain/ledger.ts"
import { Windows } from "../../src/domain/window.ts"
import { applySettle } from "../../src/program/admission.ts"
import { openLedger } from "../../src/runtime/ledger-sqlite.ts"
import { endedByOwner, grantId, intended, launched } from "../features/session-fixtures.ts"

const busyMillis = 50
const alpha = ProjectId.make("alpha")
const estimate = [{ window: Windows.FiveHour, points: 15 }]
const grant = new Grant({
  grantId: grantId(1),
  project: alpha,
  opId: OpId.make("op-1"),
  provider: Clients.Claude,
  points: estimate,
  issuedAt: 0,
})

const withLedger = <A, E>(use: (store: LedgerStore) => Effect.Effect<A, E, Scope.Scope>) => {
  const dir = mkdtempSync(`${tmpdir()}/tarlatan-owner-ended-`)
  return Effect.ensuring(
    Effect.scoped(Effect.flatMap(openLedger(`${dir}/ledger.sqlite`, busyMillis), use)),
    Effect.sync(() => {
      rmSync(dir, { recursive: true, force: true })
    }),
  )
}
const rowsOf = (store: LedgerStore) =>
  store.transact((tx) => Effect.map(tx.read, (snapshot) => Arr.map(snapshot.entries, (entry) => entry.row)))

const chargesOnce = (store: LedgerStore) =>
  Effect.gen(function* () {
    yield* store.transact((tx) => tx.append([grant]))
    const log = [intended(1), launched(1), endedByOwner(1, grantId(1), 4321)]
    yield* applySettle(store, log, alpha)
    expect(yield* rowsOf(store)).toEqual([
      grant,
      new Charged({ grantId: grantId(1), endedAt: 4321, points: estimate }),
    ])
    const before = yield* rowsOf(store)
    yield* applySettle(store, log, alpha)
    expect(yield* rowsOf(store)).toEqual(before)
  })

describe("applySettle for an owner-ended step", () => {
  it.effect("writes one Charged at the estimate, then nothing", () => withLedger(chargesOnce))
})
