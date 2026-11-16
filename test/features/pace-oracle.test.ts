// C13 oracle: an independent, loop-based statement of revision 6.1's rule 1
// over raw readings and grants, compared with `pace` on generated inputs.
// It does not import periods.ts; it restates period membership itself.
import { describe, it } from "@effect/vitest"
import { Array as Arr, Option, Schema } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import type { GrantPoints } from "../../src/domain/grant.ts"
import type { Observation } from "../../src/domain/observation.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"
import { type Window, Windows } from "../../src/domain/window.ts"
import { pace } from "../../src/features/pace.ts"
import {
  bootA,
  bootB,
  decisionName,
  grant,
  hour,
  inputFor,
  minute,
  reading,
  stamp,
  t0,
} from "./fixtures.ts"

const policy = defaultPolicy
const tolerance = policy.resetToleranceMillis
const caps: Record<Window, number> = { fiveHour: 70, weekly: 60 }

interface OracleWindow {
  resetsAt: number | undefined
  highest: number
  boot: string | undefined
  micros: number
  started: boolean
}

// Rule 1 for one window, written as a loop over the window's readings in
// seq order. Returns "allows", "fails" or "unusable".
const oracleWindow = (
  readings: ReadonlyArray<Observation>,
  grants: ReadonlyArray<GrantPoints>,
  window: Window,
  now: number,
  nowBoot: string | undefined,
  nowMicros: number,
  estimate: number,
): string => {
  const w: OracleWindow = {
    resetsAt: undefined,
    highest: 0,
    boot: undefined,
    micros: 0,
    started: false,
  }
  for (const r of readings) {
    if (r.window !== window) continue
    const reset = Option.getOrUndefined(r.resetsAt)
    const mono = Option.getOrUndefined(r.observedMono)
    const later =
      w.started && w.resetsAt !== undefined && reset !== undefined && reset - w.resetsAt > tolerance
    const earlier =
      w.started && w.resetsAt !== undefined && reset !== undefined && w.resetsAt - reset > tolerance
    if (earlier) continue
    if (!w.started || later) {
      w.started = true
      w.resetsAt = reset
      w.highest = r.usedPercent
      w.boot = mono?.bootId
      w.micros = mono?.micros ?? 0
      continue
    }
    w.resetsAt ??= reset
    if (r.usedPercent > w.highest) w.highest = r.usedPercent
    if (mono !== undefined) {
      if (w.boot !== mono.bootId || mono.micros > w.micros) {
        w.boot = mono.bootId
        w.micros = mono.micros
      }
    }
  }
  if (!w.started) return "unusable"
  const age = nowMicros - w.micros
  const fresh =
    nowBoot !== undefined &&
    w.boot === nowBoot &&
    age >= 0 &&
    age <= policy.freshnessMillis * 1000
  const beforeReset = w.resetsAt === undefined || now < w.resetsAt
  if (!fresh || !beforeReset) return "unusable"
  let total = w.highest
  for (const g of grants) {
    if (g.provider === Clients.Claude && g.window === window) total += g.points
  }
  return total + estimate <= caps[window] ? "allows" : "fails"
}

const oracle = (
  readings: ReadonlyArray<Observation>,
  grants: ReadonlyArray<GrantPoints>,
  now: number,
  nowBoot: string | undefined,
  nowMicros: number,
  estimate: number,
): string => {
  const judged = [Windows.FiveHour, Windows.Weekly].map((window) =>
    oracleWindow(readings, grants, window, now, nowBoot, nowMicros, estimate),
  )
  if (judged.includes("fails")) return "Hold"
  if (judged.includes("unusable")) return "Unknown"
  return "Allow"
}

const Gen = Schema.Struct({
  readings: Schema.Array(
    Schema.Struct({
      weekly: Schema.Boolean,
      usedPercent: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
      period: Schema.Int.check(Schema.isBetween({ minimum: -1, maximum: 2 })),
      jitterMinutes: Schema.Int.check(Schema.isBetween({ minimum: -6, maximum: 6 })),
      monoMinutes: Schema.Int.check(Schema.isBetween({ minimum: -1, maximum: 30 })),
      otherBoot: Schema.Boolean,
    }),
  ).check(Schema.isMaxLength(10)),
  grants: Schema.Array(
    Schema.Struct({
      weekly: Schema.Boolean,
      points: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })),
      codex: Schema.Boolean,
    }),
  ).check(Schema.isMaxLength(6)),
  nowMinutes: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 40 })),
  noClock: Schema.Boolean,
  nowHours: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 12 })),
  estimate: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30 })),
})
type Gen = typeof Gen.Type

describe("pace against the C13 oracle", () => {
  it.prop(
    "agrees with the loop oracle on generated readings and grants",
    { g: Gen },
    ({ g }: { g: Gen }) => {
      const readings = Arr.map(g.readings, (r, i) =>
        reading({
          seq: i + 1,
          window: r.weekly ? Windows.Weekly : Windows.FiveHour,
          usedPercent: r.usedPercent,
          ...(r.period < 0
            ? {}
            : { resetsAt: t0 + r.period * 5 * hour + r.jitterMinutes * minute }),
          ...(r.monoMinutes < 0
            ? {}
            : { mono: stamp(r.monoMinutes * 60_000_000, r.otherBoot ? bootB : bootA) }),
        }),
      )
      const grants = Arr.map(g.grants, (x, i) =>
        grant(
          i + 1,
          x.weekly ? Windows.Weekly : Windows.FiveHour,
          x.points,
          x.codex ? Clients.Codex : Clients.Claude,
        ),
      )
      const now = t0 + g.nowHours * hour - hour
      const nowMicros = g.nowMinutes * 60_000_000
      const decision = pace(
        inputFor(readings, {
          now,
          nowMono: g.noClock ? Option.none() : Option.some(stamp(nowMicros)),
          estimate: () => g.estimate,
          counting: grants,
        }),
      )
      return (
        decisionName(decision) ===
        oracle(readings, grants, now, g.noClock ? undefined : bootA, nowMicros, g.estimate)
      )
    },
    { arbitrary: { runs: 1000 } },
  )
})
