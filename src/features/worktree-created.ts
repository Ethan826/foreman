// The check after creating the supervisor worktree (owner ruling 1 on
// B11a, as the coordinator read it): the new worktree's top level must be
// the requested path with symlinks resolved, and its HEAD must be
// `refs/heads/foreman/<name>`. The recorded path is git's top level, so
// this check ties that record to the worktree that was asked for. Pure;
// Program runs git and the decoders.
import { Result } from "effect"
import { WorktreeNotAsCreated, localBranchRef } from "../domain/worktree.ts"

/** What creation asked for. */
export interface RequestedWorktree {
  /** The requested path with symlinks resolved (`realpath` after the add). */
  readonly resolvedPath: string
  /** The short branch name, `foreman/<name>`. */
  readonly branch: string
}

/** What git reports inside the new worktree. */
export interface FoundWorktree {
  /** `rev-parse --show-toplevel`, symlinks resolved by git. */
  readonly toplevel: string
  /** `rev-parse --symbolic-full-name HEAD`: a full ref, or `HEAD` when detached. */
  readonly headRef: string
}

/**
 * Checks the new worktree against the request. Succeeds when the top
 * level equals the resolved requested path exactly and HEAD is exactly
 * `refs/heads/<branch>`; otherwise fails with {@link WorktreeNotAsCreated}
 * carrying both sides.
 */
export const checkCreated = (
  requested: RequestedWorktree,
  found: FoundWorktree,
): Result.Result<void, WorktreeNotAsCreated> =>
  isAsRequested(requested, found) ? Result.void : Result.fail(notAsCreated(requested, found))

/** Whether the top level and HEAD are exactly what was requested. */
const isAsRequested = (requested: RequestedWorktree, found: FoundWorktree): boolean =>
  found.toplevel === requested.resolvedPath && found.headRef === localBranchRef(requested.branch)

/** The failure naming the requested path and ref beside what git reported. */
const notAsCreated = (requested: RequestedWorktree, found: FoundWorktree) =>
  new WorktreeNotAsCreated({
    requestedPath: requested.resolvedPath,
    toplevel: found.toplevel,
    expectedRef: localBranchRef(requested.branch),
    headRef: found.headRef,
  })
