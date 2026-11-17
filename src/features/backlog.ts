// The pre-approved backlog (design "Pre-approved backlog", claim C2).
// `backlog add` appends `PreApproved(tranche, permits, stopBefore)`; the
// backlog holds at most `backlogMax` entries, one per tranche. Each tranche
// needs its own approval to start: a live `Approved`, or its own entry
// without `--stop-before`. A stop-before entry never starts its tranche by
// itself. A live approval's `permits` win over an entry's, and a live
// approval uses up the tranche's entry.
//
// An approval is used when its tranche's implement step is intended. An
// unwind arms it again (a stop-before entry comes back as a plain entry),
// and so does `Reconciled(opId, discard)` of that implement step.
// `backlog remove` is not implemented (owner decision O2).
import { Array as Arr, Option, Schema } from "effect"
import {
  Approved,
  Intended,
  PreApproved,
  type ProjectEvent,
  Reconciled,
  Reconciliations,
  TrancheEnded,
  Unwound,
} from "../domain/events.ts"
import type { OpId, TrancheId } from "../domain/ids.ts"
import { Roles } from "../domain/roles.ts"

/** Where an approval came from. */
export const ApprovalKinds = { Live: "live", Pre: "pre" } as const
/** An approval's kind, one of {@link ApprovalKinds}. */
export type ApprovalKind = (typeof ApprovalKinds)[keyof typeof ApprovalKinds]

/** One approval of a tranche, and the implement step that used it, if any. */
export interface TrancheApproval {
  readonly tranche: TrancheId
  readonly permits: ReadonlyArray<string>
  readonly kind: ApprovalKind
  readonly stopBefore: boolean
  readonly usedBy: Option.Option<OpId>
}

const isUnused = (approval: TrancheApproval) => Option.isNone(approval.usedBy)
const isUnusedFor = (tranche: TrancheId) => (approval: TrancheApproval) =>
  approval.tranche === tranche && isUnused(approval)

/** An implement step's Intended, if `event` is one. */
const implementIntent = (event: ProjectEvent): Option.Option<Intended> =>
  Schema.is(Intended)(event) && event.step.role === Roles.Implementer
    ? Option.some(event)
    : Option.none()

/** Marks the approval an implement step starts under as used by it. */
const useFor = (approvals: ReadonlyArray<TrancheApproval>, intent: Intended) => {
  const live = Arr.findFirstIndex(
    approvals,
    (a) => isUnusedFor(intent.tranche)(a) && a.kind === ApprovalKinds.Live,
  )
  const plain = Arr.findFirstIndex(
    approvals,
    (a) => isUnusedFor(intent.tranche)(a) && a.kind === ApprovalKinds.Pre && !a.stopBefore,
  )
  return Option.match(Option.orElse(live, () => plain), {
    onNone: () => approvals,
    onSome: (index) =>
      Option.getOrElse(
        Arr.modify(approvals, index, (a) => ({ ...a, usedBy: Option.some(intent.opId) })),
        () => approvals,
      ),
  })
}

/** Arms again every approval used by `opId`. */
const rearmOp = (approvals: ReadonlyArray<TrancheApproval>, opId: OpId) =>
  Arr.map(approvals, (a) => (Option.contains(a.usedBy, opId) ? { ...a, usedBy: Option.none() } : a))

/** Arms again the used approvals of unwound tranches, as plain entries. */
const rearmTranches = (approvals: ReadonlyArray<TrancheApproval>, tranches: ReadonlyArray<TrancheId>) =>
  Arr.map(approvals, (a) =>
    Arr.contains(tranches, a.tranche) && Option.isSome(a.usedBy)
      ? { ...a, usedBy: Option.none(), stopBefore: false }
      : a,
  )

/** Adds an entry, unless the tranche already has an unused entry. */
const addEntry = (approvals: ReadonlyArray<TrancheApproval>, event: PreApproved) =>
  Arr.some(approvals, (a) => isUnusedFor(event.tranche)(a) && a.kind === ApprovalKinds.Pre)
    ? approvals
    : Arr.append(approvals, {
        tranche: event.tranche,
        permits: event.permits,
        kind: ApprovalKinds.Pre,
        stopBefore: event.stopBefore,
        usedBy: Option.none(),
      })

/** Adds a live approval, which uses up the tranche's unused entry. */
const addLive = (approvals: ReadonlyArray<TrancheApproval>, event: Approved) =>
  Arr.append(
    Arr.filter(approvals, (a) => !(isUnusedFor(event.tranche)(a) && a.kind === ApprovalKinds.Pre)),
    {
      tranche: event.tranche,
      permits: event.permits,
      kind: ApprovalKinds.Live,
      stopBefore: false,
      usedBy: Option.none(),
    },
  )

/** Whether `event` discards an implement step, re-arming its approval. */
const discardedOp = (event: ProjectEvent): Option.Option<OpId> =>
  Schema.is(Reconciled)(event) && event.resolution === Reconciliations.Discard
    ? Option.some(event.opId)
    : Option.none()

const step = (approvals: ReadonlyArray<TrancheApproval>, event: ProjectEvent) => {
  if (Schema.is(PreApproved)(event)) return addEntry(approvals, event)
  if (Schema.is(Approved)(event)) return addLive(approvals, event)
  if (Schema.is(Unwound)(event)) return rearmTranches(approvals, event.tranches)
  return Option.match(implementIntent(event), {
    onSome: (intent) => useFor(approvals, intent),
    onNone: () =>
      Option.match(discardedOp(event), {
        onSome: (opId) => rearmOp(approvals, opId),
        onNone: () => approvals,
      }),
  })
}

/** Every approval the log records, in order, with what used each. */
export const approvalsOf = (events: ReadonlyArray<ProjectEvent>): ReadonlyArray<TrancheApproval> =>
  Arr.reduce(events, Arr.empty<TrancheApproval>(), step)

/** The backlog: unused pre-approval entries, stop-before ones included, in order. */
export const backlogOf = (events: ReadonlyArray<ProjectEvent>): ReadonlyArray<TrancheApproval> =>
  Arr.filter(approvalsOf(events), (a) => a.kind === ApprovalKinds.Pre && isUnused(a))

/**
 * The approval `tranche` would start under: an unused live approval first
 * (its permits win), else an unused entry without stop-before. None means
 * the tranche may not start.
 */
export const approvalFor = (
  tranche: TrancheId,
  events: ReadonlyArray<ProjectEvent>,
): Option.Option<TrancheApproval> => {
  const unused = Arr.filter(approvalsOf(events), isUnusedFor(tranche))
  return Option.orElse(
    Arr.findFirst(unused, (a) => a.kind === ApprovalKinds.Live),
    () => Arr.findFirst(unused, (a) => !a.stopBefore),
  )
}

/**
 * Whether `backlog add <tranche>` is accepted: the tranche has no unused
 * entry, has not started (no approval of it was used), and the backlog
 * holds fewer than `backlogMax` entries. A tranche has at most one entry
 * (review finding F9c).
 */
export const backlogAddAccepted = (
  events: ReadonlyArray<ProjectEvent>,
  tranche: TrancheId,
  backlogMax: number,
): boolean => {
  const backlog = backlogOf(events)
  const started = Arr.some(
    approvalsOf(events),
    (a) => a.tranche === tranche && Option.isSome(a.usedBy),
  )
  return (
    !started && !Arr.some(backlog, (a) => a.tranche === tranche) && Arr.length(backlog) < backlogMax
  )
}

/** Whether a tranche other than `passed` has started and not ended or unwound. */
const anotherStarted = (events: ReadonlyArray<ProjectEvent>, passed: TrancheId) =>
  Arr.some(events, (event, index) =>
    Option.exists(
      implementIntent(event),
      (intent) =>
        intent.tranche !== passed &&
        !Arr.some(
          Arr.drop(events, index + 1),
          (later) =>
            (Schema.is(TrancheEnded)(later) && later.tranche === intent.tranche) ||
            (Schema.is(Unwound)(later) && Arr.contains(later.tranches, intent.tranche)),
        ),
    ),
  )

/**
 * Whether a passing review of `passed` creates the approval hold: yes,
 * unless the next tranche is pre-approved without stop-before (the
 * backlog's head entry) or another tranche has already started.
 */
export const approvalHoldOnPass = (
  events: ReadonlyArray<ProjectEvent>,
  passed: TrancheId,
): boolean => {
  const headIsPlain = Option.exists(Arr.head(backlogOf(events)), (head) => !head.stopBefore)
  return !(headIsPlain || anotherStarted(events, passed))
}
