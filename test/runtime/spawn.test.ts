// Starting a client (plan "Injected capabilities", `StartClient`): a real
// child in a new process group, with exactly the environment given,
// stdout streamed as lines, every byte of output appended to the raw
// file, the leader's start time read once, and the exit reported. Every
// child here ends on its own (by finishing, by a release file, or by
// signaling itself), and every test waits for its exit. Tarlatan never
// signals.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Option, Result, Schema, Stream } from "effect"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { ClientStartFailed, ProcessReadFailed, type StdoutLine } from "../../src/domain/process.ts"
import { clientEnvironment } from "../../src/features/client-environment.ts"
import { decodePs, startTimeOf } from "../../src/format/ps.ts"
import { readProcesses } from "../../src/runtime/processes.ts"
import {
  localRawFile,
  RawOutputFailed,
  startClientOver,
  startClientWith,
  type ClientLaunch,
  type RunningClient,
} from "../../src/runtime/spawn.ts"

/** Runs `use` with a fresh temporary directory, removed afterwards. */
const withTemporaryDirectory = <A, E>(use: (dir: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(`${tmpdir()}/tarlatan-spawn-`)),
    use,
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

/** A test that runs `body` in a fresh temporary directory. */
const inDirectory = (name: string, body: (dir: string) => Effect.Effect<void, unknown>) => {
  it.effect(name, () => withTemporaryDirectory(body))
}

const startClient = startClientWith(readProcesses, startTimeOf)
const plainEnvironment = { PATH: "/usr/bin:/bin" }

/** A launch of `argv` in `dir` with the plain environment, raw output at `<dir>/raw`. */
const launchIn = (dir: string, argv: ClientLaunch["argv"]): ClientLaunch =>
  ({ argv, cwd: dir, env: plainEnvironment, rawPath: `${dir}/raw` })

/** The text of stdout lines; a line that is not UTF-8 shows as a marker no test expects. */
const textsOf = (lines: Iterable<StdoutLine>) => Array.from(lines, (line) => Result.getOrElse(line, () => "<not UTF-8>"))

/** Starts the launch, collects every line and waits for the exit. */
const runToEnd = (launch: ClientLaunch) =>
  Effect.gen(function* () {
    const running = yield* startClient(launch)
    const lines = textsOf(yield* Stream.runCollect(running.lines))
    const exit = yield* running.exit
    return { running, lines, exit }
  })

/** A shell loop that runs until the file named by `$1` exists. */
const waitForRelease = 'while [ ! -e "$1" ]; do sleep 0.05; done'

/** Creates the release file, then waits for the client's exit, whatever `use` did. */
const releasing = <A, E>(running: RunningClient, release: string, use: Effect.Effect<A, E>) =>
  Effect.ensuring(
    use,
    Effect.andThen(
      Effect.sync(() => {
        writeFileSync(release, "")
      }),
      Effect.ignore(running.exit),
    ),
  )

const leadsNewGroup = (dir: string) =>
  Effect.gen(function* () {
    const release = `${dir}/release`
    const script = `echo $$; /bin/ps -o pgid= -p $$; ${waitForRelease}`
    const running = yield* startClient(launchIn(dir, ["/bin/sh", "-c", script, "leader", release]))
    const readListing = Effect.flatMap(readProcesses(), (text) => Effect.fromResult(decodePs(text)))
    const listed = yield* releasing(running, release, readListing)
    const lines = textsOf(yield* Stream.runCollect(running.lines))
    expect(running.pgid).toBe(running.pid)
    expect(lines.map((line) => Number(line.trim()))).toEqual([running.pid, running.pid])
    const row = listed.find((each) => each.pid === running.pid)
    expect(row?.pgid).toBe(running.pid)
    expect(running.leaderStartedAt).toEqual(Option.some(row?.startedAt))
    expect(yield* running.exit).toEqual({ code: Option.some(0), signal: Option.none() })
  })

const passesExactEnvironment = (dir: string) =>
  Effect.gen(function* () {
    const given = { ONLY: "this", GIT_DIR: "/passed/as/given" }
    const { lines } = yield* runToEnd({ ...launchIn(dir, ["/usr/bin/env"]), env: given })
    expect([...lines].sort()).toEqual(["GIT_DIR=/passed/as/given", "ONLY=this"])
  })

const clientEnvironmentHasNoGit = (dir: string) =>
  Effect.gen(function* () {
    const parent = { PATH: "/usr/bin:/bin", GIT_DIR: "/repo/.git", GIT_WORK_TREE: "/repo", KEEP: "yes" }
    const { lines } = yield* runToEnd({ ...launchIn(dir, ["/usr/bin/env"]), env: clientEnvironment(parent) })
    expect([...lines].sort()).toEqual(["KEEP=yes", "PATH=/usr/bin:/bin"])
  })

const runsInDirectory = (dir: string) =>
  Effect.gen(function* () {
    const { lines } = yield* runToEnd(launchIn(dir, ["/bin/pwd"]))
    expect(lines).toEqual([realpathSync(dir)])
  })

const streamsInOrderAndRecordsAll = (dir: string) =>
  Effect.gen(function* () {
    const expected = Array.from({ length: 20000 }, (_, index) => String(index + 1))
    const { lines } = yield* runToEnd(launchIn(dir, ["/usr/bin/seq", "1", "20000"]))
    expect(lines).toEqual(expected)
    expect(readFileSync(`${dir}/raw`, "utf8")).toBe(`${expected.join("\n")}\n`)
  })

const recordsStderrAndAppends = (dir: string) =>
  Effect.gen(function* () {
    writeFileSync(`${dir}/raw`, "earlier\n")
    const script = "echo out; echo err >&2; printf last"
    const { lines } = yield* runToEnd(launchIn(dir, ["/bin/sh", "-c", script]))
    expect(lines).toEqual(["out", "last"])
    const raw = readFileSync(`${dir}/raw`, "utf8")
    expect(raw.startsWith("earlier\n")).toBe(true)
    expect([...raw.slice("earlier\n".length).matchAll(/out\n|err\n|last/g)].map((match) => match[0]).sort()).toEqual([
      "err\n",
      "last",
      "out\n",
    ])
    expect(raw.length).toBe("earlier\nout\nerr\nlast".length)
  })

const reportsExitCode = (dir: string) =>
  Effect.gen(function* () {
    const { exit } = yield* runToEnd(launchIn(dir, ["/bin/sh", "-c", "exit 3"]))
    expect(exit).toEqual({ code: Option.some(3), signal: Option.none() })
  })

const reportsSignal = (dir: string) =>
  Effect.gen(function* () {
    const { exit } = yield* runToEnd(launchIn(dir, ["/bin/sh", "-c", "kill -TERM $$"]))
    expect(exit).toEqual({ code: Option.none(), signal: Option.some("SIGTERM") })
  })

const signalsNothing = (dir: string) =>
  Effect.gen(function* () {
    const release = `${dir}/release`
    const trap = `trap 'echo signaled > "${dir}/signaled"; exit 9' HUP INT QUIT TERM USR1 USR2 PIPE`
    const script = `${trap}; echo ready; ${waitForRelease}`
    const running = yield* startClient(launchIn(dir, ["/bin/sh", "-c", script, "trapping", release]))
    const interruptConsumer = Effect.flatMap(Effect.forkChild(Stream.runCollect(running.lines)), Fiber.interrupt)
    yield* releasing(running, release, interruptConsumer)
    expect(yield* running.exit).toEqual({ code: Option.some(0), signal: Option.none() })
    expect(existsSync(`${dir}/signaled`)).toBe(false)
  })

const failsForMissingExecutable = (dir: string) =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(startClient(launchIn(dir, [`${dir}/no-such-client`, "--flag"])))
    expect(Schema.is(ClientStartFailed)(failure)).toBe(true)
    expect(failure.argv).toEqual([`${dir}/no-such-client`, "--flag"])
  })

const failsForMissingDirectory = (dir: string) =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(startClient({ ...launchIn(dir, ["/bin/pwd"]), cwd: `${dir}/missing` }))
    expect(Schema.is(ClientStartFailed)(failure)).toBe(true)
  })

const failsForUnwritableRaw = (dir: string) =>
  Effect.gen(function* () {
    const launch = { ...launchIn(dir, ["/bin/sh", "-c", `echo ran > "${dir}/ran"`]), rawPath: `${dir}/missing/raw` }
    const failure = yield* Effect.flip(startClient(launch))
    expect(Schema.is(ClientStartFailed)(failure)).toBe(true)
  })

const startUnreadWhenListingFails = (dir: string) =>
  Effect.gen(function* () {
    const failing = () => Effect.fail(new ProcessReadFailed({ reason: "no ps" }))
    const running = yield* startClientWith(failing, startTimeOf)(launchIn(dir, ["/bin/sh", "-c", "exit 0"]))
    expect(running.leaderStartedAt).toEqual(Option.none())
    expect(yield* running.exit).toEqual({ code: Option.some(0), signal: Option.none() })
  })

const startFromInjectedReading = (dir: string) =>
  Effect.gen(function* () {
    const listing = () => Effect.succeed("listing")
    const reading = (text: string, pid: number) => Option.some(`${text} ${String(pid)}`)
    const running = yield* startClientWith(listing, reading)(launchIn(dir, ["/bin/sh", "-c", "exit 0"]))
    expect(running.leaderStartedAt).toEqual(Option.some(`listing ${String(running.pid)}`))
    expect(Result.isSuccess(yield* Effect.result(running.exit))).toBe(true)
  })

/** Raw file calls whose `append` fails as a write to a closed descriptor does. */
const failingAppend = {
  ...localRawFile,
  append: (_descriptor: number, bytes: Uint8Array) => {
    localRawFile.append(-1, bytes)
  },
}

/** Raw file calls whose `close` fails as closing a closed descriptor does. */
const failingClose = {
  ...localRawFile,
  close: (descriptor: number) => {
    localRawFile.close(descriptor)
    localRawFile.close(descriptor)
  },
}

const exitFailsWhenRawWriteFails = (dir: string) =>
  Effect.gen(function* () {
    const start = startClientOver(failingAppend)(readProcesses, startTimeOf)
    const running = yield* start(launchIn(dir, ["/usr/bin/seq", "1", "3"]))
    expect(textsOf(yield* Stream.runCollect(running.lines))).toEqual(["1", "2", "3"])
    const failure = yield* Effect.flip(running.exit)
    expect(Schema.is(RawOutputFailed)(failure)).toBe(true)
    expect(failure.rawPath).toBe(`${dir}/raw`)
  })

const exitFailsWhenRawCloseFails = (dir: string) =>
  Effect.gen(function* () {
    const running = yield* startClientOver(failingClose)(readProcesses, startTimeOf)(launchIn(dir, ["/bin/echo", "x"]))
    expect(Schema.is(RawOutputFailed)(yield* Effect.flip(running.exit))).toBe(true)
    expect(readFileSync(`${dir}/raw`, "utf8")).toBe("x\n")
  })

describe("startClientOver", () => {
  inDirectory("streams every line but fails the exit when the raw file cannot be written", exitFailsWhenRawWriteFails)
  inDirectory("fails the exit when the raw file cannot be closed", exitFailsWhenRawCloseFails)
})

describe("startClientWith", () => {
  inDirectory("starts the leader of a new process group and reads its start time", leadsNewGroup)
  inDirectory("passes exactly the environment given", passesExactEnvironment)
  inDirectory("passes no GIT_* variable when the environment is the client environment", clientEnvironmentHasNoGit)
  inDirectory("runs in the given directory", runsInDirectory)
  inDirectory("streams stdout lines in order and writes them all to the raw file", streamsInOrderAndRecordsAll)
  inDirectory("appends stdout and stderr to the raw file and streams stdout only", recordsStderrAndAppends)
  inDirectory("reports the exit code", reportsExitCode)
  inDirectory("reports the signal that ended the leader", reportsSignal)
  inDirectory("signals nothing, even when the consumer of the lines is interrupted", signalsNothing)
  inDirectory("fails when the executable does not exist", failsForMissingExecutable)
  inDirectory("fails when the directory does not exist", failsForMissingDirectory)
  inDirectory("fails when the raw file cannot be opened", failsForUnwritableRaw)
  inDirectory("records no start time when the listing cannot be read", startUnreadWhenListingFails)
  inDirectory("reads the start time through the injected listing and reading", startFromInjectedReading)
})
