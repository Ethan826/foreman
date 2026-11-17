# Program

See [how it works](../../docs/how-it-works.md).

May import: `domain`, `features`, `format`, `runtime`.

Per the [design](../../docs/plans/2026-11-14-agent-supervisor-design.md) ("Architecture"), this layer will wire the Runtime capabilities into use cases, using Features and Format. It is the only layer that sees all of them, which is why the layer table lets it import all four. It will hold no logic of its own.

## Admission and settling

[`admission.ts`](admission.ts) runs each ledger decision in one transaction. `admit` reads every row, asks `pace` (rule 1) and the injected allocation rule (rule 2), and appends the request's `Grant` at its estimate only when both allow or the owner waived the launch. Until the rate fit converges, every window is in fallback and `allocationsInFallback` admits on rule 1 alone. `cancelLostRace` cancels a grant whose `Intended` lost the log's compare-and-append. `applySettle` writes what `settleActions` decides: it cancels orphans and charges finished steps at their estimate. If the transaction fails, it writes nothing. Admission bounds foreman's own launches and reservations; it does not keep the provider's count below the cap.
