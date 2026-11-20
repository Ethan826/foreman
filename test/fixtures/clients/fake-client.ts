// A fake `StartClient` for the Program tests (plan "Slice A1", fake
// clients): it never starts a process. It records each launch it is
// given, writes the scripted output to the launch's raw file, as the
// real starter would, and returns the scripted lines and exit. A Codex
// script's final message goes to the file its argv names after
// `--output-last-message`, as Codex would write it. The scenarios beside
// it supply recorded-shape stream-json and `--json` events. A test may
// queue a script per launch; the first in the queue plays next, and the
// fake's own script plays when the queue is empty.
import { Effect, Option, Result, Stream } from "effect"
import { writeFileSync } from "node:fs"
import type { ClientExit, StdoutLine } from "../../../src/domain/process.ts"
import type { ClientLaunch, StartClient } from "../../../src/runtime/spawn.ts"

/** What a scripted client prints and how its leader ends. */
export interface ClientScript {
  readonly lines: ReadonlyArray<string>
  readonly exit: ClientExit
  /** The final message a Codex client writes to its `--output-last-message` file. */
  readonly lastMessage?: string
  /** What the client does in its working directory while it runs, such as an edit. */
  readonly alongside?: (launch: ClientLaunch) => void
}

/** The flag after which Codex's argv names its final-message file. */
const lastMessageFlag = "--output-last-message"

/** The pid and group the fake reports for every launch. */
export const fakePid = 4242

/** The start time the fake reports for its leader. */
export const fakeStartedAt = "Wed Nov 19 10:23:45 2026"

/** A fake starter and the launches it was given, in order. */
export interface FakeClient {
  readonly start: StartClient
  readonly launches: Array<ClientLaunch>
  /** Scripts for the next launches, in order. */
  readonly queue: Array<ClientScript>
}

/** A fake starter that plays `script` for every launch. */
export const fakeClient = (script: ClientScript): FakeClient => {
  const launches: Array<ClientLaunch> = []
  const queue: Array<ClientScript> = []
  const start: StartClient = (launch) =>
    Effect.sync(() => {
      const playing = queue.shift() ?? script
      launches.push(launch)
      writeFileSync(launch.rawPath, playing.lines.map((line) => `${line}\n`).join(""))
      writeLastMessage(launch, playing)
      playing.alongside?.(launch)
      return {
        pid: fakePid,
        pgid: fakePid,
        leaderStartedAt: Option.some(fakeStartedAt),
        lines: Stream.fromIterable(playing.lines.map(asStdoutLine)),
        exit: Effect.succeed(playing.exit),
      }
    })
  return { start, launches, queue }
}

/** Writes a script's final message where the launch's argv says, if it has one. */
const writeLastMessage = (launch: ClientLaunch, script: ClientScript) => {
  const index = launch.argv.indexOf(lastMessageFlag)
  const path = launch.argv[index + 1]
  if (script.lastMessage !== undefined && index >= 0 && path !== undefined) writeFileSync(path, script.lastMessage)
}

/** A scripted line as the starter streams it: text, since the script holds only text. */
const asStdoutLine = (line: string): StdoutLine => Result.succeed(line)

/** A leader that exited with `code`. */
export const exitedWith = (code: number): ClientExit => ({ code: Option.some(code), signal: Option.none() })

/** A leader ended by `signal`. */
export const killedBy = (signal: string): ClientExit => ({ code: Option.none(), signal: Option.some(signal) })
