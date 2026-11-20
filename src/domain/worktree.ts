// The supervisor worktree (design "Supervisor worktree", owner ruling
// 2026-11-15, owner rulings on B11a 2026-11-17): its branch name, an entry
// of `git worktree list --porcelain -z` as the core sees it, the reading
// of the worktree directory, the conditions of the startup check, and the
// typed failures of creating and identifying the worktree.
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
 * One entry of `git worktree list --porcelain -z`. `branch` is the full ref
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
 * What `stat` found at a path, following symlinks (owner ruling on R1 of
 * the B11a review): none when nothing is there (ENOENT or ENOTDIR), and
 * otherwise whether it is a directory, so a file and a directory stay
 * distinct. A permission or other I/O failure is not a reading; Runtime
 * reports it as {@link PathUnreadable}.
 */
export const PathStat = Schema.Option(Schema.Struct({ directory: Schema.Boolean }))
/** What `stat` found at a path; see {@link PathStat}. */
export type PathStat = typeof PathStat.Type

/** An identity `rev-parse` that exited 0, with the absolute path it printed. */
export class IdentityPrinted extends Schema.TaggedClass<IdentityPrinted>()(
  "IdentityPrinted",
  { path: GitText },
) {}

/**
 * An identity `rev-parse` that exited non-zero, as it does where git sees
 * no repository, with its exit code and stderr kept for the report.
 */
export class IdentityExited extends Schema.TaggedClass<IdentityExited>()(
  "IdentityExited",
  { exitCode: Schema.Int, stderr: Schema.String },
) {}

/**
 * One identity `rev-parse` as Format decoded it (owner ruling on the
 * R2 residue, 2026-11-18): the path it printed, or how it exited. Whether
 * either result identifies the recorded worktree is decided in Features.
 */
export const IdentityRead = Schema.Union([IdentityPrinted, IdentityExited])
/** One decoded identity `rev-parse`; see {@link IdentityRead}. */
export type IdentityRead = typeof IdentityRead.Type

/**
 * What the startup check found at the recorded path (owner ruling 5 on
 * B11a, F9, and the ruling on the R2 residue). `stat` is what was there:
 * nothing, a file or a directory. `identity` holds the two identity
 * `rev-parse` results read inside a directory. It is none when the path
 * is not a directory, because the commands are run only inside one.
 */
export const WorktreeDirectory = Schema.Struct({
  stat: PathStat,
  identity: Schema.Option(Schema.Struct({ gitDir: IdentityRead, commonDir: IdentityRead })),
})
/** What the startup check found at the recorded path; see {@link WorktreeDirectory}. */
export type WorktreeDirectory = typeof WorktreeDirectory.Type

/**
 * The conditions of the startup check (design "Startup check", owner
 * ruling 5 on B11a): the recorded path is listed, a directory is present
 * there, that directory has the recorded git identity, it is on
 * `refs/heads/<branch>`, and it is locked. A listed registration alone
 * does not show the worktree exists. Values are spelled so they cannot be
 * mistaken for porcelain keys.
 */
export const WorktreeConditions = {
  Listed: "path-listed",
  Present: "directory-present",
  Identity: "git-identity",
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
 * Creation refused: the requested path is not absolute (owner ruling on
 * R3 of the B11a review). Git would resolve a relative path against the
 * owner's checkout and read one starting with `-` as an option, so the
 * path is checked before any precheck or git command. Nothing is created.
 */
export class WorktreePathNotAbsolute extends Schema.TaggedError<WorktreePathNotAbsolute>()(
  "WorktreePathNotAbsolute",
  { path: Schema.String },
) {}

/**
 * The startup check was given a recorded worktree with an empty path,
 * branch, git directory or common directory (owner ruling on R4 of the
 * B11a review). `reason` is the schema's message. Nothing was checked.
 */
export class WorktreeRecordInvalid extends Schema.TaggedError<WorktreeRecordInvalid>()(
  "WorktreeRecordInvalid",
  { reason: Schema.String },
) {}

/**
 * Creation found the new worktree other than requested (owner ruling 1 on
 * B11a): its top level is not the requested path with symlinks resolved,
 * or its HEAD is not `refs/heads/foreman/<name>`. `headRef` is what
 * `rev-parse --symbolic-full-name HEAD` printed. The worktree is left in
 * place, locked; nothing is cleaned up.
 */
export class WorktreeNotAsCreated extends Schema.TaggedError<WorktreeNotAsCreated>()(
  "WorktreeNotAsCreated",
  { requestedPath: GitText, toplevel: GitText, expectedRef: GitText, headRef: GitText },
) {}

/** A path could not be inspected (stat or realpath failed other than by absence). */
export class PathUnreadable extends Schema.TaggedError<PathUnreadable>()(
  "PathUnreadable",
  { path: GitText, reason: Schema.String },
) {}

/**
 * A git command could not run, exited non-zero, or printed bytes that are
 * not valid UTF-8 (review finding B17; `stderr` then names that). `exitCode`
 * is none when git did not start or was ended by a signal.
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
