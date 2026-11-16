import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Option, Schema } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { BootId } from "../../src/domain/clock.ts"
import { LedgerSeq } from "../../src/domain/ids.ts"
import type { Observation } from "../../src/domain/observation.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"
import { Windows } from "../../src/domain/window.ts"
import {
  currentPeriod,
  type WindowPeriod,
} from "../../src/features/periods.ts"

const hour = 3_600_000
const tolerance = defaultPolicy.resetToleranceMillis
const boot = BootId.make("boot-a")

const reading = (
  seq: number,
  usedPercent: number,
  resetsAt: Option.Option<number>,
  micros: Option.Option<number> = Option.some(seq * 1_000),
): Observation => ({
  provider: Clients.Claude,
  window: Windows.FiveHour,
  usedPercent,
  resetsAt,
  observedAt: seq,
  observedMono: Option.map(micros, (m) => ({ bootId: boot, micros: m })),
  seq: LedgerSeq.make(seq),
  source: "claudeRateLimitEvent",
})

const fold = (readings: ReadonlyArray<Observation>): Option.Option<WindowPeriod> =>
  currentPeriod(readings, defaultPolicy)

const t0 = 10 * hour

describe("currentPeriod examples", () => {
  it("has no period without readings", () => {
    expect(Option.isNone(fold([]))).toBe(true)
  })

  it("keeps the highest and lists a drop", () => {
    const period = fold([
      reading(1, 30, Option.some(t0)),
      reading(2, 10, Option.some(t0)),
    ])
    expect(Option.map(period, (p) => [p.periodSeq, p.highest, p.drops])).toEqual(
      Option.some([1, 30, [2]]),
    )
  })

  it("opens the next period only on a later reset time beyond tolerance", () => {
    const within = fold([
      reading(1, 40, Option.some(t0)),
      reading(2, 5, Option.some(t0 + tolerance)),
    ])
    expect(Option.map(within, (p) => [p.periodSeq, p.highest])).toEqual(
      Option.some([1, 40]),
    )
    const beyond = fold([
      reading(1, 40, Option.some(t0)),
      reading(2, 5, Option.some(t0 + tolerance + 1)),
    ])
    expect(Option.map(beyond, (p) => [p.periodSeq, p.highest])).toEqual(
      Option.some([2, 5]),
    )
  })

  it("sets an earlier period's reading aside", () => {
    const period = fold([
      reading(1, 5, Option.some(t0 + 5 * hour)),
      reading(2, 80, Option.some(t0), Option.some(999_999)),
    ])
    expect(
      Option.map(period, (p) => [p.highest, p.earlier, p.freshest]),
    ).toEqual(
      Option.some([5, [2], Option.some({ bootId: boot, micros: 1_000 })]),
    )
  })

  it("records a reset time in a period that had none, opening nothing", () => {
    const period = fold([
      reading(1, 20, Option.none()),
      reading(2, 25, Option.some(t0)),
    ])
    expect(
      Option.map(period, (p) => [p.periodSeq, p.highest, p.resetsAt]),
    ).toEqual(Option.some([1, 25, Option.some(t0)]))
  })

  it("never lets a reading without a stamp set freshness", () => {
    const period = fold([reading(1, 20, Option.some(t0), Option.none())])
    expect(Option.map(period, (p) => Option.isNone(p.freshest))).toEqual(
      Option.some(true),
    )
  })
})

// Generated readings in seq order: each is a used percent, a reset time
// chosen from a few hours around t0 (or none), and an optional stamp.
const Generated = Schema.Array(
  Schema.Struct({
    usedPercent: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
    resetHour: Schema.Int.check(Schema.isBetween({ minimum: -1, maximum: 3 })),
    micros: Schema.Int.check(Schema.isBetween({ minimum: -1, maximum: 50 })),
  }),
)
type Generated = typeof Generated.Type

const build = (generated: Generated): ReadonlyArray<Observation> =>
  Arr.map(generated, (g, i) =>
    reading(
      i + 1,
      g.usedPercent,
      g.resetHour < 0 ? Option.none() : Option.some(t0 + g.resetHour * hour),
      g.micros < 0 ? Option.none() : Option.some(g.micros),
    ),
  )

// Every prefix's period, in order.
const prefixes = (readings: ReadonlyArray<Observation>) =>
  Arr.map(readings, (_, i) => fold(Arr.take(readings, i + 1)))

const runs = { arbitrary: { runs: 500 } }

describe("currentPeriod properties (C16)", () => {
  it.prop(
    "highest never decreases within one periodSeq",
    { generated: Generated },
    ({ generated }) => {
      const steps = Arr.getSomes(prefixes(build(generated)))
      return Arr.every(Arr.zip(steps, Arr.drop(steps, 1)), ([a, b]) =>
        a.periodSeq !== b.periodSeq || b.highest >= a.highest,
      )
    },
    runs,
  )

  it.prop(
    "periodSeq rises only on a later reset time beyond tolerance",
    { generated: Generated },
    ({ generated }) => {
      const readings = build(generated)
      const steps = prefixes(readings)
      return Arr.every(Arr.range(1, Arr.length(readings) - 1), (i) => {
        const before = steps[i - 1]
        const after = steps[i]
        const next = readings[i]
        if (before === undefined || after === undefined || next === undefined)
          return Arr.length(readings) <= 1
        return Option.match(Option.zipWith(before, after, (a, b) => [a, b] as const), {
          onNone: () => false,
          onSome: ([a, b]) =>
            b.periodSeq === a.periodSeq ||
            (b.periodSeq === a.periodSeq + 1 &&
              Option.isSome(a.resetsAt) &&
              Option.isSome(next.resetsAt) &&
              next.resetsAt.value > a.resetsAt.value + tolerance),
        })
      })
    },
    runs,
  )

  it.prop(
    "a reading set aside as earlier changes nothing else",
    { generated: Generated },
    ({ generated }) => {
      const steps = Arr.getSomes(prefixes(build(generated)))
      return Arr.every(Arr.zip(steps, Arr.drop(steps, 1)), ([a, b]) =>
        Arr.length(b.earlier) <= Arr.length(a.earlier) ||
        (b.periodSeq === a.periodSeq &&
          b.highest === a.highest &&
          Option.makeEquivalence(
            (x: { micros: number }, y: { micros: number }) => x.micros === y.micros,
          )(a.freshest, b.freshest)),
      )
    },
    runs,
  )
})
