// The snapshot git runner (plan "Snapshot identity and raw checks", slice
// A2): the B11d pinned runner plus `GIT_INDEX_FILE`, so the snapshot's
// staging writes a temporary index and never the worktree's own. Checked
// with a recording process call beneath it: exactly nine variables, and
// the three `-c` overrides before the command's own args.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { GitCommandFailed } from "../../src/domain/worktree.ts"
import { snapshotGitWith, type GitInvocation, type StartGit } from "../../src/runtime/git.ts"

/** A process call that records each invocation and reports exit 0 with no output. */
const recordingStart =
  (calls: Array<GitInvocation>): StartGit =>
  (invocation) =>
    Effect.sync(() => {
      calls.push(invocation)
      return { exitCode: 0, stdout: "", stderr: "" }
    })

const overrides = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false"]

/** A recorded identity whose three values differ from each other and from every clean value. */
const recorded = {
  path: "/state/worktree",
  gitDir: "/owner/.git/worktrees/worktree",
  commonDir: "/owner/.git",
}

const indexFile = "/state/snapshot-1/index"

const argsOf = (call: GitInvocation) => call.args

describe("snapshotGitWith", () => {
  it.effect("runs each command with exactly nine variables, the pinned eight and GIT_INDEX_FILE", () =>
    Effect.gen(function* () {
      const calls: Array<GitInvocation> = []
      const run = snapshotGitWith(recordingStart(calls))("/injected/home")(recorded)(indexFile)
      yield* run("/state/worktree", ["add", "-A"])
      expect(calls).toEqual([
        {
          cwd: "/state/worktree",
          args: [...overrides, "add", "-A"],
          env: {
            PATH: "/usr/bin:/bin",
            HOME: "/injected/home",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_ATTR_SOURCE: "4b825dc642cb6eb9a060e54bf8d69288fbe24904",
            GIT_DIR: "/owner/.git/worktrees/worktree",
            GIT_WORK_TREE: "/state/worktree",
            GIT_COMMON_DIR: "/owner/.git",
            GIT_INDEX_FILE: indexFile,
          },
        },
      ])
      expect(Object.keys(calls[0]?.env ?? {})).toHaveLength(9)
    }))

  it.effect("puts the three overrides before the command's own args on every command", () =>
    Effect.gen(function* () {
      const calls: Array<GitInvocation> = []
      const run = snapshotGitWith(recordingStart(calls))("/injected/home")(recorded)(indexFile)
      yield* run("/state/worktree", ["read-tree", "abc"])
      yield* run("/state/worktree", ["write-tree"])
      expect(calls.map(argsOf)).toEqual([
        [...overrides, "read-tree", "abc"],
        [...overrides, "write-tree"],
      ])
    }))

  it.effect("passes the process call's output and failure through unchanged", () =>
    Effect.gen(function* () {
      const exited: StartGit = () => Effect.succeed({ exitCode: 3, stdout: "out\n", stderr: "err\n" })
      const output = yield* snapshotGitWith(exited)("/h")(recorded)(indexFile)("/state/worktree", ["status"])
      expect(output).toEqual({ exitCode: 3, stdout: "out\n", stderr: "err\n" })
      const failure = new GitCommandFailed({ args: ["status"], exitCode: Option.none(), stderr: "killed\n" })
      const killed: StartGit = () => Effect.fail(failure)
      const refused = yield* Effect.flip(snapshotGitWith(killed)("/h")(recorded)(indexFile)("/state/worktree", ["status"]))
      expect(refused).toBe(failure)
    }))
})
