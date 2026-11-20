// Settlement for owner-ended steps (plan "Settlement for owner-ended
// steps", AC3): a grant whose step was Intended, never Finished, and whose
// end the owner attested is charged once at its estimate, at the
// attestation's time.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import type { ProjectEvent } from "../../src/domain/events.ts"
import { LedgerSeq, OpId, ProjectId } from "../../src/domain/ids.ts"
import { Charged, Grant, type LedgerEntry, type LedgerRow } from "../../src/domain/ledger.ts"
import { Success } from "../../src/domain/outcomes.ts"
import { Windows } from "../../src/domain/window.ts"
import {
  ChargeFromFinished,
  ChargeFromOwnerEnded,
  ownerSettle,
  settleActions,
} from "../../src/features/settle.ts"
import { endedByOwner, finished, grantId, intended, launched } from "./session-fixtures.ts"

const alpha = ProjectId.make("alpha")
const estimate = [{ window: Windows.FiveHour, points: 15 }]
const snapshotOf = (rows: ReadonlyArray<LedgerRow>) => ({
  entries: Arr.map(rows, (row, i): LedgerEntry => ({ seq: LedgerSeq.make(i + 1), row })),
})
const grant = (n: number) =>
  new Grant({
    grantId: grantId(n),
    project: alpha,
    opId: OpId.make(`op-${String(n)}`),
    provider: Clients.Claude,
    points: estimate,
    issuedAt: 0,
  })
const settle = (log: ReadonlyArray<ProjectEvent>, rows: ReadonlyArray<LedgerRow> = [grant(1)]) =>
  settleActions(log, snapshotOf(rows), alpha)
const charge = (at: number) => new ChargeFromOwnerEnded({ grantId: grantId(1), endedAt: at, points: estimate })

describe("settleActions for an owner-ended step", () => {
  it("charges the grant at its estimate, at the attestation's time", () => {
    expect(settle([intended(1), launched(1), endedByOwner(1, grantId(1), 1234)])).toEqual([charge(1234)])
  })

  it("charges a step that was never launched", () => {
    expect(settle([intended(1), endedByOwner(1, grantId(1), 77)])).toEqual([charge(77)])
  })

  it("writes nothing once the grant is charged", () => {
    const charged = new Charged({ grantId: grantId(1), endedAt: 77, points: estimate })
    expect(settle([intended(1), endedByOwner(1, grantId(1), 77)], [grant(1), charged])).toEqual([])
  })

  it("charges once for a second attestation, at the first one's time", () => {
    const log = [intended(1), endedByOwner(1, grantId(1), 10), endedByOwner(1, grantId(1), 20)]
    expect(settle(log)).toEqual([charge(10)])
  })

  it("ignores an attestation that names another grant", () => {
    expect(settle([intended(1), endedByOwner(1, grantId(2))])).toEqual([])
  })

  it("charges from Finished, not the attestation, when the step finished", () => {
    const log = [intended(1), finished(1, new Success(), 500), endedByOwner(1, grantId(1), 900)]
    expect(settle(log)).toEqual([
      new ChargeFromFinished({ grantId: grantId(1), endedAt: 500, points: estimate }),
    ])
  })

  it("leaves a step with no attestation open", () => {
    expect(settle([intended(1), launched(1)])).toEqual([])
  })
})

describe("ownerSettle for an owner-ended step", () => {
  it("charges it and no longer lists it in flight", () => {
    const result = ownerSettle([intended(1), launched(1), endedByOwner(1, grantId(1), 55)], snapshotOf([grant(1)]), alpha)
    expect(result).toEqual({ actions: [charge(55)], inFlight: [] })
  })
})
