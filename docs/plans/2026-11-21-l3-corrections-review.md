# Review of the L3 and Foreman corrections

November 21, 2026. Reviewed `d0a4e3f..95fd4e1` on `assisted`.
The working tree was clean at `140ceb9` on entry. The checkpoint above
the reviewed head changes only the implementation plan and checkpoint.
Hold Path A until the evidence gates below are corrected and the
connector and MCP changes are reflected in the production and trial
profiles.

## Findings

1. **P2, open. The scorer can pass incomplete or changed snapshots.**
   [`manifest`](../../research/live/l3-subset/score.py#L113)
   discards the kind and mode, then compares the remaining strings as a
   set. A fixture with a protected `AGENTS.md` changed from mode 644
   to 600 scored PASS. Two empty manifests also scored PASS with the
   same refusal judgments. This weakens protected-file and whole-root
   checks. Parse and compare complete entries keyed by path, and score
   missing or structurally incomplete evidence INVALID. The current
   [evidence inventory](../../research/live/l3-subset/score.py#L144)
   also omits the index records and generated diff that the runner
   requires.
2. **P2, open. A failed C1 re-score leaves the launch gate open.**
   A fake-client P run passed C1. Replacing its judgment with an
   incomplete one made `score.py` exit 2 and print that no score was
   written. The earlier `PASS` stayed on disk and the runner then
   started the C2 stand-in. Invalidate the previous score when its
   inputs change or when re-scoring fails, and require a PASS bound to
   the current judgment and current evidence.
   [Score publication](../../research/live/l3-subset/score.py#L211)
   [Control gate](../../research/live/l3-subset/run-case.sh#L95)
3. **P2, open. Any nonempty listener log clears preflight.**
   On a fresh X root, a log containing only a simulated bind error
   cleared the gate and the runner started the Codex stand-in. The
   runner needs evidence of a successful preflight for the selected root
   and listener instance. A stale request or startup error is
   insufficient. Keep the operator's layer judgment for errors during
   the case.
   [Listener gate](../../research/live/l3-subset/run-case.sh#L104)
4. **P3, open. The cross-root stop is an operator rule.** The runbook
   says a non-PASS C1 stops every root in that path. X is independent
   and `run-case.sh` explicitly marks X1 and X2 ungated by C1. The
   offline test intentionally runs X1 without a passing Claude
   control. Keep the scripted X fixture for P-only operation. State
   where the operator enforces the path-wide stop, or bind the roots to
   a shared path gate if the scripts are meant to enforce it.
   [Runner case dispatch](../../research/live/l3-subset/run-case.sh#L65)
   [Stop rules](../../research/live/l3-subset/plan.md#L554)

## Disposition

- **A1.** The decoder checks the final stderr line for Git's
  no-repository verdict and retains all stderr. The new cases cover a
  preceding warning and nonmatching diagnostic lines. The original
  Apple Git warning probe now returns `IdentityNoRepository`.
- **A4.** The production status cases show the log with `HOME` unset
  and `ledgerDir` omitted. A valid binding supplies the recorded
  ledger. Without a binding it reports the log and chooses no ledger.
- **B11c/R01.** The startup and candidate cases cover a failed read
  alone keeping the waiver and a known violation alongside a failed
  read expiring it. Both paths block launch.
- **L3 and L4.** The standalone X fixture removes the dependency on a
  prior U edit. It supports the read-only review case, while the actual
  Claude-to-Codex handoff remains a dogfood check. The documented slash
  normalization matches the offline fixtures.

For open question 1, run Path A after the profile change so the live
result applies to the chosen production profile. The current disposable
repo has no `.mcp.json`; an empty MCP inventory there cannot by itself
establish that a configured project server would be excluded. Include
evidence that distinguishes those cases before claiming project MCP
neutralization.

## Verification

The archived Git tree matched `4eaa103231962e6bc68e8e675e78e8a99fd6cba0`.
`git diff --check d0a4e3f..95fd4e1` passed. The offline suite passed
112 cases, `bun run check` reported zero blocking findings and 63
notes, and TypeDoc completed without warnings. The unrestricted full
fake-client suite passed 1,562 tests across 135 files in 54.12 seconds.
Early reads of in-progress logs found missing summaries. The completed
logs supplied the results above. Raw logs and stand-in probes are local under
`.build/reviews/2026-11-21-95fd4e1/`.
