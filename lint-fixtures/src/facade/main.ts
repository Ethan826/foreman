// Must fail: at the exempted path only one awaited Effect.runPromise, the
// whole initializer of one top-level const, is allowed. The real
// src/facade/main.ts passing `bun run lint` is the matching control; the
// first run below is that allowed form and reports nothing.
import { Effect } from "effect"

const first = await Effect.runPromise(Effect.succeed(1))
const second = await Effect.runPromise(Effect.succeed(first))
const forked = Effect.runFork(Effect.succeed(second))
const run = Effect.runPromise
export const both = { forked, run, other: await Promise.resolve(0) }
export const later = async (): Promise<number> => Effect.runPromise(Effect.succeed(0))
