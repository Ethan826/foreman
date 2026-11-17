// The startup check of the supervisor worktree (design "Supervisor
// worktree", "Startup check"): `git worktree list --porcelain` must list
// the recorded path on the recorded branch, locked; if not, `run` stops
// and reports which condition failed. Pure and total over the decoded
// listing; Program runs git and the decoder.
import { Array as Arr, Option, Result } from "effect"
import type { WorktreeCondition, WorktreeEntry } from "../domain/worktree.ts"
import { WorktreeCheckFailed, WorktreeConditions, localBranchRef } from "../domain/worktree.ts"

/** The recorded worktree: its absolute path and its short branch name (`foreman/<name>`). */
export interface RecordedWorktree {
  /** The path recorded in `WorktreeCreated`, compared exactly with the listing's. */
  readonly path: string
  /** The short branch name; the listing must show `refs/heads/<branch>`. */
  readonly branch: string
}

/**
 * Checks the listing against the recorded worktree. Succeeds with the
 * recorded path's entry when it is on `refs/heads/<branch>` and locked.
 * Otherwise fails with every condition that does not hold; when the path
 * is not listed, that is the only one reported. A detached entry is not
 * on the branch. Paths compare as exact strings, with no normalizing.
 */
export const checkWorktree = (
  recorded: RecordedWorktree,
  entries: ReadonlyArray<WorktreeEntry>,
): Result.Result<WorktreeEntry, WorktreeCheckFailed> =>
  Option.match(Arr.findFirst(entries, isAt(recorded.path)), {
    onNone: () => Result.fail(failure(recorded, [WorktreeConditions.Listed])),
    onSome: checkListed(recorded),
  })

/** Whether an entry is listed at exactly `path`. */
const isAt = (path: string) => (entry: WorktreeEntry): boolean => entry.path === path

/** Checks the branch and the lock of the recorded path's entry. */
const checkListed =
  (recorded: RecordedWorktree) =>
  (entry: WorktreeEntry): Result.Result<WorktreeEntry, WorktreeCheckFailed> =>
    Arr.match(failedConditions(recorded, entry), {
      onEmpty: () => Result.succeed(entry),
      onNonEmpty: (failed) => Result.fail(failure(recorded, failed)),
    })

/** The listed entry's conditions that do not hold, in vocabulary order. */
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
