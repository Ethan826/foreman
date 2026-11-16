# Checkpoint 2026-11-15

Where the foreman work stands, for the next session.

## Done

- Design revision 4 (usage ledger, review queue and scheduler,
  pre-approved backlog, role-swap suggestions, durable layer kept
  hand-built), approved by the owner with the rulings recorded at the end
  of the design. Model checks check3 and check4 pass; reruns are in
  research/model.
- Code: Domain types, Format decoders, provisional `pace`, ESLint house
  rules (native-method and null-check bans, closed vocabularies, layer
  edges), a vendored prose linter, CI (check and test), the onion diagram
  with its drift test, orientation docs, and a stability tripwire for
  effect/workflow.

## Next

1. Done: final independent reviews of the design through revision 6.1;
   the owner approved revision 6.1 on 2026-11-15 (see the ruling at the
   end of the design).
2. Done: the durable-execution question was answered in the design
   ("Durable-execution engines"); the hand-built log stays.
3. Done: orientation docs (README.md, docs/how-it-works.md) updated to
   revision 6.1 with the implementation plan. The onion diagram's layers
   did not change.
4. Still open: re-vendor the prose linter from the skills repository and
   run an editorial pass on the docs.
5. Superseded by
   [the implementation plan](2026-11-15-implementation-plan.md): its
   "Sequence" section gives the order (L1 and L2 packages for approval
   first, then Part A, the accounting decision, Part B, L3 and L4).
6. Done 2026-11-16: live tests L1 and L2 ran under the owner's approval
   and both came back positive (research/live/results-2026-11-16.md).
7. Done 2026-11-16: Part A (Tasks A1 to A4) ran inline under a
   300k-token cap: Domain types, period membership, `pace` to revision
   6.1 with the C13 oracle, C16 timer properties and C22 fixtures, and
   the estimate per role and window. Commit 5c0e2da went in with the
   prose gate failing (a command chain that did not stop on failure);
   c0cee4f fixed it.
8. Waiting on the owner: the accounting choice (deferred until L1 and L2
   reported; the arithmetic is to be rechecked before it is presented),
   O14 (Codex reset times roll forward while idle), approval of Part B,
   and whether the Claude decoder in `src/format/claude.ts` should take
   the `unifiedWindows` shape L1 found (Format decoders are in the
   authorized slice; it was not in Part A's task list).

## Rules to remember

Commits and pushes use the noreply address only; never use GitHub's merge
button. Personal material the owner shares as a writing model never
enters a repository.
