// The step events of the project log (design "Operations, checkpoints and
// recovery"): a step's intent, launch, end and commit. A step's outcome
// and a commit's outcome reuse Domain's outcome types. Re-exported by
// events.ts, which holds the union.
import { Schema } from "effect"
import { Client } from "./clients.ts"
import { GrantId, OpId, Revision, TrancheId, WaiverId } from "./ids.ts"
import { CommitOutcome, StepOutcome } from "./outcomes.ts"
import { Step } from "./roles.ts"

const epochMillis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * Written before a step launches, after its grant (design "Operations",
 * step 1; "Grant lifecycle"). Names the grant that reserved the launch, so
 * a grant no `Intended` names is an orphan.
 */
export class Intended extends Schema.TaggedClass<Intended>()("Intended", {
  opId: OpId,
  tranche: TrancheId,
  step: Step,
  baseRevision: Revision,
  grantId: GrantId,
  client: Client,
  waiverId: Schema.OptionFromOptionalKey(WaiverId),
}) {}

/**
 * The step's process started as the leader of process group `pgid`.
 * `leaderStartedAt` is the leader's start time as `ps` printed it, read
 * once right after spawn; absent when it could not be read. It is
 * advisory evidence only (plan "Process evidence").
 */
export class Launched extends Schema.TaggedClass<Launched>()("Launched", {
  opId: OpId,
  pgid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  leaderStartedAt: Schema.OptionFromOptionalKey(Schema.String.check(Schema.isNonEmpty())),
}) {}

/** The step's process ended at `endedAt` (wall clock) with `outcome`. */
export class Finished extends Schema.TaggedClass<Finished>()("Finished", {
  opId: OpId,
  outcome: StepOutcome,
  endedAt: epochMillis,
}) {}

/** The outcome of committing the step's changes. */
export class CommitRecorded extends Schema.TaggedClass<CommitRecorded>()(
  "CommitRecorded",
  { opId: OpId, outcome: CommitOutcome },
) {}
