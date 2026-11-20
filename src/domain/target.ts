// The target a state directory is bound to (batch review B04; design
// "Where the ledger lives", `LedgerBound`): the project id, the owner's
// checkout, the supervisor worktree's path and branch name, the ledger
// file and the root `.gitattributes` allowance, every path canonical. It
// is recorded at first use; a later configuration naming the same state
// directory must name the same target.
import { Schema } from "effect"
import { ApprovedAttributeAllowance } from "./attributes.ts"
import { ProjectId } from "./ids.ts"

/** The bound target; see the module comment. */
export const TargetBinding = Schema.Struct({
  projectId: ProjectId,
  ownerCheckout: Schema.String,
  supervisor: Schema.Struct({ path: Schema.String, name: Schema.String }),
  /** The ledger file, `<ledgerDir>/ledger.sqlite`, canonical. */
  ledger: Schema.String,
  attributeAllowance: ApprovedAttributeAllowance,
})
/** The bound target; see {@link TargetBinding}. */
export type TargetBinding = typeof TargetBinding.Type

/**
 * The configuration names a different target than the state directory is
 * bound to. `differences` lists each field with its recorded and its
 * configured value. Nothing was opened, launched or run.
 */
export class TargetMismatch extends Schema.TaggedError<TargetMismatch>()("TargetMismatch", {
  binding: Schema.String,
  differences: Schema.NonEmptyArray(Schema.String),
}) {}

/** The recorded binding could not be read or decoded; nothing more ran. */
export class TargetBindingUnreadable extends Schema.TaggedError<TargetBindingUnreadable>()(
  "TargetBindingUnreadable",
  { binding: Schema.String, reason: Schema.String },
) {}
