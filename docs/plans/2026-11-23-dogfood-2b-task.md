Finish dogfood-2: foreman creates its state and ledger directories.

### Where this starts

The supervisor worktree already holds dogfood-2's uncommitted work: the
store-directory modules in Domain, Features, Program and Runtime, their
tests, and the wiring in `src/program/production.ts`,
`src/program/production-exits.ts`, `src/program/production-target.ts`
and `src/program/layout.ts`. The owner's checks pass on it: `bun run
docs`, `bun run check` and the full `bun run test` (141 files, 1,612
tests). The previous session ran out of corrections with two problems
open, F10 and F11 below. The owner carried the work into this session.
Read the original task, `docs/plans/2026-11-22-dogfood-2-task.md`, for
the behaviour wanted, with the owner's ruling below taking precedence.

### Owner ruling (stands; do not reopen)

The original task's item 3 was wrong about symbolic links. The
configured state and ledger paths are canonicalized as before, so a
symbolic link to a directory is followed and accepted, as
`test/program/production-binding.test.ts:103` requires. A path that,
once resolved, exists and is not a directory is refused with
`StoreDirectoryRefused`. A dangling symbolic link keeps the existing
`LayoutRefused`. A reviewer who reads the original task's item 3 should
take this ruling as the requirement.

### What to fix

**F10: an existing binding is checked before any directory is
touched.** `src/program/production.ts` now prepares the configured
ledger directory before it compares the configuration with a recorded
binding. With a binding already recorded and `ledgerDir` changed, the
command can create the new directory and only then fail with
`TargetMismatch`; with the new path's parent missing it fails with
`StoreDirectoryParentMissing` and hides the mismatch. Required order:

1. If a binding is recorded, compare the configuration with it first.
   A mismatch fails with `TargetMismatch` before any directory is read
   for creation or created.
2. Then judge both directories (missing parent, not a directory).
3. Then create whichever is missing.
4. Only then record a new binding (first use), prepare git's HOME and
   open the stores.

The owner-close path in `src/program/production-exits.ts` follows the
same order. `status` stays read-only. Tests: a changed `ledgerDir` with
a recorded binding gives `TargetMismatch` and creates nothing, both when
the new parent exists and when it is missing, for a session command and
for an owner close.

**F11: the ledger directory of a recorded binding is its real parent.**
`ledgerDirOfTarget` in `src/program/production-target.ts` returns `/`
for a bare relative ledger path such as `usage.sqlite`, which the
binding decoder accepts; the ledger then opens relative to the working
directory. Foreman only ever records absolute paths. Refuse a recorded
binding whose ledger path is not absolute when it is decoded, as a
`TargetBindingUnreadable` with a reason that says so, and keep
`ledgerDirOfTarget` deriving the parent from the absolute path. Tests:
a binding with a relative ledger path is refused by status and by an
owner close; the existing tests for absolute paths still pass.

### Rules

- Read `AGENTS.md` first and follow it. The skills it names are not
  available in this session; follow the surrounding files.
- Do not delete, skip, rename or loosen any existing test or assertion.
- Use the Effect modules, never native array or string methods (the
  lint bans them, for example `Array.includes`; use `Arr.contains`). No
  lint-disable comments, no type casts, no non-null assertions, arrow
  functions that call a void function get a block body, and no changes
  to lint configuration, check scripts, `package.json`, `bun.lock` or
  CI.
- Do not commit, and do not run `git` commands other than `git status`
  and `git diff`. This session cannot run `bun`; the owner runs the
  checks after your step.

### Done when

- F10 and F11 hold and are tested, and dogfood-2's behaviour still
  holds;
- `bun run docs` (free of warnings), `bun run check` and the full
  `bun run test` pass, run by the owner in the supervisor worktree.

End with a handoff that lists each fix, every file you changed, the
tests you added and what each shows, and anything you were unsure about.
