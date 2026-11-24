// The project installs no Node type package; this declares the parts of
// Bun's Node-compatible `node:child_process` and `node:fs` that the
// Runtime layer uses (Bun 1.3.6): `execFile` with a callback, as Node
// documents it, `statSync`, `realpathSync`, and `lstatSync` and
// `readFileSync` for the attribute check (plan B11c), and for the
// snapshot (plan A2) the reads of a worktree entry that never follow a
// link, the preflight's directory listing (review finding B08), the
// temporary index directory and `node:crypto`'s SHA-1.
// git's output is read as raw bytes and decoded with `node:util`'s strict
// UTF-8 decoder (review finding B17). `execFile` takes the child's whole
// environment, required, so no call inherits the parent's.
// For the assisted cycle (plan A1): `spawn` for a client process, the
// file calls of the atomic state-file publish, `createHash` from
// `node:crypto` and `dirname` from `node:path`. `spawn` takes the whole
// environment too, and its child type declares no `kill`, so Runtime has
// no typed way to signal a client (plan "Global constraints").
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
      /**
       * The most bytes of stdout or of stderr kept before the child is
       * killed and an error reported; Node's default is 1 MiB.
       */
      readonly maxBuffer?: number
    },
    callback: (error: ExecFileError | null, stdout: string, stderr: string) => void,
  ): unknown
  /**
   * {@link execFile} with stdout and stderr as raw bytes, undecoded, so the
   * caller chooses how to decode them (review finding B17).
   */
  export function execFile(
    file: string,
    args: ReadonlyArray<string>,
    options: {
      readonly cwd: string
      readonly env: Readonly<Record<string, string>>
      readonly encoding: "buffer"
    },
    callback: (error: ExecFileError | null, stdout: Uint8Array, stderr: Uint8Array) => void,
  ): unknown

  /** A child's piped stdout or stderr. */
  export interface ChildOutput {
    /** Calls `listener` with each chunk of bytes as it arrives, in order. */
    on(event: "data", listener: (chunk: Uint8Array) => void): unknown
  }

  /**
   * A child started by {@link spawn}. Only the members tarlatan uses are
   * declared; `kill` is deliberately absent.
   */
  export interface ChildProcess {
    /** The child's pid; undefined when it could not be started. */
    readonly pid: number | undefined
    /** The child's stdout, piped. */
    readonly stdout: ChildOutput
    /** The child's stderr, piped. */
    readonly stderr: ChildOutput
    /** Emitted once the child has started. */
    on(event: "spawn", listener: () => void): unknown
    /** Emitted when the child could not be started, such as ENOENT for the file or the directory. */
    on(event: "error", listener: (error: { readonly message: string }) => void): unknown
    /**
     * Emitted after the child has ended and its stdout and stderr have
     * closed: the exit code, or null and the name of the signal that ended
     * it.
     */
    on(event: "close", listener: (code: number | null, signal: string | null) => void): unknown
  }

  /**
   * Starts `file` with `args` (no shell) in `cwd`. `env` is the child's
   * entire environment, and `file` is resolved on its PATH. With
   * `detached: true` the child is the leader of a new session and process
   * group, whose id is its pid. Stdin reads from /dev/null; stdout and
   * stderr are piped. The child is not killed when the parent exits.
   */
  export function spawn(
    file: string,
    args: ReadonlyArray<string>,
    options: {
      readonly cwd: string
      readonly env: Readonly<Record<string, string>>
      readonly detached: true
      readonly stdio: readonly ["ignore", "pipe", "pipe"]
    },
  ): ChildProcess
}

declare module "node:crypto" {
  /** A running digest; feed it with {@link Hash.update}, then read it once with {@link Hash.digest}. */
  export interface Hash {
    /** Adds `data` to the digest: bytes as they are, a string as its UTF-8 bytes. Returns the same digest. */
    update(data: string | Uint8Array): Hash
    /** The finished digest's raw bytes; the digest cannot be updated after. */
    digest(): Uint8Array
    /** The finished digest as lower-case hexadecimal. */
    digest(encoding: "hex"): string
  }
  /**
   * Starts a digest with the platform's implementation of `algorithm`:
   * "sha1" for git's blob ids (plan A2), "sha256" for state-file hashes
   * (plan A1).
   */
  export function createHash(algorithm: "sha1" | "sha256"): Hash
}

declare module "node:util" {
  /**
   * The WHATWG text decoder. With `fatal: true` {@link TextDecoder.decode}
   * throws a TypeError on bytes that are not valid UTF-8 instead of
   * replacing them with U+FFFD; with `ignoreBOM: true` a leading byte order
   * mark is kept as U+FEFF instead of being dropped.
   */
  export class TextDecoder {
    constructor(label: "utf-8", options: { readonly fatal: true; readonly ignoreBOM: true })
    /** The text of `bytes`; throws as the constructor's options say. */
    decode(bytes: Uint8Array): string
  }
}

declare module "node:path" {
  /** The directory part of `path`: everything before its last segment. */
  export function dirname(path: string): string
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
    /** The entry's type and permission bits, as st_mode. */
    readonly mode: number
    /** The numeric id of the entry's owner. */
    readonly uid: number
  }
  /**
   * The names of the entries of the directory at `path`, without `.` and
   * `..`, as raw bytes, undecoded, in no particular order. Throws when the
   * directory cannot be read.
   */
  export function readdirSync(path: string, options: { readonly encoding: "buffer" }): ReadonlyArray<Uint8Array>
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
   * Opens `path` and returns its file descriptor. `flags` is either the
   * open(2) flags as a number (from {@link constants}), which fails with
   * `code` ELOOP when O_NOFOLLOW meets a symbolic link, or a mode string:
   * `"a"` to append, creating the file; `"w"` to write, creating or
   * truncating it; `"r"` to read, as for a directory to be flushed.
   * Throws when it cannot.
   */
  export function openSync(path: string, flags: number | "a" | "w" | "r"): number
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
  /**
   * Writes `length` bytes of `buffer` from `offset` to the descriptor and
   * returns how many were written, which may be fewer. Throws on failure.
   */
  export function writeSync(fd: number, buffer: Uint8Array, offset: number, length: number): number
  /** Flushes the descriptor's data and metadata to storage (fsync(2)). Throws on failure. */
  export function fsyncSync(fd: number): void
  /**
   * Renames `oldPath` to `newPath`, replacing a file there, in one step
   * (rename(2)) when both are on one file system. Throws on failure.
   */
  export function renameSync(oldPath: string, newPath: string): void
}
