// Admission and the grant lifecycle's ledger writes (design "Admission
// rule", "Grant lifecycle"). Each runs in one ledger transaction, so it
// reads every row it decides on and its appends commit with that read.
//
// Admission is pacing over foreman's own records: it bounds foreman's
// launches and reservations given those records, not the provider's count
// or the reserve. A request is admitted when pacing allows (rule 1: the
// highest reading of the period, plus every counting grant from every
// project, plus the estimate, within the cap) and the allocation rule
// (rule 2) allows, or when it carries the owner's waiver. An admitted
// request appends its `Grant` at the estimate in the same transaction.
import { Array as Arr, Effect, Option, Schema } from "effect"
import type { Client } from "../domain/clients.ts"
import type { MonoStamp } from "../domain/clock.ts"
import type { ProjectEvent } from "../domain/events.ts"
import type { OpId, ProjectId, WaiverId } from "../domain/ids.ts"
import { GrantId, LedgerSeq } from "../domain/ids.ts"
import {
  Charged,
  Grant,
  GrantCanceled,
  type LedgerEntry,
  LedgerError,
  type LedgerSnapshot,
  type LedgerStore,
  ReadingRow,
  type WindowPoints,
} from "../domain/ledger.ts"
import type { Observation } from "../domain/observation.ts"
import type { Policy } from "../domain/policy.ts"
import { Window } from "../domain/window.ts"
import { counting, type RetirementRule } from "../features/counting.ts"
import { Allow, Hold, pace, Unknown } from "../features/pace.ts"
import { ChargeFromFinished, type SettleAction, settleActions } from "../features/settle.ts"

/** One launch asking for admission; `grantId` and `opId` are fresh. */
export interface AdmissionRequest {
  readonly project: ProjectId
  readonly opId: OpId
  readonly grantId: GrantId
  readonly provider: Client
  /** The step's estimate per policy window, in points. */
  readonly estimate: ReadonlyArray<WindowPoints>
  /** Wall clock, epoch milliseconds (only for `now < resetsAt`). */
  readonly now: number
  /** The monotonic clock now; none until a clock mechanism exists (O11). */
  readonly nowMono: Option.Option<MonoStamp>
  /** The armed waiver (`armedWaiver`), if any; it applies only to its provider. */
  readonly waiver: Option.Option<ArmedWaiver>
}

/** A waiver armed in the project log, and the provider it was given for. */
export interface ArmedWaiver {
  readonly waiverId: WaiverId
  readonly provider: Client
}

/** Rule 2 (allocations): whether the request fits its project's share. */
export type AllocationRule = (snapshot: LedgerSnapshot, request: AdmissionRequest) => boolean

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
  /** The cap per window, usually `defaultCap`; a spend-down supplies its own. */
  readonly cap: (window: Window) => number
}

/** The request was admitted and its grant written at `seq`. */
export class Admitted extends Schema.TaggedClass<Admitted>()("Admitted", {
  grantId: GrantId,
  seq: LedgerSeq,
}) {}

/** Pacing refused the request; `decision` is its Hold or Unknown. */
export class Refused extends Schema.TaggedClass<Refused>()("Refused", {
  decision: Schema.Union([Hold, Unknown]),
}) {}

/** Pacing allowed the request but the allocation rule (rule 2) did not. */
export class AllocationRefused extends Schema.TaggedClass<AllocationRefused>()(
  "AllocationRefused",
  {},
) {}

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

/** The request's estimate for `window`, or the policy's initial estimate. */
const estimateFor =
  (request: AdmissionRequest, policy: Policy) =>
  (window: Window): number =>
    Option.match(
      Arr.findFirst(request.estimate, (e) => e.window === window),
      { onNone: () => policy.initialEstimate, onSome: (e) => e.points },
    )

/** Pacing's decision for the request against `snapshot`. */
const decide = (snapshot: LedgerSnapshot, request: AdmissionRequest, context: AdmissionContext) =>
  pace({
    readings: Arr.flatMap(snapshot.entries, observationOf),
    now: request.now,
    nowMono: request.nowMono,
    policy: context.policy,
    provider: request.provider,
    estimate: estimateFor(request, context.policy),
    counting: counting(snapshot, request.provider, context.retirement),
    cap: context.cap,
  })

/**
 * The grant for an admitted request, with points in every policy window of
 * its provider: the request's estimate, or the initial estimate for a
 * window it omits, exactly as pacing checked them (review finding F4).
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

/**
 * Decides one request and, when it is admitted, appends its `Grant` in the
 * same transaction. A refusal writes nothing.
 */
export const admit = (
  store: LedgerStore,
  request: AdmissionRequest,
  context: AdmissionContext,
) =>
  store.transact((tx) =>
    Effect.gen(function* () {
      const snapshot = yield* tx.read
      const waived = Option.exists(request.waiver, (w) => w.provider === request.provider)
      const decision = decide(snapshot, request, context)
      if (!waived && !Schema.is(Allow)(decision)) return new Refused({ decision })
      if (!waived && !context.allocations(snapshot, request)) return new AllocationRefused()
      const seq = yield* Effect.fromOption(Arr.head(yield* tx.append([grantOf(request, context.policy)])), () =>
        new LedgerError({ reason: "the grant was not written" }),
      )
      return new Admitted({ grantId: request.grantId, seq })
    }),
  )

/**
 * Cancels `grantId` as a lost race: its `Intended` could not be appended
 * because another writer moved the project log first. Runs at once, not at
 * the next settle.
 */
export const cancelLostRace = (store: LedgerStore, grantId: GrantId) =>
  store.transact((tx) => tx.append([new GrantCanceled({ grantId, cause: "lostRace" })]))

/** The ledger row a settle action writes: a charge or an orphan cancel. */
export const settleRowOf = (action: SettleAction) =>
  Schema.is(ChargeFromFinished)(action)
    ? new Charged({ grantId: action.grantId, endedAt: action.endedAt, points: action.points })
    : new GrantCanceled({ grantId: action.grantId, cause: "orphan" })

/**
 * The settle step for `project` in one transaction: reads the ledger,
 * decides with `settleActions` against the project's log, and writes the
 * cancels and charges. If the transaction fails, nothing is written and
 * the launch attempt launches nothing.
 */
export const applySettle = (
  store: LedgerStore,
  log: ReadonlyArray<ProjectEvent>,
  project: ProjectId,
) =>
  store.transact((tx) =>
    Effect.flatMap(tx.read, (snapshot) =>
      tx.append(Arr.map(settleActions(log, snapshot, project), settleRowOf)),
    ),
  )
