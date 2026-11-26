# Review of the dogfood-6b task draft (2026-11-26)

A fresh Opus review agent read the first draft of the dogfood-6b task
(rulings in every brief, and overrule) against bd63d83, read-only and
with no git commands. The coordinator recorded its findings here and
wrote them into the task.

Blocking: B1, three fixture rows broke the one-row-per-member tests.
Important: I1, two program tests calling the brief functions were
missing from ruling 9; I2, a re-review would be refused at its first
check (`presumedPassing` presumes the base tree); I3, the re-review's
last handoff, its `ReviewChecked` and the rule shape were unspecified
(decided: the last edit's handoff, `ReviewChecked` in batch I,
`awaitsReview || awaitsReReview`); I4, `status` was dropped; I5,
finding ids repeat across reviews; I6, whether superseding an overrule's
ruling reinstates the finding (owner decision); I7, the hash fact
shared a counterexample. Minor: M1 to M10 (no refusal message table,
layering of the ruling type, the "supersedes" mark, brief layout and
whitespace, closed vocabularies untouched, usage assertions, id
decoding, docs and docstrings, three more facts, and the v0.1.x
narrowing recorded as intended).
