// The clean git environment against hazards planted in the owner
// repository (design "Git environment", E7, and "Git probes"; plan B11b):
// a post-checkout hook, a smudge filter from `.gitattributes`,
// `core.fsmonitor` and `gpg.program`. Each is triggered by a command that
// runs it on git 2.50.1; the control (inherited runner) must see it act
// and the clean run must not. The smudge filter's clean run is `git
// worktree add` through the clean runner alone, since creation now refuses
// the committed `.gitattributes` before the add (plan B11c); a third case
// checks that refusal. Fixtures are in `git-hazard-fixtures.ts`.
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { existsSync, writeFileSync } from "node:fs"
import { AttributeRefusalReasons, AttributeSources } from "../../src/domain/attributes.ts"
import type { RunGit } from "../../src/runtime/git.ts"
import { cleanRun, emptyCommitWith, git, repositoryMillis, withRepo } from "../runtime/git-repo.ts"
import { kinds, refusalsOf } from "./attribute-fixtures.ts"
import {
  addWith,
  afterTrigger,
  commitFile,
  createAndIdentifyClean,
  createInherited,
  createWorktree,
  detected,
  inheritedGit,
  markerScript,
  prevented,
  request,
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

/** Creation refuses the committed `.gitattributes` before `git worktree add`, so the filter never runs. */
const smudgeRefused = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const marker = yield* plantSmudge(dir, owner)
    const refusals = yield* refusalsOf(createWorktree(request(owner, dir)))
    expect(kinds(refusals)).toEqual([[AttributeSources.Tree, AttributeRefusalReasons.Content]])
    expect(existsSync(marker)).toBe(false)
  })

const commitWith = (run: RunGit): Trigger => (_dir, owner) => emptyCommitWith(run)(owner, "signed?")

describe("post-checkout hook, run by git worktree add", () => {
  it.effect("control: the inherited runner runs it", detected(afterTrigger(plantHook, createInherited)), repositoryMillis)
  it.effect("the clean runner does not", prevented(afterTrigger(plantHook, createAndIdentifyClean)), repositoryMillis)
})

describe("smudge filter from .gitattributes, run by the checkout in git worktree add", () => {
  it.effect("control: the inherited runner runs it", detected(afterTrigger(plantSmudge, createInherited)), repositoryMillis)
  it.effect("worktree add through the clean runner does not",
    prevented(afterTrigger(plantSmudge, addWith(cleanRun))), repositoryMillis)
  it.effect("creation refuses it before worktree add", () => withRepo(smudgeRefused), repositoryMillis)
})

describe("core.fsmonitor, consulted by git worktree add", () => {
  it.effect("control: the inherited runner runs it", detected(afterTrigger(plantFsmonitor, createInherited)), repositoryMillis)
  it.effect("the clean runner does not", prevented(afterTrigger(plantFsmonitor, createAndIdentifyClean)), repositoryMillis)
})

describe("gpg.program with commit.gpgsign=true, run by a test-only commit", () => {
  it.effect("control: the inherited runner runs it", detected(afterTrigger(plantGpg, commitWith(inheritedGit))), repositoryMillis)
  it.effect("the clean runner does not", prevented(afterTrigger(plantGpg, commitWith(cleanRun))), repositoryMillis)
})
