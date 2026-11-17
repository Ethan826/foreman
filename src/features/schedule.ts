// The scheduler (design "Scheduler", claims C19, H1, C6). Pure: one
// operation runs at a time per project, so it picks the project's next
// step from at most three candidates:
//
// - the correction of the head tranche, when its last review requested
//   changes and rounds remain (then it is the only candidate);
// - the review of the head tranche;
// - the implement step of the next tranche, when that tranche is approved
//   (live or pre-approved) and the review queue's bound allows it.
//
// Candidates are ordered by their provider's reset time for its longest
// policy window, earliest first; a provider with no known reset time sorts
// last, and a tie goes to the review. This is an invented heuristic
// (flagged in the design): it resembles earliest deadline first, but the
// deadline is a provider's, shared by its candidates, and no optimality
// result carries over. The first candidate not under a quota hold for its
// provider whose admission verdict admits is launched. Otherwise a quota
// hold is created for the first candidate refused by rule 1 (at most one
// hold per attempt, H1); rule-2 refusals create none, and the scheduler
// waits.
import { Array as Arr, Option, Order, Schema } from "effect"
import { Client } from "../domain/clients.ts"
import { TrancheId } from "../domain/ids.ts"
import { ChangesRequested, type StepOutcome } from "../domain/outcomes.ts"
import { Role, type RoleClients, Roles } from "../domain/roles.ts"
import { Window } from "../domain/window.ts"
import type { QueueEntry } from "./review-queue.ts"

/** The kinds of step the scheduler can launch. */
export const CandidateKinds = {
  Correction: "correction",
  Review: "review",
  Implement: "implement",
} as const
/** A candidate's kind, one of {@link CandidateKinds}. */
export type CandidateKind = (typeof CandidateKinds)[keyof typeof CandidateKinds]

/** One step the project could launch next, with the provider that runs it. */
export interface Candidate {
  readonly kind: CandidateKind
  readonly tranche: TrancheId
  readonly role: Role
  readonly provider: Client
}

/** What the scheduler needs to know about one project, folded from its log. */
export interface ProjectView {
  /** A hold that blocks every launch exists, or a request is pending. */
  readonly blockedForAll: boolean
  readonly queue: ReadonlyArray<QueueEntry>
  /** The outcome of the head tranche's last review, if it had one. */
  readonly headLastReview: Option.Option<StepOutcome>
  /** Correction rounds the head tranche has used. */
  readonly correctionRounds: number
  readonly maxCorrectionRounds: number
  readonly roles: RoleClients
  readonly nextTranche: Option.Option<TrancheId>
  /** The next tranche has an unused live or pre-approval (`approvalFor`). */
  readonly nextApproved: boolean
  /** The queue's bound allows an implement step (`implementAllowed`). */
  readonly implementAllowed: boolean
}

/** Admission would admit the candidate. */
export class Admits extends Schema.TaggedClass<Admits>()("Admits", {}) {}
/** Rule 1 (pacing) refuses the candidate for `windows`. */
export class RefusedByPacing extends Schema.TaggedClass<RefusedByPacing>()("RefusedByPacing", {
  windows: Schema.Array(Window),
}) {}
/** Rule 2 (allocations) refuses the candidate. */
export class RefusedByAllocation extends Schema.TaggedClass<RefusedByAllocation>()(
  "RefusedByAllocation",
  {},
) {}
/** Admission's verdict on one candidate. */
export type Verdict = Admits | RefusedByPacing | RefusedByAllocation

/** What the scheduler is given besides the project view. */
export interface ScheduleContext {
  /** The provider's reset time for its longest policy window, if known. */
  readonly resetTimeOf: (provider: Client) => Option.Option<number>
  /** A quota hold for the provider is in place and not released. */
  readonly quotaHeld: (provider: Client) => boolean
  /** Admission's verdict, computed from the ledger without writing. */
  readonly verdict: (candidate: Candidate) => Verdict
}

/** Launch `candidate`. */
export class Launch extends Schema.TaggedClass<Launch>()("Launch", {
  candidate: Schema.Struct({
    kind: Schema.Literals([CandidateKinds.Correction, CandidateKinds.Review, CandidateKinds.Implement]),
    tranche: TrancheId,
    role: Role,
    provider: Client,
  }),
}) {}
/** Create a quota hold for `provider` on `windows`. */
export class HoldQuota extends Schema.TaggedClass<HoldQuota>()("HoldQuota", {
  provider: Client,
  windows: Schema.Array(Window),
}) {}
/** Launch nothing now. */
export class Wait extends Schema.TaggedClass<Wait>()("Wait", {}) {}
/** The head tranche used its correction rounds without passing (C6). */
export class EndNotConverged extends Schema.TaggedClass<EndNotConverged>()("EndNotConverged", {
  tranche: TrancheId,
}) {}
/** The scheduler's decision. */
export type ScheduleDecision = Launch | HoldQuota | Wait | EndNotConverged

const candidate = (view: ProjectView, kind: CandidateKind, tranche: TrancheId, role: Role): Candidate => ({
  kind,
  tranche,
  role,
  provider: view.roles[role],
})

/** Whether the head's last review requested changes. */
const changesRequested = (view: ProjectView) =>
  Option.exists(view.headLastReview, (outcome) => Schema.is(ChangesRequested)(outcome))

/** The review and implement candidates, when no correction is due. */
const ordinaryCandidates = (view: ProjectView): ReadonlyArray<Candidate> => [
  ...Option.match(Arr.head(view.queue), {
    onNone: () => [],
    onSome: (head) => [candidate(view, CandidateKinds.Review, head.tranche, Roles.Reviewer)],
  }),
  ...(view.nextApproved && view.implementAllowed
    ? Option.match(view.nextTranche, {
        onNone: () => [],
        onSome: (tranche) => [candidate(view, CandidateKinds.Implement, tranche, Roles.Implementer)],
      })
    : []),
]

/**
 * Orders candidates: a known reset time before an unknown one, then the
 * earliest reset time, then the review before other kinds on a tie.
 */
const byResetThenReview = (context: ScheduleContext): Order.Order<Candidate> => {
  const reset = (c: Candidate) => context.resetTimeOf(c.provider)
  const knownFirst = Order.mapInput(Order.Boolean, (c: Candidate) => Option.isNone(reset(c)))
  const earliest = Order.mapInput(Order.Number, (c: Candidate) =>
    Option.getOrElse(reset(c), () => 0),
  )
  const reviewFirst = Order.mapInput(
    Order.Boolean,
    (c: Candidate) => c.kind !== CandidateKinds.Review,
  )
  return Order.combineAll([knownFirst, earliest, reviewFirst])
}

/** Launches the first admitted candidate, else holds or waits. */
const pick = (ordered: ReadonlyArray<Candidate>, context: ScheduleContext): ScheduleDecision => {
  const eligible = Arr.filter(ordered, (c) => !context.quotaHeld(c.provider))
  const verdicts = Arr.map(eligible, (c) => [c, context.verdict(c)] as const)
  return Option.getOrElse(
    Option.orElse(
      Option.map(
        Arr.findFirst(verdicts, ([, v]) => Schema.is(Admits)(v)),
        ([c]) => new Launch({ candidate: c }),
      ),
      () =>
        Option.flatMap(Arr.findFirst(verdicts, ([, v]) => Schema.is(RefusedByPacing)(v)), ([c, v]) =>
          Schema.is(RefusedByPacing)(v)
            ? Option.some(new HoldQuota({ provider: c.provider, windows: v.windows }))
            : Option.none(),
        ),
    ),
    (): ScheduleDecision => new Wait(),
  )
}

/**
 * The project's next step: wait while a hold blocks every launch; end the
 * head tranche not converged when its rounds are used up; otherwise order
 * the candidates and launch, hold or wait as described above.
 */
export const schedule = (view: ProjectView, context: ScheduleContext): ScheduleDecision => {
  if (view.blockedForAll) return new Wait()
  const head = Arr.head(view.queue)
  if (Option.isSome(head) && changesRequested(view)) {
    if (view.correctionRounds >= view.maxCorrectionRounds)
      return new EndNotConverged({ tranche: head.value.tranche })
    return pick([candidate(view, CandidateKinds.Correction, head.value.tranche, Roles.Corrector)], context)
  }
  return pick(Arr.sort(ordinaryCandidates(view), byResetThenReview(context)), context)
}
