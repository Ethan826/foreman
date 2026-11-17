// Must fail: a fixture beside the lock child is not exempt; the exception
// names one file, not its directory.
import { Effect } from "effect"

export const ran = Effect.runSync(Effect.succeed(1))
