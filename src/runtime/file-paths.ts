// File system reads for the supervisor worktree (owner rulings 1 and 5 on
// B11a): whether a directory is present, and a path with symlinks
// resolved. A thrown error becomes a typed failure carrying its message.
import { Effect, Predicate } from "effect"
import { existsSync, realpathSync, statSync } from "node:fs"
import { PathUnreadable } from "../domain/worktree.ts"

/** The reason recorded when a thrown value carries no message. */
const unknownReason = "unknown error"

/**
 * Whether a directory is at `path`, following symlinks; absent is false.
 * Fails with {@link PathUnreadable} when something exists there but cannot
 * be inspected.
 */
export const isDirectory = (path: string) =>
  Effect.try({
    try: () => existsSync(path) && statSync(path).isDirectory(),
    catch: (cause) => new PathUnreadable({ path, reason: reasonOf(cause) }),
  })

/** `path` with every symlink resolved; fails with {@link PathUnreadable}. */
export const realpathOf = (path: string) =>
  Effect.try({
    try: () => realpathSync(path),
    catch: (cause) => new PathUnreadable({ path, reason: reasonOf(cause) }),
  })

/** A thrown value's message, for a typed failure. */
const reasonOf = (cause: unknown): string =>
  Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message)
    ? cause.message
    : unknownReason
