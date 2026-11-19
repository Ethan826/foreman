// Creation refuses attribute sources before `git worktree add` (plan
// B11c, option A, owner rulings 2 to 4 of 2026-11-19). Each case plants a
// source in a disposable owner repository and creates through the
// production entry points. Where a marker filter is planted, the refused
// creation must not write the marker, and a control that runs `git
// worktree add` through the same clean runner without the check must
// write it, which shows the hazard is real under the clean environment.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { AttributeRefusalReasons as Reasons, AttributeSources as Sources } from "../../src/domain/attributes.ts"
import { Revision } from "../../src/domain/ids.ts"
import { addWorktreeWith } from "../../src/runtime/worktree.ts"
import { cleanRun, git, withRepo } from "../runtime/git-repo.ts"
import { createWorktree, identifyWorktree, request } from "./git-hazard-fixtures.ts"
import {
  commitAttributes,
  kinds,
  leftNothing,
  markerDeclaration,
  plantMarkerFilter,
  refusalsOf,
  written,
} from "./attribute-fixtures.ts"

/** A planted source: prepares the owner repository and returns the filter's marker. */
type Plant = (dir: string, owner: string) => Effect.Effect<string, unknown>

/** Creation through the production entry points, which must be refused. */
const refusedCreation = (dir: string, owner: string) => refusalsOf(createWorktree(request(owner, dir)))

/** The control: `git worktree add` of the owner's HEAD through the clean runner, with no check. */
const addWithoutCheck = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const base = Revision.make(yield* git(owner, "rev-parse", "HEAD"))
    yield* addWorktreeWith(cleanRun)(owner, { branch: "control", path: `${dir}/control`, base })
  })

/** Commits `content` as `.gitattributes`, after `prepare`, and expects one content refusal per line given. */
const refusesLines =
  (content: string, lines: ReadonlyArray<readonly [number, string]>, prepare: Plant = () => Effect.succeed("")) =>
  () =>
    withRepo((dir, owner) =>
      Effect.gen(function* () {
        yield* prepare(dir, owner)
        yield* commitAttributes(owner, ".gitattributes", content)
        const refusals = yield* refusedCreation(dir, owner)
        expect(kinds(refusals)).toEqual(lines.map(() => [Sources.Tree, Reasons.Content]))
        expect(refusals.map((each) => [each.line, each.detail])).toEqual(
          lines.map(([line, detail]) => [Option.some(line), detail]),
        )
        yield* leftNothing(dir, owner)
      }),
    )

const autocrlf: Plant = (_dir, owner) => Effect.as(git(owner, "config", "core.autocrlf", "true"), "")

describe("the review's counterexamples are refused at creation", () => {
  it.effect("C3: a declaration that matches no tracked path", refusesLines("future/*.bin filter=mark\n", [[1, "future/*.bin filter=mark"]]))
  it.effect("C4: a declaration that cancels itself", refusesLines("a.txt text\na.txt !text\n", [[1, "a.txt text"], [2, "a.txt !text"]]))
  it.effect("C2: an explicit unset, * -text, under core.autocrlf=true", refusesLines("* -text\n", [[1, "* -text"]], autocrlf))
})

const plantInfo: Plant = (dir, owner) =>
  Effect.tap(plantMarkerFilter(dir, owner), () =>
    Effect.sync(() => {
      writeFileSync(`${owner}/.git/info/attributes`, markerDeclaration)
    }),
  )

const plantSetting: Plant = (dir, owner) =>
  Effect.tap(plantMarkerFilter(dir, owner), () => {
    writeFileSync(`${dir}/attributes`, markerDeclaration)
    return git(owner, "config", "core.attributesFile", `${dir}/attributes`)
  })

/** The control: with the source planted, `worktree add` without the check writes the marker. */
const controlWrites = (plant: Plant) => () =>
  withRepo((dir, owner) =>
    Effect.gen(function* () {
      const marker = yield* plant(dir, owner)
      yield* addWithoutCheck(dir, owner)
      expect(written(marker)).toBe(true)
    }),
  )

/** With the source planted, creation is refused with `expected` and the marker is not written. */
const refusedUnwritten = (plant: Plant, expected: ReadonlyArray<readonly [string, string]>) => () =>
  withRepo((dir, owner) =>
    Effect.gen(function* () {
      const marker = yield* plant(dir, owner)
      expect(kinds(yield* refusedCreation(dir, owner))).toEqual(expected)
      expect(written(marker)).toBe(false)
      yield* leftNothing(dir, owner)
    }),
  )

describe("a filter in info/attributes or a repository core.attributesFile", () => {
  it.effect("control: worktree add without the check runs the info/attributes filter", controlWrites(plantInfo))
  it.effect(
    "info/attributes is refused before worktree add, and the marker is not written",
    refusedUnwritten(plantInfo, [[Sources.InfoAttributes, Reasons.Content]]),
  )
  it.effect("control: worktree add without the check runs the core.attributesFile filter", controlWrites(plantSetting))
  it.effect(
    "core.attributesFile is refused before worktree add, and the marker is not written",
    refusedUnwritten(plantSetting, [[Sources.AttributesFile, Reasons.Configured]]),
  )
})

const refusesNested = (dir: string, owner: string) =>
  Effect.gen(function* () {
    mkdirSync(`${owner}/sub`)
    yield* commitAttributes(owner, "sub/.gitattributes", "# fine\n*.c ident\n")
    const refusals = yield* refusedCreation(dir, owner)
    expect(refusals.map((each) => [each.source, each.reason, each.path, each.line, each.detail])).toEqual([
      [Sources.Tree, Reasons.Content, Option.some("sub/.gitattributes"), Option.some(2), "*.c ident"],
    ])
    yield* leftNothing(dir, owner)
  })

const refusesSymlink = (dir: string, owner: string) =>
  Effect.gen(function* () {
    writeFileSync(`${owner}/empty`, "")
    symlinkSync("empty", `${owner}/.gitattributes`)
    yield* git(owner, "add", "empty", ".gitattributes")
    yield* git(owner, "commit", "--quiet", "-m", "link")
    expect(kinds(yield* refusedCreation(dir, owner))).toEqual([[Sources.Tree, Reasons.NotRegular]])
    yield* leftNothing(dir, owner)
  })

describe("other refused trees", () => {
  it.effect("a nested .gitattributes with content", () => withRepo(refusesNested))
  it.effect("a .gitattributes that is a symbolic link", () => withRepo(refusesSymlink))
})

/** After `plant`, creation succeeds and the startup check passes. */
const createsAndIdentifies = (plant: Plant) => () =>
  withRepo((dir, owner) =>
    Effect.gen(function* () {
      yield* plant(dir, owner)
      const created = yield* createWorktree(request(owner, dir))
      const entry = yield* identifyWorktree(created)
      expect(entry.path).toBe(created.path)
    }),
  )

const commentsWithCrlf: Plant = (_dir, owner) =>
  Effect.as(commitAttributes(owner, ".gitattributes", "# one\r\n\r\n \t\r\n#* filter=x\r\n"), "")

const emptyInfo: Plant = (_dir, owner) =>
  Effect.sync(() => {
    writeFileSync(`${owner}/.git/info/attributes`, "")
    return ""
  })

describe("passing cases create the worktree and pass the startup check", () => {
  it.effect("no attribute source", createsAndIdentifies(() => Effect.succeed("")))
  it.effect("a .gitattributes of comments and blank lines, with CRLF endings", createsAndIdentifies(commentsWithCrlf))
  it.effect("an empty info/attributes", createsAndIdentifies(emptyInfo))
})
