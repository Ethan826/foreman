// The project has no Node type package; this declares the one call the prose
// gate test uses.
declare module "node:child_process" {
  export function spawnSync(
    command: string,
    args: ReadonlyArray<string>,
    options: { readonly encoding: "utf8" },
  ): { readonly status: number | null; readonly stdout: string }
}
