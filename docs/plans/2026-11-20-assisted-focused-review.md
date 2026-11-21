# Focused review of the assisted corrections

November 20, 2026. Reviewed `assisted` at
`6d263c5114ff1a863d0016c9f9d262e53da735de`, clean on entry. Local
`main` was `4604c7c6ea3d84aa6a5b500b0ed592b8d6a0b948`.
Recommendation: correct the remaining refusal and exit cases before
landing. Keep the reproduced cycle timeout open.

## Remaining findings

1. R01 remains partial. `src/program/production.ts:165` wraps startup
   Git failures as WorktreeUnready. `src/program/command-start.ts:66`
   reduces that to text and `src/program/attempt.ts:165` reduces it to a
   boolean. The command then returns CommandRefused, which expires the
   waiver. A disposable probe injected the production-shaped startup
   result with a GitCommandFailed reason. It observed CommandRefused
   with WorktreeCheckFailed and the waiver gone. A second probe injected
   EIO reading the recorded task. `src/program/recorded-files.ts:31`
   turned that into RecordedFileChanged and `implement.ts:68` turned it
   into TaskFileChanged. That also expired the waiver. The exhaustive
   match checks the final tag, so it cannot recover either lost cause.
   The findings reader also maps all file read failures to
   FindingsFileUnreadable (`src/program/correct.ts:117`). Keep genuine
   missing or changed inputs distinct from transient read failures.
   The directly propagated GitCommandFailed and ChangedPathsUnread
   cases preserve the waiver as designed. ChangedPathsUnread covers
   both nonzero Git exit and invalid name-status output. Neither shows
   that a candidate was deliberately refused.

2. Owner exits still have an unrelated layout prerequisite under AC1.
   `src/program/production-exits.ts:42` calls settledTarget, which
   validates the configured layout before consulting the binding
   (`src/program/production-target.ts:96`). In a disposable CLI session,
   changing only the configured supervisor path to owner/nested made
   status show the open session and a valid recorded target. Abandoned
   close returned LayoutRefused with exit 1. The shared factory blocks
   step-ended and interrupted close at the same point. This case has a
   usable recorded binding and safe state directory. Keep the recorded
   target's safety checks for writes. Step-ended also opens the ledger
   in the shared factory even though its operation only needs the
   project log and lock. That is a separate reachability gap by code
   inspection. A missing or unreadable binding can still justify
   withholding a close that needs ledger settlement.

3. Configuration and binding still accept malformed UTF-8 as changed
   identity data. A disposable probe placed byte FF in ownerCheckout in
   each input and both decoders accepted the path with U+FFFD. See
   `src/program/production-target.ts:51` and
   `src/program/target-binding.ts:55`. Use strict decoding at those
   boundaries and preserve TargetBindingUnreadable for status. The
   original client-stream R04 is addressed.

4. The previously unexplained assisted-cycle failure reproduced with
   an explicit 5,000 ms timeout in the full suite. The test took 5,053 ms
   while docs and check also ran in the review copy. The next full run,
   without concurrent docs or check, passed. Keep the failure open under
   the repository baseline. The timeout is now observed for this run.
   The coordinator's earlier failure lost its error message, so the
   earlier cause remains unverified. Retain all assertions and settle a
   named budget or reduce fixture cost.

## Dispositions

| Finding | Focused disposition |
|---|---|
| R01 | The previous changed-task and candidate-attribute cases now pass. The new snapshot, findings and profile cases also passed. The storage publication and crash controls preserve the waiver. Finding 1 remains open because some failures are converted before classification. |
| R02 | The contaminated HOME cases passed through the CLI, including step-ended with its corrected event tag and interrupted close. The Git control still refuses contamination. Finding 2 tracks the layout and ledger prerequisites. |
| R03 | Configured layout, recorded layout and broken-binding cases passed. Status returns 0 when it produced a report with findings. The JSON exposes findings and inForce, with the recorded target used for ledger context where valid. The worktree Git check is skipped under layout/binding findings. The owner-approved SQLite -shm exception applies. Reading the log from a refused state path is diagnostic, and the result may describe whichever log is there. A refused state path still supplies the path from which log and file data are read. Treat those results as advisory. A store read failure still suppresses the report, as documented. |
| R04 | Strict stdout decoding, raw-byte preservation, genuine U+FFFD, split chunks and invalid last-message controls passed. Task and findings files also have strict decoding. Finding 3 covers configuration and binding. |
| R05 | Closed by the owner ruling permitting the exact root line for any target that binds it. Arbitrary, duplicate and nested allowance controls still pass. |
| R06 | Owner-approved named 30-second budget is wired to the whole-repository prose test. Assertions are unchanged and the test passed on both full runs. The assisted-cycle timeout in Finding 4 is a separate open failure. The prior large-file timeout remains reported history. |
| L03 | Owner decision pending on inherited user settings and hooks. L3 still needs separate authorization. The previous pre-L3 path syntax and profile questions remain in the earlier review. |

## Verification and history

The committed tree at 23dc4b7 matched 3013dec with an empty Git diff.
The old red commits are absent from the current branch sequence. The
per-commit check results for rewritten history remain reported evidence.
The 511,628-token total matches the sum of the two recorded workers.

Fresh archived-head checks used
`/private/tmp/foreman-focus-mfsokG/tree`. The isolated Git index was empty.
The prose command enumerated the archive's untracked Markdown and checked
17 files. Check exited 0 with 46 advisory notes and zero blocking
findings. Docs exited 0 with no warnings.

- `test.log` contains the unrestricted full run with 1,503 passing
  tests and one timeout across 125 files.
- `test-serial.log` contains the unrestricted full rerun. All 1,504 tests
  passed across 125 files in 39.95 seconds. The committed tree lists 125
  test files at both 0da0672 and 6d263c5. The reported count of 123 files
  does not match either independent run.
- `probe-unrestricted.log` and `waiver-probe-final2.log` contain the
  bounded counterexamples. `probe.log` retains the initial sandbox
  /bin/ps EPERM in status and the malformed projectId control, which
  the identifier schema refused. The corrected probe placed the byte
  in ownerCheckout. Two initial waiver probe runs used invalid fixture
  waiver IDs and stopped at schema validation. The final run uses valid
  IDs and reaches both attempt checks.

Landing and pushing still require owner authorization. The review used
disposable repositories and fake or injected clients. Its only write in
the project checkout was this local record.
