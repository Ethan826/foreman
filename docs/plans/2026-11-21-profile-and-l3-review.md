# Review of the dogfood profile and L3 gates

November 21, 2026. Reviewed `95fd4e1..fa70235`. The checkout was clean
on `assisted` at `fa70235` on entry. Hold Path A for the open evidence
findings below. The dogfood rehearsal remains offline evidence.

## Findings

1. **P2, open. C1 discards the diagnostic required to score its sandbox
   probe.** The fixture redirects the outside write's stderr to
   `/dev/null` and prints the same `outside-write: refused` for every
   error. A disposable probe moved the target directory aside, ran the
   generated `check.sh` and got `outside-write: refused`,
   `check: done` and exit 0. The runbook requires the OS refusal for
   that target. Preserve the diagnostic as C4 does, and test that a
   missing target is inconclusive. The offline C1 PASS currently
   supplies the expected denial text as a synthetic judgment.
   [Fixture](../../research/live/l3-subset/setup.sh#L213)
   [Evidence rule](../../research/live/l3-subset/plan.md#L454)
2. **P2, open. The scorer can still pass missing evidence.** With
   legitimate before rows and an otherwise complete test record, C6
   scored PASS with a zero-byte stdout stream. Separate controls also
   passed with an after snapshot reduced to its root row and with the
   listener count dropping from one to zero. For a case judged DONE,
   require observable client output. Distinguish inconsistent
   evidence from a complete manifest showing a real deletion. A
   decrease in an append-only evidence count must invalidate the
   result. A marker or stream file's existence alone does not show
   the observation was captured.
   [Evidence checks](../../research/live/l3-subset/score.py#L243)
   [Snapshot and count checks](../../research/live/l3-subset/score.py#L265)
3. **P2, open. An incomplete C1 retry can fall back to an older
   PASS.** The runner selects later attempts using only `.exit`
   files. A stand-in probe passed C1, recorded a second attempt's
   before snapshot and INVALID marker without an exit file, then
   reached the C2 stand-in. A retry interrupted before exit capture
   leaves that shape of evidence. Find the newest attempt that began
   recording evidence and require its own current PASS. Use the same
   rule for the local and path-wide checks.
   [Control selection](../../research/live/l3-subset/run-case.sh#L107)

## Profile and rehearsal

The argv builder passes `--setting-sources project,local` and
`--strict-mcp-config` without `--mcp-config`. The settings builder
sets `disableClaudeAiConnectors: true`. P derives its settings and argv
from these builders, with the recorded test command, turn cap and
timeout additions. The offline suite exercises the generated profile
and the evidence gate against stand-ins. The fixture also places
`.mcp.json` at the project root and records a marker if its process
starts.

Anthropic documents strict mode's project-server exclusion and the
connector settings key for connectors fetched by the terminal CLI.
It also documents a managed MCP file as a startup conflict with
strict mode. These are vendor statements, with live behavior for the
pinned executable still to be verified. Before scoring P's control,
check the actual init inventory as prescribed. An absent marker
without a usable init inventory cannot distinguish exclusion from
failure to discover or start the fixture. The runbook already records
the uncertainty about project approval applying in the pinned client.
[MCP project scope](https://code.claude.com/docs/en/mcp#project-scope)
[Managed MCP](https://code.claude.com/docs/en/managed-mcp#servers-passed-with-mcp-config-or-strict-mcp-config)

For the first cycle, accept the rehearsal's operating procedure:
run from a plain terminal without inherited Claude Code session
variables, run checks as the owner between handoffs, and follow
adjacent tests for the bounded task. Apply `--waive` only on a required,
owner-approved launch. Finish with a reviewed commit or an
owner-approved reset before opening another session. The committed
task names all ten existing tests and restricts changes to their split.

The checkpoint's open-decisions list still labels L03 and the profile
change pending and quotes the old two-variant usage. Synchronize it
with the profile decision and Path A. The profile TSDoc and test
comments still cite November 21 for L03, while the owner's ruling
record and AGENTS.md cite November 20.
[Checkpoint](2026-11-15-checkpoint.md)
[Profile](../../src/domain/profiles.ts#L36)

## Verification

Archived Git tree `a155114cc5bad230317d6054fb92894f889d60fe`.
`git diff --check 95fd4e1..fa70235` passed.
Check passed with zero blocking findings and 65 notes. TypeDoc passed
without warnings.

The initial offline run reached 163 passes before my 240-second
watchdog stopped it. My first retry passed a relative scratch base,
which the test script used to construct relative fixture roots.
`setup.sh` refused them, leaving 102 failed assertions. The README
should state the absolute-path requirement or the test wrapper should
enforce it once at entry. The next run used the absolute scratch base
with a longer outer deadline and passed all 180 cases.

The first unrestricted full suite ran beside the offline suite.
`test/runtime/state-files.test.ts`, “writes every byte of a large
binary file, and read returns them,” exceeded its 5,000 ms budget.
It was the only failure (1,563 of 1,564 passed). This is a recurrence
of the existing timing item in the assisted-cycle plan. The state-file
implementation and test are unchanged in this review range. The
concurrent run records a condition present at the time of failure.
It does not isolate the cause inside the test. The full suite rerun
after the offline suite finished passed all 1,564 tests in 135 files.

Raw gates and offline probes are local under
`.build/reviews/2026-11-21-fa70235/`.
