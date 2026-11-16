// Period membership for one provider window (design "Periods" and the
// definitions table under "Pacing"). Readings are folded in ledger seq
// order; nothing here reads a clock.
//
// Rules:
// 1. The first reading opens period 1 with itself as the highest reading.
// 2. A reading whose reset time is later than the period's by more than
//    resetTolerance opens the next period, with itself as the highest.
// 3. A reading whose reset time is earlier than the period's by more than
//    resetTolerance belongs to an earlier period: it is listed in
//    `earlier` and changes nothing else.
// 4. Any other reading joins and can only raise the highest reading. A
//    usage drop opens nothing: a join lower than the highest by more than
//    dropTolerance is listed in `drops` for display.
// 5. A join with a reset time into a period that has none records that
//    reset time and opens nothing (implementation plan, Review Focus 1:
//    the design leaves this case open; joining is the cautious choice).
// 6. `freshest` is the joining reading's monotonic stamp with the greatest
//    micros in the boot of the latest stamped reading. A reading without a
//    stamp never sets it, and a stamp from a newer boot replaces it.
//
// A new period lowers the reading term of the level; it frees no
// accounting room (grants still count until canceled or retired).
import { Array as Arr, Option } from "effect"
import type { MonoStamp } from "../domain/clock.ts"
import { type LedgerSeq, PeriodSeq } from "../domain/ids.ts"
import type { Observation } from "../domain/observation.ts"
import type { Policy } from "../domain/policy.ts"

export interface WindowPeriod {
  readonly periodSeq: PeriodSeq
  readonly resetsAt: Option.Option<number>
  readonly highest: number
  readonly freshest: Option.Option<MonoStamp>
  readonly drops: ReadonlyArray<LedgerSeq>
  readonly earlier: ReadonlyArray<LedgerSeq>
}

const opened = (periodSeq: PeriodSeq, reading: Observation): WindowPeriod => ({
  periodSeq,
  resetsAt: reading.resetsAt,
  highest: reading.usedPercent,
  freshest: reading.observedMono,
  drops: [],
  earlier: [],
})

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

export const currentPeriod = (
  readings: ReadonlyArray<Observation>,
  policy: Policy,
): Option.Option<WindowPeriod> =>
  Arr.reduce(readings, Option.none<WindowPeriod>(), (current, reading) =>
    Option.some(ingestReading(current, reading, policy)),
  )
