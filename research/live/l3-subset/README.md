# L3 subset live test (prepared; no client has run)

This package checks the two client profiles of the assisted cycle on a
disposable repository: the Claude editing profile must refuse writes
outside its worktree, edits to protected paths, `git commit`, `git push`
and `curl`, and the Codex review profile must refuse writes. It also
records both client versions for the pins and what an agent's
`git status` does to the index under the sandbox. `plan.md` has the
commands, the expected results and the PASS and FAIL rules.

The package is prepared and stays unrun. Running it needs its own
authorization from the owner; nothing in this directory or in a status
update grants that.

The Claude cases run twice: variant U loads the user's settings and
hooks, as production does today, and variant P passes
`--setting-sources project,local`. Each variant has its own scratch
root, snapshots and results table. Whether production should load user
settings (L03 in the batch review) is the owner's decision; the
variants give evidence for that ruling and do not make it. The settings
the run uses must stay equal to production's generated profile
(`src/format/claude-settings.ts`); `plan.md`, "Template and production",
lists the one difference, and `test-scripts.sh` checks that there is no
other.

No client has been run with a prompt. Preparation ran only `--version`
and `--help` of both clients, with network access denied by
`sandbox-exec`, and ran `setup.sh`, `snapshot.sh` and `teardown.sh`
against scratch roots through `test-scripts.sh`.

## Authorization needed

- The owner's approval of this package and its usage (fourteen short
  client runs: twelve Claude, six per variant, and two Codex; see
  "Estimated usage" in `plan.md`). The assisted-cycle plan lists the L3 subset as a separate
  authorization, and AGENTS.md says no live client call is authorized
  by its status alone.
- A waiver for the two Codex launches, unless the approval above is
  taken to include it (open question 5 in `plan.md`).
- The owner's ruling on L03, or an instruction to run both variants
  first (open question 1 in `plan.md`).
- Answers to the other open questions in `plan.md`, or an instruction to
  run as written.

## Order

1. Choose two scratch roots outside every repository and every
   temporary directory, for example `$HOME/foreman-l3-scratch-u` and
   `$HOME/foreman-l3-scratch-p`. Neither may exist yet: `setup.sh`
   creates each and refuses any path that is already there. Each path
   may hold only letters, digits, `.`, `_`, `+`, `-` and `/`, the
   alphabet production's profile accepts; `setup.sh` refuses any other
   character before it writes.
2. From a plain terminal in this directory, define the shell helpers in
   `plan.md` ("Shell definitions for the run"), which run `./setup.sh`
   for both roots.
3. Preflight (step 0): the user-settings record once; per variant, the
   listener and the baseline snapshot.
4. V: both `--version` readings, before.
5. Variant U: C1, the control (stop the package if it fails); C2 to C6,
   each bracketed by snapshots; X1, then X2. Stop its listener.
6. Variant P: C1 (stop variant P if it fails), then C2 to C6.
   Stop its listener.
7. V again, after.
8. Normalize both `out/` directories into whitelisted copies, inspect
   them, and write `results.md` here with one table per variant. Then
   run `./teardown.sh` on each root, which removes only the paths
   `setup.sh` recorded and keeps `out/`; delete `out/` and the roots
   yourself.

## Files

- `plan.md`: commands, expectations, sources of every flag, usage
  estimate, open questions.
- `claude-settings.json`: the editing-profile settings template.
- `setup.sh`, `teardown.sh`, `snapshot.sh`: the disposable repository,
  its removal, and the before-and-after manifests. None starts a client.
- `ownership.sh`: the scratch root's ownership record, which the three
  scripts share.
- `test-scripts.sh <base-dir>`: offline tests of the three scripts. Each
  run works in a new directory under `<base-dir>`, which must be outside
  every repository, and removes it at the end. The tests pass
  `--temp-ok`, so a directory under `/private/tmp` works. They cover an
  existing root, a preexisting `state/` with a sentinel, a partial
  setup, a second teardown, forged and missing records, roots with `*`,
  parentheses, a space, quotes, a backslash, a newline or `$(...)` (all
  refused with nothing created), a parent that resolves to such a path,
  file names with a newline inside a plain root, and the rendered
  settings against production's. That last case runs `bun` from the
  repository. Run it after any change to the scripts or the template.
- `prompts/`: the task text of each run.
