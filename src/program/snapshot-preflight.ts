// The snapshot's preflight (review finding B08, M14), run before anything
// is staged. It lists the base revision's tree and the paths git ignores,
// then walks the worktree from its top level with `readdir` and `lstat`
// (Runtime), never through a link at a walked entry, and lets Features
// decide what each directory means. Where Features says to ask, `git
// check-ignore` decides whether a directory or a finding is ignored. A
// gitlink in the base tree, a covered nested repository and a covered
// special file each refuse the snapshot, so `read-tree`, `add` and
// `write-tree` never run. The walk assumes the assisted rung's quiescence:
// no concurrent writer changes the worktree while it runs.
import { Array as Arr, Effect, Match } from "effect"
import type { Revision } from "../domain/ids.ts"
import {
  SnapshotPreflightRefused,
  WalkUnreadable,
  type PreflightFinding,
  type SnapshotStepFailed,
  type WalkStep,
} from "../domain/snapshot.ts"
import type { GitCommandFailed } from "../domain/worktree.ts"
import { baseGitlinks, coverageOf, displayPath, rootDirectory, walkSteps, type Coverage } from "../features/snapshot-preflight.ts"
import { decodePathList } from "../format/path-list.ts"
import type { RunGit } from "../runtime/git.ts"
import { snapshotArgs } from "../runtime/snapshot.ts"
import { listDirectory } from "../runtime/worktree-walk.ts"
import { listed, stepFailed, succeeded } from "./snapshot-steps.ts"

/** What a git step of the preflight can fail with: an unexpected exit or output, or git not running. */
export type WalkFailure = SnapshotStepFailed | GitCommandFailed

/** `git check-ignore`'s exit code for a path it ignores. */
const ignoredExit = 0

/** `git check-ignore`'s exit code for a path it does not ignore. */
const notIgnoredExit = 1

/**
 * The preflight in worktree `cwd` over `run`, the snapshot runner with
 * its fresh index not yet created: succeeds with nothing when no finding
 * stands, and fails with {@link SnapshotPreflightRefused} listing every
 * finding otherwise, base gitlinks first, then the walk's in name order.
 * A git step that exits other than as expected, or prints what does not
 * decode, fails with `SnapshotStepFailed`.
 */
export const preflight = Effect.fn("snapshotPreflight")(function* (run: RunGit, cwd: string, base: Revision) {
  const baseEntries = yield* listed(run, cwd, base)
  const ignored = yield* ignoredPaths(run, cwd)
  const walked = yield* walkFrom(run, cwd, coverageOf(baseEntries, ignored))(rootDirectory)
  const findings = [...baseGitlinks(baseEntries), ...walked]
  if (Arr.isReadonlyArrayNonEmpty(findings)) return yield* new SnapshotPreflightRefused({ findings })
})

/** The paths `ls-files --ignored --directory` prints, decoded strictly. */
const ignoredPaths = (run: RunGit, cwd: string) =>
  Effect.flatMap(succeeded(run, cwd, snapshotArgs.ignoredListing), (output) =>
    Effect.mapError(Effect.fromResult(decodePathList(output.stdout)), (issue) =>
      stepFailed(snapshotArgs.ignoredListing, output, issue.reason)),
  )

/** The findings in and below `directory`, which is relative to `cwd`. */
const walkFrom =
  (run: RunGit, cwd: string, coverage: Coverage) =>
  (directory: string): Effect.Effect<ReadonlyArray<PreflightFinding>, WalkFailure> =>
    Effect.flatMap(listDirectory(absolute(cwd, directory)), (reading) =>
      Match.valueTags(reading, {
        DirectoryUnlisted: (failed) =>
          Effect.succeed([new WalkUnreadable({ path: displayPath(directory), reason: failed.reason })]),
        DirectoryListed: (found) =>
          Effect.map(
            Effect.forEach(walkSteps(coverage, directory, found.children), takeStep(run, cwd, coverage)),
            Arr.flatten,
          ),
      }),
    )

/** One step: walk into a directory or keep a finding, after asking git where Features says to. */
const takeStep =
  (run: RunGit, cwd: string, coverage: Coverage) =>
  (step: WalkStep): Effect.Effect<ReadonlyArray<PreflightFinding>, WalkFailure> =>
    Match.valueTags(step, {
      WalkInto: (into) => unlessIgnored(run, cwd, into, Effect.suspend(() => walkFrom(run, cwd, coverage)(into.path))),
      WalkFound: (found) => unlessIgnored(run, cwd, { path: found.finding.path, unlessIgnored: found.unlessIgnored }, Effect.succeed([found.finding])),
    })

/** `then`, or nothing when the step asks git and git ignores its path. */
const unlessIgnored = (
  run: RunGit,
  cwd: string,
  step: { readonly path: string; readonly unlessIgnored: boolean },
  then: Effect.Effect<ReadonlyArray<PreflightFinding>, WalkFailure>,
): Effect.Effect<ReadonlyArray<PreflightFinding>, WalkFailure> =>
  step.unlessIgnored
    ? Effect.flatMap(isIgnored(run, cwd, step.path), (ignored) => (ignored ? Effect.succeed([]) : then))
    : then

/** Whether git ignores `path`: exit 0 yes, exit 1 no, any other exit fails the step. */
const isIgnored = (run: RunGit, cwd: string, path: string) =>
  Effect.flatMap(run(cwd, snapshotArgs.checkIgnore(path)), (output) => {
    if (output.exitCode === ignoredExit) return Effect.succeed(true)
    return output.exitCode === notIgnoredExit
      ? Effect.succeed(false)
      : Effect.fail(stepFailed(snapshotArgs.checkIgnore(path), output, output.stderr))
  })

/** The absolute path of `directory` in worktree `cwd`. */
const absolute = (cwd: string, directory: string): string =>
  directory === rootDirectory ? cwd : `${cwd}/${directory}`
