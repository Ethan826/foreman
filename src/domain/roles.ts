// Roles, clients and the configurable role-to-client mapping (design
// "Scope"): the user decides which client fills each role; Claude
// implements and corrects and Codex reviews by default. Configuring the
// same client for two roles is allowed.
import { Schema } from "effect"

export const Client = Schema.Literals(["claude", "codex"])
export type Client = typeof Client.Type

export const Role = Schema.Literals(["implementer", "reviewer", "corrector"])
export type Role = typeof Role.Type

export const RoleClients = Schema.Struct({
  implementer: Client,
  reviewer: Client,
  corrector: Client,
})
export type RoleClients = typeof RoleClients.Type

export const defaultRoleClients: RoleClients = {
  implementer: "claude",
  reviewer: "codex",
  corrector: "claude",
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
