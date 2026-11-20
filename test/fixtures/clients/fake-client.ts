// A fake `StartClient` for the Program tests (plan "Slice A1", fake
// clients): it never starts a process. It records each launch it is
// given, writes the scripted output to the launch's raw file, as the
// real starter would, and returns the scripted lines and exit. The three
// scenarios beside it (claude-success.ts, claude-crash.ts,
// claude-rate-limited.ts) supply recorded-shape stream-json.
import { Effect, Option, Stream } from "effect"
import { writeFileSync } from "node:fs"
import type { ClientExit } from "../../../src/domain/process.ts"
import type { ClientLaunch, StartClient } from "../../../src/runtime/spawn.ts"

/** What a scripted client prints and how its leader ends. */
export interface ClientScript {
  readonly lines: ReadonlyArray<string>
  readonly exit: ClientExit
}

/** The pid and group the fake reports for every launch. */
export const fakePid = 4242

/** The start time the fake reports for its leader. */
export const fakeStartedAt = "Wed Nov 19 10:23:45 2026"

/** A fake starter and the launches it was given, in order. */
export interface FakeClient {
  readonly start: StartClient
  readonly launches: Array<ClientLaunch>
}

/** A fake starter that plays `script` for every launch. */
export const fakeClient = (script: ClientScript): FakeClient => {
  const launches: Array<ClientLaunch> = []
  const start: StartClient = (launch) =>
    Effect.sync(() => {
      launches.push(launch)
      writeFileSync(launch.rawPath, script.lines.map((line) => `${line}\n`).join(""))
      return {
        pid: fakePid,
        pgid: fakePid,
        leaderStartedAt: Option.some(fakeStartedAt),
        lines: Stream.fromIterable(script.lines),
        exit: Effect.succeed(script.exit),
      }
    })
  return { start, launches }
}

/** A leader that exited with `code`. */
export const exitedWith = (code: number): ClientExit => ({ code: Option.some(code), signal: Option.none() })

/** A leader ended by `signal`. */
export const killedBy = (signal: string): ClientExit => ({ code: Option.none(), signal: Option.some(signal) })
