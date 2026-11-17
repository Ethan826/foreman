// Holds and their release rules (design "Holds (S7)"). A hold is created by
// a `HoldCreated` event and removed only by its own release event, later in
// the log; several can exist at once. Holds for quota, approval, uncertain
// operations and failures stay distinct. The fold has no clock input, so
// no timer or notification timeout can release anything.
//
// A quota hold is also released by readings: for every window it names,
// the newest reading of that window is post-hold and allows. Readings live
// in the ledger, not the log, so `quotaReleased` checks that separately
// and the scheduler applies it (plan Task B9). A passed reset time never
// releases a quota hold (owner decision O4, not adopted).
import { Array as Arr, Option, Schema } from "effect"
import type { Client } from "../domain/clients.ts"
import {
  Adopted,
  Approved,
  HoldCreated,
  type LoggedEvent,
  type ProjectEvent,
  ProtectedReleased,
  Reconciled,
  Released,
  RequestCompleted,
  RestoreRequested,
  Waived,
} from "../domain/events.ts"
import {
  Approval,
  Drift,
  Failure,
  type Hold,
  Protected,
  Quota,
  Uncertain,
  WorktreeKinds,
} from "../domain/holds.ts"
import type { Observation } from "../domain/observation.ts"
import type { Window } from "../domain/window.ts"
import { Allow, pace, type PaceInput } from "./pace.ts"

/** Whether `event` releases `hold`, given the whole log (for request lookups). */
type ReleaseRule = (
  event: ProjectEvent,
  hold: Hold,
  log: ReadonlyArray<LoggedEvent>,
) => boolean

/** An approval of the same tranche and revision releases an approval hold. */
const approvalRule: ReleaseRule = (event, hold) =>
  Schema.is(Approved)(event) &&
  Schema.is(Approval)(hold) &&
  hold.tranche === event.tranche &&
  hold.revision === event.revision

/** A waiver for its provider releases a quota hold. */
const waiverRule: ReleaseRule = (event, hold) =>
  Schema.is(Waived)(event) && Schema.is(Quota)(hold) && hold.provider === event.provider

/** A reconciliation of its operation releases an uncertain hold. */
const reconcileRule: ReleaseRule = (event, hold) =>
  Schema.is(Reconciled)(event) && Schema.is(Uncertain)(hold) && hold.opId === event.opId

/** A release of its operation releases a failure hold. */
const releaseRule: ReleaseRule = (event, hold) =>
  Schema.is(Released)(event) && Schema.is(Failure)(hold) && hold.opId === event.opId

/** Adopting a revision releases drift of the supervisor worktree only. */
const adoptRule: ReleaseRule = (event, hold) =>
  Schema.is(Adopted)(event) &&
  Schema.is(Drift)(hold) &&
  hold.worktree === WorktreeKinds.Supervisor

/** The restore request written at `position`, if there is one. */
const restoreAt = (log: ReadonlyArray<LoggedEvent>, position: number) =>
  Option.flatMap(
    Arr.findFirst(log, (logged) => logged.position === position),
    (logged) =>
      Schema.is(RestoreRequested)(logged.event) ? Option.some(logged.event) : Option.none(),
  )

/** A completed restore of the same worktree releases a drift hold. */
const restoreRule: ReleaseRule = (event, hold, log) =>
  Schema.is(RequestCompleted)(event) &&
  Schema.is(Drift)(hold) &&
  Option.exists(restoreAt(log, event.position), (restore) => restore.worktree === hold.worktree)

/** `release-protected` releases a protected-path hold. */
const protectedRule: ReleaseRule = (event, hold) =>
  Schema.is(ProtectedReleased)(event) && Schema.is(Protected)(hold)

const releaseRules: ReadonlyArray<ReleaseRule> = [
  approvalRule,
  waiverRule,
  reconcileRule,
  releaseRule,
  adoptRule,
  restoreRule,
  protectedRule,
]

/** The holds left after one event: add a created hold, drop released ones. */
const step =
  (log: ReadonlyArray<LoggedEvent>) =>
  (holds: ReadonlyArray<Hold>, logged: LoggedEvent): ReadonlyArray<Hold> =>
    Schema.is(HoldCreated)(logged.event)
      ? Arr.append(holds, logged.event.hold)
      : Arr.filter(holds, (hold) => !Arr.some(releaseRules, (rule) => rule(logged.event, hold, log)))

/**
 * The holds the log leaves in place, in creation order. Each is removed
 * only by its own release event written after it: an approval of the same
 * tranche and revision, a waiver of the quota hold's provider, a
 * reconciliation or release of the operation, an adoption (supervisor
 * drift only) or a completed restore of the same worktree, and
 * `release-protected`. A quota hold's release by readings is
 * {@link quotaReleased}.
 */
export const holdsOf = (log: ReadonlyArray<LoggedEvent>): ReadonlyArray<Hold> =>
  Arr.reduce(log, Arr.empty<Hold>(), step(log))

/**
 * Whether `hold` blocks a launch for `provider`: a quota hold blocks only
 * its own provider's steps; every other hold blocks every launch.
 */
export const blocks = (hold: Hold, provider: Client): boolean =>
  !Schema.is(Quota)(hold) || hold.provider === provider

/** The newest reading (by ledger seq) of the hold's provider and `window`. */
const newestOf = (readings: ReadonlyArray<Observation>, hold: Quota, window: Window) =>
  Arr.last(
    Arr.filter(
      readings,
      (reading) => reading.provider === hold.provider && reading.window === window,
    ),
  )

/**
 * Whether a reading is post-hold: observed after the hold by the monotonic
 * clock (same boot, later stamp) and ingested after it (higher ledger seq).
 * A hold without a monotonic stamp has no post-hold reading.
 */
const isPostHold = (hold: Quota) => (reading: Observation) =>
  reading.seq > hold.ledgerSeq &&
  Option.exists(
    Option.zipWith(hold.heldMono, reading.observedMono, (held, seen) =>
      held.bootId === seen.bootId && seen.micros > held.micros,
    ),
    (later) => later,
  )

/**
 * Whether readings release quota `hold`: for every window it names, the
 * newest reading of that window is post-hold, and pacing (with `input`,
 * the current readings, grants and caps) allows that window. A hold with
 * no windows is never released this way, only by a waiver; no wall-clock
 * time, including a passed reset time, releases it.
 */
export const quotaReleased = (hold: Quota, input: PaceInput): boolean => {
  const decision = pace(input)
  const allows = (window: Window) =>
    Schema.is(Allow)(decision) || !Arr.contains(decision.windows, window)
  return (
    Arr.isReadonlyArrayNonEmpty(hold.windows) &&
    Arr.every(
      hold.windows,
      (window) =>
        Option.exists(newestOf(input.readings, hold, window), isPostHold(hold)) && allows(window),
    )
  )
}
