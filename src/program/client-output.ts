// A client's stdout lines decoded for classification (plan "Outcomes and
// usable attempts"): each line is read as JSON and then as a client event
// with Format's decoders. A line that is not JSON, or is an event type the
// decoders do not know, is skipped; classification reads only the events
// it names, and an absent result is itself `Unclassified`.
import { Array as Arr, Option, Result, Schema, Stream } from "effect"
import { ClaudeResult, decodeClaudeEvent, resultText } from "../format/claude.ts"
import { decodeCodexEvent } from "../format/codex.ts"
import { ClaudeDecoded, CodexDecoded } from "../features/step-outcome.ts"

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

/** Claude's stream-json lines as classification reads them: the last `result` event. */
export const claudeDecoded = (lines: ReadonlyArray<string>): ClaudeDecoded =>
  new ClaudeDecoded({ result: lastClaudeResult(lines) })

/**
 * Claude's handoff (plan "Events", `ReportRecorded`): the final message
 * of the last `result` event, as UTF-8 bytes; empty when the stream
 * holds no result or the result no message.
 */
export const claudeHandoff = (lines: ReadonlyArray<string>) =>
  utf8Bytes(Option.getOrElse(Option.flatMap(lastClaudeResult(lines), resultText), () => ""))

/** Codex's `--json` lines as classification reads them: every decoded event, in order. */
export const codexDecoded = (lines: ReadonlyArray<string>): CodexDecoded =>
  new CodexDecoded({ events: Arr.flatMap(lines, codexEventOf) })

/** UTF-8 text as bytes, for a file built from text. */
export const utf8Bytes = (text: string) =>
  Stream.runFold(Stream.encodeText(Stream.make(text)), () => new Uint8Array(), concatenated)

/** Bytes read as UTF-8 text. */
export const utf8Text = (bytes: Uint8Array) => Stream.mkString(Stream.decodeText(Stream.make(bytes)))

/** The last `result` event among Claude's lines. */
const lastClaudeResult = (lines: ReadonlyArray<string>) =>
  Arr.last(Arr.filter(Arr.flatMap(lines, claudeEventOf), Schema.is(ClaudeResult)))

/** One line's Claude event, if it decodes. */
const claudeEventOf = (line: string) =>
  Option.toArray(Option.flatMap(decodeJson(line), (value) => Result.getSuccess(decodeClaudeEvent(value))))

/** One line's Codex event, if it decodes. */
const codexEventOf = (line: string) =>
  Option.toArray(Option.flatMap(decodeJson(line), (value) => Result.getSuccess(decodeCodexEvent(value))))

/** Two byte arrays, one after the other. */
const concatenated = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  const joined = new Uint8Array(left.byteLength + right.byteLength)
  joined.set(left)
  joined.set(right, left.byteLength)
  return joined
}
