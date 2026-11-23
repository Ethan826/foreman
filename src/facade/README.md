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

The usage text printed with a usage error ends with the owner's rule for a launch that does not return after its client exited. A process the client started still holds its output, and foreman never signals, so the owner interrupts foreman and then runs `status`, `step-ended` and `session close --interrupted`.

[`cli.ts`](cli.ts) holds `main`. For every command but `status` it builds the production context in Program from the configuration file and foreman's environment, calls the one Program function the command names, and prints the result as JSON on stdout or the failure on stderr. The exit status is 0 on success, 1 when the command failed and 2 on a usage error. `step-ended` is built with Program's `stepEndedProduction`, which opens only the log and the lock, and `session close --abandoned | --interrupted` with `exitProduction`, which also opens the ledger. Both run on the state directory's recorded target, so these exits stay reachable when the configuration names another target or a layout that breaks a rule (batch review B04, focused review finding 2). Neither prepares git's private `HOME`, so a contaminated home does not block them (re-review R02). Every other command is built with `production`, which refuses such a configuration and refuses an unusable git `HOME` with `GitHomeRefused`. Every command but `status` creates a missing state directory, and a command that opens the ledger creates a missing ledger directory, each with mode 0700, when its parent exists. A symbolic link to a directory is followed, as the layout check follows it. The command fails with `StoreDirectoryParentMissing` when the parent is missing too, and with `StoreDirectoryRefused` when the resolved path is not a directory. A dangling symbolic link still fails with `LayoutRefused`.

## The status output contract

For `status`, `main` calls Program's `productionStatus`. It opens the state read-only, takes no lock, writes nothing (SQLite's `-shm` coordination file may change, by the owner's ruling on B11) and reports what is broken beside whatever it can read (re-review R03). It prints one JSON object on stdout and exits 0, whatever it found. It exits 1, with the failure on stderr, only when the configuration cannot be read or decoded, or the project log or the ledger cannot be read. It exits 2 on a usage error, like every command.

The object is one of two:

- `StateMissing`, when the configured state directory has no project log: `stateDir`, `logPath` and `findings`.
- `ProductionStatusReport`, with five fields: `findings`, `target`, `inForce`, `gitHome` and `report`.

`findings` lists each problem status found, in this order, and is empty when there is none:

- `ConfiguredLayoutRefused` with `reasons`: the configured layout breaks a rule or a path in it cannot be resolved (batch review B05).
- `TargetBindingUnreadable` with `binding` and `reason`: the state directory's binding cannot be read or decoded (batch review B04).
- `RecordedLayoutRefused` with `binding` and `reasons`: the recorded target's layout, with the state directory, breaks a rule.

`target` compares the binding with the configuration: `TargetUnbound` when no binding is recorded, `TargetBound` when they agree, `TargetMismatch` with each difference, or `TargetUncompared` when the binding is unreadable or a configured path cannot be resolved. A mismatch is shown, never refused.

`inForce` is the target status ran on. `RecordedInForce` and `ConfiguredInForce` hold that target in `binding`. `NoTargetInForce` means status ran on no target and did not guess a replacement. It then leaves the ledger unread, so `report.ledgerFound` is false and the holds come from the log alone, and it runs no git command.

`gitHome` is `GitHomeUsable` or `GitHomeRefused` with every reason (batch review B02). Status judges the home from a reading and never makes it.

`report` is the status report described in Program's README: the session state, each incomplete attempt with its grant, the holds, the armed waivers, the pin checks, the worktree check, report and brief integrity, the coverage statement and the advisory process evidence. It is read from the configured state directory's log whatever the findings are. The worktree check runs git only when a target is in force, `findings` is empty and the home is usable. Otherwise `report.worktree` has `passed` false and a `detail` that ends in "worktree check skipped".

[`main.ts`](main.ts) is the entry. Run foreman as `bun src/facade/main.ts --config <path> <command>`, with one of the commands above. It passes the words after the script's path and foreman's environment to `main`, then exits with the status `main` returns: 0, 1 or 2 as above. Following the owner's ruling of 2026-11-19, it is the only module in `src/` that may reference the `process` global, and only as `process.argv`, `process.env` and `process.exit`. It is also the only module in `src/` that may run an Effect, through one awaited `Effect.runPromise`. The process gate (`test/runtime/git-process-gate.test.ts`) and a named lint exception in `eslint.rules.js` enforce those limits. [`process.d.ts`](process.d.ts) declares those three members of the global and no others.

The design's other commands (`approve`, `reconcile`, `waive`, `release`, `release-protected`, `adopt`, `restore` and `run`) are not built.
