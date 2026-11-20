// Step 3 of the write protocol (plan "Write protocol"): admission and the
// waiver step. Non-quota holds already stopped the command; a quota hold
// of the launched provider did not.
//
// - A waiver armed for the provider (a retry after batch W): admit with it.
// - Otherwise, with no quota hold for the provider, decide admission. If
//   admitted, done. If pacing refuses, append batch Q, the quota hold.
// - Now a quota hold exists. Without `--waive`, stop; the consent is not
//   consumed. With it, `waiveAccepted` decides: append batch W and admit
//   with the new waiver, or stop having written nothing beyond batch Q.
//
// The ledger transaction of each admission writes the grant.
import { Array as Arr, Clock, Effect, Option, Schema } from "effect"
import { HoldCreated, type LogPosition, Waived } from "../domain/events.ts"
import type { Hold } from "../domain/holds.ts"
import { GrantId, OpId, WaiverId } from "../domain/ids.ts"
import type { SessionFold } from "../domain/session-state.ts"
import { type AdmissionRequest, type AllocationRefused, type Refused } from "../features/admission.ts"
import { quotaHoldFor } from "../features/launch-facts.ts"
import { waiveAccepted } from "../features/waiver.ts"
import { admit, Admitted } from "./admission.ts"
import type { LaunchPlan } from "./attempt.ts"
import type { LogRead } from "./command-start.ts"
import type { SessionContext } from "./session-context.ts"
import { QuotaHeld, WaiverRefused } from "./session-errors.ts"

/** What step 3 reads: the log, its fold, the holds in place, and whether a quota hold blocks. */
export interface AdmissionInput {
  readonly read: LogRead
  readonly fold: SessionFold
  readonly holds: ReadonlyArray<Hold>
  /** A quota hold of the launched provider is in place (`Allowed.waiverStep`). */
  readonly waiverStep: boolean
}

/** The grant step 3 wrote, the waiver it used, and the log position after batches Q and W. */
export interface Grant {
  readonly opId: OpId
  readonly grantId: GrantId
  readonly waiverId: Option.Option<WaiverId>
  readonly position: LogPosition
}

/** Step 3 (see the module comment). Fails with `QuotaHeld` or `WaiverRefused`. */
export const admitStep = <E>(context: SessionContext, plan: LaunchPlan<E>, input: AdmissionInput) =>
  Effect.gen(function* () {
    const ids = { opId: OpId.make(yield* context.capabilities.newId), grantId: GrantId.make(yield* context.capabilities.newId) }
    const armed = input.fold.armedWaivers[plan.provider]
    if (Option.isSome(armed)) return yield* grantWith(context, plan, ids, armed.value, input.read.position)
    if (!input.waiverStep) {
      const verdict = yield* admitWith(context, plan, ids, Option.none())
      if (Schema.is(Admitted)(verdict)) return { ...ids, waiverId: Option.none(), position: input.read.position }
      return yield* afterRefusal(context, plan, ids, input, verdict)
    }
    return yield* waiverStep(context, plan, ids, input, input.read.position, [])
  })

/** Batch Q after pacing refused, then the waiver step with the new hold. */
const afterRefusal = <E>(
  context: SessionContext,
  plan: LaunchPlan<E>,
  ids: Ids,
  input: AdmissionInput,
  refusal: Refused | AllocationRefused,
) =>
  Effect.gen(function* () {
    const snapshot = yield* context.capabilities.ledger.transact((tx) => tx.read)
    const hold = quotaHoldFor(plan.provider, refusal, snapshot, yield* context.capabilities.nowMono)
    const created = new HoldCreated({ hold })
    const position = yield* context.capabilities.log.append(input.read.position, [created])
    return yield* waiverStep(context, plan, ids, { ...input, holds: Arr.append(input.holds, hold) }, position, [
      created,
    ])
  })

/** With a quota hold in place: stop without `--waive`; otherwise batch W and the grant. */
const waiverStep = <E>(
  context: SessionContext,
  plan: LaunchPlan<E>,
  ids: Ids,
  input: AdmissionInput,
  position: LogPosition,
  written: ReadonlyArray<HoldCreated>,
) =>
  Effect.gen(function* () {
    if (!plan.waive) return yield* new QuotaHeld({ provider: plan.provider })
    const events = Arr.appendAll(input.read.events, written)
    if (!waiveAccepted(input.holds, events, plan.provider))
      return yield* new WaiverRefused({ provider: plan.provider })
    const waiverId = WaiverId.make(yield* context.capabilities.newId)
    const after = yield* context.capabilities.log.append(position, [
      new Waived({ provider: plan.provider, waiverId }),
    ])
    return yield* grantWith(context, plan, ids, waiverId, after)
  })

/** Admits with the armed waiver `waiverId`; a waiver for the provider always admits. */
const grantWith = <E>(
  context: SessionContext,
  plan: LaunchPlan<E>,
  ids: Ids,
  waiverId: WaiverId,
  position: LogPosition,
) =>
  Effect.gen(function* () {
    const verdict = yield* admitWith(context, plan, ids, Option.some(waiverId))
    if (!Schema.is(Admitted)(verdict)) return yield* Effect.die("a waived admission was refused")
    return { ...ids, waiverId: Option.some(waiverId), position } satisfies Grant
  })

/** One admission transaction for this launch. */
const admitWith = <E>(context: SessionContext, plan: LaunchPlan<E>, ids: Ids, waiver: Option.Option<WaiverId>) =>
  Effect.gen(function* () {
    const request: AdmissionRequest = {
      project: context.settings.project,
      ...ids,
      provider: plan.provider,
      estimate: Arr.map(context.settings.admission.policy.providers[plan.provider].windows, ({ window }) => ({
        window,
        points: context.settings.estimates[plan.role],
      })),
      now: yield* Clock.currentTimeMillis,
      nowMono: yield* context.capabilities.nowMono,
      waiver: Option.map(waiver, (waiverId) => ({ waiverId, provider: plan.provider })),
    }
    return yield* admit(context.capabilities.ledger, request, context.settings.admission)
  })

/** The fresh ids of this launch. */
interface Ids {
  readonly opId: OpId
  readonly grantId: GrantId
}
