// A client's stdout as lines (plan "Injected capabilities", `StartClient`;
// write protocol step 6; review finding R04). The bytes arrive in chunks
// of any size. Each line is put together from its bytes first, across
// chunk boundaries, and only then decoded as strict UTF-8, so a character
// split across two chunks decodes whole and a line holding bytes that are
// not UTF-8 is an `UndecodableLine` rather than text with U+FFFD in it.
//
// The split is Effect's `Stream.splitLines` (lines end at `\n`, `\r\n` or
// `\r`, a `\r\n` split across chunks ends one line) run over byte text:
// each byte becomes the character with the same code, U+0000 to U+00FF.
// That is safe because the bytes of `\n` and `\r` never occur inside a
// UTF-8 multi-byte sequence, so the line ends found in byte text are the
// line ends of the decoded text.
import { Option, Result, Stream } from "effect"
import { type StdoutLine, UndecodableLine } from "../domain/process.ts"
import { strictUtf8 } from "./strict-utf8.ts"

/**
 * The lines of a byte stream, without their ends, each decoded as strict
 * UTF-8 once it is whole; a line that is not UTF-8 is an
 * {@link UndecodableLine}. A last line with no end is still a line.
 */
export const stdoutLines = <E>(chunks: Stream.Stream<Uint8Array, E>): Stream.Stream<StdoutLine, E> =>
  chunks.pipe(Stream.map(byteText), Stream.splitLines, Stream.map(decodedLine))

/** The bytes of a chunk as byte text: one character per byte, with the byte's code. */
const byteText = (chunk: Uint8Array): string => Array.from(chunk, byteCharacter).join("")

/** The character whose code is `byte`. */
const byteCharacter = (byte: number): string => String.fromCharCode(byte)

/** The byte whose code a byte-text character has. */
const characterByte = (character: string): number => character.charCodeAt(0)

/** A line of byte text decoded as strict UTF-8, or an {@link UndecodableLine}. */
const decodedLine = (line: string): StdoutLine => {
  const bytes = Uint8Array.from(line, characterByte)
  return Option.match(strictUtf8(bytes), {
    onNone: () => Result.fail(new UndecodableLine({ byteLength: bytes.byteLength })),
    onSome: Result.succeed,
  })
}
