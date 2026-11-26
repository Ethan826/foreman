# Dogfood-6d: three review findings (second session for dogfood-6b)

## Read this first: the worktree already holds dogfood-6b

This is the second session for [dogfood-6b](2026-11-26-dogfood-6b-task.md)
(owner rulings in every brief, and overrule). Its change is in the
worktree, uncommitted, and has been reviewed three times; the owner's
check on it passed apart from load-induced timeouts in tests that
predate it (recorded separately; do not touch them). The session ended
because tarlatan allows two corrections a session. The rulings of the
dogfood-6b task still hold. Change only what the three findings below
ask.

## Task

The third review's findings, verbatim, then the coordinator's rulings.

- F5 (`test/features/rulings.test.ts`): "The cross-session fold test at
  line 77 claims to cover all three events but supplies only a foreign
  RulingAdded. It would pass if either FindingsRecorded or
  FindingOverruled stopped checking the session ID. Supply all three
  foreign events and assert that rulings, findings, and overrules stay
  unchanged."
- F6 (`test/program/production-rulings.test.ts`): "The status test
  records an overrule in only one review. It would pass if status
  dropped overrules from earlier reviews. Overrule a repeated finding ID
  in a re-review and assert that status prints both entries with their
  distinct review opIds and ruling IDs."
- F7 (`src/domain/README.md`): "Line 240 says an unusable handoff leaves
  only close --abandoned, but ruling add is allowed in every
  AwaitingHandoff state. Update that passage and the matching comments
  in session-state.ts and step-outcome.ts. The reject comments in
  session.ts, session-state.ts, and program/handoff.ts also need to
  reflect that ruling add remains available after rejection."

Rulings: do all three. F5 and F6 are test-only; if either test exposes
a defect, fix the code at its source and say so in the handoff. F7 is
documentation and comments only.

## Steps and rules

- Read `AGENTS.md` first and follow it. Do not edit `AGENTS.md`,
  `CLAUDE.md`, `eslint.rules.js` or anything under `.claude/`.
- In new code use the Effect modules, never native array or string
  methods; no lint-disable comments, casts or non-null assertions.
- Run `bun run docs` and `bun run check`. You may try
  `bun --bun vitest run <one test file>`; say so if the sandbox refuses
  it.
- Do not commit; run no `git` command other than `git status` and
  `git diff`.

## Done when

`bun run docs` and `bun run check` pass in your step and the owner's
`bun run test` passes after it. End with a handoff listing each change
and anything you were unsure about.
