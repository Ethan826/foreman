// The Node calls Runtime uses to create and inspect git's private HOME
// (batch review B02) and to resolve a configured path (B05), beside
// node-child-process.d.ts, which declares the rest. The project has no
// Node type package.
declare module "node:fs" {
  /**
   * Creates one directory at `path` with permission bits `mode`, less the
   * process umask. The parent must exist; an existing entry at `path`
   * throws EEXIST.
   */
  export function mkdirSync(path: string, mode: number): void
  /** Sets the permission bits of `path` to `mode`, following a symbolic link. Throws on failure. */
  export function chmodSync(path: string, mode: number): void
  /** The names in the directory at `path`, without `.` and `..`. Throws when it cannot be read. */
  export function readdirSync(path: string): Array<string>
}

declare module "node:os" {
  /** The user the process runs as; `uid` is its numeric user id. */
  export function userInfo(): { readonly uid: number }
}

declare module "node:path" {
  /** The last segment of `path`: everything after its last `/`. */
  export function basename(path: string): string
}
