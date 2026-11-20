// The snapshot preflight's directory listing (review finding B08, M14).
// `readdir` gives each entry's name as raw bytes, decoded as strict UTF-8,
// and `lstat` gives its kind without following a link at that entry; no
// entry is opened or read. The listing is sorted by name so the
// preflight's findings come in a stable order. Like every snapshot
// observation, it assumes the assisted rung's quiescence: `lstat` and
// `readdir` resolve the directory's own path through its parents, and a
// parent swapped for a link by a concurrent writer is not detected.
import { Array as Arr, Data, Effect, Option, Order, Predicate } from "effect"
import { lstatSync, readdirSync } from "node:fs"
import { FileKinds, type FileKind } from "../domain/attributes.ts"
import type { WalkedChild } from "../domain/snapshot.ts"
import { strictUtf8 } from "./strict-utf8.ts"

/** The directory's entries, sorted by name. */
export class DirectoryListed extends Data.TaggedClass("DirectoryListed")<{
  readonly children: ReadonlyArray<WalkedChild>
}> {}

/**
 * The directory could not be listed, an entry could not be inspected, or
 * an entry's name is not valid UTF-8; with the reason.
 */
export class DirectoryUnlisted extends Data.TaggedClass("DirectoryUnlisted")<{ readonly reason: string }> {}

/** What {@link listDirectory} found; see {@link DirectoryListed} and {@link DirectoryUnlisted}. */
export type DirectoryReading = DirectoryListed | DirectoryUnlisted

/** The reason recorded when a thrown value carries no message. */
const unknownReason = "unknown error"

/** The reason recorded for a name whose bytes are not UTF-8. */
const undecodableName = "an entry's name is not valid UTF-8"

/** The `readdir` option for names as bytes, so no decoding can alter them. */
const asBytes = { encoding: "buffer" } as const

/** Entries in name order. */
const byName = Order.mapInput(Order.String, (child: WalkedChild) => child.name)

/**
 * Lists the directory at the absolute `path`: each entry's name and its
 * kind by `lstat`. Never fails; a failure is {@link DirectoryUnlisted}.
 */
export const listDirectory = (path: string): Effect.Effect<DirectoryReading> =>
  Effect.catch(
    Effect.try({ try: () => listingAt(path), catch: (cause) => new DirectoryUnlisted({ reason: reasonOf(cause) }) }),
    Effect.succeed,
  )

/** The listing, or {@link DirectoryUnlisted} when a name does not decode; `lstat` failures throw. */
const listingAt = (path: string): DirectoryReading =>
  Option.match(Option.all(Arr.map(readdirSync(path, asBytes), strictUtf8)), {
    onNone: () => new DirectoryUnlisted({ reason: undecodableName }),
    onSome: (names) => new DirectoryListed({ children: Arr.sort(Arr.map(names, childIn(path)), byName) }),
  })

/** One entry with its kind by `lstat`. */
const childIn =
  (directory: string) =>
  (name: string): WalkedChild => ({ name, kind: kindOf(lstatSync(`${directory}/${name}`)) })

/** The kind `lstat` reports; a symbolic link is never followed. */
const kindOf = (stats: ReturnType<typeof lstatSync>): FileKind => {
  if (stats.isSymbolicLink()) return FileKinds.SymbolicLink
  if (stats.isDirectory()) return FileKinds.Directory
  return stats.isFile() ? FileKinds.File : FileKinds.Other
}

/** A thrown value's message. */
const reasonOf = (cause: unknown): string =>
  Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message) ? cause.message : unknownReason
