// The startup check of the supervisor worktree (design "Supervisor
// worktree", "Startup check"; owner ruling 5 on B11a): `git worktree list
// --porcelain -z` must list the recorded path on the recorded branch,
// locked, and the directory at that path must be present with the
// recorded git identity; if not, `run` stops and reports which condition
// failed. Pure and total over the decoded listing and directory reading;
// Program runs git and the decoders.
import { Array as Arr, Option, Result } from "effect"
import type {
  GitIdentity,
  WorktreeCondition,
  WorktreeDirectory,
  WorktreeEntry,
} from "../domain/worktree.ts"
import { WorktreeCheckFailed, WorktreeConditions, localBranchRef } from "../domain/worktree.ts"

/**
 * The recorded worktree, as `WorktreeCreated` holds it: its absolute
 * path, its short branch name (`foreman/<name>`) and its git identity.
 */
export interface RecordedWorktree extends GitIdentity {
  /** The path recorded in `WorktreeCreated`, compared exactly with the listing's. */
  readonly path: string
  /** The short branch name; the listing must show `refs/heads/<branch>`. */
  readonly branch: string
}

/**
 * Checks the listing and the directory reading against the recorded
 * worktree. Succeeds with the recorded path's entry when the directory is
 * present with the recorded git directory and common directory, and the
 * entry is on `refs/heads/<branch>` and locked. Otherwise fails with every
 * condition that does not hold, in vocabulary order. When the path is not
 * listed, that is the only one reported; when the directory is absent,
 * its identity is not reported. A detached entry is not on the branch.
 * Paths compare as exact strings, with no normalizing.
 */
export const checkWorktree = (
  recorded: RecordedWorktree,
  entries: ReadonlyArray<WorktreeEntry>,
  directory: WorktreeDirectory,
): Result.Result<WorktreeEntry, WorktreeCheckFailed> =>
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
 * The directory's conditions that do not hold: absent, or present without
 * the recorded identity. An absent directory has no identity to report.
 */
const directoryFailures = (
  recorded: RecordedWorktree,
  directory: WorktreeDirectory,
): ReadonlyArray<WorktreeCondition> => {
  if (!directory.present) return [WorktreeConditions.Present]
  return hasIdentity(recorded, directory) ? [] : [WorktreeConditions.Identity]
}

/** Whether the directory's git and common directories are exactly the recorded ones. */
const hasIdentity = (recorded: RecordedWorktree, directory: WorktreeDirectory): boolean =>
  Option.exists(directory.identity, isRecordedIdentity(recorded))

/** Whether an identity equals the recorded one, field by field. */
const isRecordedIdentity = (recorded: GitIdentity) => (identity: GitIdentity): boolean =>
  identity.gitDir === recorded.gitDir && identity.commonDir === recorded.commonDir

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
