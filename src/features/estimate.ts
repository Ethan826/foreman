// Estimate per role and window (design "Pacing", `estimate(window)`, R-P3;
// "Measurement").
//
// A measured increase is an observation of the provider's count across the
// step, not authoritative per-step usage: readings are whole points,
// reported with a delay, and include anything else that used the account
// during the step. A running agent can still use more than its estimate;
// nothing here bounds real use.
import { Array as Arr, Option, Order } from "effect"
import { microsPerMilli, type MonoStamp } from "../domain/clock.ts"
import type { Client } from "../domain/clients.ts"
import type { Observation } from "../domain/observation.ts"
import type { Policy } from "../domain/policy.ts"
import type { Role } from "../domain/roles.ts"
import type { Window } from "../domain/window.ts"

/** A step's role and its monotonic start and end stamps. */
export interface StepSpan {
  readonly role: Role
  readonly startMono: MonoStamp
  readonly endMono: MonoStamp
}

/**
 * A finished step as the estimate sees it: its role and its measured
 * increase per window, in points. `Option.none()` means the step was not
 * measured in that window.
 */
export interface FinishedStep {
  readonly role: Role
  /** The step's measured increase in points for a window, or none when the step is unmeasured there. */
  readonly increase: (window: Window) => Option.Option<number>
}

interface Stamped {
  readonly reading: Observation
  readonly micros: number
}

/**
 * The readings of `provider` and `window` that have a monotonic stamp
 * from the step's boot, paired with their stamp in microseconds. If the
 * step's start and end stamps come from different boots, no reading
 * qualifies.
 */
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

/** True when the stamp lies in `[from, to]` microseconds, both ends inclusive. */
const within =
  (from: number, to: number) =>
  (s: Stamped): boolean =>
    s.micros >= from && s.micros <= to

/** The reading `pick` chooses from a non-empty list; `Option.none()` for an empty one. */
const pickBy =
  (pick: (xs: Arr.NonEmptyReadonlyArray<Stamped>) => Stamped) =>
  (xs: ReadonlyArray<Stamped>): Option.Option<Observation> =>
    Arr.isReadonlyArrayNonEmpty(xs) ? Option.some(pick(xs).reading) : Option.none()

const latest = pickBy((xs) => Arr.max(xs, latestBefore))
const earliest = pickBy((xs) => Arr.min(xs, earliestAfter))

/**
 * The increase in `usedPercent`, in points, of one provider window across
 * a step, or `Option.none()` when the step is not measured in that window.
 *
 * The reading before is the latest one at or before the step's start; the
 * reading after is the earliest one at or after its end. "Before" and
 * "after" compare monotonic stamps from the step's boot, never the wall
 * clock; ties are broken by ledger seq, the later-ingested reading winning.
 *
 * Both readings must be usable, read strictly (owner ruling 2026-11-16):
 * the reading before at most `freshnessMillis` older than the start, the
 * reading after at most `freshnessMillis` newer than the end, both bounds
 * inclusive. Fewer steps are measured, so more fall back to
 * `initialEstimate`. Both readings must also have a reset time, and the
 * two must be equal (no reset in between).
 *
 * A fall in usage gives 0. A measured 0 stays 0 here; only the estimate
 * is floored.
 */
export const measuredIncrease = (
  step: StepSpan,
  readings: ReadonlyArray<Observation>,
  provider: Client,
  window: Window,
  policy: Policy,
): Option.Option<number> =>
  Option.gen(function* () {
    const freshness = policy.freshnessMillis * microsPerMilli
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

/** How many of a role's latest finished steps the estimate looks at (R-P3). */
const recentSteps = 5

/**
 * The estimate in points for the next step of `role` in a window (R-P3).
 *
 * It looks at the role's last five finished steps (the last five of
 * `finished` with that role, so `finished` must be in finishing order).
 * If any of them was measured in the window, the estimate is the largest
 * measured increase; otherwise it is `initialEstimate`. Either way it is
 * raised to `minEstimatePoints` if lower, because the one-point minimum
 * applies to admission and reservations alike (O15).
 */
export const estimate =
  (finished: ReadonlyArray<FinishedStep>, role: Role, policy: Policy) =>
  (window: Window): number => {
    const lastFive = Arr.takeRight(
      Arr.filter(finished, (step) => step.role === role),
      recentSteps,
    )
    const unfloored = Arr.match(
      Arr.getSomes(Arr.map(lastFive, (step) => step.increase(window))),
      {
        onEmpty: () => policy.initialEstimate,
        onNonEmpty: (increases) => Arr.max(increases, Order.Number),
      },
    )
    return Math.max(policy.minEstimatePoints, unfloored)
  }
