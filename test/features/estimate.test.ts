import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Option } from "effect"
import { type Role, Roles } from "../../src/domain/roles.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"
import { type Window, Windows } from "../../src/domain/window.ts"
import {
  estimate,
  measuredIncrease,
  type StepSpan,
} from "../../src/features/estimate.ts"
import { bootB, hour, reading, stamp, t0 } from "./fixtures.ts"

const min = 60_000_000 // one minute in microseconds
const span = (startMin: number, endMin: number, role: Role = Roles.Implementer): StepSpan => ({
  role,
  startMono: stamp(startMin * min),
  endMono: stamp(endMin * min),
})

const bracket = (
  before: number,
  after: number,
  patch: { resetAfter?: number; bootAfter?: boolean; beforeAt?: number; afterAt?: number } = {},
) => [
  reading({ seq: 1, usedPercent: before, resetsAt: t0 + hour, mono: stamp((patch.beforeAt ?? 9) * min) }),
  reading({
    seq: 2,
    usedPercent: after,
    resetsAt: patch.resetAfter ?? t0 + hour,
    mono: stamp((patch.afterAt ?? 21) * min, patch.bootAfter === true ? bootB : undefined),
  }),
]

const measure = (readings: ReturnType<typeof bracket>) =>
  measuredIncrease(span(10, 20), readings, Windows.FiveHour, defaultPolicy)

describe("measuredIncrease", () => {
  it("measures the increase across a bracket in one period and boot", () => {
    expect(measure(bracket(10, 18))).toEqual(Option.some(8))
  })

  it("is unmeasured across a reset", () => {
    expect(measure(bracket(10, 18, { resetAfter: t0 + 6 * hour }))).toEqual(Option.none())
  })

  it("is unmeasured when a bracketing reading is from another boot", () => {
    expect(measure(bracket(10, 18, { bootAfter: true }))).toEqual(Option.none())
  })

  it("is unmeasured when the reading before is older than freshness", () => {
    expect(measure(bracket(10, 18, { beforeAt: -1 }))).toEqual(Option.none())
  })

  it("is unmeasured without a reading after the end", () => {
    expect(measure(bracket(10, 18, { afterAt: 19 }))).toEqual(Option.none())
  })
})

const step = (role: Role, points: number | undefined) => ({
  role,
  increase: () => Option.fromNullishOr(points),
})

describe("estimate", () => {
  it("falls back to the initial estimate when a stale bracket leaves a step unmeasured", () => {
    const readings = bracket(10, 40, { beforeAt: -1 })
    const finished = [
      {
        role: Roles.Implementer,
        increase: (window: Window) =>
          measuredIncrease(span(10, 20), readings, window, defaultPolicy),
      },
    ]
    expect(measuredIncrease(span(10, 20), readings, Windows.FiveHour, defaultPolicy)).toEqual(
      Option.none(),
    )
    expect(estimate(finished, Roles.Implementer, defaultPolicy)(Windows.FiveHour)).toBe(15)
  })

  it("is the initial estimate when no step is measured", () => {
    expect(estimate([], Roles.Implementer, defaultPolicy)(Windows.FiveHour)).toBe(15)
    expect(
      estimate([step(Roles.Implementer, undefined)], Roles.Implementer, defaultPolicy)(
        Windows.Weekly,
      ),
    ).toBe(15)
  })

  it("is the largest measured increase among the role's last five steps", () => {
    const finished = [
      step(Roles.Implementer, 40), // sixth-oldest: ignored
      step(Roles.Implementer, 3),
      step(Roles.Reviewer, 30), // another role: ignored
      step(Roles.Implementer, 9),
      step(Roles.Implementer, undefined),
      step(Roles.Implementer, 4),
      step(Roles.Implementer, 2),
    ]
    expect(estimate(finished, Roles.Implementer, defaultPolicy)(Windows.FiveHour)).toBe(9)
  })

  it("counts only the last five of the role", () => {
    const finished = Arr.map(Arr.range(1, 6), (i) => step(Roles.Corrector, i === 1 ? 50 : 1))
    expect(estimate(finished, Roles.Corrector, defaultPolicy)(Windows.FiveHour)).toBe(1)
  })
})
