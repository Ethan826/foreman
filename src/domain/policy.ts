// Pacing policy as configuration data (design "Pacing": windows per
// provider, reserve per provider and window, freshness, initialEstimate;
// "Defaults", "Periods"). Point amounts are percentage points of a
// window, 0 to 100.
import { Array as Arr, Schema, Struct } from "effect"
import { Client, Clients } from "./clients.ts"
import { Window, Windows } from "./window.ts"

const percent = Schema.Number.check(
  Schema.isBetween({ minimum: 0, maximum: 100 }),
)

/**
 * One window a provider is paced on, with its reserve in percent (0 to
 * 100). The default cap for the window is 100 minus the reserve. Each
 * listed window has its own reserve, so a listed window always has one.
 */
export const WindowPolicy = Schema.Struct({
  window: Window,
  reservePercent: percent,
})
/** One paced window and its reserve; see {@link WindowPolicy}. */
export type WindowPolicy = typeof WindowPolicy.Type

const distinctWindows = Schema.makeFilter<ReadonlyArray<WindowPolicy>>(
  (entries) =>
    Arr.length(Arr.dedupe(Arr.map(entries, Struct.get("window")))) ===
      Arr.length(entries) ||
    "a window may be listed once per provider",
)

/**
 * The windows a provider is paced on, each listed at most once. Pacing
 * checks exactly these windows (R-P1); a provider with none is always
 * Unknown, never Allow.
 */
export const ProviderPolicy = Schema.Struct({
  windows: Schema.Array(WindowPolicy).check(distinctWindows),
})
/** A provider's paced windows; see {@link ProviderPolicy}. */
export type ProviderPolicy = typeof ProviderPolicy.Type

/**
 * The pacing policy.
 *
 * - `providers`: each client's paced windows.
 * - `freshnessMillis`: how old, in milliseconds of monotonic time, a
 *   reading may be and still count as fresh. Positive.
 * - `initialEstimate`: the estimate in points for a role with no measured
 *   step in a window.
 * - `resetToleranceMillis`: a reading whose reset time is later than the
 *   period's by more than this many milliseconds opens a new period; one
 *   earlier by more than this belongs to an earlier period (design
 *   "Periods").
 * - `dropTolerancePoints`: a joining reading lower than the period's
 *   highest by more than this is listed as a drop, for display.
 * - `minEstimatePoints`: the floor on every reservation and admission
 *   estimate, the same for every provider and window (O15), so a step that measured 0 still reserves something. It
 *   is a floor on the estimate, not a bound on what a step uses.
 */
export const Policy = Schema.Struct({
  providers: Schema.Record(Client, ProviderPolicy),
  freshnessMillis: Schema.Int.check(Schema.isGreaterThan(0)),
  initialEstimate: percent,
  resetToleranceMillis: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  dropTolerancePoints: percent,
  minEstimatePoints: percent,
})
/** The pacing policy; see {@link Policy}. */
export type Policy = typeof Policy.Type

/**
 * The default policy. Confirmed by the user on 2026-11-14: reserve 30
 * percent of the five-hour window and 40 percent of the weekly window,
 * freshness 10 minutes, initialEstimate 15 points; the reserve stays
 * configurable. Revision 4's defaults, confirmed by the owner:
 * resetTolerance 5 minutes and dropTolerance 5 points. minEstimate 1 point
 * (owner ruling 2026-11-16, O15).
 *
 * TODO(design "Pacing", live test L2): Codex windows are not known; the
 * default lists none, so pacing answers Unknown for Codex.
 */
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
