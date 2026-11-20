// Test harness for the assisted-session Program tests: a real project
// log, ledger and lock in a temporary directory, real state files, a fake
// client, and wrappers that record every write in one ordered trace and
// can inject a failure at a chosen write. A recorded supervisor worktree
// and a task file are in place; nothing runs git or a real client.
import { expect } from "@effect/vitest"
import { Array as Arr, Effect, Option } from "effect"
import type { Scope } from "effect"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { Clients } from "../../src/domain/clients.ts"
import { BootId } from "../../src/domain/clock.ts"
import {
  LogPosition,
  type PositionMoved,
  type ProjectEvent,
  type ProjectLog,
  ProjectLogError,
  WorktreeCreated,
} from "../../src/domain/events.ts"
import { ProjectId, Revision } from "../../src/domain/ids.ts"
import { LedgerError, type LedgerRow, type LedgerStore, ReadingRow } from "../../src/domain/ledger.ts"
import { ClientStartFailed } from "../../src/domain/process.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"
import { Roles } from "../../src/domain/roles.ts"
import { Windows } from "../../src/domain/window.ts"
import { allocationsInFallback } from "../../src/features/admission.ts"
import { ownerOnly } from "../../src/features/counting.ts"
import { type SessionContext, WorktreeUnready } from "../../src/program/session-context.ts"
import { openLedger } from "../../src/runtime/ledger-sqlite.ts"
import { openProjectLog } from "../../src/runtime/project-log.ts"
import { tryLock } from "../../src/runtime/project-lock.ts"
import { type StateFiles, StateFileFailed, stateFiles } from "../../src/runtime/state-files.ts"
import { claudeSuccess } from "../fixtures/clients/claude-success.ts"
import { type ClientScript, type FakeClient, fakeClient } from "../fixtures/clients/fake-client.ts"

export const project = ProjectId.make("alpha")
export const head = Revision.make("e".repeat(40))
export const pins = { [Clients.Claude]: "2.1.328 (Claude Code)", [Clients.Codex]: "codex-cli 0.170.0" }
const busyMillis = 50
const boot = BootId.make("boot-a")
const minuteMicros = 60_000_000
export const nowMono = { bootId: boot, micros: 30 * minuteMicros }

/** Failures a test injects; each fires on the first write it matches, once. */
export interface Injections {
  appendFails: Option.Option<(events: ReadonlyArray<ProjectEvent>) => Option.Option<PositionMoved | ProjectLogError>>
  /** Fails the transaction whose append matches, so nothing of it is written. */
  ledgerAppendFails: Option.Option<(rows: ReadonlyArray<LedgerRow>) => boolean>
  publishFails: Option.Option<(path: string) => boolean>
  startFails: boolean
}

export interface Harness {
  readonly context: SessionContext
  readonly dir: string
  readonly taskFile: string
  readonly trace: Array<TraceEntry>
  readonly shown: Array<string>
  readonly client: FakeClient
  readonly inject: Injections
  readonly worktree: WorktreeCreated
  /** The ledger without tracing or injection, for the tests' own reads. */
  readonly rawLedger: LedgerStore
}

export interface HarnessOptions {
  readonly script: ClientScript
  /** Seed readings with room and a monotonic clock, so pacing allows Claude. */
  readonly allowing: boolean
  readonly worktreePasses: boolean
  readonly installed: string
}

export const defaults: HarnessOptions = {
  script: claudeSuccess,
  allowing: true,
  worktreePasses: true,
  installed: pins[Clients.Claude],
}

/** One recorded write or launch, in the order they happened. */
export interface TraceEntry {
  readonly kind: "log" | "ledger" | "publish" | "start"
  readonly items: ReadonlyArray<unknown>
}

/** The expected trace entry for a log batch of these event tags. */
export const logBatch = (...tags: ReadonlyArray<string>) => ({ kind: "log", items: tags.map((tag) => ({ _tag: tag })) })
/** The expected trace entry for ledger rows of these tags, written in one append. */
export const ledgerRows = (...tags: ReadonlyArray<string>) => ({
  kind: "ledger",
  items: tags.map((tag) => ({ _tag: tag })),
})
/** The expected trace entry for publishing a file whose name ends with `suffix`. */
export const published = (suffix: string) => ({ kind: "publish", items: [expect.stringMatching(new RegExp(`${suffix}$`))] })
/** The expected trace entry for a client start. */
export const started = { kind: "start", items: [] }

const tracedLog = (log: ProjectLog, trace: Array<TraceEntry>, inject: Injections): ProjectLog => ({
  readFrom: log.readFrom,
  append: (expected, events) => {
    const failure = Option.flatMap(inject.appendFails, (match) => match(events))
    if (Option.isSome(failure)) {
      inject.appendFails = Option.none()
      return Effect.fail(failure.value)
    }
    return Effect.tap(log.append(expected, events), () => Effect.sync(() => trace.push({ kind: "log", items: events })))
  },
})

const tracedLedger = (store: LedgerStore, trace: Array<TraceEntry>, inject: Injections): LedgerStore => {
  return {
    transact: (body) =>
      store.transact((tx) =>
        body({
          read: tx.read,
          append: (rows) => {
            if (Option.exists(inject.ledgerAppendFails, (match) => match(rows))) {
              inject.ledgerAppendFails = Option.none()
              return Effect.fail(new LedgerError({ reason: "injected" }))
            }
            return Effect.tap(tx.append(rows), () =>
              Effect.sync(() => {
                if (rows.length > 0) trace.push({ kind: "ledger", items: rows })
              }),
            )
          },
        }),
      ),
  }
}

const tracedFiles = (trace: Array<TraceEntry>, inject: Injections): StateFiles => ({
  read: stateFiles.read,
  publish: (path, bytes) =>
    Option.exists(inject.publishFails, (match) => match(path))
      ? Effect.fail(new StateFileFailed({ path, reason: "injected" }))
      : Effect.tap(stateFiles.publish(path, bytes), () =>
          Effect.sync(() => trace.push({ kind: "publish", items: [path] })),
        ),
})

/** A fresh Claude reading at 10 percent with an hour left. */
export const reading = (window: (typeof Windows)[keyof typeof Windows]) =>
  new ReadingRow({
    provider: Clients.Claude,
    window,
    usedPercent: 10,
    resetsAt: Option.some(3_600_000),
    observedAt: 0,
    observedMono: Option.some({ bootId: boot, micros: 29 * minuteMicros }),
    source: "claudeRateLimitEvent",
  })

const build = (dir: string, options: HarnessOptions) =>
  Effect.gen(function* () {
    const trace: Array<TraceEntry> = []
    const shown: Array<string> = []
    const inject: Injections = {
      appendFails: Option.none(),
      ledgerAppendFails: Option.none(),
      publishFails: Option.none(),
      startFails: false,
    }
    const log = yield* openProjectLog(`${dir}/log.sqlite`, busyMillis)
    const ledger = yield* openLedger(`${dir}/ledger.sqlite`, busyMillis)
    const worktree = new WorktreeCreated({
      path: `${dir}/worktree`,
      branch: "foreman/t",
      gitDir: `${dir}/repo/.git/worktrees/worktree`,
      commonDir: `${dir}/repo/.git`,
      base: head,
    })
    yield* log.append(LogPosition.make(0), [worktree])
    if (options.allowing) yield* ledger.transact((tx) => tx.append([reading(Windows.FiveHour), reading(Windows.Weekly)]))
    const taskFile = `${dir}/task.md`
    writeFileSync(taskFile, "Add a greeting.\n")
    const client = fakeClient(options.script)
    let ids = 0
    const context: SessionContext = {
      capabilities: {
        log: tracedLog(log, trace, inject),
        ledger: tracedLedger(ledger, trace, inject),
        lock: tryLock(`${dir}/lock.sqlite`),
        startClient: (launch) =>
          inject.startFails
            ? Effect.fail(new ClientStartFailed({ argv: launch.argv, reason: "injected" }))
            : Effect.andThen(Effect.sync(() => trace.push({ kind: "start", items: [] })), client.start(launch)),
        readProcesses: () => Effect.succeed("  PID  PGID STARTED                      COMMAND\n"),
        readClientVersion: (client) =>
          Effect.succeed({
            exitCode: 0,
            stdout: `${client === Clients.Claude ? options.installed : pins[Clients.Codex]}\n`,
            stderr: "",
          }),
        stateFiles: tracedFiles(trace, inject),
        checkWorktree: () =>
          options.worktreePasses ? Effect.succeed(head) : Effect.fail(new WorktreeUnready({ reason: "not locked" })),
        newId: Effect.sync(() => {
          ids += 1
          return `id-${String(ids)}`
        }),
        nowMono: Effect.succeed(options.allowing ? Option.some(nowMono) : Option.none()),
        show: (line) => Effect.sync(() => shown.push(line)),
        parentEnvironment: { PATH: "/usr/bin", GIT_DIR: "/elsewhere", HOME: "/home/owner" },
      },
      settings: {
        project,
        stateDir: dir,
        pins,
        claudeSettings: `${dir}/claude-settings.json`,
        estimates: { [Roles.Implementer]: 15, [Roles.Reviewer]: 15, [Roles.Corrector]: 15 },
        admission: { policy: defaultPolicy, retirement: ownerOnly, allocations: allocationsInFallback },
      },
    }
    return { context, dir, taskFile, trace, shown, client, inject, worktree, rawLedger: ledger } satisfies Harness
  })

/** Runs `use` over a fresh harness and removes its directory afterwards. */
export const withHarness = <A, E>(
  options: Partial<HarnessOptions>,
  use: (harness: Harness) => Effect.Effect<A, E, Scope.Scope>,
) => {
  const dir = mkdtempSync(`${tmpdir()}/foreman-session-`)
  return Effect.ensuring(
    Effect.scoped(Effect.flatMap(build(dir, { ...defaults, ...options }), use)),
    Effect.sync(() => {
      rmSync(dir, { recursive: true, force: true })
    }),
  )
}

/** Every event in the log, in order. */
export const eventsOf = (harness: Harness) =>
  Effect.map(harness.context.capabilities.log.readFrom(LogPosition.make(0)), (logged) =>
    Arr.map(logged, (entry) => entry.event),
  )

/** Every ledger row, in seq order. */
export const rowsOf = (harness: Harness): Effect.Effect<ReadonlyArray<LedgerRow>, unknown> =>
  harness.rawLedger.transact((tx) =>
    Effect.map(tx.read, (snapshot) => Arr.map(snapshot.entries, (entry) => entry.row)),
  )

