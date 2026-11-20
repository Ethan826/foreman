// The settle step (design "Grant lifecycle"): run at every launch attempt
// and at startup, while the project's lock is held, it settles the
// project's open grants that can be settled from the log.
//
// - A grant no `Intended` names is an orphan: its step never launched
//   (the process died between the ledger's Grant and the log's Intended,
//   or the Intended's append failed). It is canceled `orphan`.
// - A grant whose step `Finished` but has no `Charged` is charged at its
//   estimate, with the Finished event's `endedAt`.
// - A grant whose step was `Intended`, not `Finished`, and whose end the
//   owner attested (`StepEndedByOwner` naming the step and this grant) is
//   charged at its estimate, at the attestation's time (assisted-cycle
//   plan, "Settlement for owner-ended steps"), launched or not.
// - Any other grant whose step was `Intended` and not `Finished` stays
//   open and keeps counting; startup handles it (plan Task B14).
//
// Charges are always the estimate: no run report gives an authoritative
// measurement in the quota's units.
import { Array as Arr, Option, Schema } from "effect"
import {
  Finished,
  Intended,
  Launched,
  type ProjectEvent,
  StepEndedByOwner,
} from "../domain/events.ts"
import { GrantId, type OpId, type ProjectId } from "../domain/ids.ts"
import { type LedgerSnapshot, WindowPoints } from "../domain/ledger.ts"
import { grantViews, type GrantView } from "./counting.ts"

/** Cancel an orphan grant: no `Intended` in the log names it. */
export class CancelOrphan extends Schema.TaggedClass<CancelOrphan>()("CancelOrphan", {
  grantId: GrantId,
}) {}

/** Charge a grant whose step finished, at its estimate. */
export class ChargeFromFinished extends Schema.TaggedClass<ChargeFromFinished>()(
  "ChargeFromFinished",
  {
    grantId: GrantId,
    endedAt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    points: Schema.Array(WindowPoints),
  },
) {}

/**
 * Charge a grant whose step the owner attested as ended, at its estimate,
 * with the attestation's `endedAt`. No `Finished` or outcome is
 * written for the step.
 */
export class ChargeFromOwnerEnded extends Schema.TaggedClass<ChargeFromOwnerEnded>()(
  "ChargeFromOwnerEnded",
  {
    grantId: GrantId,
    endedAt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    points: Schema.Array(WindowPoints),
  },
) {}

/** One thing the settle step writes to the ledger. */
export type SettleAction = CancelOrphan | ChargeFromFinished | ChargeFromOwnerEnded

/** The `Intended` event that names `view`'s grant, if any. */
const intendedFor = (log: ReadonlyArray<ProjectEvent>, view: GrantView) =>
  Arr.findFirst(
    Arr.flatMap(log, (event) => (Schema.is(Intended)(event) ? [event] : [])),
    (intent) => intent.grantId === view.grant.grantId,
  )

/** The `Finished` event of operation `opId`, if any. */
const finishedOf = (log: ReadonlyArray<ProjectEvent>, opId: OpId) =>
  Arr.findFirst(
    Arr.flatMap(log, (event) => (Schema.is(Finished)(event) ? [event] : [])),
    (finish) => finish.opId === opId,
  )

/** The first attestation that step `opId`, reserved by `grantId`, ended. */
const ownerEndedOf = (log: ReadonlyArray<ProjectEvent>, opId: OpId, grantId: GrantId) =>
  Arr.findFirst(
    Arr.flatMap(log, (event) => (Schema.is(StepEndedByOwner)(event) ? [event] : [])),
    (ended) => ended.opId === opId && ended.grantId === grantId,
  )

/** The charge for a step with no `Finished`: only once the owner attested its end. */
const ownerEndedCharge = (log: ReadonlyArray<ProjectEvent>, view: GrantView, opId: OpId) =>
  Arr.map(Option.toArray(ownerEndedOf(log, opId, view.grant.grantId)), (ended) =>
    new ChargeFromOwnerEnded({
      grantId: view.grant.grantId,
      endedAt: ended.endedAt,
      points: view.grant.points,
    }),
  )

/** The action for one open grant of the project, if it can be settled now. */
const actionFor =
  (log: ReadonlyArray<ProjectEvent>) =>
  (view: GrantView): ReadonlyArray<SettleAction> =>
    Option.match(intendedFor(log, view), {
      onNone: () => [new CancelOrphan({ grantId: view.grant.grantId })],
      onSome: (intent) =>
        Option.match(finishedOf(log, intent.opId), {
          onNone: () => ownerEndedCharge(log, view, intent.opId),
          onSome: (finish) => [
            new ChargeFromFinished({
              grantId: view.grant.grantId,
              endedAt: finish.endedAt,
              points: view.grant.points,
            }),
          ],
        }),
    })

/** Whether a view is an open grant of `project`. */
const isOpenOf = (project: ProjectId) => (view: GrantView) =>
  view.grant.project === project && !view.canceled && Option.isNone(view.charge)

/**
 * What the settle step writes for `project`, given its log and the ledger:
 * cancel each orphan grant and charge each grant whose step finished or
 * whose end the owner attested.
 * Grants of other projects, settled grants and grants whose step is still
 * in flight are left alone. Applying the result and settling again yields
 * nothing.
 */
export const settleActions = (
  log: ReadonlyArray<ProjectEvent>,
  snapshot: LedgerSnapshot,
  project: ProjectId,
): ReadonlyArray<SettleAction> =>
  Arr.flatMap(Arr.filter(grantViews(snapshot), isOpenOf(project)), actionFor(log))

/**
 * A step that was `Intended`, has not `Finished` and has no owner
 * attestation that it ended: its grant stays open and keeps counting.
 * `pgid` is the process group recorded by `Launched`, if one was. The
 * owner decides what to do; nothing is signaled.
 */
export interface InFlight {
  readonly opId: OpId
  readonly grantId: GrantId
  readonly pgid: Option.Option<number>
}

/** What the owner's `ledger settle` writes and what it leaves open. */
export interface OwnerSettlement {
  readonly actions: ReadonlyArray<SettleAction>
  readonly inFlight: ReadonlyArray<InFlight>
}

/** The process group `Launched` recorded for `opId`, if any. */
const pgidOf = (log: ReadonlyArray<ProjectEvent>, opId: OpId): Option.Option<number> =>
  Option.map(
    Arr.findFirst(
      Arr.flatMap(log, (event) => (Schema.is(Launched)(event) ? [event] : [])),
      (launch) => launch.opId === opId,
    ),
    (launch) => launch.pgid,
  )

/** The in-flight step of one open grant, if its step is in flight. */
const inFlightOf =
  (log: ReadonlyArray<ProjectEvent>) =>
  (view: GrantView): ReadonlyArray<InFlight> =>
    Option.match(intendedFor(log, view), {
      onNone: () => [],
      onSome: (intent) =>
        Option.isSome(finishedOf(log, intent.opId)) ||
        Option.isSome(ownerEndedOf(log, intent.opId, view.grant.grantId))
          ? []
          : [{ opId: intent.opId, grantId: view.grant.grantId, pgid: pgidOf(log, intent.opId) }],
    })

/**
 * The owner's `ledger settle` for `project` (plan Task B4): the same
 * cancels and charges as the settle step, plus the steps still in flight,
 * each with its recorded process group. It signals no process and runs no
 * git command; their grants stay open until their steps finish or the
 * owner resolves them.
 */
export const ownerSettle = (
  log: ReadonlyArray<ProjectEvent>,
  snapshot: LedgerSnapshot,
  project: ProjectId,
): OwnerSettlement => ({
  actions: settleActions(log, snapshot, project),
  inFlight: Arr.flatMap(Arr.filter(grantViews(snapshot), isOpenOf(project)), inFlightOf(log)),
})
