// Usage windows. Claude: five-hour and weekly (design "Pacing").
// TODO(design "Pacing", live test L2): the windows Codex reports are not
// known until L2 runs; the default Codex policy lists none.
import { Record, Schema } from "effect"

export const Windows = { FiveHour: "fiveHour", Weekly: "weekly" } as const

export const Window = Schema.Literals(Record.values(Windows))
export type Window = typeof Window.Type
