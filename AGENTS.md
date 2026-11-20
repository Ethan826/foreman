# Foreman: agent instructions

Foreman is a small personal supervisor. It drives unmodified Claude Code
and Codex clients through tranches of work on one target repository:
Claude implements, Codex reviews, Claude corrects, and the user approves
before the next tranche. It paces launches against the user's
subscription windows, renews context with every step, and keeps durable
checkpoints.

Status (2026-11-18): the owner approved the design at revision 6.1; its
open items stay open unless a later owner ruling resolves them. Part A
landed on 2026-11-16, Part B milestone 1 (B1 to B10) on 2026-11-17, and
B11a (supervisor worktree creation and identity) and B11b (every git
command in the clean environment, including review item R8) on
2026-11-18, all on `main`. Production git runs only through
`worktreeProgram` and `cleanGit` in `src/runtime/git.ts`. Work is stopped
at an approval gate: the rest of B11 and B12 to B18 are not authorized,
and scoping a slice does not authorize it. `bun run check` (tsc, ESLint
and the prose gate) and `bun run test` must pass before any commit, and
`bun run docs` must build without warnings, as CI's docs workflow
requires.

Live tests L1 (Claude usage readings) and L2 (Codex usage windows) ran on
2026-11-16 and both came back positive; results and limits are in
`research/live/results-2026-11-16.md`. L3 (permissions) waits on B16;
L4 (crash and restart) waits on B13 to B15. No live client call is
authorized by this status update.
Until the Codex windows enter the default policy, every Codex launch
needs a waiver.

Start with `docs/plans/2026-11-14-agent-supervisor-design.md`; its
decision record and the finished Ralph trial are beside it. Do not repeat
the Ralph trial.

## Architecture

Use the decision-core architecture (skill `decision-core-architecture`):
pure, total Domain and Features; Format for decoding and encoding;
Runtime in Effect for processes and storage and for the clock, git and
notification; Program wires capabilities; the facade (CLI) converts input
and leaves every decision to the core. Persistent state lives in the shell and passes through the
pure functions.

Load the skills `effect-v4` and `readable-functional-code` before writing
or reviewing code in `src/` or `test/`.

- TypeScript with Effect v4 (skill `effect-v4`). Exact pins and a
  committed lockfile once installation is approved.
- Inject implementations; never select behavior with a flag.
- Compose published components (statecharts, SQLite transactions, Effect
  Schedule, vendor public CLI protocols). Flag any invented algorithm.
- Holds for quota, approval, uncertain operations and failures stay
  distinct. Timers and notification timeouts never grant approval.
- No bypass permission flags for either agent client.

## Lint

`eslint.rules.js` holds the house rules; `bun run lint` runs it.
`lint-fixtures/` holds must-fail files that `test/lint/fixtures.test.ts`
checks; a new rule group needs a fixture there. No lint-disable comments.

The shared source of these rules is the owner's skills repository
(github.com/Ethan826/skills): the reference config and its check live in
`skills/effect-v4/lint/` and `checks/effect-v4-lint/`, the closed-vocabulary
rule in `decision-core-architecture` and `effect-v4`, and the onion
generator in `decision-core-architecture/diagram/`. This project's config
predates the reference and differs in two places: Format may not import
Features here (stricter than the skill), and some rule messages differ.
When this project adds a rule that forecloses a recurring class of mistake,
lift it into the owning skill with its check in the same piece of work
(skill `gate-integrity`, "Lift the rule into its skill").

### Closed vocabularies

A closed vocabulary (clients, roles, windows, observation sources, commit
refusal reasons) is defined once as a named `as const` object in Domain
(`Clients`, `Roles`, `Windows`, ...). Its schema, struct keys and defaults
derive from that object, and no other file retypes the strings. A tag that
only one Format decoder knows lives in a constant at the top of that
decoder. Two rules in `eslint.rules.js` enforce this: `Schema.Literals` and
`Schema.Literal` in `src/` may not take inline literals, and no name in
`closedNames` may appear as a string literal outside the modules in
`canonicalModules`. The list has 25 names from seven constants: `Clients`
and `Roles` (`src/domain/clients.ts`, `roles.ts`), `WorktreeConditions`
(`src/domain/worktree.ts`), and `TreeEntryTypes`, `FileKinds`,
`AttributeSources` and `AttributeRefusalReasons`
(`src/domain/attributes.ts`). A new vocabulary adds its names to
`closedNames` and its module to `canonicalModules`. It also adds one line
per name to `lint-fixtures/src/features/bare-names.ts`, where
`test/lint/fixtures.test.ts` checks each name on its own line. A value
that would also be an ordinary word elsewhere, such as a git object type,
gets a distinctive Domain name. The outside token stays a constant in its
decoder.

## Dependency watch

`effect/workflow` and `effect/cluster` are `@stability unstable`. The
owner's ruling on design revision 4 (2026-11-15) keeps foreman's
hand-built log and recovery on SQLite instead of building on them; the
tripwire stays so the question can be reopened. `test/docs/stability-watch.test.ts`
fails when the installed effect's stability tags, module list or version
differ from `docs/stability-watch.json`. When it fails, update the JSON and
the entry in `docs/dependency-intake.md`, and tell the owner.

## Provenance

Ralph (MIT) was studied and none of it was copied. Write adapters independently and
record conceptual provenance. Waxwing is not a dependency or submodule.

## Documentation

Every exported declaration in `src/` has a TSDoc comment (`/** ... */`)
that says what it is or does, its units and edge cases where they matter,
and the design rule it implements. So does substantial private code: a
helper with a rule in it, though a one-line adapter needs none. File-level
`//` comments do not count. `test/docs/tsdoc.test.ts` fails on an exported
declaration without TSDoc; private code rests on review.

## Writing

American spelling. Run the humanizer skill on README prose. `bun run prose`
(part of `bun run check`) runs the tell linter in `tools/prose/` over every
Markdown file outside `docs/plans/`, and a blocking finding fails the check;
fix the wording rather than adding a keep entry.

<!-- agent-baseline:start v2 -->
## Agent baseline

These rules hold in every session and every subagent. They live here
because skills load only when they trigger, and this file is always read.
The agent-baseline skill installs this block; edit its source, not here.

- **Own every failure.** Name each failure you see in your report, then
  fix it or file it; "already broken" exempts nothing. A check that
  passes on a rerun is still a failure. Fix every instance of a pattern,
  not only the one pointed at. A limitation written down instead of fixed
  is a failure kept. A check is a floor: never loosen a tolerance, weaken
  an assertion or delete a test to get green (root-cause-debugging).
- **No escape hatches.** No lint-disable or type-checker suppression
  comments, no casts or non-null assertions to silence the compiler, no
  skipped or focused tests, no new allowlist entries, no edits to checks
  or configs to get green. Overriding a rule on your own judgment is
  worse than a mistake, however good the reason. If a rule blocks you,
  stop and report the line and the rule.
- **Take the stricter option in coding practice** without asking. Product
  decisions, such as a threshold, a default or behavior a user would
  notice, go to the human.
- **Evidence before claims.** Run the command that proves a claim before
  making it (verify-before-claiming).
- **Stage explicit paths,** never a directory, and leave the user's
  untracked files alone; they are the user's work in progress.
- **Never push, publish or file anything remotely without an explicit OK
  for that action.** One OK covers one action. If CI or deploys are
  billed, batch commits and wait to be asked (landing-a-branch).
- **If a tool call is denied, stop and quote the denial.** Never reach the
  same effect another way; that defeats the policy behind it. A message
  that only asks you to reshape a command is not a denial: follow it.
- **Brief every subagent as if it sees only this file and its brief.**
  Some harnesses pass memory or the conversation to a subagent and some
  do not; never rely on it. Rules a subagent needs go in this file or in
  its brief (dispatching-agents).
- **State the cost before expensive agent work,** and wait for a yes when
  it is large; the human pays for it. Answer status questions cheaply.
- **A finding is captured only when it has a durable record,** such as an
  issue; a chat message or an agent report is not one (decisions-as-issues).
- **No emoji,** anywhere. Use words such as PASS and FAIL.
<!-- agent-baseline:end -->
