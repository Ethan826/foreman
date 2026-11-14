# Agent supervisor: fit assessment

Follow-up: the authorized Ralph trial is recorded in
[trial results](2026-11-14-ralph-trial-results.md). This assessment preserves
the earlier documentation findings; the runtime record qualifies them.

2026-11-14. Local research, not an implementation approval. Read primary
documentation and Ralph's configuration source; installed and ran none of
the candidates. Capability claims below are documented, not verified live.
This record belongs to the proposed standalone tool, stored here pending
its own repository. Waxwing's checker work and holds are unchanged.

Recommendation: test Ralph as the execution engine before building a new
orchestrator. If it passes, build a small Effect supervisor for subscription
pacing and tranche approvals. Reusability alone does not justify replacing
an existing implementation/review loop. No complete match was established
in this bounded pass.

## Requirements and findings

The user wants Claude implementation with independent OpenAI review,
weekly pacing with room for other usage, automatic context renewal,
durable recovery, and phone alerts. Work proceeds within an authorized
tranche, then waits for the user's next approval. The preferred architecture
has pure Domain/Features decisions under a technology shell, using Effect
for execution. The proposed tool gets a separate sibling repository,
without a Waxwing submodule; that placement remains a recommendation.

| Requirement | ccx-loop | Ralph Orchestrator | AgentsInTheCloud |
|---|---|---|---|
| Claude/Codex review cycle | Documented directly [C1] | Backend per role is supported; exact fixed-role cycle needs a trial [R1], [R2] | Evaluating agent work is a stated goal; exact cycle unverified [A1] |
| Subscription pacing and automatic wakeup | Not established; dollar caps are different [C2] | Not established; reviewed configuration has dollar limits [R2] | Usage windows and elapsed-time pacing documented; automatic execution gating unverified [A2] |
| Fresh context and crash recovery | Fresh subprocess mode documented; conductor replacement remains an open question [C2] | Persistent task state and resume documented; safe recovery needs a trial [R1], [R3] | Agent steering documented; checkpoint-to-fresh-context behavior unverified [A2] |
| Stop for human approval | Task approval and blocked states documented; tranche-wide stop unverified [C2] | Completion gates and blocking Telegram questions documented; tranche policy needs configuration and a trial [R4], [R5] | Tranche boundary enforcement unverified [A2] |
| Phone alerts | Discord bridge [C1] | Telegram interaction [R5] | Phone alerts not established in reviewed material |
| Deployment and architecture | Claude plugin with an agent-directed supervisor [C2] | Rust CLI with hooks; a separate Effect wrapper could keep our decisions pure [R1], [R2], [R4] | Dedicated Linux server installation; too broad for the proposed local CLI [A1] |

## Findings ledger

| ID | Status | Finding and next action |
|---|---|---|
| F1 | PROPOSED | Trial Ralph first: it combines role backends, hooks, resume, and phone interaction. These interfaces make it a candidate, not an adopted dependency. |
| F2 | PROPOSED | Keep subscription policy outside the agent. No examined candidate establishes the full pacing, reserve, pause, and automatic-resume requirement. |
| F3 | PROPOSED | ccx-loop is a close loop match, but its documented conductor cap does not reach delegated turns [C2]. Do not treat that cap as a quota controller. |
| F4 | PROPOSED | AgentsInTheCloud is a useful reference for quota observations, but dedicated-server deployment does not fit the proposed first version [A1], [A2]. |
| F5 | PROPOSED | Prefer a reusable pacing/approval supervisor if existing execution machinery fits. A full replacement orchestrator needs evidence that wrapping fails. |
| F6 | PROPOSED | Ralph's cost guide still invokes a Python program, unlike its Rust CLI [R1], [R6]. Validate commands against the selected release. |
| F7 | LOCAL | Source retrieval was incomplete: ccx's Claude companion fetch returned a cache miss, and its presumed Codex companion path returned 404. Source-level companion behavior is unverified. AgentsInTheCloud uses lowercase readme.md; the initial uppercase path returned 404. Corrected source is A1. |

## Proposed next experiment

One disposable repository, fake agent executables, and simulated quota
observations. No Waxwing edits or paid model calls. This experiment has not
started; installation and dependency intake remain for the next step.

Test fixed Claude/Codex roles; stop before a turn when allowance is low;
resume when permitted; checkpoint and restart with fresh context; and
recover after interruption without duplicating an agent operation whose
outcome is unknown. Test a tranche ending and waiting for explicit user
approval. Confirm that a timed-out human question never grants approval.
Phone delivery needs a separately selected channel and a live delivery test.

Ralph's pre-iteration hook is a possible integration point [R4]. It does
not establish control over spending inside an agent turn or its subagents.
The trial must identify those limits. Unknown or stale quota observations
must leave the run paused. A clock wakeup must not release a tranche hold.

If the trial works, design an Effect wrapper around bounded Ralph runs.
Keep quotas, tranche decisions, and wakeup decisions in the pure core;
execute processes and persist state in the shell. If the wrapper needs to
reimplement Ralph's loop or rely on undocumented internal files, compare
direct Claude/Codex adapters before proceeding. No build or cost estimate
is established by this documentation pass.

## Sources

Moving main branches and published docs, inspected on 2026-11-14. Freeze a
release and inspect its license and dependencies before adoption. No
reference implementation was copied.

[C1]: https://github.com/willagio/ccx-loop
[C2]:
  https://github.com/willagio/ccx-loop/blob/main/docs/supervisor-design.md
[R1]: https://github.com/mikeyobrien/ralph-orchestrator
[R2]:
  https://github.com/mikeyobrien/ralph-orchestrator/blob/main/crates/ralph-core/src/config.rs
[R3]:
  https://mikeyobrien.github.io/ralph-orchestrator/guide/cli-reference/
[R4]:
  https://mikeyobrien.github.io/ralph-orchestrator/guide/configuration/
[R5]:
  https://mikeyobrien.github.io/ralph-orchestrator/guide/telegram/
[R6]:
  https://mikeyobrien.github.io/ralph-orchestrator/guide/cost-management/
[A1]:
  https://github.com/lucasmeijer/AgentsInTheCloud/blob/main/readme.md
[A2]:
  https://github.com/lucasmeijer/AgentsInTheCloud/blob/main/docs/automation.md
