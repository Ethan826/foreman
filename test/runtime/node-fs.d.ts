// The project has no Node type package; this declares the calls the
// runtime tests use to make and remove a temporary directory and to
// signal readiness between processes through a file.
declare module "node:fs" {
  export function mkdtempSync(prefix: string): string
  export function existsSync(path: string): boolean
  export function writeFileSync(path: string, data: string): void
  export function rmSync(
    path: string,
    options: { readonly recursive: boolean; readonly force: boolean },
  ): void
}
declare module "node:os" {
  export function tmpdir(): string
}
