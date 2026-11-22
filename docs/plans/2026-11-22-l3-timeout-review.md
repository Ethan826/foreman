# L3 Path A review at 44eb6f7

Copied into the repository by the coordinator from Codex's local record
`.build/reviews/2026-11-22-44eb6f7/review.md`; links to raw logs are
local paths.

Hold Path A for the timeout-at-event-boundary case. Reviewed
`9aced843d0b35747b3b3178a2ae5dac552c68cc9..44eb6f7933ce02e05f8274880523f83fd5063480`
on a clean `assisted` checkout.

## Findings

1. P2. C1 can authorize progression after a timeout at a JSONL boundary.
   A C1 fixture with exit 124 and a partial second check event changed
   from PASS on the old scorer to INVALID on the revision. Keeping the
   same termination status and cutting the stream just before that
   event produces PASS on both revisions. The revision's progression
   check accepts the recomputed stored PASS. Adding the complete second
   call makes it INCONCLUSIVE. Parseability proves the captured records
   are complete, while the timeout leaves the event sequence incomplete
   or uncertain. Keep progression closed on a runner-reported timeout
   unless independent evidence establishes client completion.
   [Gate claim](../../research/live/l3-subset/plan.md#L659) ·
   [Stream integrity](../../research/live/l3-subset/score.py#L569) ·
   Probe output (`.build/reviews/2026-11-22-44eb6f7/stream-probe.log`, local)
2. P3. A second init record can hide positive MCP evidence. A damaged
   stream with one valid init listing a connected `l3-marker` reports
   INVALID plus FAIL. Add a valid empty init and the marker finding
   disappears. The adverse-effect reader uses the same uniqueness
   requirement as the EMPTY proof. Keep uniqueness for a clean inventory
   and scan admissible positive entries independently.
   [Uniqueness check](../../research/live/l3-subset/score.py#L509) ·
   [Adverse-effect reader](../../research/live/l3-subset/score.py#L815) ·
   Probe output (`.build/reviews/2026-11-22-44eb6f7/stream-probe.log`, local)
3. P3. The decoder accepts bytes that are invalid UTF-8 inside a string
   and accepts `NaN` as an object value. In each synthetic case a C1
   fixture scores PASS. The runbook says every line is a JSON object.
   Use strict decoding for the stream and preserve independently
   readable adverse records when a line fails.
   [Reader](../../research/live/l3-subset/score.py#L236) ·
   [Decoder](../../research/live/l3-subset/score.py#L420) ·
   Probe output (`.build/reviews/2026-11-22-44eb6f7/stream-probe.log`, local)
4. P3. When the before snapshot and the diff are both missing, the
   diagnostic names only the snapshot. Checking whether the diff
   exists is independent of checking whether it applies. Preserve a
   missing diff's own reason and skip only the consistency comparison.
   [Diff checker](../../research/live/l3-subset/score.py#L736) ·
   Probe output (`.build/reviews/2026-11-22-44eb6f7/stream-probe.log`, local)

## Verification

The focused probe loaded both committed scorers and exercised the
line-break distinction and progression check offline. The integrated
logs record a warning-free docs build, zero blocking findings, 313
offline assertions and 1,564 tests across 135 files. The offline log
includes the split index diagnostics and the listener's 200-log/no-
response rejection. The project records ten detected mutants.

The pinned clients' actual stream formatting remains for a separately
authorized trial. The timeout counterexample rests on capture completeness
and can be settled offline. This review ran no L3 clients.

Probe source (`.build/reviews/2026-11-22-44eb6f7/stream-probe.py`, local) · Probe output (`.build/reviews/2026-11-22-44eb6f7/stream-probe.log`, local) ·
Docs (`.build/int-h-docs.log`, local) · Check (`.build/int-h-check.log`, local) ·
Offline suite (`.build/int-h-l3.log`, local) · Full suite (`.build/int-h-test.log`, local)
