# Runtime

Planned. No code, and not approved until the design is. Back to [how it works](../../docs/how-it-works.md).

May import: `domain`.

Per the [design](../../docs/plans/2026-11-14-agent-supervisor-design.md) ("Architecture"), this layer will be the Effect shell: launching agent processes in a new process group, the SQLite event store with its conditional append, the instance lock, the clock, the walk and digest of protected paths, git reads and the commit and reset procedures, and a notifier (a log notifier in the first version). Persistent state lives here and passes through the pure Features functions. The layer table lets Runtime import only Domain, so decisions stay out of it. No process, git, storage, clock or notifier code belongs here until the design is approved.
