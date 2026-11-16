import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"
import { Windows } from "../../src/domain/window.ts"
import {
  Allow,
  defaultCap,
  Hold,
  level,
  pace,
  Unknown,
} from "../../src/features/pace.ts"
import {
  bootB,
  grant,
  hour,
  inputFor,
  reading,
  stamp,
  t0,
} from "./fixtures.ts"

const fresh = stamp(1_000_000 - 60_000_000) // one minute before nowMono
const both = (fiveHour: number, weekly: number, mono = fresh) => [
  reading({ seq: 1, usedPercent: fiveHour, resetsAt: t0 + hour, mono }),
  reading({
    seq: 2,
    window: Windows.Weekly,
    usedPercent: weekly,
    resetsAt: t0 + 48 * hour,
    mono,
  }),
]

describe("pace, revision 6.1", () => {
  it("allows when every window's level plus estimate is within its cap", () => {
    expect(pace(inputFor(both(10, 10)))).toEqual(new Allow({}))
  })

  it("holds on the window whose level fails", () => {
    expect(pace(inputFor(both(10, 50)))).toEqual(
      new Hold({ windows: [Windows.Weekly] }),
    )
  })

  it("counts every counting grant of the provider in the level", () => {
    const counting = [
      grant(1, Windows.FiveHour, 15),
      grant(2, Windows.FiveHour, 15),
      grant(3, Windows.FiveHour, 15),
      grant(4, Windows.FiveHour, 15, Clients.Codex),
    ]
    // 10 + 45 + 15 = 70 <= 70; the Codex grant is not Claude's.
    expect(pace(inputFor(both(10, 0), { counting }))).toEqual(new Allow({}))
    expect(
      pace(inputFor(both(11, 0), { counting })),
    ).toEqual(new Hold({ windows: [Windows.FiveHour] }))
  })

  it("is Unknown for every window without a monotonic clock (O11)", () => {
    expect(pace(inputFor(both(0, 0), { nowMono: Option.none() }))).toEqual(
      new Unknown({ windows: [Windows.FiveHour, Windows.Weekly] }),
    )
  })

  it("never treats another boot's stamp as fresh", () => {
    expect(pace(inputFor(both(0, 0, stamp(999_000, bootB))))).toEqual(
      new Unknown({ windows: [Windows.FiveHour, Windows.Weekly] }),
    )
  })

  it("lets a stale reading still raise the period's highest", () => {
    const readings = [
      reading({ seq: 1, usedPercent: 60, resetsAt: t0 + hour, mono: stamp(1) }),
      reading({ seq: 2, usedPercent: 10, resetsAt: t0 + hour, mono: fresh }),
      reading({
        seq: 3,
        window: Windows.Weekly,
        usedPercent: 0,
        resetsAt: t0 + 48 * hour,
        mono: fresh,
      }),
    ]
    expect(pace(inputFor(readings))).toEqual(
      new Hold({ windows: [Windows.FiveHour] }),
    )
  })

  it("makes a window unusable once its reset time has passed", () => {
    expect(pace(inputFor(both(0, 0), { now: t0 + hour }))).toEqual(
      new Unknown({ windows: [Windows.FiveHour] }),
    )
  })

  it("is Unknown for a provider with no policy windows", () => {
    expect(pace(inputFor(both(0, 0), { provider: Clients.Codex }))).toEqual(
      new Unknown({ windows: [] }),
    )
  })

  it("defaults the cap to 100 minus the reserve", () => {
    const cap = defaultCap(defaultPolicy, Clients.Claude)
    expect([cap(Windows.FiveHour), cap(Windows.Weekly)]).toEqual([70, 60])
  })

  it("levels a period as its highest plus the window's grant points", () => {
    const counted = Option.map(inputFor(both(20, 0)).periods(Windows.FiveHour), (p) =>
      level(p, [grant(1, Windows.FiveHour, 5), grant(2, Windows.Weekly, 7)], Windows.FiveHour),
    )
    expect(counted).toEqual(Option.some(25))
  })
})
