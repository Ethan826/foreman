# Review of the dogfood-6 task draft (2026-11-26)

A fresh Opus review agent read the first draft of the dogfood-6 task
(per-store versions, the log raise, findings in the log) against
2bc5289, read-only and with no git commands. The coordinator recorded
its findings here and wrote them into the task.

Blocking: B1, ruling 8 forbade test edits the change forces: the
assisted-cycle batch rows, `neutralKinds` in the holds test, and the
log halves of three newer-store tests, whose 2 is now current.
Important: I1, a newer version read inside the append had no error
type (decided: `ProjectLogError`, interface unchanged); I2, the
`PositionMoved` row could not tell an in-transaction raise from a
separate statement (a trigger-based row added); I3, missing facts (a
log at 3, the raise refused after the open, `raisesLogFormat` over
every event, crashed reviews with a valid block); I4, the
`encoded-events.json` entry is required and byte-exact; I5, the batch F
hook's signature (named `finishedExtras`). Minor: M1 to M9 (named
numbers, version 0 inside the append, the duplicate-id check's place
and text, two more READMEs, a two-finding fixture, reuse of existing
tests, the helper signatures, `sessionId` beyond the design's fields,
and a brief line asking for distinct ids, taken as the stricter option).
