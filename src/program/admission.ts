// Admission and the grant lifecycle's ledger writes (design "Admission
// rule", "Grant lifecycle"). Program only reads, writes and wires: each
// function runs one ledger transaction, asks a pure Features function what
// to do, and writes what it returns (owner ruling 2026-11-17). Admission is
// pacing over foreman's own records, not a provider-usage guarantee.
import { Array as Arr, Effect, Schema } from "effect"
import type { ProjectEvent } from "../domain/events.ts"
import { GrantId, LedgerSeq, type ProjectId } from "../domain/ids.ts"
import { Charged, GrantCanceled, LedgerError, type LedgerStore } from "../domain/ledger.ts"
import {
  Admit,
  type AdmissionContext,
  type AdmissionRequest,
  decideAdmission,
} from "../features/admission.ts"
import { ChargeFromFinished, type SettleAction, settleActions } from "../features/settle.ts"

/** The request was admitted and its grant written at `seq`. */
export class Admitted extends Schema.TaggedClass<Admitted>()("Admitted", {
  grantId: GrantId,
  seq: LedgerSeq,
}) {}

/**
 * Decides one request in one transaction and writes what the decision
 * says: the spend-down cancels it returns (whatever the verdict), then the
 * grant if admitted. Returns `Admitted` with the grant's seq, or the
 * refusal. A refusal writes no grant.
 */
export const admit = (store: LedgerStore, request: AdmissionRequest, context: AdmissionContext) =>
  store.transact((tx) =>
    Effect.gen(function* () {
      const decision = decideAdmission(yield* tx.read, request, context)
      yield* tx.append(decision.expire)
      const { verdict } = decision
      if (!Schema.is(Admit)(verdict)) return verdict
      const seq = yield* Effect.fromOption(Arr.head(yield* tx.append([verdict.grant])), () =>
        new LedgerError({ reason: "the grant was not written" }),
      )
      return new Admitted({ grantId: verdict.grant.grantId, seq })
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
