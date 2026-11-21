// Shared fixtures for the attribute check end to end (plan B11c): plant
// an attribute source in a disposable owner repository, a marker filter
// that writes a file when git runs it, and the checks that creation was
// refused before `git worktree add` left anything behind.
import { expect } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { existsSync, writeFileSync } from "node:fs"
import { AttributeSourcesRefused, AttributeSourcesUnread, type AttributeRefusal } from "../../src/domain/attributes.ts"
import { git } from "../runtime/git-repo.ts"
import { commitFile, markerScript } from "./git-hazard-fixtures.ts"

/** Commits `content` as `path` (relative to the owner's top level) to `owner`. */
export const commitAttributes = (owner: string, path: string, content: string) =>
  Effect.gen(function* () {
    writeFileSync(`${owner}/${path}`, content)
    yield* git(owner, "add", path)
    yield* git(owner, "commit", "--quiet", "-m", `attributes at ${path}`)
  })

/**
 * Commits `a.txt` and configures filter `mark`, whose smudge program
 * appends to `<dir>/smudge.marker` and passes its input through. Returns
 * the marker's path. Nothing declares the filter yet.
 */
export const plantMarkerFilter = (dir: string, owner: string) =>
  Effect.gen(function* () {
    yield* commitFile(owner)
    const marker = `${dir}/smudge.marker`
    const script = markerScript(`${dir}/smudge.sh`, marker, "cat\n")
    yield* git(owner, "config", "filter.mark.smudge", script)
    yield* git(owner, "config", "filter.mark.clean", "cat")
    return marker
  })

/** The text of a declaration that gives every `.txt` file the marker filter. */
export const markerDeclaration = "*.txt filter=mark\n"

/** Whether the marker exists, so whether git ran the filter. */
export const written = (marker: string) => existsSync(marker)

/**
 * The refusals of an effect that must fail with `AttributeSourcesRefused`;
 * a success or any other failure fails the test.
 */
export const refusalsOf = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.flatMap(Effect.flip(effect), (error) =>
    isRefused(error) ? Effect.succeed(error.refusals) : Effect.fail(error),
  )

const isRefused = Schema.is(AttributeSourcesRefused)

/**
 * The failed reads of an effect that must fail with
 * `AttributeSourcesUnread`; a success or any other failure fails the test.
 */
export const readFailuresOf = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.flatMap(Effect.flip(effect), (error) =>
    isUnread(error) ? Effect.succeed(error.failures) : Effect.fail(error),
  )

const isUnread = Schema.is(AttributeSourcesUnread)

/** The source and reason of each refusal, which most cases check. */
export const kinds = (refusals: ReadonlyArray<AttributeRefusal>) =>
  refusals.map((each) => [each.source, each.reason])

/**
 * Checks that a refused creation left nothing: no path, no branch
 * `foreman/t` and no second worktree registration.
 */
export const leftNothing = (dir: string, owner: string) =>
  Effect.gen(function* () {
    expect(existsSync(`${dir}/worktree`)).toBe(false)
    const listing = yield* git(owner, "worktree", "list", "--porcelain")
    expect(listing).not.toContain(`${dir}/worktree`)
    const branches = yield* git(owner, "branch", "--list", "foreman/t")
    expect(branches).toBe("")
  })
