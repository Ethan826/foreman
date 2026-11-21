# Focused re-review of the assisted cycle

November 20, 2026. Keep landing on hold for the open findings below.
`assisted` was clean at `34ce0ab5a2dbb0b12a4263ecbe7d0eccb358427a` on
entry. The reviewed diff spans six commits and 24 files from `9fee8a5`
to `34ce0ab`. The last implementation reviewed before this pass was
`6d263c5`.

## Findings

1. **P2, open (R01). An identity command that exits on an I/O error
   still loses its cause and expires the waiver.** In a disposable
   linked worktree, the production startup check passed with real Git.
   Injecting exit 128 and an I/O diagnostic for
   `git rev-parse --absolute-git-dir` returned `WorktreeUnready` with
   `git-identity` and discarded the diagnostic.
   [The identity predicate](../../src/features/worktree-check.ts#L118)
   treats every `IdentityExited` as a mismatch, and
   [the startup wrapper](../../src/program/production.ts#L164) turns
   the resulting `WorktreeCheckFailed` into a judgment. The attempt
   rules then return `CommandRefused`, which expires the waiver. The
   B11a behavior covers an unrelated directory whose identity command
   exits nonzero. Keep that case distinct from a Git command that
   exits because it could not read a valid repository. The probe
   exercises the production check. The waiver consequence follows from
   the attempt code and the passing refusal test.

2. **P2, open (R04). A leading UTF-8 byte-order mark now blocks config
   and binding reads.** The same disposable JSON fixtures decoded at
   `9fee8a5` with or without the mark. At `34ce0ab`, both controls
   without the mark passed, and the marked files failed with
   `ConfigUndecodable` and `TargetBindingUnreadable` respectively.
   The shared [strict decoder](../../src/runtime/strict-utf8.ts#L12)
   keeps the mark. The JSON parsers then see a leading U+FEFF. Preserve
   acceptance of a leading mark at these two JSON boundaries while
   rejecting malformed bytes. An existing marked binding blocks the
   owner exits as well as launches.

3. **P3, open (AC1). Owner exits still depend on the configured
   default ledger directory.** With a valid recorded binding and a
   config that omits optional `ledgerDir`,
   [`exitTarget`](../../src/program/production-target.ts#L117)
   resolves the default ledger before reading the binding. A probe
   returned the recorded target with `HOME` set and
   `ConfigUndecodable` with `HOME` unset. This also blocks
   `step-ended`, which has no ledger operation. With a usable recorded
   target, the recorded ledger supplies the location for settlement.

## Disposition of the four corrections

| Item | Evidence and disposition |
|---|---|
| R01 | The passing suite covers injected startup Git failure and task/findings I/O failures that preserve the waiver, and a judged unready worktree or missing file that expires it. Finding 1 covers a nonzero identity exit after Git starts. |
| AC1 | The passing production cases exercise abandoned and interrupted close and step-ended under a refused configured layout. They also verify that step-ended can run with a broken ledger and that an unsafe recorded layout or damaged binding still blocks writes. Finding 3 covers a prerequisite before layout validation. |
| R04 | The passing production cases reject byte FF and accept a genuine U+FFFD in a path. Status reports a malformed binding as `TargetBindingUnreadable`. Finding 2 covers a valid UTF-8 input previously accepted. |
| Cycle budget | `cycleMillis = 60_000` is passed to all four cases. The diff leaves their bodies and assertions intact, and all four passed in the full suite. The worker reported a 50 ms negative control. This review did not rerun it. |

`51cded5` changes the wait used by the status test that compares the
state tree while fake-client output may still be streaming. The
coordinator's earlier assisted-cycle failure and the focused review's
reproduced 5,000 ms assisted-cycle timeout are separate events. The
coordinator's failure message was lost, so its cause remains open.

The three interface changes reported by the worker follow the diff.
Invalid UTF-8 config bytes now produce `FileNotUtf8`, a findings-path
read failure such as EISDIR leaves the waiver armed, and `session open`
surfaces the startup check's own failure tag when the check cannot run.

## Verification

The isolated archive's Git tree matched the reviewed tree
(`b1a34392e25551f41affcc1527d43c06eb540709`). It used the installed
dependencies and Bun 1.3.6. The gates ran serially.

| Command | Result |
|---|---|
| `git diff --check 9fee8a5..34ce0ab` | PASS |
| `bun run check` | PASS. Zero blocking prose findings, 48 notes. |
| `bun run docs` | PASS. No warnings with TypeDoc's `treatWarningsAsErrors` enabled. |
| `bun run test`, sandboxed | FAIL. 54 failed, 1,470 passed across 129 files. The sandbox denied `/bin/ps` and the Unix-socket bind. The latter also caused a test timeout, a cleanup-hook timeout and one unhandled error. |
| `bun run test`, unrestricted | PASS. 1,524 tests across 129 files in 49.61 seconds. |

Raw logs, probe scripts and the sandboxed failure list are under
`.build/reviews/2026-11-20-34ce0ab/`. The first archive setup named a
nonexistent `.gitattributes` path. Staging the committed path inventory
produced the matching tree. The first probe script imported a
Vitest-only fixture outside Vitest. A subsequent control used a
noncanonical macOS temp path and failed worktree lookup. The retained
final probe uses a standalone fixture with a canonical path.

## Owner handoff

The three findings are open locally. Before the first real tranche,
decide L03 on whether Claude inherits user settings and hooks, then
separately authorize the L3 permission trial on a disposable repo.
Landing and push each require their own approval.
