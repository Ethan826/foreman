// The startup check's reading of the recorded worktree directory (owner
// ruling 5 on B11a, F9): a retained, locked registration in `git worktree
// list` does not show that the directory exists, so the check also reads
// what is at the path and what git identity it has. Raw results only
// (owner ruling on the R2 residue of the B11a review): what `stat` found,
// and each identity command's exit code and output. Format decodes them
// and Features decides.
import { Effect, Option } from "effect"
import type { PathStat } from "../domain/worktree.ts"
import { statOf } from "./file-paths.ts"
import type { GitOutput, RunGit } from "./git.ts"
import { revParseArgs } from "./worktree.ts"

/**
 * The raw reading of the recorded path. `stat` is what `stat` found:
 * nothing, a file or a directory. `identity` holds the full results of
 * the two identity `rev-parse` commands (exit code, stdout, stderr) run
 * inside the path. It is none when the path is not a directory, since
 * git cannot run inside anything else.
 */
export interface DirectoryReading {
  readonly stat: PathStat
  readonly identity: Option.Option<{ readonly gitDir: GitOutput; readonly commonDir: GitOutput }>
}

/**
 * The startup check's raw reading of the recorded path (owner ruling 5 on
 * B11a), with git run through `run`. Stats `path` and,
 * when a directory is there, runs the two identity `rev-parse` commands
 * inside it and keeps their results whatever they exit with. Fails with
 * `PathUnreadable` when `stat` fails other than by absence, such as under
 * an unsearchable parent.
 */
export const readDirectoryWith = (run: RunGit) => (path: string) =>
  Effect.flatMap(statOf(path), (stat) =>
    Option.exists(stat, isDirectoryStat) ? readIdentity(run, path, stat) : Effect.succeed(withoutIdentity(stat)),
  )

/** Whether `stat` found a directory, the only place git can run. */
const isDirectoryStat = (found: { readonly directory: boolean }): boolean => found.directory

/** A path that is not a directory: what `stat` found, and no identity reads. */
const withoutIdentity = (stat: PathStat): DirectoryReading => ({ stat, identity: Option.none() })

/** A directory with both identity commands' results, whatever they exited with. */
const readIdentity = (run: RunGit, path: string, stat: PathStat) =>
  Effect.map(
    Effect.all({ gitDir: run(path, revParseArgs.gitDir), commonDir: run(path, revParseArgs.commonDir) }),
    (reads): DirectoryReading => ({ stat, identity: Option.some(reads) }),
  )
