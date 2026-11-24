# Dogfood-4: rename the project to tarlatan

## Task

The project is renamed from "foreman" to "tarlatan" (owner rulings of
2026-11-24 in `docs/plans/2026-11-24-rename-plan.md`; read it first).
This task renames the code and the living documents. Local directories,
the configuration, the GitHub repository, the docs-site URL and the
ledger move later, at a cutover the coordinator runs; nothing in this
task depends on them.

### Already done before your step (by the coordinator, uncommitted)

`git mv src/format/foreman-config.ts src/format/tarlatan-config.ts` and
`git mv test/format/foreman-config.test.ts test/format/tarlatan-config.test.ts`.
The renames are staged, so `git status` shows them and `git diff` shows
only your unstaged edits. What they break, you fix: the imports at
`src/program/production-target.ts:22`, `src/program/production.ts:34`,
`src/program/status-target.ts:17` and `test/format/byte-order-mark.test.ts:12`,
the moved test's own import and comment, and the link at
`src/format/README.md:92` (tsc does not check Markdown links).

### Owner rulings for this task (do not reopen)

1. Living text describes the tool as it is now and uses "tarlatan"
   ("Tarlatan" at the start of a sentence). Records of what happened
   keep "foreman" as written.
2. Left unchanged as history: everything under `docs/plans/`;
   `research/model/`; `research/live/results-2026-11-16.md`,
   `research/live/read_limits.py` and `research/live/l3-subset/results.md`;
   `test/fixtures/events/encoded-events.json` (recorded events must keep
   decoding); in `research/live/l3-subset/plan.md`, lines 15 to 17 and
   865 to 868 (what path A and the rerun did); in
   `research/live/l3-subset/score.py`, line 1744 (path A's real output).
3. Stored formats keep their names, so existing roots and evidence stay
   readable: the L3 scratch-root header `foreman-l3-scratch 1`
   (`ownership.sh`), the path-record header `foreman-l3-path 1`
   (`prepare.sh:50`, `run-case.sh:195`), and the README line setup
   writes, "Disposable repository for foreman's L3 subset live test."
   (`setup.sh:178`), which `score.py`'s `README_LINE` must equal. Leave
   each of these, and its pair, exactly as it is.
4. The coordinator changes `AGENTS.md`, `CLAUDE.md`, `package.json`,
   `bun.lock`, `eslint.rules.js` and `.github/workflows/`, and the README's
   docs-site URL at cutover. Do not edit them; list in your handoff
   anything there you think needs changing.
5. The configured check commands are `bun run docs` and `bun run check`;
   run both before you hand off. The test suite cannot run inside the
   sandbox (`spawn EPERM`); the owner runs it after your step.

### Behaviour wanted

1. **Identifiers.** Every identifier containing "foreman" in any case,
   in `src/` and `test/`, is renamed: `ForemanConfig` to
   `TarlatanConfig`, `decodeForemanConfig` to `decodeTarlatanConfig`,
   `FOREMAN_PARENT_ONLY`, `FOREMAN_EOF`, `onForemanBranch`,
   `addForemanWithoutCheck` and the rest, with their TSDoc.
2. **Strings that name the project.** These change, and no stored field
   in the log, the ledger or the target binding changes:
   - the supervisor branch prefix (`supervisorBranchPrefix`,
     `src/domain/worktree.ts`) becomes `tarlatan/`. The startup check
     compares the branch recorded at creation, so a worktree created
     under `foreman/` keeps working;
   - the worktree lock reason (`lockReason`, `src/runtime/worktree.ts`)
     becomes `tarlatan`. The startup check tests only that a lock exists
     (`src/features/worktree-check.ts:133`), so the live worktree locked
     `foreman` keeps passing. `research/live/l3-subset/setup.sh:237` and
     its `plan.md` line change with it;
   - the default ledger directory (`defaultLedgerName`) becomes
     `.tarlatan`. A configuration that omits `ledgerDir` and whose state
     directory is already bound then gets `TargetMismatch`; the live
     configuration names `ledgerDir`, so it is not affected;
   - the CLI usage text says `tarlatan`;
   - the messages that name the tool: `src/features/git-home.ts:38`,
     `src/features/store-directory.ts:88`, `src/program/status.ts:38`
     (`evidenceCaveat`) and `src/program/attempt-run.ts:108`;
   - temporary-directory prefixes in `test/` (for example
     `foreman-spawn-`) become `tarlatan-...`.
3. **Tests.** Rename every occurrence in a test file, never a subset:
   a test that still says `foreman/*` while the prefix changed can pass
   without testing anything (`branch --list foreman/*` gives `""`). Every
   change whose only effect is the rename is authorized. No assertion is
   loosened, deleted or skipped. The pairs you cannot check without the
   suite, which the reviewer will check: the branch prefix and
   `test/program/worktree-create.test.ts`,
   `worktree-create-runner.test.ts`, `production-binding.test.ts`,
   `git-coverage.test.ts`; the lock reason and `git-coverage.test.ts:79`,
   `worktree-create.test.ts:47`, `worktree.test.ts`,
   `test/format/worktree-list.test.ts`, `test/features/worktree-check.test.ts`;
   the ledger name and `production-ledger.test.ts`,
   `tarlatan-config.test.ts`; the usage text and
   `test/facade/main.test.ts`, `cli.test.ts:152` (a regex across a string
   join in `cli-arguments.ts`); `git-home.ts` and `git-home.test.ts:24`;
   the includeIf pattern in `attribute-config.test.ts`;
   `parent-environment.ts` and `git-pinned.test.ts`; the heredoc
   delimiters in `production-harness.ts`. Renaming
   `test/domain/events.test.ts:36-37` is safe: no schema constrains the
   branch prefix.
4. **Living documents.** `README.md` (the name and prose; keep the
   docs-site URL as it is), `docs/how-it-works.md` (in the Mermaid
   diagram change the label `Foreman`, keep the alias `F`),
   `docs/dependency-intake.md` lines 176 and 179, every README under
   `src/`, TSDoc and comments in `src/` and `test/`, and `typedoc.json`'s
   `name`. Do not edit `docs/diagrams/` (a byte-identity test pins it) or
   `lint-fixtures/` (must-fail fixtures); neither mentions the project.
5. **The L3 package** (`research/live/l3-subset/`, except `results.md`
   and the history of ruling 2 and the formats of ruling 3): the branch
   `foreman/l3` becomes `tarlatan/l3` in `setup.sh:148` and in
   `test-scripts.sh` (about lines 2978 and 3023), the git identity
   `foreman-l3` in `setup.sh:158-159` becomes `tarlatan-l3`, and example
   roots such as `~/foreman-l3-scratch-p` in `plan.md` and `README.md`
   become `~/tarlatan-l3-scratch-p`.

### Steps

1. Read `AGENTS.md` first and follow it (layering, Effect v4, TSDoc,
   closed vocabularies). The skills it names are not available in this
   session. Do not edit `AGENTS.md` or `CLAUDE.md`.
2. Find every occurrence with the Grep tool: case-insensitive `foreman`
   over the worktree. `git grep` is not an allowed command.
3. Rename as above, then run `bun run docs` and `bun run check` and fix
   what they report. Keep prose plain: the prose gate runs in `check`.

### Rules

- Do not delete, skip, rename or loosen any existing test or assertion
  except as authorized above.
- Use the Effect modules, never native array or string methods, in
  source and tests; give an arrow that calls a void function a block
  body; keep callback nesting within three levels.
- No lint-disable comments, no type casts, no non-null assertions, no
  changes to lint configuration, check scripts, `package.json`,
  `bun.lock` or CI.
- Do not commit, and run no `git` command other than `git status` and
  `git diff`.

### Done when

- a case-insensitive search for `foreman` finds only: the paths and
  lines of ruling 2; the formats of ruling 3 and their pairs; the files
  of ruling 4; and the README's docs-site URL;
- `bun run docs` and `bun run check` pass in your step, and the owner's
  `bun run test` and `bash research/live/l3-subset/test-scripts.sh
  <absolute scratch dir>` pass after it.

End with a handoff that lists every file you changed, each string
change of item 2, anything for the coordinator under ruling 4, and
anything you were unsure about.
