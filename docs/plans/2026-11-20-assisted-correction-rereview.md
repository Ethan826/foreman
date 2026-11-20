# Assisted correction re-review

November 20, 2026. Recommendation: CORRECT BEFORE LANDING.

Verified checkout: `assisted`, clean at the start, at
`3013dec7105da806ba7f40c3817ca4c9d01f3396`. Local `main` remains
`4604c7c6ea3d84aa6a5b500b0ed592b8d6a0b948`. The correction review starts
at `9c3b48c280d8279388c803cad6942102720eedd1`; the correction diff has
128 files, 6,857 insertions and 740 deletions. The previous report in
this repository is byte-identical to the supplied archived report.

## Remaining findings

These are local findings for the assisted-corrections review. No remote
filing is authorized. Locations refer to the verified head.

### R01: waiver expiry still misses ordinary refusals

Important; B15 remains partial. `src/program/waiver-expiry.ts:20` names
only `CommandRefused`, `QuotaHeld`, `WaiverRefused` and `LostRace` as
refusals. `src/program/attempt.ts:135` and `:136` can stop in snapshot
validation or preparation with other deliberate refusals.

Two independent probes failed the required expiry assertion:

- With Claude's waiver armed, changing the recorded task makes
  `implement` return `TaskFileChanged`, with no `Intended` or launch,
  but leaves the waiver `Some("pending")`.
- After a successful fake implementer, with Codex's waiver armed,
  adding `.gitattributes` containing `* text` makes `review` return
  `AttributeSourcesRefused`, with no reviewer launch, but leaves the
  waiver `Some("pending")`.

The same error-routing argument applies to `SnapshotPreflightRefused`;
that combination was not separately probed. The one-attempt rule must
cover deliberate task, findings, profile and snapshot refusals without
expiring consent merely because of a crash or storage failure. Keep the
approved successful retry after batch W. Add boundary cases alongside
the new enum-like list of refusal types; extending that list alone can
repeat this omission.

### R02: the production factory blocks owner exits on Git HOME

Important; integration regression affecting B02/B04 and AC1.
`src/program/production.ts:97` sends the reachable commands through
`productionUnder`, which unconditionally prepares Git HOME at `:113`.
The facade selects this factory for `step-ended` and abandoned or
interrupted close (`src/facade/cli.ts:70`). Those commands need no Git
operation.

A production CLI probe opened a disposable session, planted one file in
`state/git-home`, then ran `session close --abandoned`. It exited 1 with
`GitHomeRefused`, leaving the session open. The same construction blocks
`step-ended` and interrupted close before their command rules run
(code trace). AC1 expressly keeps exits available when the worktree or
a file is broken. Construct these commands from their required stores
and capabilities; Git HOME must remain mandatory for Git operations.

### R03: status refuses before it can report broken target metadata

Important; B04/B11 remain partial.
`src/program/production-status.ts:112` validates the configured layout
before reading the recorded binding or project log; `:114` fails on an
undecodable binding and `:116` requires the recorded layout to pass.
The underlying configured-layout check is at
`src/program/production-target.ts:37`.

A production CLI probe opened a session and then changed only the
configured supervisor path to `owner/nested`. `status` exited 1 with
`LayoutRefused`. Its output omitted the session state and process
evidence, including incomplete attempts. Reading the valid recorded target never happened. A damaged
binding has the analogous early-failure path (code trace; the new test
only covers refusing a launch under that damage). The execution record
discloses this behavior; owner acceptance is still pending.

Report these failures alongside whatever state can safely be read.
Refuse unsafe Git operations and uncertain cross-project writes. This
finding does not require guessing a replacement target or permitting a
state directory inside the client worktree.

### R04: malformed UTF-8 client output can still classify Success

Important; B13 remains partial, although B17's Git boundary is fixed.
`src/runtime/spawn.ts:123` uses replacement decoding before the new
JSON/schema check. `src/program/client-output.ts:48` also decodes file
bytes with replacement.

A real local shell fixture printed a Claude success result with byte
`FF` inside its `result` JSON string. The production stream path yielded
U+FFFD in that string, `claudeDecoded` reported no malformed line, and
`classifyAttempt` returned `Success`. The probe expected `Unclassified`
and failed with exactly those values. No model process ran.

Make classification reject invalid encoding and leave the attempt close-only.
Retain the raw bytes. Include a genuine U+FFFD control and chunk
boundary cases. The original malformed-JSON and malformed-known-event
counterexamples are fixed; this is a remaining input boundary in that
same correction.

### R05: the exact Waxwing line is still available to any target

Important scope mismatch; B06 remains partial.
`src/domain/attributes.ts:181` restricts the line correctly, but
`src/program/production-target.ts:43` binds only the configured paths,
project name, ledger and allowance. No field or check establishes a
Waxwing identity. First use can enable the exception for any repository.

The production probe enabled the exception for the unrelated disposable
`alpha` repository and `worktree create` succeeded. The committed
`test/program/production-attributes.test.ts:47` also exercises acceptance
of the actual line on that arbitrary fixture. This does not revive the
arbitrary filter/conversion escape; those lines are now refused.

Keep B06 open until the exception is restricted to the owner-approved
Waxwing identity, or the owner explicitly approves the narrower exact
line exception for any bound target. Choosing how to identify Waxwing
is an owner decision; this review does not invent an identity rule.

### R06: the required full test run is red

Important verification blocker; the recorded five-second timeout remains
unresolved. The unrestricted required suite at the exact archived head
finished with 119 passing files and one failing file: 1,472 tests passed
and one failed. `test/lint/prose.test.ts:25`, “passes on the repository's
own Markdown,” timed out at 5,000 ms; its measured call was 5,156 ms.
The whole suite reported 40.36 seconds. There was no subsequent rerun
to erase this failure, and no timeout or assertion was changed.

The standalone `check` command passed. The observed failure was the
test's timing envelope. A bounded
correction must establish a suitable test cost or an owner-approved
timing budget, with evidence under the expected load. The large-binary
state-file test passed in this run; its earlier reported timeout remains
recorded and is not independently reproduced here.

## Finding dispositions

“Addressed” means the correction was read and its relevant existing
tests passed in the independent unrestricted run. It does not mean
landed, live-verified, or proved against all possible inputs. Reported
failed-first and mutant histories in commit messages remain reported
history; this review did not replay every worker mutant.

| ID | Disposition | Evidence and remaining boundary |
|---|---|---|
| B01 | Addressed | Fresh exclusive root claim; path/device/inode ownership record; complete validation before teardown. Teardown removes recorded names while preserving out and unrelated names. Offline shell cases passed. They cover partial setup and forged records; sentinel controls verify preservation. |
| B02 | Addressed for Git; exit integration defect R02 | Runtime checks ownership and filesystem kind. It also checks mode and emptiness. Creation is fresh 0700; existing contamination is refused without cleanup. Production marker-filter and reuse tests passed. Link and mode controls passed too. Assumes the assisted rung's protected-input inspection and quiescence. |
| B03 | Addressed construction; live validation pending | Config no longer supplies a settings path. Fixed generated settings are published before admission for the session's recorded worktree, and received-byte production tests passed for implement and correct. The safe path alphabet is checked. No target test command is allowed; selection of one needs an owner ruling. L03 remains open. |
| B04 | Partial | Canonical target binding and mismatch refusal tests passed, including a different ledger and unchanged other repository. Valid-layout mismatches permit status and abandoned close. R02/R03 prevent closing this row. Pins are intentionally not bound by this change; changing pins still checks the current config, with live pins pending L3. |
| B05 | Addressed configured layout | Canonical component containment keeps state/worktree outside owner checkout. It keeps owner outside worktree, with state/ledger outside worktree too. Linked and dangling cases passed. Separate release checkout remains the manual P3 precondition. Reporting under damaged layouts is R03. |
| B06 | Partial | Arbitrary, near-miss and duplicate configured lines now fail decoding; nested and other-source rules remain. Waxwing identity restriction is missing: R05. |
| B07 | Addressed | Candidate attribute blobs are judged after snapshot and before handoff. Startup judges session base, or current HEAD without a session. Production added/edited/nested/macro/filter-marker tests passed; candidate filters did not execute. |
| B08 | Addressed pre-staging safety | Real base gitlink, nested repo, FIFO, tracked-but-ignored FIFO and socket tests require refusal before read-tree/add/write-tree; controls still stage. All passed unrestricted. New failure tags surface as command failures, which is diagnostically different from SnapshotRefused and contributes to R01. |
| B09 | Addressed | Configured shared-ledger and two-project tests passed. HOME default and binding controls also passed. Per-project logs and locks stay separate. The owner must provision the ledger directory; the factory does not create ~/.foreman. |
| B10 | Addressed | Configurable estimates removed; production uses defaultPolicy.initialEstimate for every role. Actual Claude grants are 15 points per window. Default Codex policy has no windows, so its waived grants have an empty estimate list. Codex 15-point window reservations remain unverified. |
| B11 | Partial; owner interpretation pending | Missing-state construction and missing-ledger reads passed. Status answered under an active writer; it takes neither the project lock nor BEGIN IMMEDIATE. R03 remains. SQLite -shm qualification is below; do not claim literal zero filesystem writes. |
| B12 | Addressed | All open-session attempts have evidence, finished leaders included; absent Launched is LaunchUnknown. Tests cover surviving descendants and spawn-before-L ambiguity. Advisory caveat remains. |
| B13 | Partial | Original malformed JSON/schema cases and benign events passed. Replacement decoding still launders invalid UTF-8 into Success: R04. |
| B14 | Addressed | Exact submitted brief is published before batch I and recorded by path/hash in that batch. Received-byte and restart tests passed. Publication failure and artifact integrity controls passed too; status exposes integrity. Review/correct require brief integrity. AC1 does not require reports or briefs intact to close. |
| B15 | Partial | Other-provider admitted/refused cases, non-quota holds, successful retry after W and close expiry tests passed. Preparation and candidate refusals are missing: R01. |
| B16 | Addressed | Per-file import policy now permits only node:child_process for the three new starters. Bun/cluster/unprefixed-import must-fail cases passed for each. Production tests exercise main/factory composition. Existing documented alias/dynamic-program scanner limits stay. |
| B17 | Addressed at Git boundary | execFile returns buffers; fatal UTF-8 decoding preserves BOM and refuses malformed output before callers see it. Real invalid-name/genuine-U+FFFD controls passed. Blob-content and attribute tests passed too. Runtime directory walk also decodes names strictly. Non-Git decoding is assessed below and in R04. |
| M01 | Addressed | Status coverage equals the review brief statement; tests passed. |
| M02 | Addressed | Only absence yields an empty Codex last message; read failures propagate before batch F. Missing and unreadable controls passed. |
| M03 | Addressed | Directory fsync uses acquireUseRelease; injected fsync failure still closes the descriptor and retains the original failure. Tests passed. Close failures remain logged and ignored as documented. |
| M04 | Addressed | RecordedGitIdentity schema now requires absolute paths; relative and empty controls passed. |
| M05 | Addressed | Format converts Codex outcome tags into completion/failure facts; Features no longer duplicates those wire tags. Classification and Format controls passed. |
| M06 | Addressed ownership/inventory/encoding; pre-L3 restriction pending | Whole scratch tree outside out is inventoried; path and link encodings survive newlines; failed enumeration/hash refuses publication. Offline suite passed. JSON escaping alone does not neutralize Claude permission-rule glob syntax; see pre-L3 items. |
| M07 | Recorded capability limit | RateLimited/AuthFailed/PermissionDenied are still never specifically classified. Unknown failures are close-only Unclassified. No guessed text matching was introduced. |
| M08 | Addressed | AGENTS.md and checkpoint describe assisted implementation with pending re-review. They preserve live/landing authorization boundaries. L3 stays unrun. |
| M09 | Deferred by existing ruling | Overlength ESLint/admission files and external owning-skill lift stay explicit debt. No skills-repository modification or remote filing performed. |
| L01 | Addressed within owner ruling | Both real inherited-stdout tests passed: leader exits while command waits; Effect interruption leaves AttemptIncomplete and permits status, step-ended and interrupted close. Descendant ends itself; no signaling. The fixture interrupts an Effect; native terminal Ctrl-C was not automated. R02 still obstructs that exit path if Git HOME is contaminated. |
| L02 | Accepted conditional limit retained | Documentation now limits O_NOFOLLOW to the final component and states quiescence/no concurrent writer. No stronger race or OS-containment guarantee is claimed. |
| L03 | Pending owner decision | Inherited user settings/hooks policy is unchanged and unresolved. Generated settings do not select setting sources. Settle it before a separately authorized L3 run. |
| L04 | Accepted existing limit retained | Pinned GIT_COMMON_DIR does not bind every ref read on the probed Git version; independent discovery/identity checks remain. No ref-write or adversarial-concurrency claim added. |

## Status contract and remaining pre-L3 items

The new `ProductionStatusReport` wrapper holds `target`, `gitHome` and
`report`, and `StateMissing` is a separate result. Tests exercise the
wrapper; the relevant Program/Facade documentation describes it. There
is no supplied stable flat-JSON consumer contract to contradict. Treat
this as a visible interface change to accept before landing. A serialization
defect has not been demonstrated. Existing Option JSON representation
remains a recorded limit.

The Runtime explicitly acknowledges SQLite WAL read-mark writes to
`-shm` (`src/runtime/state-read.ts:8`). Both status test inventories
exclude that file's bytes/times (`test/facade/status-read-only.test.ts:61`
and `test/program/production-status.test.ts:32`). Their green result
leaves AC1's literal "never writes" unverified. Three bounded same-
process empty/advanced-WAL probes did not observe a byte change; this
review does not present the worker's read-mark claim as a fresh observed
write. The owner must decide whether AC1 means no application state or
ledger/database/WAL writes with SQLite coordination metadata allowed,
or literal filesystem immutability. Keep B11 open on that question;
do not add an immutable SQLite URI that silently loses concurrent WAL
visibility. No change to that policy is authorized by this report.

Other explicit questions:

- The generated Claude profile allows no target test command. This is
  fail-closed but less functional than P4; settle the test-command scope
  before a real editing cycle.
- `research/live/l3-subset/setup.sh:196` safely JSON-encodes arbitrary
  paths but still substitutes them into Claude's glob-like permission
  rules. Production rejects such syntax through ProfilePathUnsafe;
  L3 setup does not. Before L3, require a production-compatible plain
  path, or add a reviewed rule-syntax encoding and test it. The offline
  odd-path test establishes JSON/shell safety only. It proves no client
  permission semantics.
- `test-scripts.sh` remains a separate documented offline command. It
  passed in this review and is not part of the reported 1,473 tests.
- `info/attributes` still uses replacement decoding, but any nonempty
  content is refused, so invalid bytes do not turn it into accepted
  empty content (code argument). Version and ps reads also remain
  replacement-decoded: version matching is pin-based and ps is
  advisory. No exact-byte claim is warranted there. Client output has
  a demonstrated acceptance defect, recorded as R04.
- The existing no-monotonic-stamp policy means each production launch
  needs an explicit waiver. Codex windows are not in the default policy.
  Neither this review nor offline tests authorize a live client call.

## Verification and retained evidence

All checks used the archive of `3013dec` under
`/private/tmp/foreman-rereview-2iFAt7/tree`, with the installed dependency
copy and an isolated Git index for the prose inventory. The required
checks ran before adding review probes; no production code or check was
changed. Evidence is retained under
`/private/tmp/foreman-rereview-2iFAt7/`:

| Command/evidence | Independent result |
|---|---|
| gtimeout -k 5 300 bun run check; check.log | PASS, exit 0. Type checking and lint completed. Prose checked 17 Markdown files: 0 blocking findings; 45 advisory notes. |
| gtimeout -k 5 300 bun run docs; docs.log | PASS, exit 0, no warnings. |
| gtimeout -k 5 300 bun run test; test.log | FAIL inside sandbox: 45 failed / 1,428 passed in 120 files; 1 unhandled socket error. /bin/ps spawn EPERM and Unix socket listen EPERM; the socket also timed out and hit a cleanup-hook timeout. |
| Same full command, approved outside sandbox; test-unrestricted.log | FAIL, exit 1: 1 failed / 1,472 passed in 120 files, prose timeout R06. No other failure in this run. |
| bash research/live/l3-subset/test-scripts.sh /private/tmp; l3-offline.log | PASS, all printed cases passed, including Bash syntax checks. No live client or network call. |
| test/program/rereview-probes.test.ts; probes.log | Five deliberately unmet contract assertions failed for R01 (two cases), R02, R03 and R05; their setup completed and the observed tags/values are printed. Fake clients only. |
| UTF-8 case in the same probe file; utf8-client-probe.log | Expected Unclassified, got Success through the real shell/stream path, R04. Targeted selection excluded the other five probes for this run; source is free of skip/only declarations. |
| history-fcb-docs.log and history-e061-docs.log | Both archived commits fail docs, exit 4: undocumented StartupGit.handoffGit property, one warning each. |
| correction-commit-records.txt | Commit messages retain the workers' claimed failed-first/mutant evidence. Those historical claims were not all independently replayed. |
| sandbox-failure-index.txt | Lists every failed sandbox test and the serialized socket/process errors; full stacks are in test.log. |
| review-prose.log and review-prose-final.log | The first explicit prose pass flagged 27 blocking items in this new record. Wording was revised; the final pass has 0 blocking findings and 6 advisory notes. No keep entry was added. |

No final-tree suite pass is claimed. The unrestricted full run is the
current required-test evidence. The extra counterexample probes remain
temporary review artifacts outside the project's suite.

Review setup failures and instruction slip retained: reads of absent
`vitest.config.ts` and `src/runtime/ledger-schema.ts` exited 1; an
unmatched shell wildcard for a Waxwing plan was replaced by an rg file
search. No source depended on those reads. The throwaway archive index
was populated with `git add --all`, which did not follow the explicit-
path staging instruction. It affected only the temporary review index;
the original checkout and its index were untouched. No tool call in
this review was denied. The sandbox runtime failures were retained and
the required escalation was approved before the unrestricted rerun.

## Execution incidents and landing implications

The plan discloses all four supplied incidents. Their narrative and
worker-token meters are reported evidence; the original denial text and
worker tool transcript are not present in these committed records.

| Incident | Disposition |
|---|---|
| Denied edit retried through another tool | The rule violation remains recorded despite successful code or the worker's "false positive" assessment. Owner acknowledgment and enforcement in future worker briefs are needed; no permission to repeat the action follows from this review. |
| Worker committed before the full test finished | Violates the before-commit prerequisite. Later amendment/checks can establish a corrected tree; they cannot make the earlier commit compliant. Keep the incident in the durable execution record. |
| fcb1a41 and e0616e3 red docs individually | Independently reproduced, exit 4 with one warning. The warning is corrected at head. A fast-forward landing of the current commit sequence would preserve these noncompliant intermediate commits. |
| Coordinator committed despite failed check, then amended | Recorded prerequisite failure; amended final prose passes the independent check. Keep the incident and require a command sequence that stops on each failed prerequisite before any future commit. |

Before landing, the owner must decide how to handle the known red
intermediate history: authorize consolidation/reordering and verification
of the resulting commits, or explicitly accept the preserved failures.
This review does not rewrite history or treat a clean final tree as
retroactive compliance. It also does not independently certify the
reported claim that tsc passed on every intermediate commit.

The correction-group token figures in the plan sum to 1,434,890, within
the reported 1M to 1.45M forecast. Only the arithmetic is verified;
the underlying meters remain reported. Initial work remains a reported 2,979,906 tokens
over fourteen passes; coordination/reviewer usage is separate. This
re-review used no delegated agents and launched no implementation worker.

## Recommendation

Correct R01 to R04 and resolve R05's target-policy scope. Address R06
without weakening correctness assertions, then rerun all required
checks and re-review those bounded changes. Obtain the owner rulings
on status's SQLite metadata contract and the known red history before
recommending landing. L03 and the permission-rule path restriction remain
separate prerequisites for L3. Scope estimates and authorization for any
further implementation or delegated review are still needed.

No correction, original-index change, commit, history rewrite, branch
switch, landing, push, remote filing or live model call was performed.
The only repository write from this session is this local review record.
