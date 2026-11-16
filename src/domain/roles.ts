// Roles and the configurable role-to-client mapping (design "Scope").
import { Record, Schema } from "effect"
import { Client, Clients } from "./clients.ts"

/**
 * The role names, spelled once here: implementer, reviewer and corrector.
 * `Clients` (clients.ts) holds the client names.
 */
export const Roles = {
  Implementer: "implementer",
  Reviewer: "reviewer",
  Corrector: "corrector",
} as const

/** Schema for a role name, one of the values of {@link Roles}. */
export const Role = Schema.Literals(Record.values(Roles))
/** A role name, one of the values of {@link Roles}. */
export type Role = typeof Role.Type

/**
 * The client that fills each role, keyed by role name. The user decides
 * the mapping (design "Scope"); the same client may fill two roles.
 */
export const RoleClients = Schema.Record(Role, Client)
/** The client for each role; see {@link RoleClients}. */
export type RoleClients = typeof RoleClients.Type

/** The default mapping: Claude implements and corrects, Codex reviews. */
export const defaultRoleClients: RoleClients = {
  [Roles.Implementer]: Clients.Claude,
  [Roles.Reviewer]: Clients.Codex,
  [Roles.Corrector]: Clients.Claude,
}

/**
 * A step: the role that runs and the correction round it belongs to, from
 * 0 (the first implementation and the first review).
 *
 * Guess to confirm: the design says `Intended(opId, tranche, step, ...)`
 * without defining a step.
 */
export const Step = Schema.Struct({
  role: Role,
  round: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
/** A step; see {@link Step}. */
export type Step = typeof Step.Type
