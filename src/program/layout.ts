// The layout check before anything is opened (batch review B05): Runtime
// resolves each configured path, Features checks the layout rules. It
// runs before the state directory's stores are opened, before git's HOME
// is made and before any git command, so a refused layout leaves nothing
// behind.
import { Effect } from "effect"
import { type CanonicalLayout, LayoutRefused } from "../domain/layout.ts"
import type { PathUnreadable } from "../domain/worktree.ts"
import { checkLayout } from "../features/layout.ts"
import { canonicalPathOf } from "../runtime/canonical-path.ts"

/**
 * The configured layout resolved and checked: its canonical paths, or
 * `LayoutRefused` when a rule is broken or a path cannot be resolved.
 */
export const checkedLayout = (configured: CanonicalLayout) =>
  Effect.gen(function* () {
    const canonical: CanonicalLayout = yield* Effect.mapError(
      Effect.all({
        stateDir: canonicalPathOf(configured.stateDir),
        ownerCheckout: canonicalPathOf(configured.ownerCheckout),
        supervisor: canonicalPathOf(configured.supervisor),
        ledgerDir: canonicalPathOf(configured.ledgerDir),
      }),
      unresolved,
    )
    yield* Effect.fromResult(checkLayout(canonical))
    return canonical
  })

/** A path that could not be resolved, as a refusal. */
const unresolved = (failed: PathUnreadable) =>
  new LayoutRefused({ reasons: [`cannot resolve ${failed.path}: ${failed.reason}`] })
