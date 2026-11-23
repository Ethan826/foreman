// Whether a store directory is created, used or refused (dogfood-1
// finding): created only when nothing is there and its parent exists, used
// when it is a real directory, refused otherwise with the path named. A
// mode left unset after mkdir is refused; a directory another command made
// first is used (owner finding F3, dogfood-2). The same cases run on disk
// in test/runtime/store-directory.test.ts, except a failed chmod, which no
// real directory of the test's own user can be made to give.
import { describe, expect, it } from "@effect/vitest"
import { Result, Schema } from "effect"
import {
  CreateStoreDirectory,
  StoreDirectoryAbsent,
  type StoreDirectoryCreationFailed,
  StoreDirectoryFound,
  StoreDirectoryModeUnset,
  type StoreDirectoryReading,
  StoreDirectoryRefused,
  StoreDirectoryUnreadable,
} from "../../src/domain/store-directory.ts"
import {
  judgeCreatedStoreDirectory,
  judgeExistingStoreDirectory,
  judgeStoreDirectory,
  parentOf,
} from "../../src/features/store-directory.ts"

const path = "/home/owner/foreman-state"

/** A verdict as a comparable value: the action, or the refusal's kind and fields. */
const verdict = (reading: StoreDirectoryReading) =>
  Result.match(judgeStoreDirectory(path, reading), {
    onSuccess: (action) => [Schema.is(CreateStoreDirectory)(action) ? "create" : "use"],
    onFailure: (refusal) =>
      Schema.is(StoreDirectoryRefused)(refusal)
        ? ["refused", refusal.directory, refusal.reason]
        : ["parent missing", refusal.directory, refusal.parent],
  })

describe("judgeStoreDirectory", () => {
  it("creates a missing directory whose parent exists", () => {
    expect(verdict(new StoreDirectoryAbsent({ parentPresent: true }))).toEqual(["create"])
  })

  it("uses an existing directory", () => {
    expect(verdict(new StoreDirectoryFound({ link: false, directory: true }))).toEqual(["use"])
  })

  it("refuses a missing parent, naming the directory and the parent", () => {
    expect(verdict(new StoreDirectoryAbsent({ parentPresent: false }))).toEqual(["parent missing", path, "/home/owner"])
  })

  it("creates a missing directory whose missing parent the same command creates first", () => {
    const absent = new StoreDirectoryAbsent({ parentPresent: false })
    const action = Result.map(judgeStoreDirectory(path, absent, ["/home/owner"]), Schema.is(CreateStoreDirectory))
    expect(action).toEqual(Result.succeed(true))
    expect(Result.isFailure(judgeStoreDirectory(path, absent, ["/home/other"]))).toBe(true)
  })

  it("refuses a symbolic link, a file and an unreadable path, naming the path", () => {
    const tag = "refused"
    expect(verdict(new StoreDirectoryFound({ link: true, directory: false }))).toEqual([tag, path, "is a symbolic link"])
    expect(verdict(new StoreDirectoryFound({ link: false, directory: false }))).toEqual([tag, path, "is not a directory"])
    expect(verdict(new StoreDirectoryUnreadable({ reason: "EACCES" }))).toEqual([tag, path, "unreadable: EACCES"])
  })
})

/** A directory read after a creation. */
const madeDirectory = new StoreDirectoryFound({ link: false, directory: true })

/** Nothing read after a creation. */
const stillAbsent = new StoreDirectoryAbsent({ parentPresent: true })

/** A judged creation as a comparable value: passed, or the refusal's kind and fields. */
const afterCreation = (created: Result.Result<void, StoreDirectoryCreationFailed>, reading: StoreDirectoryReading) =>
  Result.match(judgeCreatedStoreDirectory(path, created, reading), {
    onSuccess: () => ["passed"],
    onFailure: (refusal) =>
      Schema.is(StoreDirectoryRefused)(refusal)
        ? ["refused", refusal.directory, refusal.reason]
        : ["parent missing", refusal.directory, refusal.parent],
  })

describe("judgeCreatedStoreDirectory", () => {
  it("passes a directory and refuses a path still empty after creation", () => {
    expect(judgeCreatedStoreDirectory(path, Result.void, madeDirectory)).toEqual(Result.void)
    const still = judgeCreatedStoreDirectory(path, Result.void, stillAbsent)
    expect(Result.isFailure(still)).toBe(true)
  })

  it("refuses a directory whose mode could not be set after mkdir, whatever the reading", () => {
    const unset = Result.fail(new StoreDirectoryModeUnset({ reason: "EPERM" }))
    expect(afterCreation(unset, madeDirectory)).toEqual(["refused", path, "mode 0700 could not be set: EPERM"])
  })

  it("passes a directory another command made first, when mkdir failed", () => {
    const exists = Result.fail(new StoreDirectoryUnreadable({ reason: "EEXIST" }))
    expect(afterCreation(exists, madeDirectory)).toEqual(["passed"])
  })

  it("refuses a path still empty after a failed mkdir, with the failure", () => {
    const denied = Result.fail(new StoreDirectoryUnreadable({ reason: "EACCES" }))
    expect(afterCreation(denied, stillAbsent)).toEqual(["refused", path, "could not be created: EACCES"])
  })
})

/** A check before the binding is read, as a comparable value. */
const beforeUse = (reading: StoreDirectoryReading) =>
  Result.match(judgeExistingStoreDirectory(path, reading), {
    onSuccess: () => ["passed"],
    onFailure: (refusal) => ["refused", refusal.directory, refusal.reason],
  })

describe("judgeExistingStoreDirectory", () => {
  it("refuses only an entry that is there and is not a directory", () => {
    expect(beforeUse(new StoreDirectoryFound({ link: false, directory: false }))).toEqual([
      "refused",
      path,
      "is not a directory",
    ])
    expect(beforeUse(madeDirectory)).toEqual(["passed"])
    expect(beforeUse(stillAbsent)).toEqual(["passed"])
    expect(beforeUse(new StoreDirectoryAbsent({ parentPresent: false }))).toEqual(["passed"])
    expect(beforeUse(new StoreDirectoryUnreadable({ reason: "EACCES" }))).toEqual(["passed"])
  })
})

describe("parentOf", () => {
  it("is everything before the last slash, or the root", () => {
    expect(parentOf("/a/b/c")).toBe("/a/b")
    expect(parentOf("/a")).toBe("/")
  })
})
