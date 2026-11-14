# Agent supervisor decision and Claude handoff

2026-11-14. Research complete. Direction selected by the coordinator:
a small standalone TypeScript/Effect supervisor in a separate sibling
repository. No Ralph port, implementation, repository creation, real-agent
trial or phone delivery is approved. The user wants Claude to take over
implementation or further planning because Claude has the larger allowance.

## Decision

Use direct adapters to unmodified Claude Code and Codex clients. Keep the
first workflow sequential: Claude implementation, independent Codex review,
Claude correction as needed, then a human hold before the next large
tranche. One active operation and one target repository are enough initially.

Both alternatives require our code to own subscription pacing, allowance
reserve, human approval, durable checkpoints and uncertain-operation
recovery. Direct adapters add ownership of the short role cycle while
avoiding Ralph's additional configuration and persistent-loop lifecycle.
This is a scope judgment, not evidence that a replacement already works.

A supported Ralph integration remains viable: run one authorized tranche
per bounded public `ralph run`, and withhold the next launch until approval.
It saves dispatch and interaction machinery. However, pacing inside a run
still needs a validated hook integration, and interruption recovery remains
unestablished. Repeated one-iteration `--continue` calls are not an
established stepping API: counters are restored, and resumed work begins
through `task.resume`. Do not control production through internal markers.

The completed trial establishes neither that Ralph cannot work nor that
either candidate meets all requirements. Do not repeat that trial.

## Claude review of the decision (2026-11-14)

Claude resumed from the trial records and confirms the standalone
direction. No new investigation ran; the reasoning rests on recorded
evidence only.

- The parts Ralph would supply that actually matter here are the
  role cycle and fresh-process iteration. A sequential Claude, Codex,
  Claude cycle that starts each step as a fresh `claude -p` or
  `codex exec` invocation with a handoff file covers both.
- What remains in a Ralph integration conflicts with stated
  requirements. T5 shows that a generic resume releases a tranche
  completion hold while approval is pending (S7). T3 and T6 leave
  suspended-loop resume and interrupted-operation recovery unsupported
  (S6). Ralph's Telegram flow continues after an unanswered question
  times out, so a timer can stand in for human approval. T7 shows
  permission-bypass flags passed by default (N2).
- Using Ralph as one bounded `ralph run` per tranche avoids those
  paths, but it then contributes only the role dispatch, which is the
  smallest part of the supervisor, and it adds a second release cycle
  and configuration language.

Research on 2026-11-14 (two read-only Sonnet agents) and the user's
ruling on the phone channel are folded into the design:
[supervisor design](2026-11-14-agent-supervisor-design.md). The user
deferred the phone channel (S8) on 2026-11-14.

Reopen S10 if Ralph ships a supported resume for a suspended primary
loop and holds that are released per reason. Still open and owned by
the design: S3 (Claude quota acquisition before launch), S4 reserve
policy, S8 phone channel, and whether the Claude adapter uses the CLI
or the Agent SDK under subscription login.

## Requirement and evidence ledger

| ID | Status | Requirement, conclusion and next action |
|---|---|---|
| S1 | SELECTED DIRECTION | Standalone TS/Effect, sibling repository, independently written adapters; no copied Ralph code or port. Repository name/location await the next authorized step. |
| S2 | DOCUMENTED; LIVE UNVERIFIED | Claude `-p` and Codex `exec` support scripted execution. Use vendor-managed subscription login; no credential extraction. Validate explicit permissions, settings and billing mode later. |
| S3 | SHARED ACCEPTANCE GAP | Codex documents rate-limit reads. Claude's optional five-hour/seven-day statusline observations arrive after a response; a complete supported preflight snapshot was not established. Unknown/stale observations must hold launches. |
| S4 | PROPOSED CONTRACT | Pace launches against observed windows with allowance reserved for other work. A running agent can overshoot a launch-time allowance estimate; no hard reserve guarantee is established. Decide reserve and freshness policies before implementation. |
| S5 | PROPOSED CONTRACT | Renew context automatically through fresh invocations fed durable handoffs and a pinned repository revision. Process restart, transcript resume and fresh model context are distinct. Validate handoff sufficiency later. |
| S6 | PROPOSED CONTRACT | Persist operation identity and intent before execution, then evidence and outcome. Unknown mutating outcomes require reconciliation before replay. No exactly-once guarantee is claimed. |
| S7 | REQUIRED | Quota, tranche approval and uncertain-operation holds stay distinct. Timers and notification timeouts never grant human approval. Define approval scope and invalidation in the design. |
| S8 | OPEN CHOICE | Phone alerts required; provider unselected and delivery untested. Propose outbound alerts first with local approvals. Phone approvals need a separate identity/replay design. No message sending authorized. |
| S9 | REQUIRED | Pure decision core and no-logic facade; architecture below. No new scheduler or recovery algorithm approved. |
| S10 | DEFERRED | Ralph adoption: reopen if a supported integration demonstrably saves enough loop ownership while satisfying the specific recovery/control contract. No new trial is authorized here. |
| S11 | DEFERRED | Literal TS port: unnecessary scope and no reliable minimum port estimate. Reopen only for a demonstrated need and explicit approval. |
| S12 | OBSERVED LIMIT | Codex help/version reported 0.167.0 but warned that PATH aliases could not be created: Operation not permitted (os error 1). Local probing stopped; validate installation before later live use. Claude help reported 2.1.322. |

## Architecture and scope for the next design

Domain holds plain state, validated identifiers, observations and capability
types. Features makes pure decisions about role transitions, pacing,
freshness, approval scope and holds. Format purely decodes and serializes
provider events, handoffs and durable records. Runtime uses Effect for
processes, storage, clocks, repository reads and notification transport.
Program wires capabilities. The facade only converts plain data and calls
the assembled use cases; it makes no decisions. Persistent state belongs
to the shell, passed into and returned from the pure decision functions.

Keep provider formats and version changes behind concrete gateways. A
Codex app-server quota reader can coexist with a CLI execution adapter;
choosing that split is still design work. Do not add a generic orchestration
framework, parallel workflow graph, web UI or multi-user service initially.

Published components to evaluate in the design:

| Component | Source | Fidelity and open work |
|---|---|---|
| States and guarded transitions | W3C SCXML/statecharts | Adapt application states; no SCXML engine dependency proposed. Review the actual transition contract before approval. |
| Durable local records | SQLite transactions | Candidate only; storage/binding intake and recovery contract remain open. |
| Timed wakeups and read retries | Effect Schedule | Use published schedules; do not infer quota recovery from time alone. |
| Agent execution and observations | Vendor public CLI/app-server protocols | Validate installed versions and optional fields. No private endpoint scraping. |
| Phone alerts | Selected provider's HTTP API | Provider selection, intake and authorized delivery test still required. |

Effect and its platform packages need exact compatible pins and a lockfile
when dependency installation is approved. Direct adapters still couple us
to both vendor clients; removing Ralph does not remove that maintenance.
No dependency, license bundle or transitive audit was completed here.

## Instructions for Claude

Read this document and the two completed trial records first:

- `docs/plans/2026-11-14-ralph-trial-checkpoint.md`
- `docs/plans/2026-11-14-ralph-trial-results.md`

The earlier `2026-11-14-agent-supervisor-fit.md` is historical; its
recommendation to trial Ralph has been fulfilled. Waxwing checker work is
outside this task. Preserve all existing changes in this checkout.

Next, finish a short design for the sibling tool. Resolve Claude quota
observation acquisition and staleness, reserve policy, permissions, tranche
scope, checkpoint/reconciliation semantics and phone channel. State which
requirements remain unverified. Review the proposed transition/recovery
procedure adversarially before seeking design approval; no correctness
claim follows from this decision record. Then prepare an implementation
plan only after design approval. Obtain implementation authorization before
creating the sibling repository, installing dependencies or building.

Use the user's decision-core architecture in that repository. Carry its
rules into its own instruction file; do not make Waxwing a dependency or
submodule. Implement independently and record conceptual provenance.

Suggested invocation for the next session:

> Read docs/plans/2026-11-14-agent-supervisor-decision.md and its linked
> trial records. Continue the standalone supervisor design for a sibling
> TypeScript/Effect repository. Do not repeat the Ralph trial or work on
> Waxwing's checker. No implementation is approved yet.

No implementation estimate is validated. The direct-adapter investigator
estimated several engineering days for bounded validation and one to a few
weeks for a usable local supervisor, excluding unresolved telemetry work.
Treat those as rough planning judgments, not a commitment. Keep future
investigations bounded and use Claude's larger subscription for the next
planning/implementation tranche, as requested by the user.

## Evidence and provenance

Two fresh-context gpt-6.1-sol agents, high reasoning, returned read-only
reports: `ralph_supported_fit` and `direct_supervisor_fit`. No trial replay,
provider-agent execution, installation or external messages occurred.
The coordinator checked the key Ralph continuation/termination and Telegram
timeout source,
and opened the official provider documentation below.

Ralph source paths are relative to the retained, read-only
`/tmp/ralph-trial.OPhZe8/ralph-e2e-2.12.0`:

- `crates/ralph-cli/src/loop_runner.rs:205-265`: fresh scratchpad clearing
  and restored loop state.
- `crates/ralph-core/src/event_loop/mod.rs:701-721,938-1044`: termination
  counts and resumed event initialization; latter inspected by investigator.
- `crates/ralph-cli/src/loops.rs:918-963`: generic public resume request.
- `docs/guide/telegram.md:73-83`: unanswered question timeout continues.
- Other retained runtime observations remain in the completed trial results.

Primary documentation inspected on 2026-11-14; live pages may drift from
installed clients. Documentation is capability evidence, not a live test.

[Ralph public CLI](https://mikeyobrien.github.io/ralph-orchestrator/guide/cli-reference/)

[Ralph hook configuration](https://mikeyobrien.github.io/ralph-orchestrator/guide/configuration/)

[Ralph pinned source](https://github.com/mikeyobrien/ralph-orchestrator/tree/v2.12.0)

[Claude scripted execution](https://code.claude.com/docs/en/headless)

[Claude quota observations](https://code.claude.com/docs/en/statusline)

[Claude rate-limit events](https://code.claude.com/docs/en/agent-sdk/typescript)

[Codex quota read protocol](https://learn.chatgpt.com/docs/app-server)

[Codex scripted execution](https://learn.chatgpt.com/docs/non-interactive-mode)

[Statecharts](https://www.w3.org/TR/scxml/)

[SQLite transactions](https://www.sqlite.org/transactional.html)

[Effect Schedule](https://effect.website/docs/v3/scheduling/introduction)

The investigator encountered an incorrect OpenAI authentication URL (404)
and an AWS article page shell. Neither supports a conclusion here. No denied
tool call was bypassed. The completed trial's earlier cleanup-audit denial
remains unresolved; do not claim absence of detached children.
