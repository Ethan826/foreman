// Attribute sources that git config reaches only in some contexts (plan
// B11c, Codex review of e7e43e3 and the owner's ruling, option R). A
// `core.attributesFile` in the supervisor worktree's `config.worktree`
// applies only inside that worktree, so the startup check reads it from
// there. A conditional include (`includeIf`) may select a file that sets
// `core.attributesFile` for the new worktree's branch alone, so creation
// and startup refuse any conditional include, nested in an unconditional
// `include.path` or not. Each refusal plants a marker filter; its control
// shows that git runs the filter when nothing checks.
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { rmSync, writeFileSync } from "node:fs"
import { AttributeRefusalReasons as Reasons, AttributeSources as Sources } from "../../src/domain/attributes.ts"
import { Revision } from "../../src/domain/ids.ts"
import { addWorktreeWith } from "../../src/runtime/worktree.ts"
import { cleanRun, git, repositoryMillis, withRepo } from "../runtime/git-repo.ts"
import { createWorktree, identifyWorktree, request } from "./git-hazard-fixtures.ts"
import { kinds, leftNothing, markerDeclaration, plantMarkerFilter, refusalsOf, written } from "./attribute-fixtures.ts"

/** Plants a source and returns the marker filter's marker. */
type Plant = (dir: string, owner: string) => Effect.Effect<string, unknown>

/** Writes the marker declaration to `<dir>/attributes` and returns that path. */
const attributesFile = (dir: string) => {
  writeFileSync(`${dir}/attributes`, markerDeclaration)
  return `${dir}/attributes`
}

/** Writes a config file at `<dir>/<name>` that sets `core.attributesFile`, and returns its path. */
const settingFile = (dir: string, name: string) => {
  writeFileSync(`${dir}/${name}`, `[core]\n\tattributesFile = ${attributesFile(dir)}\n`)
  return `${dir}/${name}`
}

/** The condition that matches the supervisor's branches and not the owner's. */
const onTarlatanBranch = "includeIf.onbranch:tarlatan/**.path"

/** `includeIf.onbranch:tarlatan/**` in the owner's config, selecting a file that sets `core.attributesFile`. */
const plantOnBranch: Plant = (dir, owner) =>
  Effect.tap(plantMarkerFilter(dir, owner), () => git(owner, "config", onTarlatanBranch, settingFile(dir, "selected")))

/** The same condition, written in a file that an unconditional `include.path` reaches. */
const plantNested: Plant = (dir, owner) =>
  Effect.tap(plantMarkerFilter(dir, owner), () => {
    const selected = settingFile(dir, "selected")
    writeFileSync(`${dir}/outer`, `[includeIf "onbranch:tarlatan/**"]\n\tpath = ${selected}\n`)
    return git(owner, "config", "include.path", `${dir}/outer`)
  })

/** The control: `git worktree add` on a `tarlatan/` branch through the clean runner, with no check. */
const addTarlatanWithoutCheck = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const base = Revision.make(yield* git(owner, "rev-parse", "HEAD"))
    yield* addWorktreeWith(cleanRun)(owner, { branch: "tarlatan/control", path: `${dir}/control`, base })
  })

const controlWrites = (plant: Plant) => () =>
  withRepo((dir, owner) =>
    Effect.gen(function* () {
      const marker = yield* plant(dir, owner)
      yield* addTarlatanWithoutCheck(dir, owner)
      expect(written(marker)).toBe(true)
    }),
  )

const refusedUnwritten = (plant: Plant) => () =>
  withRepo((dir, owner) =>
    Effect.gen(function* () {
      const marker = yield* plant(dir, owner)
      const refusals = yield* refusalsOf(createWorktree(request(owner, dir)))
      expect(kinds(refusals)).toEqual([[Sources.ConditionalInclude, Reasons.Configured]])
      expect(written(marker)).toBe(false)
      yield* leftNothing(dir, owner)
    }),
  )

describe("creation refuses any conditional include before worktree add", () => {
  it.effect("control: worktree add on a tarlatan/ branch runs the filter includeIf.onbranch selects", controlWrites(plantOnBranch), repositoryMillis)
  it.effect("includeIf.onbranch:tarlatan/** is refused, and the marker is not written", refusedUnwritten(plantOnBranch), repositoryMillis)
  it.effect("control: worktree add runs the filter a nested includeIf selects", controlWrites(plantNested), repositoryMillis)
  it.effect("an includeIf inside an unconditional include.path is refused, and the marker is not written", refusedUnwritten(plantNested), repositoryMillis)
})

/** An unconditional include of a harmless file, and the marker filter configured but not declared. */
const plantHarmlessInclude: Plant = (dir, owner) =>
  Effect.tap(plantMarkerFilter(dir, owner), () => {
    writeFileSync(`${dir}/harmless`, "[user]\n\tname = Included Name\n")
    return git(owner, "config", "include.path", `${dir}/harmless`)
  })

const passesWithoutIncludeIf = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const marker = yield* plantHarmlessInclude(dir, owner)
    expect(yield* git(owner, "config", "--get", "user.name")).toBe("Included Name")
    const created = yield* createWorktree(request(owner, dir))
    const entry = yield* identifyWorktree(created)
    expect(entry.path).toBe(created.path)
    expect(written(marker)).toBe(false)
  })

describe("a repository without includeIf", () => {
  it.effect("passes creation and the startup check, unconditional include.path and all", () =>
    withRepo(passesWithoutIncludeIf), repositoryMillis)
})

/**
 * Creates the worktree with the marker filter configured, then sets
 * `core.attributesFile` in the worktree's own `config.worktree`. Returns
 * the worktree and the marker.
 */
const createThenSetWorktreeConfig = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const marker = yield* plantMarkerFilter(dir, owner)
    const created = yield* createWorktree(request(owner, dir))
    yield* git(owner, "config", "extensions.worktreeConfig", "true")
    yield* git(created.path, "config", "--worktree", "core.attributesFile", attributesFile(dir))
    expect(yield* git(owner, "config", "--get", "--default", "unset", "core.attributesFile")).toBe("unset")
    return { created, marker }
  })

const worktreeConfigControl = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const { created, marker } = yield* createThenSetWorktreeConfig(dir, owner)
    rmSync(`${created.path}/a.txt`, { recursive: false, force: false })
    yield* git(created.path, "checkout", "--", "a.txt")
    expect(written(marker)).toBe(true)
  })

const worktreeConfigRefused = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const { created, marker } = yield* createThenSetWorktreeConfig(dir, owner)
    const refusals = yield* refusalsOf(identifyWorktree(created))
    expect(refusals.map((each) => [each.source, each.reason, each.detail])).toEqual([
      [Sources.AttributesFile, Reasons.Configured, `${dir}/attributes\n`],
    ])
    expect(written(marker)).toBe(false)
  })

const includeIfLaterRefused = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const created = yield* createWorktree(request(owner, dir))
    yield* git(owner, "config", onTarlatanBranch, `${dir}/absent`)
    expect(kinds(yield* refusalsOf(identifyWorktree(created)))).toEqual([[Sources.ConditionalInclude, Reasons.Configured]])
  })

describe("the startup check reads config from inside the supervisor worktree", () => {
  it.effect("control: a checkout in the worktree runs the filter its config.worktree names", () =>
    withRepo(worktreeConfigControl), repositoryMillis)
  it.effect("refuses a core.attributesFile set only in the worktree's config.worktree", () =>
    withRepo(worktreeConfigRefused), repositoryMillis)
  it.effect("refuses an includeIf added after creation", () => withRepo(includeIfLaterRefused), repositoryMillis)
})
