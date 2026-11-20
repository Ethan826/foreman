// The client version read for the version pins (plan "Injected
// capabilities"; decision P4): `<client> --version`, run with an explicit
// environment and directory, nothing inherited. The executable is the
// client's name, resolved on the given environment's PATH. The output is
// returned raw, whatever the exit code; Format decodes it and Features
// compares it with the pin.
import { Effect, Option, Predicate } from "effect"
import { execFile, type ExecFileError } from "node:child_process"
import type { Client } from "../domain/clients.ts"
import { ClientStartFailed } from "../domain/process.ts"

/** What a finished version command printed and its exit code. */
export interface VersionOutput {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * Reads one client's version. Succeeds with any exit code; fails with
 * {@link ClientStartFailed} only when the client could not start or a
 * signal ended it. Program builds it with {@link readClientVersionWith}.
 */
export type ReadClientVersion = (client: Client) => Effect.Effect<VersionOutput, ClientStartFailed>

/** Where and with what environment the version command runs. */
export interface VersionContext {
  readonly cwd: string
  /** The command's entire environment; its PATH resolves the client. */
  readonly env: Readonly<Record<string, string>>
}

/** The argument that asks a client for its version. */
export const versionArgs = ["--version"] as const

/** Runs `<client> --version` in `cwd` with exactly `env`, reading output as UTF-8. */
export const readClientVersionWith =
  ({ cwd, env }: VersionContext): ReadClientVersion =>
  (client) =>
    Effect.callback<VersionOutput, ClientStartFailed>((resume) => {
      execFile(client, versionArgs, { cwd, env, encoding: "utf8" }, (error, stdout, stderr) => {
        resume(versionOutcome(client, error, stdout, stderr))
      })
    })

/** An `execFile` result as a {@link VersionOutput}, or a failure when the client did not exit. */
const versionOutcome = (client: Client, error: ExecFileError | null, stdout: string, stderr: string) =>
  Option.match(exitCodeOf(error), {
    onNone: () => Effect.fail(notRun(client, error, stderr)),
    onSome: (exitCode) => Effect.succeed({ exitCode, stdout, stderr }),
  })

/** The exit code: 0 with no error, the error's numeric code, or none. */
const exitCodeOf = (error: ExecFileError | null): Option.Option<number> =>
  Option.match(Option.fromNullishOr(error), {
    onNone: () => Option.some(0),
    onSome: (failed) => Option.filter(Option.fromNullishOr(failed.code), Predicate.isNumber),
  })

/** The failure for a client that did not start or was ended by a signal. */
const notRun = (client: Client, error: ExecFileError | null, stderr: string) =>
  new ClientStartFailed({
    argv: [client, ...versionArgs],
    reason: Option.match(Option.fromNullishOr(error), {
      onNone: () => stderr,
      onSome: (failed) => `${failed.message}\n${stderr}`,
    }),
  })
