// Starting a client (plan "Injected capabilities", `StartClient`; write
// protocol steps 5 and 6). The client runs with exactly the given argv,
// directory and environment, nothing inherited, as the leader of a new
// session and process group (`detached`), so its group id is its pid.
// Stdin reads from /dev/null. Every byte of stdout and stderr is appended
// to the raw file as it arrives, in arrival order; stdout alone is
// streamed as lines. The leader's start time is read once, right after
// spawn, through the injected process listing (plan "Process evidence").
// Nothing here sends a signal: the declared child type has no `kill`, and
// interrupting a consumer leaves the client running (plan "Global
// constraints").
import { Deferred, Effect, MutableRef, Option, Predicate, Queue, Result, Schema, Stream } from "effect"
import type { Array as Arr, Cause } from "effect"
import { spawn, type ChildProcess } from "node:child_process"
import { closeSync, openSync, writeSync } from "node:fs"
import { ClientStartFailed, type ClientExit } from "../domain/process.ts"
import type { ReadProcesses } from "./processes.ts"

/**
 * The raw file could not be written or closed while the client ran. The
 * client was not stopped; the raw file may be incomplete.
 */
export class RawOutputFailed extends Schema.TaggedError<RawOutputFailed>()("RawOutputFailed", {
  rawPath: Schema.String,
  reason: Schema.String,
}) {}

/** One client to start: its argv (executable first), directory, whole environment and raw file. */
export interface ClientLaunch {
  readonly argv: Arr.NonEmptyReadonlyArray<string>
  readonly cwd: string
  /** The client's entire environment; build it with `clientEnvironment` (decision P2). */
  readonly env: Readonly<Record<string, string>>
  /** The file every byte of output is appended to; created when missing. */
  readonly rawPath: string
}

/** A started client. */
export interface RunningClient {
  readonly pid: number
  /** The client's process group: equal to `pid`, since it leads a new group. */
  readonly pgid: number
  /** The leader's start time, read once after spawn; none when the read failed or did not list it. */
  readonly leaderStartedAt: Option.Option<string>
  /**
   * Stdout as UTF-8 lines without their ends (`\n`, `\r\n` or `\r`), in
   * order, ending when stdout closes. Lines are buffered from spawn, and
   * the stream can be consumed once.
   */
  readonly lines: Stream.Stream<string>
  /**
   * Completes once the leader has exited and its output is closed. Fails
   * with {@link RawOutputFailed} when the raw file could not be fully
   * written (a departure from the plan's signature, which has no error).
   */
  readonly exit: Effect.Effect<ClientExit, RawOutputFailed>
}

/**
 * Starts a client. Fails with {@link ClientStartFailed} when the raw file
 * cannot be opened or the client cannot be started; then nothing runs.
 */
export type StartClient = (launch: ClientLaunch) => Effect.Effect<RunningClient, ClientStartFailed>

/** Reads one process's start time from a raw listing; Program passes Format's `startTimeOf`. */
export type ReadStartTime = (listing: string, pid: number) => Option.Option<string>

/**
 * The raw file's calls, each throwing on failure: open for appending
 * (creating the file), append every byte of a chunk, close.
 */
export interface RawFileCalls {
  /** Opens `path` for appending, creating it, and returns the descriptor. */
  readonly open: (path: string) => number
  /** Appends every byte of `bytes`. */
  readonly append: (descriptor: number, bytes: Uint8Array) => void
  /** Closes the descriptor. */
  readonly close: (descriptor: number) => void
}

/** Where a client's output goes while it runs. */
interface OutputSinks {
  readonly files: RawFileCalls
  readonly raw: number
  readonly rawPath: string
  readonly rawFailure: MutableRef.MutableRef<Option.Option<RawOutputFailed>>
  readonly stdout: Queue.Queue<Uint8Array, Cause.Done>
  readonly exit: Deferred.Deferred<ClientExit, RawOutputFailed>
}

/** The pipes of a started client: no input, piped stdout and stderr. */
const clientStdio = ["ignore", "pipe", "pipe"] as const

/** The reason recorded when a thrown value carries no message. */
const unknownReason = "unknown error"

/** The raw-file calls over the local file system. */
export const localRawFile: RawFileCalls = {
  open: (path) => openSync(path, "a"),
  append: (descriptor, bytes) => {
    writeAll(descriptor, bytes, 0)
  },
  close: closeSync,
}

/**
 * The client starter over injected raw-file calls, process listing and
 * start-time reading. Production uses {@link startClientWith}; a test
 * injects raw-file calls that fail.
 */
export const startClientOver =
  (files: RawFileCalls) =>
  (readProcesses: ReadProcesses, readStartTime: ReadStartTime): StartClient =>
  (launch) =>
    Effect.gen(function* () {
      const sinks = yield* sinksFor(files, launch)
      const pid = yield* started(launch, sinks)
      const listing = yield* Effect.option(readProcesses())
      return {
        pid,
        pgid: pid,
        leaderStartedAt: Option.flatMap(listing, (text) => readStartTime(text, pid)),
        lines: Stream.splitLines(Stream.decodeText(Stream.fromQueue(sinks.stdout))),
        exit: Deferred.await(sinks.exit),
      }
    })

/**
 * The client starter Program receives with `readProcesses` and Format's
 * `startTimeOf`: {@link startClientOver} the local file system.
 */
export const startClientWith = startClientOver(localRawFile)

/** Opens the raw file for appending and makes the stdout queue and the exit. */
const sinksFor = (files: RawFileCalls, launch: ClientLaunch) =>
  Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => files.open(launch.rawPath),
      catch: (cause) => new ClientStartFailed({ argv: launch.argv, reason: reasonOf(cause) }),
    })
    return {
      files,
      raw,
      rawPath: launch.rawPath,
      rawFailure: MutableRef.make(Option.none<RawOutputFailed>()),
      stdout: yield* Queue.unbounded<Uint8Array, Cause.Done>(),
      exit: yield* Deferred.make<ClientExit, RawOutputFailed>(),
    } satisfies OutputSinks
  })

/**
 * Spawns the client with its handlers attached before any output can
 * arrive, and resumes with its pid once it has started or with the
 * failure when it could not. After a failed start the child still emits
 * `close`, which closes the raw file.
 */
const started = (launch: ClientLaunch, sinks: OutputSinks) =>
  Effect.callback<number, ClientStartFailed>((resume) => {
    const [file, ...args] = launch.argv
    const child = spawn(file, args, { cwd: launch.cwd, env: launch.env, detached: true, stdio: clientStdio })
    attachOutput(child, sinks)
    child.on("spawn", () => {
      resume(pidOf(launch, child))
    })
    child.on("error", (error) => {
      resume(Effect.fail(new ClientStartFailed({ argv: launch.argv, reason: error.message })))
    })
  })

/** Appends both streams to the raw file, queues stdout, and settles the exit on `close`. */
const attachOutput = (child: ChildProcess, sinks: OutputSinks) => {
  child.stdout.on("data", (chunk) => {
    appendRaw(sinks, chunk)
    Queue.offerUnsafe(sinks.stdout, chunk)
  })
  child.stderr.on("data", (chunk) => {
    appendRaw(sinks, chunk)
  })
  child.on("close", (code, signal) => {
    Queue.endUnsafe(sinks.stdout)
    recordRawFailure(
      sinks,
      Result.try(() => {
        sinks.files.close(sinks.raw)
      }),
    )
    const exit = { code: Option.fromNullishOr(code), signal: Option.fromNullishOr(signal) }
    Deferred.doneUnsafe(sinks.exit, exitOutcome(sinks, exit))
  })
}

/** The started child's pid, which Node and Bun set before `spawn` is emitted. */
const pidOf = (launch: ClientLaunch, child: ChildProcess) =>
  Effect.fromOption(
    Option.fromNullishOr(child.pid),
    () => new ClientStartFailed({ argv: launch.argv, reason: "no pid after spawn" }),
  )

/** Appends one chunk to the raw file, unless an earlier write already failed. */
const appendRaw = (sinks: OutputSinks, chunk: Uint8Array) => {
  if (Option.isSome(MutableRef.get(sinks.rawFailure))) return
  recordRawFailure(
    sinks,
    Result.try(() => {
      sinks.files.append(sinks.raw, chunk)
    }),
  )
}

/** Keeps the first raw-file failure, for the exit to report. */
const recordRawFailure = <A>(sinks: OutputSinks, attempt: Result.Result<A, unknown>) => {
  if (Result.isSuccess(attempt) || Option.isSome(MutableRef.get(sinks.rawFailure))) return
  const failure = new RawOutputFailed({ rawPath: sinks.rawPath, reason: reasonOf(attempt.failure) })
  MutableRef.set(sinks.rawFailure, Option.some(failure))
}

/** The exit, or the first raw-file failure. */
const exitOutcome = (sinks: OutputSinks, exit: ClientExit): Effect.Effect<ClientExit, RawOutputFailed> =>
  Option.match(MutableRef.get(sinks.rawFailure), {
    onNone: () => Effect.succeed(exit),
    onSome: Effect.fail,
  })

/**
 * Writes `bytes` from `offset` to the end, repeating while `writeSync`
 * writes fewer than asked; returns the bytes written. A self tail call,
 * which Bun runs without growing the stack.
 */
const writeAll = (descriptor: number, bytes: Uint8Array, offset: number): number =>
  offset >= bytes.byteLength
    ? offset
    : writeAll(descriptor, bytes, offset + writeSync(descriptor, bytes, offset, bytes.byteLength - offset))

/** A thrown value's message. */
const reasonOf = (cause: unknown): string =>
  Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message) ? cause.message : unknownReason
