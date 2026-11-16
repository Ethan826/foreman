// Holds (design "Holds (S7)"). Each hold is keyed by its reason and is
// removed only by its own release event; the release rules belong to
// Features (plan Task B6). Holds for quota, approval, uncertain operations
// and failures stay distinct, and no timer releases any of them.
//
// Payloads follow the holds table:
// - Approval(tranche, revision)
// - Quota(provider, windows, heldMono, ledgerSeq): a reading releases it
//   only when it is post-hold by the monotonic clock (same boot, later
//   stamp) and by ledger seq. `heldMono` is absent when no monotonic
//   clock is available (O11); then no reading is post-hold by that test.
// - Uncertain(opId)
// - Failure(opId, outcome): the classified step or commit outcome.
// - Drift(worktree, expected, head, dirty), for the supervisor or the
//   review worktree.
// - Protected(paths): the changed protected paths, at least one.
import { Array as Arr, Record, Schema } from "effect"
import { Client } from "./clients.ts"
import { MonoStamp } from "./clock.ts"
import { LedgerSeq, OpId, Revision, TrancheId } from "./ids.ts"
import { CommitOutcome, StepOutcome } from "./outcomes.ts"
import { Window } from "./window.ts"

export const HoldKinds = {
  Approval: "Approval",
  Quota: "Quota",
  Uncertain: "Uncertain",
  Failure: "Failure",
  Drift: "Drift",
  Protected: "Protected",
} as const

export const WorktreeKinds = {
  Supervisor: "supervisor",
  Review: "review",
} as const

export const WorktreeKind = Schema.Literals(Record.values(WorktreeKinds))
export type WorktreeKind = typeof WorktreeKind.Type

export class Approval extends Schema.TaggedClass<Approval>()(
  HoldKinds.Approval,
  { tranche: TrancheId, revision: Revision },
) {}

export class Quota extends Schema.TaggedClass<Quota>()(HoldKinds.Quota, {
  provider: Client,
  windows: Schema.Array(Window),
  heldMono: Schema.OptionFromOptionalKey(MonoStamp),
  ledgerSeq: LedgerSeq,
}) {}

export class Uncertain extends Schema.TaggedClass<Uncertain>()(
  HoldKinds.Uncertain,
  { opId: OpId },
) {}

export class Failure extends Schema.TaggedClass<Failure>()(
  HoldKinds.Failure,
  { opId: OpId, outcome: Schema.Union([StepOutcome, CommitOutcome]) },
) {}

export class Drift extends Schema.TaggedClass<Drift>()(HoldKinds.Drift, {
  worktree: WorktreeKind,
  expected: Revision,
  head: Revision,
  dirty: Schema.Boolean,
}) {}

const atLeastOne = Schema.makeFilter<ReadonlyArray<string>>(
  (paths) => Arr.isReadonlyArrayNonEmpty(paths) || "at least one path",
)

export class Protected extends Schema.TaggedClass<Protected>()(
  HoldKinds.Protected,
  { paths: Schema.Array(Schema.String).check(atLeastOne) },
) {}

export const Hold = Schema.Union([
  Approval,
  Quota,
  Uncertain,
  Failure,
  Drift,
  Protected,
])
export type Hold = typeof Hold.Type
