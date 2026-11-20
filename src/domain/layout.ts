// The approved layout of a project's paths (batch review B05; design
// "Supervisor worktree" and "Where the ledger lives"): the state
// directory and the supervisor worktree outside the owner's checkout, and
// the state directory and the ledger outside the supervisor worktree, the
// one place a client may write. Each path is canonical: every symbolic
// link resolved, and a path not made yet resolved through its nearest
// existing ancestor.
import { Schema } from "effect"

/** The canonical paths the layout rules compare. */
export const CanonicalLayout = Schema.Struct({
  stateDir: Schema.String,
  ownerCheckout: Schema.String,
  supervisor: Schema.String,
  ledgerDir: Schema.String,
})
/** The canonical paths the layout rules compare; see {@link CanonicalLayout}. */
export type CanonicalLayout = typeof CanonicalLayout.Type

/**
 * The configured paths break the layout, or one could not be resolved.
 * `reasons` lists every broken rule; nothing was created, opened or run.
 */
export class LayoutRefused extends Schema.TaggedError<LayoutRefused>()("LayoutRefused", {
  reasons: Schema.NonEmptyArray(Schema.String),
}) {}
