// Decoding a client's stdout for classification (review item B13): a
// line that is not JSON, is not an event object, or is an outcome-bearing
// event that does not decode makes the attempt `Unclassified`, which is
// close-only. Event types that bear no outcome are passed over, so the
// ordinary extra items of either vendor's stream leave a run usable.
import { describe, expect, it } from "@effect/vitest"
import { Option, Result } from "effect"
import { Success, Unclassified } from "../../src/domain/outcomes.ts"
import type { StdoutLine } from "../../src/domain/process.ts"
import { Roles } from "../../src/domain/roles.ts"
import { classifyAttempt } from "../../src/features/step-outcome.ts"
import { claudeDecoded, codexDecoded } from "../../src/program/client-output.ts"
import { claudeSuccess } from "../fixtures/clients/claude-success.ts"
import { codexCompletedLines } from "../fixtures/clients/codex-events.ts"
import { exitedWith } from "../fixtures/clients/fake-client.ts"

/** Text lines as the starter streams them. */
const asLines = (lines: ReadonlyArray<string>): ReadonlyArray<StdoutLine> => lines.map((line) => Result.succeed(line))

/** An implementer's outcome from Claude's lines, with exit code 0. */
const claudeOutcome = (lines: ReadonlyArray<string>) =>
  classifyAttempt(Roles.Implementer, exitedWith(0), { client: claudeDecoded(asLines(lines)), findings: Option.none() })

/** A reviewer's outcome from Codex's lines, with exit code 0 and an empty findings block. */
const codexOutcome = (lines: ReadonlyArray<string>) =>
  classifyAttempt(Roles.Reviewer, exitedWith(0), {
    client: codexDecoded(asLines(lines)),
    findings: Option.some(Result.succeed([])),
  })

describe("Claude's stream-json", () => {
  it("is Success for the recorded successful run", () => {
    expect(claudeOutcome(claudeSuccess.lines)).toEqual(new Success())
  })

  it("is Unclassified when a line after the success result is not JSON", () => {
    expect(claudeOutcome([...claudeSuccess.lines, '{"type": "result", "subtype"'])).toEqual(new Unclassified())
  })

  it("is Unclassified when a result event does not decode", () => {
    const malformed = '{"type": "result", "subtype": "success", "is_error": "no"}'
    expect(claudeOutcome([malformed, ...claudeSuccess.lines])).toEqual(new Unclassified())
  })

  it.each(["42", '"result"', "[]", '{"subtype": "success"}', '{"type": 7}'])(
    "is Unclassified when a line is %s, which is not an event object",
    (line) => {
      expect(claudeOutcome([...claudeSuccess.lines, line])).toEqual(new Unclassified())
    },
  )

  it("stays Success with extra events that bear no outcome", () => {
    const extra = [
      '{"type": "user", "message": {"role": "user"}}',
      '{"type": "system", "subtype": "compact_boundary"}',
      '{"type": "stream_event", "event": {"type": "content_block_delta"}}',
    ]
    expect(claudeOutcome([...extra, ...claudeSuccess.lines])).toEqual(new Success())
  })
})

describe("Codex's --json events", () => {
  it("is Success for the recorded completed turn", () => {
    expect(codexOutcome(codexCompletedLines)).toEqual(new Success())
  })

  it("is Unclassified when a known error event after turn.completed does not decode", () => {
    expect(codexOutcome([...codexCompletedLines, '{"type": "error", "message": 7}'])).toEqual(new Unclassified())
  })

  it("is Unclassified when a line is not JSON", () => {
    expect(codexOutcome([...codexCompletedLines, "turn.completed"])).toEqual(new Unclassified())
  })

  it("is Unclassified when a turn.completed event does not decode", () => {
    const malformed = '{"type": "turn.completed", "usage": 5}'
    expect(codexOutcome([...codexCompletedLines, malformed])).toEqual(new Unclassified())
  })

  it("stays Success with extra item events that bear no outcome", () => {
    const extra = [
      '{"type": "item.started", "item": {"id": "item_0", "type": "command_execution"}}',
      '{"type": "item.updated", "item": {"id": "item_0"}}',
    ]
    expect(codexOutcome([...extra, ...codexCompletedLines])).toEqual(new Success())
  })
})
