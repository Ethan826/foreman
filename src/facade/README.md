# Facade

See [how it works](../../docs/how-it-works.md).

May import: `domain`, `features`, `format`, `program`.

Per the [design](../../docs/plans/2026-11-14-agent-supervisor-design.md) ("Architecture"), this layer will be the CLI, with the commands `status`, `approve`, `reconcile`, `waive`, `release`, `release-protected`, `adopt`, `restore` and `run`. It converts input to events and makes no decisions. It does not import Runtime, so it reaches the shell only through Program.
