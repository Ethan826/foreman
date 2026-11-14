// provisional: revision 3 of the design may change pacing rules
//
// Pure pacing decision, design "Pacing (S3, S4)":
// `pace(observations, now, policy, provider, estimate) -> Allow | Hold |
// Unknown`.
//
// Rules implemented (all from "Pacing"):
// 1. Only readings of the asked provider count.
// 2. The windows checked are the provider's windows listed in policy, not
//    the windows that happen to have readings (R-P1). With no readings the
//    result is Unknown.
// 3. Per window the reading used is the one with the latest observedAt,
//    whatever order readings arrive in; among equal observedAt, the highest
//    usedPercent (R-P4). The newest reading decides even when it is
//    unusable; an older reading is never used in its place.
// 4. A reading is usable when 0 <= now - observedAt <= freshness and either
//    resetsAt is absent or now < resetsAt. A reading stamped after `now` is
//    unusable (owner ruling, 2026-11-14: clock skew could make a stale
//    reading look fresh). Design revision 3 defines the clock basis.
// 5. Allow iff every policy window has a usable reading with
//    usedPercent + estimate(window) <= 100 - reserve(window). Hold if any
//    usable reading fails that test. Otherwise Unknown.
//
// Choices the design text leaves open (confirm in review):
// - A provider whose policy lists no windows is Unknown, never Allow, so
//   that "every window allows" cannot hold vacuously (the default Codex
//   policy lists none until live test L2).
// - Hold and Unknown carry the policy windows without a usable allowing
//   reading, in policy order: the `windows` of a Quota hold ("Holds", Quota
//   row).
//
// Not here: `estimate` itself (R-P3, built from finished-step records by the
// shell's event fold) is a parameter.
import { Array as Arr, Order, Schema } from "effect"
import type { Observation } from "../domain/observation.ts"
import type { Policy, WindowPolicy } from "../domain/policy.ts"
import type { Client } from "../domain/roles.ts"
import { Window } from "../domain/window.ts"

export class Allow extends Schema.TaggedClass<Allow>()("Allow", {}) {}
export class Hold extends Schema.TaggedClass<Hold>()("Hold", {
  windows: Schema.Array(Window),
}) {}
export class Unknown extends Schema.TaggedClass<Unknown>()("Unknown", {
  windows: Schema.Array(Window),
}) {}

export type PaceDecision = Allow | Hold | Unknown

type Verdict = "allows" | "fails" | "unusable"

const newestThenHighest: Order.Order<Observation> = Order.combine(
  Order.mapInput(Order.Number, (reading: Observation) => reading.observedAt),
  Order.mapInput(Order.Number, (reading: Observation) => reading.usedPercent),
)

const isUsable =
  (now: number, freshnessMillis: number) => (reading: Observation) =>
    reading.observedAt <= now &&
    now - reading.observedAt <= freshnessMillis &&
    (reading.resetsAt === undefined || now < reading.resetsAt)

const verdictOf = (
  reading: Observation,
  entry: WindowPolicy,
  points: number,
): Verdict =>
  reading.usedPercent + points <= 100 - entry.reservePercent
    ? "allows"
    : "fails"

const windowVerdict =
  (
    observations: ReadonlyArray<Observation>,
    now: number,
    policy: Policy,
    estimate: (window: Window) => number,
  ) =>
  (entry: WindowPolicy): Verdict => {
    const ofWindow = observations.filter(
      (reading) => reading.window === entry.window,
    )
    if (!Arr.isReadonlyArrayNonEmpty(ofWindow)) return "unusable"
    const newest = Arr.max(ofWindow, newestThenHighest)
    return isUsable(now, policy.freshnessMillis)(newest)
      ? verdictOf(newest, entry, estimate(entry.window))
      : "unusable"
  }

export const pace = (
  observations: ReadonlyArray<Observation>,
  now: number,
  policy: Policy,
  provider: Client,
  estimate: (window: Window) => number,
): PaceDecision => {
  const entries = policy.providers[provider].windows
  const ofProvider = observations.filter(
    (reading) => reading.provider === provider,
  )
  const judge = windowVerdict(ofProvider, now, policy, estimate)
  const judged = entries.map((entry) => ({
    window: entry.window,
    verdict: judge(entry),
  }))
  const notAllowing = judged
    .filter((each) => each.verdict !== "allows")
    .map((each) => each.window)
  if (judged.some((each) => each.verdict === "fails"))
    return new Hold({ windows: notAllowing })
  if (Arr.isReadonlyArrayEmpty(judged) || Arr.isReadonlyArrayNonEmpty(notAllowing))
    return new Unknown({ windows: notAllowing })
  return new Allow({})
}
