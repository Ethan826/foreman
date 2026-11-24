// Git's private HOME (batch review B02; plan B11b, ruling 2): the empty
// directory every git command runs with as HOME, so that git reads no
// `~/.gitconfig` and no `~/.config/git/attributes`. Runtime reads what is
// at its path without following a link; Features judges the reading.
import { Schema } from "effect"

/** Nothing is at the path. */
export class HomeAbsent extends Schema.TaggedClass<HomeAbsent>()("HomeAbsent", {}) {}

/**
 * What `lstat` and, for a directory that is not a link, `readdir` found at
 * the path. `mode` holds the permission bits only; `entries` counts the
 * names in the directory, 0 for anything that is not one.
 */
export class HomeFound extends Schema.TaggedClass<HomeFound>()("HomeFound", {
  link: Schema.Boolean,
  directory: Schema.Boolean,
  mode: Schema.Int,
  ownerUid: Schema.Int,
  userUid: Schema.Int,
  entries: Schema.Int,
}) {}

/** The path could not be inspected or created; `reason` is the error's message. */
export class HomeUnreadable extends Schema.TaggedClass<HomeUnreadable>()("HomeUnreadable", {
  reason: Schema.String,
}) {}

/** One reading of git's HOME path. */
export const HomeReading = Schema.Union([HomeAbsent, HomeFound, HomeUnreadable])
/** One reading of git's HOME path; see {@link HomeReading}. */
export type HomeReading = typeof HomeReading.Type

/**
 * Git's HOME may not be used: it is missing after tarlatan tried to create
 * it, it is a link or not a directory, it is not owned by tarlatan's user,
 * its mode is not exactly 0700, it is not empty, or it could not be read.
 * `reasons` names each, in that order. Nothing was changed at the path.
 */
export class GitHomeRefused extends Schema.TaggedError<GitHomeRefused>()("GitHomeRefused", {
  path: Schema.String,
  reasons: Schema.NonEmptyArray(Schema.String),
}) {}
