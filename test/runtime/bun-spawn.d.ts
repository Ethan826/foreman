// The project has no Bun type package; this declares the parts of Bun
// 1.3.6 that the cross-process tests and their child fixtures use:
// `spawn` from "bun", the Bun executable's path (added to the `process`
// global that src/facade/process.d.ts declares with the child's
// arguments and the environment the git hazard tests set and restore),
// `process.umask` for the store directory tests, and `import.meta.dirname`
// for paths relative to a test file.
declare module "bun" {
  /** A running child process started by {@link spawn}. */
  export interface Subprocess {
    readonly pid: number
    /** (A Promise in Bun.) Resolves with the exit code once the child has exited and been reaped. */
    readonly exited: PromiseLike<number>
    /** The exit code, or null while running or when ended by a signal. */
    readonly exitCode: number | null
    /** The signal that ended the child, such as "SIGKILL", or null. */
    readonly signalCode: string | null
    /** Sends `signal` (default SIGTERM) to the child. */
    kill(signal?: number | string): void
  }
  /** Starts `cmd` (executable then arguments) as a child process. */
  export function spawn(
    cmd: ReadonlyArray<string>,
    options?: {
      readonly stdin?: "ignore" | "inherit"
      readonly stdout?: "ignore" | "inherit"
      readonly stderr?: "ignore" | "inherit"
    },
  ): Subprocess
}

/**
 * The test-only member of Bun's `process` global, merged into the
 * {@link Process} that src/facade/process.d.ts declares with `argv`,
 * `env` and `exit`; the global itself is declared there, once.
 */
interface Process {
  /** The path of the running Bun executable. */
  readonly execPath: string
  /**
   * Sets the process umask to `mask` and returns the previous one. The
   * store directory tests set a restrictive and a permissive umask and
   * restore the previous one afterwards.
   */
  umask(mask: number): number
}

interface ImportMeta {
  /** The directory of the current module's file. */
  readonly dirname: string
}
