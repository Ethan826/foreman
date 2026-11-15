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

1. Final independent review of the design (Opus), including the prose of
   the older sections, which still have about 94 blocking tells.
2. Answer the open question on durable-execution engines (DBOS and
   others): does any engine guarantee it never replays a step on its own?
3. Update the orientation docs and diagrams to revision 4.
4. Re-vendor the prose linter from the skills repository (it now flags
   the "will hold" line in README.md) and run an editorial pass on the
   docs with the observed-tells register and good-patterns page.
5. After design approval: implementation plan, then the live tests L1 to
   L4, each with the owner's approval.

## Rules to remember

Commits and pushes use the noreply address only; never use GitHub's merge
button. Personal material the owner shares as a writing model never
enters a repository.
