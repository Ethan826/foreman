// Must fail: the CLI entry's run statement anywhere but src/facade/main.ts.
// The exception names one file, not its directory or layer, so the await
// and the runPromise are both still banned here.
import { Effect } from "effect"

const main = (argv: ReadonlyArray<string>) => Effect.succeed(argv)

export const status = await Effect.runPromise(main([]))
