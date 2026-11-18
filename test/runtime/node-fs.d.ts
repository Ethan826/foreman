// The project has no Node type package; this declares the calls the
// runtime tests use to make and remove a temporary directory, to
// signal readiness between processes through a file, and to make and
// resolve a symbolic link, and to make a directory unsearchable and
// restore it.
declare module "node:fs" {
  export function mkdtempSync(prefix: string): string
  export function existsSync(path: string): boolean
  export function mkdirSync(path: string): void
  export function writeFileSync(path: string, data: string): void
  export function symlinkSync(target: string, path: string): void
  export function realpathSync(path: string): string
  export function chmodSync(path: string, mode: number): void
  export function rmSync(
    path: string,
    options: { readonly recursive: boolean; readonly force: boolean },
  ): void
}
declare module "node:os" {
  export function tmpdir(): string
}
