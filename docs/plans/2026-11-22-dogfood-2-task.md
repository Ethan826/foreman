Make foreman create its state and ledger directories when it first needs them.

### Goal

In the first real cycle (dogfood-1), `worktree create` failed because
the configured state directory did not exist. The error,
`TargetBindingUnreadable`, named the binding's temporary file
(`target-binding.json.<n>.tmp`, ENOENT), not the missing directory. The
ledger directory did not exist either. The owner had to run
`mkdir -m 700` for both. Foreman should set these up itself, the way it
already sets up git's private HOME.

### Behaviour wanted

1. A command that writes state (`worktree create`, `session open`, the
   launch commands and the closes, everything built by
   `src/program/production.ts` and `src/program/production-exits.ts`)
   makes sure the configured state directory exists before it writes
   anything there, and the ledger directory before it opens the ledger.
2. A missing directory is created as one directory with mode 0700, set
   again after creation so the umask cannot change it, as
   `createHome` in `src/runtime/git-home.ts` does. Only the last path
   component is created: if its parent does not exist, nothing is
   created and the command fails with a typed error that names the
   directory and says its parent is missing.
3. A path that exists and is a directory is used as it is; its mode is
   not changed. A path that exists and is not a directory (a file, or a
   symbolic link) is refused with a typed error naming the path.
4. `status` stays read-only: it never creates either directory and
   still reports `StateMissing` when the state directory is absent.
5. No other failure message changes. In particular a binding that
   cannot be written for another reason is still
   `TargetBindingUnreadable`.

### Steps

1. Read `AGENTS.md` first: its layering (decisions in Domain and
   Features, file system calls only in Runtime, Program wires them),
   Effect v4 style, TSDoc on every export, closed vocabularies with their
   lint fixtures for any new tagged error, and the 250-line file limit
   all apply. The skills `AGENTS.md` names are not available in this
   session; follow the surrounding files instead, especially
   `src/runtime/git-home.ts`, `src/program/git-home.ts` and
   `src/program/target-binding.ts`.
2. Put the directory reading and creation in Runtime, the decision
   (create, use, or refuse) where the existing code puts the git-home
   decision, and the call in Program before the first write to each
   directory.
3. Write tests first, next to the existing ones: Runtime tests for
   creation (mode 0700 even under a restrictive and a permissive umask),
   an existing directory left as it is, a missing parent refused with
   nothing created, and a file or symbolic link at the path refused; and
   one end-to-end test through the CLI in the style of
   `test/program/production-*.test.ts` where `worktree create` succeeds
   with a configuration whose state and ledger directories do not exist
   yet but whose parents do, and both appear with mode 0700. Keep the
   existing test that `status` creates nothing.
4. Update the READMEs under `src/` that describe the state directory or
   the ledger directory.

### Rules

- Do not delete, skip, rename or loosen any existing test or assertion.
- No lint-disable comments, no type casts, no non-null assertions, no
  changes to lint configuration, check scripts, `package.json`,
  `bun.lock` or CI.
- Do not commit, and do not run `git` commands other than `git status`
  and `git diff`. This session cannot run `bun`; the owner runs the
  checks below after your step.

### Done when

- the behaviour above holds and is tested;
- `bun run docs` (free of warnings), `bun run check` and the full
  `bun run test` pass, run by the owner in the supervisor worktree.

End with a handoff that lists every file you changed or added, the new
error types and where they are registered, the tests you added and what
each shows, and anything you were unsure about.
