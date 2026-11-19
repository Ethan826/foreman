// The clean git environment against hazards planted in the owner
// repository (design "Git environment", E7, and "Git probes"; plan B11b):
// a post-checkout hook, a smudge filter from `.gitattributes`,
// `core.fsmonitor` and `gpg.program`. Each is triggered by a command that
// runs it on git 2.50.1; the control (inherited runner) must see it act
// and the clean run must not. Fixtures are in `git-hazard-fixtures.ts`.
import { describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { writeFileSync } from "node:fs"
import type { RunGit } from "../../src/runtime/git.ts"
import { cleanRun, emptyCommitWith, git } from "../runtime/git-repo.ts"
import {
  afterTrigger,
  commitFile,
  createAndIdentifyClean,
  createInherited,
  detected,
  inheritedGit,
  markerScript,
  prevented,
  type Plant,
  type Trigger,
} from "./git-hazard-fixtures.ts"

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
