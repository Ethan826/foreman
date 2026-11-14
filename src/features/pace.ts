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
import {
  Array as Arr,
  Data,
  Number,
  Option,
  Order,
  Predicate,
  Schema,
  Struct,
  pipe,
} from "effect"
import { constTrue } from "effect/Function"
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

// The judgment of one policy window.
type Judgment = Data.TaggedEnum<{
  Allows: { readonly window: Window }
  Fails: { readonly window: Window }
  Unusable: { readonly window: Window }
}>
const Judgment = Data.taggedEnum<Judgment>()

const newestThenHighest: Order.Order<Observation> = Order.combine(
  Order.mapInput(Order.Number, (reading: Observation) => reading.observedAt),
  Order.mapInput(Order.Number, (reading: Observation) => reading.usedPercent),
)

const isUsable =
  (now: number, freshnessMillis: number) => (reading: Observation) => {
    const beforeReset = (resetsAt: number) => now < resetsAt
    return (
      Number.between(now - reading.observedAt, {
        minimum: 0,
        maximum: freshnessMillis,
      }) &&
      Option.match(reading.resetsAt, { onNone: constTrue, onSome: beforeReset })
    )
  }

const judgeReading =
  (now: number, policy: Policy, entry: WindowPolicy, points: number) =>
  (reading: Observation): Judgment => {
    const { window } = entry
    if (!isUsable(now, policy.freshnessMillis)(reading))
      return Judgment.Unusable({ window })
    return reading.usedPercent + points <= 100 - entry.reservePercent
      ? Judgment.Allows({ window })
      : Judgment.Fails({ window })
  }

const judgeWindow =
  (
    observations: ReadonlyArray<Observation>,
    now: number,
    policy: Policy,
    estimate: (window: Window) => number,
  ) =>
  (entry: WindowPolicy): Judgment => {
    const isOfWindow = (reading: Observation) => reading.window === entry.window
    const judgeNewest = (ofWindow: Arr.NonEmptyReadonlyArray<Observation>) =>
      judgeReading(now, policy, entry, estimate(entry.window))(
        Arr.max(ofWindow, newestThenHighest),
      )
    return pipe(
      Arr.filter(observations, isOfWindow),
      Arr.match({
        onEmpty: () => Judgment.Unusable({ window: entry.window }),
        onNonEmpty: judgeNewest,
      }),
    )
  }

export const pace = (
  observations: ReadonlyArray<Observation>,
  now: number,
  policy: Policy,
  provider: Client,
  estimate: (window: Window) => number,
): PaceDecision => {
  const isOfProvider = (reading: Observation) => reading.provider === provider
  const ofProvider = Arr.filter(observations, isOfProvider)
  const judged = Arr.map(
    policy.providers[provider].windows,
    judgeWindow(ofProvider, now, policy, estimate),
  )
  const notAllowing = Arr.map(
    Arr.filter(judged, Predicate.not(Predicate.isTagged("Allows"))),
    Struct.get("window"),
  )
  if (Arr.some(judged, Predicate.isTagged("Fails")))
    return new Hold({ windows: notAllowing })
  const noWindows = Arr.isReadonlyArrayEmpty(judged)
  if (noWindows || Arr.isReadonlyArrayNonEmpty(notAllowing))
    return new Unknown({ windows: notAllowing })
  return new Allow({})
}
