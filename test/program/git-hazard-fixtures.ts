// Shared fixtures for the git hazard tests (design "Git environment",
// E7, and "Git probes"; plan B11b): the inherited runner the controls use,
// the production entry points the clean runs use, marker scripts, and the
// scenario that plants a hazard, triggers it and reports what happened.
// The control runs the trigger through the inherited runner (the process
// call given the test process's own environment, as `runGit` ran before
// B11b) and must see the hazard act; the clean run goes through the
// production entry points and must not.
import { expect } from "@effect/vitest"
import { Effect, Exit, Option } from "effect"
import { chmodSync, existsSync, writeFileSync } from "node:fs"
import { Revision } from "../../src/domain/ids.ts"
import { worktreeProgram } from "../../src/program/worktree.ts"
import { startGit, type RunGit } from "../../src/runtime/git.ts"
import { addWorktreeWith } from "../../src/runtime/worktree.ts"
import { emptyHome, git, gitWith, withRepo } from "../runtime/git-repo.ts"

/** The production entry points over the test file's empty home. */
export const { createWorktree, identifyWorktree } = worktreeProgram(emptyHome)

/** The pre-B11b runner: git with the test process's whole environment and no overrides. */
export const inheritedGit: RunGit = (cwd, args) => startGit({ cwd, args, env: process.env })

/** The request every hazard test makes: `<dir>/worktree` on `foreman/t` from the owner's HEAD. */
export const request = (owner: string, dir: string) => ({
  ownerCheckout: owner,
  path: `${dir}/worktree`,
  name: "t",
  start: Option.none(),
})

/**
 * `git worktree add` of the owner's HEAD at `<dir>/worktree` on
 * `foreman/t` through `run`, with no prechecks and no attribute check.
 */
export const addWith = (run: RunGit) => (dir: string, owner: string) =>
  Effect.gen(function* () {
    const base = Revision.make(yield* gitWith(run)(owner, "rev-parse", "HEAD"))
    yield* addWorktreeWith(run)(owner, { branch: "foreman/t", path: `${dir}/worktree`, base })
  })

/**
 * The control: `git worktree add` through the inherited runner. It skips
 * creation's attribute check (plan B11c), which would refuse some planted
 * hazards before the add and so hide whether the environment stops them.
 */
export const createInherited = addWith(inheritedGit)

/** The production entry points over the clean runner: create, then the startup check. */
export const createAndIdentifyClean = (dir: string, owner: string) =>
  Effect.flatMap(createWorktree(request(owner, dir)), identifyWorktree)

/** Owner read, write and execute; group and others read and execute. */
export const executableMode = 0o755

/**
 * Writes an executable shell script at `path` that appends a line to
 * `marker` and then runs `rest`, and returns `path`.
 */
export const markerScript = (path: string, marker: string, rest = "") => {
  writeFileSync(path, `#!/bin/sh\necho ran >> '${marker}'\n${rest}`)
  chmodSync(path, executableMode)
  return path
}

/** A planted hazard: prepares the owner repository and returns its marker path. */
export type Plant = (dir: string, owner: string) => Effect.Effect<string, unknown>

/** A command run against the planted repository. */
export type Trigger = (dir: string, owner: string) => Effect.Effect<unknown, unknown>

/** What a scenario observed: the trigger's exit and whether the marker was written. */
export interface Observed {
  readonly exit: Exit.Exit<unknown, unknown>
  readonly written: boolean
}

/** A hazard planted and triggered in a fresh repository. */
export type Scenario = (dir: string, owner: string) => Effect.Effect<Observed, unknown>

/** Plants, runs the trigger, and reports the trigger's exit and whether the marker was written. */
export const afterTrigger = (plant: Plant, trigger: Trigger): Scenario => (dir, owner) =>
  Effect.gen(function* () {
    const marker = yield* plant(dir, owner)
    const exit = yield* Effect.exit(trigger(dir, owner))
    return { exit, written: existsSync(marker) }
  })

export const assertDetected = (after: Observed) => {
  expect(after.written).toBe(true)
}

export const assertPrevented = (after: Observed) => {
  expect(after.written).toBe(false)
  expect(Exit.isSuccess(after.exit)).toBe(true)
}

/** The control must see the hazard act. */
export const detected = (scenario: Scenario) => () =>
  withRepo((dir, owner) => Effect.map(scenario(dir, owner), assertDetected))

/** The clean run must succeed without the hazard acting. */
export const prevented = (scenario: Scenario) => () =>
  withRepo((dir, owner) => Effect.map(scenario(dir, owner), assertPrevented))

/** Commits a file to `owner`, so a checkout of its HEAD has a file to smudge. */
export const commitFile = (owner: string) =>
  Effect.gen(function* () {
    writeFileSync(`${owner}/a.txt`, "text\n")
    yield* git(owner, "add", "a.txt")
    yield* git(owner, "commit", "--quiet", "-m", "file")
  })
