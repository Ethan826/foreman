// Pacing policy as configuration data (design "Pacing": windows per
// provider, reserve per provider and window, freshness, initialEstimate).
// Defaults confirmed by the user on 2026-11-14: reserve 30 percent of the
// five-hour window and 40 percent of the weekly window, freshness 10
// minutes, initialEstimate 15 points. The reserve stays configurable.
//
// Each provider's windows carry their own reserve, so a listed window
// always has one.
// TODO(design "Pacing", live test L2): Codex windows are not known; the
// default lists none, and pace answers Unknown for a provider with none.
import { Array as Arr, Schema } from "effect"
import { Window } from "./window.ts"

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
    new Set(entries.map((entry) => entry.window)).size === Arr.length(entries) ||
    "a window may be listed once per provider",
)

export const ProviderPolicy = Schema.Struct({
  windows: Schema.Array(WindowPolicy).check(distinctWindows),
})
export type ProviderPolicy = typeof ProviderPolicy.Type

export const Policy = Schema.Struct({
  providers: Schema.Struct({
    claude: ProviderPolicy,
    codex: ProviderPolicy,
  }),
  freshnessMillis: Schema.Int.check(Schema.isGreaterThan(0)),
  initialEstimate: percent,
})
export type Policy = typeof Policy.Type

export const defaultPolicy: Policy = {
  providers: {
    claude: {
      windows: [
        { window: "fiveHour", reservePercent: 30 },
        { window: "weekly", reservePercent: 40 },
      ],
    },
    codex: { windows: [] },
  },
  freshnessMillis: 10 * 60 * 1000,
  initialEstimate: 15,
}
