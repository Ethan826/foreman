# Dogfood-7b: three minor review findings (second session for dogfood-7)

## Read this first: the worktree already holds dogfood-7

This is the second session for [dogfood-7](2026-11-28-dogfood-7-task.md)
(`rounds grant` and `session close --unconverged`). Its change, with the
coordinator's closed-vocabulary edits, is in the worktree, uncommitted,
and has been reviewed three times; the owner's check passed (1,908 of
1,908). The session ended because tarlatan allows two corrections a
session. The rulings of the dogfood-7 task still hold. Change only what
the three findings below ask.

## Task

The third review's findings, verbatim:

```json
[
  {
    "id": "F6",
    "severity": "minor",
    "file": "src/features/command-rules.ts",
    "summary": "The correctionLimit TSDoc says a log written by Tarlatan never reaches Number.MAX_SAFE_INTEGER. The grant rule permits equality, and the boundary test explicitly verifies that a valid grant reaches that limit. Clarify that a normally written log cannot exceed the bound."
  },
  {
    "id": "F7",
    "severity": "minor",
    "file": "src/program/README.md",
    "summary": "The target-binding section still lists only abandoned and interrupted closes as available under a mismatched configuration and refers to two close commands. Include --unconverged there because it uses the same recorded-target exit route."
  },
  {
    "id": "F8",
    "severity": "minor",
    "file": "test/program/rounds.test.ts",
    "summary": "The new corrected test helper calls the native array method queue.push at line 31, contrary to the task's explicit rule for new test code. Use the existing test harness abstraction or an Effect array operation."
  }
]
```

Rulings: do all three. F6: say that a log written by tarlatan never
exceeds `Number.MAX_SAFE_INTEGER` (it may reach it). F7: include
`--unconverged` with the closes available under a mismatched
configuration. F8: replace the native `push` with an Effect operation
or the harness's own abstraction, keeping the test's behaviour.

## Steps and rules

- Read `AGENTS.md` first and follow it. Do not edit `AGENTS.md`,
  `CLAUDE.md`, `eslint.rules.js`, the bare-names fixture, or anything
  under `.claude/`.
- In new code use the Effect modules, never native array or string
  methods; no lint-disable comments, casts or non-null assertions.
- Run `bun run docs` and `bun run check`. Do not commit; run no `git`
  command other than `git status` and `git diff`.

## Done when

`bun run docs` and `bun run check` pass in your step and the owner's
`bun run test` passes after it. End with a handoff listing each change.
