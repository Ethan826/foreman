// The supervisor worktree (design "Supervisor worktree", owner ruling
// 2026-11-15): its branch name, an entry of `git worktree list
// --porcelain` as the core sees it, the conditions of the startup check,
// and the typed failures of creating and identifying the worktree.
import { Record, Schema } from "effect"
import { Revision } from "./ids.ts"

/** A non-empty path or ref name as git prints it. */
export const GitText = Schema.String.check(Schema.isNonEmpty())
/** A non-empty path or ref name; see {@link GitText}. */
export type GitText = typeof GitText.Type

/** The prefix of the supervisor's branch: `foreman/<name>` (design "Branch"). */
export const supervisorBranchPrefix = "foreman/"

/** The prefix git gives a local branch's full ref name. */
export const localBranchRefPrefix = "refs/heads/"

/** The supervisor's branch for a configured `name`: `foreman/<name>`. */
export const supervisorBranch = (name: string): string => `${supervisorBranchPrefix}${name}`

/** The full ref name of local branch `branch`: `refs/heads/<branch>`. */
export const localBranchRef = (branch: string): string => `${localBranchRefPrefix}${branch}`

/**
 * A worktree's lock. `reason` is none when the worktree was locked
 * without one (`locked` alone on its porcelain line).
 */
export const WorktreeLock = Schema.Struct({ reason: Schema.Option(GitText) })
/** A worktree's lock; see {@link WorktreeLock}. */
export type WorktreeLock = typeof WorktreeLock.Type

/**
 * One entry of `git worktree list --porcelain`. `branch` is the full ref
 * (`refs/heads/...`) and is none when the worktree is detached or bare;
 * `head` is none for a bare entry; `lock` is none when not locked.
 */
export const WorktreeEntry = Schema.Struct({
  path: GitText,
  head: Schema.Option(Revision),
  branch: Schema.Option(GitText),
  detached: Schema.Boolean,
  bare: Schema.Boolean,
  lock: Schema.Option(WorktreeLock),
})
/** One listed worktree; see {@link WorktreeEntry}. */
export type WorktreeEntry = typeof WorktreeEntry.Type

/**
 * The conditions of the startup check (design "Startup check"): the
 * recorded path is listed, it is on `refs/heads/<branch>`, and it is
 * locked. Values are spelled so they cannot be mistaken for porcelain keys.
 */
export const WorktreeConditions = {
  Listed: "path-listed",
  OnBranch: "on-branch",
  Locked: "is-locked",
} as const
/** One condition of the startup check; see {@link WorktreeConditions}. */
export const WorktreeCondition = Schema.Literals(Record.values(WorktreeConditions))
/** One condition of the startup check. */
export type WorktreeCondition = typeof WorktreeCondition.Type

/**
 * The startup check failed: `failed` lists every condition that does not
 * hold, in the order of {@link WorktreeConditions}. When the path is not
 * listed, that is the only condition reported. `run` stops and reports.
 */
export class WorktreeCheckFailed extends Schema.TaggedError<WorktreeCheckFailed>()(
  "WorktreeCheckFailed",
  { path: GitText, branch: GitText, failed: Schema.NonEmptyArray(WorktreeCondition) },
) {}

/** Creation refused: the branch already exists. Nothing is cleaned up. */
export class WorktreeBranchExists extends Schema.TaggedError<WorktreeBranchExists>()(
  "WorktreeBranchExists",
  { branch: GitText },
) {}

/** Creation refused: something already exists at the path. Nothing is cleaned up. */
export class WorktreePathExists extends Schema.TaggedError<WorktreePathExists>()(
  "WorktreePathExists",
  { path: GitText },
) {}

/**
 * A git command could not run or exited non-zero. `exitCode` is none
 * when git did not start or was ended by a signal.
 */
export class GitCommandFailed extends Schema.TaggedError<GitCommandFailed>()(
  "GitCommandFailed",
  {
    args: Schema.Array(Schema.String),
    exitCode: Schema.Option(Schema.Int),
    stderr: Schema.String,
  },
) {}

/** A git command's output did not have the expected shape. */
export class GitOutputUndecodable extends Schema.TaggedError<GitOutputUndecodable>()(
  "GitOutputUndecodable",
  { args: Schema.Array(Schema.String), reason: Schema.String },
) {}
