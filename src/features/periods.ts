// Period membership for one provider window (design "Periods" and the
// definitions table under "Pacing"). Readings are folded in ledger seq
// order; nothing here reads a clock.
//
// A new period lowers the reading term of the level; it frees no
// accounting room and retires no reservation (grants still count until
// canceled or retired).
//
// Owner ruling 2026-11-16 (O14): this tolerance rule is a pacing
// heuristic. If a provider's reset time rolls forward while a window is
// idle, a move beyond resetTolerance opens a period, and a lower opening
// reading then lowers the reading term (a downward adjustment by at most
// the old highest minus the new reading). It does not establish a
// provider's actual reset semantics.
import { Array as Arr, Option } from "effect"
import type { MonoStamp } from "../domain/clock.ts"
import { type LedgerSeq, PeriodSeq } from "../domain/ids.ts"
import type { Client } from "../domain/clients.ts"
import type { Observation } from "../domain/observation.ts"
import type { Policy } from "../domain/policy.ts"
import type { Window } from "../domain/window.ts"

/**
 * The current period of one provider window, as folded from its readings.
 *
 * - `periodSeq`: the period's number, from 1.
 * - `resetsAt`: the period's reset time in epoch milliseconds;
 *   `Option.none()` until some member reading carries one.
 * - `highest`: the highest `usedPercent` among the period's readings.
 * - `freshest`: the greatest monotonic stamp among the period's readings
 *   in the boot of the latest stamped one; `Option.none()` when no member
 *   reading has a stamp.
 * - `drops`: seqs of readings that joined lower than `highest` by more
 *   than `dropTolerancePoints`, for display only.
 * - `earlier`: seqs of readings that belong to an earlier period and were
 *   otherwise ignored.
 */
export interface WindowPeriod {
  readonly periodSeq: PeriodSeq
  readonly resetsAt: Option.Option<number>
  readonly highest: number
  readonly freshest: Option.Option<MonoStamp>
  readonly drops: ReadonlyArray<LedgerSeq>
  readonly earlier: ReadonlyArray<LedgerSeq>
}

/** A new period numbered `periodSeq`, with `reading` as its only member and highest reading. */
const opened = (periodSeq: PeriodSeq, reading: Observation): WindowPeriod => ({
  periodSeq,
  resetsAt: reading.resetsAt,
  highest: reading.usedPercent,
  freshest: reading.observedMono,
  drops: [],
  earlier: [],
})

/**
 * The freshest stamp after a reading joins. A reading without a stamp
 * leaves it unchanged. A stamp from a different boot replaces it, on the
 * assumption that a reading later in seq order comes from a newer boot;
 * within a boot the greater micros wins.
 */
const fresher = (
  current: Option.Option<MonoStamp>,
  stamp: Option.Option<MonoStamp>,
): Option.Option<MonoStamp> =>
  Option.match(stamp, {
    onNone: () => current,
    onSome: (next) =>
      Option.match(current, {
        onNone: () => stamp,
        onSome: (held) =>
          held.bootId !== next.bootId || next.micros > held.micros
            ? stamp
            : current,
      }),
  })

type Relation = "later" | "earlier" | "same"

/**
 * How a reading's reset time relates to the period's: "later" or
 * "earlier" when they differ by more than `tolerance` milliseconds,
 * otherwise "same". When either reset time is absent the answer is
 * "same", so the reading joins.
 */
const relation = (
  period: WindowPeriod,
  reading: Observation,
  tolerance: number,
): Relation =>
  Option.match(Option.zipWith(period.resetsAt, reading.resetsAt, (p, r) => r - p), {
    onNone: () => "same",
    onSome: (delta) =>
      delta > tolerance ? "later" : delta < -tolerance ? "earlier" : "same",
  })

/**
 * The period after `reading` joins it. The highest reading can only rise.
 * A period without a reset time takes the reading's (implementation plan,
 * Review Focus 1: the design leaves this case open; joining is the
 * cautious choice). A reading lower than the highest by more than
 * `dropTolerancePoints` is listed in `drops`; a usage drop opens nothing.
 */
const joined = (
  period: WindowPeriod,
  reading: Observation,
  policy: Policy,
): WindowPeriod => ({
  ...period,
  resetsAt: Option.orElse(period.resetsAt, () => reading.resetsAt),
  highest: Math.max(period.highest, reading.usedPercent),
  freshest: fresher(period.freshest, reading.observedMono),
  drops:
    period.highest - reading.usedPercent > policy.dropTolerancePoints
      ? Arr.append(period.drops, reading.seq)
      : period.drops,
})

/**
 * Folds one reading into the current period of its window (design
 * "Periods"):
 *
 * 1. With no period yet, the reading opens period 1.
 * 2. A reading whose reset time is later than the period's by more than
 *    `resetToleranceMillis` opens the next period, with itself as the
 *    highest.
 * 3. A reading whose reset time is earlier by more than that belongs to an
 *    earlier period: it is listed in `earlier` and changes nothing else.
 * 4. Any other reading joins (see `joined`), including one without a
 *    reset time or one into a period that has none.
 */
export const ingestReading = (
  current: Option.Option<WindowPeriod>,
  reading: Observation,
  policy: Policy,
): WindowPeriod =>
  Option.match(current, {
    onNone: () => opened(PeriodSeq.make(1), reading),
    onSome: (period) => {
      switch (relation(period, reading, policy.resetToleranceMillis)) {
        case "later":
          return opened(PeriodSeq.make(period.periodSeq + 1), reading)
        case "earlier":
          return { ...period, earlier: Arr.append(period.earlier, reading.seq) }
        case "same":
          return joined(period, reading, policy)
      }
    },
  })

/**
 * The current period of `provider`'s `window`, or `Option.none()` when
 * there is no reading of it. Window names are shared across providers, so
 * the fold keeps only the readings of the named provider and window; a
 * Codex reading never touches a Claude period. It folds `readings` in the
 * order given and does not sort them; the caller passes them in ledger
 * seq order.
 */
export const currentPeriod = (
  readings: ReadonlyArray<Observation>,
  provider: Client,
  window: Window,
  policy: Policy,
): Option.Option<WindowPeriod> =>
  Arr.reduce(
    Arr.filter(
      readings,
      (reading) => reading.provider === provider && reading.window === window,
    ),
    Option.none<WindowPeriod>(),
    (current, reading) => Option.some(ingestReading(current, reading, policy)),
  )
