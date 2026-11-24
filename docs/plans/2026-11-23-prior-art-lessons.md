# What foreman takes from the prior art (2026-11-23)

The [re-sweep](2026-11-23-prior-art-sweep.md) found no tool to adopt.
This note keeps what the closest tools do well, mapped to foreman's
parts, so the sweep's value outlives it. Each line is a design input,
not an approval: anything marked "candidate" still needs its own slice
and authorization. Repository paths are at the commits the sweep lists.

## Client profiles (checked against the pinned clients)

| Lesson | Source | Foreman today | Status |
|---|---|---|---|
| Run Codex reviews with `--ephemeral --ignore-user-config --ignore-rules`, so the owner's `~/.codex/config.toml` and execpolicy `.rules` files do not shape a review | awaywork `src/providers/codex.ts:28`; all three flags present in `codex exec --help` of 0.170.0 | `codexReviewArgv` (`src/domain/profiles.ts`) passes none; the owner's Codex user config applies to every review, while Claude's profile excludes user settings (L03) | Candidate finding: an asymmetry in containment. Needs a slice and an X-case rerun of L3, since `--ignore-user-config` may also drop settings the review relies on (auth is separate) |
| Launch Claude with `--no-session-persistence`, so no resumable session is left on disk | supervised-agent-orchestrator `claude_cli.py:137`; present in `claude --help` of 2.1.330 ("only works with --print") | Not passed | Candidate, small; fits R4 (fresh context). Check that the stream-json output and the L3 cases are unchanged |
| `--safe-mode` and `--restricted` | same source | Not passed | Not adopted: `--safe-mode` drops CLAUDE.md and skills, which the brief relies on; `--restricted` removes Bash, which dogfood-3b's check command needs |

## Pacing and admission

| Lesson | Source | Foreman today | Status |
|---|---|---|---|
| Fail closed on a reading that is stale, that its source marks out of date, that is timestamped in the future, or that lacks the weekly figure | redline `internal/decision/decision.go:604-620` (checked) | `pace.ts` answers Unknown when no period is usable, with monotonic observation times; whether each of the four cases maps to Unknown is not shown by a named test | Candidate: one test per case in `test/features/`, a counterexample each |
| Cap at the least of 1 − reserve, linear pace to the window's reset, and a per-run allowance | awaywork `src/quota/budget.ts:56-59` (checked) | Admission uses the policy cap and period readings with a per-launch estimate (C13) | Design reference only: foreman's contract is owner-approved; compare when the estimates (P5) are revisited |
| A missing reading must hold, not fall back to fixed caps | awaywork `budget.ts:49-50` falls back (counterexample) | Unknown never launches | Already held; keep |
| Read Claude's windows from a one-turn `rate_limit_event` probe | awaywork `claude.ts:86, 199`; claude-lot | L1's reading source | Alternative source if L1's breaks |
| An external, observe-only pacing gate to compare against foreman's own readings | redline `decision --json` | None | Optional trial, needs its own authorization; not scheduled |

## Approval, holds and recovery

| Lesson | Source | Foreman today | Status |
|---|---|---|---|
| An unknown outcome goes to a suspended state only an authorized human releases | supervised-agent-orchestrator `orchestrator.py:21-23` | Uncertain operations hold, distinct from quota and approval (design) | Already held; confirms the design |
| Prove the reviewer changed nothing with a tree fingerprint before and after review | supervised-agent-orchestrator (sweep section 4) | Review runs read-only and the snapshot is taken before review; no after-review comparison is named | Candidate: compare the supervisor worktree's tree after `review` with the reviewed snapshot |
| An approval is void when the tree it approved changes; separate approvals for run, check and commit | agentd `runner.ts:2802-2822` | `correct` and `close --finished` require the reviewed tree | Already held for close; input to the check-step design revision |
| Record intent before the effect, append-only | bernstein (hash-chained WAL), supervised-agent-orchestrator `orchestrator.py:461` | Intended before Launched (design, B12 to B15) | Already held |
| Every plan section needs owner approval before execution | bdfl `scheduler.js:171` | Tranche approval per step | Already held |
| The owner ticks which findings go to the fixer | pr-cockpit (human ticks), the only tool with an owner filter | The owner's findings file | Already held; pr-cockpit's per-finding ticking is a possible interface for the findings file later |

## Counterexamples worth remembering

Nearly every orchestrator found defaults to the opposite of foreman's
rules: bypass permission flags (bosun, firstmate, ralphex, Delegatus,
pacer and others), auto-continue after review rounds (ralphex, ccx-loop),
auto-merge (bosun, bernstein), approval by an LLM (anafor, pacer), and
auto-resume after a limit resets (dozens of small tools). Those defaults
are why no engine could sit under a thin layer, and they are the review
questions to ask of any tool foreman later depends on.
