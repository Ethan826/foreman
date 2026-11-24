// The process listing for advisory process evidence (plan "Process
// evidence"): `ps -A -o pid,pgid,lstart,command`, returned as raw text;
// Format decodes it (`src/format/ps.ts`). `ps` runs by absolute path with
// exactly `LC_ALL=C` in its environment, so the lstart layout and the
// header are the C locale's and nothing from tarlatan's environment
// reaches it. Without `TZ`, start times are in the system's local time,
// the same for every reading. When stdout is not a terminal, BSD ps and
// procps print the whole command line.
import { Effect, Option } from "effect"
import { execFile, type ExecFileError } from "node:child_process"
import { ProcessReadFailed } from "../domain/process.ts"

/**
 * Reads the process listing as raw text. Program receives
 * {@link readProcesses}; a test may inject another.
 */
export type ReadProcesses = () => Effect.Effect<string, ProcessReadFailed>

/** The listing's arguments: every process, with pid, group, start and command. */
export const processListingArgs = ["-A", "-o", "pid,pgid,lstart,command"] as const

/** The whole environment `ps` runs with. */
export const processListingEnvironment: Readonly<Record<string, string>> = { LC_ALL: "C" }

/** Where `ps` is on macOS and on Linux. */
export const psPath = "/bin/ps"

/** The directory `ps` runs in; the listing does not depend on it. */
const listingDirectory = "/"

/** The most bytes of output kept: 64 MiB, far above a busy machine's listing. */
const maxListingBytes = 67_108_864

/**
 * Reads the listing with the `ps` at `ps`. Succeeds with stdout when it
 * exits 0; fails with {@link ProcessReadFailed}, carrying the error and
 * stderr, when it cannot start, exits non-zero or is ended by a signal.
 */
export const readProcessesAt =
  (ps: string): ReadProcesses =>
  () =>
    Effect.callback<string, ProcessReadFailed>((resume) => {
      execFile(
        ps,
        processListingArgs,
        { cwd: listingDirectory, env: processListingEnvironment, encoding: "utf8", maxBuffer: maxListingBytes },
        (error, stdout, stderr) => {
          resume(listingOutcome(error, stdout, stderr))
        },
      )
    })

/** The production listing: {@link readProcessesAt} {@link psPath}. */
export const readProcesses: ReadProcesses = readProcessesAt(psPath)

/** Stdout when `ps` exited 0, or the failure with what it reported. */
const listingOutcome = (error: ExecFileError | null, stdout: string, stderr: string) =>
  Option.match(Option.fromNullishOr(error), {
    onNone: () => Effect.succeed(stdout),
    onSome: (failed) => Effect.fail(new ProcessReadFailed({ reason: `${failed.message}\n${stderr}` })),
  })
