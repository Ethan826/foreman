// The project installs no Node type package; this declares the parts of
// Bun's Node-compatible `node:child_process` and `node:fs` that the
// Runtime layer uses (Bun 1.3.6): `execFile` with a callback, as Node
// documents it, `statSync`, `realpathSync`, and `lstatSync` and
// `readFileSync` for the attribute check (plan B11c), and for the
// snapshot (plan A2) the reads of a worktree entry that never follow a
// link, the temporary index directory and `node:crypto`'s SHA-1.
// `execFile` takes the
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
  /**
   * A file's status without following a final symbolic link. Throws as
   * {@link statSync} does.
   */
  export function lstatSync(path: string): {
    /** Whether the entry itself is a symbolic link. */
    isSymbolicLink(): boolean
    /** Whether the entry is a directory. */
    isDirectory(): boolean
    /** Whether the entry is a regular file. */
    isFile(): boolean
  }
  /** Reads the whole file at `path` as UTF-8 text; throws when it cannot be read. */
  export function readFileSync(path: string, encoding: "utf8"): string
  /**
   * Reads the whole file at a path, or from an open file descriptor, as
   * raw bytes with no decoding; throws when it cannot be read.
   */
  export function readFileSync(file: string | number): Uint8Array
  /**
   * The text of the symbolic link at `path`, as raw bytes, without
   * following it: the target is never opened or inspected. Throws when
   * `path` is not a link (EINVAL) or cannot be read.
   */
  export function readlinkSync(path: string, options: { readonly encoding: "buffer" }): Uint8Array
  /**
   * Opens `path` with the open(2) `flags` (from {@link constants}) and
   * returns its file descriptor; throws on failure, with `code` ELOOP when
   * O_NOFOLLOW meets a symbolic link.
   */
  export function openSync(path: string, flags: number): number
  /** The status of an open file descriptor, which cannot be a link. Throws when it cannot be read. */
  export function fstatSync(descriptor: number): {
    /** Whether the descriptor is a regular file. */
    isFile(): boolean
    /** The file's type and permission bits, as st_mode. */
    readonly mode: number
  }
  /** Closes a file descriptor that {@link openSync} returned. */
  export function closeSync(descriptor: number): void
  /** The open(2) flags {@link openSync} takes, with the platform's values. */
  export const constants: {
    /** Open for reading only. */
    readonly O_RDONLY: number
    /** Fail with ELOOP rather than follow a symbolic link at the path. */
    readonly O_NOFOLLOW: number
    /** Do not block when opening, as a FIFO would. */
    readonly O_NONBLOCK: number
  }
  /**
   * Creates a new, empty directory named `prefix` followed by six random
   * characters, and returns its path; throws when it cannot be created.
   */
  export function mkdtempSync(prefix: string): string
  /**
   * Removes `path`; with `recursive` a directory and its contents, and
   * with `force` a missing path is not an error.
   */
  export function rmSync(
    path: string,
    options: { readonly recursive: boolean; readonly force: boolean },
  ): void
}

declare module "node:crypto" {
  /** A running digest; feed it with {@link Hash.update}, then read it once with {@link Hash.digest}. */
  export interface Hash {
    /** Adds `data` to the digest: bytes as they are, a string as its UTF-8 bytes. Returns the same digest. */
    update(data: string | Uint8Array): Hash
    /** The finished digest's raw bytes; the digest cannot be updated after. */
    digest(): Uint8Array
  }
  /**
   * Starts a digest with the platform's implementation of `algorithm`.
   * Runtime uses only "sha1", for git's blob ids (plan A2).
   */
  export function createHash(algorithm: "sha1"): Hash
}
