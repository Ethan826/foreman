// The pinned git runner against real repositories (design "Supervisor
// worktree" and "Git environment", E7; plan B11d). A supervisor worktree
// is added from the owner's repository and its identity recorded; then a
// decoy repository is planted where git's own discovery would find it.
// Each plant has a control through a runner that discovers (the clean
// runner, or the inherited one for the parent environment) and must reach
// the decoy, and a pinned run that must still read the recorded worktree.
// Three reads tell the repositories apart, one per pinned variable: HEAD
// (the worktree's own git directory, GIT_DIR), a common config key
// (GIT_COMMON_DIR) and the untracked files (the work tree, GIT_WORK_TREE).
// None of the reads is a `rev-parse`, and none writes to any repository.
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { writeFileSync } from "node:fs"
import { Revision } from "../../src/domain/ids.ts"
import { pinnedGitWith, startGit, type RecordedGitIdentity, type RunGit } from "../../src/runtime/git.ts"
import { addWorktreeWith } from "../../src/runtime/worktree.ts"
import { cleanRun, emptyHome, git, gitWith, makeRepo, repositoryMillis, withRepo } from "./git-repo.ts"
import { withParentEnvironment } from "./parent-environment.ts"

/** The runner under test: the pinned runner over the real process call. */
const pinned = pinnedGitWith(startGit)(emptyHome)

/** The control for the parent environment: git with this process's whole environment. */
const inheritedGit: RunGit = (cwd, args) => startGit({ cwd, args, env: process.env })

/** The supervisor worktree, the decoy repository and the identity recorded before any plant. */
interface Setting {
  readonly recorded: RecordedGitIdentity
  readonly decoy: string
}

/**
 * Adds `<dir>/worktree` on `tarlatan/t`, records its identity, makes the
 * decoy at `<dir>/decoy`, and gives each a distinct config key and
 * untracked file.
 */
const supervisorAndDecoy = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const base = Revision.make(yield* git(owner, "rev-parse", "HEAD"))
    yield* addWorktreeWith(cleanRun)(owner, { branch: "tarlatan/t", path: `${dir}/worktree`, base })
    const recorded = {
      path: yield* git(`${dir}/worktree`, "rev-parse", "--show-toplevel"),
      gitDir: yield* git(`${dir}/worktree`, "rev-parse", "--absolute-git-dir"),
      commonDir: yield* git(`${dir}/worktree`, "rev-parse", "--path-format=absolute", "--git-common-dir"),
    }
    yield* makeRepo(dir, "decoy")
    yield* git(owner, "config", "probe.where", "owner")
    yield* git(`${dir}/decoy`, "config", "probe.where", "decoy")
    writeFileSync(`${recorded.path}/only-in-supervisor`, "")
    writeFileSync(`${dir}/decoy/only-in-decoy`, "")
    return { recorded, decoy: `${dir}/decoy` }
  })

/** HEAD, the common config key and the untracked files, read through `run` in the recorded path. */
const readings = (run: RunGit, setting: Setting) =>
  Effect.all({
    head: gitWith(run)(setting.recorded.path, "symbolic-ref", "HEAD"),
    where: gitWith(run)(setting.recorded.path, "config", "--get", "probe.where"),
    untracked: gitWith(run)(setting.recorded.path, "ls-files", "--others", "--exclude-standard"),
  })

/** What the three reads give in the recorded supervisor worktree. */
const supervisorReadings = { head: "refs/heads/tarlatan/t", where: "owner", untracked: "only-in-supervisor" }

/** Plants a redirection after the identity is recorded. */
type Plant = (setting: Setting) => Effect.Effect<void, unknown>

/** The worktree's `.git` file now names the decoy's git directory. */
const dotGitFile: Plant = (setting) =>
  Effect.sync(() => {
    writeFileSync(`${setting.recorded.path}/.git`, `gitdir: ${setting.decoy}/.git\n`)
  })

/** The worktree's `commondir` file now names the decoy's git directory. */
const commondirFile: Plant = (setting) =>
  Effect.sync(() => {
    writeFileSync(`${setting.recorded.gitDir}/commondir`, `${setting.decoy}/.git\n`)
  })

/** The worktree's own `config.worktree` now sets `core.worktree` to the decoy. */
const coreWorktree: Plant = (setting) =>
  Effect.andThen(
    git(setting.recorded.path, "config", "extensions.worktreeConfig", "true"),
    git(setting.recorded.path, "config", "--worktree", "core.worktree", setting.decoy),
  )

/** The three readings through `run` after `plant`. */
const readAfter = (plant: Plant, run: (setting: Setting) => RunGit) => (dir: string, owner: string) =>
  Effect.gen(function* () {
    const setting = yield* supervisorAndDecoy(dir, owner)
    yield* plant(setting)
    return yield* readings(run(setting), setting)
  })

const throughClean = () => cleanRun
const throughPinned = (setting: Setting) => pinned(setting.recorded)

/** A test that `plant` read through `run` gives `expected`. */
const reads = (plant: Plant, run: (setting: Setting) => RunGit, expected: object) => () =>
  withRepo((dir, owner) =>
    Effect.gen(function* () {
      expect(yield* readAfter(plant, run)(dir, owner)).toEqual(expected)
    }),
  )

describe("the pinned runner reads the recorded worktree after a redirection", () => {
  it.effect(
    "control: with the .git file naming the decoy, the clean runner reads the decoy's HEAD and config",
    reads(dotGitFile, throughClean, { head: "refs/heads/main", where: "decoy", untracked: "only-in-supervisor" }),
    repositoryMillis,
  )
  it.effect("with the .git file naming the decoy, the pinned runner reads the recorded worktree",
    reads(dotGitFile, throughPinned, supervisorReadings), repositoryMillis)
  it.effect(
    "control: with commondir naming the decoy, the clean runner reads the decoy's config",
    reads(commondirFile, throughClean, { ...supervisorReadings, where: "decoy" }),
    repositoryMillis,
  )
  it.effect("with commondir naming the decoy, the pinned runner reads the recorded config",
    reads(commondirFile, throughPinned, supervisorReadings), repositoryMillis)
  it.effect(
    "control: with core.worktree naming the decoy, the clean runner reads the decoy's files",
    reads(coreWorktree, throughClean, { ...supervisorReadings, untracked: "only-in-decoy" }),
    repositoryMillis,
  )
  it.effect("with core.worktree naming the decoy, the pinned runner reads the recorded work tree",
    reads(coreWorktree, throughPinned, supervisorReadings), repositoryMillis)
})

/** Runs `use` with GIT_DIR, GIT_WORK_TREE and GIT_COMMON_DIR naming the decoy, and one parent-only variable. */
const underHostileParent = <A, E>(decoy: string, use: Effect.Effect<A, E>) =>
  withParentEnvironment("GIT_DIR", `${decoy}/.git`, withParentEnvironment("GIT_WORK_TREE", decoy,
    withParentEnvironment("GIT_COMMON_DIR", `${decoy}/.git`, withParentEnvironment("TARLATAN_PARENT_ONLY", "leaked", use))))

/**
 * The readings through `run`, with the hostile parent environment set
 * before the setting is made and the runner built, so a runner that
 * copied the parent's environment when built would copy it too.
 */
const readUnderParent = (run: (setting: Setting) => RunGit) => (dir: string, owner: string) =>
  underHostileParent(
    `${dir}/decoy`,
    Effect.gen(function* () {
      const setting = yield* supervisorAndDecoy(dir, owner)
      return yield* readings(run(setting), setting)
    }),
  )

/** A shell alias that prints the environment git's child process got. */
const printEnvironment = ["-c", "alias.environment=!/usr/bin/env", "environment"]

/** The child's environment lines through `run`, under the hostile parent environment from the start. */
const childEnvironment = (run: (setting: Setting) => RunGit) => (dir: string, owner: string) =>
  underHostileParent(
    `${dir}/decoy`,
    Effect.gen(function* () {
      const setting = yield* supervisorAndDecoy(dir, owner)
      const text = yield* gitWith(run(setting))(setting.recorded.path, ...printEnvironment)
      return { setting, lines: text.split("\n") }
    }),
  )

/** Whether a line sets one of the three pinned variables. */
const isPinnedVariable = (line: string) =>
  line.startsWith("GIT_DIR=") || line.startsWith("GIT_WORK_TREE=") || line.startsWith("GIT_COMMON_DIR=")

/** Whether a line sets the variable only the parent environment has. */
const isParentOnly = (line: string) => line.startsWith("TARLATAN_PARENT_ONLY=")

const inheritedReadsDecoy = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const found = yield* readUnderParent(() => inheritedGit)(dir, owner)
    expect(found).toEqual({ head: "refs/heads/main", where: "decoy", untracked: "only-in-decoy" })
  })

const pinnedReadsRecorded = (dir: string, owner: string) =>
  Effect.gen(function* () {
    expect(yield* readUnderParent(throughPinned)(dir, owner)).toEqual(supervisorReadings)
  })

const inheritedChildLeaks = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const { lines } = yield* childEnvironment(() => inheritedGit)(dir, owner)
    expect(lines).toContain("TARLATAN_PARENT_ONLY=leaked")
  })

const pinnedChildRecorded = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const { setting, lines } = yield* childEnvironment(throughPinned)(dir, owner)
    expect(lines.filter(isPinnedVariable).sort()).toEqual([
      `GIT_COMMON_DIR=${setting.recorded.commonDir}`,
      `GIT_DIR=${setting.recorded.gitDir}`,
      `GIT_WORK_TREE=${setting.recorded.path}`,
    ])
    expect(lines.filter(isParentOnly)).toEqual([])
  })

describe("an inherited GIT_DIR, GIT_WORK_TREE and GIT_COMMON_DIR", () => {
  it.effect("control: the inherited runner reads the decoy", () => withRepo(inheritedReadsDecoy), repositoryMillis)
  it.effect("the pinned runner still reads the recorded worktree", () => withRepo(pinnedReadsRecorded), repositoryMillis)
  it.effect("control: the inherited runner's child sees the parent-only variable", () =>
    withRepo(inheritedChildLeaks), repositoryMillis)
  it.effect("the pinned runner's child has the recorded values and no parent-only variable", () =>
    withRepo(pinnedChildRecorded), repositoryMillis)
})
