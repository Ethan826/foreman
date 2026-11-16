// C13 oracle: an independent statement of revision 6.1's rule 1, compared
// with `pace` on generated inputs, including the window lists of Hold and
// Unknown. It does not import periods.ts and does not replay its fold:
// the current period is found by search over the reading list (openers,
// then members by filter, then the freshest stamp from the last boot
// change), and readings of every provider are generated.
import { describe, it } from "@effect/vitest"
import { Array as Arr, Option, Schema } from "effect"
import { type Client, Clients } from "../../src/domain/clients.ts"
import type { GrantPoints } from "../../src/domain/grant.ts"
import type { Observation } from "../../src/domain/observation.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"
import { type Window, Windows } from "../../src/domain/window.ts"
import { Allow, Hold, pace, type PaceDecision } from "../../src/features/pace.ts"
import { bootA, bootB, grant, hour, inputFor, minute, reading, stamp, t0 } from "./fixtures.ts"

const policy = defaultPolicy
const tol = policy.resetToleranceMillis
const caps: Record<Window, number> = { fiveHour: 70, weekly: 60 }
const reset = (r: Observation) => Option.getOrUndefined(r.resetsAt)
const mono = (r: Observation) => Option.getOrUndefined(r.observedMono)

// The reference reset time of the period opened at index o: the first
// reset time among the opener and the readings after it (rule 5).
const referenceAt = (rs: ReadonlyArray<Observation>, o: number) => {
  for (const [i, r] of rs.entries()) {
    const value = reset(r)
    if (i >= o && value !== undefined) return { index: i, value }
  }
  return undefined
}

// Indexes that open a period: 0, then the first reading after the
// current opener whose reset time is beyond its reference by > tol.
const openers = (rs: ReadonlyArray<Observation>): Array<number> => {
  const out = rs.length === 0 ? [] : [0]
  let o = 0
  for (;;) {
    const ref = referenceAt(rs, o)
    if (ref === undefined) return out
    const next = rs.findIndex((r, i) => i > ref.index && (reset(r) ?? -Infinity) > ref.value + tol)
    if (next < 0) return out
    out.push(next)
    o = next
  }
}

const judge = (
  all: ReadonlyArray<Observation>,
  grants: ReadonlyArray<GrantPoints>,
  provider: Client,
  window: Window,
  now: number,
  nowMono: { bootId: string; micros: number } | undefined,
  estimate: number,
): "allows" | "fails" | "unusable" => {
  const rs = all.filter((r) => r.provider === provider && r.window === window)
  const os = openers(rs)
  const o = os[os.length - 1]
  if (o === undefined) return "unusable"
  const ref = referenceAt(rs, o)
  const members = rs.filter(
    (r, i) =>
      i >= o &&
      !(ref !== undefined && ref.index < i && (reset(r) ?? Infinity) < ref.value - tol),
  )
  const highest = Math.max(...members.map((r) => r.usedPercent))
  const stamped = members.filter((r) => mono(r) !== undefined)
  const lastMono = Option.getOrUndefined(Option.flatMap(Arr.last(stamped), (r) => r.observedMono))
  if (lastMono === undefined || nowMono === undefined) return "unusable"
  const boot = lastMono.bootId
  const lastOther = Option.getOrElse(
    Arr.findLastIndex(stamped, (r) => mono(r)?.bootId !== boot),
    () => -1,
  )
  const freshest = Math.max(...stamped.slice(lastOther + 1).map((r) => mono(r)?.micros ?? -1))
  const age = nowMono.micros - freshest
  const fresh = nowMono.bootId === boot && age >= 0 && age <= policy.freshnessMillis * 1000
  const resetAt = ref?.value
  if (!fresh || !(resetAt === undefined || now < resetAt)) return "unusable"
  const points = grants
    .filter((g) => g.provider === provider && g.window === window)
    .reduce((sum, g) => sum + g.points, 0)
  return highest + points + Math.max(1, estimate) <= caps[window] ? "allows" : "fails"
}

const oracle = (...args: [ReadonlyArray<Observation>, ReadonlyArray<GrantPoints>, number, { bootId: string; micros: number } | undefined, number]) => {
  const [rs, gs, now, nowMono, estimate] = args
  const windows = [Windows.FiveHour, Windows.Weekly]
  const judged = windows.map((w) => judge(rs, gs, Clients.Claude, w, now, nowMono, estimate))
  const notAllowing = windows.filter((_, i) => judged[i] !== "allows")
  if (judged.includes("fails")) return JSON.stringify(["Hold", notAllowing])
  if (notAllowing.length > 0) return JSON.stringify(["Unknown", notAllowing])
  return JSON.stringify(["Allow", []])
}

const describeDecision = (d: PaceDecision): string =>
  Schema.is(Allow)(d)
    ? JSON.stringify(["Allow", []])
    : JSON.stringify([Schema.is(Hold)(d) ? "Hold" : "Unknown", d.windows])

const Int = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }))
const Gen = Schema.Struct({
  readings: Schema.Array(
    Schema.Struct({
      codex: Schema.Boolean,
      weekly: Schema.Boolean,
      usedPercent: Int(0, 100),
      period: Int(-1, 2),
      jitterMinutes: Int(-6, 6),
      monoMinutes: Int(-1, 30),
      otherBoot: Schema.Boolean,
    }),
  ).check(Schema.isMaxLength(10)),
  grants: Schema.Array(
    Schema.Struct({ weekly: Schema.Boolean, points: Int(0, 30), codex: Schema.Boolean }),
  ).check(Schema.isMaxLength(6)),
  nowMinutes: Int(0, 40),
  nowBoot: Int(0, 2), // 0: no clock, 1: boot A, 2: boot B
  nowHours: Int(0, 12),
  estimate: Int(0, 30),
})
type Gen = typeof Gen.Type

describe("pace against the C13 oracle", () => {
  it.prop(
    "agrees with the search oracle on the full decision",
    { g: Gen },
    ({ g }: { g: Gen }) => {
      const readings = Arr.map(g.readings, (r, i) =>
        reading({
          seq: i + 1,
          provider: r.codex ? Clients.Codex : Clients.Claude,
          window: r.weekly ? Windows.Weekly : Windows.FiveHour,
          usedPercent: r.usedPercent,
          ...(r.period < 0 ? {} : { resetsAt: t0 + r.period * 5 * hour + r.jitterMinutes * minute }),
          ...(r.monoMinutes < 0 ? {} : { mono: stamp(r.monoMinutes * 60_000_000, r.otherBoot ? bootB : bootA) }),
        }),
      )
      const grants = Arr.map(g.grants, (x, i) =>
        grant(i + 1, x.weekly ? Windows.Weekly : Windows.FiveHour, x.points, x.codex ? Clients.Codex : Clients.Claude),
      )
      const now = t0 + g.nowHours * hour - hour
      const nowMono =
        g.nowBoot === 0 ? undefined : stamp(g.nowMinutes * 60_000_000, g.nowBoot === 1 ? bootA : bootB)
      const decision = pace(
        inputFor(readings, {
          now,
          nowMono: Option.fromNullishOr(nowMono),
          estimate: () => g.estimate,
          counting: grants,
        }),
      )
      return describeDecision(decision) === oracle(readings, grants, now, nowMono, g.estimate)
    },
    { arbitrary: { runs: 1000 } },
  )
})
