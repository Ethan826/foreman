# Facade

See [how it works](../../docs/how-it-works.md).

May import: `domain`, `features`, `format`, `program`.

Per the [design](../../docs/plans/2026-11-14-agent-supervisor-design.md) ("Architecture"), this layer is the CLI. It converts input to commands and makes no decisions. It does not import Runtime, so it reaches the shell only through Program.

[`cli-arguments.ts`](cli-arguments.ts) reads the owner's words with `parseArguments`: `--config <path>` first, then one of slice A1's commands. Words it cannot read are a `UsageError`.

- `worktree create`
- `session open --tranche <id> --task <path>`
- `implement [--waive]`
- `status`
- `step-ended <opId> --grant <grantId>`
- `session close --abandoned|--interrupted [--note <text>]`

[`cli.ts`](cli.ts) holds `main`. It builds the production context in Program from the configuration file and foreman's environment, calls the one Program function the command names, and prints the result as JSON on stdout or the failure on stderr. The exit status is 0 on success, 1 when the command failed and 2 on a usage error. Nothing in this directory calls `main` yet. The owner ruled on 2026-11-19 that the entry statement, which reads `process.argv` and `process.env` and calls `process.exit`, lives in `src/facade/main.ts`.

The design's other commands (`approve`, `reconcile`, `waive`, `release`, `release-protected`, `adopt`, `restore` and `run`) are not built.
