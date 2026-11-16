// Pacing policy as configuration data (design "Pacing": windows per
// provider, reserve per provider and window, freshness, initialEstimate).
// Defaults confirmed by the user on 2026-11-14: reserve 30 percent of the
// five-hour window and 40 percent of the weekly window, freshness 10
// minutes, initialEstimate 15 points. The reserve stays configurable.
// Revision 4's defaults, confirmed by the owner: resetTolerance 5 minutes
// and dropTolerance 5 points (design "Defaults", "Periods").
// minEstimate 1 point per provider and window (owner ruling 2026-11-16,
// O15): no reservation or admission estimate is below it, so a step that
// measured 0 still reserves something. It is a floor on the estimate, not
// a bound on what a step uses.
//
// Each provider's windows carry their own reserve, so a listed window
// always has one.
// TODO(design "Pacing", live test L2): Codex windows are not known; the
// default lists none, and pace answers Unknown for a provider with none.
import { Array as Arr, Schema, Struct } from "effect"
import { Client, Clients } from "./clients.ts"
import { Window, Windows } from "./window.ts"

const percent = Schema.Number.check(
  Schema.isBetween({ minimum: 0, maximum: 100 }),
)

export const WindowPolicy = Schema.Struct({
  window: Window,
  reservePercent: percent,
})
export type WindowPolicy = typeof WindowPolicy.Type

const distinctWindows = Schema.makeFilter<ReadonlyArray<WindowPolicy>>(
  (entries) =>
    Arr.length(Arr.dedupe(Arr.map(entries, Struct.get("window")))) ===
      Arr.length(entries) ||
    "a window may be listed once per provider",
)

export const ProviderPolicy = Schema.Struct({
  windows: Schema.Array(WindowPolicy).check(distinctWindows),
})
export type ProviderPolicy = typeof ProviderPolicy.Type

export const Policy = Schema.Struct({
  providers: Schema.Record(Client, ProviderPolicy),
  freshnessMillis: Schema.Int.check(Schema.isGreaterThan(0)),
  initialEstimate: percent,
  resetToleranceMillis: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  dropTolerancePoints: percent,
  minEstimatePoints: percent,
})
export type Policy = typeof Policy.Type

export const defaultPolicy: Policy = {
  providers: {
    [Clients.Claude]: {
      windows: [
        { window: Windows.FiveHour, reservePercent: 30 },
        { window: Windows.Weekly, reservePercent: 40 },
      ],
    },
    [Clients.Codex]: { windows: [] },
  },
  freshnessMillis: 10 * 60 * 1000,
  initialEstimate: 15,
  resetToleranceMillis: 5 * 60 * 1000,
  dropTolerancePoints: 5,
  minEstimatePoints: 1,
}
