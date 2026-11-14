// The agent clients foreman drives. This is the one place their names are
// spelled; every schema, key and default elsewhere refers to `Clients`.
import { Record, Schema } from "effect"

export const Clients = { Claude: "claude", Codex: "codex" } as const

export const Client = Schema.Literals(Record.values(Clients))
export type Client = typeof Client.Type
