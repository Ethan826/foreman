// The root `.gitattributes` allowance end to end (owner decision M09,
// option a), in disposable repositories. The fixture is Waxwing's root
// `.gitattributes` byte for byte, checked against its blob id rather than
// read from Waxwing. With Waxwing's line allowed, creation and the startup
// check pass; the production entry points, which pass the empty
// allowance, refuse it. A marker filter declared on a near-miss line is
// refused before `git worktree add`, so the marker is never written. The
// clean environment already ignores the revision's `.gitattributes` (plan
// B11c), so the control runs `worktree add` through the inherited runner,
// as git runs by default, to show the declaration is live.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { mkdirSync } from "node:fs"
import type { AttributeAllowance } from "../../src/domain/attributes.ts"
import { AttributeRefusalReasons as Reasons, AttributeSources as Sources } from "../../src/domain/attributes.ts"
import { worktreeProgramWith } from "../../src/program/worktree.ts"
import { startGit } from "../../src/runtime/git.ts"
import { emptyHome, git, withRepo } from "../runtime/git-repo.ts"
import { commitAttributes, leftNothing, plantMarkerFilter, refusalsOf, written } from "./attribute-fixtures.ts"
import { createInherited, createWorktree, identifyWorktree, request } from "./git-hazard-fixtures.ts"

/** Waxwing's one content line. */
const waxwingLine = "*.wxw linguist-language=Rust"

/** Waxwing's root `.gitattributes`, byte for byte (blob {@link waxwingBlob}). */
const waxwingFile =
  "# Approximate highlighting on GitHub until Waxwing has its own grammar\n" +
  "# (IDE001); Rust colours keywords, literals and numbers reasonably.\n" +
  `${waxwingLine}\n`

/** The blob id of Waxwing's root `.gitattributes` as committed in Waxwing. */
const waxwingBlob = "097bbbbdd32547b25108626ed0046c35793ef7f9"

const allowWaxwing: AttributeAllowance = { rootLines: [waxwingLine] }

/** The entry points over the real process call with Waxwing's line allowed. */
const allowing = worktreeProgramWith(startGit, allowWaxwing)(emptyHome)

/** Commits Waxwing's root file and checks that its blob is Waxwing's. */
const commitWaxwingFile = (owner: string) =>
  Effect.gen(function* () {
    yield* commitAttributes(owner, ".gitattributes", waxwingFile)
    expect(yield* git(owner, "rev-parse", "HEAD:.gitattributes")).toBe(waxwingBlob)
  })

/** Each refusal's source, reason, path, line and detail. */
const described = (refusals: ReadonlyArray<{
  readonly source: string
  readonly reason: string
  readonly path: Option.Option<string>
  readonly line: Option.Option<number>
  readonly detail: string
}>) => refusals.map((each) => [each.source, each.reason, each.path, each.line, each.detail])

const contentAt = (path: string, line: number, detail: string) =>
  [Sources.Tree, Reasons.Content, Option.some(path), Option.some(line), detail]

const passesWhenAllowed = (dir: string, owner: string) =>
  Effect.gen(function* () {
    yield* commitWaxwingFile(owner)
    const created = yield* allowing.createWorktree(request(owner, dir))
    const entry = yield* allowing.identifyWorktree(created)
    expect(entry.path).toBe(created.path)
  })

const refusedWithoutAllowance = (dir: string, owner: string) =>
  Effect.gen(function* () {
    yield* commitWaxwingFile(owner)
    const refusals = yield* refusalsOf(createWorktree(request(owner, dir)))
    expect(described(refusals)).toEqual([contentAt(".gitattributes", 3, waxwingLine)])
    yield* leftNothing(dir, owner)
  })

const startupRefusedWithoutAllowance = (dir: string, owner: string) =>
  Effect.gen(function* () {
    yield* commitWaxwingFile(owner)
    const created = yield* allowing.createWorktree(request(owner, dir))
    const refusals = yield* refusalsOf(identifyWorktree(created))
    expect(described(refusals)).toEqual([contentAt(".gitattributes", 3, waxwingLine)])
  })

const nestedRefused = (dir: string, owner: string) =>
  Effect.gen(function* () {
    yield* commitWaxwingFile(owner)
    mkdirSync(`${owner}/sub`)
    yield* commitAttributes(owner, "sub/.gitattributes", waxwingFile)
    const refusals = yield* refusalsOf(allowing.createWorktree(request(owner, dir)))
    expect(described(refusals)).toEqual([contentAt("sub/.gitattributes", 3, waxwingLine)])
    yield* leftNothing(dir, owner)
  })

describe("Waxwing's root .gitattributes", () => {
  it.effect("passes creation and the startup check when its line is allowed", () => withRepo(passesWhenAllowed))
  it.effect("is refused at creation by the production entry points", () => withRepo(refusedWithoutAllowance))
  it.effect("is refused by the startup check without the allowance", () => withRepo(startupRefusedWithoutAllowance))
  it.effect("an allowed line in a nested .gitattributes is refused", () => withRepo(nestedRefused))
})

/** A near miss of Waxwing's line that declares the marker filter. */
const nearMiss = `${waxwingLine} filter=mark`

/** Plants the marker filter, a `.wxw` file and Waxwing's file with `nearMiss` as its line 3; returns the marker. */
const plantNearMiss = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const marker = yield* plantMarkerFilter(dir, owner)
    yield* commitAttributes(owner, "a.wxw", "text\n")
    yield* commitAttributes(owner, ".gitattributes", waxwingFile.replace(`${waxwingLine}\n`, `${nearMiss}\n`))
    return marker
  })

const controlWritesMarker = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const marker = yield* plantNearMiss(dir, owner)
    yield* createInherited(dir, owner)
    expect(written(marker)).toBe(true)
  })

const nearMissRefused = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const marker = yield* plantNearMiss(dir, owner)
    const refusals = yield* refusalsOf(allowing.createWorktree(request(owner, dir)))
    expect(described(refusals)).toEqual([contentAt(".gitattributes", 3, nearMiss)])
    expect(written(marker)).toBe(false)
    yield* leftNothing(dir, owner)
  })

describe("a marker filter on a near miss of the allowed line", () => {
  it.effect("control: worktree add under git's default environment runs the filter", () => withRepo(controlWritesMarker))
  it.effect("is refused before worktree add, and the marker is not written", () => withRepo(nearMissRefused))
})
