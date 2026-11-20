// Test harness for the assisted-session Program tests: a real project
// log, ledger and lock in a temporary directory, real state files, a fake
// client, and wrappers (session-tracing.ts) that record every write in
// one ordered trace and can inject a failure at a chosen write. A
// recorded supervisor worktree and a task file are in place. The
// worktree is made up unless a test asks for a real one; the handoff's
// git work runs real git through a traced process call.
import { Array as Arr, Effect, Option } from "effect"
import type { Scope } from "effect"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { noAttributeAllowance } from "../../src/domain/attributes.ts"
import { Clients } from "../../src/domain/clients.ts"
import { BootId } from "../../src/domain/clock.ts"
import { LogPosition, type WorktreeCreated } from "../../src/domain/events.ts"
import { ProjectId, type Revision } from "../../src/domain/ids.ts"
import { type LedgerRow, type LedgerStore, ReadingRow } from "../../src/domain/ledger.ts"
import { ClientStartFailed } from "../../src/domain/process.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"
import { Roles } from "../../src/domain/roles.ts"
import { Windows } from "../../src/domain/window.ts"
import { allocationsInFallback } from "../../src/features/admission.ts"
import { ownerOnly } from "../../src/features/counting.ts"
import { handoffGitWith } from "../../src/program/handoff-git.ts"
import { type SessionContext, WorktreeUnready } from "../../src/program/session-context.ts"
import type { GitInvocation } from "../../src/runtime/git.ts"
import { openLedger } from "../../src/runtime/ledger-sqlite.ts"
import { openProjectLog } from "../../src/runtime/project-log.ts"
import { tryLock } from "../../src/runtime/project-lock.ts"
import { claudeSuccess } from "../fixtures/clients/claude-success.ts"
import { type ClientScript, type FakeClient, fakeClient } from "../fixtures/clients/fake-client.ts"
import { emptyHome } from "../runtime/git-repo.ts"
import {
  type Injections,
  noInjections,
  type TraceEntry,
  tracedFiles,
  tracedGit,
  tracedLedger,
  tracedLog,
} from "./session-tracing.ts"
import { madeUpHead, madeUpWorktree, realWorktree } from "./session-worktree.ts"

export const project = ProjectId.make("alpha")
export const head = madeUpHead
export const pins = { [Clients.Claude]: "2.1.328 (Claude Code)", [Clients.Codex]: "codex-cli 0.170.0" }
const busyMillis = 50
const boot = BootId.make("boot-a")
const minuteMicros = 60_000_000
export const nowMono = { bootId: boot, micros: 30 * minuteMicros }

export interface Harness {
  readonly context: SessionContext
  readonly dir: string
  readonly taskFile: string
  readonly trace: Array<TraceEntry>
  readonly shown: Array<string>
  readonly client: FakeClient
  readonly inject: Injections
  readonly worktree: WorktreeCreated
  /** The worktree's HEAD the check reports, which a session opens at. */
  readonly base: Revision
  /** Every git command the handoff ran, in order. */
  readonly gitCalls: Array<GitInvocation>
  /** The ledger without tracing or injection, for the tests' own reads. */
  readonly rawLedger: LedgerStore
}

export interface HarnessOptions {
  readonly script: ClientScript
  /** Seed readings with room and a monotonic clock, so pacing allows Claude. */
  readonly allowing: boolean
  readonly worktreePasses: boolean
  readonly installed: string
  /** Record a real supervisor worktree of a disposable repository instead of a made-up one. */
  readonly repository: boolean
}

export const defaults: HarnessOptions = {
  script: claudeSuccess,
  allowing: true,
  worktreePasses: true,
  installed: pins[Clients.Claude],
  repository: false,
}

export { type Injections, type TraceEntry, ledgerRows, logBatch, published, started } from "./session-tracing.ts"

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
    const inject = noInjections()
    const gitCalls: Array<GitInvocation> = []
    const log = yield* openProjectLog(`${dir}/log.sqlite`, busyMillis)
    const ledger = yield* openLedger(`${dir}/ledger.sqlite`, busyMillis)
    const { worktree, base } = options.repository ? yield* realWorktree(dir) : madeUpWorktree(dir)
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
          options.worktreePasses ? Effect.succeed(base) : Effect.fail(new WorktreeUnready({ reason: "not locked" })),
        handoffGit: handoffGitWith(tracedGit(gitCalls, inject), noAttributeAllowance)(emptyHome, dir),
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
    return {
      context, dir, taskFile, trace, shown, client, inject, worktree, base, gitCalls, rawLedger: ledger,
    } satisfies Harness
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

