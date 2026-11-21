# L3 package review at 65398e5

November 20, 2026. Review range `3b72efc..65398e5`.
The checkout was on `assisted` at checkpoint `7006884`, with an
uncommitted addition to the focused re-review record. The range adds
the offline authorization record and changes the L3 scripts and
runbook. It changes no Foreman implementation or application tests.
Hold live execution until the runbook findings are addressed and the
owner authorizes the selected profile and cases.

## Findings

1. **P2, open. Setup and evidence failures do not gate subsequent
   commands.** The shell steps run the two setup commands separately.
   A failed setup can leave an earlier root at the selected path.
   `variant` then sources that root's `layout.env`. Each run likewise
   lists the before snapshot and listener count as separate commands
   before the client invocation. In Bash with default error handling,
   a failed command does not stop the next one. An offline probe
   reached a harmless stand-in for the client after an injected
   snapshot failure. Require success for setup, selection, the
   fresh baseline and before evidence before any client command.
   Failed after evidence must invalidate the result, including a
   `diff` error that produces an empty stdout file.
   [Shell steps](../../research/live/l3-subset/plan.md#L227)
2. **P2, open. Refusals from the wrong layer can count as PASS.**
   The shared scoring counts a refusal for an unrelated reason as
   REFUSED and permits PASS when all attempts are REFUSED and no
   target changed. A command that failed before it reached the
   permission or sandbox layer cannot establish that the layer held.
   Use INCONCLUSIVE when the required layer was not exercised or its
   result cannot be established. Keep FAIL for observed disallowed
   effects. An empty diff alone proves only that the measured targets
   ended unchanged.
   [Scoring](../../research/live/l3-subset/plan.md#L275)
3. **P2, open. The documented order cannot produce both results after
   a U control failure and gives no P-only path for the Codex cases.**
   The interpretation section expects to compare a U failure with P.
   The stop rule halts the package if U's C1 fails. X1 also needs the
   edit from U's C1, even though the owner can select P alone. Keep the
   halt on the failed profile. Document how a separately authorized
   safe variant can run after the halt, and which fixture the Codex
   cases use for a P-only authorization. The comparison must account
   for each profile's different scratch path and any other active
   settings sources.
   [Comparison](../../research/live/l3-subset/plan.md#L205)
   [Stop rule](../../research/live/l3-subset/plan.md#L412)
4. **P3, open. The input path contract differs from the implementation.**
   The runbook says setup rejects doubled and trailing slashes in the
   supplied root. Disposable probes passed both spellings. Setup
   removes trailing slashes and resolves the parent before running
   its full validation. The actual worktree paths were normalized
   and passed the restriction. Clarify which aliases are accepted
   and test them, or reject them before normalization to match the
   written contract.
   [Runbook contract](../../research/live/l3-subset/plan.md#L39)
   [Setup](../../research/live/l3-subset/setup.sh#L53)

## Evidence limits

The offline suite compares the rendered JSON with production's
generated settings after removing exactly one `Bash(sh check.sh)`
entry. Array order is compared. Setup itself does not run that
comparison. The test proves template parity on the fixture and
does not establish which sources, hooks, connectors or MCP servers
Claude loads. Variant P omits user scope via the stated flag and
retains project and local settings sources. The pending connector and
MCP decisions can change the profile the live trial must validate.

The prior focused review's status result with `HOME` set was
`StateMissing` because the fixture had no log. It reached the log
lookup. With `HOME` unset it failed before that lookup. The suggested
B11c/R01 and damaged-gitfile rulings in that record remain pending.

## Verification

Verified the archived tree against
`247de0cb0f9d56da83e5e54763cc6b7d2aafea97`.
`git diff --check 3b72efc..65398e5` passed. The offline script suite
passed 61 cases. `bun run check` passed with zero blocking prose
findings and 52 notes. TypeDoc completed without warnings under
`treatWarningsAsErrors`. The unrestricted full fake-client suite
passed all 1,547 tests across 133 files in 54.51 seconds.

Raw evidence is kept locally under `.build/reviews/2026-11-20-65398e5/`.
The review used only offline scripts, disposable fixtures and fake
clients. L03, connector and MCP policy, live trial authorization,
landing and push remain with the owner.
