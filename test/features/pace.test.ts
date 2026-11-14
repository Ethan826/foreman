import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import type { Observation } from "../../src/domain/observation.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"
import type { Window } from "../../src/domain/window.ts"
import { Allow, Hold, pace, Unknown } from "../../src/features/pace.ts"

const now = 10_000_000
const minute = 60_000
const flat =
  (points: number): ((window: Window) => number) =>
  () =>
    points

const reading = (patch: Partial<Observation> = {}): Observation => ({
  provider: "claude",
  window: "fiveHour",
  usedPercent: 10,
  resetsAt: Option.some(now + 60 * minute),
  observedAt: now - minute,
  source: "claudeStatusline",
  ...patch,
})

const both = (fiveHour: number, weekly: number): Array<Observation> => [
  reading({ window: "fiveHour", usedPercent: fiveHour }),
  reading({ window: "weekly", usedPercent: weekly }),
]

const run = (observations: ReadonlyArray<Observation>, estimate = flat(15)) =>
  pace(observations, now, defaultPolicy, "claude", estimate)

describe("pace", () => {
  it("no observations: Unknown, naming every policy window", () => {
    expect(run([])).toEqual(new Unknown({ windows: ["fiveHour", "weekly"] }))
  })

  it("the window set comes from policy, not from the readings", () => {
    const onlyFiveHour = [reading({ usedPercent: 1 })]
    expect(run(onlyFiveHour)).toEqual(new Unknown({ windows: ["weekly"] }))
  })

  it("ignores readings of another provider", () => {
    const codex = both(1, 1).map((o) => ({ ...o, provider: "codex" as const }))
    expect(run(codex)).toEqual(new Unknown({ windows: ["fiveHour", "weekly"] }))
  })

  it("a provider with no policy windows is Unknown, never Allow", () => {
    const result = pace(both(1, 1), now, defaultPolicy, "codex", flat(0))
    expect(result).toEqual(new Unknown({ windows: [] }))
  })

  it("Allow when every window has room beyond reserve and estimate", () => {
    expect(run(both(10, 10))).toEqual(new Allow({}))
  })

  it("Allow at exactly the limit, Hold just over it", () => {
    // five-hour: 55 + 15 = 70 = 100 - 30; weekly: 45 + 15 = 60 = 100 - 40
    expect(run(both(55, 45))).toEqual(new Allow({}))
    expect(run(both(55.5, 45))).toEqual(new Hold({ windows: ["fiveHour"] }))
    expect(run(both(55, 45.5))).toEqual(new Hold({ windows: ["weekly"] }))
  })

  it("over reserve: Hold, even when the other window has no reading", () => {
    const result = run([reading({ usedPercent: 90 })])
    expect(result).toEqual(new Hold({ windows: ["fiveHour", "weekly"] }))
  })

  it("the estimate is per window", () => {
    const estimate = (window: Window) => (window === "weekly" ? 30 : 0)
    expect(run(both(70, 30), estimate)).toEqual(new Allow({}))
    expect(run(both(70, 30.5), estimate)).toEqual(
      new Hold({ windows: ["weekly"] }),
    )
  })

  it("stale reading: Unknown, usable up to exactly the freshness bound", () => {
    const fresh = defaultPolicy.freshnessMillis
    const at = (age: number) =>
      both(1, 1).map((o) => ({ ...o, observedAt: now - age }))
    expect(run(at(fresh))).toEqual(new Allow({}))
    expect(run(at(fresh + 1))).toEqual(
      new Unknown({ windows: ["fiveHour", "weekly"] }),
    )
  })

  it("a reading stamped in the future is unusable; one at now is usable", () => {
    // Owner ruling 2026-11-14: clock skew must not make a stale reading
    // look fresh.
    const at = (observedAt: number) =>
      both(1, 1).map((o) => ({ ...o, observedAt }))
    expect(run(at(now))).toEqual(new Allow({}))
    expect(run(at(now + 1))).toEqual(
      new Unknown({ windows: ["fiveHour", "weekly"] }),
    )
  })

  it("a stale reading over reserve is Unknown, not Hold", () => {
    const old = both(99, 99).map((o) => ({ ...o, observedAt: now - 60 * minute }))
    expect(run(old)).toEqual(new Unknown({ windows: ["fiveHour", "weekly"] }))
  })

  it("reading past its resetsAt: Unknown; at resetsAt it is also unusable", () => {
    const withReset = (resetsAt: number) =>
      both(1, 1).map((o) => ({ ...o, resetsAt: Option.some(resetsAt) }))
    expect(run(withReset(now + 1))).toEqual(new Allow({}))
    expect(run(withReset(now))).toEqual(
      new Unknown({ windows: ["fiveHour", "weekly"] }),
    )
    expect(run(withReset(now - 1))).toEqual(
      new Unknown({ windows: ["fiveHour", "weekly"] }),
    )
  })

  it("absent resetsAt: freshness alone limits the reading", () => {
    const bare = reading({ usedPercent: 1, resetsAt: Option.none() })
    const weekly = { ...bare, window: "weekly" as const }
    expect(run([bare, weekly])).toEqual(new Allow({}))
  })

  it("latest observedAt wins, in either arrival order", () => {
    const older = reading({ usedPercent: 5, observedAt: now - 5 * minute })
    const newer = reading({ usedPercent: 95, observedAt: now - minute })
    const weekly = reading({ window: "weekly", usedPercent: 1 })
    expect(run([older, newer, weekly])).toEqual(
      new Hold({ windows: ["fiveHour"] }),
    )
    expect(run([newer, older, weekly])).toEqual(
      new Hold({ windows: ["fiveHour"] }),
    )
    const recovered = reading({ usedPercent: 5, observedAt: now - minute })
    const earlierHigh = reading({ usedPercent: 95, observedAt: now - 5 * minute })
    expect(run([recovered, earlierHigh, weekly])).toEqual(new Allow({}))
    expect(run([earlierHigh, recovered, weekly])).toEqual(new Allow({}))
  })

  it("equal observedAt: the highest usedPercent wins", () => {
    const low = reading({ usedPercent: 5 })
    const high = reading({ usedPercent: 95 })
    const weekly = reading({ window: "weekly", usedPercent: 1 })
    expect(run([low, high, weekly])).toEqual(new Hold({ windows: ["fiveHour"] }))
    expect(run([high, low, weekly])).toEqual(new Hold({ windows: ["fiveHour"] }))
  })

  it("the newest reading decides even when it is unusable", () => {
    const usableOlder = reading({ usedPercent: 1, observedAt: now - 2 * minute })
    const expiredNewer = reading({
      usedPercent: 1,
      observedAt: now - minute,
      resetsAt: Option.some(now - 1),
    })
    const weekly = reading({ window: "weekly", usedPercent: 1 })
    expect(run([usableOlder, expiredNewer, weekly])).toEqual(
      new Unknown({ windows: ["fiveHour"] }),
    )
  })

  it("is total over a grid of times and percentages", () => {
    const percents = [0, 25, 55, 100]
    const times = [-minute, 0, minute, 11 * minute]
    const results = percents.flatMap((used) =>
      times.map((age) =>
        run(both(used, used).map((o) => ({ ...o, observedAt: now - age }))),
      ),
    )
    expect(results).toHaveLength(16)
  })
})
