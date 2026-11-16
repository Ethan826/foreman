// C22 fixtures (design "Unattended launches"; admission contract,
// "Retirement and unattended cost"): at the defaults, with no retire,
// waiver or spend-down, the accounting ceilings of rule 1. Also the timer
// properties of C16: time passing never loosens a decision.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Option, Schema } from "effect"
import type { GrantPoints } from "../../src/domain/grant.ts"
import { type Window, Windows } from "../../src/domain/window.ts"
import { pace } from "../../src/features/pace.ts"
import {
  decisionName,
  grant,
  hour,
  inputFor,
  minute,
  reading,
  stamp,
  t0,
} from "./fixtures.ts"

const nowMono = stamp(10 * 60_000_000)
const fresh = stamp(10 * 60_000_000 - 60_000_000)

// One window under test; the other window is held at 0 so it never binds.
const decide = (
  window: Window,
  used: number,
  counting: ReadonlyArray<GrantPoints>,
  resetsAt = t0 + hour,
) => {
  const other = window === Windows.FiveHour ? Windows.Weekly : Windows.FiveHour
  return decisionName(pace(
    inputFor(
      [
        reading({ seq: 1, window, usedPercent: used, resetsAt, mono: fresh }),
        reading({ seq: 2, window: other, usedPercent: 0, resetsAt: t0 + 100 * hour, mono: fresh }),
      ],
      { nowMono: Option.some(nowMono), counting },
    ),
  ))
}

const grants = (n: number, window: Window) =>
  Arr.map(Arr.range(1, n), (i) => grant(i, window, 15))
const upTo = (n: number) => (n <= 0 ? [] : grants(n, Windows.FiveHour))

describe("unattended ceilings at the defaults (C22)", () => {
  it("five-hour, r = 0: grants 0 to 3 allow, 4 holds", () => {
    expect(
      Arr.map(Arr.range(0, 4), (n) => decide(Windows.FiveHour, 0, upTo(n))),
    ).toEqual(["Allow", "Allow", "Allow", "Allow", "Hold"])
  })

  // Sequential steps, real use equal to the estimate, no retire. Each
  // period's reading starts at 0 and rises by the real use of the steps
  // launched in it; every grant ever issued keeps counting.
  const night = (realUse: number): ReadonlyArray<number> => {
    const launchesPerPeriod: Array<number> = []
    let issued = 0
    for (let period = 0; period < 4; period++) {
      let used = 0
      let launched = 0
      while (decide(Windows.FiveHour, used, upTo(issued)) === "Allow") {
        issued += 1
        launched += 1
        used += realUse
      }
      launchesPerPeriod.push(launched)
    }
    return launchesPerPeriod
  }

  it("five-hour periods at real use = estimate: 2, 1, 1, then none", () => {
    expect(night(15)).toEqual([2, 1, 1, 0])
  })

  it("five-hour, real use at half the estimate: 3 launches in period 1", () => {
    expect(night(7.5)[0]).toBe(3)
  })

  it("weekly: 4 at 0, 3 at 15, 2 at 30, 1 at 45, none at 46", () => {
    const admitted = (used: number) =>
      Arr.length(
        Arr.takeWhile(Arr.range(0, 6), (n) =>
          decide(Windows.Weekly, used, grants(n, Windows.Weekly).slice(0, n), t0 + 100 * hour) ===
            "Allow",
        ),
      )
    expect(Arr.map([0, 15, 30, 45, 46], admitted)).toEqual([4, 3, 2, 1, 0])
  })
})

const Gen = Schema.Struct({
  used: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 80 })),
  n: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 })),
  ageMinutes: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20 })),
  advanceMinutes: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 400 })),
  resetInMinutes: Schema.Int.check(Schema.isBetween({ minimum: -10, maximum: 300 })),
})
type Gen = typeof Gen.Type

const decideAt = (g: Gen, wallShift: number, monoShift: number, withReset = true) =>
  decisionName(pace(
    inputFor(
      [
        reading({
          seq: 1,
          usedPercent: g.used,
          ...(withReset ? { resetsAt: t0 + g.resetInMinutes * minute } : {}),
          mono: stamp(100 * 60_000_000 - g.ageMinutes * 60_000_000),
        }),
        reading({ seq: 2, window: Windows.Weekly, usedPercent: 0, mono: stamp(100 * 60_000_000) }),
      ],
      {
        now: t0 + wallShift,
        nowMono: Option.some(stamp(100 * 60_000_000 + monoShift)),
        counting: upTo(g.n),
      },
    ),
  ))

describe("timers only tighten (C16)", () => {
  it.prop(
    "advancing the wall and monotonic clocks never turns Hold or Unknown into Allow",
    { g: Gen },
    ({ g }: { g: Gen }) => {
      const before = decideAt(g, 0, 0)
      const after = decideAt(g, g.advanceMinutes * minute, g.advanceMinutes * 60_000_000)
      return before === "Allow" || after !== "Allow"
    },
    { arbitrary: { runs: 500 } },
  )

  it.prop(
    "setting the wall clock back loosens only through now < resetsAt",
    { g: Gen },
    ({ g }: { g: Gen }) => {
      const before = decideAt(g, 0, 0)
      const after = decideAt(g, -g.advanceMinutes * minute, 0)
      const withoutReset = decideAt(g, 0, 0, false)
      return before !== "Unknown" || after !== "Allow" || withoutReset === "Allow"
    },
    { arbitrary: { runs: 500 } },
  )
})
