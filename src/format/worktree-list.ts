// Decoder for `git worktree list --porcelain -z` (git-worktree(1),
// "Porcelain Format"; owner ruling 4 on B11a): one record per worktree,
// each attribute ending in NUL and each record ending in one more NUL, so
// records split at an empty field. An attribute is a name and an optional
// value after the first space. The first attribute of a record is
// `worktree <path>`. Attributes decoded here: HEAD, branch, detached, bare
// and locked (with or without a reason). Others, such as `prunable`, are
// ignored, since git may add attributes.
//
// Why `-z` (probed with git 2.50.1): without it, git prints a path raw,
// never quoted, so a newline in a path splits its record, and it quotes a
// lock reason with unusual characters. With `-z` both come through
// verbatim. A NUL cannot occur in a path, so the split is unambiguous.
import { Array as Arr, Option, Record, Result, Schema, String } from "effect"
import type { WorktreeEntry } from "../domain/worktree.ts"
import { GitText } from "../domain/worktree.ts"
import { Revision } from "../domain/ids.ts"

/** The separator between an attribute name and its value. */
const attributeSeparator = " "

/** The byte that ends every attribute, and a record when it follows one. */
const fieldEnd = "\0"

/**
 * One record's attributes as git prints them. A flag attribute (detached,
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

/** Records gathered so far; the last is the one being filled. */
type Records = Arr.NonEmptyReadonlyArray<ReadonlyArray<string>>

/** The fold's start: one empty record. */
const oneEmptyRecord: Records = [[]]

/**
 * Decodes the text of `git worktree list --porcelain -z` into its entries,
 * in listing order. Empty text is no entries. Fails when a record has no
 * `worktree` attribute, an empty path or branch, or a HEAD that is not an
 * object id.
 */
export const decodeWorktreeList = (
  text: string,
): Result.Result<ReadonlyArray<WorktreeEntry>, Schema.SchemaError> =>
  Result.map(decodeBlocks(Arr.map(recordsOf(text), attributesOf)), Arr.map(toEntry))

/**
 * The non-empty records of the listing, each as its attributes. Splitting
 * at every NUL and starting a record at each empty field also drops the
 * empty field after the last record.
 */
const recordsOf = (text: string): ReadonlyArray<ReadonlyArray<string>> =>
  Arr.filter(
    Arr.reduce(String.split(text, fieldEnd), oneEmptyRecord, addField),
    Arr.isReadonlyArrayNonEmpty,
  )

/** Adds one field: an empty field starts a new record, any other joins the last. */
const addField = (records: Records, field: string): Records =>
  String.isEmpty(field)
    ? Arr.append(records, [])
    : Arr.modifyLastNonEmpty(records, Arr.append(field))

/** A record's attributes as a record from name to value; a later duplicate wins. */
const attributesOf = (fields: ReadonlyArray<string>): Record.ReadonlyRecord<string, string> =>
  Record.fromEntries(Arr.map(fields, attributeOf))

/** One attribute split at its first space into a name and a value (empty when absent). */
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
