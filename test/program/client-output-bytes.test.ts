// A client's stdout bytes as classification reads them (review finding
// R04). Bytes that are not UTF-8 make their line malformed, so the
// attempt is `Unclassified` and close-only; a lossy decoder would have
// turned them into U+FFFD and let a success through. A genuine U+FFFD is
// text like any other. Lines are put together from the bytes before
// they are decoded, so a character split across two chunks decodes
// whole, and an invalid byte at a chunk boundary is caught. The raw file
// keeps the exact bytes.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Option, Result, Stream } from "effect"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { Success, Unclassified } from "../../src/domain/outcomes.ts"
import { Roles } from "../../src/domain/roles.ts"
import { classifyAttempt } from "../../src/features/step-outcome.ts"
import { startTimeOf } from "../../src/format/ps.ts"
import { claudeDecoded, claudeHandoff } from "../../src/program/client-output.ts"
import { readProcesses } from "../../src/runtime/processes.ts"
import { startClientWith } from "../../src/runtime/spawn.ts"
import { stdoutLines } from "../../src/runtime/stdout-lines.ts"
import { strictUtf8 } from "../../src/runtime/strict-utf8.ts"
import { claudeSuccess } from "../fixtures/clients/claude-success.ts"
import { exitedWith } from "../fixtures/clients/fake-client.ts"

/** The bytes of `text`, which is ASCII only. */
const bytesOf = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0))

/** Joins byte arrays in order. */
const joined = (...parts: ReadonlyArray<Uint8Array>) => {
  const all = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  parts.reduce((offset, part) => {
    all.set(part, offset)
    return offset + part.byteLength
  }, 0)
  return all
}

/** Every line of the successful run before its result, each ended. */
const leadingLines = bytesOf(claudeSuccess.lines.slice(0, -1).map((line) => `${line}\n`).join(""))

/** The opening of the success result, up to the inside of its `result` string. */
const resultOpening = bytesOf('{"type": "result", "subtype": "success", "is_error": false, "num_turns": 3, "result": "Caf')

/** The close of the success result's `result` string and the line's end. */
const resultClose = bytesOf('."}\n')

/** A successful run whose result text holds `inner` after "Caf". */
const runWith = (inner: Uint8Array) => joined(leadingLines, resultOpening, inner, resultClose)

/** An implementer's outcome from these lines, with exit code 0. */
const outcomeOf = (lines: Parameters<typeof claudeDecoded>[0]) =>
  classifyAttempt(Roles.Implementer, exitedWith(0), { client: claudeDecoded(lines), findings: Option.none() })

/** The lines of stdout that arrived in `chunks`. */
const linesOf = (chunks: ReadonlyArray<Uint8Array>) =>
  Effect.map(Stream.runCollect(stdoutLines(Stream.fromIterable(chunks))), Arr.fromIterable)

/** The handoff text of these lines; none when it is not UTF-8. */
const handoffOf = (lines: Parameters<typeof claudeHandoff>[0]) => Effect.map(claudeHandoff(lines), strictUtf8)

const startClient = startClientWith(readProcesses, startTimeOf)

/**
 * Prints `bytes` through a real shell (`cat` of a file) with the real
 * client starter, and returns the lines it streamed and the raw file.
 */
const printedByShell = (bytes: Uint8Array) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(`${tmpdir()}/tarlatan-bytes-`)),
    (dir) =>
      Effect.gen(function* () {
        writeFileSync(`${dir}/out`, bytes)
        const running = yield* startClient({
          argv: ["/bin/sh", "-c", 'cat "$1"', "client", `${dir}/out`],
          cwd: dir,
          env: { PATH: "/usr/bin:/bin" },
          rawPath: `${dir}/raw`,
        })
        const lines = Arr.fromIterable(yield* Stream.runCollect(running.lines))
        yield* running.exit
        return { lines, raw: new Uint8Array(readFileSync(`${dir}/raw`)) }
      }),
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

const invalidByte = new Uint8Array([0xff])
/** U+FFFD in UTF-8. */
const replacementCharacter = new Uint8Array([0xef, 0xbf, 0xbd])
/** "é" in UTF-8. */
const eAcute = new Uint8Array([0xc3, 0xa9])

describe("Claude's stdout through a real shell and the stream path", () => {
  it.effect("is Unclassified when its success result holds the byte FF", () =>
    Effect.gen(function* () {
      const { lines } = yield* printedByShell(runWith(invalidByte))
      expect(outcomeOf(lines)).toEqual(new Unclassified())
    }),
  )
  it.effect("keeps the exact bytes, FF included, in the raw file", () =>
    Effect.gen(function* () {
      const printed = runWith(invalidByte)
      const { raw } = yield* printedByShell(printed)
      expect(Array.from(raw)).toEqual(Array.from(printed))
    }),
  )
  it.effect("stays Success with a genuine U+FFFD in its result text", () =>
    Effect.gen(function* () {
      const { lines } = yield* printedByShell(runWith(replacementCharacter))
      expect(outcomeOf(lines)).toEqual(new Success())
      expect(yield* handoffOf(lines)).toEqual(Option.some("Caf\uFFFD."))
    }),
  )
})

describe("stdout chunks", () => {
  it.effect("decode a character split across two chunks", () =>
    Effect.gen(function* () {
      const run = runWith(eAcute)
      const split = run.byteLength - resultClose.byteLength - 1
      const lines = yield* linesOf([run.subarray(0, split), run.subarray(split)])
      expect(outcomeOf(lines)).toEqual(new Success())
      expect(yield* handoffOf(lines)).toEqual(Option.some("Café."))
    }),
  )
  it.effect("catch a lead byte at a chunk's end that the next chunk does not continue", () =>
    Effect.gen(function* () {
      const run = runWith(eAcute.subarray(0, 1))
      const split = run.byteLength - resultClose.byteLength
      const lines = yield* linesOf([run.subarray(0, split), run.subarray(split)])
      expect(outcomeOf(lines)).toEqual(new Unclassified())
    }),
  )
  it.effect("catch a lead byte left at the end of the stream", () =>
    Effect.gen(function* () {
      const lines = yield* linesOf([joined(runWith(eAcute), eAcute.subarray(0, 1))])
      expect(Arr.map(lines, Result.isFailure)).toEqual([false, false, false, false, true])
      expect(outcomeOf(lines)).toEqual(new Unclassified())
    }),
  )
  it.effect("end a line at a carriage return and line feed split across chunks", () =>
    Effect.gen(function* () {
      const lines = yield* linesOf([bytesOf("{}\r"), bytesOf("\n{}\n")])
      expect(lines).toHaveLength(2)
    }),
  )
})
