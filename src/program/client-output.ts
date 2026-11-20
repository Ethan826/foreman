// A client's stdout lines decoded for classification (plan "Outcomes and
// usable attempts"; review items B13, M05 and R04): each line is read with
// Format's stream-line reader. An event type that bears no outcome is
// passed over; an outcome-bearing event is decoded; and a line that is
// not UTF-8, is not JSON, is not an event object, or is an
// outcome-bearing event that does not decode is kept as malformed, which
// classification makes `Unclassified`. An absent result is itself
// `Unclassified`. Text read from a file's bytes is strict UTF-8 too:
// bytes that are not UTF-8 never become U+FFFD.
import { Array as Arr, Effect, Option, Result, Stream } from "effect"
import type { StdoutLine, UndecodableLine } from "../domain/process.ts"
import { claudeStreamLine, resultText } from "../format/claude.ts"
import { codexStreamLine, reportsCompletedTurn, reportsFailure } from "../format/codex.ts"
import type { StreamLine } from "../format/stream-line.ts"
import { ClaudeDecoded, CodexDecoded } from "../features/step-outcome.ts"
import { strictUtf8 } from "../runtime/strict-utf8.ts"
import { FileNotUtf8 } from "./session-errors.ts"

/** Claude's stream-json lines as classification reads them: the last `result` event and the malformed lines. */
export const claudeDecoded = (lines: ReadonlyArray<StdoutLine>): ClaudeDecoded => {
  const [malformed, events] = separated(lines, claudeStreamLine)
  return new ClaudeDecoded({ result: Arr.last(events), malformed })
}

/**
 * Claude's handoff (plan "Events", `ReportRecorded`): the final message
 * of the last `result` event that decodes, as UTF-8 bytes; empty when
 * the stream holds no such result or the result no message.
 */
export const claudeHandoff = (lines: ReadonlyArray<StdoutLine>) =>
  utf8Bytes(
    Option.getOrElse(Option.flatMap(Arr.last(separated(lines, claudeStreamLine)[1]), resultText), () => ""),
  )

/**
 * Codex's `--json` lines as classification reads them: whether an event
 * reports a completed turn or a failure, and the malformed lines.
 */
export const codexDecoded = (lines: ReadonlyArray<StdoutLine>): CodexDecoded => {
  const [malformed, events] = separated(lines, codexStreamLine)
  return new CodexDecoded({
    turnCompleted: Arr.some(events, reportsCompletedTurn),
    failureReported: Arr.some(events, reportsFailure),
    malformed,
  })
}

/** UTF-8 text as bytes, for a file built from text. */
export const utf8Bytes = (text: string) =>
  Stream.runFold(Stream.encodeText(Stream.make(text)), () => new Uint8Array(), concatenated)

/**
 * Bytes read as UTF-8 text, replacing bytes that are not UTF-8 with
 * U+FFFD. Kept only for the foreman configuration and the target binding;
 * a launch command reads its files with {@link strictText}.
 */
export const utf8Text = (bytes: Uint8Array) => Stream.mkString(Stream.decodeText(Stream.make(bytes)))

/**
 * The bytes of the file at `path` as strict UTF-8 text (review finding
 * R04); fails with {@link FileNotUtf8} when they are not UTF-8. A leading
 * byte order mark is kept as U+FEFF.
 */
export const strictText = (path: string, bytes: Uint8Array) =>
  Effect.fromOption(strictUtf8(bytes), () => new FileNotUtf8({ path }))

/** Each line read: the malformed lines' reasons, and the outcome-bearing events in order. */
const separated = <A>(lines: ReadonlyArray<StdoutLine>, read: (line: string) => StreamLine<A>) => {
  const readLine = (line: StdoutLine): StreamLine<A> => Result.match(line, { onSuccess: read, onFailure: undecodable })
  const [outcomes, malformed] = Arr.separate(Arr.map(lines, readLine))
  return [malformed, Arr.getSomes(outcomes)] as const
}

/** A stdout line that is not UTF-8, read as malformed. */
const undecodable = (line: UndecodableLine): StreamLine<never> =>
  Result.fail(`a line of ${String(line.byteLength)} bytes is not valid UTF-8`)

/** Two byte arrays, one after the other. */
const concatenated = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  const joined = new Uint8Array(left.byteLength + right.byteLength)
  joined.set(left)
  joined.set(right, left.byteLength)
  return joined
}
