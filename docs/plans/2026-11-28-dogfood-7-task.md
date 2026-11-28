# Dogfood-7: `rounds grant` and `session close --unconverged`

## Task

Slice 2 of v0.2.0 ([design](2026-11-25-session-recovery-and-rulings-design.md),
"The correction limit"; [plan](2026-11-25-session-recovery-and-rulings-plan.md),
tasks 2.1 and 2.2). Slice 1 (dogfood-6, 6b) added the log raise
(`raisesLogFormat`), `FindingsRecorded`, rulings and `overrule`; follow
their patterns (`src/program/rulings.ts`, the `AddRuling` and `Overrule`
commands).

1. `rounds grant <n> --note <reason>` raises the session's correction
   limit by `n`, so a session that converges slowly does not have to end.
2. `session close --unconverged` ends a session whose review still asks
   for changes at the limit, as the design's `notConverged`, instead of
   `--abandoned`.

### Already done before your step (by the coordinator, uncommitted)

`"unconverged"` is added to `closedNames` in `eslint.rules.js`, a line
`export const name30 = "unconverged"` to
`lint-fixtures/src/features/bare-names.ts` (before the type line), and
AGENTS.md's count of closed names goes from 29 to 30. `git diff` shows
them; do not change them.

### Owner rulings for this task (do not reopen)

1. The design is approved; `maxCorrections` stays 2
   (`src/features/command-rules.ts:67`). The owner's ruling of 2026-11-25
   allows more rounds within a session; a grant is the owner's decision,
   recorded with its reason.
2. **Event.** `RoundsGranted { sessionId, count, note }` in
   `src/domain/session-events.ts`, joining `ProjectEvent`; `count` a safe
   integer of at least 1, `note` non-empty, both enforced by the schema.
   `raisesLogFormat` returns true for it.
3. **Command and rule.** `GrantRounds { count }` joins `SessionCommand`
   (`src/domain/session.ts`). Allowed with the lock in any open state
   with no incomplete attempt (`openWithoutIncomplete`); not refused by a
   moved HEAD (it launches nothing), as `ruling add` is not.
4. **The fold and the limit.** `OpenSession` gains `roundsGranted`, the
   session's grants in order, each `{ count, note }` (plain Schema
   arrays; the name avoids the ledger's grants), filtered to the open
   session as the other arms are (`inSession`). The limit helper is
   `correctionLimit(session: OpenSession): number`, `maxCorrections` plus
   the sum of `roundsGranted`, exported with TSDoc and a test.
   `correctionsLeft` and `usedEveryCorrection` (`command-rules.ts:285-294`)
   compare the session's corrections with it (`>=`, as today). Corrections
   are counted as today (each corrector `Intended`); slice 3 changes that.
   `StatusReport` (`src/program/status.ts`) gains `correctionLimit:
   Option<Int>`, none with no session open, computed by the helper;
   `OpenSession` stores only the grants.
5. **The refusal.** `CorrectionsExhausted` gains `limit` (an integer)
   beside `corrections`, so the printed refusal shows both; refusals print
   as encoded JSON, so this is the whole change there. The facade README
   says that `rounds grant` lifts the limit.
6. **Close kind.** `CloseKinds.Unconverged = "unconverged"`
   (`src/domain/session.ts:46`).
   - The state predicate is `awaitsUnconverged` in
     `src/features/session-phases.ts`: `awaitsCorrection(state) &&
     !awaitsClose(state)`, that is, a `ChangesRequested` review awaits
     handoff and not every one of its recorded findings is overruled
     (a review with no `FindingsRecorded`, or none recorded, qualifies:
     `--finished` is closed to it). At the limit exactly one of
     `--finished` and `--unconverged` applies.
   - Rules in `closeRules` (`command-rules.ts:219-226`): the lock;
     `stateIs(awaitsUnconverged)` (refusal `WrongState`); then a new
     refusal `CorrectionsRemain { corrections, limit }` when the
     session's corrections are below its limit, which returns nothing
     when no session is open (so the loop over every close kind in
     `test/features/command-close.test.ts:106-111` still expects exactly
     `WrongState`). No `--attest`; not refused by a moved HEAD.
   - The route is the owner's exits, like `--abandoned`: `closeKindOf`
     (`src/facade/cli-arguments.ts:195-199`) maps `--unconverged` to
     `CloseSession { how: CloseKinds.Unconverged }`, which reaches
     `closeSession` (`src/program/session.ts:124-143`) over
     `exitProduction`; no new Program function. Replace the two-way
     ternary at `cli-arguments.ts:198`, which would otherwise map it to
     `Interrupted`; update the close usage errors (about 189-191) and the
     `--abandoned | --interrupted` comments in `program/session.ts`,
     `production-exits.ts`, `cli.ts` and `cli-commands.ts`.
   - It appends `SessionClosed` with how `unconverged`.
7. **CLI.** `rounds grant <n> --note <reason>`: `n` matches
   `^[1-9][0-9]*$` and is a safe integer, anything else a usage error;
   `--note` missing, empty or only whitespace a usage error;
   `--unconverged --attest` a usage error. The command class in
   `cli-commands.ts` is `GrantRoundsCommand`, run over `production` as
   `RecordRuling` is (`cli.ts:126`). It prints the `RoundsGranted` event as JSON,
   as `ruling add` prints its event. The program function goes in
   `src/program/rulings.ts` or a new `src/program/rounds.ts`, modelled on
   `addRuling`. The usage text names both new forms.
8. **Existing tests**: change exactly the following, and list each in
   the handoff.
   - `test/lint/fixtures.test.ts` (about line 234): the pinned
     `distinct: 29` becomes 30.
   - `test/features/holds.test.ts:164-171`: add `RoundsGranted` to
     `neutralKinds`.
   - `test/features/rulings.test.ts:31-40` (`emptySession`): add the
     empty `roundsGranted` field.
   - `test/features/command-head.test.ts:64-70` (`exitCases`): add
     `close --unconverged`.
   - `test/fixtures/events/encoded-events.json`: one `RoundsGranted` row,
     last, 2-space indent, keys in field order.
   - `test/domain/store-version.test.ts:118-121`: the "is true for
     exactly ..." test gains `RoundsGranted` (count 4), and its title
     names the four events; add the raise case to the `raisedBy` table in
     `test/runtime/project-log-rulings.test.ts`.
   - Tests that construct `CorrectionsExhausted` gain its `limit`.
   - Usage-text assertions (`test/facade/main.test.ts`, `cli.test.ts`):
     new assertions for both forms; update the header comment in
     `cli-arguments.ts`.

### Tests (each fact with a counterexample it must not pass)

| Fact | Counterexample |
|---|---|
| Two grants of 1 allow two more corrections and refuse a fifth; a single grant of 2 does the same. | One grant and one extra correction, which an unlimited counter also passes. |
| A grant in one session does not count in the next. | A test with one session. |
| A `RoundsGranted` naming another `sessionId` while a session is open leaves the limit unchanged. | A fold step without `inSession`, which the two-session row cannot catch. |
| The event schema refuses a count of 0, a non-integer count and a blank note. | Testing the CLI only. |
| `rounds grant` is allowed in `OpenNoAttempt`, `AwaitingHandoff` and `Rejected`, refused with no session, with an incomplete attempt and in `Interrupted`, and not refused by a moved HEAD. | Testing `AwaitingHandoff` only. |
| `CorrectionsExhausted` reports `corrections` and `limit`, the limit including grants. | A refusal checked only by tag. |
| `close --unconverged` is allowed at the limit with a `ChangesRequested` review awaiting handoff and an unoverruled finding, and with a `ChangesRequested` review that has no `FindingsRecorded`; refused with `CorrectionsRemain` one correction below the limit and after a grant that lifts it, and with `WrongState` when every finding is overruled, after a `Success` review, while an implement awaits handoff, and in `Rejected`; not refused by a moved HEAD. | Testing the allowed case only; or "some finding not overruled", which refuses the review with no `FindingsRecorded`. |
| The closed session records how `unconverged`, and the session then accepts `session open`. | Checking the command's output only. |
| `RoundsGranted` raises a log at 1 to 2. | A log already at 2. |
| The CLI parses `rounds grant 2 --note x`, refuses `rounds grant 0`, `-1`, `x`, `02`, `+2`, `2.0`, a number past the safe range, a missing or blank note, and `session close --unconverged --attest` as usage errors, and prints the event; `session close --unconverged` parses to the unconverged close. | Testing the program function only. |
| `status` shows `roundsGranted` and `correctionLimit` (none with no session). | A fold-only test. |

### Steps

1. Read `AGENTS.md` first and follow it (layering, Effect v4, TSDoc,
   closed vocabularies, readable functional code). The skills it names
   are not available in this session. Do not edit `AGENTS.md`,
   `CLAUDE.md`, `eslint.rules.js`, the bare-names fixture, or anything
   under `.claude/`.
2. Read the design section above, `src/program/rulings.ts`,
   `command-rules.ts`, `session-phases.ts`, the fold, `cli-arguments.ts`
   and their tests.
3. Make the change test-first where you can. Run `bun run docs` and
   `bun run check` and fix what they report. You may try
   `bun --bun vitest run <one test file>`; say so if the sandbox refuses
   it.
4. Update `src/domain/README.md`, `src/features/README.md`,
   `src/program/README.md`, `src/runtime/README.md` (line 17) and
   `src/facade/README.md` (line 37) where they describe
   the correction limit, the close kinds or the raising events, and the
   `raisesLogFormat` docstring.

### Rules

- Do not delete, skip, rename or loosen any existing test or assertion
  beyond ruling 8.
- In new code, source and tests, use the Effect modules, never native
  array or string methods; give an arrow that calls a void function a
  block body; keep callback nesting within three levels; named numbers.
- No lint-disable comments, no type casts, no non-null assertions, no
  changes to lint configuration (beyond the coordinator's), check
  scripts, `package.json`, `bun.lock`, `CHANGELOG.md` or CI.
- Do not commit, and run no `git` command other than `git status` and
  `git diff`.

### Done when

- `bun run docs` and `bun run check` pass in your step, and the owner's
  `bun run test` passes after it;
- every fact in the table has a test that would fail on its
  counterexample.

End with a handoff that lists every file you changed, the limit helper,
the new close rule, each existing test you changed and why, and anything
you were unsure about.
