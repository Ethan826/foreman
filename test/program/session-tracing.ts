// Tracing for the session Program tests: wrappers around the log, the
// ledger, the state files and the git process call that record every
// write in one ordered trace (git calls in their own list) and can fail
// a chosen write once.
import { expect } from "@effect/vitest"
import { Effect, Option } from "effect"
import type { PositionMoved, ProjectEvent, ProjectLog, ProjectLogError } from "../../src/domain/events.ts"
import { LedgerError, type LedgerRow, type LedgerStore } from "../../src/domain/ledger.ts"
import { GitCommandFailed } from "../../src/domain/worktree.ts"
import { type GitInvocation, startGit, type StartGit } from "../../src/runtime/git.ts"
import { type StateFiles, StateFileFailed, stateFiles } from "../../src/runtime/state-files.ts"

/** Failures a test injects; each fires on the first write it matches, once. */
export interface Injections {
  appendFails: Option.Option<(events: ReadonlyArray<ProjectEvent>) => Option.Option<PositionMoved | ProjectLogError>>
  /** Fails the transaction whose append matches, so nothing of it is written. */
  ledgerAppendFails: Option.Option<(rows: ReadonlyArray<LedgerRow>) => boolean>
  publishFails: Option.Option<(path: string) => boolean>
  startFails: boolean
  /** Fails the first git command whose args (after the overrides) match, before it runs. */
  gitFails: Option.Option<(args: ReadonlyArray<string>) => boolean>
}

/** No failure injected. */
export const noInjections = (): Injections => ({
  appendFails: Option.none(),
  ledgerAppendFails: Option.none(),
  publishFails: Option.none(),
  startFails: false,
  gitFails: Option.none(),
})

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

export const tracedLog = (log: ProjectLog, trace: Array<TraceEntry>, inject: Injections): ProjectLog => ({
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

export const tracedLedger = (store: LedgerStore, trace: Array<TraceEntry>, inject: Injections): LedgerStore => ({
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
})

export const tracedFiles = (trace: Array<TraceEntry>, inject: Injections): StateFiles => ({
  read: stateFiles.read,
  readIfPresent: stateFiles.readIfPresent,
  publish: (path, bytes) => {
    if (Option.exists(inject.publishFails, (match) => match(path))) {
      inject.publishFails = Option.none()
      return Effect.fail(new StateFileFailed({ path, reason: "injected" }))
    }
    return Effect.tap(stateFiles.publish(path, bytes), () =>
      Effect.sync(() => trace.push({ kind: "publish", items: [path] })),
    )
  },
})

/** The number of `-c` overrides the clean runner puts before every command. */
const overrideWords = 6

/** The command's own args, after the clean overrides. */
export const commandOf = (invocation: GitInvocation) => invocation.args.slice(overrideWords)

/** The real process call, recording each invocation in `calls` and failing an injected one. */
export const tracedGit =
  (calls: Array<GitInvocation>, inject: Injections): StartGit =>
  (invocation) => {
    if (Option.exists(inject.gitFails, (match) => match(commandOf(invocation)))) {
      inject.gitFails = Option.none()
      return Effect.fail(new GitCommandFailed({ args: invocation.args, exitCode: Option.none(), stderr: "injected" }))
    }
    calls.push(invocation)
    return startGit(invocation)
  }
