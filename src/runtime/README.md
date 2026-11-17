# Runtime

See [how it works](../../docs/how-it-works.md).

May import: `domain`.

Per the [design](../../docs/plans/2026-11-14-agent-supervisor-design.md) ("Architecture"), this layer will be the Effect shell: launching agent processes in a new process group, the SQLite event store with its conditional append, the instance lock, the clock, the walk and digest of protected paths, git reads and the commit and reset procedures, and a notifier (a log notifier in the first version). Persistent state lives here and passes through the pure Features functions. The layer table lets Runtime import only Domain, so decisions stay out of it. The owner approved the design and Part B's first milestone (Tasks B1 to B10).

## Ledger store

[`ledger-sqlite.ts`](ledger-sqlite.ts) implements Domain's `LedgerStore` on a SQLite file through Bun's built-in `bun:sqlite` ([intake record](../../docs/dependency-intake.md)). Each record kind has its own table, and a one-row `ledgerSeq` table numbers every row across all tables. Each write is one `BEGIN IMMEDIATE` transaction, so seq order is commit order. A transaction that fails rolls back with no row written and no seq used. A second charge or cancel of a grant is skipped, and a charge of a canceled grant (or the reverse) fails with `GrantSettled`. A write that waits longer than `busy_timeout` for another connection's lock fails with `LedgerBusy` and writes nothing. [`bun-sqlite.d.ts`](bun-sqlite.d.ts) declares the parts of `bun:sqlite` the store uses, since the project installs no Bun type package.

Tests run on the Bun runtime (`bun --bun vitest run`), so they reach `bun:sqlite` against temporary database files.

## Project log and lock

[`project-log.ts`](project-log.ts) implements Domain's `ProjectLog`: one SQLite table of events numbered from 1. Each append includes the position its writer last read and runs in one `BEGIN IMMEDIATE` transaction. If another writer appended first, the append fails with `PositionMoved` and writes nothing. The writer then re-reads the log and decides again.

[`project-lock.ts`](project-lock.ts) gives one holder at a time and refuses a second at once with `LockHeld`. Bun has no `flock`, so the lock is SQLite's exclusive lock on a dedicated lock file, held with `busy_timeout` 0. SQLite's unix locks are POSIX advisory locks, which the operating system drops when the holder's process dies. [`sqlite.ts`](sqlite.ts) holds what the stores share: recognizing `SQLITE_BUSY` and reading an error's message.

## Supervisor worktree

[`worktree.ts`](worktree.ts) adds the supervisor worktree from the owner's checkout (plan B11a). `addWorktreeWith` resolves the base, refuses an existing `foreman/<name>` branch or an existing path before running `git worktree add --lock --reason foreman`, and cleans nothing up. It then returns raw reads: the requested path's `realpath` and four single-value `rev-parse` outputs (top level, HEAD's full ref, git directory, common directory), each from its own command. Program decodes and checks them. A failed command keeps its args, exit code and stderr. `listWorktrees` returns the text of `git worktree list --porcelain -z`. [`worktree-directory.ts`](worktree-directory.ts) holds `readDirectory`, which reports whether a directory is at the recorded path and the raw identity reads inside it, and [`file-paths.ts`](file-paths.ts) holds the `stat` and `realpath` reads, which fail with `PathUnreadable`. Git runs through an injected `RunGit`, which is `execFile` in production, with the inherited environment. The clean git environment belongs to B11's `git.ts`. [`node-child-process.d.ts`](node-child-process.d.ts) declares the Node calls this uses.
