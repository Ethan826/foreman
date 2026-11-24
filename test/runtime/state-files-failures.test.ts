// The directory flush after a publish's rename (review item M03): the
// directory's descriptor is closed on every path, and a failed fsync is
// the failure reported, even when the close fails too. And the read for
// a file that may be absent (review item M02): only a missing file is
// none; any other failure stays a failure.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { closeSync, fsyncSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import {
  type DirectoryCalls,
  flushDirectoryWith,
  StateFileFailed,
  stateFiles,
} from "../../src/runtime/state-files.ts"

const descriptor = 9

/** A descriptor no file has, so a call on it fails as EBADF does. */
const invalidDescriptor = 2_147_483_647

/**
 * Directory calls whose fsync fails, as an fsync of a bad descriptor
 * does, and whose close fails too when `closeFails`; every call is
 * recorded.
 */
const recording = (closeFails: boolean) => {
  const calls: Array<string> = []
  const directory: DirectoryCalls = {
    open: (path) => {
      calls.push(`open ${path}`)
      return descriptor
    },
    fsync: () => {
      calls.push("fsync")
      fsyncSync(invalidDescriptor)
    },
    close: (closed) => {
      calls.push(`close ${String(closed)}`)
      if (closeFails) closeSync(invalidDescriptor)
    },
  }
  return { calls, directory }
}

const closesAfterFailedFsync = (closeFails: boolean) =>
  Effect.gen(function* () {
    const { calls, directory } = recording(closeFails)
    const failure = yield* Effect.flip(flushDirectoryWith(directory)("/state/raw.jsonl", "/state"))
    expect(calls).toEqual(["open /state", "fsync", `close ${String(descriptor)}`])
    expect(Schema.is(StateFileFailed)(failure)).toBe(true)
    expect(failure.path).toBe("/state/raw.jsonl")
    expect(failure.reason).toMatch(/fsync/)
  })

describe("flushDirectoryWith", () => {
  it.effect("closes the directory when fsync fails and reports the fsync failure", () =>
    closesAfterFailedFsync(false),
  )
  it.effect("keeps the fsync failure when the close fails too", () => closesAfterFailedFsync(true))
})

const withDirectory = <A, E>(use: (dir: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(`${tmpdir()}/tarlatan-present-`)),
    use,
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

const readsPresentAndMissing = (dir: string) =>
  Effect.gen(function* () {
    writeFileSync(`${dir}/present`, "abc")
    const present = yield* stateFiles.readIfPresent(`${dir}/present`)
    expect(Option.map(present, (bytes) => Array.from(bytes))).toEqual(Option.some([0x61, 0x62, 0x63]))
    expect(yield* stateFiles.readIfPresent(`${dir}/missing`)).toEqual(Option.none())
  })

const failsOnUnreadable = (dir: string) =>
  Effect.gen(function* () {
    mkdirSync(`${dir}/directory`)
    const failure = yield* Effect.flip(stateFiles.readIfPresent(`${dir}/directory`))
    expect(Schema.is(StateFileFailed)(failure)).toBe(true)
    expect(failure.path).toBe(`${dir}/directory`)
  })

describe("stateFiles.readIfPresent", () => {
  it.effect("reads a present file and gives none for a missing one", () => withDirectory(readsPresentAndMissing))
  it.effect("fails, rather than giving none, on a path it cannot read", () => withDirectory(failsOnUnreadable))
})
