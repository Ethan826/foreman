// The startup check's reading of the recorded worktree directory (owner
// ruling 5 on B11a, F9): a retained, locked registration in `git worktree
// list` does not show that the directory exists, so the check also reads
// whether a directory is there and what git identity it has. Raw output
// only; Format decodes it and Features decides.
import { Effect, Option } from "effect"
import type { DirectoryReading } from "../domain/worktree.ts"
import { statOf } from "./file-paths.ts"
import { revParseArgs, runGit, type RunGit } from "./worktree.ts"

/** The reading of a path with no directory at it. */
const absentDirectory: DirectoryReading = { present: false, identity: Option.none() }

/**
 * {@link readDirectory} over an injected git runner. Reads whether a
 * directory is at `path` and, when one is, the two identity `rev-parse`
 * commands inside it. A command that exits non-zero there (no repository)
 * makes the identity none. Nothing at the path, or a file that is not a
 * directory, reads as absent. Fails with `PathUnreadable` when `stat`
 * fails other than by absence, such as under an unsearchable parent.
 */
export const readDirectoryWith = (run: RunGit) => (path: string) =>
  Effect.flatMap(statOf(path), (stat) =>
    Option.exists(stat, isDirectoryStat) ? readIdentity(run, path) : Effect.succeed(absentDirectory),
  )

/** The startup check's raw reading of the recorded path (owner ruling 5 on B11a). */
export const readDirectory = readDirectoryWith(runGit)

/** Whether `stat` found a directory, as opposed to some other file. */
const isDirectoryStat = (found: { readonly directory: boolean }): boolean => found.directory

/** A present directory with its identity reads, none unless both exit 0. */
const readIdentity = (run: RunGit, path: string) =>
  Effect.map(
    Effect.all({
      gitDir: stdoutOnSuccess(run, path, revParseArgs.gitDir),
      commonDir: stdoutOnSuccess(run, path, revParseArgs.commonDir),
    }),
    (reads): DirectoryReading => ({ present: true, identity: Option.all(reads) }),
  )

/** Runs git; stdout when it exits 0, none for any other exit code. */
const stdoutOnSuccess = (run: RunGit, cwd: string, args: ReadonlyArray<string>) =>
  Effect.map(run(cwd, args), (output) =>
    output.exitCode === 0 ? Option.some(output.stdout) : Option.none<string>(),
  )
