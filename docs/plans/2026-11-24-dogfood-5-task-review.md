# Review of the dogfood-5 task draft (2026-11-24)

A fresh Opus review agent read the first draft of the dogfood-5 task
(the store version check) against d01c7f1, read-only (144,615 tokens).
The coordinator spot-checked its citations, recorded its findings here
and wrote them into the task.

Blocking: none. Important: I1, three READMEs were missing from the
docs list, and `src/facade/README.md:33` states the six-field
`ProductionStatusReport` that P5 changes; I2, a four-way decision
spelled as strings would be a closed vocabulary needing
`eslint.rules.js`, which the task forbids; I3, P1's order left
`busy_timeout`, `keepWalFiles`, the WAL switch and which read decides
the stamp unstated; I4, the "never lowers" store test carried no
signal, since a newer store is refused before any stamp; I5, raw
fixture connections lose the WAL files on Linux, and header bytes lag
in WAL mode; I6, facts without a test (production refusal, status on a
newer store, the absent ledger version, P2 on the readers, both
stores); I7, status failing on a newer shared ledger breaks status's
"report beside what it can read" contract (product decision); I8, the
printed encoding of the optional ledger version was unspecified.
Minor: M1 to M9 (refusing a WAL-mode store could checkpoint it; the
reader check belongs in the open; Behaviour 2 contradicted P3; `open`
at the callback-depth limit; every log open now takes the write lock;
the native-methods rule applies to new code; the newer-store row should
assert `path`; `version`'s type; P4 omitted `step-ended`'s caller).

Coordinator decisions (stricter option, no product question): the
first read runs on a separate read-only connection, so a refused store
never gets a read-write connection (answers M1); the decision returns
four tagged classes matched with `Match.tag`; P1 gives the full
sequence; a `data_version` test replaces the store half of "never
lowers", and the implementer must watch it fail against an
unconditional stamp; fixtures call `keepWalFiles` and read versions by
pragma; the optional ledger version uses `Schema.OptionFromOptionalKey`;
the log open's brief write lock is accepted. I7 goes to the owner as
P6, with the coordinator's recommendation.
