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
    const canonical = yield* resolvedLayout(configured)
    yield* Effect.fromResult(checkLayout(canonical))
    return canonical
  })

/**
 * The configured layout resolved, its rules not yet checked: its
 * canonical paths, or `LayoutRefused` when a path cannot be resolved.
 * Reads only. `status` compares a configuration it refuses with the
 * recorded target through this (re-review R03).
 */
export const resolvedLayout = (configured: CanonicalLayout): Effect.Effect<CanonicalLayout, LayoutRefused> =>
  Effect.all({
    stateDir: resolvedPath(configured.stateDir),
    ownerCheckout: resolvedPath(configured.ownerCheckout),
    supervisor: resolvedPath(configured.supervisor),
    ledgerDir: resolvedPath(configured.ledgerDir),
  })

/**
 * One configured path resolved as the layout check resolves it: its
 * canonical path, or `LayoutRefused` when it cannot be resolved, such as
 * a dangling symbolic link. Reads only.
 */
export const resolvedPath = (path: string): Effect.Effect<string, LayoutRefused> =>
  Effect.mapError(canonicalPathOf(path), unresolved)

/** A path that could not be resolved, as a refusal. */
const unresolved = (failed: PathUnreadable) =>
  new LayoutRefused({ reasons: [`cannot resolve ${failed.path}: ${failed.reason}`] })
