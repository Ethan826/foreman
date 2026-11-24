// Git's private HOME on disk (batch review B02; plan B11b, ruling 2):
// what is at its path, read without following a link, and its creation.
// Creation makes one directory with mode 0700 and sets that mode again,
// so the process umask cannot leave it wider or narrower. Nothing here
// removes, empties or changes an existing entry.
import { Array as Arr, Effect, Predicate } from "effect"
import { chmodSync, lstatSync, mkdirSync, readdirSync } from "node:fs"
import { userInfo } from "node:os"
import { HomeAbsent, HomeFound, type HomeReading, HomeUnreadable } from "../domain/git-home.ts"

/** The mode tarlatan creates the home with: owner read, write and search. */
const privateMode = 0o700

/** The permission bits of st_mode. */
const permissionBits = 0o777

/** The reason recorded when a thrown value carries no message. */
const unknownReason = "unknown error"

/**
 * What is at `path`: nothing (ENOENT), or the entry's kind, permission
 * bits, owner, tarlatan's own user id and, for a directory that is not a
 * link, how many names it holds. Any other error is
 * {@link HomeUnreadable}. Never fails.
 */
export const readHome = (path: string): Effect.Effect<HomeReading> =>
  Effect.catch(
    Effect.try({ try: (): HomeReading => foundAt(path), catch: (cause) => cause }),
    (cause) => Effect.succeed(isMissing(cause) ? new HomeAbsent() : new HomeUnreadable({ reason: reasonOf(cause) })),
  )

/**
 * Creates the home at `path` with mode 0700. Fails with
 * {@link HomeUnreadable} when it cannot, for example because something
 * appeared at the path first, which the next reading then judges.
 */
export const createHome = (path: string): Effect.Effect<void, HomeUnreadable> =>
  Effect.try({
    try: () => {
      mkdirSync(path, privateMode)
      chmodSync(path, privateMode)
    },
    catch: (cause) => new HomeUnreadable({ reason: reasonOf(cause) }),
  })

/** The entry at `path`, read without following a link; throws as `lstat` and `readdir` do. */
const foundAt = (path: string): HomeFound => {
  const entry = lstatSync(path)
  const listed = entry.isDirectory() && !entry.isSymbolicLink()
  return new HomeFound({
    link: entry.isSymbolicLink(),
    directory: entry.isDirectory(),
    mode: entry.mode & permissionBits,
    ownerUid: entry.uid,
    userUid: userInfo().uid,
    entries: listed ? Arr.length(readdirSync(path)) : 0,
  })
}

/** Whether a thrown value is `lstat`'s report that nothing is at the path. */
const isMissing = (cause: unknown): boolean =>
  Predicate.hasProperty(cause, "code") && cause.code === "ENOENT"

/** A thrown value's message. */
const reasonOf = (cause: unknown): string =>
  Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message) ? cause.message : unknownReason
