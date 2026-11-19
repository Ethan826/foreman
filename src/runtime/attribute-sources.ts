// The attribute check's reads (plan B11c, deliverable): the revision's
// tree listing, each `.gitattributes` blob, the repository's
// `core.attributesFile` setting and `<commonDir>/info/attributes`. Raw
// results only: each git run's exit code and output, whatever it exited
// with, and what `lstat` and a read found at the file. Format decodes and
// Features judges. Every command runs through an injected `RunGit`;
// production passes the clean runner of `git.ts` (plan B11b), and none of
// these commands applies attributes.
import { Array as Arr, Effect, Predicate } from "effect"
import { lstatSync, readFileSync } from "node:fs"
import type { FileKind, FileReading } from "../domain/attributes.ts"
import { FileAbsent, FileFound, FileKinds, FileUnreadable } from "../domain/attributes.ts"
import type { Revision } from "../domain/ids.ts"
import type { RunGit } from "./git.ts"

/** What `lstat` returns, as far as the kind of entry. */
type EntryStatus = ReturnType<typeof lstatSync>

/** The reason recorded when a thrown value carries no message. */
const unknownReason = "unknown error"

/** The error codes `lstat` gives when nothing is at the path. */
const absentCodes: ReadonlyArray<string> = ["ENOENT", "ENOTDIR"]

/**
 * The attribute check's commands. The listing is recursive, shows trees
 * as well as their contents (`-t`, so a tree named `.gitattributes` is
 * listed) and covers the whole tree whatever the directory (`--full-tree`),
 * NUL-terminated so a path is printed verbatim.
 */
export const attributeArgs = {
  /** The listing of `revision`'s whole tree. */
  treeListing: (revision: Revision): ReadonlyArray<string> => ["ls-tree", "--full-tree", "-r", "-t", "-z", revision],
  /** The content of blob `object`, which `cat-file` prints unconverted. */
  blob: (object: Revision): ReadonlyArray<string> => ["cat-file", "blob", object],
  /** The repository's setting; exit 1 means unset. */
  attributesFile: ["config", "--get", "core.attributesFile"],
} as const

/** The path git reads repository-wide attributes from: `<commonDir>/info/attributes`. */
export const infoAttributesPath = (commonDir: string): string => `${commonDir}/info/attributes`

/** Runs `git ls-tree` over `revision` in `cwd` and returns the run, whatever it exited with. */
export const listTreeWith = (run: RunGit) => (cwd: string, revision: Revision) =>
  run(cwd, attributeArgs.treeListing(revision))

/** Runs `git cat-file blob <object>` in `cwd` and returns the run, whatever it exited with. */
export const readBlobWith = (run: RunGit) => (cwd: string, object: Revision) => run(cwd, attributeArgs.blob(object))

/** Runs `git config --get core.attributesFile` in `cwd` and returns the run, whatever it exited with. */
export const readAttributesFileSettingWith = (run: RunGit) => (cwd: string) => run(cwd, attributeArgs.attributesFile)

/**
 * What is at `path`, read without following a symlink: nothing, the kind
 * found with a regular file's text (UTF-8), or the failure's message when
 * `lstat` fails other than by absence or the file cannot be read. Never
 * fails; judging the reading is Features' work.
 */
export const readFileAt = (path: string): Effect.Effect<FileReading> =>
  Effect.catch(
    Effect.try({ try: () => found(path, lstatSync(path)), catch: (cause) => cause }),
    (cause) => Effect.succeed(failedReading(cause)),
  )

/** A thrown value as the reading: absence, or the failure's message. */
const failedReading = (cause: unknown): FileReading =>
  isAbsence(cause) ? new FileAbsent() : new FileUnreadable({ reason: reasonOf(cause) })

/** What `lstat` found, with a regular file's text read. */
const found = (path: string, stats: EntryStatus): FileReading => {
  const kind = kindOf(stats)
  return new FileFound({ kind, content: kind === FileKinds.File ? readFileSync(path, "utf8") : "" })
}

/** The kind of what `lstat` found. */
const kindOf = (stats: EntryStatus): FileKind => {
  if (stats.isSymbolicLink()) return FileKinds.SymbolicLink
  if (stats.isDirectory()) return FileKinds.Directory
  return stats.isFile() ? FileKinds.File : FileKinds.Other
}

/** Whether a thrown value is `lstat`'s report that nothing is at the path. */
const isAbsence = (cause: unknown): boolean =>
  Predicate.hasProperty(cause, "code") && Predicate.isString(cause.code) && Arr.contains(absentCodes, cause.code)

/** A thrown value's message, for the reading. */
const reasonOf = (cause: unknown): string =>
  Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message) ? cause.message : unknownReason
