// The target binding file (batch review B04): the bound target as one
// JSON object with a final newline. Decoding is strict, so a file with an
// unknown or missing key is unreadable rather than half understood.
import { Formatter, Result, Schema, String } from "effect"
import { TargetBinding } from "../domain/target.ts"
import { withoutByteOrderMark } from "./byte-order-mark.ts"

/** The indent of the file's JSON, in spaces. */
const jsonIndent = 2

const decodeFile = Schema.decodeUnknownResult(Schema.fromJsonString(TargetBinding), { onExcessProperty: "error" })

/** The file's text for `target`. */
export const encodeTargetBinding = (target: TargetBinding): string =>
  `${Formatter.formatJson(target, { space: jsonIndent })}\n`

/**
 * The bound target, or the decoder's message when the text is not one.
 * One leading byte order mark is dropped first (focused re-review
 * finding 2).
 */
export const decodeTargetBinding = (text: string): Result.Result<TargetBinding, string> =>
  Result.mapError(decodeFile(withoutByteOrderMark(text)), (error) => String.trim(error.message))
