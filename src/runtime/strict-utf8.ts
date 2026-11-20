// Strict UTF-8 decoding for bytes that come from outside: git's output
// and the names of directory entries (review finding B17). Bytes that are
// not UTF-8 are a failure, never U+FFFD, so two different byte strings
// cannot decode to one text. A leading byte order mark is kept as U+FEFF.
import { Option, Result } from "effect"
import { TextDecoder } from "node:util"

/**
 * The WHATWG decoder with `fatal`, which throws instead of replacing
 * invalid bytes, and `ignoreBOM`, which keeps a leading byte order mark.
 */
const strictDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

/** The text of `bytes` when they are valid UTF-8, and none otherwise. */
export const strictUtf8 = (bytes: Uint8Array): Option.Option<string> =>
  Result.getSuccess(Result.try(() => strictDecoder.decode(bytes)))
