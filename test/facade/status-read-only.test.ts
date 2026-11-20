// `foreman status` creates nothing and writes nothing (review item B11;
// plan "Commands and their prerequisites": `status` never takes the
// lock and never writes). Run through the CLI's `main`, as the owner
// runs it: a missing state is reported as missing and no file appears;
// an existing state's files keep their bytes and times; and status
// answers at once while another process holds the ledger's write lock.
// PATH names no directory, so no client binary runs for the pin check.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Clock, Effect } from "effect"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { Clients } from "../../src/domain/clients.ts"
import { HoldCreated, LogPosition } from "../../src/domain/events.ts"
import { Failure } from "../../src/domain/holds.ts"
import { OpId } from "../../src/domain/ids.ts"
import { Unclassified } from "../../src/domain/outcomes.ts"
import { Windows } from "../../src/domain/window.ts"
import { main } from "../../src/facade/cli.ts"
import { productionStatus, StateMissing } from "../../src/program/production-status.ts"
import { openLedger } from "../../src/runtime/ledger-sqlite.ts"
import { openProjectLog } from "../../src/runtime/project-log.ts"
import { reading } from "../program/session-harness.ts"
import { awaitExit, startChild } from "../runtime/child-process.ts"

/** An environment in which no client binary can be found. */
const noClients = { PATH: "/nonexistent-foreman-path" }

/** How long the other process holds the ledger's write lock, in milliseconds. */
const holdMillis = 3_000

/** Status must answer well before the lock is released, in milliseconds. */
const answerWithinMillis = 1_500

/** How long the stores here wait for a lock, in milliseconds. */
const busyMillis = 50

/** Writes a configuration file whose state directory is `stateDir`, and returns its path. */
const configIn = (dir: string, stateDir: string) => {
  const path = `${dir}/foreman.json`
  const config = {
    projectId: "alpha",
    stateDir,
    ownerCheckout: `${dir}/owner`,
    supervisor: { path: `${dir}/supervisor`, name: "alpha" },
    attributeAllowance: { rootLines: [] },
    pins: { [Clients.Claude]: "2.1.328 (Claude Code)", [Clients.Codex]: "codex-cli 0.170.0" },
  }
  writeFileSync(path, JSON.stringify(config))
  return path
}

/**
 * Every entry of `dir` with its modification time, and each file's bytes.
 * SQLite's shared-memory index (`-shm`) is listed by name only: every
 * WAL reader records its read mark there (sqlite.org/wal.html).
 */
const filesOf = (dir: string) =>
  Arr.map(readdirSync(dir).sort(), (name) => {
    const path = `${dir}/${name}`
    if (name.endsWith("-shm")) return { name }
    const status = statSync(path, { bigint: false })
    if (status.isDirectory()) return { name, mtime: status.mtimeMs }
    return { name, mtime: status.mtimeMs, bytes: Array.from(readFileSync(path)) }
  })

/** A state directory with a log holding a failure hold and a ledger holding two readings. */
const existingState = (stateDir: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      mkdirSync(stateDir)
      const log = yield* openProjectLog(`${stateDir}/log.sqlite`, busyMillis)
      const hold = new Failure({ opId: OpId.make("op-0"), outcome: new Unclassified() })
      yield* log.append(LogPosition.make(0), [new HoldCreated({ hold })])
      const ledger = yield* openLedger(`${stateDir}/ledger.sqlite`, busyMillis)
      yield* ledger.transact((tx) => tx.append([reading(Windows.FiveHour), reading(Windows.Weekly)]))
    }),
  )

const withDirectory = <A, E, R>(use: (dir: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(`${tmpdir()}/foreman-status-`)),
    use,
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

const missingStateCreatesNothing = (dir: string) =>
  Effect.gen(function* () {
    const stateDir = `${dir}/state`
    mkdirSync(stateDir)
    const config = configIn(dir, stateDir)
    const before = filesOf(dir)
    expect(yield* main(["--config", config, "status"], noClients)).toBe(0)
    expect(yield* Effect.scoped(productionStatus(config, noClients))).toEqual(
      new StateMissing({ stateDir, logPath: `${stateDir}/log.sqlite` }),
    )
    expect(readdirSync(stateDir)).toEqual([])
    expect(filesOf(dir)).toEqual(before)
  })

const existingStateUnchanged = (dir: string) =>
  Effect.gen(function* () {
    const stateDir = `${dir}/state`
    yield* existingState(stateDir)
    const config = configIn(dir, stateDir)
    const before = filesOf(stateDir)
    expect(yield* main(["--config", config, "status"], noClients)).toBe(0)
    expect(filesOf(stateDir)).toEqual(before)
  })

const answersUnderWriteLock = (dir: string) =>
  Effect.gen(function* () {
    const stateDir = `${dir}/state`
    yield* existingState(stateDir)
    const config = configIn(dir, stateDir)
    const child = yield* startChild("hold-ledger-write.ts", `${stateDir}/ledger.sqlite`, `${dir}/ready`, [
      String(holdMillis),
    ])
    const started = yield* Clock.currentTimeMillis
    expect(yield* main(["--config", config, "status"], noClients)).toBe(0)
    expect((yield* Clock.currentTimeMillis) - started).toBeLessThan(answerWithinMillis)
    expect(yield* awaitExit(child)).toBe(0)
  })

describe("foreman status", () => {
  it.live("creates no file for a missing state", () => withDirectory(missingStateCreatesNothing))
  it.live("leaves an existing state's files as they were", () => withDirectory(existingStateUnchanged))
  it.live("answers while another process holds the ledger's write lock", () =>
    Effect.scoped(withDirectory(answersUnderWriteLock)),
  )
})
