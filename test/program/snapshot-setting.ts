// Test helper for the snapshot against real disposable repositories (plan
// A2, "Snapshot identity and raw checks"): a supervisor worktree added
// from the owner's repository with its identity recorded, as at creation,
// a state directory beside it, and the snapshot over a process call the
// test chooses, such as one that records every git command.
import { Effect } from "effect"
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { Revision } from "../../src/domain/ids.ts"
import { snapshotProgramWith } from "../../src/program/snapshot.ts"
import { startGit, type GitInvocation, type RecordedGitIdentity, type StartGit } from "../../src/runtime/git.ts"
import { addWorktreeWith } from "../../src/runtime/worktree.ts"
import { cleanRun, emptyHome, git, withRepo } from "../runtime/git-repo.ts"

/** The supervisor worktree's recorded identity, the base it was created at, and the state directory. */
export interface Setting {
  readonly identity: RecordedGitIdentity
  readonly base: Revision
  readonly state: string
}

/**
 * Commits `a.txt`, `run.sh` (executable) and `link` (to `a.txt`) in the
 * owner's repository, adds `<dir>/worktree` on `tarlatan/t` at that commit,
 * records its identity and makes `<dir>/state`.
 */
export const supervisor = (dir: string, owner: string) =>
  Effect.gen(function* () {
    writeFileSync(`${owner}/a.txt`, "alpha\n")
    writeFileSync(`${owner}/run.sh`, "#!/bin/sh\n")
    chmodSync(`${owner}/run.sh`, 0o755)
    symlinkSync("a.txt", `${owner}/link`)
    yield* git(owner, "add", "-A")
    yield* git(owner, "commit", "--quiet", "-m", "fixtures")
    const base = Revision.make(yield* git(owner, "rev-parse", "HEAD"))
    const path = `${dir}/worktree`
    yield* addWorktreeWith(cleanRun)(owner, { branch: "tarlatan/t", path, base })
    const identity = {
      path: yield* git(path, "rev-parse", "--show-toplevel"),
      gitDir: yield* git(path, "rev-parse", "--absolute-git-dir"),
      commonDir: yield* git(path, "rev-parse", "--path-format=absolute", "--git-common-dir"),
    }
    mkdirSync(`${dir}/state`)
    return { identity, base, state: `${dir}/state` }
  })

/** The snapshot of the setting's worktree through `start`. */
export const snapshotWith = (start: StartGit) => (setting: Setting) =>
  snapshotProgramWith(start)(emptyHome)(setting.identity)(
    { worktree: setting.identity.path, stateDirectory: setting.state },
    setting.base,
  )

/** The snapshot over the real process call. */
export const snapshot = snapshotWith(startGit)

/** The real process call, which first records each invocation in `calls`. */
export const recordingStart =
  (calls: Array<GitInvocation>): StartGit =>
  (invocation) =>
    Effect.andThen(
      Effect.sync(() => {
        calls.push(invocation)
      }),
      startGit(invocation),
    )

/** The git command of a recorded invocation, after the six override args: its first two words. */
export const commandOf = (call: GitInvocation) => call.args.slice(6, 8)

/** A test over a fresh supervisor worktree. */
export const inSupervisor = <A, E>(use: (setting: Setting, dir: string) => Effect.Effect<A, E>) => () =>
  withRepo((dir, owner) => Effect.flatMap(supervisor(dir, owner), (setting) => use(setting, dir)))
