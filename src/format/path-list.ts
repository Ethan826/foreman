// Decoder for a NUL-terminated path list, as `git ls-files -z` prints it
// (git-ls-files(1), `-z`; review finding B08): each path is printed
// verbatim and followed by a NUL, and a directory keeps its trailing
// slash. The decoder is strict: output that is not empty and not
// NUL-terminated, or an empty path, makes the whole output undecodable,
// never a shorter list. A NUL cannot occur in a path, so the split is
// unambiguous.
import { Array as Arr, Result, Schema, String } from "effect"

/** The byte that ends every path. */
const pathEnd = "\0"

/** A path list that does not decode, with the reason. */
export class PathListUndecodable extends Schema.TaggedError<PathListUndecodable>()(
  "PathListUndecodable",
  { reason: Schema.String },
) {}

/**
 * Decodes NUL-terminated `output` into its paths, in git's order; empty
 * output is no paths. Fails with {@link PathListUndecodable} when the
 * output does not end in a NUL or holds an empty path.
 */
export const decodePathList = (output: string): Result.Result<ReadonlyArray<string>, PathListUndecodable> =>
  String.isEmpty(output) || String.endsWith(pathEnd)(output)
    ? nonEmptyPaths(Arr.dropRight(String.split(output, pathEnd), 1))
    : Result.fail(new PathListUndecodable({ reason: "the output does not end in a NUL" }))

/** The paths when none is empty. */
const nonEmptyPaths = (paths: ReadonlyArray<string>): Result.Result<ReadonlyArray<string>, PathListUndecodable> =>
  Arr.some(paths, String.isEmpty)
    ? Result.fail(new PathListUndecodable({ reason: "a path is empty" }))
    : Result.succeed(paths)
