// Must fail: an ordinary test file may not run an Effect, even with the
// runSync that the lock-child entrypoint exception permits.
import { Effect } from "effect"

export const ran = Effect.runSync(Effect.succeed(1))
