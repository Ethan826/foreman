// The client version read (plan "Injected capabilities"): `<client>
// --version` with an explicit environment, resolved on that environment's
// PATH, returning the raw output whatever it exits with. Fake clients are
// scripts named after the client in a temporary directory.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { Clients } from "../../src/domain/clients.ts"
import { ClientStartFailed } from "../../src/domain/process.ts"
import { readClientVersionWith } from "../../src/runtime/client-version.ts"

/** Runs `use` with a fresh temporary directory, removed afterwards. */
const withTemporaryDirectory = <A, E>(use: (dir: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(`${tmpdir()}/tarlatan-version-`)),
    use,
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

/**
 * The time budget, in milliseconds, of every test here (dogfood-6e, owner
 * ruling of 2026-11-27). Each starts, or tries to start, one fake client
 * script and claims nothing about speed; a process start took seconds
 * while other sessions kept the load average between 75 and 200.
 *
 * What it bounds: the longest test, the first, starts one `sh` script,
 * which runs `pwd` and `env`; no git and no `ps`. Idle duration: awaiting
 * the coordinator's measurement on the dogfood-6f snapshot; this file is
 * not among the measurements of 2026-11-28.
 */
const versionReadMillis = 15_000

/** Writes `<dir>/bin/<name>` as a script with `body` and returns `<dir>/bin`. */
const fakeClient = (dir: string, name: string, body: string) => {
  mkdirSync(`${dir}/bin`)
  writeFileSync(`${dir}/bin/${name}`, `#!/bin/sh\n${body}\n`)
  chmodSync(`${dir}/bin/${name}`, 0o755)
  return `${dir}/bin`
}

const reportsOutputAndEnvironment = (dir: string) =>
  Effect.gen(function* () {
    const bin = fakeClient(dir, Clients.Claude, 'echo "$@" "$(/bin/pwd)"\nexec /usr/bin/env -u PWD -u SHLVL')
    const output = yield* readClientVersionWith({ cwd: dir, env: { PATH: bin, ONLY: "this" } })(Clients.Claude)
    expect(output.exitCode).toBe(0)
    const [first, ...variables] = output.stdout.split("\n")
    expect(first).toBe(`--version ${realpathSync(dir)}`)
    expect(variables.sort()).toEqual(["", "ONLY=this", `PATH=${bin}`])
    expect(output.stderr).toBe("")
  })

const keepsNonZeroExit = (dir: string) =>
  Effect.gen(function* () {
    const bin = fakeClient(dir, Clients.Codex, "echo codex-cli 0.1\necho warning >&2\nexit 2")
    expect(yield* readClientVersionWith({ cwd: dir, env: { PATH: bin } })(Clients.Codex)).toEqual({
      exitCode: 2,
      stdout: "codex-cli 0.1\n",
      stderr: "warning\n",
    })
  })

const failsWhenNotOnPath = (dir: string) =>
  Effect.gen(function* () {
    mkdirSync(`${dir}/empty`)
    const read = readClientVersionWith({ cwd: dir, env: { PATH: `${dir}/empty` } })
    const failure = yield* Effect.flip(read(Clients.Claude))
    expect(Schema.is(ClientStartFailed)(failure)).toBe(true)
    expect(failure.argv).toEqual([Clients.Claude, "--version"])
  })

const failsWhenSignaled = (dir: string) =>
  Effect.gen(function* () {
    const bin = fakeClient(dir, Clients.Claude, "kill -TERM $$")
    const failure = yield* Effect.flip(readClientVersionWith({ cwd: dir, env: { PATH: bin } })(Clients.Claude))
    expect(Schema.is(ClientStartFailed)(failure)).toBe(true)
  })

describe("readClientVersionWith", () => {
  it.effect("runs `<client> --version` in the directory with exactly the given environment", () =>
    withTemporaryDirectory(reportsOutputAndEnvironment), versionReadMillis,
  )
  it.effect("returns a non-zero exit with its output", () =>
    withTemporaryDirectory(keepsNonZeroExit), versionReadMillis)
  it.effect("fails when the client is not on the given PATH", () =>
    withTemporaryDirectory(failsWhenNotOnPath), versionReadMillis)
  it.effect("fails when a signal ends the client", () =>
    withTemporaryDirectory(failsWhenSignaled), versionReadMillis)
})
