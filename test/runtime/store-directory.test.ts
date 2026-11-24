// A store directory on disk (dogfood-1 finding): Runtime reads what is at
// the path without following a link and creates one directory with mode
// 0700 whatever the umask; Program (preparedStoreDirectory) resolves the
// path, creates a missing directory whose parent exists, uses an existing
// directory as it is, follows a symbolic link to a directory (owner
// ruling, dogfood-2), and refuses a missing parent or a file. A refusal
// names the path and creates nothing. A dangling link cannot be resolved
// and stays `LayoutRefused`. Run on real temporary directories.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Match } from "effect"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import type { LayoutRefused } from "../../src/domain/layout.ts"
import {
  StoreDirectoryAbsent,
  StoreDirectoryFound,
  type StoreDirectoryParentMissing,
  type StoreDirectoryRefused,
} from "../../src/domain/store-directory.ts"
import { checkedStoreDirectory, preparedStoreDirectory } from "../../src/program/store-directory.ts"
import { createStoreDirectory, readStoreDirectory } from "../../src/runtime/store-directory.ts"

/** The permission bits of st_mode. */
const permissionBits = 0o777

/** The mode tarlatan creates a store directory with. */
const privateMode = 0o700

/** A mode an existing directory keeps: group and others may read and search. */
const openMode = 0o755

/** A umask that removes every bit, the owner's included. */
const restrictiveUmask = 0o777

/** A umask that removes nothing. */
const permissiveUmask = 0o000

/** A refusal as its kind and fields, so a test compares every part of it. */
const described = (
  failure: StoreDirectoryParentMissing | StoreDirectoryRefused | LayoutRefused,
): ReadonlyArray<string> =>
  Match.valueTags(failure, {
    StoreDirectoryRefused: (refused) => ["StoreDirectoryRefused", refused.directory, refused.reason],
    StoreDirectoryParentMissing: (missing) => ["StoreDirectoryParentMissing", missing.directory, missing.parent],
    LayoutRefused: (layout) => ["LayoutRefused", ...layout.reasons],
  })

/** The permission bits of the entry at `path`, without following a link. */
const modeOf = (path: string) => lstatSync(path).mode & permissionBits

/** Runs `use` in a fresh canonical temporary directory and removes it afterwards. */
const inTemporary = <A, E>(use: (dir: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => realpathSync(mkdtempSync(`${tmpdir()}/tarlatan-store-dir-`))),
    use,
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

/** Runs `effect` with the process umask set to `mask`, restoring the previous umask afterwards. */
const underUmask = <A, E>(mask: number, effect: Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => process.umask(mask)),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        process.umask(previous)
      }),
  )

/** Creates `<dir>/state` under the umask `mask` and expects mode 0700. */
const createdPrivate = (mask: number) => (dir: string) =>
  Effect.gen(function* () {
    const path = `${dir}/state`
    yield* underUmask(mask, createStoreDirectory(path))
    expect(modeOf(path)).toBe(privateMode)
    expect(readdirSync(path)).toEqual([])
    expect(yield* underUmask(mask, preparedStoreDirectory(`${dir}/ledger`))).toBe(`${dir}/ledger`)
    expect(modeOf(`${dir}/ledger`)).toBe(privateMode)
  })

const readsAbsent = (dir: string) =>
  Effect.gen(function* () {
    expect(yield* readStoreDirectory(`${dir}/state`)).toEqual(new StoreDirectoryAbsent({ parentPresent: true }))
    expect(yield* readStoreDirectory(`${dir}/missing/state`)).toEqual(new StoreDirectoryAbsent({ parentPresent: false }))
  })

const readsEntries = (dir: string) =>
  Effect.gen(function* () {
    mkdirSync(`${dir}/real`)
    writeFileSync(`${dir}/file`, "")
    symlinkSync(`${dir}/real`, `${dir}/link`)
    expect(yield* readStoreDirectory(`${dir}/real`)).toEqual(new StoreDirectoryFound({ link: false, directory: true }))
    expect(yield* readStoreDirectory(`${dir}/file`)).toEqual(new StoreDirectoryFound({ link: false, directory: false }))
    expect(yield* readStoreDirectory(`${dir}/link`)).toEqual(new StoreDirectoryFound({ link: true, directory: false }))
  })

const existingKept = (dir: string) =>
  Effect.gen(function* () {
    mkdirSync(`${dir}/state`)
    chmodSync(`${dir}/state`, openMode)
    writeFileSync(`${dir}/state/log.sqlite`, "kept")
    expect(yield* preparedStoreDirectory(`${dir}/state`)).toBe(`${dir}/state`)
    expect(modeOf(`${dir}/state`)).toBe(openMode)
    expect(readdirSync(`${dir}/state`)).toEqual(["log.sqlite"])
  })

const missingParentRefused = (dir: string) =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(preparedStoreDirectory(`${dir}/missing/state`))
    expect(described(failure)).toEqual(["StoreDirectoryParentMissing", `${dir}/missing/state`, `${dir}/missing`])
    expect(readdirSync(dir)).toEqual([])
  })

const fileRefused = (dir: string) =>
  Effect.gen(function* () {
    writeFileSync(`${dir}/state`, "a file")
    const failure = yield* Effect.flip(preparedStoreDirectory(`${dir}/state`))
    expect(described(failure)).toEqual(["StoreDirectoryRefused", `${dir}/state`, "is not a directory"])
    expect(lstatSync(`${dir}/state`).isFile()).toBe(true)
  })

const linkToDirectoryFollowed = (dir: string) =>
  Effect.gen(function* () {
    mkdirSync(`${dir}/real`)
    chmodSync(`${dir}/real`, openMode)
    symlinkSync(`${dir}/real`, `${dir}/state`)
    expect(yield* preparedStoreDirectory(`${dir}/state`)).toBe(`${dir}/state`)
    expect(lstatSync(`${dir}/state`).isSymbolicLink()).toBe(true)
    expect(modeOf(`${dir}/real`)).toBe(openMode)
    expect(readdirSync(`${dir}/real`)).toEqual([])
  })

const linkToFileRefused = (dir: string) =>
  Effect.gen(function* () {
    writeFileSync(`${dir}/file`, "a file")
    symlinkSync(`${dir}/file`, `${dir}/state`)
    const failure = yield* Effect.flip(preparedStoreDirectory(`${dir}/state`))
    expect(described(failure)).toEqual(["StoreDirectoryRefused", `${dir}/file`, "is not a directory"])
    expect(lstatSync(`${dir}/state`).isSymbolicLink()).toBe(true)
  })

const danglingLinkUnresolved = (dir: string) =>
  Effect.gen(function* () {
    symlinkSync(`${dir}/not-yet`, `${dir}/state`)
    const [tag, reason] = described(yield* Effect.flip(preparedStoreDirectory(`${dir}/state`)))
    expect(tag).toBe("LayoutRefused")
    expect(reason).toContain(`cannot resolve ${dir}/state`)
    expect(existsSync(`${dir}/not-yet`)).toBe(false)
    expect(lstatSync(`${dir}/state`).isSymbolicLink()).toBe(true)
  })

const checkedCreatesNothing = (dir: string) =>
  Effect.gen(function* () {
    mkdirSync(`${dir}/real`)
    symlinkSync(`${dir}/not-yet`, `${dir}/dangling`)
    yield* checkedStoreDirectory(`${dir}/state`)
    yield* checkedStoreDirectory(`${dir}/missing/state`)
    yield* checkedStoreDirectory(`${dir}/real`)
    yield* checkedStoreDirectory(`${dir}/dangling`)
    expect([existsSync(`${dir}/state`), existsSync(`${dir}/missing`), existsSync(`${dir}/not-yet`)]).toEqual([
      false,
      false,
      false,
    ])
  })

const checkedRefusesFile = (dir: string) =>
  Effect.gen(function* () {
    writeFileSync(`${dir}/state`, "a file")
    const failure = yield* Effect.flip(checkedStoreDirectory(`${dir}/state`))
    expect(described(failure)).toEqual(["StoreDirectoryRefused", `${dir}/state`, "is not a directory"])
    expect(lstatSync(`${dir}/state`).isFile()).toBe(true)
  })

describe("readStoreDirectory", () => {
  it.effect("reads nothing at the path, and whether the parent is there", () => inTemporary(readsAbsent))
  it.effect("reads a directory, a file and a symbolic link without following it", () => inTemporary(readsEntries))
})

describe("creating a store directory", () => {
  it.effect("makes mode 0700 under a restrictive umask", () => inTemporary(createdPrivate(restrictiveUmask)))
  it.effect("makes mode 0700 under a permissive umask", () => inTemporary(createdPrivate(permissiveUmask)))
  it.effect("uses an existing directory as it is, its mode unchanged", () => inTemporary(existingKept))
  it.effect("refuses a missing parent, naming the directory and its parent, and creates nothing", () =>
    inTemporary(missingParentRefused),
  )
  it.effect("refuses a file at the path, naming it, and leaves the file", () => inTemporary(fileRefused))
  it.effect("follows a symbolic link to a directory and uses that directory as it is", () =>
    inTemporary(linkToDirectoryFollowed),
  )
  it.effect("refuses a symbolic link to a file, naming the resolved path", () => inTemporary(linkToFileRefused))
  it.effect("leaves a dangling symbolic link to LayoutRefused and creates nothing through it", () =>
    inTemporary(danglingLinkUnresolved),
  )
})

describe("checking a store directory before the binding is read", () => {
  it.effect("creates nothing and passes a missing, a present and an unresolvable path", () =>
    inTemporary(checkedCreatesNothing),
  )
  it.effect("refuses a file at the path, naming it", () => inTemporary(checkedRefusesFile))
})
