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
import {
  type LedgerBusy,
  type LedgerError,
  type LedgerRow,
  type LedgerSnapshot,
  type LedgerStore,
  ReadingRow,
} from "../../src/domain/ledger.ts"
import { ClientStartFailed } from "../../src/domain/process.ts"
import { defaultPolicy } from "../../src/domain/policy.ts"
import { Roles } from "../../src/domain/roles.ts"
import { Windows } from "../../src/domain/window.ts"
import { allocationsInFallback } from "../../src/features/admission.ts"
import { ownerOnly } from "../../src/features/counting.ts"
import { publishClaudeProfileWith } from "../../src/program/claude-profile.ts"
import { handoffGitWith } from "../../src/program/handoff-git.ts"
import { type SessionContext, WorktreeUnready } from "../../src/program/session-context.ts"
import type { StatusContext } from "../../src/program/status-context.ts"
import type { GitInvocation } from "../../src/runtime/git.ts"
import { openLedger } from "../../src/runtime/ledger-sqlite.ts"
import { openProjectLog } from "../../src/runtime/project-log.ts"
import { tryLock } from "../../src/runtime/project-lock.ts"
import { openLedgerReader } from "../../src/runtime/state-read.ts"
import { stateFiles } from "../../src/runtime/state-files.ts"
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
  /** What `status` runs over: the same capabilities, with the stores opened read-only. */
  readonly status: StatusContext
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

/**
 * The time budget, in milliseconds, of every test over
 * `withHarness({ repository: true })` (dogfood-6e, owner ruling of
 * 2026-11-27). These tests claim nothing about speed; they run real git
 * one command after another, and under a load average of 75 to 200 four
 * such tests passed vitest's 5,000 ms default.
 *
 * What it bounds, counted from the code: the longest test of this kind is
 * handoff-refusals' "a third correction is refused", which makes 79 git
 * starts and no `ps` (the harness's process listing is faked). Its
 * harness makes the repository and the worktree with 11 (`init`, two
 * `config`, two commits, `add`, `rev-parse`, `worktree add` and three
 * `rev-parse`); then three reviews and two corrections each run the
 * attribute check of the base (3: `ls-tree`, two `config`; the tree holds
 * no `.gitattributes`, so no `cat-file`), the snapshot (7: `rev-parse
 * --show-object-format`, the preflight's `ls-tree` and `ls-files`,
 * `read-tree`, `add`, `write-tree`, `ls-tree`; the worktree has no
 * subdirectory, so no `check-ignore`) and the candidate's attribute check
 * (3), and each review one `diff-tree` more: 3 × 14 + 2 × 13 = 68. The
 * third correction is refused before any git. Besides those, six fake
 * client launches, which start no process. Idle duration: 1,384 ms,
 * measured by the coordinator on 2026-11-28 at a load average of about 3;
 * at most 14,929 ms under load averages of 39 to 145. The same value as
 * `endToEndMillis`, the ceiling (production-harness.ts).
 */
export const repositoryHarnessMillis = 60_000

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
        publishClaudeProfile: publishClaudeProfileWith(stateFiles, dir),
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
        estimates: { [Roles.Implementer]: 15, [Roles.Reviewer]: 15, [Roles.Corrector]: 15 },
        admission: { policy: defaultPolicy, retirement: ownerOnly, allocations: allocationsInFallback },
        checkCommands: [],
      },
    }
    const ledgerReader = yield* Effect.flatMap(openLedgerReader(`${dir}/ledger.sqlite`, busyMillis), Effect.fromOption)
    const status = statusOver(context, Effect.catchTag(ledgerReader.read, "StoreVersionNewer", Effect.die))
    return {
      context, dir, taskFile, trace, shown, client, inject, worktree, base, gitCalls, rawLedger: ledger, status,
    } satisfies Harness
  })

/** A status context over `context`'s reads, with the ledger read by `ledgerRead`. */
export const statusOver = (
  context: SessionContext,
  ledgerRead: Effect.Effect<LedgerSnapshot, LedgerError | LedgerBusy>,
): StatusContext => ({
  capabilities: {
    log: context.capabilities.log,
    ledgerRows: Effect.map(ledgerRead, Option.some),
    readProcesses: context.capabilities.readProcesses,
    readClientVersion: context.capabilities.readClientVersion,
    checkWorktree: context.capabilities.checkWorktree,
    nowMono: context.capabilities.nowMono,
    stateFiles: context.capabilities.stateFiles,
  },
  settings: context.settings,
})

/** Runs `use` over a fresh harness and removes its directory afterwards. */
export const withHarness = <A, E>(
  options: Partial<HarnessOptions>,
  use: (harness: Harness) => Effect.Effect<A, E, Scope.Scope>,
) => {
  const dir = mkdtempSync(`${tmpdir()}/tarlatan-session-`)
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

