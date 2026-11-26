# Review of the dogfood-6e task draft (2026-11-26)

A fresh Opus review agent read the first draft of the dogfood-6e task
(load-sensitive tests) against 9d11a86, read-only, with no git and no
test runs. The coordinator recorded its findings here and rewrote the
task.

Blocking: B1, the draft named four tests while the plan record and
AGENTS.md ("fix every instance of a pattern") cover every test running
real git or processes under the default timeout (scope: owner
decision); B2, ruling 1 demanded observation the sandboxed implementer
cannot make (now: a prediction with a probe the coordinator confirms).
Important: I1, the inherited-pipe outcome `Unclassified` is that
leader's normal result; the likely cause is the test looking too late
(`ps -A` before the start is recorded, 25 ms polls, a 2-second
descendant), with a precise `src/` escape test; I2, the descendant must
end on its own (orphaned loops ran for days before); I3, timeouts only
as counted per-work constants with a ceiling (owner decision: 60,000
ms); I4, the interrupt locations are symptoms; I5, a `yes`-per-core load
reaches only about the core count, so the gate needs more load, five
runs and a load-free counterexample; I6, adding assertions must be
allowed. Minor: M1 to M5 (a real 1,500 ms speed claim excluded as an
owner decision, harness list, closer precedents, `it.effect` timeouts,
split done-when).
