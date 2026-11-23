# Proposal: a check step foreman runs itself (awaiting owner approval)

Status: proposal, 2026-11-23. Not authorized. Written at the owner's
request so the idea has a durable record; it comes after dogfood-3b at
the earliest.

## The gap

The design gives the target's test commands one place to run: inside
the implementing agent's Bash sandbox, as allowed commands
([design](2026-11-14-agent-supervisor-design.md), "Permissions"; dogfood-3b's
`checkCommands`). Some checks cannot run there:

- the L3 package's offline tests (`research/live/l3-subset/test-scripts.sh`)
  write outside the worktree, run a listener on 127.0.0.1:47613 and nest
  `sandbox-exec`, each of which the editing sandbox denies;
- any check that needs a service, a port, a cache outside the worktree
  or the network;
- checks whose result the agent should not be able to influence or
  misreport.

Today these run out of band by hand: the owner's
`~/.config/foreman/check.sh`, and the coordinator running the L3 tests
and `bun run verify` between steps. Their results reach the reviewer
only through the owner's findings file, if at all (dogfood-2 lessons in
the [assisted-cycle plan](2026-11-19-assisted-cycle-plan.md)).

## Proposal

A `check` step that foreman runs itself, with no model client:

1. **When.** After a usable `implement` or `correct` and before
   `review`. It launches no agent client, so admission and pacing do not
   apply; it holds the project's operation lock like any step.
2. **On what.** The candidate snapshot tree foreman already takes for
   review (`snapshot.ts`), materialized in a disposable check directory
   under the state directory: a detached linked worktree at a commit
   built from the tree (`git commit-tree`, never on a branch), or a
   `git read-tree` plus `checkout-index` export with no git directory at
   all. The second is preferred: checks then cannot reach the common git
   directory. Either way, results depend only on the reviewed tree, not
   on anything the agent left outside it.
3. **What runs.** An ordered list of owner-configured commands, recorded
   in the target binding beside the attribute allowance, so a changed
   list is a `TargetMismatch`, not a silent change. The agent cannot
   alter the list; it can alter the code the commands run, which is the
   point and the risk (below).
4. **Profile.** Each command runs under a check profile of its own: a
   `sandbox-exec` profile (Apple Seatbelt, as the Bash sandbox uses on
   macOS) that allows writes to the check directory and one scratch
   directory, and, per command and only if the owner grants it, loopback
   network and nested `sandbox-exec`. It denies writes to the owner's
   checkout, the supervisor worktree, both git directories, the state
   directory and the ledger, and denies other network. The environment
   is foreman's clean one minus `GIT_*`, with `HOME` in the scratch
   directory. A wall-clock limit per command, enforced by the
   process-group containment the design specifies for clients (tasks
   B14 and B15 of the implementation plan, not built yet; until then the
   step depends on them or on an external `gtimeout`).
5. **Evidence.** Each command's argv, exit status, duration, stdout and
   stderr are published as state files with their SHA-256 in the log, as
   attempt reports are. A `CheckRecorded` event per command.
6. **Use.** The review brief and the next correction brief state each
   command and its outcome, with the output's tail, so the reviewer
   judges against recorded results rather than the implementer's claims.
   A failed check does not refuse `review` (the reviewer should see it).
   A check that could not run (profile refused, timeout, crash of the
   runner) is its own hold, distinct from quota, approval and failure,
   as the design requires of holds.
7. **Owner commands.** `check [--attest]` runs the step by hand;
   `session close --finished` requires a passing check on the reviewed
   tree when the target lists any check command.

## Alternatives

| Option | What it gives | Cost |
|---|---|---|
| A. In-sandbox only (dogfood-3b, status quo after it) | Agent iterates on its own checks | Checks the sandbox denies stay manual; results are the agent's report |
| B. This proposal: supervisor-run check step | Recorded results in the review brief; checks needing more rights | A new step, profile and live test; runs agent-written code with more rights than the agent had |
| C. Owner-run checks recorded by foreman (`check --record <file>` attaches the owner's output) | Durable record of manual checks; no new execution surface | Still manual; foreman cannot vouch for what ran |

A and B combine: the agent keeps its in-sandbox checks for iteration,
and the check step is the record the reviewer and the close rely on. C
is a cheap interim step if B waits.

## Risk

The step executes code the agent wrote, with rights the agent did not
have. Whatever the check profile grants, an agent can reach by writing
a test that does it. So:

- the profile grants only what the owner approves per target, and each
  grant is named in the binding;
- the check directory holds no git directory (option of step 2), so no
  check can commit, move a ref or change config;
- a live L3-style case must show the profile holds against a hostile
  test file: writes outside the scratch directory, the git directories,
  non-loopback network and escape from the process group all refused,
  judged by the fact/source/counterexample/blind-spot rule.

## Components and provenance

Published: Apple Seatbelt (`sandbox-exec`) profiles, as Claude Code's
Bash sandbox uses them; `git read-tree`, `checkout-index` and
`commit-tree` (git documentation); POSIX process groups as the design
uses them (B14, B15, not built); foreman's existing state-file
publication and event log. Invented, and to be
reviewed as such: the check profile's rule set, the hold for a check
that could not run, and the rule tying `close --finished` to a passing
check.

## Open questions for the owner

1. Approve B (with A), C as an interim, or neither for now?
2. Does a failed check block `close --finished`, or only inform it?
3. Is `HOME` in the scratch directory acceptable for checks that need
   the owner's toolchain caches (bun's install cache, for example), or
   do some commands need a read-only grant to those caches?
4. Should the L3 package's offline tests be the first configured check,
   making the package developable through foreman?

## Sizing

Rough: one design revision (profile, events, holds, brief changes), a
Domain and Features slice, a Runtime slice for the profile and
export, a live case for the profile, then a dogfood cycle that uses it.
Comparable to dogfood-3a plus its L3 rerun.
