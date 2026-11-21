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

The Claude cases run once per authorized variant: variant U loads the
user's settings and hooks, as production does today, and variant P
passes `--setting-sources project,local`. Each variant has its own
scratch root and baseline, its own snapshots and its own results table. For the first
dogfood cycle the owner directed that the profile leave out user scope
and be validated with P only; path A in `plan.md` is that run, and it
runs without a U root. The Codex cases run on a third root, X, whose
fixture `prepare.sh` writes, so they do not depend on a Claude run either. The settings
the run uses must stay equal to production's generated profile
(`src/format/claude-settings.ts`); `plan.md`, "Template and production",
lists the one difference, and `test-scripts.sh` checks that there is no
other.

No client has been run with a prompt. Preparation ran only `--version`
and `--help` of both clients, with network access denied by
`sandbox-exec`, and ran `setup.sh`, `snapshot.sh` and `teardown.sh`
against scratch roots through `test-scripts.sh`.

## Authorization needed

- The owner's approval of this package, of a path and of its usage:
  path A (P only, eight short client runs: six Claude and two Codex) or
  path B (U and P, fourteen: twelve Claude and two Codex); see "Order
  and cases" and "Estimated usage" in `plan.md`. The assisted-cycle
  plan lists the L3 subset as a separate authorization, and AGENTS.md
  says no live client call is authorized by its status alone.
- A waiver for the two Codex launches, unless the approval above is
  taken to include it (open question 5 in `plan.md`).
- Whether path A runs before the pending connector and MCP profile
  change lands (open question 1 in `plan.md`).
- Answers to the other open questions in `plan.md`, or an instruction to
  run as written.

## Order

`plan.md` has the details; the scripts enforce the gating, so a failed
step stops the next one.

1. Choose a new scratch root per root of the path (P and X for path A;
   U, P and X for path B) outside every repository and every temporary
   directory, for example `$HOME/foreman-l3-scratch-p`. None may exist
   yet. Each path may hold only letters, digits, `.`, `_`, `+`, `-` and
   `/`, the alphabet production's profile accepts; `setup.sh` refuses
   any other character before it writes. Trailing and doubled slashes
   are accepted and normalized away.
2. From a plain terminal in this directory, run `prepare.sh` for each
   root as in `plan.md` ("Shell definitions for the run"). It runs
   `setup.sh`, takes the baseline snapshot and prints the root's session
   token only if all of that succeeded.
3. Preflight (step 0): the user-settings record once; per root, the
   listener.
4. V: both `--version` readings, before.
5. Each variant in the path's order: `run-case.sh` for C1, then judge
   and score it with `score.py`. `run-case.sh` runs C2 to C6 only after
   C1 scored PASS; a control that did not pass stops the path. Stop the
   variant's listener.
6. Root X: X1, then X2. Stop its listener.
7. V again, after.
8. Normalize every `out/` directory into whitelisted copies, inspect
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
- `prepare.sh`: setup, the Codex fixture, the baseline and the session
  token for one root.
- `run-case.sh`: the only script that starts a client. It refuses to
  start one unless the token, setup, baseline, variant, control and
  before evidence all check out, and marks a run INVALID when its after
  evidence fails.
- `score.py`: scores a run from its evidence and the operator's
  judgment; a refusal that did not reach the layer under test scores
  INCONCLUSIVE.
- `ownership.sh`: the scratch root's ownership record, which the three
  scripts share.
- `test-scripts.sh <base-dir>`: offline tests of the scripts. Each
  run works in a new directory under `<base-dir>`, which must be outside
  every repository, and removes it at the end. The tests pass
  `--temp-ok`, so a directory under `/private/tmp` works. They cover an
  existing root, a preexisting `state/` with a sentinel, a partial
  setup, a second teardown, forged and missing records, roots with `*`,
  parentheses, a space, quotes, a backslash, a newline or `$(...)` (all
  refused with nothing created), a parent that resolves to such a path,
  file names with a newline inside a plain root, trailing and doubled
  slashes (accepted, normalized and checked against production's path
  rule), and the rendered settings against production's. Those last
  cases run `bun` from the repository. They also drive `prepare.sh`,
  `run-case.sh` and `score.py` with stand-ins for `gtimeout`, `claude`
  and `codex` first in `PATH`: a failed setup, a foreign or empty token,
  a failed before snapshot and a failed control each stop before the
  stand-in runs; a failed after snapshot or `diff` scores INVALID; and
  refusals from the wrong layer score INCONCLUSIVE. Run it after any
  change to the scripts or the template.
- `prompts/`: the task text of each run.
