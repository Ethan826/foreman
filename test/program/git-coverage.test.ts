// Every git command the Program entry points run gets the clean
// environment and the three overrides (plan B11b). A recording process
// call sits beneath the clean runner and passes each invocation on to the
// real one, so creation and the startup check run against a real
// repository while every invocation is kept.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { createWorktreeWith, identifyWorktreeWith } from "../../src/program/worktree.ts"
import { cleanGitWith, startGit, type GitInvocation, type StartGit } from "../../src/runtime/git.ts"
import { emptyHome, withRepo } from "../runtime/git-repo.ts"

/** The real process call, which first records each invocation in `calls`. */
const recordingStart =
  (calls: Array<GitInvocation>): StartGit =>
  (invocation) =>
    Effect.andThen(
      Effect.sync(() => {
        calls.push(invocation)
      }),
      startGit(invocation),
    )

const overrides = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false"]

/** The command after the overrides, or the whole args when they do not start with them. */
const command = (invocation: GitInvocation) =>
  startsWithOverrides(invocation) ? invocation.args.slice(overrides.length) : invocation.args

const startsWithOverrides = (invocation: GitInvocation) =>
  overrides.every((each, index) => invocation.args[index] === each)

const createdAndIdentified = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const calls: Array<GitInvocation> = []
    const run = cleanGitWith(recordingStart(calls))(emptyHome)
    const path = `${dir}/worktree`
    const created = yield* createWorktreeWith(run)({ ownerCheckout: owner, path, name: "t", start: Option.none() })
    yield* identifyWorktreeWith(run)(created)
    expect(calls.map(command)).toEqual([
      ["rev-parse", "HEAD"],
      ["rev-parse", "--verify", "--quiet", "refs/heads/foreman/t"],
      ["worktree", "add", "--lock", "--reason", "foreman", "-b", "foreman/t", "--", path, created.base],
      ["rev-parse", "--show-toplevel"],
      ["rev-parse", "--symbolic-full-name", "HEAD"],
      ["rev-parse", "--absolute-git-dir"],
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      ["worktree", "list", "--porcelain", "-z"],
      ["rev-parse", "--absolute-git-dir"],
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    ])
    expect(calls.filter((each) => !startsWithOverrides(each))).toEqual([])
    expect(calls.map((each) => each.env)).toEqual(
      calls.map(() => ({
        PATH: "/usr/bin:/bin",
        HOME: emptyHome,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_ATTR_SOURCE: "4b825dc642cb6eb9a060e54bf8d69288fbe24904",
      })),
    )
  })

describe("Program's git commands", () => {
  it.effect("creation and the startup check run every git command clean, with the overrides first", () =>
    withRepo(createdAndIdentified))
})
