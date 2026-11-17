// The project has no Node type package; this declares the one call the prose
// gate test uses, with the result fields Node documents for spawnSync that
// the test reads (status, signal, stdout, stderr and the spawn error).
declare module "node:child_process" {
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
