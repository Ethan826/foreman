# Review of the dogfood-7 task draft (2026-11-28)

A fresh Opus review agent read the first draft of the dogfood-7 task
(`rounds grant`, `session close --unconverged`) against b1a566b,
read-only, with no git and no test runs. The coordinator recorded its
findings here and wrote them into the task.

Blocking: B1, a test builds an `OpenSession` literal that the new field
breaks, outside ruling 8. Important: I1, the limit had no place in
`status` (now `StatusReport.correctionLimit`; the field is
`roundsGranted`, avoiding the ledger's grants); I2, no refusal for a
close below the limit (now `CorrectionsRemain`, silent with no session);
I3, "not every finding overruled" pinned as `awaitsCorrection &&
!awaitsClose`, so a review without `FindingsRecorded` qualifies; I4, the
route is the owner's exits, and a two-way ternary in `closeKindOf` would
have mapped `--unconverged` to `Interrupted`; I5, a foreign grant during
an open session; I6, missing facts (no `--attest`, moved HEAD, schema
bounds, missing note, `--unconverged --attest`); I7, the design said
`CorrectionsExhausted` "names `rounds grant` in its message" but
refusals carry no message (owner decision). Minor: line citations, the
raise test's title, a README, the decimal grammar, `>=`, the command
class name, a `Rejected` row, the helper's signature.
