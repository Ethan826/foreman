# Review of the dogfood-3 task draft (2026-11-23)

A fresh, low-context Opus review agent read the draft of the dogfood-3
task (git history guard, HEAD check, configured check command) against
the repository at c3e7d00, before any session ran (185,876 tokens). It
changed nothing. The coordinator recorded its findings here; the full
report is in the session transcript.

## Blocking

1. The HEAD check contradicted `test/program/production-attributes.test.ts`,
   "a launch judges the session's base, not a HEAD that moved since",
   which commits in the worktree and expects the launch to succeed, and
   the B07 wording in `src/program/README.md` and the `checkedHead` TSDoc.
2. The template's tests had to change in ways the draft forbade:
   `test/format/claude-settings.test.ts` asserts every sandbox path lies
   inside the worktree, and `test/program/production-profile.test.ts`
   pins the whole template, so "with the key absent, the profile is
   unchanged" was false.
3. The enumerated denial list left writable, once arbitrary code runs:
   `hooks/`, `info/`, `modules/`, the owner checkout's HEAD and index,
   per-worktree refs (`refs/worktree`, `refs/bisect`), `reftable/`, other
   worktrees' HEAD and index, and the worktree identity files. A planted
   hook would run unsandboxed at the owner's next commit.

## Important

- `close --finished` reads no HEAD and the AC1 table says it runs no
  worktree check; the change needs saying and a narrow HEAD read.
- A failed HEAD read must keep its own failure and the waiver (R01).
- The configuration test "decodes every field" pins the decoded object;
  `checkCommands` must not join the target binding.
- The L3 package (`profile.sh`, `run-case.sh`, `test-scripts.sh`) calls
  the template and is not part of `bun run verify`.
- `bun run verify` runs code the agent can edit, `node_modules`
  included, which the owner already runs unsandboxed when checking.
- Protected names below the top level are denied to the tools but not
  to the sandbox; processes can outlive a step.

## Evidence

Simulating a read-only common and worktree git directory with file
permissions (git 2.50.1): `git status --short`, `git diff --stat` and
`git ls-files --others --exclude-standard` exited 0 with correct output;
git skips the index refresh when it cannot take `index.lock`. `git
commit` failed at `index.lock`, `git update-ref` at the ref's lock.

## Owner rulings (2026-11-23)

Deny `<commonDir>` and `<gitDir>` as wholes; a moved HEAD refuses the
launches and `close --finished` (B07's test is rewritten; the attribute
check still judges the base; the exits, `reject` and `status` are never
refused); the named test changes are authorized; the configuration may
add exact rules but none sets `checkCommands` until the C4 rerun passes;
the cycle is split into dogfood-3a (the guard, then the live rerun) and
dogfood-3b (`checkCommands`).
