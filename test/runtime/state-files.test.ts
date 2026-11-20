// State files (plan "Injected capabilities"): publish writes
// `<path>.tmp`, flushes it, renames it over `path` and returns the
// SHA-256 of the bytes, so the final name only ever holds a complete
// file. Read returns the bytes.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { StateFileFailed, stateFiles } from "../../src/runtime/state-files.ts"

/** Runs `use` with a fresh temporary directory, removed afterwards. */
const withTemporaryDirectory = <A, E>(use: (dir: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(`${tmpdir()}/foreman-state-`)),
    use,
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

/** "abc" and its SHA-256 (FIPS 180-2, appendix B.1). */
const abc = Uint8Array.from([0x61, 0x62, 0x63])
const abcSha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

/** The SHA-256 of no bytes. */
const emptySha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

/** Every byte value once, then 1 MiB of 0x5a: binary and larger than one pipe buffer. */
const large = new Uint8Array(256 + (1 << 20)).fill(0x5a)
large.set(Array.from({ length: 256 }, (_, index) => index))

const publishesUnderFinalName = (dir: string) =>
  Effect.gen(function* () {
    const hash = yield* stateFiles.publish(`${dir}/handoff.md`, abc)
    expect(hash).toBe(abcSha256)
    expect(readFileSync(`${dir}/handoff.md`, "utf8")).toBe("abc")
    expect(existsSync(`${dir}/handoff.md.tmp`)).toBe(false)
  })

const publishesEmpty = (dir: string) =>
  Effect.gen(function* () {
    expect(yield* stateFiles.publish(`${dir}/empty`, new Uint8Array(0))).toBe(emptySha256)
    expect(readFileSync(`${dir}/empty`, "utf8")).toBe("")
  })

const roundTripsLarge = (dir: string) =>
  Effect.gen(function* () {
    yield* stateFiles.publish(`${dir}/raw.jsonl`, large)
    const read = yield* stateFiles.read(`${dir}/raw.jsonl`)
    expect(Uint8Array.from(read)).toEqual(large)
  })

const replacesEarlierAndStale = (dir: string) =>
  Effect.gen(function* () {
    writeFileSync(`${dir}/state`, "old contents, longer than the new")
    writeFileSync(`${dir}/state.tmp`, "left by a crash, longer than the new")
    yield* stateFiles.publish(`${dir}/state`, abc)
    expect(readFileSync(`${dir}/state`, "utf8")).toBe("abc")
    expect(existsSync(`${dir}/state.tmp`)).toBe(false)
  })

const keepsFinalWhenTemporaryFails = (dir: string) =>
  Effect.gen(function* () {
    writeFileSync(`${dir}/state`, "previous")
    mkdirSync(`${dir}/state.tmp`)
    const failure = yield* Effect.flip(stateFiles.publish(`${dir}/state`, abc))
    expect(Schema.is(StateFileFailed)(failure)).toBe(true)
    expect(failure.path).toBe(`${dir}/state`)
    expect(readFileSync(`${dir}/state`, "utf8")).toBe("previous")
  })

const failsWhenRenameCannotReplace = (dir: string) =>
  Effect.gen(function* () {
    mkdirSync(`${dir}/state`)
    writeFileSync(`${dir}/state/inside`, "x")
    const failure = yield* Effect.flip(stateFiles.publish(`${dir}/state`, abc))
    expect(Schema.is(StateFileFailed)(failure)).toBe(true)
    expect(readFileSync(`${dir}/state/inside`, "utf8")).toBe("x")
  })

const failsWithoutDirectory = (dir: string) =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(stateFiles.publish(`${dir}/missing/state`, abc))
    expect(Schema.is(StateFileFailed)(failure)).toBe(true)
  })

const readFailsOnMissing = (dir: string) =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(stateFiles.read(`${dir}/missing`))
    expect(Schema.is(StateFileFailed)(failure)).toBe(true)
    expect(failure.path).toBe(`${dir}/missing`)
  })

describe("stateFiles.publish", () => {
  it.effect("writes the bytes under the final name and returns their SHA-256", () =>
    withTemporaryDirectory(publishesUnderFinalName),
  )
  it.effect("publishes an empty file", () => withTemporaryDirectory(publishesEmpty))
  it.effect("writes every byte of a large binary file, and read returns them", () =>
    withTemporaryDirectory(roundTripsLarge),
  )
  it.effect("replaces an earlier file and a stale temporary file", () =>
    withTemporaryDirectory(replacesEarlierAndStale),
  )
  it.effect("leaves the final name untouched when the temporary file cannot be written", () =>
    withTemporaryDirectory(keepsFinalWhenTemporaryFails),
  )
  it.effect("fails, and publishes nothing, when the rename cannot replace the final name", () =>
    withTemporaryDirectory(failsWhenRenameCannotReplace),
  )
  it.effect("fails when the directory does not exist", () => withTemporaryDirectory(failsWithoutDirectory))
})

describe("stateFiles.read", () => {
  it.effect("fails on a missing file", () => withTemporaryDirectory(readFailsOnMissing))
})
