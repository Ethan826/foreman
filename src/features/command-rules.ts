// The prerequisite matrix of the assisted session's commands (plan
// "Commands and their prerequisites", AC1, and its close rules). Each
// command checks only its own prerequisites, so the owner's exits
// (`status`, `step-ended`, `close`) stay reachable when the worktree, a
// client or a file is broken. Program observes the facts in
// `CommandChecks`; Features only decides.
import { Array as Arr, Match, Option, Schema } from "effect"
import type { Client } from "../domain/clients.ts"
import { type Hold, Quota } from "../domain/holds.ts"
import type { Revision } from "../domain/ids.ts"
import {
  CloseKinds,
  type SessionClose,
  type SessionCommand,
  type StepEnded,
} from "../domain/session.ts"
import {
  Interrupted,
  OpenNoAttempt,
  type OpenSession,
  type SessionState,
} from "../domain/session-state.ts"
import {
  CorrectionsExhausted,
  HeldBy,
  LockNotHeld,
  NotAttested,
  PinMismatch,
  Refusal,
  ReportsNotIntact,
  SnapshotRefused,
  TreeChanged,
  WorktreeCheckFailed,
  WrongState,
  stepEndedRefusals,
} from "./command-refusals.ts"
import { blocks } from "./holds.ts"
import {
  awaitsClose,
  awaitsCorrection,
  awaitsReview,
  awaitsUsable,
  noneOpen,
  openSessionOf,
  openWithoutIncomplete,
} from "./session-phases.ts"

/** The refusal reasons; see command-refusals.ts. */
export {
  LockNotHeld,
  WrongState,
  WorktreeCheckFailed,
  PinMismatch,
  HeldBy,
  ReportsNotIntact,
  NotAttested,
  SnapshotRefused,
  TreeChanged,
  CorrectionsExhausted,
  NotIncomplete,
  WrongGrant,
  AlreadyAttested,
  Refusal,
} from "./command-refusals.ts"

/** Corrections allowed per session (plan decision P9). */
export const maxCorrections = 2

/** A snapshot taken for this command: its tree, and whether it passed the raw checks. */
export interface SnapshotCheck {
  readonly tree: Revision
  readonly passedRawChecks: boolean
}

/**
 * The facts Program observes before deciding a command. `provider` is
 * the client the command would launch and `pinMatches` its version pin;
 * `holds` are the holds in place, with quota holds released by readings
 * already left out; `snapshot` is the snapshot taken for this command,
 * if one was.
 */
export interface CommandChecks {
  readonly lockHeld: boolean
  readonly worktreeCheckPassed: boolean
  readonly provider: Client
  readonly pinMatches: boolean
  readonly holds: ReadonlyArray<Hold>
  readonly reportsIntact: boolean
  readonly attested: boolean
  readonly snapshot: Option.Option<SnapshotCheck>
}

/**
 * The command may run. `waiverStep` is true when a quota hold of the
 * launched provider is in place, so the launch goes to the waiver step
 * (plan "Write protocol", step 3) instead of plain admission.
 */
export class Allowed extends Schema.TaggedClass<Allowed>()("Allowed", {
  waiverStep: Schema.Boolean,
}) {}

/** The command may not run, for every reason in `reasons`. */
export class Refused extends Schema.TaggedClass<Refused>()("Refused", {
  reasons: Schema.NonEmptyArray(Refusal),
}) {}

/** One prerequisite: the reasons it fails for, none when it holds. */
type Rule = (state: SessionState, checks: CommandChecks) => ReadonlyArray<Refusal>

/**
 * Decides `command` in `state` with `checks`, by the plan's matrix:
 * `status` always; `session open` with no session open; `implement` in
 * an open session with no attempt; `review` after a usable implement or
 * correct; `correct` after a review asking for changes, at most
 * {@link maxCorrections} times; `reject` while a usable attempt awaits
 * its handoff; `step-ended` for an incomplete attempt and its grant,
 * once; `close` by the close rules. Every command but `status` needs the
 * lock; the launches also need the worktree check, the pin and no
 * non-quota hold, and each handoff its reports, attestation and snapshot.
 */
export const allowed = (
  command: SessionCommand,
  state: SessionState,
  checks: CommandChecks,
): Allowed | Refused =>
  Arr.match(Arr.flatMap(rulesFor(command), (rule) => rule(state, checks)), {
    onEmpty: () => new Allowed({ waiverStep: isLaunch(command) && quotaHeld(checks) }),
    onNonEmpty: (reasons) => new Refused({ reasons }),
  })

/** The prerequisites of one command, in the order they are reported. */
const rulesFor = (command: SessionCommand): ReadonlyArray<Rule> =>
  Match.value(command).pipe(
    Match.tag("Status", () => []),
    Match.tag("SessionOpen", () => [lock, stateIs(noneOpen), worktree, noNonQuotaHold]),
    Match.tag("Implement", () => [lock, stateIs(Schema.is(OpenNoAttempt)), ...launch]),
    Match.tag("Review", () => [lock, stateIs(awaitsReview), ...launch, ...handoff, snapshotPasses]),
    Match.tag("Correct", () => [
      lock, stateIs(awaitsCorrection), correctionsLeft, ...launch, ...handoff, onReviewedTree,
    ]),
    Match.tag("Reject", () => [lock, stateIs(awaitsUsable)]),
    Match.tag("StepEnded", (ended) => [lock, attestable(ended)]),
    Match.tag("SessionClose", (close) => [lock, ...closeRules(close)]),
    Match.exhaustive,
  )

/** `step-ended`'s own rule; see `stepEndedRefusals`. */
const attestable =
  (ended: StepEnded): Rule =>
  (state) =>
    stepEndedRefusals(ended, state)

/** The close rules for one kind of close. */
const closeRules = (close: SessionClose): ReadonlyArray<Rule> =>
  Match.value(close.how).pipe(
    Match.when(CloseKinds.Abandoned, () => [stateIs(openWithoutIncomplete)]),
    Match.when(CloseKinds.Interrupted, () => [stateIs(Schema.is(Interrupted))]),
    Match.when(CloseKinds.Finished, () => [stateIs(awaitsClose), attest, onReviewedTree]),
    Match.exhaustive,
  )

/** Whether the command launches a client. */
const isLaunch = (command: SessionCommand): boolean =>
  Match.value(command).pipe(
    Match.tag("Implement", "Review", "Correct", () => true),
    Match.orElse(() => false),
  )

/** Whether a quota hold of the launched provider is in place. */
const quotaHeld = (checks: CommandChecks): boolean =>
  Arr.some(checks.holds, (hold) => Schema.is(Quota)(hold) && blocks(hold, checks.provider))

/** A rule that holds when `fact` does, and otherwise refuses with `reason`. */
const requires =
  (fact: (checks: CommandChecks) => boolean, reason: (checks: CommandChecks) => Refusal): Rule =>
  (_state, checks) => (fact(checks) ? [] : [reason(checks)])

const lock = requires((checks) => checks.lockHeld, () => new LockNotHeld())
const worktree = requires((checks) => checks.worktreeCheckPassed, () => new WorktreeCheckFailed())
const pin = requires(
  (checks) => checks.pinMatches,
  (checks) => new PinMismatch({ provider: checks.provider }),
)
const reports = requires((checks) => checks.reportsIntact, () => new ReportsNotIntact())
const attest = requires((checks) => checks.attested, () => new NotAttested())

/** Refuses with each hold that is not a quota hold. */
const noNonQuotaHold: Rule = (_state, checks) =>
  Arr.map(Arr.filter(checks.holds, (hold) => !Schema.is(Quota)(hold)), heldBy)

/** Refuses with each hold that blocks the provider, except its own quota hold. */
const launchHolds: Rule = (_state, checks) =>
  Arr.map(
    Arr.filter(checks.holds, (hold) => blocks(hold, checks.provider) && !Schema.is(Quota)(hold)),
    heldBy,
  )

/** The refusal naming one blocking hold. */
const heldBy = (hold: Hold): Refusal => new HeldBy({ hold })

/** What every launch needs besides the lock and the state. */
const launch: ReadonlyArray<Rule> = [worktree, pin, launchHolds]

/** What every launch after an attempt needs: its reports and the owner's attestation. */
const handoff: ReadonlyArray<Rule> = [reports, attest]

/** Refuses with the state unless `accepts` it. */
const stateIs =
  (accepts: (state: SessionState) => boolean): Rule =>
  (state) => (accepts(state) ? [] : [new WrongState({ state })])

/** Refuses once the session has used its corrections. */
const correctionsLeft: Rule = (state) =>
  Option.match(Option.filter(openSessionOf(state), usedEveryCorrection), {
    onNone: () => [],
    onSome: (session) => [new CorrectionsExhausted({ corrections: session.corrections })],
  })

/** Whether the session launched its last allowed correction. */
const usedEveryCorrection = (session: OpenSession): boolean =>
  session.corrections >= maxCorrections

/** A snapshot was taken and passed the raw checks. */
const snapshotPasses: Rule = (_state, checks) =>
  Option.exists(checks.snapshot, (snapshot) => snapshot.passedRawChecks)
    ? []
    : [new SnapshotRefused()]

/**
 * The snapshot passed the raw checks and equals the tree the review was
 * given. With no session open the state rule alone refuses.
 */
const onReviewedTree: Rule = (state, checks) =>
  Option.match(openSessionOf(state), {
    onNone: () => [],
    onSome: (session) =>
      Option.match(Option.filter(checks.snapshot, (snapshot) => snapshot.passedRawChecks), {
        onNone: () => [new SnapshotRefused()],
        onSome: (snapshot) => sameTree(session.reviewedTree, snapshot.tree),
      }),
  })

/** Refuses when `current` is not the reviewed tree. */
const sameTree = (reviewed: Option.Option<Revision>, current: Revision): ReadonlyArray<Refusal> =>
  Option.contains(reviewed, current) ? [] : [new TreeChanged({ reviewed, current })]
