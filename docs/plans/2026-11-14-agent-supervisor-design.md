# Agent supervisor: short design

2026-11-14. Status: DRAFT for the user's approval. No repository,
dependency install, build, live model call or message send is approved.
Decision record: [standalone direction](2026-11-14-agent-supervisor-decision.md).
Ledger IDs S1-S12 refer to that record.

## Scope

One supervisor process on the user's Mac drives one target repository
through tranches. A tranche is a unit of work the user names, written as
a task file in the target repository. Inside a tranche the cycle is:

1. Claude implements (fresh `claude -p` process).
2. Codex reviews (fresh `codex exec`, read-only sandbox).
3. If the review asks for changes, Claude corrects, then Codex reviews
   again, at most `maxCorrectionRounds` times (default 2).
4. The tranche ends in an approval hold. Nothing further runs until the
   user approves the next tranche.

One operation runs at a time. No parallel graph, web UI, multi-user
service or phone channel in the first version.

## Research results used here

Two read-only agents read vendor docs and the installed `--help` output
on 2026-11-14 (Claude Code 2.1.325, Codex 0.167.0). The coordinator
checked the quotes marked (checked) against the fetched pages.

| ID | Result | Evidence |
|---|---|---|
| E1 | Using the unmodified Claude Code binary with one's own subscription login is permitted; Anthropic restricts third-party products that offer or route Claude.ai login, including Agent SDK products. | code.claude.com/docs/en/legal-and-compliance (checked). Personal-automation wording is not explicit; OpenAI's terms were not read. |
| E2 | Claude has no documented usage read that is guaranteed not to start a model turn. Statusline input carries `rate_limits.five_hour` and `seven_day` (`used_percentage`, `resets_at`) after responses; stream-json carries `rate_limit_event`. | statusline doc (fields checked); agent SDK TypeScript reference. |
| E3 | `/usage` sent as a prompt returns a structured `usage_report` (experimental shape) only with a login carrying profile scope; a `setup-token` credential does not qualify by default. Whether it spends allowance is undocumented. | agent SDK TypeScript reference (checked). |
| E4 | Codex app-server documents `account/rateLimits/read` (used percent, window length, reset time) as an account method separate from turns. Not run. | learn.chatgpt.com/docs/app-server (method checked). |
| E5 | Claude `-p` defaults to manual mode, denying unapproved actions; `dontAsk`, `--permission-prompts none`, allow/deny rules and an OS sandbox with `failIfUnavailable` are documented. Codex documents `--sandbox read-only / workspace-write` and approval policy `never`. | permission-modes and sandboxing docs (checked); Codex approvals doc. |
| E6 | Exit codes do not distinguish rate-limit exhaustion on either CLI. Classification must use result subtype, error fields and rate-limit events. | headless doc; Codex non-interactive doc. |

## Architecture (S9)

- **Domain:** identifiers (`TrancheId`, `OpId`, `Revision`), steps,
  outcomes, observations, holds, events. Plain data.
- **Features:** one pure function `decide(state, event) -> (state,
  commands)` plus the pure pacing and classification functions below.
  Total over every state and event.
- **Format:** decoders for Claude stream-json and Codex JSONL, the
  handoff file, and the stored event records.
- **Runtime (Effect):** process launch, SQLite event store, clock, git
  reads and commits, the notifier (a log notifier in the first version).
- **Program:** wires capabilities into use cases.
- **Facade:** CLI commands `status`, `approve`, `reconcile`, `waive`,
  `run`. Converts input to events; makes no decisions.

State is a fold over an append-only event log in SQLite. Commands are
executed by the shell, and their results come back as events.

## Holds (S7)

A launch is allowed only when the hold set is empty. Each hold names one
reason, and only its own release event removes it.

| Hold | Created by | Released only by |
|---|---|---|
| `Approval(tranche, revision)` | tranche cycle finished | `Approved(tranche, revision)` from the CLI with both fields matching the hold |
| `Quota(provider, reason)` | pacing says Hold or Unknown before a launch, or a rate-limit outcome | a fresh observation that pacing allows, or `Waived(provider, opId)` from the CLI for one launch |
| `Uncertain(opId)` | startup finds an intent without an outcome | `Reconciled(opId, resolution)` from the CLI |
| `Failure(opId, class)` | a classified failure other than rate limit | `Released(opId)` from the CLI |

Clock ticks and notifier timeouts never release any hold. An approval
for one tranche and revision does not release a hold for another.
Before each launch the shell reads HEAD; if it differs from the revision
the state expects, the launch is refused and a `Failure(drift)` hold is
created.

## Pacing (S3, S4)

`pace(observations, now, policy, provider, estimate) -> Allow | Hold |
Unknown`, pure.

- An observation is `{provider, window, usedPercent, resetsAt,
  observedAt, source}`.
- A window's reading is usable when `now - observedAt <= freshness`
  (default 10 minutes) and `now < resetsAt`. After `resetsAt` the reading
  says nothing about current usage, because the user's other work may
  have started a new window.
- Allow iff every known window of the provider has a usable reading
  with `usedPercent + estimate <= 100 - reserve(window)`. Hold if any
  usable reading fails that test. Unknown if any window lacks a usable
  reading.
- `estimate` is the largest observed increase for that role over the
  last five steps, or `initialEstimate` (default 15 points) with no
  history. A running agent can still overshoot; there is no hard reserve
  guarantee.
- Defaults to confirm: reserve 30 percent of the five-hour window and
  40 percent of the weekly window, for each provider.

Observation sources:

- **Codex:** `account/rateLimits/read` through a short-lived app-server
  process before each Codex launch (E4), pending the live test L2.
- **Claude:** (a) `rate_limit_event` from the supervisor's own stream-json
  output; (b) an opt-in line added to the user's statusline script that
  appends `rate_limits` to an observation file each time any interactive
  session responds; (c) `/usage` as a prompt, only if live test L1 shows it
  spends nothing.

Because Claude has no confirmed preflight read (E2), the first Claude
launch after a quiet period may be Unknown. The supervisor then holds,
and the user can `waive` one launch. Unknown never becomes Allow by
waiting.

## Operations, checkpoints and recovery (S5, S6)

For each step:

1. Append `Intended(opId, tranche, step, baseRevision)` and commit the
   transaction.
2. Launch a fresh process. Its inputs are the task file, the previous
   step's handoff file and the working tree at `baseRevision`. No
   `--resume` or `--continue`; context renews with every step.
3. On exit, classify the result (below) and append `Finished(opId,
   class, evidence)`.
4. For a successful implement or correct step, the shell commits the
   working tree with an `Op-Id: <opId>` trailer and appends
   `Committed(opId, revision)`. The next step's base is that revision.

On startup, any `Intended` without `Finished` creates `Uncertain(opId)`.
A `Finished` success without `Committed` also creates `Uncertain(opId)`;
the shell may show the commit carrying that `Op-Id` as evidence, but it
does not resolve the hold itself. `reconcile` offers three resolutions:
`discard` (reset the tree to `baseRevision`, then run the step again under
a new opId), `accept(revision)` (the user records the revision as the
step's result), or `abandon` (end the tranche in an approval hold).
Review steps run read-only; the first version still holds them for
reconciliation rather than replaying them automatically. No
exactly-once claim.

Classification (no catch-all into retry): `success`, `changesRequested`
(review), `rateLimited` -> Quota hold, `authFailed`, `permissionDenied`,
`maxTurns`, `crashed(signal)`, `unclassified` -> Failure hold. A review
round count above `maxCorrectionRounds` is `notConverged` -> Failure hold.

## Permissions (N2)

- Claude implement and correct: `--permission-mode dontAsk
  --permission-prompts none`, allow `Read`, `Edit`, the target's test
  commands, `git status` and `git diff`; deny `git push`, `git commit`
  (the shell commits), web tools and `curl`; sandbox enabled with
  `failIfUnavailable: true`, `allowUnsandboxedCommands: false`, no
  allowed domains. The sandbox covers only Bash; the Edit and Read tools
  rely on permission rules.
- Codex review: `codex exec --sandbox read-only -c approval_policy="never"`.
- No bypass flag anywhere. The installed versions are pinned, and the
  supervisor refuses to start when they differ.

## Alerts (S8)

Deferred by the user on 2026-11-14. The notifier is an injected
capability; the first implementation writes to the supervisor's log and
`status`. Holds are visible through `status`. Notes for later: Pushover
fits alerts only; Telegram is the only researched channel with tap
replies that identify the sender, if phone approval is wanted.

## Claims ledger

| ID | Claim | Backing |
|---|---|---|
| C1 | No launch happens while any hold exists. | Bounded model check M (below). |
| C2 | An approval hold is released only by an approval naming the same tranche and revision. | M. |
| C3 | Ticks never release a hold and never turn Unknown into Allow. | M; pacing unit tests later. |
| C4 | Every launch is preceded by a durable intent; a crash between intent and outcome produces an Uncertain hold and no automatic relaunch. | M models crash and restart at every point. |
| C5 | At most one operation is in flight. | M. |
| C6 | A tranche cannot run more than `maxCorrectionRounds` corrections. | M. |
| C7 | The reserve bounds launches, not usage: a launch is allowed only if the estimate fits under the reserve. | Argument, not yet checked against live data; overshoot is possible by design. |
| C8 | Fresh processes give fresh model context. | Argument from E5 and the docs: no `--resume`. Handoff sufficiency is unverified. |
| C9 | The permission settings prevent pushes and network use by the agents. | Argument from docs only; live test L3 required. |

Model check M is `research/model/check.py`: exhaustive search over the
reachable states of a model of these rules, with a monitor that checks
C1-C6 from the event trace. Grammar and bounds are fixed in its header.
Run 1 timed out because the monitor's correction counter was unbounded;
amendment 1 counts change-requesting reviews instead (labelled in the
file). Run 2: 24,651 states, 1,824 launch transitions, no violations.
Bounded evidence only. The mutation test that shows the monitor catches
planted defects has not run, so the clean result is not yet confirmed.

## Restrictions table

| Restriction | Why believed harmless | Challenge example |
|---|---|---|
| One operation in flight | The workflow is sequential | The user wants a review of tranche N while N+1 is implemented; refused by design |
| Observation unusable after `resetsAt` | The user's other work may start a new window | Supervisor idles overnight; every first launch needs a waiver or a fresh observation |
| Estimate from last five increases | Steps of one role are similar in cost | A large tranche after small ones overshoots the reserve |
| Read-only review still needs reconciliation | Simplicity in the first version | A crash during a review always waits for the user, though replay would be safe |
| HEAD drift is a failure | The user may commit during a run | The user fixes a typo mid-tranche; the run stops until released |
| Shell commits, agents cannot | Gives each step a revision and Op-Id | An agent that needs history rewriting cannot do it |

## Live tests needed before relying on the design

Each needs separate approval because it spends allowance or uses a login.

- **L1:** `claude -p "/usage" --output-format json` under the subscription
  login. Does it return `usage_report`, and do the usage bars move?
- **L2:** `account/rateLimits/read` through `codex app-server`: window
  shapes for the user's plan, and whether a turn is started.
- **L3:** one implement step on a disposable repository under the
  permission settings above: a push attempt and a network fetch are both
  denied, and the sandbox starts.
- **L4:** one full cycle on a disposable repository, killed at each step
  boundary, checking that restart produces the expected holds.

## Open items

- Confirm the reserve, freshness and `initialEstimate` defaults.
- Repository name and location for the sibling (S1).
- Whether to add the statusline observation line (source b).
- Dependency intake for Effect, its platform packages and a SQLite
  binding when installation is approved. The user chose Effect v4 on
  2026-11-14; an Effect v4 skill is being written for the skills
  repository.
