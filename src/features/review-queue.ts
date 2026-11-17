// The review queue (design "Review queue", claim C17): a project's tranche
// results waiting for review, oldest first, each `(tranche, trancheBase,
// revision)`. It is a fold of the project log, so it survives a crash.
// `ReviewQueued` adds a result, and a correction's `ReviewQueued` replaces
// its tranche's entry in place. A tranche's end or an `Unwound` removes
// entries. The bound is 1 by default (2 allowed per project): an implement
// step may launch only while the queue length plus one is within it.
import { Array as Arr, Schema } from "effect"
import { type ProjectEvent, ReviewQueued, TrancheEnded, Unwound } from "../domain/events.ts"
import type { Revision, TrancheId } from "../domain/ids.ts"
import {
  Abandoned,
  ChangesRequested,
  NotConverged,
  type StepOutcome,
  type TrancheEnd,
} from "../domain/outcomes.ts"

/** One tranche result waiting for review. */
export interface QueueEntry {
  readonly tranche: TrancheId
  readonly trancheBase: Revision
  readonly revision: Revision
}

/** The queue after `ReviewQueued`: replace the tranche's entry, else append. */
const enqueue = (queue: ReadonlyArray<QueueEntry>, event: ReviewQueued) => {
  const entry: QueueEntry = {
    tranche: event.tranche,
    trancheBase: event.trancheBase,
    revision: event.revision,
  }
  return Arr.some(queue, (e) => e.tranche === event.tranche)
    ? Arr.map(queue, (e) => (e.tranche === event.tranche ? entry : e))
    : Arr.append(queue, entry)
}

/** The tranches an event removes from the queue. */
const removed = (event: ProjectEvent): ReadonlyArray<TrancheId> =>
  Schema.is(TrancheEnded)(event)
    ? [event.tranche]
    : Schema.is(Unwound)(event)
      ? event.tranches
      : []

const step = (queue: ReadonlyArray<QueueEntry>, event: ProjectEvent) =>
  Schema.is(ReviewQueued)(event)
    ? enqueue(queue, event)
    : Arr.filter(queue, (entry) => !Arr.contains(removed(event), entry.tranche))

/** The review queue the log leaves, head (oldest) first. */
export const queueOf = (events: ReadonlyArray<ProjectEvent>): ReadonlyArray<QueueEntry> =>
  Arr.reduce(events, Arr.empty<QueueEntry>(), step)

/**
 * Whether an implement step may launch: the queue length plus one is
 * within `bound`. With bound 1 that means an empty queue, so nothing is
 * ever stacked.
 */
export const implementAllowed = (queue: ReadonlyArray<QueueEntry>, bound: number): boolean =>
  Arr.length(queue) + 1 <= bound

/** Whether `outcome` unwinds the tranches stacked above the head. */
const unwinds = (outcome: StepOutcome | TrancheEnd): boolean =>
  Schema.is(ChangesRequested)(outcome) ||
  Schema.is(NotConverged)(outcome) ||
  Schema.is(Abandoned)(outcome)

/**
 * The tranches to unwind when the head's review requests changes or its
 * tranche ends not converged or abandoned: exactly the tranches above the
 * head (stacked on it); otherwise none (design "Review queue", unwinding;
 * review finding F6). Unwinding re-arms their pre-approvals.
 */
export const unwindTargets = (
  queue: ReadonlyArray<QueueEntry>,
  outcome: StepOutcome | TrancheEnd,
): ReadonlyArray<TrancheId> =>
  unwinds(outcome) ? Arr.map(Arr.drop(queue, 1), (entry) => entry.tranche) : []
