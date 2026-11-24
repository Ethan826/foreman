// The admission decision, pure (design "Admission rule", "Waivers",
// "Spend-down override"; owner ruling 2026-11-17: decisions live in
// Features, and Program only reads, writes and wires). Admission is
// pacing over tarlatan's own records: it bounds tarlatan's launches and
// reservations given those records, not the provider's count or the
// reserve.
//
// A request is admitted when it carries a waiver armed for its own
// provider, or when pacing allows (rule 1: the highest reading of the
// period, plus every counting grant from every project, plus the estimate,
// within the cap) and the allocation rule (rule 2) allows every window not
// under a loosening spend-down. The cap of a window is an active
// spend-down's level, else `100 - reserve`. A loosening spend-down whose
// reset time has passed already has no effect on this decision (the cap
// checks `now < resetsAt`); the cancel rows returned in `expire` make that
// end durable, so a clock set back later cannot bring it back. Program
// writes them in the same transaction.
import { Array as Arr, Option, Schema } from "effect"
import type { Client } from "../domain/clients.ts"
import type { MonoStamp } from "../domain/clock.ts"
import type { GrantId, OpId, ProjectId, WaiverId } from "../domain/ids.ts"
import {
  Grant,
  type LedgerEntry,
  type LedgerSnapshot,
  ReadingRow,
  type SpendDownCanceled,
  type WindowPoints,
} from "../domain/ledger.ts"
import type { Observation } from "../domain/observation.ts"
import type { Policy } from "../domain/policy.ts"
import type { Window } from "../domain/window.ts"
import { counting, type RetirementRule } from "./counting.ts"
import { Allow, Hold, pace, Unknown } from "./pace.ts"
import { currentPeriod } from "./periods.ts"
import { capFor, type PeriodRef, skipsAllocations, spendDownsToExpire } from "./spend-down.ts"

/** A waiver armed in the project log, and the provider it was given for. */
export interface ArmedWaiver {
  readonly waiverId: WaiverId
  readonly provider: Client
}

/** One launch asking for admission; `grantId` and `opId` are fresh. */
export interface AdmissionRequest {
  readonly project: ProjectId
  readonly opId: OpId
  readonly grantId: GrantId
  readonly provider: Client
  /** The step's estimate per policy window, in points. */
  readonly estimate: ReadonlyArray<WindowPoints>
  /** Wall clock, epoch milliseconds. */
  readonly now: number
  /** The monotonic clock now; none until a clock mechanism exists (O11). */
  readonly nowMono: Option.Option<MonoStamp>
  /** The armed waiver (`armedWaiver`), if any; it applies only to its provider. */
  readonly waiver: Option.Option<ArmedWaiver>
}

/** Rule 2 (allocations) for one window: whether the request fits its project's share. */
export type AllocationRule = (
  snapshot: LedgerSnapshot,
  request: AdmissionRequest,
  window: Window,
) => boolean

/**
 * Rule 2 while every window is in fallback: allocations are not enforced,
 * so rule 1 alone admits (design "Measurement", fallback). Windows leave
 * fallback only when the rate fit converges (plan Task B17).
 */
export const allocationsInFallback: AllocationRule = () => true

/** What admission is decided with, wired once in Program. */
export interface AdmissionContext {
  readonly policy: Policy
  /** Which grants stop counting; choice 1 is `ownerOnly`. */
  readonly retirement: RetirementRule
  readonly allocations: AllocationRule
}

/** Admit the request: write `grant`. */
export class Admit extends Schema.TaggedClass<Admit>()("Admit", { grant: Grant }) {}

/** Pacing refused the request; `decision` is its Hold or Unknown. */
export class Refused extends Schema.TaggedClass<Refused>()("Refused", {
  decision: Schema.Union([Hold, Unknown]),
}) {}

/** Pacing allowed the request but the allocation rule (rule 2) did not. */
export class AllocationRefused extends Schema.TaggedClass<AllocationRefused>()(
  "AllocationRefused",
  {},
) {}

/** The verdict on one request. */
export type AdmissionVerdict = Admit | Refused | AllocationRefused

/** The verdict, plus the spend-down cancels to write whatever the verdict. */
export interface AdmissionDecision {
  readonly expire: ReadonlyArray<SpendDownCanceled>
  readonly verdict: AdmissionVerdict
}

/** A stored reading as an Observation, with the seq it was written at. */
const observationOf = (entry: LedgerEntry): ReadonlyArray<Observation> =>
  Schema.is(ReadingRow)(entry.row)
    ? [
        {
          provider: entry.row.provider,
          window: entry.row.window,
          usedPercent: entry.row.usedPercent,
          resetsAt: entry.row.resetsAt,
          observedAt: entry.row.observedAt,
          observedMono: entry.row.observedMono,
          source: entry.row.source,
          seq: entry.seq,
        },
      ]
    : []

/** Every stored reading as an Observation. */
export const readingsOf = (snapshot: LedgerSnapshot): ReadonlyArray<Observation> =>
  Arr.flatMap(snapshot.entries, observationOf)

/** The request's estimate for `window`, or the policy's initial estimate. */
const estimateFor =
  (request: AdmissionRequest, policy: Policy) =>
  (window: Window): number =>
    Option.match(
      Arr.findFirst(request.estimate, (e) => e.window === window),
      { onNone: () => policy.initialEstimate, onSome: (e) => e.points },
    )

/**
 * The grant for an admitted request, with points in every policy window of
 * its provider, exactly as pacing checked them (review finding F4).
 */
const grantOf = (request: AdmissionRequest, policy: Policy) =>
  new Grant({
    grantId: request.grantId,
    project: request.project,
    opId: request.opId,
    provider: request.provider,
    points: Arr.map(policy.providers[request.provider].windows, ({ window }) => ({
      window,
      points: estimateFor(request, policy)(window),
    })),
    issuedAt: request.now,
  })

/** Whether rule 2 passes for every window not under a loosening spend-down. */
const allocationsAllow = (
  snapshot: LedgerSnapshot,
  request: AdmissionRequest,
  context: AdmissionContext,
  periodOf: (window: Window) => Option.Option<PeriodRef>,
) =>
  Arr.every(
    context.policy.providers[request.provider].windows,
    ({ window }) =>
      skipsAllocations(snapshot, request.provider, window, periodOf(window), request.now, context.policy) ||
      context.allocations(snapshot, request, window),
  )

/**
 * Decides one request against the ledger `snapshot`: the spend-down
 * cancels to write, and admit, refused by pacing, or refused by rule 2.
 */
export const decideAdmission = (
  snapshot: LedgerSnapshot,
  request: AdmissionRequest,
  context: AdmissionContext,
): AdmissionDecision => {
  const { policy } = context
  const readings = readingsOf(snapshot)
  const periodOf = (window: Window) => currentPeriod(readings, request.provider, window, policy)
  const expire = spendDownsToExpire(snapshot, request.provider, periodOf, request.now, policy)
  const admit = new Admit({ grant: grantOf(request, policy) })
  if (Option.exists(request.waiver, (w) => w.provider === request.provider))
    return { expire, verdict: admit }
  const decision = pace({
    readings,
    now: request.now,
    nowMono: request.nowMono,
    policy,
    provider: request.provider,
    estimate: estimateFor(request, policy),
    counting: counting(snapshot, request.provider, context.retirement),
    cap: capFor(snapshot, request.provider, periodOf, request.now, policy),
  })
  if (!Schema.is(Allow)(decision)) return { expire, verdict: new Refused({ decision }) }
  if (!allocationsAllow(snapshot, request, context, periodOf))
    return { expire, verdict: new AllocationRefused() }
  return { expire, verdict: admit }
}
