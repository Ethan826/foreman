# L3 subset live test (prepared; no client has run)

This package checks the two client profiles of the assisted cycle on a
disposable repository: the Claude editing profile must refuse writes
outside its worktree, edits to protected paths, `git commit`, `git push`
and `curl`, and the Codex review profile must refuse writes. It also
records both client versions for the pins and what an agent's
`git status` does to the index under the sandbox. `plan.md` has the
commands, the expected results and the PASS and FAIL rules.

No client has been run with a prompt. Preparation ran only `--version`
and `--help` of both clients, with network access denied by
`sandbox-exec`, and ran `setup.sh`, `snapshot.sh` and `teardown.sh`
against scratch roots through `test-scripts.sh`.

## Authorization needed

- The owner's approval of this package and its usage (about eight short
  client runs: six Claude, two Codex; see "Estimated usage" in
  `plan.md`). The assisted-cycle plan lists the L3 subset as a separate
  authorization, and AGENTS.md says no live client call is authorized
  by its status alone.
- A waiver for the two Codex launches, unless the approval above is
  taken to include it (open question 5 in `plan.md`).
- Answers to the other open questions in `plan.md`, or an instruction to
  run as written.

## Order

1. Choose a scratch root outside every repository and every temporary
   directory, for example `$HOME/foreman-l3-scratch`. It must not exist
   yet: `setup.sh` creates it and refuses any path that is already
   there.
2. From a plain terminal in this directory, define the shell helpers in
   `plan.md` ("Shell definitions for the run") and run `./setup.sh`.
3. Preflight (step 0): the listener, the user-settings record, the
   baseline snapshot.
4. V: both `--version` readings, before.
5. C1, the control. Stop if it fails.
6. C2, C3, C4, C5, C6, each bracketed by snapshots.
7. X1, then X2.
8. V again, after. Stop the listener.
9. Normalize `out/` into whitelisted copies, inspect them, and write
   `results.md` here. Then run `./teardown.sh <scratch>`, which removes
   only the paths `setup.sh` recorded and keeps `out/`; delete `out/`
   and the root yourself.

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
  `--temp-ok`, so a directory under `/private/tmp` works. They cover an existing root, a preexisting `state/`
  with a sentinel, a partial setup, a second teardown, forged and missing
  records, and a root whose name holds a space, quotes, a newline and
  `$(...)`. Run it after any change to the scripts.
- `prompts/`: the task text of each run.
