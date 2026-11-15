# Foreman: agent instructions

Foreman is a small personal supervisor. It drives unmodified Claude Code
and Codex clients through tranches of work on one target repository:
Claude implements, Codex reviews, Claude corrects, and the user approves
before the next tranche. It paces launches against the user's
subscription windows, renews context with every step, and keeps durable
checkpoints.

Status (2026-11-14): the design is in revision and not yet approved. The
owner approved a first code slice only: project setup, Domain types,
Format decoders and the pure pacing function (provisional until the
design is approved). Runtime, process control, git handling,
permissions, storage and recovery code are not approved. `bun run check`
(tsc and ESLint) and `bun run test` must pass before any commit.

Pending live tests that must update code when they run: L1 (Claude
usage reading and `rate_limit_event` shape: update `src/format/claude.ts`),
L2 (Codex usage windows: add the Codex windows to the default policy in
`src/domain/policy.ts`; until then every Codex launch needs a waiver),
L3 (permissions), L4 (crash and restart).

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
`Schema.Literal` in `src/` may not take inline literals, and the strings
"claude", "codex", "implementer", "reviewer" and "corrector" may not appear
as string literals outside `src/domain/clients.ts` and
`src/domain/roles.ts`. A new vocabulary adds its names to that list.

## Dependency watch

`effect/workflow` and `effect/cluster` are `@stability unstable`; the owner
accepted building on them on 2026-11-15. `test/docs/stability-watch.test.ts`
fails when the installed effect's stability tags, module list or version
differ from `docs/stability-watch.json`. When it fails, update the JSON and
the entry in `docs/dependency-intake.md`, and tell the owner.

## Provenance

Ralph (MIT) was studied and none of it was copied. Write adapters independently and
record conceptual provenance. Waxwing is not a dependency or submodule.

## Writing

American spelling. Run the humanizer skill on README prose.

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
