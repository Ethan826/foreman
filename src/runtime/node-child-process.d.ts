// The project installs no Node type package; this declares the parts of
// Bun's Node-compatible `node:child_process` and `node:fs` that the
// Runtime layer uses (Bun 1.3.6): `execFile` with a callback, as Node
// documents it, `statSync` and `realpathSync`. `execFile` takes the
// child's whole environment, required, so no call inherits the parent's.
declare module "node:child_process" {
  /**
   * The error `execFile` passes when the child did not exit 0. `code` is
   * the exit code when the child exited, an error name such as "ENOENT"
   * when it could not start, and absent or null when a signal ended it.
   */
  export interface ExecFileError {
    readonly code?: number | string | null
    readonly message: string
  }
  /**
   * Runs `file` with `args` (no shell) and calls back with its output once
   * it ends. `env` is the child's entire environment; `file` is resolved
   * on its PATH.
   */
  export function execFile(
    file: string,
    args: ReadonlyArray<string>,
    options: {
      readonly cwd: string
      readonly env: Readonly<Record<string, string>>
      readonly encoding: "utf8"
    },
    callback: (error: ExecFileError | null, stdout: string, stderr: string) => void,
  ): unknown
}

declare module "node:fs" {
  /**
   * A file's status, following symbolic links. Throws an error whose `code`
   * is ENOENT or ENOTDIR when nothing is there, or another code such as
   * EACCES when the path cannot be inspected.
   */
  export function statSync(path: string): {
    /**
     * Whether the entry, after following symbolic links, is a directory.
     * False for a regular file or any other kind, which Runtime reports as
     * "a file" rather than as nothing.
     */
    isDirectory(): boolean
  }
  /** The absolute path with every symbolic link resolved; throws when it cannot be resolved. */
  export function realpathSync(path: string): string
}
