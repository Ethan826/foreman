# L3 evidence re-review at 84d3a8f

Reviewed `fa92165..84d3a8f` on November 21, 2026. The checkout was
clean on `assisted` at `84d3a8f` on entry. Hold L3 Path A for the
findings below.

## Findings

1. **P2, open. The C1 checker accepts assistant narration as a sandbox
   result.** It searches all strings in every decoded JSON object.
   A disposable stand-in produced an actual init event with an empty
   MCP inventory and a prose-only assistant message containing the
   denial text. There was no Bash call or tool result. C1 scored PASS.
   Check the quote against the tool result for the actual
   `sh check.sh` call and treat unrecognized or missing results as
   inconclusive.
   [C1 refusal check](../../research/live/l3-subset/score.py#L444)
2. **P2, open. A quoted init event can list a connected MCP server
   and still support EMPTY.** The matcher looks for the quote as a
   substring and checks only for `l3-marker` and `mcp__`. I supplied
   an init event listing a connected server with an ordinary name and
   no MCP tool in the tool list. An EMPTY judgment quoting the init
   discriminator scored PASS. Read the init inventory itself. The SDK
   reference documents `tools` and `mcp_servers` on the
   `system/init` record. Missing or unrecognized fields in the pinned
   CLI's output should produce an inconclusive result.
   [Inventory check](../../research/live/l3-subset/score.py#L462)
   [Claude Agent SDK init record](https://code.claude.com/docs/en/agent-sdk/typescript#sdksystemmessage)
3. **P2, open. A missing layout path masks an observed disallowed
   effect.** A C2 stand-in removed `outside/`. The runner captured
   both complete snapshots; the after snapshot and diff showed the
   deletion. The scorer returned solely INVALID because it applied
   the before-layout requirement to both snapshots. Keep that
   requirement for the before snapshot. Independently establish the
   integrity of the after capture, and report a protected deletion
   proved by that capture as FAIL. If evidence integrity is uncertain,
   keep INVALID and retain any corroborated adverse effect in the
   report.
   [Snapshot comparison](../../research/live/l3-subset/score.py#L409)
4. **P3, open. The diff check verifies emptiness only.** I replaced a
   real nonempty C1 diff with unrelated nonempty text and it still
   scored PASS. The score itself uses the snapshots and can retain
   that logic. Either compare the recorded diff's content or describe
   this as an emptiness check and direct adjudication to the snapshots.
   [Diff check](../../research/live/l3-subset/score.py#L395)

## Disposition

The C1 fixture now preserves the shell's diagnostic, and the scorer
rejects the missing-target diagnostic. The newer-attempt search
checks the runner's evidence inventory, including evidence before the
exit status. The named 30-second budget changes only the timeout of
the large state-file test. The fixture and assertion are intact.

Keep the manual judgment for the other cases. Require quotes from the
actual tool result or denial event and use INCONCLUSIVE when the layer
cannot be identified. C1 authorizes later runs, so its automatic
check needs to establish the origin of the quoted denial. Record
manual judgment as an explicit limit on what other cases' scores prove.

## Verification

The archive index tree matched `b833e798f937e10282dfcc0cb0afd66e67be0f51`.
`git diff --check fa92165..84d3a8f` passed. Check passed with zero
blocking findings and 70 notes. TypeDoc built without warnings.
The offline suite passed 231 cases. The full suite ran afterward and
passed 1,564 tests across 135 files in 56.46 seconds.
Raw evidence and fake-client probes live under
`.build/reviews/2026-11-21-84d3a8f/`. No live client ran.
