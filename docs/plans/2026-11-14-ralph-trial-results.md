# Ralph 2.12.0: disposable trial results

Follow-up decision and Claude handoff:
[standalone supervisor direction](2026-11-14-agent-supervisor-decision.md).
The trial is finished; do not repeat it. Its evidence below is unchanged.

2026-11-14. Two fresh-context agents investigated runtime compatibility
and code size. The coordinator independently reproduced the routing case
and Rust line count. No real model calls, phone messages, upstream edits,
builds or global installation. Exact downloads and hashes are recorded in
the sibling ralph-trial-checkpoint document.

Recommendation: do not adopt Ralph or approve a TypeScript port yet. Its
cooperative review routing works, but supported primary-loop resume and
interrupted-operation recovery were not established. A small direct-agent
Effect supervisor is an alternative for the next design decision.

## Runtime findings

Evidence root: `/tmp/ralph-trial.OPhZe8/runtime/`. Case directories retain
configuration, logs, results and fake-provider invocation records.

| ID | Status | Observation | Case |
|---|---|---|---|
| T1 | VERIFIED | Cooperative events produced Claude implementation, Codex review, Claude correction, Codex completion; exit 0 and four child processes. Coordinator reproduced it. This does not enforce review against arbitrary model behavior. | routing-b; routing-coordinator |
| T2 | VERIFIED | A failing pre-iteration quota hook suspended before any provider call. | quota-a; quota-signal |
| T3 | CONFIRMED GAP | Public `loops resume` could not find the suspended primary loop's identifier. The harness deadline expired. Other loop configurations were not tested. | quota-a |
| T4 | VERIFIED, INTERNAL PROBE | `wait_for_resume` allowed a provider call while quota remained low, without rerunning the failed predicate. | bypass-signal |
| T5 | VERIFIED, INTERNAL PROBE | `wait_then_retry` reran the hook once. At a tranche completion hold, the first failed retry remained suspended, but a second generic resume released completion while approval was still pending. No next tranche ran. | quota-signal; tranche-signal |
| T6 | UNVERIFIED | After one simulated operation and interruption, `run --continue` refused because its scratchpad was missing. No second operation ran; general recovery and duplicate prevention remain unverified. | uncertain-a |
| T7 | VERIFIED DEFAULT | Fake calls received Claude's `--dangerously-skip-permissions` and Codex's `exec --yolo`. Safe overrides were not established. | routing-coordinator/calls.jsonl |
| T8 | UNTESTED | Real context renewal, quota retrieval, phone delivery, approval-question timeout, and absence of detached children after cleanup. | See limits below |

T4-T5 wrote Ralph's internal resume marker after T3 failed. They establish
implementation behavior, not a working public integration. Intentional
operator override is not itself a bug; an automatic quota wake cannot be
treated as human approval. Separate hold reasons remain necessary.

Fresh PIDs establish fresh processes, not real model context. A private
PATH resolved both providers to independently authored fakes. Preflight
remained enabled. The trial did not run upstream's full suite.

## Code size and intake

Read-only source: `/tmp/ralph-trial.OPhZe8/ralph-e2e-2.12.0`.
Inventory: `intake/summary.json`, `rust-files.json`, `scope.json` and
`limitations.md` under the temporary root.

- 254 Rust files, 167,392 physical lines including tests, tooling,
  comments and blanks. The coordinator independently recounted the total.
- Core/protocol/adapters/CLI total 117,391 lines including tests. A curated
  reference selection is 47,552 lines, including 20,035 recognized inline
  test-tail lines. It is not dependency-closed or a minimum port estimate.
- Test classification uses locations and trailing test-module text, not
  a Rust parser. Do not call the residual production-only implementation.
- Cargo.lock has 540 package entries including nine workspace entries.
  These include dev/alternate-target entries and multiple versions; this
  is not the resolved macOS runtime dependency count.
- The CLI directly depends on TUI, API and Telegram crates. A limited
  replacement could omit much of this, but would need new interfaces.

Intake decision: pinned executable trial only, no adoption. Ralph provides
useful orchestration but bundles much more than this sequential workflow
needs. A gateway would isolate its release cycle. Its MIT license requires
retaining the notice for substantial derived copies; transitive notices
were not audited. A TS port requires separate approval and scoping.

The release was published the previous day. Documentation drift includes
Python cost commands and an older Rust minimum; that does not establish
that the released executable is obsolete.

## Reproduction and retained failures

Run the cooperative case with a new variant name:

```sh
/usr/bin/python3 /tmp/ralph-trial.OPhZe8/runtime/harness.py \
  routing another-replay
```

The coordinator used `routing coordinator`. Existing case directories
are refused. The internal probes require variant `signal`; inspect their
retained evidence rather than overwrite it. Inventory scripts are under
`/tmp/ralph-trial.OPhZe8/intake/`.

Retained failures: conflicting `--no-tui` and `--autonomous` in routing-a;
initial preflight path warnings resolved by creating the expected toy
directory; T3's resume failure and deadline; T6's missing scratchpad.
Inventory setup corrections are in intake/limitations.md. Failed guessed
source searches were discovery errors, not Ralph runtime defects.

The final process audit was denied:
`PermissionError: [Errno 1] Operation not permitted: '/bin/ps'`.
The agent stopped, without retry or an alternate process inspection.
Harness cleanup killed its process groups and waited, but absence of
detached PTY children was not independently verified.

No full Waxwing verify ran: the trial changed no compiler code. The fake
provider probes are the runtime checks performed. No real-provider or
phone-delivery guarantee follows from them.

## Follow-up ledger

| ID | Status | Next decision or action |
|---|---|---|
| N1 | PROPOSED | Choose a supported Ralph integration repair/trial or a small direct-agent Effect supervisor. Avoid production control through internal resume files. |
| N2 | PROPOSED | Establish permission boundaries before real-agent use; default bypass flags need an explicit decision. |
| N3 | PROPOSED | Keep quota, human approval and uncertain-operation holds distinct; clock wakeup must not release all holds. |
| N4 | DEFERRED | Literal TS port: no approval or reliable size/cost estimate. First compare a narrowly scoped supervisor with direct adapters. |
| N5 | DEFERRED | Phone service and live delivery: user selected phone, not a provider. No external messages authorized during this trial. |
| N6 | UNVERIFIED | Cleanup audit: process inspection denied; do not claim no detached children remain. |
