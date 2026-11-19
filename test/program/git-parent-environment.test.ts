// The clean git environment against a hostile parent environment
// (design "Git environment", E7; plan B11b): a global config reached
// through the parent's HOME or GIT_CONFIG_GLOBAL, and a parent GIT_DIR
// naming another repository. These tests set HOME, GIT_CONFIG_GLOBAL or
// GIT_DIR in this test process's environment for the length of one test
// and restore it afterwards (accepted by the owner, 2026-11-18: tests in a
// file run one at a time, and each file has its own worker process).
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import type { RunGit } from "../../src/runtime/git.ts"
import { revParseArgs } from "../../src/runtime/worktree.ts"
import { cleanRun, git, gitWith, makeRepo, withRepo } from "../runtime/git-repo.ts"
import {
  commitFile,
  createAndIdentifyClean,
  createInherited,
  createWorktree,
  detected,
  identifyWorktree,
  inheritedGit,
  markerScript,
  prevented,
  request,
  type Scenario,
  type Trigger,
} from "./git-hazard-fixtures.ts"

/**
 * Writes a hostile global config under `<dir>/hostile`: an attributes file
 * that gives every path a filter whose smudge program writes a marker.
 * Returns the config's directory and its marker.
 */
const hostileGlobalConfig = (dir: string) => {
  mkdirSync(`${dir}/hostile`)
  const script = markerScript(`${dir}/hostile/smudge.sh`, `${dir}/global.marker`, "cat\n")
  writeFileSync(`${dir}/hostile/attributes`, "* filter=hostile\n")
  writeFileSync(
    `${dir}/hostile/.gitconfig`,
    `[core]\n\tattributesFile = ${dir}/hostile/attributes\n[filter "hostile"]\n\tsmudge = ${script}\n`,
  )
  return { home: `${dir}/hostile`, config: `${dir}/hostile/.gitconfig`, marker: `${dir}/global.marker` }
}

/** The parent variables these tests set, each unset again by a static delete. */
const unsetters = {
  HOME: () => {
    delete process.env.HOME
  },
  GIT_CONFIG_GLOBAL: () => {
    delete process.env.GIT_CONFIG_GLOBAL
  },
  GIT_DIR: () => {
    delete process.env.GIT_DIR
  },
}

/** A variable of the parent environment that these tests set. */
type ParentVariable = keyof typeof unsetters

/**
 * Runs `use` with one variable set in this process's environment, and
 * restores it (or unsets it, if it was unset) afterwards.
 */
const withParentEnvironment = <A, E>(name: ParentVariable, value: string, use: Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const saved = process.env[name]
      process.env[name] = value
      return saved
    }),
    () => use,
    (saved) =>
      Effect.sync(() => {
        if (saved === undefined) unsetters[name]()
        else process.env[name] = saved
      }),
  )

/**
 * Plants the hostile global config, points the parent variable `name` at
 * it, runs the trigger, and reports its exit and the marker.
 */
const underHostileGlobal = (name: "HOME" | "GIT_CONFIG_GLOBAL", trigger: Trigger): Scenario => (dir, owner) =>
  Effect.gen(function* () {
    yield* commitFile(owner)
    const hostile = hostileGlobalConfig(dir)
    const value = name === "HOME" ? hostile.home : hostile.config
    const exit = yield* withParentEnvironment(name, value, Effect.exit(trigger(dir, owner)))
    return { exit, written: existsSync(hostile.marker) }
  })

/** A second repository at `<dir>/other` and the absolute git directories of both. */
const twoRepositories = (dir: string, owner: string) =>
  Effect.gen(function* () {
    yield* makeRepo(dir, "other")
    return {
      ownerGitDir: yield* git(owner, "rev-parse", "--absolute-git-dir"),
      otherGitDir: yield* git(`${dir}/other`, "rev-parse", "--absolute-git-dir"),
    }
  })

/** The production `rev-parse --absolute-git-dir` read in `owner` through `run`, under a parent GIT_DIR. */
const gitDirUnderParent = (run: RunGit, owner: string, parentGitDir: string) =>
  withParentEnvironment("GIT_DIR", parentGitDir, gitWith(run)(owner, ...revParseArgs.gitDir))

const inheritedSelectsOther = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const repositories = yield* twoRepositories(dir, owner)
    const selected = yield* gitDirUnderParent(inheritedGit, owner, repositories.otherGitDir)
    expect(selected).toBe(repositories.otherGitDir)
  })

const cleanSelectsOwner = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const repositories = yield* twoRepositories(dir, owner)
    const selected = yield* gitDirUnderParent(cleanRun, owner, repositories.otherGitDir)
    expect(selected).toBe(repositories.ownerGitDir)
  })

const cleanCreatesInOwner = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const repositories = yield* twoRepositories(dir, owner)
    const underOther = <A, E>(use: Effect.Effect<A, E>) =>
      withParentEnvironment("GIT_DIR", repositories.otherGitDir, use)
    const created = yield* underOther(createWorktree(request(owner, dir)))
    expect(created.commonDir).toBe(repositories.ownerGitDir)
    const entry = yield* underOther(identifyWorktree(created))
    expect(entry.path).toBe(created.path)
  })

describe("a hostile global config in the parent environment", () => {
  it.effect("control: through HOME, the inherited runner reads it", detected(underHostileGlobal("HOME", createInherited)))
  it.effect("through HOME, the clean runner does not read it", prevented(underHostileGlobal("HOME", createAndIdentifyClean)))
  it.effect(
    "control: through GIT_CONFIG_GLOBAL, the inherited runner reads it",
    detected(underHostileGlobal("GIT_CONFIG_GLOBAL", createInherited)),
  )
  it.effect(
    "through GIT_CONFIG_GLOBAL, the clean runner does not read it",
    prevented(underHostileGlobal("GIT_CONFIG_GLOBAL", createAndIdentifyClean)),
  )
})

describe("an inherited GIT_DIR naming another repository", () => {
  it.effect("control: the inherited runner's git directory read selects the other repository", () =>
    withRepo(inheritedSelectsOther))
  it.effect("the clean runner's git directory read selects the owner's repository", () => withRepo(cleanSelectsOwner))
  it.effect("the clean runner creates and checks the worktree in the owner's repository", () =>
    withRepo(cleanCreatesInOwner))
})
