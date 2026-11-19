// The clean git environment against planted hazards (design "Git
// environment", E7, and "Git probes"; plan B11b). Each hazard is planted in
// a disposable owner repository and triggered by a command that runs it on
// git 2.50.1. The control runs the trigger through the inherited runner
// (the process call given the test process's own environment, as `runGit`
// ran before B11b) and must see the hazard act; the clean run goes through
// the production entry points and must not. The parent-environment
// hazards set HOME, GIT_CONFIG_GLOBAL or GIT_DIR in this test process's
// environment for the length of one test and restore it afterwards.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Option } from "effect"
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { createWorktree, createWorktreeWith, identifyWorktree } from "../../src/program/worktree.ts"
import { startGit, type RunGit } from "../../src/runtime/git.ts"
import { revParseArgs } from "../../src/runtime/worktree.ts"
import { cleanRun, emptyCommitWith, emptyHome, git, gitWith, makeRepo, withRepo } from "../runtime/git-repo.ts"

/** The pre-B11b runner: git with the test process's whole environment and no overrides. */
const inheritedGit: RunGit = (cwd, args) => startGit({ cwd, args, env: process.env })

const request = (owner: string, dir: string) => ({
  ownerCheckout: owner,
  path: `${dir}/worktree`,
  name: "t",
  start: Option.none(),
})

/** The control: `git worktree add` and its reads through the inherited runner. */
const createInherited = (dir: string, owner: string) => createWorktreeWith(inheritedGit)(request(owner, dir))

/** The production entry points over the clean runner: create, then the startup check. */
const createAndIdentifyClean = (dir: string, owner: string) =>
  Effect.flatMap(createWorktree(emptyHome)(request(owner, dir)), identifyWorktree(emptyHome))

/** Owner read, write and execute; group and others read and execute. */
const executableMode = 0o755

/**
 * Writes an executable shell script at `path` that appends a line to
 * `marker` and then runs `rest`, and returns `path`.
 */
const markerScript = (path: string, marker: string, rest = "") => {
  writeFileSync(path, `#!/bin/sh\necho ran >> '${marker}'\n${rest}`)
  chmodSync(path, executableMode)
  return path
}

/** A planted hazard: prepares the owner repository and returns its marker path. */
type Plant = (dir: string, owner: string) => Effect.Effect<string, unknown>

/** A command run against the planted repository. */
type Trigger = (dir: string, owner: string) => Effect.Effect<unknown, unknown>

/** What a scenario observed: the trigger's exit and whether the marker was written. */
interface Observed {
  readonly exit: Exit.Exit<unknown, unknown>
  readonly written: boolean
}

/** A hazard planted and triggered in a fresh repository. */
type Scenario = (dir: string, owner: string) => Effect.Effect<Observed, unknown>

/** Plants, runs the trigger, and reports the trigger's exit and whether the marker was written. */
const afterTrigger = (plant: Plant, trigger: Trigger): Scenario => (dir, owner) =>
  Effect.gen(function* () {
    const marker = yield* plant(dir, owner)
    const exit = yield* Effect.exit(trigger(dir, owner))
    return { exit, written: existsSync(marker) }
  })

const assertDetected = (after: Observed) => {
  expect(after.written).toBe(true)
}

const assertPrevented = (after: Observed) => {
  expect(after.written).toBe(false)
  expect(Exit.isSuccess(after.exit)).toBe(true)
}

/** The control must see the hazard act. */
const detected = (scenario: Scenario) => () =>
  withRepo((dir, owner) => Effect.map(scenario(dir, owner), assertDetected))

/** The clean run must succeed without the hazard acting. */
const prevented = (scenario: Scenario) => () =>
  withRepo((dir, owner) => Effect.map(scenario(dir, owner), assertPrevented))

const plantHook: Plant = (dir, owner) =>
  Effect.sync(() => {
    markerScript(`${owner}/.git/hooks/post-checkout`, `${dir}/hook.marker`)
    return `${dir}/hook.marker`
  })

const plantSmudge: Plant = (dir, owner) =>
  Effect.gen(function* () {
    writeFileSync(`${owner}/.gitattributes`, "*.txt filter=mark\n")
    yield* git(owner, "add", ".gitattributes")
    yield* commitFile(owner)
    const script = markerScript(`${dir}/smudge.sh`, `${dir}/smudge.marker`, "cat\n")
    yield* git(owner, "config", "filter.mark.smudge", script)
    yield* git(owner, "config", "filter.mark.clean", "cat")
    return `${dir}/smudge.marker`
  })

const plantFsmonitor: Plant = (dir, owner) =>
  Effect.gen(function* () {
    const script = markerScript(`${dir}/fsmonitor.sh`, `${dir}/fsmonitor.marker`)
    yield* git(owner, "config", "core.fsmonitor", script)
    return `${dir}/fsmonitor.marker`
  })

const plantGpg: Plant = (dir, owner) =>
  Effect.gen(function* () {
    const script = markerScript(`${dir}/gpg.sh`, `${dir}/gpg.marker`, "cat > /dev/null\nexit 1\n")
    yield* git(owner, "config", "commit.gpgsign", "true")
    yield* git(owner, "config", "gpg.program", script)
    return `${dir}/gpg.marker`
  })

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

/** Commits a file to `owner`, so a checkout of its HEAD has a file to smudge. */
const commitFile = (owner: string) =>
  Effect.gen(function* () {
    writeFileSync(`${owner}/a.txt`, "text\n")
    yield* git(owner, "add", "a.txt")
    yield* git(owner, "commit", "--quiet", "-m", "file")
  })

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
    const created = yield* underOther(createWorktree(emptyHome)(request(owner, dir)))
    expect(created.commonDir).toBe(repositories.ownerGitDir)
    const entry = yield* underOther(identifyWorktree(emptyHome)(created))
    expect(entry.path).toBe(created.path)
  })

const commitWith = (run: RunGit): Trigger => (_dir, owner) => emptyCommitWith(run)(owner, "signed?")

describe("post-checkout hook, run by git worktree add", () => {
  it.effect("control: the inherited runner runs it", detected(afterTrigger(plantHook, createInherited)))
  it.effect("the clean runner does not", prevented(afterTrigger(plantHook, createAndIdentifyClean)))
})

describe("smudge filter from .gitattributes, run by the checkout in git worktree add", () => {
  it.effect("control: the inherited runner runs it", detected(afterTrigger(plantSmudge, createInherited)))
  it.effect("the clean runner does not", prevented(afterTrigger(plantSmudge, createAndIdentifyClean)))
})

describe("core.fsmonitor, consulted by git worktree add", () => {
  it.effect("control: the inherited runner runs it", detected(afterTrigger(plantFsmonitor, createInherited)))
  it.effect("the clean runner does not", prevented(afterTrigger(plantFsmonitor, createAndIdentifyClean)))
})

describe("gpg.program with commit.gpgsign=true, run by a test-only commit", () => {
  it.effect("control: the inherited runner runs it", detected(afterTrigger(plantGpg, commitWith(inheritedGit))))
  it.effect("the clean runner does not", prevented(afterTrigger(plantGpg, commitWith(cleanRun))))
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
