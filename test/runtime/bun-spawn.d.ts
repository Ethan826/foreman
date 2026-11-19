// The project has no Bun type package; this declares the parts of Bun
// 1.3.6 that the cross-process tests and their child fixtures use:
// `spawn` from "bun", the Bun executable's path, the child's arguments,
// the process environment that the git hazard tests set and restore,
// and `import.meta.dirname` for paths relative to a test file.
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

/** The parts of Bun's Node-compatible `process` global the tests read. */
declare const process: {
  /** The path of the running Bun executable. */
  readonly execPath: string
  /** The executable, the script, then the script's arguments. */
  readonly argv: ReadonlyArray<string>
  /** The process environment; a child started without its own inherits it. */
  readonly env: Record<string, string>
}

interface ImportMeta {
  /** The directory of the current module's file. */
  readonly dirname: string
}
