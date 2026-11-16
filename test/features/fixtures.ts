// Shared builders for the Features tests: readings with ledger seq and
// monotonic stamps, grants, and a PaceInput over a list of readings.
import { Array as Arr, Option, Schema } from "effect"
import { type Client, Clients } from "../../src/domain/clients.ts"
import { BootId, type MonoStamp } from "../../src/domain/clock.ts"
import type { GrantPoints } from "../../src/domain/grant.ts"
import { GrantId, LedgerSeq } from "../../src/domain/ids.ts"
import type { Observation } from "../../src/domain/observation.ts"
import { defaultPolicy, type Policy } from "../../src/domain/policy.ts"
import { type Window, Windows } from "../../src/domain/window.ts"
import {
  Allow,
  defaultCap,
  Hold,
  type PaceDecision,
  type PaceInput,
} from "../../src/features/pace.ts"
import { currentPeriod } from "../../src/features/periods.ts"

export const hour = 3_600_000
export const minute = 60_000
export const t0 = 100 * hour
export const bootA = BootId.make("boot-a")
export const bootB = BootId.make("boot-b")

export const stamp = (micros: number, bootId = bootA): MonoStamp => ({
  bootId,
  micros,
})

export interface ReadingSpec {
  readonly seq: number
  readonly window?: Window
  readonly usedPercent: number
  readonly resetsAt?: number
  readonly mono?: MonoStamp
  readonly provider?: Client
}

export const reading = (spec: ReadingSpec): Observation => ({
  provider: spec.provider ?? Clients.Claude,
  window: spec.window ?? Windows.FiveHour,
  usedPercent: spec.usedPercent,
  resetsAt: Option.fromNullishOr(spec.resetsAt),
  observedAt: t0,
  observedMono: Option.fromNullishOr(spec.mono),
  seq: LedgerSeq.make(spec.seq),
  source: "claudeRateLimitEvent",
})

export const grant = (
  id: number,
  window: Window,
  points: number,
  provider: Client = Clients.Claude,
): GrantPoints => ({
  grantId: GrantId.make(`g-${String(id)}`),
  provider,
  window,
  points,
})

export const inputFor = (
  readings: ReadonlyArray<Observation>,
  patch: Partial<PaceInput> = {},
  policy: Policy = defaultPolicy,
): PaceInput => ({
  periods: (window) =>
    currentPeriod(
      Arr.filter(readings, (r) => r.window === window),
      policy,
    ),
  now: t0,
  nowMono: Option.some(stamp(1_000_000)),
  policy,
  provider: Clients.Claude,
  estimate: () => policy.initialEstimate,
  counting: [],
  cap: defaultCap(policy, Clients.Claude),
  ...patch,
})

export const decisionName = (decision: PaceDecision): string =>
  Schema.is(Allow)(decision)
    ? "Allow"
    : Schema.is(Hold)(decision)
      ? "Hold"
      : "Unknown"
