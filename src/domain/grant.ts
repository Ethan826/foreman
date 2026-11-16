// Grants (design "Usage ledger", "Grant lifecycle"). A grant reserves a
// launch's estimate before the step runs; it counts at its amount (the
// estimate while open, the charged amount once charged) until it is
// canceled or the owner retires it.
import { Record, Schema } from "effect"
import { Client } from "./clients.ts"
import { GrantId } from "./ids.ts"
import { Window } from "./window.ts"

/**
 * What one counting grant contributes to pacing: its provider, window and
 * amount in percentage points of that window (non-negative). Which grants
 * count is decided outside pacing (plan Task B2); pacing receives only the
 * points of the counting ones and adds them to the window's level.
 */
export const GrantPoints = Schema.Struct({
  grantId: GrantId,
  provider: Client,
  window: Window,
  points: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
})
/** One counting grant's points; see {@link GrantPoints}. */
export type GrantPoints = typeof GrantPoints.Type

/**
 * Why a grant was canceled: `lostRace` when its instance lost the
 * compare-and-append race, `orphan` when the settle step found no
 * `Intended` naming it (design "Grant lifecycle").
 */
export const GrantCancelCauses = {
  LostRace: "lostRace",
  Orphan: "orphan",
} as const

/** Schema for a grant cancel cause, one of {@link GrantCancelCauses}. */
export const GrantCancelCause = Schema.Literals(
  Record.values(GrantCancelCauses),
)
/** A grant cancel cause, one of the values of {@link GrantCancelCauses}. */
export type GrantCancelCause = typeof GrantCancelCause.Type
