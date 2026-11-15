# Program

See [how it works](../../docs/how-it-works.md).

May import: `domain`, `features`, `format`, `runtime`.

Per the [design](../../docs/plans/2026-11-14-agent-supervisor-design.md) ("Architecture"), this layer will wire the Runtime capabilities into use cases, using Features and Format. It is the only layer that sees all of them, which is why the layer table lets it import all four. It will hold no logic of its own.
