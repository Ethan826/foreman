# Facade

See [how it works](../../docs/how-it-works.md).

May import: `domain`, `features`, `format`, `program`.

Per the [design](../../docs/plans/2026-11-14-agent-supervisor-design.md) ("Architecture"), this layer is the CLI. It converts input to commands and makes no decisions. It does not import Runtime, so it reaches the shell only through Program.

[`cli-arguments.ts`](cli-arguments.ts) reads the owner's words with `parseArguments`: `--config <path>` first, then one command of slices A1 and A2. [`cli-commands.ts`](cli-commands.ts) holds the commands it returns. Words it cannot read are a `UsageError`. The parser passes `--attest` on as given; Program refuses a handoff without it.

- `worktree create`
- `session open --tranche <id> --task <path>`
- `implement [--waive]`
- `review [--waive] --attest`
- `correct --findings <file> [--waive] --attest`
- `reject [--note <text>]`
- `status`
- `step-ended <opId> --grant <grantId>`
- `session close --abandoned|--interrupted [--note <text>]`
- `session close --finished --attest [--note <text>]`

[`cli.ts`](cli.ts) holds `main`. For `status` it calls Program's `productionStatus`, which opens the state read-only and takes no lock; it prints `StateMissing` when the state directory has no log. For every other command it builds the production context in Program from the configuration file and foreman's environment, calls the one Program function the command names, and prints the result as JSON on stdout or the failure on stderr. The exit status is 0 on success, 1 when the command failed and 2 on a usage error.

[`main.ts`](main.ts) is the entry. Run foreman as `bun src/facade/main.ts --config <path> <command>`, with one of the commands above. It passes the words after the script's path and foreman's environment to `main`, then exits with the status `main` returns: 0, 1 or 2 as above. Following the owner's ruling of 2026-11-19, it is the only module in `src/` that may reference the `process` global, and only as `process.argv`, `process.env` and `process.exit`. It is also the only module in `src/` that may run an Effect, through one awaited `Effect.runPromise`. The process gate (`test/runtime/git-process-gate.test.ts`) and a named lint exception in `eslint.rules.js` enforce those limits. [`process.d.ts`](process.d.ts) declares those three members of the global and no others.

The design's other commands (`approve`, `reconcile`, `waive`, `release`, `release-protected`, `adopt`, `restore` and `run`) are not built.
