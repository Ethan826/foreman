// Pure pacing decision (design revision 6.1, "Pacing" and "Admission
// rule", rule 1). Admission is pacing over foreman's own records: it bounds
// foreman's launches and reservations given those records. It does not
// bound the provider's count, a step's real use, or the reserve.
//
// Rules:
// 1. The windows checked are the provider's windows in policy (R-P1). A
//    provider with no policy windows is Unknown, never Allow.
// 2. A window is usable when its current period (the asked provider's
//    readings of that window only) exists, the period's
//    freshest stamp and `nowMono` come from the same boot with
//    0 <= nowMono - freshest <= freshness, and the period's reset time is
//    absent or still ahead of the wall clock (`now < resetsAt`). With no
//    monotonic clock (`nowMono` none, owner decision O11) no window is
//    usable, so every launch is Unknown and needs a waiver.
// 3. The level of a window is the period's highest reading plus the points
//    of every counting grant for that window (`level`). Which grants count
//    is decided by the caller (plan Task B2); pacing never filters them
//    beyond provider and window.
// 4. Allow iff every window is usable and level + estimate <= cap, with
//    the estimate never below minEstimatePoints (O15). Hold if
//    a usable window fails that test. Otherwise Unknown. Hold and Unknown
//    carry the windows without a usable allowing reading, in policy order.
//
// The wall clock enters only through `now < resetsAt`, which can only
// tighten as time passes. A new period can lower the reading term; it
// frees no accounting room.
import { Array as Arr, Number, Option, Schema, Struct } from "effect"
import type { Client } from "../domain/clients.ts"
import type { MonoStamp } from "../domain/clock.ts"
import type { GrantPoints } from "../domain/grant.ts"
import type { Policy } from "../domain/policy.ts"
import { Window } from "../domain/window.ts"
import type { Observation } from "../domain/observation.ts"
import { currentPeriod, type WindowPeriod } from "./periods.ts"

export class Allow extends Schema.TaggedClass<Allow>()("Allow", {}) {}
export class Hold extends Schema.TaggedClass<Hold>()("Hold", {
  windows: Schema.Array(Window),
}) {}
export class Unknown extends Schema.TaggedClass<Unknown>()("Unknown", {
  windows: Schema.Array(Window),
}) {}

export type PaceDecision = Allow | Hold | Unknown

export interface PaceInput {
  readonly readings: ReadonlyArray<Observation>
  readonly now: number
  readonly nowMono: Option.Option<MonoStamp>
  readonly policy: Policy
  readonly provider: Client
  readonly estimate: (window: Window) => number
  readonly counting: ReadonlyArray<GrantPoints>
  readonly cap: (window: Window) => number
}

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

export const defaultCap =
  (policy: Policy, provider: Client) =>
  (window: Window): number =>
    100 -
    Option.match(
      Arr.findFirst(
        policy.providers[provider].windows,
        (entry) => entry.window === window,
      ),
      { onNone: () => 0, onSome: Struct.get("reservePercent") },
    )

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
          maximum: freshnessMillis * 1000,
        }),
    ),
    () => false,
  )

const isUsable = (input: PaceInput, period: WindowPeriod): boolean =>
  isFresh(period.freshest, input.nowMono, input.policy.freshnessMillis) &&
  Option.match(period.resetsAt, {
    onNone: () => true,
    onSome: (resetsAt) => input.now < resetsAt,
  })

type Judgment = "allows" | "fails" | "unusable"

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
