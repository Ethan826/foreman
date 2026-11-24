// A store directory on disk (dogfood-1 finding): the state directory or
// the ledger directory, read without following a link at the path, and
// its creation. Program passes the resolved path, so a link is seen here
// only when one appeared after the path was resolved. Creation makes one
// directory with mode 0700 and sets that mode again, so the process umask
// cannot leave it wider or narrower, as git's private HOME is made
// (git-home.ts); a failed `chmod` is reported apart from a failed `mkdir`.
// Only the last component is made: a missing parent fails. Nothing here
// removes or changes an existing entry.
import { Effect, Predicate } from "effect"
import { chmodSync, lstatSync, mkdirSync, statSync } from "node:fs"
import { dirname } from "node:path"
import {
  StoreDirectoryAbsent,
  type StoreDirectoryCreationFailed,
  StoreDirectoryFound,
  StoreDirectoryModeUnset,
  type StoreDirectoryReading,
  StoreDirectoryUnreadable,
} from "../domain/store-directory.ts"

/** The mode tarlatan creates a store directory with: owner read, write and search. */
const privateMode = 0o700

/** The reason recorded when a thrown value carries no message. */
const unknownReason = "unknown error"

/**
 * What is at `path`: nothing, with whether its parent is a directory
 * (following a link), or the entry's kind, read without following a link.
 * Any other error is {@link StoreDirectoryUnreadable}. Never fails.
 */
export const readStoreDirectory = (path: string): Effect.Effect<StoreDirectoryReading> =>
  Effect.catch(
    Effect.try({ try: (): StoreDirectoryReading => foundAt(path), catch: (cause) => cause }),
    (cause) => (hasCode(cause, "ENOENT") ? absentAt(path) : Effect.succeed(unreadable(cause))),
  )

/**
 * Creates one directory at `path` with mode 0700, then sets that mode
 * again so the umask cannot change it. Fails with
 * {@link StoreDirectoryUnreadable} when `mkdir` fails, for example because
 * the parent is missing or something appeared at the path first, which
 * the next reading then judges. Fails with {@link StoreDirectoryModeUnset}
 * when `mkdir` succeeded and `chmod` failed, which no reading settles
 * (owner finding F3, dogfood-2).
 */
export const createStoreDirectory = (path: string): Effect.Effect<void, StoreDirectoryCreationFailed> =>
  Effect.andThen(
    Effect.try({
      try: () => {
        mkdirSync(path, privateMode)
      },
      catch: unreadable,
    }),
    Effect.try({
      try: () => {
        chmodSync(path, privateMode)
      },
      catch: (cause) => new StoreDirectoryModeUnset({ reason: reasonOf(cause) }),
    }),
  )

/** The entry at `path`, read without following a link; throws as `lstat` does. */
const foundAt = (path: string): StoreDirectoryFound => {
  const entry = lstatSync(path)
  return new StoreDirectoryFound({ link: entry.isSymbolicLink(), directory: entry.isDirectory() })
}

/**
 * Nothing at `path`: whether its parent is a directory. A parent that is
 * missing (ENOENT) or below a non-directory (ENOTDIR) is not present; any
 * other error reading it is {@link StoreDirectoryUnreadable}.
 */
const absentAt = (path: string): Effect.Effect<StoreDirectoryReading> =>
  Effect.catch(
    Effect.try({
      try: (): StoreDirectoryReading => new StoreDirectoryAbsent({ parentPresent: statSync(dirname(path)).isDirectory() }),
      catch: (cause) => cause,
    }),
    (cause) =>
      Effect.succeed(
        hasCode(cause, "ENOENT") || hasCode(cause, "ENOTDIR")
          ? new StoreDirectoryAbsent({ parentPresent: false })
          : unreadable(cause),
      ),
  )

/** Whether a thrown value carries the error code `code`. */
const hasCode = (cause: unknown, code: string): boolean => Predicate.hasProperty(cause, "code") && cause.code === code

/** A thrown value as an unreadable path, with its message as the reason. */
const unreadable = (cause: unknown) => new StoreDirectoryUnreadable({ reason: reasonOf(cause) })

/** A thrown value's message, or {@link unknownReason} when it has none. */
const reasonOf = (cause: unknown): string =>
  Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message) ? cause.message : unknownReason
