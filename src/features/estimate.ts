// Estimate per role and window (design "Pacing", `estimate(window)`, R-P3).
//
// A step is measured in a window when a usable reading observed before the
// step started and one observed after it ended both have a reset time and
// share it (no reset in between). "Before" and "after" compare the
// readings' monotonic stamps with the step's own monotonic start and end in
// the same boot, never the wall clock. The reading before is the latest
// one at or before the start, the reading after the earliest one at or
// after the end.
//
// "Usable" is read strictly (owner ruling 2026-11-16): both bracketing
// readings must be fresh relative to their own step boundary. The reading
// before must be at most `freshness` older than the step's start, and the
// reading after at most `freshness` newer than the step's end. Fewer steps
// are measured, so more fall back to `initialEstimate`.
//
// A measured increase is an observation of the provider's count across the
// step, not authoritative per-step usage: readings are whole points,
// reported with a delay, and include anything else that used the account
// during the step.
//
// The estimate is the largest measured increase among the role's last five
// finished steps, else `initialEstimate`, and never below
// `minEstimatePoints` (owner ruling O15). A measured increase of 0 stays 0
// in `measuredIncrease`; only the estimate is floored. A running agent can still use
// more than its estimate; nothing here bounds real use.
import { Array as Arr, Option, Order } from "effect"
import type { MonoStamp } from "../domain/clock.ts"
import type { Client } from "../domain/clients.ts"
import type { Observation } from "../domain/observation.ts"
import type { Policy } from "../domain/policy.ts"
import type { Role } from "../domain/roles.ts"
import type { Window } from "../domain/window.ts"

export interface StepSpan {
  readonly role: Role
  readonly startMono: MonoStamp
  readonly endMono: MonoStamp
}

export interface FinishedStep {
  readonly role: Role
  readonly increase: (window: Window) => Option.Option<number>
}

interface Stamped {
  readonly reading: Observation
  readonly micros: number
}

const stampedIn = (
  readings: ReadonlyArray<Observation>,
  provider: Client,
  window: Window,
  step: StepSpan,
): ReadonlyArray<Stamped> =>
  Arr.getSomes(
    Arr.map(readings, (reading) =>
    reading.provider === provider && reading.window === window
      ? Option.flatMap(reading.observedMono, (mono) =>
          mono.bootId === step.startMono.bootId &&
          mono.bootId === step.endMono.bootId
            ? Option.some({ reading, micros: mono.micros })
            : Option.none(),
        )
      : Option.none(),
    ),
  )

// Equal stamps are broken by ledger seq: the later-ingested reading wins
// on both sides.
const byMicros = Order.mapInput(Order.Number, (s: Stamped) => s.micros)
const bySeq = Order.mapInput(Order.Number, (s: Stamped) => s.reading.seq)
const latestBefore = Order.combine(byMicros, bySeq)
const earliestAfter = Order.combine(byMicros, Order.flip(bySeq))

const within =
  (from: number, to: number) =>
  (s: Stamped): boolean =>
    s.micros >= from && s.micros <= to

const pickBy =
  (pick: (xs: Arr.NonEmptyReadonlyArray<Stamped>) => Stamped) =>
  (xs: ReadonlyArray<Stamped>): Option.Option<Observation> =>
    Arr.isReadonlyArrayNonEmpty(xs) ? Option.some(pick(xs).reading) : Option.none()

const latest = pickBy((xs) => Arr.max(xs, latestBefore))
const earliest = pickBy((xs) => Arr.min(xs, earliestAfter))

export const measuredIncrease = (
  step: StepSpan,
  readings: ReadonlyArray<Observation>,
  provider: Client,
  window: Window,
  policy: Policy,
): Option.Option<number> =>
  Option.gen(function* () {
    const freshness = policy.freshnessMillis * 1000
    const start = step.startMono.micros
    const end = step.endMono.micros
    const stamped = stampedIn(readings, provider, window, step)
    const before = yield* latest(Arr.filter(stamped, within(start - freshness, start)))
    const after = yield* earliest(Arr.filter(stamped, within(end, end + freshness)))
    const resetBefore = yield* before.resetsAt
    const resetAfter = yield* after.resetsAt
    if (resetBefore !== resetAfter) return yield* Option.none()
    return Math.max(0, after.usedPercent - before.usedPercent)
  })

export const estimate =
  (finished: ReadonlyArray<FinishedStep>, role: Role, policy: Policy) =>
  (window: Window): number => {
    const lastFive = Arr.takeRight(
      Arr.filter(finished, (step) => step.role === role),
      5,
    )
    return Arr.match(
      Arr.getSomes(Arr.map(lastFive, (step) => step.increase(window))),
      {
        onEmpty: () => policy.initialEstimate,
        onNonEmpty: (increases) =>
          Math.max(policy.minEstimatePoints, Arr.max(increases, Order.Number)),
      },
    )
  }
