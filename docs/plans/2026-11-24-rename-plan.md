# Plan: rename the project from foreman to tarlatan

Status: draft for the owner's approval, 2026-11-24. Nothing here is
authorized until the owner rules on the decisions below.

## Why

"Foreman" collides with two established developer tools (The Foreman
provisioning project and the Ruby Procfile runner) and is gendered. The
owner chose "tarlatan": the stiff open-weave gauze printmakers use to
wipe an intaglio plate, leaving ink only in the cut lines. A registry
check on 2026-11-24 found the name free on npm, PyPI, crates.io and
Homebrew, with no GitHub repository of that name. Artwork is in
`docs/artwork/` (`tarlatan.png`, `tarlatan.svg`, untracked).

## What the name touches (inventory at 11165c8)

159 tracked files mention it, about 690 times. Most are prose. The ones
that change behaviour or state:

| Item | Where | Effect of renaming |
|---|---|---|
| Supervisor branch prefix `foreman/` | `src/domain/worktree.ts:15` (`supervisorBranchPrefix`) | Used only by `worktree create` (`src/program/worktree.ts:115`). The startup check compares the branch recorded at creation (`src/features/worktree-check.ts`), so the live worktree on `foreman/dogfood-1` keeps passing after the code changes; new worktrees get `tarlatan/<name>`. |
| Default ledger directory `.foreman` | `src/format/foreman-config.ts:42` | Used only when the configuration omits `ledgerDir`. The live configuration names `~/.foreman` explicitly. |
| Target binding | `<stateDir>/target-binding.json` | Records the project id, the owner's checkout path, the supervisor path and branch, and the ledger file. Moving any of them is a `TargetMismatch` for the old state directory, so cutover uses a new state directory. |
| Configuration and wrapper | `~/.config/foreman/dogfood-1.json`, `fm`, `check.sh` | Paths and the project id move. |
| Local directories | `~/Desktop/foreman`, `~/Desktop/foreman-wt`, `~/Desktop/foreman-state`, `~/.foreman` | Renamed at cutover. |
| Claude Code's project memory | `~/.claude/projects/-Users-ethan-Desktop-foreman/` | Keyed by the checkout's path: moving the checkout starts an empty memory unless it is copied to the new key. |
| GitHub | `Ethan826/foreman`, Pages at `ethan826.github.io/foreman/` | A repository rename redirects git URLs; the Pages URL changes and does not redirect. |
| Package and CI | `package.json` `name`, `.github/workflows/`, README badges and links | Wording and URLs. |
| Code identifiers and files | `ForemanConfig`, `decodeForemanConfig`, `foreman-config.ts`, usage text `usage: foreman ...`, temp-directory prefixes such as `foreman-spawn-`, test names | Mechanical. |
| L3 package | branch `foreman/l3`, roots `~/foreman-l3-*` in examples | Fixture and example names. Earlier roots keep their names. |

## Decisions for the owner

1. **On-disk rename.** Rename every local directory and the
   configuration at one cutover between sessions, to `~/Desktop/tarlatan`,
   `~/Desktop/tarlatan-wt`, `~/Desktop/tarlatan-state`,
   `~/.config/tarlatan` and `~/.tarlatan`. Recommended. The alternative
   is renaming the code only and leaving the paths, which keeps a
   permanent mismatch.
2. **GitHub repository rename** to `Ethan826/tarlatan`. Recommended. The
   docs site moves to `ethan826.github.io/tarlatan/`.
3. **History stays as written.** `docs/plans/`, `research/` results and
   review records keep "foreman" where they describe what happened; a
   dated note in the checkpoint and the plan says the project was
   renamed. Living documents (README, AGENTS.md, layer READMEs,
   how-it-works, TSDoc, usage text) use the new name. Recommended.
4. **Who does the code rename.** As a foreman cycle, dogfood-4: a
   mechanical, well-specified change that is the first to use the
   configured check command from dogfood-3b, so the implementer can run
   `bun run verify` itself. The profile denies `AGENTS.md` and
   `CLAUDE.md`, and the task rules forbid `package.json` and CI files,
   so the coordinator changes those by hand in the same cycle, recorded.
   Recommended. The alternative is one coordinator-run worker outside
   foreman.
5. **CLI alias** `tl` in place of `fm`.
6. **Ledger history.** Move `~/.foreman/ledger.sqlite` to `~/.tarlatan/`
   so pacing keeps its history (no grant is open today). The old project
   id `foreman` stays in its rows as history; the new configuration's
   project id is `tarlatan`.

## Order

1. Finish dogfood-3b and land it (in progress).
2. Set `checkCommands: ["bun run verify"]` in the configuration. Before
   the first cycle that uses it, run `bun run verify` once under the
   rendered profile to learn which tests fail inside the sandbox
   (temporary directories, a Unix-socket bind, `ps`), so the task can
   say which failures are expected (follow-up from the 3b task review).
3. Dogfood-4, the code rename, as a foreman cycle on the current setup.
   Foreman runs from the owner's checkout, so the running tool does not
   change until the cycle lands. Scope: every identifier, file name,
   usage text, temp prefix, test name and living document in `src/`,
   `test/`, `research/` (current docs and fixtures only), `docs/`
   (living files only), `README.md`; the branch prefix becomes
   `tarlatan/` and the default ledger directory `.tarlatan`. The
   coordinator does `AGENTS.md`, `CLAUDE.md`, `package.json` and
   `.github/workflows/`. Done when `bun run verify`, the L3 script tests
   and Linux CI pass, and `git grep -i foreman` lists only history and
   the dated notes.
4. Land dogfood-4 on `main` (Linux CI on the pushed branch first).
5. Cutover, coordinator-run with the owner's OK, with no session open:
   - close the last foreman session; check `status` shows nothing
     incomplete and no armed waiver;
   - rename the GitHub repository; update `origin`;
   - move the checkout and the other directories; copy Claude Code's
     project memory to the new path's key;
   - write `~/.config/tarlatan/tarlatan.json` (project id `tarlatan`,
     the new paths, `ledgerDir` `~/.tarlatan`, the pins and
     `checkCommands`), the `tl` wrapper and `check.sh`;
   - move the ledger; create the new state directory through the first
     command; `tl worktree create` the supervisor worktree on
     `tarlatan/<name>`;
   - remove the old supervisor worktree (it is locked; unlock, then
     `git worktree remove`), keep the old state directory as an archive;
   - check `tl status`, the pins, Linux CI on `main` and the rebuilt
     Pages site.
6. Add the artwork to the README once the docs site and README use the
   new name.

## Cost

Dogfood-4: one implement step, one or two reviews and corrections,
roughly the size of dogfood-3a (about $5 to $10 of Claude usage plus
the Codex review). The cutover is an hour of coordinator work with no
agent cost. Nothing about the cutover is reversible without effort once
the GitHub repository is renamed, so it runs only with the owner's OK.

## Owner rulings (2026-11-24)

All six decisions as recommended: rename every local directory and the
configuration at one cutover; rename the GitHub repository; history
stays as written with a dated note; the code rename runs as dogfood-4
through foreman, with the coordinator changing `AGENTS.md`,
`CLAUDE.md`, `package.json` and `.github/workflows/` by hand in the
same cycle; the alias is `tl`; the ledger moves to `~/.tarlatan`. The
artwork is committed after the cutover and `tarlatan.png` becomes a
banner at the top of the README.
