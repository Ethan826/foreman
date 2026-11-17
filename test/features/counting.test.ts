// Which grants count (plan Task B2; design "Reconciling readings, grants
// and charges", rule P as of revision 5.2): every grant counts until it is
// canceled or retired, open grants at their estimate and charged ones at
// the charged amount; under choice 1 only the owner's Retirement retires.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Option, Schema } from "effect"
import { type Client, Clients } from "../../src/domain/clients.ts"
import { GrantId, LedgerSeq, OpId, PeriodSeq, ProjectId } from "../../src/domain/ids.ts"
import {
  Charged,
  Grant,
  GrantCanceled,
  type LedgerEntry,
  type LedgerRow,
  type LedgerSnapshot,
  PeriodOpened,
  Retirement,
} from "../../src/domain/ledger.ts"
import { type Window, Windows } from "../../src/domain/window.ts"
import { counting, ownerOnly } from "../../src/features/counting.ts"

const snapshotOf = (rows: ReadonlyArray<LedgerRow>): LedgerSnapshot => ({
  entries: Arr.map(rows, (row, i): LedgerEntry => ({ seq: LedgerSeq.make(i + 1), row })),
})
const grant = (id: string, points: number, project = "alpha", provider: Client = Clients.Claude) =>
  new Grant({
    grantId: GrantId.make(id),
    project: ProjectId.make(project),
    opId: OpId.make(`op-${id}`),
    provider,
    points: [
      { window: Windows.FiveHour, points },
      { window: Windows.Weekly, points },
    ],
    issuedAt: 0,
  })
const charged = (id: string, points: number) =>
  new Charged({
    grantId: GrantId.make(id),
    endedAt: 1,
    points: [
      { window: Windows.FiveHour, points },
      { window: Windows.Weekly, points },
    ],
  })
const retire = (window: Window, through: number) =>
  new Retirement({ provider: Clients.Claude, window, throughSeq: LedgerSeq.make(through) })
const period = (seq: number) =>
  new PeriodOpened({
    provider: Clients.Claude,
    window: Windows.FiveHour,
    periodSeq: PeriodSeq.make(seq),
    resetsAt: Option.none(),
  })

const pointsOf = (snapshot: LedgerSnapshot, window: Window) =>
  Arr.map(
    Arr.filter(counting(snapshot, Clients.Claude, ownerOnly), (g) => g.window === window),
    (g) => [g.grantId, g.points],
  )

describe("counting under the owner-only retirement rule (choice 1)", () => {
  it("counts an open grant at its estimate and a charged one at its charge", () => {
    const snapshot = snapshotOf([grant("g-1", 15), grant("g-2", 15), charged("g-2", 9)])
    expect(pointsOf(snapshot, Windows.FiveHour)).toEqual([
      ["g-1", 15],
      ["g-2", 9],
    ])
  })

  it("counts nothing for a canceled grant", () => {
    const canceled = new GrantCanceled({ grantId: GrantId.make("g-1"), cause: "orphan" })
    expect(pointsOf(snapshotOf([grant("g-1", 15), canceled]), Windows.FiveHour)).toEqual([])
  })

  it("keeps counting across new periods (a new period frees nothing)", () => {
    const snapshot = snapshotOf([grant("g-1", 15), period(2), charged("g-1", 15), period(3)])
    expect(pointsOf(snapshot, Windows.FiveHour)).toEqual([["g-1", 15]])
  })

  it("counts every project's grants and only the asked provider's", () => {
    const snapshot = snapshotOf([
      grant("g-1", 15, "alpha"),
      grant("g-2", 15, "beta"),
      grant("g-3", 15, "beta", Clients.Codex),
    ])
    expect(pointsOf(snapshot, Windows.FiveHour)).toEqual([
      ["g-1", 15],
      ["g-2", 15],
    ])
  })

  it("retires only grants of the retired window written at or before throughSeq", () => {
    const snapshot = snapshotOf([grant("g-1", 15), grant("g-2", 15), retire(Windows.FiveHour, 1)])
    expect(pointsOf(snapshot, Windows.FiveHour)).toEqual([["g-2", 15]])
    expect(pointsOf(snapshot, Windows.Weekly)).toEqual([
      ["g-1", 15],
      ["g-2", 15],
    ])
  })
})

// Generated ledgers: grants, charges, cancels and retirements in any order.
const Step = Schema.Struct({
  kind: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
  grant: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
  weekly: Schema.Boolean,
  through: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })),
})
type Step = typeof Step.Type
const rowOf = (step: Step): LedgerRow => {
  const id = `g-${String(step.grant)}`
  if (step.kind === 0) return grant(id, 15)
  if (step.kind === 1) return charged(id, 7)
  if (step.kind === 2) return new GrantCanceled({ grantId: GrantId.make(id), cause: "orphan" })
  return retire(step.weekly ? Windows.Weekly : Windows.FiveHour, step.through)
}
const isRetirementFor = (grantSeq: number, window: Window) => (entry: LedgerEntry) =>
  Schema.is(Retirement)(entry.row) && entry.row.window === window && entry.row.throughSeq >= grantSeq

const countsOrIsRetired =
  (snapshot: LedgerSnapshot, counted: ReturnType<typeof counting>, grantId: string, seq: number) =>
  (window: Window) =>
    Arr.some(counted, (g) => g.grantId === grantId && g.window === window) ||
    Arr.some(snapshot.entries, isRetirementFor(seq, window))

// Every grant that was not canceled still counts in each window, unless a
// Retirement of that window covers it.
const dropsOnlyWhenRetired = (steps: ReadonlyArray<Step>): boolean => {
  const snapshot = snapshotOf(Arr.map(steps, rowOf))
  const counted = counting(snapshot, Clients.Claude, ownerOnly)
  const canceledIds = Arr.flatMap(snapshot.entries, (e) =>
    Schema.is(GrantCanceled)(e.row) ? [e.row.grantId] : [],
  )
  const keeps = (entry: LedgerEntry) =>
    !Schema.is(Grant)(entry.row) ||
    Arr.contains(canceledIds, entry.row.grantId) ||
    Arr.every(
      [Windows.FiveHour, Windows.Weekly],
      countsOrIsRetired(snapshot, counted, entry.row.grantId, entry.seq),
    )
  return Arr.every(snapshot.entries, keeps)
}

describe("counting properties", () => {
  it.prop(
    "under ownerOnly, a non-canceled grant drops out only with a Retirement covering it",
    { steps: Schema.Array(Step).check(Schema.isMaxLength(12)) },
    ({ steps }) => dropsOnlyWhenRetired(steps),
    { arbitrary: { runs: 500 } },
  )
})
