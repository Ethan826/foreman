// Roles, clients and the configurable role-to-client mapping (design
// "Scope"): the user decides which client fills each role; Claude
// implements and corrects and Codex reviews by default. Configuring the
// same client for two roles is allowed.
// The role names are spelled once, here; `Clients` (clients.ts) holds the
// client names.
import { Record, Schema } from "effect"
import { Client, Clients } from "./clients.ts"

export const Roles = {
  Implementer: "implementer",
  Reviewer: "reviewer",
  Corrector: "corrector",
} as const

export const Role = Schema.Literals(Record.values(Roles))
export type Role = typeof Role.Type

// One client per role, keyed by the role names.
export const RoleClients = Schema.Record(Role, Client)
export type RoleClients = typeof RoleClients.Type

export const defaultRoleClients: RoleClients = {
  [Roles.Implementer]: Clients.Claude,
  [Roles.Reviewer]: Clients.Codex,
  [Roles.Corrector]: Clients.Claude,
}

// Guess to confirm: the design says `Intended(opId, tranche, step, ...)`
// without defining a step. A step here is the role that runs and the
// correction round it belongs to (0 for the first implementation and the
// first review).
export const Step = Schema.Struct({
  role: Role,
  round: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type Step = typeof Step.Type
