// The settle step (design "Grant lifecycle"; plan Task B3): which of a
// project's open grants to cancel as orphans and which to charge from
// their Finished event. Charges are at the estimate.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Option, Schema } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { Finished, Intended, type ProjectEvent } from "../../src/domain/events.ts"
import { GrantId, LedgerSeq, OpId, ProjectId, Revision, TrancheId } from "../../src/domain/ids.ts"
import {
  Charged,
  Grant,
  GrantCanceled,
  type LedgerEntry,
  type LedgerRow,
  type LedgerSnapshot,
} from "../../src/domain/ledger.ts"
import { Success } from "../../src/domain/outcomes.ts"
import { Roles } from "../../src/domain/roles.ts"
import { Windows } from "../../src/domain/window.ts"
import {
  ChargeFromFinished,
  CancelOrphan,
  type SettleAction,
  settleActions,
} from "../../src/features/settle.ts"

const alpha = ProjectId.make("alpha")
const estimate = [{ window: Windows.FiveHour, points: 15 }]
const snapshotOf = (rows: ReadonlyArray<LedgerRow>): LedgerSnapshot => ({
  entries: Arr.map(rows, (row, i): LedgerEntry => ({ seq: LedgerSeq.make(i + 1), row })),
})
const grant = (n: number, project = "alpha") =>
  new Grant({
    grantId: GrantId.make(`g-${String(n)}`),
    project: ProjectId.make(project),
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
const finished = (n: number, endedAt = 500) =>
  new Finished({ opId: OpId.make(`op-${String(n)}`), outcome: new Success(), endedAt })
const charged = (n: number) =>
  new Charged({ grantId: GrantId.make(`g-${String(n)}`), endedAt: 500, points: estimate })

const settle = (log: ReadonlyArray<ProjectEvent>, rows: ReadonlyArray<LedgerRow>) =>
  settleActions(log, snapshotOf(rows), alpha)

describe("settleActions", () => {
  it("cancels as orphan an open grant that no Intended names", () => {
    expect(settle([], [grant(1)])).toEqual([new CancelOrphan({ grantId: GrantId.make("g-1") })])
  })

  it("charges at the estimate a grant whose step Finished, with its endedAt", () => {
    expect(settle([intended(1), finished(1, 700)], [grant(1)])).toEqual([
      new ChargeFromFinished({ grantId: GrantId.make("g-1"), endedAt: 700, points: estimate }),
    ])
  })

  it("leaves open a grant whose step was Intended but has not Finished", () => {
    expect(settle([intended(1)], [grant(1)])).toEqual([])
  })

  it("does nothing for a grant already charged or canceled", () => {
    const canceled = new GrantCanceled({ grantId: GrantId.make("g-2"), cause: "lostRace" })
    expect(settle([intended(1), finished(1)], [grant(1), charged(1), grant(2), canceled])).toEqual([])
  })

  it("never touches another project's grants", () => {
    expect(settle([], [grant(1, "beta")])).toEqual([])
  })
})

// One grant's state in a generated case: whether the log has its Intended
// and Finished, and whether the ledger already settled it.
const GrantState = Schema.Struct({
  intended: Schema.Boolean,
  finished: Schema.Boolean,
  settled: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 })),
})
type GrantState = typeof GrantState.Type
const canceledRow = (n: number) =>
  new GrantCanceled({ grantId: GrantId.make(`g-${String(n)}`), cause: "orphan" })
const settledRows = (state: GrantState, n: number): ReadonlyArray<LedgerRow> =>
  state.settled === 1 ? [charged(n)] : state.settled === 2 ? [canceledRow(n)] : []
const logFor = (state: GrantState, n: number): ReadonlyArray<ProjectEvent> => [
  ...(state.intended ? [intended(n)] : []),
  ...(state.intended && state.finished ? [finished(n)] : []),
]
const expectedFor = (state: GrantState, n: number): ReadonlyArray<SettleAction> => {
  const grantId = GrantId.make(`g-${String(n)}`)
  if (state.settled !== 0) return []
  if (!state.intended) return [new CancelOrphan({ grantId })]
  return state.finished ? [new ChargeFromFinished({ grantId, endedAt: 500, points: estimate })] : []
}
const matchesTheRule = (states: ReadonlyArray<GrantState>) => {
  const rows = Arr.flatMap(states, (state, n) => [grant(n), ...settledRows(state, n)])
  const log = Arr.flatMap(states, logFor)
  return (
    JSON.stringify(settle(log, rows)) === JSON.stringify(Arr.flatMap(states, expectedFor))
  )
}

describe("settleActions property", () => {
  it.prop(
    "cancels exactly the unsettled grants with no Intended, charges exactly the finished ones",
    { states: Schema.Array(GrantState).check(Schema.isMaxLength(6)) },
    ({ states }) => matchesTheRule(states),
    { arbitrary: { runs: 500 } },
  )
})
