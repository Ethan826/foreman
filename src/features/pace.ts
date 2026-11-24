// Pure pacing decision (design revision 6.1, "Pacing" and "Admission
// rule", rule 1). Admission is pacing over tarlatan's own records: it bounds
// tarlatan's launches and reservations given those records. It does not
// bound the provider's count, a step's real use, or the reserve.
//
// The wall clock enters only through `now < resetsAt`, which can only
// tighten as time passes. A new period can lower the reading term; it
// frees no accounting room.
import { Array as Arr, Number, Option, Schema, Struct } from "effect"
import type { Client } from "../domain/clients.ts"
import { microsPerMilli, type MonoStamp } from "../domain/clock.ts"
import type { GrantPoints } from "../domain/grant.ts"
import type { Policy } from "../domain/policy.ts"
import { Window } from "../domain/window.ts"
import { type Observation, wholeWindowPercent } from "../domain/observation.ts"
import { currentPeriod, type WindowPeriod } from "./periods.ts"

/** Every policy window is usable and has room for the estimate. */
export class Allow extends Schema.TaggedClass<Allow>()("Allow", {}) {}
/**
 * At least one usable window has no room for the estimate. `windows` lists
 * every window without a usable allowing reading, in policy order.
 */
export class Hold extends Schema.TaggedClass<Hold>()("Hold", {
  windows: Schema.Array(Window),
}) {}
/**
 * No usable window fails, but some window is unusable, or the provider has
 * no policy windows. `windows` lists the unusable windows in policy order
 * (empty when the provider has none). A launch then needs a waiver.
 */
export class Unknown extends Schema.TaggedClass<Unknown>()("Unknown", {
  windows: Schema.Array(Window),
}) {}

/** The answer of {@link pace}. */
export type PaceDecision = Allow | Hold | Unknown

/**
 * What {@link pace} decides from.
 *
 * - `readings`: the ledger's readings in seq order (any provider).
 * - `now`: the wall clock in epoch milliseconds, used only for
 *   `now < resetsAt`.
 * - `nowMono`: the monotonic clock now; `Option.none()` when no monotonic
 *   clock is available (O11).
 * - `estimate`: the next step's estimate in points per window.
 * - `counting`: the points of the grants that count; the caller decides
 *   which grants count (plan Task B2).
 * - `cap`: the cap in points per window, usually {@link defaultCap}.
 */
export interface PaceInput {
  readonly readings: ReadonlyArray<Observation>
  readonly now: number
  readonly nowMono: Option.Option<MonoStamp>
  readonly policy: Policy
  readonly provider: Client
  /** The next step's estimate in points for a window; pace raises it to `minEstimatePoints`. */
  readonly estimate: (window: Window) => number
  readonly counting: ReadonlyArray<GrantPoints>
  /** The cap in points for a window, usually {@link defaultCap}; a spend-down supplies its own. */
  readonly cap: (window: Window) => number
}

/**
 * A window's level in points: the period's highest reading plus the points
 * of every grant in `counting` for `window`. It filters grants by window
 * only, so the caller passes one provider's grants ({@link pace} does).
 */
export const level = (
  period: WindowPeriod,
  counting: ReadonlyArray<GrantPoints>,
  window: Window,
): number =>
  period.highest +
  Number.sumAll(
    Arr.map(
      Arr.filter(counting, (grant) => grant.window === window),
      Struct.get("points"),
    ),
  )

/**
 * The default cap for a provider window: 100 minus the window's reserve
 * percent. A window not listed in the provider's policy gets 100.
 */
export const defaultCap =
  (policy: Policy, provider: Client) =>
  (window: Window): number =>
    wholeWindowPercent -
    Option.match(
      Arr.findFirst(
        policy.providers[provider].windows,
        (entry) => entry.window === window,
      ),
      { onNone: () => 0, onSome: Struct.get("reservePercent") },
    )

/**
 * True when both stamps exist, come from the same boot, and
 * `0 <= now - freshest <= freshness` in microseconds (both bounds
 * inclusive). A missing stamp on either side gives false.
 */
const isFresh = (
  freshest: Option.Option<MonoStamp>,
  nowMono: Option.Option<MonoStamp>,
  freshnessMillis: number,
): boolean =>
  Option.getOrElse(
    Option.zipWith(
      freshest,
      nowMono,
      (seen, now) =>
        seen.bootId === now.bootId &&
        Number.between(now.micros - seen.micros, {
          minimum: 0,
          maximum: freshnessMillis * microsPerMilli,
        }),
    ),
    () => false,
  )

/**
 * A period is usable when its freshest stamp is fresh and its reset time
 * is absent or still ahead of the wall clock (`now < resetsAt`). With no
 * monotonic clock no period is usable, so every launch is Unknown.
 */
const isUsable = (input: PaceInput, period: WindowPeriod): boolean =>
  isFresh(period.freshest, input.nowMono, input.policy.freshnessMillis) &&
  Option.match(period.resetsAt, {
    onNone: () => true,
    onSome: (resetsAt) => input.now < resetsAt,
  })

type Judgment = "allows" | "fails" | "unusable"

/**
 * Judges one window: "unusable" when it has no current period or the
 * period is not usable; otherwise "allows" when level + estimate <= cap,
 * with the estimate raised to `minEstimatePoints` if lower (O15), and
 * "fails" when not.
 */
const judge =
  (input: PaceInput, counting: ReadonlyArray<GrantPoints>) =>
  (window: Window): Judgment =>
    Option.match(currentPeriod(input.readings, input.provider, window, input.policy), {
      onNone: () => "unusable",
      onSome: (period) => {
        if (!isUsable(input, period)) return "unusable"
        const estimate = Math.max(
          input.policy.minEstimatePoints,
          input.estimate(window),
        )
        return level(period, counting, window) + estimate <=
          input.cap(window)
          ? "allows"
          : "fails"
      },
    })

/**
 * Decides whether tarlatan may launch a step on `provider` (design
 * "Admission rule", rule 1). It checks exactly the provider's policy
 * windows (R-P1) and counts only that provider's grants.
 *
 * Allow when every window is usable and level + estimate <= cap. Hold when
 * any usable window fails that test. Otherwise Unknown, which includes a
 * provider with no policy windows.
 */
export const pace = (input: PaceInput): PaceDecision => {
  const counting = Arr.filter(
    input.counting,
    (grant) => grant.provider === input.provider,
  )
  const judged = Arr.map(
    input.policy.providers[input.provider].windows,
    ({ window }) => ({ window, judgment: judge(input, counting)(window) }),
  )
  const notAllowing = Arr.map(
    Arr.filter(judged, (j) => j.judgment !== "allows"),
    Struct.get("window"),
  )
  if (Arr.some(judged, (j) => j.judgment === "fails"))
    return new Hold({ windows: notAllowing })
  if (
    Arr.isReadonlyArrayEmpty(judged) ||
    Arr.isReadonlyArrayNonEmpty(notAllowing)
  )
    return new Unknown({ windows: notAllowing })
  return new Allow({})
}
