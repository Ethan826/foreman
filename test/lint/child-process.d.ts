// The project has no Node type package; this declares the one call the prose
// gate test uses, with the result fields Node documents for spawnSync that
// the test reads (status, signal, stdout, stderr and the spawn error).
declare module "node:child_process" {
  /**
   * Runs `command` with `args` (no shell), blocks until it ends, and returns
   * its output decoded as UTF-8. `status` is the exit code, or null when a
   * signal ended the child; `signal` names that signal, or is null when the
   * child exited. `error` is set when the child could not be started (for
   * example ENOENT); a test that reads the output checks it first.
   */
  export function spawnSync(
    command: string,
    args: ReadonlyArray<string>,
    options: { readonly encoding: "utf8" },
  ): {
    readonly status: number | null
    readonly signal: string | null
    readonly stdout: string
    readonly stderr: string
    readonly error?: Error
  }
}
