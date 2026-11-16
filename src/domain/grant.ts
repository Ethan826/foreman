// Grants (design "Usage ledger", "Grant lifecycle"). A grant reserves a
// launch's estimate before the step runs; it counts at its amount (the
// estimate while open, the charged amount once charged) until it is
// canceled or the owner retires it. Which grants count is decided outside
// pacing (plan Task B2); pacing receives the points of the counting ones.
import { Record, Schema } from "effect"
import { Client } from "./clients.ts"
import { GrantId } from "./ids.ts"
import { Window } from "./window.ts"

export const GrantPoints = Schema.Struct({
  grantId: GrantId,
  provider: Client,
  window: Window,
  points: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type GrantPoints = typeof GrantPoints.Type

// Why a grant was canceled: its instance lost the compare-and-append race,
// or the settle step found no `Intended` naming it.
export const GrantCancelCauses = {
  LostRace: "lostRace",
  Orphan: "orphan",
} as const

export const GrantCancelCause = Schema.Literals(
  Record.values(GrantCancelCauses),
)
export type GrantCancelCause = typeof GrantCancelCause.Type
