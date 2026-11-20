// The project has no Node type package; this declares the calls the
// runtime tests use to make and remove a temporary directory, to
// signal readiness between processes through a file, and to make and
// resolve a symbolic link, to make a directory unsearchable and
// restore it, to write executable scripts for the git hazard tests, and
// to read the file a git filter wrote, and to make a Unix socket.
declare module "node:fs" {
  /**
   * Creates a new, empty directory whose name is `prefix` followed by six
   * random characters, and returns its path. Tests pass a prefix under
   * `tmpdir()` so each test gets a directory no other run shares.
   */
  export function mkdtempSync(prefix: string): string
  /**
   * Whether anything exists at `path`, following symbolic links; false for
   * a dangling link. Never throws. Tests use it to watch for a marker file
   * another process writes.
   */
  export function existsSync(path: string): boolean
  /**
   * Creates one directory at `path`. Without the recursive option the
   * parent must exist, and an existing entry at `path` throws EEXIST.
   */
  export function mkdirSync(path: string): void
  /**
   * Writes `data` to `path`, a string as UTF-8 and bytes as they are,
   * creating the file or replacing its contents. The parent directory
   * must exist.
   */
  export function writeFileSync(path: string, data: string | Uint8Array): void
  /** Reads the whole file at `path` as UTF-8 text; throws when it cannot be read. */
  export function readFileSync(path: string, encoding: "utf8"): string
  /**
   * Creates a symbolic link at `path` that points to `target`. `target` is
   * stored as given and need not exist; an existing entry at `path` throws
   * EEXIST.
   */
  export function symlinkSync(target: string, path: string): void
  export function realpathSync(path: string): string
  /**
   * Sets the permission bits of `path` to `mode` (for example `0o000` to
   * make a directory unsearchable, then `0o755` to restore it).
   */
  export function chmodSync(path: string, mode: number): void
  /**
   * Removes `path`. With `recursive` it removes a directory and everything
   * under it; with `force` a missing path is not an error. Tests call it
   * with both to clean up their temporary directories.
   */
  export function rmSync(
    path: string,
    options: { readonly recursive: boolean; readonly force: boolean },
  ): void
}
declare module "node:os" {
  export function tmpdir(): string
}
declare module "node:net" {
  /** A server; the snapshot preflight tests use one only to make a Unix socket file. */
  export interface Server {
    /** Listens on the Unix socket at `path`, creating the socket file, then calls `ready`. */
    listen(path: string, ready: () => void): unknown
    /** Stops listening, removes the socket file, then calls `closed`. */
    close(closed: () => void): unknown
  }
  /** Makes a server that is not yet listening. */
  export function createServer(): Server
}
