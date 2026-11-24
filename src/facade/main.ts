// The CLI's entry statement (owner ruling on A1, 2026-11-19): the one
// module in src/ that may reference the `process` global, and only as
// `process.argv`, `process.env` and `process.exit` (the process gate
// enforces both limits; the entry's cases are in
// test/runtime/process-entry-gate.test.ts). It passes the owner's words and
// tarlatan's environment to `main` in cli.ts, which decides nothing either,
// and exits with the status `main` returns. Run it as
// `bun <checkout>/src/facade/main.ts --config <path> <command>`
// (decision P3).
import { Array as Arr, Effect } from "effect"
import { main } from "./cli.ts"

/** The words before the owner's: the runtime and this script's path. */
const leadingWords = 2

const status = await Effect.runPromise(main(Arr.drop(process.argv, leadingWords), process.env))
process.exit(status)
