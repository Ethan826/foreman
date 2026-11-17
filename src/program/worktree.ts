// The supervisor worktree's startup check (design "Supervisor worktree",
// "Startup check"; plan B11a): Runtime lists the worktrees, Format decodes
// the listing and Features decides. Program only wires them.
import { Effect, Result } from "effect"
import type { WorktreeCreated } from "../domain/events.ts"
import { GitOutputUndecodable } from "../domain/worktree.ts"
import { checkWorktree } from "../features/worktree-check.ts"
import { decodeWorktreeList } from "../format/worktree-list.ts"
import { listWorktreesWith, runGit, type RunGit } from "../runtime/worktree.ts"

/** The listing command, for the failure that names it. */
const listArgs = ["worktree", "list", "--porcelain"]

/**
 * {@link identifyWorktree} over an injected git runner. Lists the worktrees
 * from the recorded common directory, so the check runs even when the
 * worktree's own path is gone.
 */
export const identifyWorktreeWith = (run: RunGit) =>
  Effect.fn("identifyWorktree")(function* (worktree: WorktreeCreated) {
    const text = yield* listWorktreesWith(run)(worktree.commonDir)
    const entries = yield* Effect.fromResult(
      Result.mapError(decodeWorktreeList(text), undecodable),
    )
    return yield* Effect.fromResult(checkWorktree(worktree, entries))
  })

/**
 * The startup check: succeeds with the recorded worktree's entry when
 * `git worktree list --porcelain` lists its path on `refs/heads/<branch>`,
 * locked; otherwise fails with `WorktreeCheckFailed` naming each failed
 * condition, and `run` stops and reports.
 */
export const identifyWorktree = identifyWorktreeWith(runGit)

/** A listing the decoder refused, as a typed failure. */
const undecodable = (issue: { readonly message: string }) =>
  new GitOutputUndecodable({ args: listArgs, reason: issue.message })
