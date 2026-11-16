// Holds (design "Holds (S7)"). The payloads follow the holds table. The
// release rules belong to Features (plan Task B6).
import { Array as Arr, Record, Schema } from "effect"
import { Client } from "./clients.ts"
import { MonoStamp } from "./clock.ts"
import { LedgerSeq, OpId, Revision, TrancheId } from "./ids.ts"
import { CommitOutcome, StepOutcome } from "./outcomes.ts"
import { Window } from "./window.ts"

/**
 * The hold reasons, which are also the hold tags. Each hold is keyed by its
 * reason and is removed only by its own release event. A quota hold blocks
 * only its provider's steps; every other hold blocks every launch. Holds for quota,
 * approval, uncertain operations and failures stay distinct, and no timer
 * releases any of them (design "Holds (S7)").
 */
export const HoldKinds = {
  Approval: "Approval",
  Quota: "Quota",
  Uncertain: "Uncertain",
  Failure: "Failure",
  Drift: "Drift",
  Protected: "Protected",
} as const

/** The worktrees a drift hold can name: the supervisor's or the review one. */
export const WorktreeKinds = {
  Supervisor: "supervisor",
  Review: "review",
} as const

/** Schema for a worktree kind, one of {@link WorktreeKinds}. */
export const WorktreeKind = Schema.Literals(Record.values(WorktreeKinds))
/** A worktree kind, one of the values of {@link WorktreeKinds}. */
export type WorktreeKind = typeof WorktreeKind.Type

/**
 * Created when a tranche ends (and at first start). Released only by an
 * `Approved` command whose tranche and revision both match.
 */
export class Approval extends Schema.TaggedClass<Approval>()(
  HoldKinds.Approval,
  { tranche: TrancheId, revision: Revision },
) {}

/**
 * Blocks only `provider`'s steps. Created when pacing says Hold or Unknown
 * at a launch attempt, or by a rate-limited outcome; `windows` lists the
 * windows involved. A reading counts toward release only when it is
 * post-hold by the monotonic clock (same boot, later stamp than
 * `heldMono`) and by ledger seq (above `ledgerSeq`). `heldMono` is absent
 * when no monotonic clock is available (O11); then no reading is post-hold
 * by the clock test. A passed reset time does not release it (O4).
 */
export class Quota extends Schema.TaggedClass<Quota>()(HoldKinds.Quota, {
  provider: Client,
  windows: Schema.Array(Window),
  heldMono: Schema.OptionFromOptionalKey(MonoStamp),
  ledgerSeq: LedgerSeq,
}) {}

/** Created when startup finds operation `opId` unsettled; released by reconciling or abandoning it. */
export class Uncertain extends Schema.TaggedClass<Uncertain>()(
  HoldKinds.Uncertain,
  { opId: OpId },
) {}

/**
 * Created by a classified failure other than a rate limit, a refused
 * commit or a commit failure of operation `opId`; `outcome` is that step
 * or commit outcome. Released only by `Released(opId)`.
 */
export class Failure extends Schema.TaggedClass<Failure>()(
  HoldKinds.Failure,
  { opId: OpId, outcome: Schema.Union([StepOutcome, CommitOutcome]) },
) {}

/**
 * Created when a launch or review finds `worktree` (the supervisor's or
 * the review one) with HEAD at `head` instead of `expected`, or with
 * uncommitted changes (`dirty`).
 */
export class Drift extends Schema.TaggedClass<Drift>()(HoldKinds.Drift, {
  worktree: WorktreeKind,
  expected: Revision,
  head: Revision,
  dirty: Schema.Boolean,
}) {}

const atLeastOne = Schema.makeFilter<ReadonlyArray<string>>(
  (paths) => Arr.isReadonlyArrayNonEmpty(paths) || "at least one path",
)

/** Created when a protected-digest compare finds changes the tranche does not permit; `paths` lists them, at least one. */
export class Protected extends Schema.TaggedClass<Protected>()(
  HoldKinds.Protected,
  { paths: Schema.Array(Schema.String).check(atLeastOne) },
) {}

/** Schema for any hold, tagged by its {@link HoldKinds} reason. */
export const Hold = Schema.Union([
  Approval,
  Quota,
  Uncertain,
  Failure,
  Drift,
  Protected,
])
/** Any hold; see {@link Hold}. */
export type Hold = typeof Hold.Type
