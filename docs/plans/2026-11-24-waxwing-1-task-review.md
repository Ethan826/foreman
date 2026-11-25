# Review of the waxwing-1 task draft (2026-11-24)

A fresh Opus review agent read the first draft of the waxwing-1 task
(the build fix after merging Waxwing's `main` into `scope-a-impl`)
against faf4c6bb, read-only (118,716 tokens). The coordinator checked
the main claims against the code and wrote the findings into the task.

Blocking: B1, six JavaScript test helpers mirror the `Add` constructor
by name (`r0-translator-exprs`, `r0-census-walk`, `r0-holes-gen`,
`r0-generate-paths`, `r0-elab-walk`, RT5 in `r0-generate-pattern`), so
`verify` fails whatever src does while ruling 6 forbids test edits;
B2, the trace-inert digest names each constructor, so "recheck less
its trace is the baseline's" fails until re-pinned; B3, the activation
gate has two src-dependent tests, and both fail at HEAD already
because the gate reads `HEAD:src`. Important: I1, a fourth src site,
`Static/Rules.purs:72`, hidden behind the first three errors; I2,
`ReadBack/Walk.purs` ends its case functions in wildcards, so ruling 3
needs a total helper there; I3, the agent cannot read 12a657cd's diff,
so the task points at the files that show the pattern; I4, FX033's
repair may move corpus pins, not shown from code. Minor: `--strict`
builds; no new waxwing fences in docs; the background omitted
`research/effect-kinds`; no regression needle touches the changed
lines; no new exports.

Coordinator decisions: ruling 6 now authorizes exactly the four src
sites and the six named helpers, with one expected-value change (RT5's
list); ruling 5 lists three expected failures. The owner approves the
amended rulings before the session opens.
