Split `test/program/admission.test.ts` into files of at most 250 lines.

### Goal

`test/program/admission.test.ts` is 261 lines. The project limits every
file to 250 lines (plan "Global constraints" in
`docs/plans/2026-11-19-assisted-cycle-plan.md`). Split it into files
that are each at most 250 lines, with every test kept and none weakened.

### Steps

1. Read `AGENTS.md` first, then `test/program/admission.test.ts` and
   `src/program/admission.ts`. The skills `AGENTS.md` names are not
   available in this session; follow the style of the existing files in
   `test/program/` instead.
2. Split the file along its two existing `describe` blocks:
   - `test/program/admission.test.ts` keeps `describe("admission", ...)`
     (the seven admission tests).
   - a new `test/program/grant-lifecycle.test.ts` takes
     `describe("grant lifecycle", ...)` (the three lost-race and settle
     tests).
   - the setup both blocks use (the constants, `context`, `estimate`,
     `request`, `readingRow`, `removeDir`, `withLedger`, `rowsOf`,
     `seedReadings`) moves to a new non-test module
     `test/program/admission-fixtures.ts` that both files import. A
     helper only one file uses stays in that file: `intended`,
     `finished` and `holdWriteLock` go with the grant lifecycle tests.
3. Give each file a header comment in the style of the current one
   (what it tests, and the plan task and design sections it covers), and
   give each exported helper in the fixtures module a one-line `/** */`
   comment, as the other `*-fixtures.ts` and `*-harness.ts` files in
   `test/program/` do.

### Rules

- Keep every `it.effect` test: the same ten test names, the same
  `describe` names, the same bodies and the same assertions. Do not
  delete, skip, rename or loosen any test or assertion, and do not
  change any timeout or busy-wait constant.
- Change nothing in `src/`, `docs/`, `eslint.rules.js`, `lint-fixtures/`,
  `package.json`, `bun.lock` or any configuration file. Only the three
  files above change or appear.
- Effect v4 and the house style of the surrounding tests: no
  lint-disable comments, no type casts, no non-null assertions, lines
  no wider than the existing ones.
- Do not commit, and do not run `git` commands other than `git status`
  and `git diff`. This session cannot run `bun`; the owner runs the
  checks below after your step.

### Done when

- each of the three files is at most 250 lines (`wc -l`);
- the ten tests run and pass under their old names;
- `bun run docs` (free of warnings), `bun run check` and the full
  `bun run test` pass, run by the owner in the supervisor worktree.

End with a handoff that lists the three files with their line counts,
the helpers you moved, and anything you were unsure about.
