// The owner's events in the project log (design "Holds (S7)", "Waivers",
// "Pre-approved backlog"): approvals, pre-approvals, waivers, releases,
// adoption and reconciliation. Re-exported by events.ts, which holds the
// union.
import { Record, Schema } from "effect"
import { Client } from "./clients.ts"
import { OpId, Revision, TrancheId, WaiverId } from "./ids.ts"

const pathText = Schema.String.check(Schema.isNonEmpty())

/**
 * The owner's live approval of `tranche` at `revision`; releases the
 * matching approval hold. `permits` is the protected-path permission for
 * the next tranche; `base`, when given, also asks to move the base.
 */
export class Approved extends Schema.TaggedClass<Approved>()("Approved", {
  tranche: TrancheId,
  revision: Revision,
  permits: Schema.Array(pathText),
  base: Schema.OptionFromOptionalKey(Revision),
}) {}

/**
 * A pre-approval in the backlog. With `stopBefore`, it never starts its
 * tranche alone: a live approval is still needed.
 */
export class PreApproved extends Schema.TaggedClass<PreApproved>()(
  "PreApproved",
  { tranche: TrancheId, permits: Schema.Array(pathText), stopBefore: Schema.Boolean },
) {}

/** The owner's waiver of one launch for `provider`. */
export class Waived extends Schema.TaggedClass<Waived>()("Waived", {
  provider: Client,
  waiverId: WaiverId,
}) {}

/**
 * The armed waiver `waiverId` expired unused: a launch attempt ended
 * without launching a step of the waived provider (design "Waivers").
 */
export class WaiverExpired extends Schema.TaggedClass<WaiverExpired>()(
  "WaiverExpired",
  { waiverId: WaiverId },
) {}

/** The owner released the failure hold of operation `opId`. */
export class Released extends Schema.TaggedClass<Released>()("Released", {
  opId: OpId,
}) {}

/** The owner adopted `revision` as the supervisor worktree's HEAD. */
export class Adopted extends Schema.TaggedClass<Adopted>()("Adopted", {
  revision: Revision,
}) {}

/** How the owner resolved an uncertain operation. */
export const Reconciliations = {
  Accept: "accept",
  Discard: "discard",
  Abandon: "abandon",
} as const

/** Schema for a reconciliation, one of {@link Reconciliations}. */
export const Reconciliation = Schema.Literals(Record.values(Reconciliations))
/** A reconciliation; see {@link Reconciliations}. */
export type Reconciliation = typeof Reconciliation.Type

/** The owner reconciled uncertain operation `opId`. */
export class Reconciled extends Schema.TaggedClass<Reconciled>()(
  "Reconciled",
  { opId: OpId, resolution: Reconciliation },
) {}

/**
 * The owner's `release-protected`: releases the protected-path hold. With
 * `accept`, the current digest becomes the new baseline; without it, the
 * files matched the recorded digest again.
 */
export class ProtectedReleased extends Schema.TaggedClass<ProtectedReleased>()(
  "ProtectedReleased",
  { accept: Schema.Boolean },
) {}
