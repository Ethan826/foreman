# Ralph trial checkpoint

2026-11-14. Status: bounded trial reports collected. The user
authorized a disposable Ralph trial and asked for delegated investigation
to keep the coordinating context small. No paid model calls, publication,
Waxwing compiler edits, or TypeScript port are authorized.

## Current coordinator handoff

Superseding coordination-tool handoff:
[decision and Claude continuation](2026-11-14-agent-supervisor-decision.md).
The coordinator selected a small standalone TS/Effect supervisor for the
next design, in a sibling repository. No implementation or port approved.
The user wants Claude to continue because it has the larger allowance.
The checker material below is historical and outside this resumed task.

Ralph investigation is recorded in the sibling trial-results document.
No further Ralph execution is pending. The user then reported Waxwing
Scope A Stage 0 complete at bdf7d449 in r0-t2-d1 and requested U6 and
implementation decisions. A narrow read-only review is delegated to
`/root/scope_a_stage0_decision_review` (8-15K-token planning range).
Its report is collected; do not repeat the investigation. The ruling is
recorded in the sibling scope-a-implementation-ruling document. The reported
prediction is now 116 programs, not 118, due to post-substitution arrow
arguments in two fixtures. U6 and bounded implementation are approved
subject to that document's contract; production work has not started here.

A checkpoint insertion initially failed its context match; the corrected
insertion changes records only and leaves all trial evidence intact.

## Goal and decisions

Evaluate Ralph for Claude implementation and independent Codex review,
subscription pacing with an allowance reserve, context renewal and crash
recovery, tranche approval holds, and phone alerts. Prefer reusing Ralph
under a small Effect supervisor if that fits. Consider a TS port only if
the trial shows a concrete problem and the relevant code size warrants it.
Use the user's pure Domain/Features, Format, Runtime, Program and facade
architecture for any later tool. No standalone tool has been scaffolded.

Prior assessment and findings:
docs/plans/2026-11-14-agent-supervisor-fit.md. Prose review is beside it.
Both are uncommitted. The Waxwing checkout has pre-existing unrelated
changes; preserve them. Its HEAD is
b19db91af8df52dfab5b807cc87c0d25010dc537.

## Exact artifacts

Temporary root: `/tmp/ralph-trial.OPhZe8` (also `/private/tmp/...`).
GitHub's latest release query returned v2.12.0, published
2026-11-13T18:02:55Z. Downloaded through `gh release download` with
network approval. No install script or package manager was used.

| Artifact | SHA-256 |
|---|---|
| ralph-cli-aarch64-apple-darwin.tar.xz | ef4dc3298c2d56f1ea15b8ce19bc242b3b02f71d4d60f8b46acace5b9a29e2a1 |
| source.tar.gz | 0ba4cea1de0a19eaa2b1d7027bd2ea7622387f4fd8d5c5239f9ef8fbcf31f03b |

Both match the release metadata's digests. Extracted binary:
`/tmp/ralph-trial.OPhZe8/ralph-cli-aarch64-apple-darwin/ralph`.
`--version` reports `ralph 2.12.0`; `run --help` executed successfully.
Extracted upstream source (read-only reference):
`/tmp/ralph-trial.OPhZe8/ralph-e2e-2.12.0`.

The source archive's directory name is upstream's, not a separate build.
The source has an MIT license; retain notices for any later derived work.
The locally observed release supersedes stale web-cached main manifests
that said 2.10.1. Do not use those for release compatibility conclusions.

## Download checkpoint observations (historical)

- No `ralph` was already on PATH. Node and Cargo are present.
- `run` supports `--continue`, `--loop-id`, `--rpc`, `--no-tui`,
  `--autonomous`, `--exclusive`, and `--no-auto-merge` in v2.12.0.
- Release docs/configuration include pre-iteration hooks and suspend
  strategies `wait_for_resume`, `retry_backoff`, `wait_then_retry`.
  Behavior and recovery remain untested.
- At that checkpoint no fake agents or toy repository existed. They now
  live under `runtime/`; see the results document for observations.
- Initial sandboxed GitHub metadata access failed to connect. Retrying
  with requested network approval worked. This was not a model run.
- Available disk space is about 13 GiB. Avoid source copies and builds.

## Delegated work and next actions

| Task | Scope | Status |
|---|---|---|
| Runtime trial | Fake routing, quota suspension, recovery and tranche holds. | Report collected: /root/ralph_runtime_trial |
| Size and intake | Read-only size, dependency and TS-port assessment. | Report collected: /root/ralph_size_intake |
| Integration | Check reports against evidence and record limitations. | Routing reproduced, source total recounted, results inspected. See sibling results document. |

Use two fresh-context agents, roughly 40-80K tokens total as a planning
range. Target about 15-30 minutes; report concrete blockers instead of
expanding into a framework audit. Return reports as text; the coordinator
owns the durable findings. No other agent dispatch without a new brief.

Both agents use gpt-6.1-sol: runtime at high reasoning, inventory at
medium. Their private output directories are `runtime/` and `intake/`
under the temporary root. They must not modify this checkpoint. If the
coordinator context is reset, read the sibling trial-results document
first. The reports are collected, routing was independently reproduced,
and the source line count was independently checked. Do not restart
either investigation. The next step is the user's design decision.

Every claimed runtime result needs a log and reproducible command.
Distinguish a process restart from fresh model context and from safe
recovery after an operation whose outcome is unknown. A quota wakeup
must not release a human tranche hold. Phone delivery is not authorized
for this fake-agent trial and remains untested.
