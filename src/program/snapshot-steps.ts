// The snapshot's git steps that both the preflight and the staging use
// (plan A2, "Snapshot identity and raw checks"; review finding B08): run
// a command and require exit 0, list a tree strictly, and the typed
// failure of a step.
import { Effect, Match } from "effect"
import type { Revision } from "../domain/ids.ts"
import { SnapshotStepFailed } from "../domain/snapshot.ts"
import { decodeTreeRun } from "../format/tree-listing.ts"
import type { GitOutput, RunGit } from "../runtime/git.ts"
import { snapshotArgs } from "../runtime/snapshot.ts"

/** The exit code of a git command that succeeded. */
export const successExit = 0

/** Runs one command in `cwd` and requires exit 0; any other exit fails the step. */
export const succeeded = (run: RunGit, cwd: string, args: ReadonlyArray<string>) =>
  Effect.flatMap(run(cwd, args), (output) =>
    output.exitCode === successExit ? Effect.succeed(output) : Effect.fail(stepFailed(args, output, output.stderr)),
  )

/**
 * The entries of `tree` (a tree id or a revision), decoded strictly; a
 * failed or undecodable listing fails the step.
 */
export const listed = (run: RunGit, cwd: string, tree: Revision) =>
  Effect.flatMap(run(cwd, snapshotArgs.listTree(tree)), (output) =>
    Match.valueTags(decodeTreeRun(output), {
      TreeEntries: (decoded) => Effect.succeed(decoded.entries),
      TreeNotListed: (failed) => Effect.fail(stepFailed(snapshotArgs.listTree(tree), output, failed.stderr)),
      TreeUndecodable: (failed) => Effect.fail(stepFailed(snapshotArgs.listTree(tree), output, failed.reason)),
    }),
  )

/** The failure of one step, with its exit code and what explains it. */
export const stepFailed = (args: ReadonlyArray<string>, output: GitOutput, detail: string) =>
  new SnapshotStepFailed({ args, exitCode: output.exitCode, detail })
