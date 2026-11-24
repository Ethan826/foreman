# Dogfood-3b: configured check commands

## Task

The editing profile allows the implementer no command that runs code,
so it cannot run tsc, ESLint, the prose gate or the tests, and two of
dogfood-2's three rounds went on rules it could not check. The owner
ruled (2026-11-22) that no such command is allowed until a commit guard
exists and a C4 rerun shows it holds. Dogfood-3a built the guard; the
rerun on 2026-11-24 showed it holds (`research/live/l3-subset/results.md`,
second section: `git commit`, `git update-ref`, `git hash-object -w` and
writes to the index and HEAD all fail inside the Bash sandbox). This
task lets the owner's configuration name exact check commands that the
profile then allows.

### Owner rulings for this task (do not reopen)

1. The configuration may name check commands; none is allowed unless
   the configuration names it (dogfood-3 task review, 2026-11-23).
2. The check commands do not join the target binding: changing them is
   not a `TargetMismatch` (same review).
3. A refused check command is caught when the configuration is decoded,
   so every command fails at once with `ConfigUndecodable`; the profile
   keeps its own check as a second guard (owner, 2026-11-24).
4. A launch refused for a check command is a refusal: it expires armed
   waivers, as `ProfilePathUnsafe` does (owner, 2026-11-24).
5. The test changes listed under "Authorized test changes" are approved,
   and no others.

### What a check command grants (read this)

An exact `Bash(<command>)` rule limits the command line the agent may
type, not what runs. `bun run verify` runs the `verify` script in
`package.json`, the ESLint configuration and rules, `tools/prose/`, the
test files and `node_modules`, all of which the agent can edit. So a
check command that runs repository code gives the agent arbitrary code
execution inside the Bash sandbox. The guard is the sandbox: both git
directories and the top-level protected names are write-denied, the
network is closed and unsandboxed commands are refused. The refusal of
`git` and `curl` below guards against an owner's typo; it is not a
boundary. Reads are not confined, protected names below the top level
are denied to the Edit tool but not to the sandbox, and ignored paths
(`node_modules`, `site`, `.build`) never reach review. None of this
changes in this task; it is stated so that no comment or document
claims more.

### Behaviour wanted

1. **Configuration.** `src/format/foreman-config.ts` decodes an optional
   `checkCommands`, a list of strings. Each entry is one command as the
   agent would type it: non-empty, at most 200 characters, made only of
   letters, digits, space and `._/:=@+-`, with no leading or trailing
   space and no doubled space. An entry that is `git`, starts with
   `git `, is `curl` or starts with `curl ` is refused, as are duplicate
   entries. Every refusal fails decoding with `ConfigUndecodable` whose
   `reason` names the offending entry (use a custom check where Schema's
   built-in message would not name it). An absent key means no check
   commands. `ForemanConfig` gains `checkCommands: ReadonlyArray<string>`
   (empty when absent). It is not written to the target binding
   (`src/format/target-binding.ts`) and is not compared by the binding
   checks.
2. **Session settings.** `SessionSettings`
   (`src/program/session-context.ts`) gains `checkCommands`, set from
   the configuration in `src/program/production.ts`. `implement` and
   `correct` take the list from `context.settings.checkCommands` and
   pass the same list to the profile and to the brief, so the two
   cannot differ.
3. **Profile.** `claudeEditingSettings` (`src/format/claude-settings.ts`)
   becomes `(identity, checkCommands)` and adds one exact rule
   `Bash(<command>)` per check command, in configuration order, right
   after the `git diff` rules. No `<command> *` form. With an empty list
   the rendered bytes are exactly today's. It refuses, before anything
   else, a command that decoding would refuse, with a new tagged error
   `CheckCommandRefused { command }`; when a path is also unsafe,
   `ProfilePathUnsafe` wins. `PublishClaudeProfile`
   (`src/program/claude-profile.ts`) becomes `(identity, checkCommands)`
   and its error type gains `CheckCommandRefused`. Classify the new tag
   as a refusal: add it to `LaunchPlan` in `src/program/implement.ts`,
   to `CorrectFailure` in `src/program/correct.ts`, to `AttemptStop` and
   to the exhaustive `isRefusal` match and its TSDoc list in
   `src/program/waiver-expiry.ts`.
4. **Briefs.** `implementBrief` and `correctBrief`
   (`src/format/brief.ts`) take `checkCommands` as a required input
   field. When it is non-empty, the "What to do" section's body ends
   with a blank line and then exactly one unwrapped line:
   ``You may run these check commands with the Bash tool, each exactly as written: `a`, `b`. They run in the Bash sandbox, with no network and the git directories read-only; give the Bash tool a timeout of 600000 ms.``
   (the commands in configuration order, each in backticks, joined by
   `, `). With an empty list the brief bytes are exactly today's. The
   review brief is unchanged.
5. **status.** `ProductionStatusReport`
   (`src/program/production-status.ts`) gains `checkCommands` from the
   decoded configuration. `StateMissing` and `StatusReport` are
   unchanged.
6. **The L3 package.** Update the four `claudeEditingSettings` calls in
   `research/live/l3-subset/profile.sh` (about line 36) and
   `research/live/l3-subset/test-scripts.sh` (about lines 1018, 1094 and
   1581) to pass an empty list. They run under `bun -e`, outside tsc and
   outside `bun run verify`, so nothing else will tell you they broke.

### Authorized test changes (and no others)

- (a) `test/format/foreman-config.test.ts`, "decodes every field": the
  expected decoded object gains `checkCommands`.
- (b) Call sites and fixtures forced by the new `claudeEditingSettings`,
  `PublishClaudeProfile`, `implementBrief`/`correctBrief` inputs and
  `SessionSettings`, each passing an empty list so every existing
  expected value stays as it is: `test/format/brief.test.ts`,
  `test/format/claude-settings.test.ts`,
  `test/program/assisted-cycle.test.ts`,
  `test/program/attempt-protocol.test.ts`,
  `test/program/session-harness.ts`,
  `test/program/waiver-refusals.test.ts`,
  `test/program/production-profile.test.ts`, and any other test whose
  only change is passing an empty list to these signatures (list each in
  the handoff).
- (c) The existing byte pins stay as they are and must pass unchanged:
  the `implementBrief`/`correctBrief` `toBe` cases in
  `test/format/brief.test.ts`.

### Steps

1. Read `AGENTS.md` first and follow it (layering, Effect v4, TSDoc,
   closed vocabularies). The skills it names are not available in this
   session; follow the surrounding files. Do not edit `AGENTS.md` or
   `CLAUDE.md`: the profile denies them. Report in the handoff any
   sentence there that this change makes stale.
2. Write new tests first:
   - decoding accepts a valid list and an absent key, and refuses each
     malformed entry (empty, longer than 200, a forbidden character,
     leading, trailing or doubled space, a duplicate, `git`, `git log`,
     `curl`, `curl x`), each with a `reason` naming the entry;
   - `claudeEditingSettings(identity, [])` equals
     `Formatter.formatJson(<a literal object equal to
     production-profile's expectedProfile>, { space: 2 }) + "\n"`
     (a byte pin of today's profile), and with two commands carries
     exactly two `Bash(...)` rules in order right after the `git diff`
     rules; `CheckCommandRefused` for `git commit` and `curl x` when
     called directly, and `ProfilePathUnsafe` when both are wrong;
   - the briefs with and without check commands (the line's exact
     bytes and position);
   - a launch refused for `CheckCommandRefused` expires armed waivers;
   - a changed `checkCommands` is not a `TargetMismatch`, in
     `test/program/production-binding.test.ts` with
     `configOf(layout, { checkCommands: [...] })`;
   - `status` lists the configured commands.
3. Update the documentation, keeping additions short and plain (the
   prose gate runs in verify and you cannot run it): the
   `claude-settings.ts` header comment (it says the template allows no
   target test command), `src/format/README.md`, `src/program/README.md`
   (also its stale sentence that the rerun "is pending", and the README
   sentence about classifying new failures), `src/facade/README.md`
   (its status output lists five fields; there are now six), the
   comment at `research/live/l3-subset/test-scripts.sh` about line 1008
   and `research/live/l3-subset/plan.md` about line 209 (both say
   production allows no target test command).

### Rules

- Do not delete, skip, rename or loosen any existing test or assertion
  except as authorized above.
- Use the Effect modules, never native array or string methods, in
  source and tests; give an arrow that calls a void function a block
  body; keep callback nesting within three levels (extract named test
  bodies).
- No lint-disable comments, no type casts, no non-null assertions, no
  changes to lint configuration, check scripts, `package.json`,
  `bun.lock` or CI.
- Do not commit, and do not run `git` commands other than `git status`
  and `git diff`. This session cannot run `bun`; the owner runs `bun run
  verify` and `bash research/live/l3-subset/test-scripts.sh <absolute
  scratch dir>` (bash, not sh) after your step. The configuration that
  names `bun run verify` as a check command is set only after this
  cycle lands.

### Done when

- the behaviour above holds and is tested;
- `bun run verify` and the L3 script tests pass, run by the owner.

End with a handoff that lists every file you changed or added, the new
types and where they are registered, the tests you added and what each
shows, each authorized test change you made, any stale sentence in
`AGENTS.md`, and anything you were unsure about.
