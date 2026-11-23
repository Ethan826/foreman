// Whether a store directory (the state directory or the ledger directory)
// is created, used or refused (dogfood-1 finding). Program judges the
// resolved path, so a symbolic link to a directory was already followed
// (owner ruling, dogfood-2). Nothing at the path and a parent that exists:
// create it. A real directory: use it as it is, whatever its mode. Anything
// that is not a directory, a missing parent or an unreadable path: refuse,
// with the path named. Program creates only after this says so, then
// judges the creation and the path again.
import { Array as Arr, Match, Option, Result, String } from "effect"
import {
  CreateStoreDirectory,
  type StoreDirectoryAction,
  type StoreDirectoryCreationFailed,
  type StoreDirectoryFound,
  StoreDirectoryParentMissing,
  type StoreDirectoryReading,
  StoreDirectoryRefused,
  UseStoreDirectory,
} from "../domain/store-directory.ts"

/** The root directory, the parent of every top-level path. */
const root = "/"

/**
 * What to do with the store directory at `path`, given what Runtime read
 * there: create it when nothing is there and its parent exists or is
 * itself among `creating`, the directories the same command creates
 * first; use it when it is a directory and not a link. Fails with
 * {@link StoreDirectoryParentMissing} when the parent is missing too, and
 * with {@link StoreDirectoryRefused} for a non-directory, a path that
 * could not be read, or a link that appeared after the path was resolved.
 */
export const judgeStoreDirectory = (
  path: string,
  reading: StoreDirectoryReading,
  creating: ReadonlyArray<string> = [],
): Result.Result<StoreDirectoryAction, StoreDirectoryParentMissing | StoreDirectoryRefused> =>
  Match.valueTags(reading, {
    StoreDirectoryAbsent: (absent) =>
      absent.parentPresent || Arr.contains(creating, parentOf(path))
        ? Result.succeed(new CreateStoreDirectory())
        : Result.fail(new StoreDirectoryParentMissing({ directory: path, parent: parentOf(path) })),
    StoreDirectoryUnreadable: (failed) => Result.fail(refused(path, `unreadable: ${failed.reason}`)),
    StoreDirectoryFound: foundAction(path),
  })

/** A found entry: a real directory is used; a link or anything else is refused. */
const foundAction =
  (path: string) =>
  (found: StoreDirectoryFound): Result.Result<StoreDirectoryAction, StoreDirectoryRefused> => {
    if (found.link) return Result.fail(refused(path, "is a symbolic link"))
    if (!found.directory) return Result.fail(refused(path, "is not a directory"))
    return Result.succeed(new UseStoreDirectory())
  }

/**
 * Judges the store directory at `path` before anything is read from it,
 * without creating it: refuses only an entry that is there and is not a
 * directory, with {@link StoreDirectoryRefused}. Every other reading
 * passes, so the command fails afterwards as it did before (owner finding
 * F2, dogfood-2).
 */
export const judgeExistingStoreDirectory = (
  path: string,
  reading: StoreDirectoryReading,
): Result.Result<void, StoreDirectoryRefused> =>
  Match.valueTags(reading, {
    StoreDirectoryAbsent: () => Result.void,
    StoreDirectoryUnreadable: () => Result.void,
    StoreDirectoryFound: (found) => Result.flatMap(foundAction(path)(found), () => Result.void),
  })

/**
 * Judges the store directory at `path` after foreman tried to create it:
 * `created` is how the creation ended and `reading` what is at the path
 * afterwards. A mode left unset after `mkdir` succeeded is refused
 * whatever the reading. A failed `mkdir` is settled by the reading: a
 * directory made there first by another command is used, and a path
 * still empty is refused with the failure. Otherwise the path is usable
 * only when the reading shows a real directory.
 */
export const judgeCreatedStoreDirectory = (
  path: string,
  created: Result.Result<void, StoreDirectoryCreationFailed>,
  reading: StoreDirectoryReading,
): Result.Result<void, StoreDirectoryParentMissing | StoreDirectoryRefused> =>
  Result.match(created, {
    onSuccess: () => judgedAfterCreation(path, reading, "nothing is at the path after foreman created it"),
    onFailure: (failed) =>
      Match.valueTags(failed, {
        StoreDirectoryModeUnset: (unset) => Result.fail(refused(path, `mode 0700 could not be set: ${unset.reason}`)),
        StoreDirectoryUnreadable: (unmade) => judgedAfterCreation(path, reading, `could not be created: ${unmade.reason}`),
      }),
  })

/** The reading after a creation: a real directory passes; a path still empty is refused for `stillEmpty`. */
const judgedAfterCreation = (
  path: string,
  reading: StoreDirectoryReading,
  stillEmpty: string,
): Result.Result<void, StoreDirectoryParentMissing | StoreDirectoryRefused> =>
  Result.flatMap(judgeStoreDirectory(path, reading), (action) =>
    Match.valueTags(action, {
      UseStoreDirectory: () => Result.void,
      CreateStoreDirectory: () => Result.fail(refused(path, stillEmpty)),
    }),
  )

/** A refusal of the store directory at `path` for `reason`. */
const refused = (path: string, reason: string) => new StoreDirectoryRefused({ directory: path, reason })

/**
 * The parent of the absolute, normalized `path`: everything before its
 * last `/`, or `/` for a top-level path.
 */
export const parentOf = (path: string): string => {
  const parent = String.slice(0, Option.getOrElse(String.lastIndexOf(root)(path), () => 0))(path)
  return String.isEmpty(parent) ? root : parent
}
