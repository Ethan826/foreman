# Dogfood-6b: owner rulings in every brief, and overrule

## Task

Second cycle of v0.2.0 ([design](2026-11-25-session-recovery-and-rulings-design.md),
[plan](2026-11-25-session-recovery-and-rulings-plan.md), tasks 1.3 and
1.4). Dogfood-6 (bd63d83) added per-store versions, the log raise
(`raisesLogFormat` in `src/domain/store-version.ts`) and
`FindingsRecorded`. Read the design's "Commands and events", "Closing
after overrules" and "Briefs" before you start.

Two owner commands:

1. `ruling add --text <t> [--supersedes <id>]` records a ruling; every
   later brief (implement, review, correct) lists every ruling of the
   session.
2. `overrule <findingId> --note <reason>` overrules one finding of the
   review awaiting handoff, which also records a ruling. Once every
   finding of that review is overruled, `session close --finished` is
   allowed; after any overrule, `review` may run again on the same tree.

### Owner rulings for this task (do not reopen)

1. The design is approved (2026-11-25), with the owner's answers of
   that day: `close --finished` is allowed once every finding of the
   awaited review is overruled, with no further review.
2. **Ids.** `RulingId` is a branded string in `src/domain/ids.ts`
   matching `R` followed by a positive decimal integer; rulings are
   numbered `R1`, `R2`, ... in session order, counting every
   `RulingAdded` of the session. A finding is named by its id within the
   review awaiting handoff; ids repeat across reviews, so every fold
   structure keys findings and overrules by review opId and finding id
   together. `Overrule.findingId` decodes as a non-empty string (as
   `Finding.id`, `src/domain/findings.ts:17`); `--supersedes` decodes
   `RulingId`, a bad value being a usage error, as `decoded` does in
   `cli-arguments.ts`. `ruling add` and `overrule` text that is empty or
   only whitespace is a usage error; other text is kept as given,
   line breaks included.
3. **Events** (`src/domain/session-events.ts`, joining `ProjectEvent`;
   `raisesLogFormat` returns true for both):
   - `RulingAdded { sessionId, rulingId, text, supersedes }`, `text`
     non-empty, `supersedes` `Schema.OptionFromOptionalKey(RulingId)`.
   - `FindingOverruled { sessionId, reviewOpId, findingId, rulingId,
     note }`, `note` non-empty. `overrule` appends `RulingAdded` and
     `FindingOverruled` in one batch, the ruling's text being exactly
     `Finding <findingId> of review <reviewOpId> is overruled: <note>
     (the finding: <summary>)`.
4. **Commands** (`src/domain/session.ts`, the `SessionCommand` union):
   `AddRuling { supersedes }` and `Overrule { findingId }`. Rules in
   `src/features/command-rules.ts`:
   - `AddRuling`: the lock; any open state with no incomplete attempt
     (`openWithoutIncomplete`); `supersedes`, when given, names a ruling
     already recorded in this session and not already superseded
     (refusal `RulingUnknown { rulingId }` or `RulingSuperseded {
     rulingId }`).
   - `Overrule`: the lock; a `ChangesRequested` review awaiting handoff;
     the finding recorded in that review's `FindingsRecorded` (refusal
     `FindingNotRecorded { findingId }`, which also covers a review with
     no `FindingsRecorded`, as in a session opened before dogfood-6);
     not already overruled (refusal `FindingOverruledAlready {
     findingId }`).
   - The four new refusals join the `Refusal` union and the re-export
     list (`command-rules.ts:51-55`); refusals print as encoded JSON
     through `CommandRefused`, so no message table changes.
   - Neither command is refused by a moved HEAD (they launch nothing),
     as the owner's exits are not (`command-head.test.ts`, `exitCases`).
5. **The fold** (`src/features/session.ts`, `src/domain/session-state.ts`):
   `OpenSession` gains the session's rulings in order (each with id,
   text, what it supersedes and what supersedes it), the findings
   recorded per review, and the overruled findings per review, all as
   plain Schema arrays and structs (no `HashMap` or `Map`), since
   `status` prints `state` encoded (`src/program/status.ts:94`). Add
   arms for the three events (`FindingsRecorded`, `RulingAdded`,
   `FindingOverruled`) beside the existing ones, filtered to the open
   session as the others are; the fold's `Match.orElse`
   (`session.ts:134`) would otherwise drop them silently. Export pure
   helpers for the rules and the briefs; their names are yours, but each
   has TSDoc and a test. Overrules stand once recorded: superseding the
   ruling an `overrule` added changes what the briefs show, not whether
   the finding is overruled (owner ruling, see below).
6. **Close and re-review** (`src/features/session-phases.ts`,
   `command-rules.ts`):
   - `awaitsClose` holds as today after a `Success` review, and also
     after a `ChangesRequested` review whose recorded findings are all
     overruled, with at least one finding recorded. An unusable review
     never allows it.
   - `review` is also allowed while a `ChangesRequested` review awaits
     handoff and at least one of its recorded findings is overruled
     (call it `awaitsReReview`). `rulesFor`'s `Review` arm takes
     `awaitsReview || awaitsReReview`, with `snapshotPasses` in the
     first case and `onReviewedTree` in the second, plus the existing
     launch and handoff rules.
   - In `src/program/review.ts`, the first rules check (about line 76,
     today against `presumedPassing`) presumes `presumedOnReviewedTree`
     on the re-review path, as `correct` does; otherwise every re-review
     is refused with `TreeChanged` before anything is staged.
   - A re-review's batch I is `SnapshotTaken`, `ReviewChecked` (the
     reviewed tree against the fresh snapshot, as `correct` and
     `close --finished` append it), `HandoffApproved` from the awaited
     review to the reviewer role, then `Intended`; `reviewedTree` is
     unchanged. Its brief's last handoff is the last implementer's or
     corrector's (`lastEdit(session)`, as `correct.ts` uses), not the
     previous reviewer's message. The round number stays the session's
     corrections.
7. **Briefs** (`src/format/brief.ts`): `implementBrief`, `reviewBrief`
   and `correctBrief` take `rulings: ReadonlyArray<Ruling>`, where
   `Ruling` is a Domain type (in `session-state.ts` or a new
   `src/domain/rulings.ts`; Format may import Domain, and Features may
   not import Format) with the id, the text, `supersedes:
   Option<RulingId>` and `supersededBy: Option<RulingId>`. They render
   a section titled `Owner rulings` right after the task section: one
   entry per ruling, `R1: <text>`, `R3 (supersedes R1): <text>`, or
   `R1 (superseded by R3): <text>` (an entry that both supersedes and
   is superseded shows both, supersedes first), entries separated by a
   blank line; `None.` when there is none. The review brief's section
   then has a blank line and this sentence: `A ruling settles its
   point. A finding that contradicts a ruling must cite the ruling's id
   and say why the ruling does not cover the case, or be left out.`
   `src/program/implement.ts`, `review.ts` and `correct.ts` pass the
   session's rulings. The brief's hash (`BriefRecorded`) then covers
   them.
8. **CLI** (`src/facade/cli-arguments.ts`, `cli-commands.ts`,
   `cli.ts`, usage text): `ruling add --text <t> [--supersedes <id>]` and
   `overrule <findingId> --note <reason>`, both required texts
   non-empty; each prints the appended event (for `overrule`, the
   `FindingOverruled`) as JSON, as `reject` does. The program functions
   go in a new `src/program/rulings.ts`, modelled on `reject` in
   `src/program/handoff.ts`.
9. **Existing tests**: change exactly the following, and list each in
   the handoff.
   - Golden briefs in `test/format/brief.test.ts`: each brief gains the
     `Owner rulings` section with `None.` (and the review brief its
     closing sentence) as exact insertions into the current golden
     texts, in the style dogfood-6c used.
   - `test/features/holds.test.ts`: add both events to `neutralKinds`.
   - `test/fixtures/events/encoded-events.json`: exactly one row per new
     event, last, 2-space indent, keys in field order, `supersedes`
     present in the `RulingAdded` row (the tests at
     `test/domain/events-encoding.test.ts` and
     `store-version.test.ts:114-116` require one row per member). Test
     `RulingAdded` without `supersedes` in a separate decode and encode
     test.
   - `test/domain/store-version.test.ts:118-122` ("is true for
     FindingsRecorded alone", count 1) becomes "is true for exactly
     FindingsRecorded, RulingAdded and FindingOverruled", count 3.
   - `test/program/attempt-protocol.test.ts:70` and
     `test/program/assisted-cycle.test.ts:111,141,144`: the brief calls
     gain `rulings: []`.
   - `test/facade/main.test.ts` and `cli.test.ts` assert usage-text
     fragments: add new assertions that the usage names both commands;
     update the header comment in `cli-arguments.ts:6-15`.

Note (recorded as intended): the design says sessions opened under
v0.1.x refuse `overrule`; this task refuses `overrule` for any review
without `FindingsRecorded`, so a later review of such a session, run
under this build, can be overruled. The plan chose this.

### Tests (each fact with a counterexample it must not pass)

| Fact | Counterexample |
|---|---|
| `ruling add` is allowed in `OpenNoAttempt`, `AwaitingHandoff` and `Rejected`, and refused with no session, with an incomplete attempt, and in `Interrupted`. | Testing only `AwaitingHandoff`. |
| Ids count every ruling, including those `overrule` adds: `ruling add`, `overrule`, `ruling add` gives R1, R2, R3. | Two plain rulings, which a counter of `ruling add` alone also numbers right. |
| `--supersedes` of an unknown or already superseded ruling is refused; the superseded ruling shows as superseded in every later brief. | Superseding the latest ruling only. |
| Every brief kind (implement, review, correct) lists every ruling with its id and both supersede marks. | Testing the review brief only. |
| `overrule` is refused for a crashed review, a `Success` review, an implement awaiting handoff, a finding id not recorded, a review with no `FindingsRecorded`, and a finding already overruled. | Testing an unknown id only. |
| `close --finished` is allowed after every finding of a two-finding `ChangesRequested` review is overruled, and refused after only one is. | A one-finding review, which cannot tell "every" from "any". |
| `review` after one overrule is allowed on the reviewed tree and refused (`TreeChanged`) on a changed tree; without any overrule it is refused as today. | Allowing review after any `ChangesRequested` review. |
| The overrule's ruling text quotes the finding's summary and the note exactly. | Checking only that a ruling was added. |
| Both new events raise a log at 1 to 2. | Testing `RulingAdded` only. |
| Finding ids are per review: after review A {F1, F2} is fully overruled and a re-review B reports {F1}, `overrule F1` is allowed for B, and `close --finished` is refused until B's F1 is overruled. | Overrules keyed by finding id alone. |
| A re-review runs end to end through the Program (the handoff harness): batch I holds `SnapshotTaken`, `ReviewChecked`, `HandoffApproved` and `Intended`, and its brief's last handoff is the last corrector's or implementer's, not the reviewer's. | A Features-only test with a faked snapshot, which cannot see the presumed-snapshot refusal. |
| The `BriefRecorded.briefSha256` of a brief built after `ruling add` differs from one built before, through the Program. | Comparing brief text without the recorded hash. |
| `status` prints the rulings (with supersede marks) and the overrules per review. | A fold-only test. |
| Superseding the ruling an `overrule` added leaves the finding overruled (close still allowed, `FindingOverruledAlready` still refuses), and the brief shows the supersession. | Testing supersession of a plain ruling only. |
| `correct` stays allowed after a partial overrule; `close --finished` after every finding is overruled still refuses a changed tree (`TreeChanged`); neither new command is refused by a moved HEAD. | Testing on an unchanged tree only. |
| The CLI parses both commands, refuses empty `--text` or `--note` as a usage error, and prints the event. | Testing the program function only. |

### Steps

1. Read `AGENTS.md` first and follow it (layering, Effect v4, TSDoc,
   closed vocabularies, readable functional code). The skills it names
   are not available in this session. Do not edit `AGENTS.md`,
   `CLAUDE.md`, `eslint.rules.js` or anything under `.claude/`.
2. Read the design sections above, `src/program/handoff.ts` (`reject`
   is the pattern), `command-rules.ts`, `session-phases.ts`,
   `session.ts` (the fold), `brief.ts`, and their tests.
3. Make the change test-first where you can. Run `bun run docs` and
   `bun run check` and fix what they report. You may try
   `bun --bun vitest run <one test file>`; say so if the sandbox
   refuses it.
4. Update `src/domain/README.md`, `src/features/README.md`,
   `src/format/README.md`, `src/program/README.md`,
   `src/runtime/README.md` (line 17, "today `FindingsRecorded`") and
   `src/facade/README.md` where they describe the commands, the close
   rules, the briefs or the raising events, and the `raisesLogFormat`
   docstring (`store-version.ts:122`). None of the new strings or tags
   is in `closedNames`; do not edit `eslint.rules.js`.

### Rules

- Do not delete, skip, rename or loosen any existing test or assertion
  beyond ruling 9.
- In new code, source and tests, use the Effect modules, never native
  array or string methods; give an arrow that calls a void function a
  block body; keep callback nesting within three levels.
- No lint-disable comments, no type casts, no non-null assertions, no
  changes to lint configuration, check scripts, `package.json`,
  `bun.lock`, `CHANGELOG.md` or CI.
- Do not commit, and run no `git` command other than `git status` and
  `git diff`.

### Done when

- `bun run docs` and `bun run check` pass in your step, and the owner's
  `bun run test` passes after it;
- every fact in the table has a test that would fail on its
  counterexample.

End with a handoff that lists every file you changed, the new
refusals, the fold's new fields, each existing test you changed and
why, and anything you were unsure about.
