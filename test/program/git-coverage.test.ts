// Every git command the Program entry points run gets the clean
// environment and the three overrides (plan B11b). The production entry
// points are `worktreeProgramWith(startGit)`. The first test drives that
// same factory over a recording process call, which passes each
// invocation on to the real one, so creation and the startup check run
// against a real repository while every invocation is kept. The second
// observes the production `worktreeProgram` itself: a smudge filter that
// the repository's own `.git/info/attributes` declares (which the clean
// environment does not switch off) is `/usr/bin/env`, so the checked-out
// file holds the environment git ran with. It must match the factory over
// the real `startGit`, so production passes `startGit` and nothing else.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { readFileSync, writeFileSync } from "node:fs"
import { worktreeProgram, worktreeProgramWith } from "../../src/program/worktree.ts"
import { startGit, type GitInvocation, type StartGit } from "../../src/runtime/git.ts"
import { emptyHome, git, withRepo } from "../runtime/git-repo.ts"

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
    const program = worktreeProgramWith(recordingStart(calls))(emptyHome)
    const path = `${dir}/worktree`
    const created = yield* program.createWorktree({ ownerCheckout: owner, path, name: "t", start: Option.none() })
    yield* program.identifyWorktree(created)
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

/** Commits `a.txt` and makes `/usr/bin/env` its smudge filter through `.git/info/attributes`. */
const plantEnvironmentProbe = (owner: string) =>
  Effect.gen(function* () {
    writeFileSync(`${owner}/a.txt`, "text\n")
    yield* git(owner, "add", "a.txt")
    yield* git(owner, "commit", "--quiet", "-m", "file")
    writeFileSync(`${owner}/.git/info/attributes`, "a.txt filter=probe\n")
    yield* git(owner, "config", "filter.probe.smudge", "/usr/bin/env")
  })

/**
 * The environment the smudge filter saw, as sorted lines, without
 * `GIT_DIR`, which git sets to the new worktree's own directory.
 */
const filterEnvironment = (worktree: string) =>
  readFileSync(`${worktree}/a.txt`, "utf8")
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("GIT_DIR="))
    .sort()

const productionMatchesFactory = (dir: string, owner: string) =>
  Effect.gen(function* () {
    yield* plantEnvironmentProbe(owner)
    const request = (name: string) => ({ ownerCheckout: owner, path: `${dir}/${name}`, name, start: Option.none() })
    const production = yield* worktreeProgram(emptyHome).createWorktree(request("production"))
    const reference = yield* worktreeProgramWith(startGit)(emptyHome).createWorktree(request("reference"))
    yield* worktreeProgram(emptyHome).identifyWorktree(production)
    expect(filterEnvironment(production.path)).toEqual(filterEnvironment(reference.path))
    expect(filterEnvironment(production.path)).toEqual(
      expect.arrayContaining([
        `HOME=${emptyHome}`,
        "GIT_CONFIG_NOSYSTEM=1",
        "GIT_CONFIG_GLOBAL=/dev/null",
        "GIT_ATTR_SOURCE=4b825dc642cb6eb9a060e54bf8d69288fbe24904",
      ]),
    )
  })

describe("Program's git commands", () => {
  it.effect("creation and the startup check run every git command clean, with the overrides first", () =>
    withRepo(createdAndIdentified))

  it.effect("the production entry points run git with the same environment as the factory over startGit", () =>
    withRepo(productionMatchesFactory))
})
