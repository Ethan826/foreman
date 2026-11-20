// The layout rules (batch review B05): over canonical paths, the state
// directory and the supervisor worktree lie outside the owner's checkout,
// the owner's checkout lies outside the supervisor worktree, and the state
// directory and the ledger lie outside the supervisor worktree. "Outside"
// means neither the same path nor below it, compared by whole path
// components.
import { Array as Arr, Result, String } from "effect"
import { type CanonicalLayout, LayoutRefused } from "../domain/layout.ts"

/** One rule: a path that must lie outside a directory, and how the reason reads. */
interface OutsideRule {
  readonly inner: keyof CanonicalLayout
  readonly outer: keyof CanonicalLayout
  readonly reason: string
}

/** Every layout rule, in the order the refusal lists them. */
const outsideRules: ReadonlyArray<OutsideRule> = [
  { inner: "stateDir", outer: "ownerCheckout", reason: "the state directory is inside the owner's checkout" },
  { inner: "supervisor", outer: "ownerCheckout", reason: "the supervisor worktree is inside the owner's checkout" },
  { inner: "ownerCheckout", outer: "supervisor", reason: "the owner's checkout is inside the supervisor worktree" },
  { inner: "stateDir", outer: "supervisor", reason: "the state directory is inside the supervisor worktree" },
  { inner: "ledgerDir", outer: "supervisor", reason: "the ledger directory is inside the supervisor worktree" },
]

/**
 * Passes a layout that keeps every rule; otherwise fails with
 * {@link LayoutRefused} naming each broken rule with both paths.
 */
export const checkLayout = (layout: CanonicalLayout): Result.Result<void, LayoutRefused> =>
  Arr.match(Arr.flatMap(outsideRules, brokenRule(layout)), {
    onEmpty: () => Result.void,
    onNonEmpty: (reasons) => Result.fail(new LayoutRefused({ reasons })),
  })

/**
 * Whether `path` is `directory` or lies below it, by whole components:
 * `/a/bc` is not below `/a/b`. Every path is below `/`.
 */
export const isWithin = (path: string, directory: string): boolean =>
  path === directory || String.startsWith(String.endsWith("/")(directory) ? directory : `${directory}/`)(path)

/** A rule's reason with both paths when the layout breaks it, nothing otherwise. */
const brokenRule = (layout: CanonicalLayout) => (rule: OutsideRule): ReadonlyArray<string> =>
  isWithin(layout[rule.inner], layout[rule.outer])
    ? [`${rule.reason}: ${layout[rule.inner]} is within ${layout[rule.outer]}`]
    : []
