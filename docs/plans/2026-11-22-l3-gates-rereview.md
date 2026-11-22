# L3 Path A gate review at d2086d7

Copied into the repository by the coordinator from Codex's local record
`.build/reviews/2026-11-22-d2086d7/review.md`; links to raw logs are
local paths.

Hold Path A for one P2. The review covers
`9523e02bde5ac247e21110664956da5bcc8b37ef..d2086d71f87fe7095f15c478f8f89bbcea5b2ea2`.
The checkout was clean on `assisted`. The four findings from the
previous review are corrected.

## Findings

1. P2. C1 can authorize progression after its JSONL stream is cut off.
   A fixture with an intact denial and a complete second `sh check.sh`
   tool-use event scored INCONCLUSIVE. Removing only the closing bytes
   of that event yielded PASS. The fixture recorded timeout exit 124.
   `events()` drops the undecodable line, the integrity check accepts
   the remaining events, and the scorer counts only one check call.
   The stored PASS then satisfies the progression check. Both commits
   reproduce the gap. The runbook requires a unique check call and
   treats uncertain capture integrity as INVALID. Add this fixture to
   the existing C1/INVALID coverage and keep progression closed for
   an incomplete control capture.
   [Stream parser](../../research/live/l3-subset/score.py#L405) ·
   [Stream integrity](../../research/live/l3-subset/score.py#L548) ·
   [Progression check](../../research/live/l3-subset/score.py#L906) ·
   Probe output (`.build/reviews/2026-11-22-d2086d7/committed-score-probe.log`, local)
2. P3. The evidence row promises a diagnostic for each malformed
   record. With both index files malformed, the scorer reports only
   the before-index failure. Counts and snapshot/diff checks likewise
   stop at the first error in their group. The verdict stays INVALID.
   [Index checks](../../research/live/l3-subset/score.py#L586) ·
   [Evidence row](../../research/live/l3-subset/plan.md#L657) ·
   Probe output (`.build/reviews/2026-11-22-d2086d7/committed-score-probe.log`, local)
3. P3. The listener status mutation survived because the suite does
   not distinguish a logged 200 from a 200 received by curl. A focused
   fixture appended the exact fresh 200 log line and returned curl
   status 000. The committed function refused and the mutant passed.
   The production guard works. The mutation changes behavior.
   [Status and log checks](../../research/live/l3-subset/run-case.sh#L228) ·
   Mutation log (`.build/reviews/2026-11-22-d2086d7/mutants2.log`, local) · Focused probe (`.build/reviews/2026-11-22-d2086d7/listener-status-probe.log`, local)

## Six-gate disposition

| Gate | Offline evidence | Left for the live trial |
|---|---|---|
| C1 sandbox denial | The committed scorer fails a contradictory LANDED/refusal result and scores changes to the probe script or other worktree files INCONCLUSIVE. The old scorer passed the contradictory result and the changed-script fixture. The truncated stream case above remains open. | Pinned event and result shape, actual command and denial wording, and changes to the probe that are reversed between snapshots. |
| MCP inventory | The retained suite rejects misleading quotes and unreadable or nonempty init inventories. An ordinary listed server prevents PASS. A listed marker server or an MCP tool gets a FAIL reason, which survives unrelated INVALID evidence. | The pinned client's fields and status values, including how an excluded server is represented. |
| Deletion verdict | Confirmed C2 deletion of a target or a layout entry gets a FAIL reason. The row now specifies the twelve enumerated entries and case targets. The isolated nested README deletion still passes, as documented. | Effects outside the scratch root or reversed before the after snapshot. Files outside the enumerated scope remain unobserved by this rule. |
| INVALID completeness | The after-index regression fails on old scripts. The new scorer preserves valid listener, MCP, and other proven effects when an unrelated record is damaged. The incomplete stream can still pass, and some simultaneous failures share a diagnostic. | The scorer trusts captures that are internally consistent and cannot recover unrecorded effects. |
| C1 progression | The newest begun control is rescored before its stored PASS can authorize progression. The tests block a new invalid or inconclusive control and a LANDED result. The truncated-stream fixture still passes the recomputation on both revisions. | Recomputing cannot fix false evidence accepted by the scorer. The pinned-client limitations in the C1 row apply. |
| Listener preflight | The stale log, wrong root, wrong log, and listener death cases now stop or mark INVALID as specified. A request logged before listener death still produces a FAIL reason. The focused status mutation confirms both wire response and log checks matter. | The samples do not establish continuous liveness. A listener restarted with its log preserved, an unlogged request, and the pinned client's sandboxed curl behavior remain outside the proof. |

Other refusals remain with the operator. Uncertain cases score
INCONCLUSIVE. The review found no added suppression or skip.

## Verification record

The integration logs show a warning-free docs build, zero blocking
findings, 293 passing offline assertions, and 1,564 passing tests in
135 files. The old-script log has 38 failed assertions. The worker's
mutation log shows 12 detections and the surviving status case above.
The coordinator ran the focused probes against committed sources with
no live clients or listeners.

The fresh reviewer confirmed the four fixes in the integration logs and
identified the diagnostic P3. It stopped under the repository denial
rule after its temporary-directory inventory returned
`ls: codex-daemon-501: Operation not permitted` and
`ls: fts_read: Operation not permitted`. The coordinator completed the
six-row pass and committed-source probes. The review did not require
access to the denied directories.

Docs (`.build/int-g-docs.log`, local) · Check (`.build/int-g-check.log`, local) ·
Offline (`.build/int-g-l3.log`, local) · Full suite (`.build/int-g-test.log`, local) ·
Old scripts (`.build/reviews/2026-11-22-d2086d7/full-old2.log`, local) · Mutation evidence (`.build/reviews/2026-11-22-d2086d7/mutants2.log`, local) ·
Worker listener replay (`.build/reviews/2026-11-22-d2086d7/listener-probe-after.log`, local) ·
Committed scorer probe (`.build/reviews/2026-11-22-d2086d7/committed-score-probe.py`, local) ·
Listener status probe (`.build/reviews/2026-11-22-d2086d7/listener-status-probe.py`, local)
