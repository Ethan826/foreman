// File system reads for the supervisor worktree (owner rulings 1 and 5 on
// B11a, and the ruling on R1 of its review): what `stat` finds at a path,
// and a path with symlinks resolved. Only `stat` decides presence, so a
// permission failure is never read as absence; a thrown error other than
// ENOENT or ENOTDIR becomes a typed failure carrying its message.
import { Array as Arr, Effect, Option, Predicate } from "effect"
import { realpathSync, statSync } from "node:fs"
import { PathUnreadable, type PathStat } from "../domain/worktree.ts"

/** The reason recorded when a thrown value carries no message. */
const unknownReason = "unknown error"

/**
 * The error codes `stat` gives when nothing is at the path: no entry, or a
 * path component that is not a directory. Every other code, such as
 * EACCES, is a failure to inspect the path.
 */
const absentCodes: ReadonlyArray<string> = ["ENOENT", "ENOTDIR"]

/** The reading of a path with nothing at it. */
const nothingThere: PathStat = Option.none()

/**
 * What `stat` finds at `path`, following symlinks: none when nothing is
 * there (ENOENT or ENOTDIR), otherwise whether it is a directory. Fails
 * with {@link PathUnreadable} on any other error, such as an unsearchable
 * parent directory (EACCES).
 */
export const statOf = (path: string): Effect.Effect<PathStat, PathUnreadable> =>
  Effect.catch(
    Effect.try({
      try: (): PathStat => Option.some({ directory: statSync(path).isDirectory() }),
      catch: (cause) => cause,
    }),
    (cause) => (isAbsence(cause) ? Effect.succeed(nothingThere) : Effect.fail(unreadable(path, cause))),
  )

/** `path` with every symlink resolved; fails with {@link PathUnreadable}. */
export const realpathOf = (path: string) =>
  Effect.try({
    try: () => realpathSync(path),
    catch: (cause) => unreadable(path, cause),
  })

/** Whether a thrown value is `stat`'s report that nothing is at the path. */
const isAbsence = (cause: unknown): boolean =>
  Predicate.hasProperty(cause, "code") && Predicate.isString(cause.code) && Arr.contains(absentCodes, cause.code)

/** A thrown value as the typed failure for `path`. */
const unreadable = (path: string, cause: unknown) => new PathUnreadable({ path, reason: reasonOf(cause) })

/** A thrown value's message, for a typed failure. */
const reasonOf = (cause: unknown): string =>
  Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message)
    ? cause.message
    : unknownReason
