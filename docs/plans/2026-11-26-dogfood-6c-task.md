# Dogfood-6c: two test fixes (second session for dogfood-6)

## Read this first: the worktree already holds dogfood-6

This is the second session for [dogfood-6](2026-11-26-dogfood-6-task.md)
(per-store versions, the log raise, findings in the log). Its change is
in the worktree, uncommitted, and has been reviewed three times; the
owner's check on it passed (docs, check, 1,738 of 1,738 tests). The
session ended because tarlatan allows two corrections a session. Do not
change anything except the two tests below. The rulings of the
dogfood-6 task still hold, with ruling 8 amended by the coordinator on
2026-11-26: the golden review brief in `test/format/brief.test.ts`
gains exactly the one line ruling 6 requires ("Each finding's "id"
must be distinct from every other finding's id.").

## Task

1. `test/runtime/project-log.test.ts`: correction 2 moved
   `currentLogCommitsNothing` (about line 167) to a log at format 2 and
   dropped the format-1 case. Keep the format-2 test as it is, and add
   a separate test that opening a log at format 1 (older-readable)
   commits nothing: seed a log at 1 (existing events only), assert it
   reads 1 before the open, open and close it, and assert with
   `PRAGMA data_version` on a second connection, as the format-2 test
   does, that nothing was committed, with the same-version control the
   format-2 test uses. Its counterexample: a writer that rewrites
   `user_version` to 1 on every older-readable open, which the
   header-value tests do not catch.
2. `test/format/brief.test.ts`: keep the golden check, but make it show
   the new line is an exact insertion: assert that the review brief
   equals the original golden text (as it was before dogfood-6, without
   the line) with exactly that one line inserted at its place, so every
   other byte stays pinned. Express the original text once and derive
   the expected brief from it; do not keep two full copies.

## Steps and rules

- Read `AGENTS.md` first and follow it. Do not edit `AGENTS.md`,
  `CLAUDE.md`, `eslint.rules.js` or anything under `.claude/`.
- Change only these two test files. No change to `src/`.
- In new code use the Effect modules, never native array or string
  methods; no lint-disable comments, casts or non-null assertions.
- Run `bun run docs` and `bun run check`. You may try
  `bun --bun vitest run test/runtime/project-log.test.ts
  test/format/brief.test.ts`; say so if the sandbox refuses it.
- Do not commit; run no `git` command other than `git status` and
  `git diff`.

## Done when

`bun run docs` and `bun run check` pass in your step and the owner's
`bun run test` passes after it. End with a handoff naming the new test,
the assertion that shows the insertion, and anything you were unsure
about.
