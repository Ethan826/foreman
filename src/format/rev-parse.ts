// Decoders for single-value `git rev-parse` output (git-rev-parse(1)):
// git prints the value and one newline. Exactly one trailing newline is
// removed and nothing else, so a path that itself ends in or contains a
// newline survives (owner's correction to ruling 4 on B11a). Each value is
// read by its own `rev-parse`, so no value is split from another at a
// newline.
import { Result, Schema, SchemaTransformation, String } from "effect"
import { Revision } from "../domain/ids.ts"
import { GitText } from "../domain/worktree.ts"

/** The newline git prints after each value. */
const lineEnd = "\n"

/** The number of characters in {@link lineEnd}. */
const lineEndLength = 1

/** An absolute path: non-empty and starting with `/`. */
const AbsolutePath = GitText.check(Schema.isStartingWith("/"))

/** Removes the final newline, which the check in {@link lineOf} guarantees. */
const dropLineEnd = String.slice(0, -lineEndLength)

/** Adds the newline back, for the encoding direction. */
const addLineEnd = (value: string): string => `${value}${lineEnd}`

/** One output line: text ending in a newline, decoded to the text before it. */
const lineOf = <Value>(value: Schema.Codec<Value, string>) =>
  Schema.String.check(Schema.isEndingWith(lineEnd)).pipe(
    Schema.decodeTo(value, SchemaTransformation.transform({ decode: dropLineEnd, encode: addLineEnd })),
  )

const decodeLine = Schema.decodeUnknownResult(lineOf(GitText))
const decodePathLine = Schema.decodeUnknownResult(lineOf(AbsolutePath))
const decodeRevisionLine = Schema.decodeUnknownResult(lineOf(Revision))

/**
 * Decodes one value of `rev-parse`, such as `--symbolic-full-name HEAD`:
 * the text before the one trailing newline, which must be non-empty.
 * Fails when there is no trailing newline or nothing before it.
 */
export const decodeRevParseLine = (text: string): Result.Result<string, Schema.SchemaError> =>
  decodeLine(text)

/**
 * Decodes one absolute path from `rev-parse`, such as `--show-toplevel` or
 * `--absolute-git-dir`: as {@link decodeRevParseLine}, and the value must
 * start with `/`.
 */
export const decodeRevParsePath = (text: string): Result.Result<string, Schema.SchemaError> =>
  decodePathLine(text)

/**
 * Decodes `rev-parse HEAD` in the owner's checkout as a {@link Revision}
 * (owner ruling on R2 of the B11a review: Format decodes, not Runtime).
 * Fails when there is no trailing newline or the text before it is not
 * an object id.
 */
export const decodeRevParseRevision = (text: string): Result.Result<Revision, Schema.SchemaError> =>
  decodeRevisionLine(text)
