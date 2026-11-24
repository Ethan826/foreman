// The target binding file (batch review B04): the bound target as one
// JSON object with a final newline. Decoding is strict, so a file with an
// unknown or missing key is unreadable rather than half understood, and so
// is one whose ledger path is not absolute: tarlatan only ever records an
// absolute path, and a relative one would open the ledger relative to the
// working directory (owner finding F11, dogfood-2).
import { Formatter, Result, Schema, String } from "effect"
import { TargetBinding } from "../domain/target.ts"
import { withoutByteOrderMark } from "./byte-order-mark.ts"

/** The indent of the file's JSON, in spaces. */
const jsonIndent = 2

/** The root directory, with which every absolute path starts. */
const root = "/"

const decodeFile = Schema.decodeUnknownResult(Schema.fromJsonString(TargetBinding), { onExcessProperty: "error" })

/** The file's text for `target`. */
export const encodeTargetBinding = (target: TargetBinding): string =>
  `${Formatter.formatJson(target, { space: jsonIndent })}\n`

/**
 * The bound target, or the decoder's message when the text is not one.
 * One leading byte order mark is dropped first (focused re-review
 * finding 2). A binding whose ledger path is not absolute is refused with
 * a message that says so (owner finding F11, dogfood-2).
 */
export const decodeTargetBinding = (text: string): Result.Result<TargetBinding, string> =>
  Result.flatMap(
    Result.mapError(decodeFile(withoutByteOrderMark(text)), (error) => String.trim(error.message)),
    absoluteLedger,
  )

/** `target` when its ledger path is absolute; otherwise the reason it is refused. */
const absoluteLedger = (target: TargetBinding): Result.Result<TargetBinding, string> =>
  String.startsWith(root)(target.ledger)
    ? Result.succeed(target)
    : Result.fail(`the ledger path ${Formatter.formatJson(target.ledger)} is not absolute`)
