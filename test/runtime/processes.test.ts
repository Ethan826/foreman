// The process listing (plan "Process evidence"): `ps -A -o
// pid,pgid,lstart,command` with exactly `LC_ALL=C` in its environment,
// returned as raw text for Format to decode. A child this test starts
// waits for a release file, so it is listed while the listing is read and
// then exits on its own; the test waits for it.
import { describe, expect, it } from "@effect/vitest"
import { spawn } from "bun"
import { Array as Arr, Effect, Option, Result, Schema } from "effect"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { ProcessReadFailed } from "../../src/domain/process.ts"
import { decodePs } from "../../src/format/ps.ts"
import { readProcesses, readProcessesAt } from "../../src/runtime/processes.ts"
import { awaitExit } from "./child-process.ts"
import { boundedReleaseLoop } from "./client-start.ts"

/** Runs `use` with a fresh temporary directory, removed afterwards. */
const withTemporaryDirectory = <A, E>(use: (dir: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(`${tmpdir()}/tarlatan-ps-`)),
    use,
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

/**
 * The time budget, in milliseconds, of every test here (dogfood-6e, owner
 * ruling of 2026-11-27). Each starts real processes and claims nothing
 * about speed; a full `ps -A` took seconds while other sessions kept the
 * load average between 75 and 200.
 *
 * What it bounds, counted from the code: the longest test, "lists a
 * running child with its command", starts no git and one `ps -A`, and one
 * `sh`, which runs one `date` at its start and one `date` and one `sleep
 * 0.05` per check until released or this budget has passed; the others
 * start one `ps` or a script in its place. Idle duration: awaiting the
 * coordinator's measurement on the dogfood-6f snapshot; this file is not
 * among the measurements of 2026-11-28.
 */
const listingMillis = 15_000

/** A shell loop that runs until the file named by its first argument exists, or ends on its own after this file's time budget. */
const waitForRelease = boundedReleaseLoop(listingMillis)

/** Writes an executable script at `path`. */
const script = (path: string, body: string) => {
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

const listsRunningChild = (dir: string) =>
  Effect.gen(function* () {
    const release = `${dir}/release`
    const child = spawn(["/bin/sh", "-c", waitForRelease, "waiting-child", release])
    const listing = yield* Effect.ensuring(
      readProcesses(),
      Effect.andThen(
        Effect.sync(() => {
          writeFileSync(release, "")
        }),
        Effect.ignore(awaitExit(child)),
      ),
    )
    const rows = yield* Effect.fromResult(decodePs(listing))
    const row = Arr.findFirst(rows, (each) => each.pid === child.pid)
    expect(Option.map(row, (found) => found.command)).toEqual(Option.some(expect.stringContaining("sleep 0.05")))
    expect(child.exitCode).toBe(0)
  })

const passesArgumentsAndEnvironment = (dir: string) =>
  Effect.gen(function* () {
    const fake = script(`${dir}/ps`, 'echo "$@"\nexec /usr/bin/env -u PWD -u SHLVL')
    expect(yield* readProcessesAt(fake)()).toBe("-A -o pid,pgid,lstart,command\nLC_ALL=C\n")
  })

const failsOnNonZeroExit = (dir: string) =>
  Effect.gen(function* () {
    const fake = script(`${dir}/ps`, "echo partial\necho broken >&2\nexit 1")
    const failure = yield* Effect.flip(readProcessesAt(fake)())
    expect(Schema.is(ProcessReadFailed)(failure)).toBe(true)
    expect(failure.reason).toContain("broken")
  })

const failsWhenMissing = (dir: string) =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(readProcessesAt(`${dir}/no-ps`)())
    expect(Schema.is(ProcessReadFailed)(failure)).toBe(true)
  })

describe("readProcesses", () => {
  it.effect("lists a running child with its command, in a listing Format decodes", () =>
    withTemporaryDirectory(listsRunningChild), listingMillis,
  )
  it.effect("decodes the listing of this machine", () =>
    Effect.map(readProcesses(), (listing) => {
      expect(Result.isSuccess(decodePs(listing))).toBe(true)
    }),
    listingMillis,
  )
})

describe("readProcessesAt", () => {
  it.effect("runs the given ps with the listing's arguments and only LC_ALL=C", () =>
    withTemporaryDirectory(passesArgumentsAndEnvironment), listingMillis,
  )
  it.effect("fails, with stderr, when ps exits non-zero", () =>
    withTemporaryDirectory(failsOnNonZeroExit), listingMillis)
  it.effect("fails when ps cannot be started", () => withTemporaryDirectory(failsWhenMissing), listingMillis)
})
