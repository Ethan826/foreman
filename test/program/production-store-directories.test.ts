// The state and ledger directories through the production composition
// (dogfood-1 finding): a command that writes state creates a missing
// state directory before it records the binding and a missing ledger
// directory before it opens the ledger, each one directory with mode 0700,
// when the parent exists, and judges both before it makes either (owner
// finding F7, dogfood-2). A missing parent, or a file at the path, is
// refused with the path named and nothing created; an owner exit refuses
// the file before it reads the binding (owner finding F2, dogfood-2). A
// symbolic link to a directory is followed and a dangling one stays
// `LayoutRefused` (owner ruling, dogfood-2). A ledger directory directly
// inside a missing state directory is made after it; one two levels below
// is refused (owner ruling F12, dogfood-2). `status` creates neither and
// still reports `StateMissing`.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect } from "effect"
import { chmodSync, existsSync, lstatSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { cli, configOf, endToEndMillis, failureTag, type Layout, succeeded, withLayout, writeConfig } from "./production-harness.ts"

/** The permission bits of st_mode. */
const permissionBits = 0o777

/** The mode foreman creates a store directory with. */
const privateMode = 0o700

/** The permission bits of the entry at `path`, without following a link. */
const modeOf = (path: string) => lstatSync(path).mode & permissionBits

/** A state and a ledger directory that do not exist yet, whose parent (the layout's root) does. */
const freshDirectories = (layout: Layout) => ({ state: `${layout.root}/new-state`, ledger: `${layout.root}/new-ledger` })

/** Writes a configuration naming `state` and `ledger` and returns its path. */
const configNaming = (layout: Layout, state: string, ledger: string) =>
  writeConfig(layout, configOf(layout, { stateDir: state, ledgerDir: ledger }), `${layout.root}/fresh.json`)

const createdOnFirstUse = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const { state, ledger } = freshDirectories(layout)
      const config = configNaming(layout, state, ledger)
      yield* succeeded(layout, ["worktree", "create"], { config })
      expect(modeOf(state)).toBe(privateMode)
      expect(modeOf(ledger)).toBe(privateMode)
      expect(existsSync(`${state}/target-binding.json`)).toBe(true)
      expect(existsSync(`${ledger}/ledger.sqlite`)).toBe(true)
      expect(existsSync(layout.supervisor)).toBe(true)
    }),
  )

const missingParentRefused = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const state = `${layout.root}/absent/state`
      const run = yield* cli(layout, ["worktree", "create"], { config: configNaming(layout, state, layout.ledgerDir) })
      expect([run.status, failureTag(run)]).toEqual([1, "StoreDirectoryParentMissing"])
      expect(Arr.join(run.err, "\n")).toContain(state)
      expect(existsSync(`${layout.root}/absent`)).toBe(false)
      expect(existsSync(layout.supervisor)).toBe(false)
    }),
  )

const missingLedgerParentRefused = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const ledger = `${layout.root}/absent/ledger`
      const run = yield* cli(layout, ["worktree", "create"], { config: configNaming(layout, layout.state, ledger) })
      expect([run.status, failureTag(run)]).toEqual([1, "StoreDirectoryParentMissing"])
      expect(Arr.join(run.err, "\n")).toContain(ledger)
      expect(existsSync(`${layout.root}/absent`)).toBe(false)
      expect(existsSync(layout.supervisor)).toBe(false)
      expect(existsSync(`${layout.state}/target-binding.json`)).toBe(false)
      expect(existsSync(`${layout.state}/git-home`)).toBe(false)
    }),
  )

/**
 * A command run with a fresh state directory and a ledger directory whose
 * parent is missing: it is refused before anything is written, so neither
 * the state directory, nor a binding or git's HOME in it, appears (owner
 * finding F7, dogfood-2).
 */
const ledgerJudgedFirst = (words: ReadonlyArray<string>) => () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const state = `${layout.root}/new-state`
      const ledger = `${layout.root}/absent/ledger`
      const run = yield* cli(layout, words, { config: configNaming(layout, state, ledger) })
      expect([run.status, failureTag(run)]).toEqual([1, "StoreDirectoryParentMissing"])
      expect(Arr.join(run.err, "\n")).toContain(ledger)
      expect(existsSync(state)).toBe(false)
      expect(existsSync(`${state}/target-binding.json`)).toBe(false)
      expect(existsSync(`${state}/git-home`)).toBe(false)
      expect(existsSync(`${layout.root}/absent`)).toBe(false)
    }),
  )

/**
 * A ledger directory directly inside a missing state directory: the state
 * directory is the ledger's parent and is one foreman is configured to
 * own, so both are created, each mode 0700 (owner ruling F12, dogfood-2).
 */
const nestedBothCreated = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const state = `${layout.root}/new-state`
      const ledger = `${state}/ledger`
      yield* succeeded(layout, ["worktree", "create"], { config: configNaming(layout, state, ledger) })
      expect(modeOf(state)).toBe(privateMode)
      expect(modeOf(ledger)).toBe(privateMode)
      expect(existsSync(`${ledger}/ledger.sqlite`)).toBe(true)
    }),
  )

/**
 * A ledger directory two levels below a missing state directory: its
 * parent is no configured store directory, so it is refused and nothing,
 * not even the state directory, is created (owner ruling F12, dogfood-2).
 */
const nestedTwoLevelsRefused = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const state = `${layout.root}/new-state`
      const ledger = `${state}/sub/ledger`
      const run = yield* cli(layout, ["worktree", "create"], { config: configNaming(layout, state, ledger) })
      expect([run.status, failureTag(run)]).toEqual([1, "StoreDirectoryParentMissing"])
      expect(Arr.join(run.err, "\n")).toContain(ledger)
      expect(existsSync(state)).toBe(false)
      expect(existsSync(layout.supervisor)).toBe(false)
    }),
  )

/** Puts something other than a directory at a fresh state path, then expects `worktree create` refused. */
const stateRefused = (plant: (layout: Layout, state: string) => void) => () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const state = `${layout.root}/new-state`
      plant(layout, state)
      const run = yield* cli(layout, ["worktree", "create"], { config: configNaming(layout, state, layout.ledgerDir) })
      expect([run.status, failureTag(run)]).toEqual([1, "StoreDirectoryRefused"])
      expect(Arr.join(run.err, "\n")).toContain(state)
      expect(existsSync(layout.supervisor)).toBe(false)
    }),
  )

const fileAtState = (_layout: Layout, state: string) => {
  writeFileSync(state, "")
}

/** A mode the directory a link names keeps: group and others may read and search. */
const openMode = 0o755

const linkFollowed = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const state = `${layout.root}/new-state`
      mkdirSync(`${layout.root}/elsewhere`)
      chmodSync(`${layout.root}/elsewhere`, openMode)
      symlinkSync(`${layout.root}/elsewhere`, state)
      yield* succeeded(layout, ["worktree", "create"], { config: configNaming(layout, state, layout.ledgerDir) })
      expect(lstatSync(state).isSymbolicLink()).toBe(true)
      expect(existsSync(`${layout.root}/elsewhere/target-binding.json`)).toBe(true)
      expect(modeOf(`${layout.root}/elsewhere`)).toBe(openMode)
    }),
  )

const danglingLinkRefused = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const state = `${layout.root}/new-state`
      symlinkSync(`${layout.root}/not-yet`, state)
      const run = yield* cli(layout, ["worktree", "create"], { config: configNaming(layout, state, layout.ledgerDir) })
      expect([run.status, failureTag(run)]).toEqual([1, "LayoutRefused"])
      expect(existsSync(`${layout.root}/not-yet`)).toBe(false)
      expect(existsSync(layout.supervisor)).toBe(false)
    }),
  )

const fileRefusedByExit = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const state = `${layout.root}/new-state`
      writeFileSync(state, "")
      const config = configNaming(layout, state, layout.ledgerDir)
      const run = yield* cli(layout, ["session", "close", "--abandoned"], { config })
      expect([run.status, failureTag(run)]).toEqual([1, "StoreDirectoryRefused"])
      expect(Arr.join(run.err, "\n")).toContain(state)
      expect(lstatSync(state).isFile()).toBe(true)
    }),
  )

const statusCreatesNeither = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      const { state, ledger } = freshDirectories(layout)
      const run = yield* cli(layout, ["status"], { config: configNaming(layout, state, ledger) })
      expect(run.status).toBe(0)
      expect(Arr.join(run.out, "\n")).toContain("StateMissing")
      expect(existsSync(state)).toBe(false)
      expect(existsSync(ledger)).toBe(false)
    }),
  )

describe("the state and ledger directories in production", () => {
  it.effect("worktree create makes a missing state and ledger directory, mode 0700", createdOnFirstUse, endToEndMillis)
  it.effect("a state directory whose parent is missing is refused, nothing created", missingParentRefused, endToEndMillis)
  it.effect("a ledger directory whose parent is missing is refused, nothing created", missingLedgerParentRefused, endToEndMillis)
  it.effect(
    "worktree create judges the ledger directory before it makes the state directory",
    ledgerJudgedFirst(["worktree", "create"]),
    endToEndMillis,
  )
  it.effect(
    "an owner close judges the ledger directory before it makes the state directory",
    ledgerJudgedFirst(["session", "close", "--abandoned"]),
    endToEndMillis,
  )
  it.effect("a ledger directory directly inside a missing state directory: both made, mode 0700", nestedBothCreated, endToEndMillis)
  it.effect("a ledger directory two levels below a missing state directory is refused", nestedTwoLevelsRefused, endToEndMillis)
  it.effect("a file at the state directory's path is refused", stateRefused(fileAtState), endToEndMillis)
  it.effect("a symbolic link to a directory is followed and that directory used as it is", linkFollowed, endToEndMillis)
  it.effect("a dangling symbolic link at the state directory's path stays LayoutRefused", danglingLinkRefused, endToEndMillis)
  it.effect("an owner exit refuses a file at the state directory's path before the binding", fileRefusedByExit, endToEndMillis)
  it.effect("status creates neither directory and reports the state missing", statusCreatesNeither, endToEndMillis)
})
