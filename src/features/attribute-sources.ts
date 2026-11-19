// The attribute check (design "Git environment", restrictions table row
// "No attribute-driven conversion"; plan B11c, option A and the owner
// rulings of 2026-11-19). Option A reads no declaration and matches no
// path: a `.gitattributes` entry of the revision passes only as a regular
// blob of blank and comment lines, `<commonDir>/info/attributes` only when
// absent or empty, `core.attributesFile` only when unset, and the config
// only when it lists no conditional include (option R). Every other
// reading, including a failed read, is a refusal and never a pass (ruling
// 4). Pure and total; Program reads the sources through Runtime.
import { Array as Arr, Match, Option, Result, String } from "effect"
import type {
  AttributeReading,
  AttributeRefusal,
  AttributeRefusalReason,
  AttributesEntryRead,
  AttributeSource,
  FileReading,
  GitResult,
  TreeEntry,
  TreeReading,
} from "../domain/attributes.ts"
import {
  AttributeRefusalReasons,
  AttributeSources,
  AttributeSourcesRefused,
  FileKinds,
  TreeEntryTypes,
} from "../domain/attributes.ts"
import type { Revision } from "../domain/ids.ts"

/** The file name git reads attributes from in a tree. */
const attributesFileName = ".gitattributes"

/** The separator between path components in a tree path. */
const pathSeparator = "/"

/** The separator git splits an attributes file into lines at. */
const lineSeparator = "\n"

/** The mark that starts a comment line. */
const commentMark = "#"

/** A blank line: only spaces and tabs, then at most one CR at its end. */
const blankLine = /^[ \t]*\r?$/

/** The modes of a regular blob: a file, and an executable file. */
const regularBlobModes: ReadonlyArray<string> = ["100644", "100755"]

/**
 * The exit codes of `git config --get` and `--get-regexp`: a value
 * printed, and nothing matched.
 */
const configExits = { printed: 0, unset: 1 } as const

/** `git cat-file`'s exit code when it printed the blob. */
const blobPrinted = 0

/** The detail of a regular blob that Program did not read. */
const notRead = "not read"

/** Whether an entry's last path component is `.gitattributes`, at any depth. */
export const isAttributesEntry = (entry: TreeEntry): boolean =>
  Option.contains(Arr.last(String.split(entry.path, pathSeparator)), attributesFileName)

/** Whether an entry is a regular blob: type blob with mode 100644 or 100755. */
export const isRegularBlob = (entry: TreeEntry): boolean =>
  entry.type === TreeEntryTypes.Blob && Arr.contains(regularBlobModes, entry.mode)

/**
 * Judges the reading of one revision and repository (plan B11c,
 * contract). Succeeds with the revision when every `.gitattributes` entry
 * is a regular blob of blank and comment lines, `info/attributes` is
 * absent or an empty regular file, `core.attributesFile` is unset (exit
 * 1), and the `includeif.` listing matched nothing (exit 1). Otherwise
 * fails with every refusal, in source order. A blank
 * line holds only spaces and tabs and at most a final CR; a comment line
 * begins with `#` at its first character, so an indented `#` is refused.
 */
export const checkAttributeSources = (
  reading: AttributeReading,
): Result.Result<Revision, AttributeSourcesRefused> =>
  Arr.match(refusalsOf(reading), {
    onEmpty: () => Result.succeed(reading.revision),
    onNonEmpty: (refusals) =>
      Result.fail(new AttributeSourcesRefused({ revision: reading.revision, refusals })),
  })

/** Every refusal of the reading: tree, `info/attributes`, the setting, then conditional includes. */
const refusalsOf = (reading: AttributeReading): ReadonlyArray<AttributeRefusal> =>
  Arr.flatten([
    treeRefusals(reading.tree),
    infoRefusals(reading.infoAttributes.path, reading.infoAttributes.reading),
    configRefusals(AttributeSources.AttributesFile, reading.attributesFile),
    configRefusals(AttributeSources.ConditionalInclude, reading.conditionalIncludes),
  ])

/** The tree's refusals: each entry's, or one read failure for the whole tree. */
const treeRefusals = (tree: TreeReading): ReadonlyArray<AttributeRefusal> =>
  Match.valueTags(tree, {
    TreeListed: (listed) => Arr.flatMap(listed.files, entryRefusals),
    TreeNotListed: (failed) => [treeFailure(exitDetail(failed))],
    TreeUndecodable: (failed) => [treeFailure(failed.reason)],
  })

/** One `.gitattributes` entry's refusals: its kind, its read, or its lines. */
const entryRefusals = (file: AttributesEntryRead): ReadonlyArray<AttributeRefusal> =>
  isRegularBlob(file.entry)
    ? Option.match(file.blob, {
        onNone: () => [entryFailure(file.entry, AttributeRefusalReasons.ReadFailed, notRead)],
        onSome: blobRefusals(file.entry),
      })
    : [entryFailure(file.entry, AttributeRefusalReasons.NotRegular, `${file.entry.mode} ${file.entry.type}`)]

/** A read blob's refusals: a failed `cat-file`, or each line with content. */
const blobRefusals = (entry: TreeEntry) => (blob: GitResult): ReadonlyArray<AttributeRefusal> =>
  blob.exitCode === blobPrinted
    ? Arr.flatMap(String.split(blob.stdout, lineSeparator), lineRefusals(entry.path))
    : [entryFailure(entry, AttributeRefusalReasons.ReadFailed, exitDetail(blob))]

/** A line's refusal unless it is blank or a comment; `index` counts from 0. */
const lineRefusals = (path: string) => (line: string, index: number): ReadonlyArray<AttributeRefusal> =>
  isInert(line) ? [] : [refusal(AttributeSources.Tree, AttributeRefusalReasons.Content, Option.some(path), Option.some(index + 1), line)]

/** Whether a line declares nothing under option A: blank, or a comment from its first character. */
const isInert = (line: string): boolean => blankLine.test(line) || String.startsWith(commentMark)(line)

/** `info/attributes`'s refusals: none when absent or an empty regular file. */
const infoRefusals = (path: string, reading: FileReading): ReadonlyArray<AttributeRefusal> => {
  const refuse = (reason: AttributeRefusalReason, detail: string) => [
    refusal(AttributeSources.InfoAttributes, reason, Option.some(path), Option.none(), detail),
  ]
  return Match.valueTags(reading, {
    FileAbsent: () => [],
    FileUnreadable: (failed) => refuse(AttributeRefusalReasons.ReadFailed, failed.reason),
    FileFound: (found) =>
      found.kind !== FileKinds.File
        ? refuse(AttributeRefusalReasons.NotRegular, found.kind)
        : String.isEmpty(found.content) ? [] : refuse(AttributeRefusalReasons.Content, found.content),
  })
}

/**
 * A config read's refusals: none when nothing matched (exit 1), what it
 * printed when something did (exit 0), a read failure otherwise.
 */
const configRefusals = (source: AttributeSource, run: GitResult): ReadonlyArray<AttributeRefusal> => {
  if (run.exitCode === configExits.unset) return []
  return run.exitCode === configExits.printed
    ? [configRefusal(source, AttributeRefusalReasons.Configured, run.stdout)]
    : [configRefusal(source, AttributeRefusalReasons.ReadFailed, exitDetail(run))]
}

/** A refusal of a config read, which has no path or line. */
const configRefusal = (source: AttributeSource, reason: AttributeRefusalReason, detail: string) =>
  refusal(source, reason, Option.none(), Option.none(), detail)

/** A read failure of the whole tree. */
const treeFailure = (detail: string) =>
  refusal(AttributeSources.Tree, AttributeRefusalReasons.ReadFailed, Option.none(), Option.none(), detail)

/** A refusal of one tree entry, which has no line. */
const entryFailure = (entry: TreeEntry, reason: AttributeRefusalReason, detail: string) =>
  refusal(AttributeSources.Tree, reason, Option.some(entry.path), Option.none(), detail)

/** A failed command's exit code and stderr, for a refusal's detail. */
const exitDetail = (run: { readonly exitCode: number; readonly stderr: string }) =>
  `exit ${globalThis.String(run.exitCode)}: ${run.stderr}`

/** One refusal. */
const refusal = (
  source: AttributeRefusal["source"],
  reason: AttributeRefusalReason,
  path: Option.Option<string>,
  line: Option.Option<number>,
  detail: string,
): AttributeRefusal => ({ source, reason, path, line, detail })
