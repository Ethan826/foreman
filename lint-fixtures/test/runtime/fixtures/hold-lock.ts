// Must fail: at the exempted path, runPromise stays banned; the exception
// permits runSync only. The real test/runtime/fixtures/hold-lock.ts, which
// calls runSync, passing `bun run lint` is the matching control.
import { Effect } from "effect"

export const ran = Effect.runPromise(Effect.succeed(1))
