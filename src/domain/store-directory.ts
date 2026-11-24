// The directories tarlatan's stores live in (dogfood-1 finding): the
// configured state directory, which holds the project log, the lock and
// the target binding, and the ledger directory, which holds the owner's
// shared ledger. A command that writes there creates a missing one itself,
// one directory with mode 0700, as it creates git's private HOME. Program
// resolves the configured path first, as the layout check does, so a
// symbolic link to a directory is followed and the directory it names is
// used (owner ruling, dogfood-2). Runtime reads what is at the resolved
// path without following a link; Features decides whether to create the
// directory, use it or refuse it.
import { Schema } from "effect"

/**
 * Nothing is at the path. `parentPresent` says whether its parent
 * directory exists, following a link; only then may tarlatan create it.
 */
export class StoreDirectoryAbsent extends Schema.TaggedClass<StoreDirectoryAbsent>()("StoreDirectoryAbsent", {
  parentPresent: Schema.Boolean,
}) {}

/** What `lstat` found at the path: whether it is a symbolic link, and whether it is a directory. */
export class StoreDirectoryFound extends Schema.TaggedClass<StoreDirectoryFound>()("StoreDirectoryFound", {
  link: Schema.Boolean,
  directory: Schema.Boolean,
}) {}

/** The path could not be inspected, or `mkdir` failed there; `reason` is the error's message. */
export class StoreDirectoryUnreadable extends Schema.TaggedClass<StoreDirectoryUnreadable>()(
  "StoreDirectoryUnreadable",
  { reason: Schema.String },
) {}

/**
 * `mkdir` made the directory but `chmod` could not set its mode to 0700,
 * so its mode may be the umask's; `reason` is the error's message. Unlike
 * a failed `mkdir`, this is never settled by reading the path again.
 */
export class StoreDirectoryModeUnset extends Schema.TaggedClass<StoreDirectoryModeUnset>()(
  "StoreDirectoryModeUnset",
  { reason: Schema.String },
) {}

/** How creating a store directory failed: at `mkdir`, or at `chmod` after `mkdir` succeeded. */
export type StoreDirectoryCreationFailed = StoreDirectoryUnreadable | StoreDirectoryModeUnset

/** One reading of a store directory's path. */
export const StoreDirectoryReading = Schema.Union([StoreDirectoryAbsent, StoreDirectoryFound, StoreDirectoryUnreadable])
/** One reading of a store directory's path; see {@link StoreDirectoryReading}. */
export type StoreDirectoryReading = typeof StoreDirectoryReading.Type

/** Nothing is at the path and its parent exists: tarlatan creates the directory. */
export class CreateStoreDirectory extends Schema.TaggedClass<CreateStoreDirectory>()("CreateStoreDirectory", {}) {}

/** A real directory is at the path: tarlatan uses it as it is and never changes its mode. */
export class UseStoreDirectory extends Schema.TaggedClass<UseStoreDirectory>()("UseStoreDirectory", {}) {}

/** What a command does with a store directory before it writes there. */
export const StoreDirectoryAction = Schema.Union([CreateStoreDirectory, UseStoreDirectory])
/** What a command does with a store directory; see {@link StoreDirectoryAction}. */
export type StoreDirectoryAction = typeof StoreDirectoryAction.Type

/**
 * The store directory `directory` is missing and so is its parent
 * `parent`. Tarlatan creates only the last component, so nothing was
 * created; the owner makes the parent.
 */
export class StoreDirectoryParentMissing extends Schema.TaggedError<StoreDirectoryParentMissing>()(
  "StoreDirectoryParentMissing",
  { directory: Schema.String, parent: Schema.String },
) {}

/**
 * The store directory at `directory`, its resolved path, may not be used:
 * it is not a directory, it could not be read or created, its mode could
 * not be set to 0700 after tarlatan created it, or it is still missing
 * after tarlatan tried to create it. It is a symbolic link only when one
 * appeared there after the path was resolved. `reason` says which.
 * Nothing that was at the path before was changed.
 */
export class StoreDirectoryRefused extends Schema.TaggedError<StoreDirectoryRefused>()("StoreDirectoryRefused", {
  directory: Schema.String,
  reason: Schema.String,
}) {}
