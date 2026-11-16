import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Option } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import type { Observation } from "../../src/domain/observation.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"
import { type Role, Roles } from "../../src/domain/roles.ts"
import { type Window, Windows } from "../../src/domain/window.ts"
import {
  estimate,
  measuredIncrease,
  type StepSpan,
} from "../../src/features/estimate.ts"
import { bootB, hour, reading, stamp, t0 } from "./fixtures.ts"

const min = 60_000_000 // one minute in microseconds
// The step runs from minute 30 to minute 40; freshness is 10 minutes.
const step: StepSpan = {
  role: Roles.Implementer,
  startMono: stamp(30 * min),
  endMono: stamp(40 * min),
}
const at = (
  seq: number,
  minute: number,
  usedPercent: number,
  patch: Partial<Observation> = {},
): Observation => ({
  ...reading({ seq, usedPercent, resetsAt: t0 + hour, mono: stamp(minute * min) }),
  ...patch,
})
const measure = (readings: ReadonlyArray<Observation>, window: Window = Windows.FiveHour) =>
  measuredIncrease(step, readings, Clients.Claude, window, defaultPolicy)

describe("measuredIncrease", () => {
  it("measures across a bracket in one period and boot", () => {
    expect(measure([at(1, 29, 10), at(2, 41, 18)])).toEqual(Option.some(8))
  })

  it("keeps an observed zero increase as 0", () => {
    expect(measure([at(1, 29, 10), at(2, 41, 10)])).toEqual(Option.some(0))
  })

  it("takes the latest reading before the start and the earliest after the end", () => {
    const readings = [at(1, 21, 2), at(2, 29, 10), at(3, 41, 18), at(4, 49, 30)]
    expect(measure(readings)).toEqual(Option.some(8))
  })

  it("breaks equal stamps by ledger seq, later-ingested first", () => {
    expect(measure([at(1, 29, 10), at(2, 29, 12), at(3, 41, 18), at(4, 41, 20)])).toEqual(
      Option.some(8),
    )
  })

  it("is unmeasured when either bracketing reading is older or newer than freshness", () => {
    expect(measure([at(1, 19, 10), at(2, 41, 18)])).toEqual(Option.none())
    expect(measure([at(1, 29, 10), at(2, 51, 18)])).toEqual(Option.none())
  })

  it("is unmeasured across a reset or a boot change", () => {
    expect(measure([at(1, 29, 10), at(2, 41, 18, { resetsAt: Option.some(t0 + 6 * hour) })])).toEqual(
      Option.none(),
    )
    expect(
      measure([at(1, 29, 10), at(2, 41, 18, { observedMono: Option.some(stamp(41 * min, bootB)) })]),
    ).toEqual(Option.none())
  })

  it("uses only the asked provider's readings of the asked window", () => {
    const codex = at(3, 41, 90, { provider: Clients.Codex })
    const weekly = at(4, 41, 70, { window: Windows.Weekly })
    expect(measure([at(1, 29, 10), codex, weekly])).toEqual(Option.none())
    expect(measure([at(1, 29, 10), codex, weekly, at(5, 42, 12)])).toEqual(Option.some(2))
    expect(measure([at(1, 29, 10), codex, weekly], Windows.Weekly)).toEqual(Option.none())
  })
})

const finishedStep = (role: Role, points: number | undefined) => ({
  role,
  increase: () => Option.fromNullishOr(points),
})

describe("estimate", () => {
  it("falls back to the initial estimate when a stale bracket leaves the step unmeasured", () => {
    const stale = [at(1, 19, 10), at(2, 41, 40)]
    const finished = [
      {
        role: Roles.Implementer,
        increase: (window: Window) =>
          measuredIncrease(step, stale, Clients.Claude, window, defaultPolicy),
      },
    ]
    expect(estimate(finished, Roles.Implementer, defaultPolicy)(Windows.FiveHour)).toBe(15)
  })

  it("is the initial estimate when no step is measured", () => {
    expect(estimate([], Roles.Implementer, defaultPolicy)(Windows.FiveHour)).toBe(15)
  })

  it("is the largest measured increase among the role's last five steps", () => {
    const finished = [
      finishedStep(Roles.Implementer, 40), // sixth-oldest: ignored
      finishedStep(Roles.Implementer, 3),
      finishedStep(Roles.Reviewer, 30), // another role: ignored
      finishedStep(Roles.Implementer, 9),
      finishedStep(Roles.Implementer, undefined),
      finishedStep(Roles.Implementer, 4),
      finishedStep(Roles.Implementer, 2),
    ]
    expect(estimate(finished, Roles.Implementer, defaultPolicy)(Windows.FiveHour)).toBe(9)
  })

  it("never goes below the one-point floor (O15)", () => {
    const zeros = Arr.map(Arr.range(1, 3), () => finishedStep(Roles.Corrector, 0))
    expect(estimate(zeros, Roles.Corrector, defaultPolicy)(Windows.FiveHour)).toBe(1)
  })
})
