// Usage windows (design "Pacing").
import { Record, Schema } from "effect"

/**
 * The usage window names. Claude reports a five-hour and a weekly window.
 *
 * TODO(design "Pacing", live test L2): the windows Codex reports are not
 * known until L2 runs; the default Codex policy lists none.
 */
export const Windows = { FiveHour: "fiveHour", Weekly: "weekly" } as const

/** Schema for a window name, one of the values of {@link Windows}. */
export const Window = Schema.Literals(Record.values(Windows))
/** A window name, one of the values of {@link Windows}. */
export type Window = typeof Window.Type
