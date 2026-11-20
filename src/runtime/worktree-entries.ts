// What is on disk at one entry of the snapshot's tree (plan A2, "Snapshot
// identity and raw checks"). `lstat` decides the kind without following a
// link: a symbolic link gives its link text through `readlink`, and its
// target is never opened or inspected; a regular file is opened with
// O_NOFOLLOW, so a link swapped in after the `lstat` fails rather than
// being followed, and its bytes and executable bit come from that open
// descriptor; anything else is reported as another kind and not read.
// Raw results only: Program computes blob ids and Features judges.
import { Array as Arr, Data, Effect, Predicate } from "effect"
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readlinkSync } from "node:fs"

/** A regular file's raw bytes and whether its owner-execute bit is set. */
export class RegularRead extends Data.TaggedClass("RegularRead")<{
  readonly bytes: Uint8Array
  readonly executable: boolean
}> {}

/** A symbolic link's text as raw bytes, read with `readlink`; the target is not read. */
export class LinkRead extends Data.TaggedClass("LinkRead")<{ readonly text: Uint8Array }> {}

/** Something that is neither a regular file nor a symbolic link, such as a directory; not read. */
export class OtherRead extends Data.TaggedClass("OtherRead")<object> {}

/** Nothing is at the path (ENOENT or ENOTDIR). */
export class EntryAbsent extends Data.TaggedClass("EntryAbsent")<object> {}

/** The path could not be inspected or read, with the error's message. */
export class EntryUnreadable extends Data.TaggedClass("EntryUnreadable")<{ readonly reason: string }> {}

/** What {@link ReadWorktreeEntry} found at a path. */
export type WorktreeEntryReading = RegularRead | LinkRead | OtherRead | EntryAbsent | EntryUnreadable

/**
 * Reads what is at an absolute path without following a link. Never
 * fails: a failure to inspect or read is {@link EntryUnreadable}.
 */
export type ReadWorktreeEntry = (path: string) => Effect.Effect<WorktreeEntryReading>

/** The owner-execute bit of st_mode, git's test for mode 100755. */
const ownerExecuteBit = 0o100

/** The reason recorded when a thrown value carries no message. */
const unknownReason = "unknown error"

/** The error codes that mean nothing is at the path. */
const absentCodes: ReadonlyArray<string> = ["ENOENT", "ENOTDIR"]

/** The `readlink` option for the link text as bytes, so no decoding can alter it. */
const asBytes = { encoding: "buffer" } as const

/**
 * The production {@link ReadWorktreeEntry}: `lstat`, then `readlink` for a
 * link, an O_NOFOLLOW read for a regular file, and nothing for any other
 * kind.
 */
export const readWorktreeEntry: ReadWorktreeEntry = (path) =>
  Effect.catch(readingAt(path), (cause) => Effect.succeed(failedReading(cause)))

/** The reading by the kind `lstat` reports; a thrown value is the failure. */
const readingAt = (path: string): Effect.Effect<WorktreeEntryReading, unknown> =>
  Effect.flatMap(attempt(() => lstatSync(path)), (stats) => {
    if (stats.isSymbolicLink()) return attempt(() => new LinkRead({ text: readlinkSync(path, asBytes) }))
    return stats.isFile() ? regularAt(path) : Effect.succeed(new OtherRead())
  })

/** A regular file read through one O_NOFOLLOW descriptor, closed afterwards. */
const regularAt = (path: string): Effect.Effect<WorktreeEntryReading, unknown> =>
  Effect.acquireUseRelease(
    attempt(() => openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)),
    (descriptor) => attempt(() => regularFrom(descriptor)),
    (descriptor) => Effect.sync(() => {
      closeSync(descriptor)
    }),
  )

/**
 * The open descriptor's bytes and executable bit, or another kind when
 * the path was replaced by one between the `lstat` and the open.
 */
const regularFrom = (descriptor: number): WorktreeEntryReading => {
  const stats = fstatSync(descriptor)
  return stats.isFile()
    ? new RegularRead({ bytes: readFileSync(descriptor), executable: (stats.mode & ownerExecuteBit) !== 0 })
    : new OtherRead()
}

/** Runs a throwing platform call, keeping what it threw. */
const attempt = <A>(call: () => A): Effect.Effect<A, unknown> => Effect.try({ try: call, catch: (cause) => cause })

/** A thrown value as the reading: absence, or the failure's message. */
const failedReading = (cause: unknown): WorktreeEntryReading =>
  isAbsence(cause) ? new EntryAbsent() : new EntryUnreadable({ reason: reasonOf(cause) })

/** Whether a thrown value reports that nothing is at the path. */
const isAbsence = (cause: unknown): boolean =>
  Predicate.hasProperty(cause, "code") && Predicate.isString(cause.code) && Arr.contains(absentCodes, cause.code)

/** A thrown value's message, for the reading. */
const reasonOf = (cause: unknown): string =>
  Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message) ? cause.message : unknownReason
