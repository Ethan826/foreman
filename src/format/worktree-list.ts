// Decoder for `git worktree list --porcelain` (git-worktree(1), "Porcelain
// Format"): one block per worktree, blocks separated by an empty line, each
// line an attribute name and an optional value after the first space. The
// first line of a block is `worktree <path>`. Attributes decoded here:
// HEAD, branch, detached, bare and locked (with or without a reason).
// Others, such as `prunable`, are ignored, since git may add attributes.
//
// Blind spot: without `-z`, git quotes a path or lock reason that holds
// unusual characters such as a newline; such a value is decoded with its
// quotes, so a quoted path never equals a recorded path and the startup
// check reports it as not listed.
import { Array as Arr, Option, Record, Result, Schema, String } from "effect"
import type { WorktreeEntry } from "../domain/worktree.ts"
import { GitText } from "../domain/worktree.ts"
import { Revision } from "../domain/ids.ts"

/** The separator between an attribute name and its value. */
const attributeSeparator = " "

/**
 * One block's attributes as git prints them. A flag attribute (detached,
 * bare, a reasonless locked) has the empty string as its value.
 */
const PorcelainBlock = Schema.Struct({
  worktree: GitText,
  HEAD: Schema.optionalKey(Revision),
  branch: Schema.optionalKey(GitText),
  detached: Schema.optionalKey(Schema.String),
  bare: Schema.optionalKey(Schema.String),
  locked: Schema.optionalKey(Schema.String),
})
type PorcelainBlock = typeof PorcelainBlock.Type

const decodeBlocks = Schema.decodeUnknownResult(Schema.Array(PorcelainBlock))

/**
 * Decodes the text of `git worktree list --porcelain` into its entries, in
 * listing order. Empty text is no entries. Fails when a block has no
 * `worktree` line, an empty path or branch, or a HEAD that is not an
 * object id.
 */
export const decodeWorktreeList = (
  text: string,
): Result.Result<ReadonlyArray<WorktreeEntry>, Schema.SchemaError> =>
  Result.map(decodeBlocks(Arr.map(blocksOf(text), attributesOf)), Arr.map(toEntry))

/** The non-empty blocks of the listing, each as its non-empty lines. */
const blocksOf = (text: string): ReadonlyArray<ReadonlyArray<string>> =>
  Arr.filter(Arr.map(String.split(text, "\n\n"), linesOf), Arr.isReadonlyArrayNonEmpty)

/** A block's non-empty lines. */
const linesOf = (block: string): ReadonlyArray<string> =>
  Arr.filter(String.split(block, "\n"), String.isNonEmpty)

/** A block's lines as a record from attribute name to value; a later duplicate wins. */
const attributesOf = (lines: ReadonlyArray<string>): Record.ReadonlyRecord<string, string> =>
  Record.fromEntries(Arr.map(lines, attributeOf))

/** One line split at its first space into a name and a value (empty when absent). */
const attributeOf = (line: string): readonly [string, string] => {
  const [name, ...rest] = String.split(line, attributeSeparator)
  return [name, Arr.join(rest, attributeSeparator)]
}

/** A decoded block as an entry: flags become booleans, an empty reason none. */
const toEntry = (block: PorcelainBlock): WorktreeEntry => ({
  path: block.worktree,
  head: Option.fromNullishOr(block.HEAD),
  branch: Option.fromNullishOr(block.branch),
  detached: Option.isSome(Option.fromNullishOr(block.detached)),
  bare: Option.isSome(Option.fromNullishOr(block.bare)),
  lock: Option.map(Option.fromNullishOr(block.locked), lockOf),
})

/** A lock from the `locked` line's value; the empty value is a lock without a reason. */
const lockOf = (reason: string) => ({
  reason: Option.liftPredicate(reason, String.isNonEmpty),
})
