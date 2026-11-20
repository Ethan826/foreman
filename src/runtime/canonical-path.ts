// A path with every symbolic link resolved (batch review B05), for paths
// that may not exist yet: the nearest ancestor that exists is resolved
// with `realpath`, and the components below it are appended as given.
// An entry that exists but cannot be resolved, such as a dangling link or
// an unsearchable directory, is a failure, never treated as absent. The
// path must be absolute and normalized; the configuration decoder
// refuses `.`, `..` and doubled or trailing slashes.
import { Effect, Predicate } from "effect"
import { lstatSync, realpathSync } from "node:fs"
import { basename, dirname } from "node:path"
import { PathUnreadable } from "../domain/worktree.ts"

/** The reason recorded when a thrown value carries no message. */
const unknownReason = "unknown error"

/** The root directory, which always exists. */
const root = "/"

/**
 * `path` canonical: its nearest existing ancestor (itself, if it exists)
 * resolved, then the rest. Fails with {@link PathUnreadable} when an
 * existing entry cannot be resolved or inspected.
 */
export const canonicalPathOf = (path: string): Effect.Effect<string, PathUnreadable> =>
  Effect.flatMap(entryExists(path), (exists) =>
    exists || path === root ? resolved(path) : Effect.map(canonicalPathOf(dirname(path)), joinedWith(path)),
  )

/** The parent's canonical path joined with `path`'s last component. */
const joinedWith = (path: string) => (parent: string) => `${parent === root ? "" : parent}/${basename(path)}`

/** Whether anything, a dangling link included, is at `path`; fails on any error but ENOENT. */
const entryExists = (path: string): Effect.Effect<boolean, PathUnreadable> =>
  Effect.catch(
    Effect.try({ try: () => Predicate.isNotNullish(lstatSync(path)), catch: (cause) => cause }),
    (cause) => (isMissing(cause) ? Effect.succeed(false) : Effect.fail(unreadable(path, cause))),
  )

/** `realpath` of an existing entry. */
const resolved = (path: string) => Effect.try({ try: () => realpathSync(path), catch: (cause) => unreadable(path, cause) })

/** Whether a thrown value is the report that nothing is at the path. */
const isMissing = (cause: unknown): boolean => Predicate.hasProperty(cause, "code") && cause.code === "ENOENT"

/** A thrown value as the typed failure for `path`. */
const unreadable = (path: string, cause: unknown) =>
  new PathUnreadable({
    path,
    reason: Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message) ? cause.message : unknownReason,
  })
