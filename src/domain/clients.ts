// The agent clients foreman drives.
import { Record, Schema } from "effect"

/**
 * The names of the agent clients foreman drives. This is the one place they
 * are spelled; every schema, key and default elsewhere refers to `Clients`.
 */
export const Clients = { Claude: "claude", Codex: "codex" } as const

/** Schema for a client name, one of the values of {@link Clients}. */
export const Client = Schema.Literals(Record.values(Clients))
/** A client name, one of the values of {@link Clients}. */
export type Client = typeof Client.Type
