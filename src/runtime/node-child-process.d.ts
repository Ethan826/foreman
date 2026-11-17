// The project installs no Node type package; this declares the parts of
// Bun's Node-compatible `node:child_process` and `node:fs` that the
// Runtime layer uses (Bun 1.3.6): `execFile` with a callback, as Node
// documents it, `existsSync`, `statSync` and `realpathSync`.
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
  /** Runs `file` with `args` (no shell) and calls back with its output once it ends. */
  export function execFile(
    file: string,
    args: ReadonlyArray<string>,
    options: { readonly cwd: string; readonly encoding: "utf8" },
    callback: (error: ExecFileError | null, stdout: string, stderr: string) => void,
  ): unknown
}

declare module "node:fs" {
  /** Whether a file or directory exists at `path` (following symbolic links). */
  export function existsSync(path: string): boolean
  /** A file's status, following symbolic links; throws when it cannot be read. */
  export function statSync(path: string): { isDirectory(): boolean }
  /** The absolute path with every symbolic link resolved; throws when it cannot be resolved. */
  export function realpathSync(path: string): string
}
