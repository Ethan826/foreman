// Git's HOME through the production composition (batch review B02; plan
// B11b ruling 2): foreman creates `<stateDir>/git-home` itself, fresh,
// private (mode 0700) and empty, before any git command, and refuses one
// that already holds anything, is a link, or is open to group or others.
// It never clears an existing directory. The first case plants
// `HOME/.config/git/attributes` naming a marker filter that the owner's
// repository defines; git would run it on checkout, and nothing may run.
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { git } from "../runtime/git-repo.ts"
import { commitFile, markerScript } from "./git-hazard-fixtures.ts"
import { cli, endToEndMillis, failureTag, type Layout, openedSession, withLayout } from "./production-harness.ts"

/** The permission bits of a mode. */
const permissionBits = 0o777

/** Owner-only access, as foreman creates the home. */
const privateMode = 0o700

/** Group and others may read and search. */
const openMode = 0o755

const homeOf = (layout: Layout) => `${layout.state}/git-home`

/** The permission bits of the directory at `path`. */
const modeOf = (path: string) => {
  const descriptor = openSync(path, "r")
  const { mode } = fstatSync(descriptor)
  closeSync(descriptor)
  return mode & permissionBits
}

/**
 * Commits a file to the owner, defines filter `mark` whose smudge and
 * clean programs write a marker, and plants `HOME/.config/git/attributes`
 * declaring it for every path. Returns the marker's path.
 */
const plantHomeFilter = (layout: Layout) =>
  Effect.gen(function* () {
    yield* commitFile(layout.owner)
    const marker = `${layout.root}/filter.marker`
    const filter = markerScript(`${layout.root}/filter.sh`, marker, "cat\n")
    yield* git(layout.owner, "config", "filter.mark.smudge", filter)
    yield* git(layout.owner, "config", "filter.mark.clean", filter)
    mkdirSync(homeOf(layout))
    mkdirSync(`${homeOf(layout)}/.config`)
    mkdirSync(`${homeOf(layout)}/.config/git`)
    writeFileSync(`${homeOf(layout)}/.config/git/attributes`, "* filter=mark\n")
    chmodSync(homeOf(layout), privateMode)
    return marker
  })

const plantedHomeRefused = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const marker = yield* plantHomeFilter(layout)
      const runs = [
        yield* cli(layout, ["worktree", "create"]),
        yield* cli(layout, ["session", "open", "--tranche", "t-1", "--task", layout.taskFile]),
        yield* cli(layout, ["implement", "--waive"]),
        yield* cli(layout, ["review", "--waive", "--attest"]),
      ]
      expect(runs.map((run) => [run.status, failureTag(run)])).toEqual(runs.map(() => [1, "GitHomeRefused"]))
      expect(existsSync(marker)).toBe(false)
      expect(existsSync(layout.supervisor)).toBe(false)
      expect(readFileSync(`${homeOf(layout)}/.config/git/attributes`, "utf8")).toBe("* filter=mark\n")
    }),
  )

const freshHomeCreated = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      expect(existsSync(homeOf(layout))).toBe(false)
      yield* openedSession(layout)
      expect(modeOf(homeOf(layout))).toBe(privateMode)
      expect(readdirSync(homeOf(layout))).toEqual([])
    }),
  )

const emptyPrivateHomeKept = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      mkdirSync(homeOf(layout))
      chmodSync(homeOf(layout), privateMode)
      yield* openedSession(layout)
      expect(modeOf(homeOf(layout))).toBe(privateMode)
    }),
  )

/** Prepares `git-home` with `prepare`, then expects `worktree create` refused with nothing created. */
const homeRefused = (prepare: (layout: Layout) => void) => () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      prepare(layout)
      const run = yield* cli(layout, ["worktree", "create"])
      expect([run.status, failureTag(run)]).toEqual([1, "GitHomeRefused"])
      expect(existsSync(layout.supervisor)).toBe(false)
    }),
  )

const linkedHome = (layout: Layout) => {
  mkdirSync(`${layout.root}/elsewhere`)
  chmodSync(`${layout.root}/elsewhere`, privateMode)
  symlinkSync(`${layout.root}/elsewhere`, homeOf(layout))
}

const openHome = (layout: Layout) => {
  mkdirSync(homeOf(layout))
  chmodSync(homeOf(layout), openMode)
}

const nonEmptyHome = (layout: Layout) => {
  mkdirSync(homeOf(layout))
  chmodSync(homeOf(layout), privateMode)
  writeFileSync(`${homeOf(layout)}/.gitconfig`, "")
}

const fileAsHome = (layout: Layout) => {
  writeFileSync(homeOf(layout), "")
}

const nonEmptyHomeKept = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      nonEmptyHome(layout)
      yield* cli(layout, ["worktree", "create"])
      expect(readdirSync(homeOf(layout))).toEqual([".gitconfig"])
    }),
  )

const openHomeLeftAlone = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      openHome(layout)
      yield* cli(layout, ["worktree", "create"])
      expect(modeOf(homeOf(layout))).toBe(openMode)
    }),
  )

describe("git's HOME in production", () => {
  it.effect("a planted HOME attributes file with a marker filter: every command refused, nothing runs", plantedHomeRefused, endToEndMillis)
  it.effect("foreman creates a private, empty git-home before the first git command", freshHomeCreated, endToEndMillis)
  it.effect("an existing empty private git-home is used", emptyPrivateHomeKept, endToEndMillis)
  it.effect("a git-home that is a symbolic link is refused", homeRefused(linkedHome), endToEndMillis)
  it.effect("a git-home open to group or others is refused", homeRefused(openHome), endToEndMillis)
  it.effect("a git-home holding a file is refused", homeRefused(nonEmptyHome), endToEndMillis)
  it.effect("a refused git-home is not cleared", nonEmptyHomeKept, endToEndMillis)
  it.effect("a file at git-home is refused", homeRefused(fileAsHome), endToEndMillis)
  it.effect("a refused git-home's mode is not changed", openHomeLeftAlone, endToEndMillis)
})
