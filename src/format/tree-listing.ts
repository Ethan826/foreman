// Decoder for `git ls-tree -z` (git-ls-tree(1), "Output Format"; plan
// B11c): each record is `<mode> SP <type> SP <object> TAB <path>` followed
// by a NUL, and with `-z` the path is printed verbatim. The decoder is
// strict: output that is not empty and not NUL-terminated, or any record
// of another shape, makes the whole run undecodable, which the attribute
// check refuses (R5's lesson). A NUL cannot occur in a path, so the split
// is unambiguous. git's words for the object types are known only here
// (AGENTS.md, "Closed vocabularies"); each decoded entry carries Domain's
// `TreeEntryTypes` value instead.
import { Array as Arr, Record, Result, Schema, String } from "effect"
import type { GitResult, TreeEntry, TreeEntryType, TreeRun } from "../domain/attributes.ts"
import { TreeEntries, TreeEntryMode, TreeEntryTypes, TreeNotListed, TreeUndecodable } from "../domain/attributes.ts"
import { Revision } from "../domain/ids.ts"
import { GitText } from "../domain/worktree.ts"

/** The object types as `git ls-tree` prints them (git-ls-tree(1)). */
const gitTypes = { Blob: "blob", Tree: "tree", Commit: "commit" } as const

/** One object type as git prints it. */
const GitType = Schema.Literals(Record.values(gitTypes))

/** Domain's value for each type git prints. */
const entryTypes: Record.ReadonlyRecord<typeof GitType.Type, TreeEntryType> = {
  [gitTypes.Blob]: TreeEntryTypes.Blob,
  [gitTypes.Tree]: TreeEntryTypes.Tree,
  [gitTypes.Commit]: TreeEntryTypes.Commit,
}

/** The byte that ends every record. */
const recordEnd = "\0"

/** The separator between the record's metadata and its path. */
const pathSeparator = "\t"

/** The separator between mode, type and object id. */
const fieldSeparator = " "

/** The exit code of a `git ls-tree` that listed its tree. */
const successExit = 0

/**
 * One record's shape: six octal digits, a lowercase type, a 40- or
 * 64-digit object id, one tab and a non-empty path. The type and the
 * digits are checked again by {@link GitRecord}.
 */
const recordPattern = /^[0-7]{6} [a-z]+ (?:[0-9a-f]{40}|[0-9a-f]{64})\t[\s\S]+$/

/** Text that is empty or ends in the record terminator. */
const ListingText = Schema.String.check(
  Schema.makeFilter((text: string) => String.isEmpty(text) || String.endsWith(recordEnd)(text), {
    expected: "empty output or output ending in NUL",
  }),
)

const decodeListingText = Schema.decodeUnknownResult(ListingText)
const decodeRecords = Schema.decodeUnknownResult(Schema.Array(Schema.String.check(Schema.isPattern(recordPattern))))
/** One record's fields with the type as git prints it. */
const GitRecord = Schema.Struct({ mode: TreeEntryMode, type: GitType, object: Revision, path: GitText })

const decodeGitRecords = Schema.decodeUnknownResult(Schema.Array(GitRecord))

/**
 * Decodes one `git ls-tree -z` run. Exit 0 decodes stdout into its
 * entries, in listing order, and empty stdout is no entries. Any other
 * exit is `TreeNotListed` with its exit code and stderr. Stdout that does
 * not decode is `TreeUndecodable` with the schema's message; this
 * decoder never fails, so a bad listing cannot pass for an empty one.
 */
export const decodeTreeRun = (run: GitResult): TreeRun =>
  run.exitCode === successExit
    ? Result.match(decodeListing(run.stdout), { onFailure: undecodable, onSuccess: listed })
    : new TreeNotListed({ exitCode: run.exitCode, stderr: run.stderr })

/** The listing's entries, or the first schema issue. */
const decodeListing = (text: string) =>
  Result.flatMap(Result.flatMap(decodeListingText(text), recordsOf), entriesOf)

/** The records of NUL-terminated text, each checked against {@link recordPattern}. */
const recordsOf = (text: string) => decodeRecords(Arr.dropRight(String.split(text, recordEnd), 1))

/** The checked records split into their four fields, decoded, and given Domain's types. */
const entriesOf = (records: ReadonlyArray<string>) =>
  Result.map(decodeGitRecords(Arr.map(records, fieldsOf)), Arr.map(entryOf))

/**
 * A record's fields. The pattern guarantees one tab after the object id
 * and two spaces before it, so the path is everything after the first tab.
 */
const fieldsOf = (record: string) => {
  const [metadata, ...path] = String.split(record, pathSeparator)
  const [mode, type, object] = String.split(metadata, fieldSeparator)
  return { mode, type, object, path: Arr.join(path, pathSeparator) }
}

/** A decoded record as Domain's entry, its git type mapped to {@link TreeEntryTypes}. */
const entryOf = (record: typeof GitRecord.Type): TreeEntry => ({ ...record, type: entryTypes[record.type] })

/** A failed decode as the undecodable run. */
const undecodable = (issue: { readonly message: string }): TreeRun => new TreeUndecodable({ reason: issue.message })

/** Decoded entries as the listed run. */
const listed = (entries: ReadonlyArray<TreeEntry>): TreeRun => new TreeEntries({ entries })
