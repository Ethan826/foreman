// Holds and their release rules (plan Task B6; design "Holds (S7)", claims
// C1 to C3): each hold is released only by its own event; quota holds
// block only their provider and are released by a post-hold reading that
// allows, or by a waiver; no clock or timer releases anything.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Option, Schema } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import {
  Adopted,
  Approved,
  BaseRequested,
  CommitRecorded,
  Finished,
  HoldCreated,
  Intended,
  Launched,
  LedgerBound,
  LogPosition,
  type LoggedEvent,
  PreApproved,
  ProjectEvent,
  ProtectedReleased,
  Rebased,
  Reconciled,
  Released,
  RequestCompleted,
  RestoreRequested,
  ReviewQueued,
  TrancheEnded,
  UnwindRequested,
  Unwound,
  Waived,
  WaiverExpired,
  WorktreeCreated,
  WorktreeIntended,
  SessionOpened,
  ReportRecorded,
  SnapshotTaken,
  HandoffApproved,
  HandoffRejected,
  ReviewChecked,
  StepEndedByOwner,
  SessionClosed,
  BriefRecorded,
  FindingsRecorded,
  RulingAdded,
  FindingOverruled,
  RoundsGranted,
} from "../../src/domain/events.ts"
import { Approval, Drift, Failure, Protected, Quota, Uncertain } from "../../src/domain/holds.ts"
import { LedgerSeq, OpId, Revision, TrancheId, WaiverId } from "../../src/domain/ids.ts"
import { MaxTurns } from "../../src/domain/outcomes.ts"
import { Windows } from "../../src/domain/window.ts"
import { blocks, holdsOf, quotaReleased } from "../../src/features/holds.ts"
import { bootA, bootB, inputFor, reading, stamp, t0 } from "./fixtures.ts"

const rev = Revision.make("a".repeat(40))
const head = Revision.make("b".repeat(40))
const logged = (events: ReadonlyArray<ProjectEvent>): ReadonlyArray<LoggedEvent> =>
  Arr.map(events, (event, i) => ({ position: LogPosition.make(i + 1), event }))
const held = (events: ReadonlyArray<ProjectEvent>) => holdsOf(logged(events))

const approval = new Approval({ tranche: TrancheId.make("t-1"), revision: rev })
const quota = (windows = [Windows.FiveHour], heldMicros: Option.Option<number> = Option.some(100)) =>
  new Quota({
    provider: Clients.Claude,
    windows,
    heldMono: Option.map(heldMicros, (m) => stamp(m)),
    ledgerSeq: LedgerSeq.make(5),
  })
const uncertain = new Uncertain({ opId: OpId.make("op-1") })
const failure = new Failure({ opId: OpId.make("op-1"), outcome: new MaxTurns() })
const drift = (worktree: "supervisor" | "review") =>
  new Drift({ worktree, expected: rev, head, dirty: false })
const protectedHold = new Protected({ paths: [".git/config"] })
const create = (hold: ConstructorParameters<typeof HoldCreated>[0]["hold"]) => new HoldCreated({ hold })

describe("holdsOf: each hold is released only by its own event", () => {
  it("releases an approval hold only by an approval of the same tranche and revision", () => {
    expect(held([create(approval), new Approved({ tranche: TrancheId.make("t-2"), revision: rev, permits: [], base: Option.none() })])).toEqual([approval])
    expect(held([create(approval), new Approved({ tranche: TrancheId.make("t-1"), revision: head, permits: [], base: Option.none() })])).toEqual([approval])
    expect(held([create(approval), new Approved({ tranche: TrancheId.make("t-1"), revision: rev, permits: [], base: Option.none() })])).toEqual([])
  })

  it("releases a quota hold by a waiver of its provider only", () => {
    expect(held([create(quota()), new Waived({ provider: Clients.Codex, waiverId: WaiverId.make("w-1") })])).toEqual([quota()])
    expect(held([create(quota()), new Waived({ provider: Clients.Claude, waiverId: WaiverId.make("w-1") })])).toEqual([])
  })

  it("releases uncertain by a reconciliation of its opId and failure by a release of its opId", () => {
    expect(held([create(uncertain), new Released({ opId: OpId.make("op-1") })])).toEqual([uncertain])
    expect(held([create(uncertain), new Reconciled({ opId: OpId.make("op-1"), resolution: "discard" })])).toEqual([])
    expect(held([create(failure), new Reconciled({ opId: OpId.make("op-1"), resolution: "accept" })])).toEqual([failure])
    expect(held([create(failure), new Released({ opId: OpId.make("op-2") })])).toEqual([failure])
    expect(held([create(failure), new Released({ opId: OpId.make("op-1") })])).toEqual([])
  })

  it("releases supervisor drift by adoption or a completed restore, review drift only by a completed review restore", () => {
    expect(held([create(drift("supervisor")), new Adopted({ revision: head })])).toEqual([])
    expect(held([create(drift("review")), new Adopted({ revision: head })])).toEqual([drift("review")])
    expect(held([create(drift("review")), new RestoreRequested({ worktree: "supervisor" }), new RequestCompleted({ position: 2 })])).toEqual([drift("review")])
    expect(held([create(drift("review")), new RestoreRequested({ worktree: "review" }), new RequestCompleted({ position: 2 })])).toEqual([])
    expect(held([create(drift("supervisor")), new RestoreRequested({ worktree: "supervisor" })])).toEqual([drift("supervisor")])
  })

  it("releases a protected hold by release-protected", () => {
    expect(held([create(protectedHold), new ProtectedReleased({ accept: false })])).toEqual([])
  })

  it("does not release a hold created after its release event", () => {
    expect(held([new Released({ opId: OpId.make("op-1") }), create(failure)])).toEqual([failure])
  })
})

describe("blocks", () => {
  it("lets a quota hold block only its provider and every other hold block all", () => {
    expect([blocks(quota(), Clients.Claude), blocks(quota(), Clients.Codex)]).toEqual([true, false])
    expect([blocks(failure, Clients.Claude), blocks(failure, Clients.Codex)]).toEqual([true, true])
  })
})

describe("quotaReleased", () => {
  const fresh = (micros: number, seq: number, used: number, bootId = bootA) =>
    reading({ seq, usedPercent: used, resetsAt: t0 + 3_600_000, mono: stamp(micros, bootId) })
  const weekly = reading({ seq: 9, window: Windows.Weekly, usedPercent: 0, mono: stamp(600_000_000) })
  const released = (hold: Quota, readings: ReadonlyArray<ReturnType<typeof reading>>) =>
    quotaReleased(hold, inputFor(readings, { nowMono: Option.some(stamp(600_000_000)) }))

  it("releases on a reading after the hold by clock and seq that allows", () => {
    expect(released(quota(), [fresh(500_000_000, 6, 10), weekly])).toBe(true)
  })

  it("does not release on a reading observed before the hold", () => {
    expect(released(quota(), [fresh(50, 6, 10), weekly])).toBe(false)
  })

  it("does not release on a reading ingested at or before the hold's ledger seq", () => {
    expect(released(quota(), [fresh(500_000_000, 5, 10), weekly])).toBe(false)
  })

  it("does not release on a reading from another boot", () => {
    expect(released(quota(), [fresh(500_000_000, 6, 10, bootB), weekly])).toBe(false)
  })

  it("does not release on a post-hold reading that does not allow", () => {
    expect(released(quota(), [fresh(500_000_000, 6, 69), weekly])).toBe(false)
  })

  it("never releases a hold without a monotonic stamp or with no windows", () => {
    expect(released(quota([Windows.FiveHour], Option.none()), [fresh(500_000_000, 6, 10), weekly])).toBe(false)
    expect(released(quota([]), [fresh(500_000_000, 6, 10), weekly])).toBe(false)
  })

  it("is not released by the wall clock passing the reset time", () => {
    const passed = quotaReleased(
      quota(),
      inputFor([fresh(50, 6, 10), weekly], { now: t0 + 7_200_000, nowMono: Option.some(stamp(600_000_000)) }),
    )
    expect(passed).toBe(false)
  })
})

// Every event kind that neither creates a hold nor releases one under
// src/features/holds.ts; the kinds below must partition ProjectEvent.
const neutralKinds = [
  Intended, Launched, Finished, CommitRecorded, PreApproved, WaiverExpired,
  ReviewQueued, Unwound, TrancheEnded, LedgerBound, WorktreeIntended,
  WorktreeCreated, Rebased, BaseRequested, UnwindRequested, RestoreRequested,
  SessionOpened, ReportRecorded, SnapshotTaken, HandoffApproved, HandoffRejected,
  ReviewChecked, StepEndedByOwner, SessionClosed, BriefRecorded, FindingsRecorded,
  RulingAdded, FindingOverruled, RoundsGranted,
] as const
const releaseKinds = [Approved, Waived, Released, Adopted, Reconciled, RequestCompleted, ProtectedReleased] as const
const NeutralEvent = Schema.Union(neutralKinds)
const Insert = Schema.Struct({
  event: NeutralEvent,
  at: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 8 })),
})
const base: ReadonlyArray<ProjectEvent> = [
  create(approval),
  create(quota()),
  create(failure),
  new Released({ opId: OpId.make("op-1") }),
  create(uncertain),
  create(drift("supervisor")),
  create(drift("review")),
  create(protectedHold),
]
const withNeutral = (inserts: ReadonlyArray<typeof Insert.Type>) =>
  Arr.reduce(inserts, base, (events, insert) => [
    ...Arr.take(events, insert.at),
    insert.event,
    ...Arr.drop(events, insert.at),
  ])

describe("holdsOf property", () => {
  it("classifies every event kind as hold creation, release or neutral", () => {
    expect(new Set([HoldCreated, ...releaseKinds, ...neutralKinds])).toEqual(new Set(ProjectEvent.members))
    expect(neutralKinds.length + releaseKinds.length + 1).toBe(ProjectEvent.members.length)
  })

  it.prop(
    "events of every non-release kind never change the hold set (no clock input exists)",
    { inserts: Schema.Array(Insert).check(Schema.isMaxLength(6)) },
    ({ inserts }) => JSON.stringify(held(withNeutral(inserts))) === JSON.stringify(held(base)),
    { arbitrary: { runs: 300 } },
  )
})
