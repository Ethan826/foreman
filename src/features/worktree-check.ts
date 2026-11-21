// The startup check of the supervisor worktree (design "Supervisor
// worktree", "Startup check"; owner ruling 5 on B11a): `git worktree list
// --porcelain -z` must list the recorded path on the recorded branch,
// locked, and the directory at that path must be present with the
// recorded git identity; if not, `run` stops and reports which condition
// failed. Pure and total over the decoded listing and directory reading;
// a recorded worktree with an empty field is a typed refusal, not a throw
// (owner ruling on R4 of the B11a review). Program runs git and the
// decoders.
import { Array as Arr, Match, Option, Result, Schema } from "effect"
import type {
  IdentityRead,
  WorktreeCondition,
  WorktreeDirectory,
  WorktreeEntry,
} from "../domain/worktree.ts"
import {
  GitText,
  WorktreeCheckFailed,
  WorktreeConditions,
  WorktreeRecordInvalid,
  localBranchRef,
} from "../domain/worktree.ts"

/**
 * The recorded worktree, as `WorktreeCreated` holds it: its path,
 * compared exactly with the listing's; its short branch name
 * (`foreman/<name>`), whose ref `refs/heads/<branch>` the listing must
 * show; and its git identity. Every field is non-empty text.
 */
export const RecordedWorktree = Schema.Struct({
  path: GitText,
  branch: GitText,
  gitDir: GitText,
  commonDir: GitText,
})
/** The recorded worktree; see {@link RecordedWorktree}. */
export type RecordedWorktree = typeof RecordedWorktree.Type

const decodeRecorded = Schema.decodeUnknownResult(RecordedWorktree)

/**
 * Checks the listing and the directory reading against the recorded
 * worktree. Succeeds with the recorded path's entry when the directory is
 * present with the recorded git directory and common directory, and the
 * entry is on `refs/heads/<branch>` and locked. Otherwise fails with every
 * condition that does not hold, in vocabulary order. When the path is not
 * listed, that is the only one reported; when the directory is absent,
 * its identity is not reported. A detached entry is not on the branch.
 * Paths compare as exact strings, with no normalizing. A recorded
 * worktree with an empty field fails with {@link WorktreeRecordInvalid}
 * and nothing is checked.
 */
export const checkWorktree = (
  recorded: RecordedWorktree,
  entries: ReadonlyArray<WorktreeEntry>,
  directory: WorktreeDirectory,
): Result.Result<WorktreeEntry, WorktreeCheckFailed | WorktreeRecordInvalid> =>
  Result.flatMap(validRecord(recorded), checkRecorded(entries, directory))

/** The recorded worktree when every field is non-empty; a typed refusal otherwise. */
const validRecord = (recorded: RecordedWorktree): Result.Result<RecordedWorktree, WorktreeRecordInvalid> =>
  Result.mapError(decodeRecorded(recorded), invalidRecord)

/** A schema issue as the typed refusal of the record. */
const invalidRecord = (issue: { readonly message: string }) =>
  new WorktreeRecordInvalid({ reason: issue.message })

/** Finds the recorded path's entry and checks it; a missing path is reported alone. */
const checkRecorded =
  (entries: ReadonlyArray<WorktreeEntry>, directory: WorktreeDirectory) =>
  (recorded: RecordedWorktree): Result.Result<WorktreeEntry, WorktreeCheckFailed> =>
    Option.match(Arr.findFirst(entries, isAt(recorded.path)), {
      onNone: () => Result.fail(failure(recorded, [WorktreeConditions.Listed])),
      onSome: checkListed(recorded, directory),
    })

/** Whether an entry is listed at exactly `path`. */
const isAt = (path: string) => (entry: WorktreeEntry): boolean => entry.path === path

/** Checks the branch and the lock of the recorded path's entry. */
const checkListed =
  (recorded: RecordedWorktree, directory: WorktreeDirectory) =>
  (entry: WorktreeEntry): Result.Result<WorktreeEntry, WorktreeCheckFailed> =>
    Arr.match(Arr.appendAll(directoryFailures(recorded, directory), failedConditions(recorded, entry)), {
      onEmpty: () => Result.succeed(entry),
      onNonEmpty: (failed) => Result.fail(failure(recorded, failed)),
    })

/**
 * The directory's conditions that do not hold (owner ruling on the R2
 * residue of the B11a review: this is where the reading is judged).
 * Nothing at the path, or a file, means no directory is present, and a
 * path that is not a directory has no identity to report. A directory
 * fails the identity condition unless both identity commands printed
 * exactly the recorded paths. A command that reported no repository
 * there does not identify it. A command git could not complete never
 * reaches this judgment: Program fails with `GitCommandFailed` instead
 * (focused re-review finding 1).
 */
const directoryFailures = (
  recorded: RecordedWorktree,
  directory: WorktreeDirectory,
): ReadonlyArray<WorktreeCondition> => {
  if (!Option.exists(directory.stat, isDirectoryStat)) return [WorktreeConditions.Present]
  return hasIdentity(recorded, directory) ? [] : [WorktreeConditions.Identity]
}

/** Whether `stat` found a directory, as opposed to a file. */
const isDirectoryStat = (found: { readonly directory: boolean }): boolean => found.directory

/** Whether both identity commands printed exactly the recorded git and common directories. */
const hasIdentity = (recorded: RecordedWorktree, directory: WorktreeDirectory): boolean =>
  Option.exists(
    directory.identity,
    (reads) => printed(reads.gitDir, recorded.gitDir) && printed(reads.commonDir, recorded.commonDir),
  )

/** Whether an identity command exited 0 and printed exactly `expected`. */
const printed = (read: IdentityRead, expected: string): boolean =>
  Match.valueTags(read, {
    IdentityPrinted: (found) => found.path === expected,
    IdentityNoRepository: () => false,
  })

/** The listed entry's branch and lock conditions that do not hold, in vocabulary order. */
const failedConditions = (
  recorded: RecordedWorktree,
  entry: WorktreeEntry,
): ReadonlyArray<WorktreeCondition> =>
  Arr.appendAll(
    isOnBranch(recorded.branch, entry) ? [] : [WorktreeConditions.OnBranch],
    Option.isSome(entry.lock) ? [] : [WorktreeConditions.Locked],
  )

/** Whether the entry's ref is exactly `refs/heads/<branch>`. */
const isOnBranch = (branch: string, entry: WorktreeEntry): boolean =>
  Option.contains(entry.branch, localBranchRef(branch))

/** The check's failure for the recorded worktree. */
const failure = (
  recorded: RecordedWorktree,
  failed: Arr.NonEmptyReadonlyArray<WorktreeCondition>,
) => new WorktreeCheckFailed({ path: recorded.path, branch: recorded.branch, failed })
